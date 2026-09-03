import { describe, expect, it } from 'vitest';
import { createBackup, importBackup, recordToMarkdown } from '../src/core/backup';
import { makeRecord, makeSettings, makeTemplate } from './fixtures';
import { BackupSchema } from '../src/domain/schema';

describe('备份与导出', () => {
  it('整库备份不包含 API Key', () => {
    const settings = makeSettings({ connections: [
      { id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true, streaming: false },
      { id: 'c1', type: 'custom', name: '私有', apiUrl: 'https://example.com/v1', model: 'm', temperature: .8, maxTokens: 1000, rememberKey: true, streaming: false },
    ] });
    const output = JSON.stringify(createBackup(settings, [], []));
    expect(output).not.toMatch(/api.?key|secret/i);
  });

  it('导入时重映射模板和记录冲突 ID', () => {
    const template = makeTemplate({ id: 'custom-1', builtin: false });
    const record = makeRecord({ id: 'record-1', templateId: template.id, templateSnapshot: template });
    const backup = createBackup(makeSettings(), [template], [record]);
    const result = importBackup(backup, new Set(['custom-1']), new Set(['record-1']));
    expect(result.remapped).toBe(2);
    expect(result.templates[0]?.id).not.toBe('custom-1');
    expect(result.records[0]?.id).not.toBe('record-1');
    expect(result.records[0]?.templateId).toBe(result.templates[0]?.id);
  });

  it('Markdown 导出保留 User 答案', () => {
    const record = makeRecord({ blocks: [{ id: 'i', cycleId: 'c', kind: 'input', author: 'user', title: '', content: '', input: { type: 'multi', label: '喜欢什么', placeholder: '', required: true, options: ['海', '雨'], min: 1, max: 5, minLabel: '', maxLabel: '', value: ['海', '雨'] }, targetIds: [], createdAt: '2026-09-02T10:00:00.000Z' }] });
    expect(recordToMarkdown(record)).toContain('海、雨');
  });

  it('整库备份保留首尾 Prompt 和每个连接的流式选择', () => {
    const settings = makeSettings({ globalPrompt: { enabled: true, prefix: '开头要求', suffix: '结尾要求' } });
    settings.connections[0]!.streaming = true;
    const restored = BackupSchema.parse(JSON.parse(JSON.stringify(createBackup(settings, [], []))));
    expect(restored.settings.globalPrompt).toEqual(settings.globalPrompt);
    expect(restored.settings.connections[0]?.streaming).toBe(true);
  });
});
