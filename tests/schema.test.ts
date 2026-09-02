import { describe, expect, it, vi } from 'vitest';
import { ActivityEngine, applyPatch } from '../src/core/engine';
import { GeneratedBlockSchema, RecordSchema, SettingsSchema, TemplateSchema } from '../src/domain/schema';
import type { RecordRepository } from '../src/adapters/repository';
import type { GenerationGateway } from '../src/adapters/generation';
import type { TavernBridge } from '../src/adapters/tavern';
import { makeRecord, makeSettings, makeTemplate } from './fixtures';
import { BUILTIN_TEMPLATES } from '../src/domain/defaults';
import { prepareTemplateForGeneration } from '../src/core/template';

describe('追加事务与所有权', () => {
  it('旧模板与旧设置会补上分类内容和全局上下文默认值', () => {
    const oldTemplate = makeRecord().templateSnapshot as Record<string, unknown>;
    delete oldTemplate.contentItems;
    delete oldTemplate.contentTitle;
    delete oldTemplate.contentGuidance;
    const template = TemplateSchema.parse(oldTemplate);
    expect(template.contentItems).toEqual([]);
    expect(template.contentGuidance).toBe('');
    const settings = SettingsSchema.parse({ schemaVersion: 1, enabled: true, defaultConnectionId: 'st-main', starredTemplateIds: [], connections: [{ id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true }], ui: { x: null, y: null, edgeTuck: true } });
    expect(settings.generationContext.recentChatCount).toBe(12);
    expect(settings.hiddenTemplateIds).toEqual([]);
  });

  it('内置格式分类各自包含可独立增删的内容项', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.name)).toEqual(['双人问卷', 'Char 给 User 的问卷', '交换日记']);
    expect(BUILTIN_TEMPLATES.every((template) => template.contentItems.length > 0)).toBe(true);
    expect(BUILTIN_TEMPLATES[0]?.contentItems.map((item) => item.name)).toContain('依恋类型');
  });

  it('开始内容项时统一应用全局上下文并分离内容与格式', () => {
    const source = makeTemplate({ context: { ...makeTemplate().context, recentChatCount: 2, worldInfoMode: 'off' } });
    const globalContext = { ...makeSettings().generationContext, recentChatCount: 30, worldInfoMode: 'both' as const };
    const prepared = prepareTemplateForGeneration(source, globalContext, { id: 'attachment', name: '依恋类型', description: '', guidance: '围绕安全感出题。' });
    expect(prepared.context.recentChatCount).toBe(30);
    expect(prepared.context.worldInfoMode).toBe('both');
    expect(prepared.contentTitle).toBe('依恋类型');
    expect(prepared.contentGuidance).toBe('围绕安全感出题。');
    expect(prepared.prompts).toEqual(source.prompts);
  });

  it('拒绝 AI 伪造已经填写的 User 文本', () => {
    expect(GeneratedBlockSchema.safeParse({ key: 'bad', kind: 'text', author: 'user', title: '', content: '我替你回答', targetIds: [] }).success).toBe(false);
  });

  it('把临时 key 映射为正式 UUID，并保留对旧卡片和本轮卡片的引用', () => {
    const old = applyPatch(makeRecord(), {
      complete: false,
      blocks: [{ key: 'q1', kind: 'input', author: 'user', title: '问题', content: '', targetIds: [], input: { type: 'short', label: '答案', placeholder: '', required: true, options: [], min: 1, max: 5, minLabel: '', maxLabel: '' } }],
    }, 'opening');
    const questionId = old.blocks[0]!.id;
    const next = applyPatch(old, {
      complete: false,
      blocks: [
        { key: 'a1', kind: 'text', author: 'char', title: '回答', content: '我的答案', targetIds: [questionId] },
        { key: 'r1', kind: 'review', author: 'char', title: '补充', content: '再说一点', targetIds: ['a1'] },
      ],
    }, 'continuation');
    expect(next.blocks.at(-2)?.targetIds).toEqual([questionId]);
    expect(next.blocks.at(-1)?.targetIds).toEqual([next.blocks.at(-2)?.id]);
    expect(next.cycles).toHaveLength(2);
  });

  it('引用不存在的卡片时整轮失败，原记录不变', () => {
    const record = makeRecord();
    expect(() => applyPatch(record, { complete: false, blocks: [{ key: 'r', kind: 'review', author: 'char', title: '', content: '评价', targetIds: ['missing'] }] }, 'opening')).toThrow('不存在');
    expect(record.blocks).toHaveLength(0);
  });

  it('拒绝同一轮重复 key，避免生成重复正式 ID', () => {
    expect(() => applyPatch(makeRecord(), { complete: false, blocks: [
      { key: 'same', kind: 'text', author: 'char', title: '', content: '一', targetIds: [] },
      { key: 'same', kind: 'text', author: 'char', title: '', content: '二', targetIds: [] },
    ] }, 'opening')).toThrow('重复');
  });

  it('撤销与重做只处理完整生成轮次', async () => {
    const generated = applyPatch(makeRecord(), { complete: false, blocks: [{ key: 'a', kind: 'text', author: 'char', title: '', content: '内容', targetIds: [] }] }, 'opening');
    const saved: unknown[] = [];
    const repository = { saveRecord: vi.fn(async (value) => { saved.push(value); return { synced: true }; }) } as unknown as RecordRepository;
    const engine = new ActivityEngine({ repository, gateway: {} as GenerationGateway, tavern: {} as TavernBridge, resolveConnection: vi.fn() });
    const undone = await engine.undo(generated);
    expect(undone.record.blocks).toHaveLength(0);
    expect(undone.record.cycles[0]?.status).toBe('undone');
    const redone = await engine.redo(undone.record);
    expect(redone.record.blocks[0]?.content).toBe('内容');
    expect(RecordSchema.safeParse(redone.record).success).toBe(true);
    expect(saved).toHaveLength(2);
  });
});
