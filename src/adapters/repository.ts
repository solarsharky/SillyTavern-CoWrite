import localforage from 'localforage';
import { CatalogSchema, RecordSchema, TemplateSchema, SCHEMA_VERSION, type Catalog, type CowriteRecord, type CowriteTemplate } from '../domain/schema';

const CATALOG_FILE = 'cowrite-catalog.json';
const TEMPLATES_FILE = 'cowrite-templates.json';
const CATALOG_PATH = `/user/files/${CATALOG_FILE}`;
const TEMPLATES_PATH = `/user/files/${TEMPLATES_FILE}`;

export interface SaveResult {
  synced: boolean;
  error?: string;
}

export interface RecordRepository {
  loadRecords(): Promise<CowriteRecord[]>;
  pendingRecordIds(): Promise<string[]>;
  saveRecord(record: CowriteRecord): Promise<SaveResult>;
  deleteRecord(recordId: string): Promise<SaveResult>;
  loadTemplates(): Promise<CowriteTemplate[]>;
  saveTemplates(templates: CowriteTemplate[]): Promise<SaveResult>;
}

export class AccountFileRepository implements RecordRepository {
  private readonly cache = localforage.createInstance({ name: 'cowrite', storeName: 'records' });
  private catalog: Catalog | null = null;
  private writeQueue: Promise<unknown> = Promise.resolve();

  async loadRecords(): Promise<CowriteRecord[]> {
    this.catalog = await this.loadCatalog();
    const records: CowriteRecord[] = [];
    const initialKeys = await this.cache.keys();
    const pendingIds = new Set(initialKeys.filter((key) => key.startsWith('pending:')).map((key) => key.slice('pending:'.length)));
    for (const entry of this.catalog.records) {
      const remote = await this.fetchJson(entry.file).catch(() => null);
      const cached = await this.cache.getItem(`record:${entry.id}`);
      const parsed = RecordSchema.safeParse(pendingIds.has(entry.id) ? cached : remote ?? cached);
      if (parsed.success) {
        records.push(parsed.data);
        await this.cache.setItem(`record:${entry.id}`, parsed.data);
      }
    }
    const keys = await this.cache.keys();
    for (const key of keys.filter((value) => value.startsWith('record:'))) {
      const id = key.slice('record:'.length);
      if (records.some((record) => record.id === id)) continue;
      const parsed = RecordSchema.safeParse(await this.cache.getItem(key));
      if (parsed.success) records.push(parsed.data);
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveRecord(record: CowriteRecord): Promise<SaveResult> {
    const parsed = RecordSchema.parse(record);
    await this.cache.setItem(`record:${parsed.id}`, parsed);
    return await this.enqueue(async () => {
      try {
        const fileName = `cowrite-record-${parsed.id}.json`;
        const path = await this.uploadJson(fileName, parsed);
        const catalog = this.catalog ?? await this.loadCatalog();
        const nextEntry = {
          id: parsed.id,
          file: path,
          title: parsed.title,
          templateName: parsed.templateSnapshot.name,
          characterId: parsed.characterId,
          characterName: parsed.characterName,
          status: parsed.status,
          starred: parsed.starred,
          updatedAt: parsed.updatedAt,
        };
        catalog.records = [...catalog.records.filter((entry) => entry.id !== parsed.id), nextEntry];
        await this.uploadJson(CATALOG_FILE, catalog);
        await this.cache.setItem('catalog', catalog);
        await this.cache.removeItem(`pending:${parsed.id}`);
        this.catalog = catalog;
        return { synced: true };
      } catch (error) {
        await this.cache.setItem(`pending:${parsed.id}`, true);
        return { synced: false, error: errorMessage(error) };
      }
    });
  }

  async pendingRecordIds(): Promise<string[]> {
    const keys = await this.cache.keys();
    return keys.filter((key) => key.startsWith('pending:')).map((key) => key.slice('pending:'.length));
  }

  async deleteRecord(recordId: string): Promise<SaveResult> {
    await this.cache.removeItem(`record:${recordId}`);
    await this.cache.removeItem(`pending:${recordId}`);
    return await this.enqueue(async () => {
      try {
        const catalog = this.catalog ?? await this.loadCatalog();
        const entry = catalog.records.find((item) => item.id === recordId);
        if (entry) await this.deleteFile(entry.file);
        catalog.records = catalog.records.filter((item) => item.id !== recordId);
        await this.uploadJson(CATALOG_FILE, catalog);
        await this.cache.setItem('catalog', catalog);
        this.catalog = catalog;
        return { synced: true };
      } catch (error) {
        return { synced: false, error: errorMessage(error) };
      }
    });
  }

  async loadTemplates(): Promise<CowriteTemplate[]> {
    const remote = await this.fetchJson(TEMPLATES_PATH).catch(() => null);
    const cached = await this.cache.getItem('templates');
    const input = remote ?? cached ?? [];
    const parsed = TemplateSchema.array().safeParse(input);
    if (!parsed.success) return [];
    await this.cache.setItem('templates', parsed.data);
    return parsed.data;
  }

  async saveTemplates(templates: CowriteTemplate[]): Promise<SaveResult> {
    const parsed = TemplateSchema.array().parse(templates);
    await this.cache.setItem('templates', parsed);
    return await this.enqueue(async () => {
      try {
        await this.uploadJson(TEMPLATES_FILE, parsed);
        return { synced: true };
      } catch (error) {
        return { synced: false, error: errorMessage(error) };
      }
    });
  }

  private async loadCatalog(): Promise<Catalog> {
    const remote = await this.fetchJson(CATALOG_PATH).catch(() => null);
    const cached = await this.cache.getItem('catalog');
    const parsed = CatalogSchema.safeParse(remote ?? cached ?? { schemaVersion: SCHEMA_VERSION, records: [] });
    return parsed.success ? parsed.data : { schemaVersion: SCHEMA_VERSION, records: [] };
  }

  private async fetchJson(path: string): Promise<unknown> {
    const context = window.SillyTavern?.getContext();
    if (!context) throw new Error('SillyTavern 未就绪');
    const response = await fetch(`${path}?rev=${Date.now()}`, {
      method: 'GET',
      cache: 'no-cache',
      headers: context.getRequestHeaders(),
    });
    if (!response.ok) throw new Error(`读取 ${path} 失败（${response.status}）`);
    return await response.json();
  }

  private async uploadJson(fileName: string, value: unknown): Promise<string> {
    const context = window.SillyTavern?.getContext();
    if (!context) throw new Error('SillyTavern 未就绪');
    const data = utf8ToBase64(JSON.stringify(value, null, 2));
    const response = await fetch('/api/files/upload', {
      method: 'POST',
      headers: context.getRequestHeaders(),
      body: JSON.stringify({ name: fileName, data }),
    });
    if (!response.ok) throw new Error(`保存 ${fileName} 失败（${response.status}）`);
    const result = await response.json() as { path?: string };
    return result.path || `/user/files/${fileName}`;
  }

  private async deleteFile(path: string): Promise<void> {
    const context = window.SillyTavern?.getContext();
    if (!context) throw new Error('SillyTavern 未就绪');
    const response = await fetch('/api/files/delete', {
      method: 'POST',
      headers: context.getRequestHeaders(),
      body: JSON.stringify({ path }),
    });
    if (!response.ok && response.status !== 404) throw new Error(`删除记录失败（${response.status}）`);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

export class LocalSecretVault {
  private readonly storage = localforage.createInstance({ name: 'cowrite', storeName: 'secrets' });

  async get(profileId: string): Promise<string> {
    return String(await this.storage.getItem(`key:${profileId}`) || '');
  }

  async set(profileId: string, value: string): Promise<void> {
    if (value) await this.storage.setItem(`key:${profileId}`, value);
    else await this.storage.removeItem(`key:${profileId}`);
  }

  async delete(profileId: string): Promise<void> {
    await this.storage.removeItem(`key:${profileId}`);
  }
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
