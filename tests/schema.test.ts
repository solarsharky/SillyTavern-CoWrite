import { describe, expect, it, vi } from 'vitest';
import { ActivityEngine, applyPatch } from '../src/core/engine';
import { GeneratedBlockSchema, RecordSchema } from '../src/domain/schema';
import type { RecordRepository } from '../src/adapters/repository';
import type { GenerationGateway } from '../src/adapters/generation';
import type { TavernBridge } from '../src/adapters/tavern';
import { makeRecord } from './fixtures';

describe('追加事务与所有权', () => {
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
