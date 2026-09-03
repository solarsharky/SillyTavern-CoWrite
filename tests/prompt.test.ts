import { describe, expect, it } from 'vitest';
import { buildStagePrompt, expandPrompt, serializeRecordForModel, withGlobalPrompts } from '../src/core/prompt';
import { applyPatch } from '../src/core/engine';
import { makeRecord, makeTemplate } from './fixtures';

describe('上下文与提示词', () => {
  it('展开角色、用户、轮次和标题变量', () => {
    const record = makeRecord();
    expect(expandPrompt('{{char}}/{{user}}/{{round}}/{{record_title}}', record)).toBe('阿澜/小鱼/1/一起回答的问题');
  });

  it('首尾 Prompt 同时包住全部消息，禁用或留空时不改变原顺序', () => {
    const prompts: CowriteOrderedPrompt[] = [{ role: 'system', content: '协议' }, 'char_description', 'user_input'];
    const global = { enabled: true, prefix: '开头 {{char}}', suffix: '结尾 {{user}}' };
    const wrapped = withGlobalPrompts(prompts, global, makeRecord());
    expect(wrapped).toEqual([{ role: 'system', content: '开头 阿澜' }, ...prompts, { role: 'system', content: '结尾 小鱼' }]);
    expect(prompts).toHaveLength(3);
    expect(withGlobalPrompts(prompts, { ...global, enabled: false }, makeRecord())).toEqual(prompts);
    expect(withGlobalPrompts(prompts, { enabled: true, prefix: ' \n ', suffix: '' }, makeRecord())).toEqual(prompts);
    expect(withGlobalPrompts(prompts, { ...global, prefix: '' }, makeRecord())).toEqual([...prompts, { role: 'system', content: '结尾 小鱼' }]);
  });

  it('把记录放进明确的数据边界', () => {
    const prompt = buildStagePrompt(makeTemplate(), makeRecord(), 'opening');
    expect(prompt).toContain('<record_data>');
    expect(prompt).toContain('不要替');
    expect(prompt).toContain('阿澜');
  });

  it('把内容项要求与格式流程分区发送', () => {
    const template = makeTemplate({ contentTitle: '依恋类型', contentGuidance: '必须包含安全感相关题目。' });
    const prompt = buildStagePrompt(template, makeRecord({ templateSnapshot: template }), 'opening');
    expect(prompt).toContain('本轮流程');
    expect(prompt).toContain('本轮内容要求（只决定主题和内容，不得改变输出格式）');
    expect(prompt).toContain('必须包含安全感相关题目。');
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

  it('双人问卷首轮同时生成双方同题型答案，继续时逐题关联评价', () => {
    const template = makeTemplate();
    const opening = buildStagePrompt(template, makeRecord(), 'opening');
    expect(opening).toContain('10 对');
    expect(opening).toContain('kind=answer');
    expect(opening).toContain('User 的输入必须保持空白');
    const continuation = buildStagePrompt(template, makeRecord(), 'continuation');
    expect(continuation).toContain('每道已回答的 User input');
    expect(continuation).toContain('targetIds 只填这道 User input 的 id');
    const more = buildStagePrompt(template, makeRecord(), 'more');
    expect(more).toContain('追加一组新题');
    expect(more).toContain('10 对');
    expect(more).not.toContain('本轮流程：\nUser 点击');
  });
});
