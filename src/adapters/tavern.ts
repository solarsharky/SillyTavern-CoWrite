import type { CowriteTemplate, ManualLoreEntry } from '../domain/schema';

export interface CharacterIdentity {
  id: string;
  name: string;
}

export interface ManualLoreResult {
  content: string;
  tokenCount: number;
  missing: ManualLoreEntry[];
}

export interface WorldbookEntry {
  uid: number;
  name: string;
  enabled: boolean;
  content: string;
  [key: string]: unknown;
}

export class TavernBridge {
  get helper(): TavernHelperInterface {
    const helper = window.TavernHelper;
    if (!helper) throw new Error('未检测到酒馆助手，请安装并启用 JS-Slash-Runner 4.9.3 或更高版本。');
    return helper;
  }

  assertCompatible(): void {
    const helper = this.helper;
    const version = helper.getTavernHelperVersion?.() || '0.0.0';
    if (compareVersion(version, '4.9.3') < 0) {
      throw new Error(`酒馆助手版本过低（${version}），共笔需要 4.9.3 或更高版本。`);
    }
  }

  getContext(): SillyTavernContext {
    const context = window.SillyTavern?.getContext();
    if (!context) throw new Error('SillyTavern 上下文尚未就绪。');
    return context;
  }

  currentCharacter(): CharacterIdentity | null {
    const context = this.getContext();
    if (context.groupId !== null && context.groupId !== undefined) return null;
    const id = this.helper.getCurrentCharacterId();
    if (!id || !context.name2) return null;
    return { id, name: context.name2 };
  }

  maxContext(): number {
    return Number(this.getContext().maxContext || 32768);
  }

  async countTokens(text: string): Promise<number> {
    const counter = this.getContext().getTokenCountAsync;
    if (counter) return await counter(text);
    return Math.ceil(text.length / 3);
  }

  subscribeToStream(listener: (text: string, generationId: string) => void): () => void {
    const events = this.getContext().eventSource;
    if (!events?.removeListener) return () => {};
    const event = 'js_stream_token_received_fully';
    events.on(event, listener);
    return () => events.removeListener?.(event, listener);
  }

  getWorldbookNames(): string[] {
    return this.helper.getWorldbookNames();
  }

  async getWorldbook(name: string): Promise<WorldbookEntry[]> {
    return await this.helper.getWorldbook(name) as WorldbookEntry[];
  }

  async loadManualLore(template: CowriteTemplate): Promise<ManualLoreResult> {
    if (!['manual', 'both'].includes(template.context.worldInfoMode) || template.context.manualEntries.length === 0) {
      return { content: '', tokenCount: 0, missing: [] };
    }
    const byBook = new Map<string, ManualLoreEntry[]>();
    for (const selected of template.context.manualEntries) {
      const rows = byBook.get(selected.bookName) ?? [];
      rows.push(selected);
      byBook.set(selected.bookName, rows);
    }

    const sections: string[] = [];
    const missing: ManualLoreEntry[] = [];
    for (const [bookName, selectedRows] of byBook) {
      const entries = await this.getWorldbook(bookName).catch(() => []);
      const entryMap = new Map(entries.map((entry) => [entry.uid, entry]));
      const content: string[] = [];
      for (const selected of selectedRows) {
        const entry = entryMap.get(selected.uid);
        if (!entry || !entry.enabled) {
          missing.push(selected);
          continue;
        }
        if (entry.content?.trim()) content.push(`[${entry.name || selected.name || `条目 ${entry.uid}`} ]\n${entry.content.trim()}`);
      }
      if (content.length) sections.push(`## 世界书：${bookName}\n${content.join('\n\n')}`);
    }
    const result = sections.join('\n\n');
    return { content: result, tokenCount: await this.countTokens(result), missing };
  }
}

export function compareVersion(left: string, right: string): number {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}
