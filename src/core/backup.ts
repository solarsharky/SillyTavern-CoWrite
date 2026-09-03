import {
  BackupSchema,
  RecordSchema,
  SCHEMA_VERSION,
  TemplateSchema,
  type CowriteBackup,
  type CowriteRecord,
  type CowriteSettings,
  type CowriteTemplate,
} from '../domain/schema';
import { cloneJson } from './clone';
import { createId } from './id';

export interface ImportResult {
  templates: CowriteTemplate[];
  records: CowriteRecord[];
  remapped: number;
}

export function createBackup(settings: CowriteSettings, templates: CowriteTemplate[], records: CowriteRecord[]): CowriteBackup {
  return BackupSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    templates,
    records,
  });
}

export function importBackup(input: unknown, knownTemplateIds = new Set<string>(), knownRecordIds = new Set<string>()): ImportResult {
  const backup = BackupSchema.parse(migrateBackup(input));
  const templateIdMap = new Map<string, string>();
  const recordIdMap = new Map<string, string>();
  let remapped = 0;

  const templates = backup.templates.map((source) => {
    const template = cloneJson(source);
    if (knownTemplateIds.has(template.id) || templateIdMap.has(template.id)) {
      const nextId = createId();
      templateIdMap.set(template.id, nextId);
      template.id = nextId;
      template.builtin = false;
      remapped += 1;
    }
    knownTemplateIds.add(template.id);
    return TemplateSchema.parse(template);
  });

  const records = backup.records.map((source) => {
    const record = cloneJson(source);
    const oldId = record.id;
    if (knownRecordIds.has(oldId) || recordIdMap.has(oldId)) {
      const nextId = createId();
      recordIdMap.set(oldId, nextId);
      record.id = nextId;
      remapped += 1;
    }
    knownRecordIds.add(record.id);
    record.templateId = templateIdMap.get(record.templateId) || record.templateId;
    record.templateSnapshot.id = record.templateId;
    return RecordSchema.parse(record);
  });

  for (const record of records) {
    if (record.parentRecordId) record.parentRecordId = recordIdMap.get(record.parentRecordId) || record.parentRecordId;
  }
  return { templates, records, remapped };
}

export function importTemplate(input: unknown, existingIds: Set<string>): CowriteTemplate {
  const candidate = isObject(input) && 'template' in input ? input.template : input;
  const template = TemplateSchema.parse(candidate);
  const next = cloneJson(template);
  if (existingIds.has(next.id) || next.builtin) next.id = createId();
  next.builtin = false;
  next.updatedAt = new Date().toISOString();
  return TemplateSchema.parse(next);
}

export function recordToMarkdown(record: CowriteRecord): string {
  const lines = [`# ${record.title}`, '', `- 角色：${record.characterName}`, `- 模板：${record.templateSnapshot.name}`, `- 状态：${statusLabel(record.status)}`, ''];
  for (const block of record.blocks) {
    if (block.kind === 'divider') {
      lines.push('---', '');
      continue;
    }
    const heading = block.title || block.input?.label || authorLabel(block.author);
    lines.push(`## ${heading}`, '');
    if (block.content) lines.push(block.content, '');
    if ((block.kind === 'input' || block.kind === 'answer') && block.input) {
      const value = block.input.value;
      lines.push(`**${block.kind === 'answer' ? record.characterName : 'User'}：** ${Array.isArray(value) ? value.join('、') : value ?? '（未填写）'}`, '');
    }
    if (block.targetIds.length) lines.push(`> 关联卡片：${block.targetIds.join(', ')}`, '');
  }
  return lines.join('\n');
}

export function downloadText(fileName: string, content: string, type = 'application/json;charset=utf-8'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function migrateBackup(input: unknown): unknown {
  if (!isObject(input)) throw new Error('备份不是有效的 JSON 对象。');
  const version = Number(input.schemaVersion || 0);
  if (version > SCHEMA_VERSION) throw new Error(`备份版本 ${version} 高于当前支持的 ${SCHEMA_VERSION}。`);
  if (version === SCHEMA_VERSION) return input;
  throw new Error(`暂不支持 schemaVersion ${version} 的备份。`);
}

function isObject(input: unknown): input is Record<string, any> {
  return Boolean(input && typeof input === 'object' && !Array.isArray(input));
}

function authorLabel(author: string): string {
  return author === 'char' ? 'Char' : author === 'user' ? 'User' : '共笔';
}

function statusLabel(status: CowriteRecord['status']): string {
  return status === 'active' ? '进行中' : status === 'completed' ? '已完成' : '已归档';
}
