import { describe, expect, it } from 'vitest';
import { buildStagePrompt, expandPrompt, serializeRecordForModel } from '../src/core/prompt';
import { applyPatch } from '../src/core/engine';
import { makeRecord, makeTemplate } from './fixtures';

describe('上下文与提示词', () => {
  it('展开角色、用户、轮次和标题变量', () => {
    const record = makeRecord();
    expect(expandPrompt('{{char}}/{{user}}/{{round}}/{{record_title}}', record)).toBe('阿澜/小鱼/1/一起回答的问题');
  });

  it('把记录放进明确的数据边界', () => {
    const prompt = buildStagePrompt(makeTemplate(), makeRecord(), 'opening');
    expect(prompt).toContain('<record_data>');
    expect(prompt).toContain('不要替');
    expect(prompt).toContain('阿澜');
  });

  it('有滚动摘要后仅发送最近轮次和待处理输入', () => {
    let record = makeRecord();
    for (let index = 0; index < 5; index += 1) {
      record = applyPatch(record, { complete: false, blocks: [{ key: `b${index}`, kind: 'text', author: 'char', title: '', content: `轮次-${index}`, targetIds: [] }] }, index ? 'continuation' : 'opening', `2026-09-02T10:0${index}:00.000Z`);
    }
    record.rollingSummary = '前情摘要';
    record.summaryThroughCycle = record.cycles[1]!.id;
    const data = serializeRecordForModel(record);
    expect(data).not.toContain('轮次-0');
    expect(data).not.toContain('轮次-1');
    expect(data).toContain('轮次-2');
    expect(data).toContain('前情摘要');
  });
});
