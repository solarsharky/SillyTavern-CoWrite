import { BUILTIN_TEMPLATES, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { SCHEMA_VERSION, type CowriteRecord, type CowriteSettings, type CowriteTemplate } from '../src/domain/schema';

export function makeTemplate(overrides: Partial<CowriteTemplate> = {}): CowriteTemplate {
  return { ...structuredClone(BUILTIN_TEMPLATES[0]!), ...overrides };
}

export function makeRecord(overrides: Partial<CowriteRecord> = {}): CowriteRecord {
  const date = '2026-09-02T10:00:00.000Z';
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'record-1',
    title: '一起回答的问题',
    templateId: 'builtin-shared-questionnaire',
    templateSnapshot: makeTemplate(),
    characterId: 'char-1',
    characterName: '阿澜',
    status: 'active',
    starred: false,
    blocks: [],
    cycles: [],
    rollingSummary: '',
    summaryThroughCycle: '',
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<CowriteSettings> = {}): CowriteSettings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}
