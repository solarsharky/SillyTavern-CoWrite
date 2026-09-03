import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { GenerationOutputError, TavernGenerationGateway, type GenerationProgress } from '../adapters/generation';
import { AccountFileRepository, LocalSecretVault } from '../adapters/repository';
import { TavernBridge, compareVersion } from '../adapters/tavern';
import { ActivityEngine, type EngineResult } from '../core/engine';
import { createBackup, downloadText, importBackup, importTemplate, recordToMarkdown } from '../core/backup';
import { buildPromptPreview } from '../core/prompt';
import { DEFAULT_PROTOCOL } from '../core/protocol';
import { cloneJson } from '../core/clone';
import { createId } from '../core/id';
import { prepareTemplateForGeneration } from '../core/template';
import { BUILTIN_TEMPLATES, DEFAULT_SETTINGS, cloneBuiltinTemplate, upgradeBuiltinPrompts, upgradeSettings } from '../domain/defaults';
import {
  BackupSchema,
  ConnectionProfileSchema,
  RecordSchema,
  SettingsSchema,
  TemplateSchema,
  type ConnectionProfile,
  type ContentItem,
  type CowriteRecord,
  type CowriteSettings,
  type CowriteTemplate,
  type InputConfig,
} from '../domain/schema';

export type AppTab = 'current' | 'templates' | 'records' | 'settings';

export const useCowriteStore = defineStore('cowrite', () => {
  const tavern = new TavernBridge();
  const repository = new AccountFileRepository();
  const secrets = new LocalSecretVault();
  const generationProgress = ref<GenerationProgress | null>(null);
  const gateway = new TavernGenerationGateway(tavern, (progress) => { generationProgress.value = progress; });

  const initialized = ref(false);
  const busy = ref(false);
  const open = ref(false);
  const tab = ref<AppTab>('current');
  const error = ref('');
  const notices = ref<string[]>([]);
  const rawOutput = ref('');
  const records = ref<CowriteRecord[]>([]);
  const unsyncedRecordIds = ref<string[]>([]);
  const templates = ref<CowriteTemplate[]>([]);
  const selectedRecordId = ref('');
  const characterId = ref('');
  const characterName = ref('');
  const helperVersion = ref('未检测');
  const settings = reactive<CowriteSettings>(cloneJson(DEFAULT_SETTINGS));
  const sessionKeys = reactive<Record<string, string>>({});
  let operationQueue: Promise<void> = Promise.resolve();
  let stopRequested = false;

  const engine = new ActivityEngine({
    repository,
    gateway,
    tavern,
    getGlobalPrompt: () => settings.globalPrompt,
    resolveConnection(id) {
      const requestedId = id === 'default' ? settings.defaultConnectionId : id;
      const profile = settings.connections.find((item) => item.id === requestedId)
        || settings.connections.find((item) => item.id === settings.defaultConnectionId)
        || settings.connections[0];
      if (!profile) throw new Error('没有可用的生成连接。');
      if (profile.type === 'custom' && !sessionKeys[profile.id]) throw new Error(`请先为连接“${profile.name}”填写 API Key。`);
      return { profile, apiKey: profile.type === 'custom' ? sessionKeys[profile.id] : undefined };
    },
  });

  const selectedRecord = computed(() => records.value.find((item) => item.id === selectedRecordId.value) || null);
  const visibleRecords = computed(() => {
    const matching = characterId.value ? records.value.filter((item) => item.characterId === characterId.value) : [];
    const unbound = records.value.filter((item) => !item.characterId);
    return [...matching, ...unbound];
  });
  const canGenerate = computed(() => Boolean(characterId.value) && !busy.value);
  const persistedTemplates = computed(() => templates.value);

  async function initialize(): Promise<void> {
    if (initialized.value) return;
    clearMessages();
    try {
      tavern.assertCompatible();
      helperVersion.value = tavern.helper.getTavernHelperVersion();
      loadSettings();
      for (const profile of settings.connections) {
        if (profile.type === 'custom' && profile.rememberKey) sessionKeys[profile.id] = await secrets.get(profile.id);
      }
      const [storedTemplates, storedRecords] = await Promise.all([repository.loadTemplates(), repository.loadRecords()]);
      templates.value = mergeTemplates(storedTemplates);
      records.value = storedRecords;
      unsyncedRecordIds.value = await repository.pendingRecordIds();
      refreshCharacter();
      selectedRecordId.value = records.value.find((item) => item.characterId === characterId.value && item.status === 'active')?.id || records.value[0]?.id || '';
      initialized.value = true;
    } catch (caught) {
      error.value = errorMessage(caught);
      templates.value = mergeTemplates([]);
      initialized.value = true;
    }
  }

  function refreshCharacter(): void {
    try {
      const character = tavern.currentCharacter();
      characterId.value = character?.id || '';
      characterName.value = character?.name || '';
      const current = selectedRecord.value;
      if (!current || (character && current.characterId !== character.id)) {
        selectedRecordId.value = records.value.find((item) => item.characterId === character?.id && item.status === 'active')?.id || '';
      }
    } catch {
      characterId.value = '';
      characterName.value = '';
    }
  }

  async function start(template: CowriteTemplate, content?: ContentItem): Promise<void> {
    await run(async () => {
      const prepared = prepareTemplateForGeneration(template, settings.generationContext, content);
      applyEngineResult(await engine.start(prepared));
      tab.value = 'current';
    });
  }

  async function continueRecord(): Promise<void> {
    await changeSelectedRecord((record) => engine.continue(record), true);
  }

  async function stopGeneration(): Promise<void> {
    stopRequested = true;
    if (await engine.stop() || busy.value) notices.value = ['已发送停止请求；本轮不会写入半成品。'];
  }

  async function commitInput(blockId: string, value: InputConfig['value']): Promise<void> {
    await changeSelectedRecord((record) => engine.updateInput(record, blockId, value), false, false);
  }

  async function reroll(): Promise<void> {
    await changeSelectedRecord((record) => engine.reroll(record), true);
  }

  async function clearAnswers(): Promise<void> {
    await changeSelectedRecord((record) => engine.clearAnswers(record));
  }

  async function generateMore(): Promise<void> {
    await changeSelectedRecord((record) => engine.generateMore(record), true);
  }

  async function toggleRecordStar(record = selectedRecord.value): Promise<void> {
    if (!record) return;
    const recordId = record.id;
    await run(async () => {
      const current = records.value.find((item) => item.id === recordId);
      if (current) applyEngineResult(await engine.toggleStar(current), selectedRecordId.value === recordId);
    }, false);
  }

  async function changeSelectedRecord(operation: (record: CowriteRecord) => Promise<EngineResult>, prepareGeneration = false, showBusy = true): Promise<void> {
    const recordId = selectedRecordId.value;
    if (!recordId) return;
    await run(async () => {
      const source = records.value.find((item) => item.id === recordId);
      if (!source) return;
      const record = RecordSchema.parse({
        ...cloneJson(source),
        templateSnapshot: prepareGeneration ? prepareTemplateForGeneration(source.templateSnapshot, settings.generationContext) : source.templateSnapshot,
      });
      applyEngineResult(await operation(record), selectedRecordId.value === recordId);
    }, showBusy);
  }

  async function removeRecord(record: CowriteRecord): Promise<void> {
    const result = await repository.deleteRecord(record.id);
    records.value = records.value.filter((item) => item.id !== record.id);
    unsyncedRecordIds.value = unsyncedRecordIds.value.filter((id) => id !== record.id);
    if (selectedRecordId.value === record.id) selectedRecordId.value = records.value[0]?.id || '';
    notices.value = [result.synced ? '记录已删除。' : `记录已从本机移除，但账户文件删除失败：${result.error}`];
  }

  async function retrySync(record = selectedRecord.value): Promise<void> {
    if (!record) return;
    const result = await repository.saveRecord(record);
    if (result.synced) {
      unsyncedRecordIds.value = unsyncedRecordIds.value.filter((id) => id !== record.id);
      notices.value = ['记录已同步到账户文件。'];
    } else {
      if (!unsyncedRecordIds.value.includes(record.id)) unsyncedRecordIds.value.push(record.id);
      error.value = `同步仍然失败：${result.error}`;
    }
  }

  async function rebindRecord(record: CowriteRecord): Promise<void> {
    const character = tavern.currentCharacter();
    if (!character) throw new Error('请先打开要重新绑定的单角色聊天。');
    const next = RecordSchema.parse({
      ...cloneJson(record),
      characterId: character.id,
      characterName: character.name,
      updatedAt: new Date().toISOString(),
    });
    const result = await repository.saveRecord(next);
    const index = records.value.findIndex((item) => item.id === next.id);
    if (index >= 0) records.value[index] = next;
    notices.value = [result.synced ? `已重新绑定到“${character.name}”。` : `已在本机重新绑定，但尚未同步：${result.error}`];
  }

  async function saveTemplate(source: CowriteTemplate): Promise<void> {
    const parsed = TemplateSchema.parse({ ...cloneJson(source), updatedAt: new Date().toISOString() });
    const index = templates.value.findIndex((item) => item.id === parsed.id);
    if (index >= 0) templates.value.splice(index, 1, parsed);
    else templates.value.push(parsed);
    settings.hiddenTemplateIds = settings.hiddenTemplateIds.filter((id) => id !== parsed.id);
    await persistTemplates();
    saveSettings();
    notices.value = ['模板已保存。'];
  }

  async function duplicateTemplate(source: CowriteTemplate): Promise<CowriteTemplate> {
    const copy = cloneBuiltinTemplate(source, createId());
    await saveTemplate(copy);
    return copy;
  }

  async function removeTemplate(template: CowriteTemplate): Promise<void> {
    if (template.builtin && !settings.hiddenTemplateIds.includes(template.id)) settings.hiddenTemplateIds.push(template.id);
    templates.value = templates.value.filter((item) => item.id !== template.id);
    settings.starredTemplateIds = settings.starredTemplateIds.filter((id) => id !== template.id);
    await persistTemplates();
    saveSettings();
  }

  async function restoreBuiltinTemplates(): Promise<void> {
    settings.hiddenTemplateIds = [];
    templates.value = mergeTemplates(templates.value);
    await persistTemplates();
    saveSettings();
    notices.value = ['已恢复内置格式分类。'];
  }

  async function saveContentItem(template: CowriteTemplate, content: ContentItem): Promise<void> {
    const next = cloneJson(template);
    const index = next.contentItems.findIndex((item) => item.id === content.id);
    if (index >= 0) next.contentItems[index] = cloneJson(content);
    else next.contentItems.push(cloneJson(content));
    await saveTemplate(next);
    notices.value = [`内容“${content.name}”已保存。`];
  }

  async function removeContentItem(template: CowriteTemplate, content: ContentItem): Promise<void> {
    const next = cloneJson(template);
    next.contentItems = next.contentItems.filter((item) => item.id !== content.id);
    await saveTemplate(next);
    notices.value = [`内容“${content.name}”已删除。`];
  }

  async function toggleTemplateStar(template: CowriteTemplate): Promise<void> {
    const ids = new Set(settings.starredTemplateIds);
    if (ids.has(template.id)) ids.delete(template.id);
    else ids.add(template.id);
    settings.starredTemplateIds = [...ids];
    template.starred = ids.has(template.id);
    if (!template.builtin) await saveTemplate(template);
    saveSettings();
  }

  async function importTemplateJson(text: string): Promise<void> {
    const template = importTemplate(JSON.parse(text), new Set(templates.value.map((item) => item.id)));
    await saveTemplate(template);
  }

  function exportTemplate(template: CowriteTemplate): void {
    downloadText(`cowrite-template-${safeName(template.name)}.json`, JSON.stringify({ schemaVersion: 1, template }, null, 2));
  }

  async function saveConnections(nextConnections: ConnectionProfile[]): Promise<void> {
    const parsed = ConnectionProfileSchema.array().parse(nextConnections);
    const remainingIds = new Set(parsed.map((item) => item.id));
    for (const profile of settings.connections) {
      if (profile.type === 'custom' && !remainingIds.has(profile.id)) {
        await secrets.delete(profile.id);
        delete sessionKeys[profile.id];
      }
    }
    settings.connections.splice(0, settings.connections.length, ...parsed);
    if (!settings.connections.some((item) => item.id === settings.defaultConnectionId)) settings.defaultConnectionId = 'st-main';
    for (const profile of settings.connections) {
      if (profile.type !== 'custom') continue;
      if (profile.rememberKey) await secrets.set(profile.id, sessionKeys[profile.id] || '');
      else await secrets.delete(profile.id);
    }
    saveSettings();
  }

  async function testConnection(profile: ConnectionProfile): Promise<string[]> {
    if (profile.type === 'st') return [];
    const key = sessionKeys[profile.id] || '';
    return await tavern.helper.getModelList({ apiurl: profile.apiUrl, key });
  }

  function addConnection(): ConnectionProfile {
    return {
      id: createId(), type: 'custom', name: '新连接', apiUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
      temperature: 0.8, maxTokens: 4096, rememberKey: false,
      streaming: false,
    };
  }

  function exportRecord(record: CowriteRecord, format: 'json' | 'markdown'): void {
    if (format === 'json') downloadText(`cowrite-record-${safeName(record.title)}.json`, JSON.stringify(record, null, 2));
    else downloadText(`cowrite-record-${safeName(record.title)}.md`, recordToMarkdown(record), 'text/markdown;charset=utf-8');
  }

  async function importRecordJson(text: string): Promise<void> {
    const input = JSON.parse(text) as unknown;
    const source = RecordSchema.parse(input);
    const record = cloneJson(source);
    if (records.value.some((item) => item.id === record.id)) {
      const previousId = record.id;
      record.id = createId();
      if (record.parentRecordId === previousId) record.parentRecordId = record.id;
    }
    record.updatedAt = new Date().toISOString();
    const result = await repository.saveRecord(record);
    records.value.unshift(record);
    selectedRecordId.value = record.id;
    if (!result.synced) unsyncedRecordIds.value.push(record.id);
    notices.value = [result.synced ? '记录已导入。' : `记录已导入浏览器草稿，但尚未同步：${result.error}`];
  }

  function exportBackup(): void {
    const backup = createBackup(settings, persistedTemplates.value, records.value);
    downloadText(`cowrite-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
  }

  async function restoreBackup(text: string): Promise<void> {
    const raw = JSON.parse(text) as unknown;
    const validated = BackupSchema.parse(raw);
    const imported = importBackup(validated, new Set(templates.value.map((item) => item.id)), new Set(records.value.map((item) => item.id)));
    for (const record of imported.records) {
      const result = await repository.saveRecord(record);
      if (!result.synced && !unsyncedRecordIds.value.includes(record.id)) unsyncedRecordIds.value.push(record.id);
    }
    Object.assign(settings, upgradeSettings(SettingsSchema.parse(validated.settings)));
    records.value = [...imported.records, ...records.value];
    templates.value = mergeTemplates([...persistedTemplates.value, ...imported.templates]);
    await persistTemplates();
    saveSettings();
    notices.value = [`已导入 ${imported.records.length} 份记录、${imported.templates.length} 个模板；重映射 ${imported.remapped} 个冲突 ID。`];
  }

  function exportRawOutput(): void {
    if (rawOutput.value) downloadText(`cowrite-invalid-output-${Date.now()}.txt`, rawOutput.value, 'text/plain;charset=utf-8');
  }

  function preview(template: CowriteTemplate): string {
    return buildPromptPreview(template, selectedRecord.value || undefined);
  }

  function resetProtocol(template: CowriteTemplate): CowriteTemplate {
    return { ...cloneJson(template), advancedProtocol: DEFAULT_PROTOCOL };
  }

  function saveUiPosition(x: number, y: number): void {
    settings.ui.x = Math.round(x);
    settings.ui.y = Math.round(y);
    saveSettings();
  }

  function saveSettings(): void {
    const context = tavern.getContext();
    context.extensionSettings.cowrite = SettingsSchema.parse(cloneJson(settings));
    context.saveSettingsDebounced();
  }

  function clearMessages(): void {
    error.value = '';
    rawOutput.value = '';
    notices.value = [];
  }

  async function run(operation: () => Promise<void>, showBusy = true): Promise<void> {
    if (busy.value) return;
    if (showBusy) {
      busy.value = true;
      stopRequested = false;
    }
    // Finish pending input saves before generating, including a change fired by clicking the button.
    operationQueue = operationQueue.then(async () => {
      clearMessages();
      try {
        if (showBusy && stopRequested) {
          notices.value = ['已停止生成，记录没有被修改。'];
          return;
        }
        await operation();
      } catch (caught) {
        error.value = errorMessage(caught);
        if (caught instanceof GenerationOutputError) rawOutput.value = caught.rawOutput;
      } finally {
        if (showBusy) busy.value = false;
      }
    });
    await operationQueue;
  }

  function applyEngineResult(result: EngineResult, select = true): void {
    const index = records.value.findIndex((item) => item.id === result.record.id);
    if (index >= 0) records.value[index] = result.record;
    else records.value.unshift(result.record);
    if (select) selectedRecordId.value = result.record.id;
    if (result.save.synced) unsyncedRecordIds.value = unsyncedRecordIds.value.filter((id) => id !== result.record.id);
    else if (!unsyncedRecordIds.value.includes(result.record.id)) unsyncedRecordIds.value.push(result.record.id);
    notices.value = result.warnings;
  }

  function loadSettings(): void {
    const saved = tavern.getContext().extensionSettings.cowrite;
    const merged = {
      ...cloneJson(DEFAULT_SETTINGS),
      ...(saved || {}),
      recordBudgetDefaultsVersion: saved?.recordBudgetDefaultsVersion ?? 0,
      ui: { ...DEFAULT_SETTINGS.ui, ...(saved?.ui || {}) },
      generationContext: { ...DEFAULT_SETTINGS.generationContext, ...(saved?.generationContext || {}) },
      globalPrompt: { ...DEFAULT_SETTINGS.globalPrompt, ...(saved?.globalPrompt || {}) },
      connections: saved?.connections || DEFAULT_SETTINGS.connections,
    };
    Object.assign(settings, upgradeSettings(SettingsSchema.parse(merged)));
  }

  async function persistTemplates(): Promise<void> {
    const result = await repository.saveTemplates(templates.value);
    if (!result.synced) notices.value = [`模板未同步到账户文件：${result.error}。已保留在浏览器缓存中。`];
  }

  function mergeTemplates(stored: CowriteTemplate[]): CowriteTemplate[] {
    const valid = stored.flatMap((item) => {
      const parsed = TemplateSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    const storedById = new Map(valid.map((item) => [item.id, item]));
    const builtinIds = new Set(BUILTIN_TEMPLATES.map((item) => item.id));
    const merged = [
      ...BUILTIN_TEMPLATES.map((item) => storedById.get(item.id) || cloneJson(item)),
      ...valid.filter((item) => !builtinIds.has(item.id)),
    ];
    return merged.filter((item) => !settings.hiddenTemplateIds.includes(item.id)).map((item) => ({
      ...upgradeBuiltinPrompts(item),
      starred: settings.starredTemplateIds.includes(item.id) || item.starred,
    }));
  }

  return {
    initialized, busy, generationProgress, open, tab, error, notices, rawOutput, records, unsyncedRecordIds, templates, selectedRecordId,
    characterId, characterName, helperVersion, settings, sessionKeys, selectedRecord, visibleRecords,
    canGenerate, persistedTemplates, initialize, refreshCharacter, start, continueRecord, stopGeneration,
    commitInput, reroll, clearAnswers, toggleRecordStar, generateMore, removeRecord, retrySync, rebindRecord, saveTemplate,
    duplicateTemplate, removeTemplate, restoreBuiltinTemplates, saveContentItem, removeContentItem, toggleTemplateStar, importTemplateJson, exportTemplate, saveConnections, testConnection,
    addConnection, exportRecord, importRecordJson, exportBackup, restoreBackup, exportRawOutput, preview, resetProtocol,
    saveUiPosition, saveSettings, clearMessages,
  };
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}

export function isHelperVersionSupported(version: string): boolean {
  return compareVersion(version, '4.9.3') >= 0;
}
