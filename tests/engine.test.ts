import { describe, expect, it, vi } from 'vitest';
import { ActivityEngine, applyPatch } from '../src/core/engine';
import type { GenerationGateway } from '../src/adapters/generation';
import type { RecordRepository } from '../src/adapters/repository';
import type { TavernBridge } from '../src/adapters/tavern';
import type { ConnectionProfile } from '../src/domain/schema';
import { makeRecord, makeTemplate } from './fixtures';

const connection: ConnectionProfile = { id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true };
const generatedPatch = { complete: false, blocks: [{ key: 'a', kind: 'text' as const, author: 'char' as const, title: '', content: '生成内容', targetIds: [] }] };

function setup(overrides: { tokens?: number; summarize?: () => Promise<string> } = {}) {
  const repository = {
    saveRecord: vi.fn(async () => ({ synced: true })),
  } as unknown as RecordRepository;
  const gateway = {
    generatePatch: vi.fn(async () => generatedPatch),
    summarize: vi.fn(overrides.summarize || (async () => '早期摘要')),
    stop: vi.fn(async () => true),
  } as unknown as GenerationGateway;
  const tavern = {
    currentCharacter: vi.fn(() => ({ id: 'char-1', name: '阿澜' })),
    loadManualLore: vi.fn(async () => ({ content: '', tokenCount: 0, missing: [] })),
    countTokens: vi.fn(async () => overrides.tokens ?? 10),
    maxContext: vi.fn(() => 32768),
  } as unknown as TavernBridge;
  const engine = new ActivityEngine({ repository, gateway, tavern, resolveConnection: () => ({ profile: connection }) });
  return { engine, repository, gateway, tavern };
}

describe('ActivityEngine 深模块', () => {
  it('首轮成功后才一次性保存完整事务', async () => {
    const { engine, repository } = setup();
    const result = await engine.start(makeTemplate());
    expect(result.record.blocks[0]?.content).toBe('生成内容');
    expect(repository.saveRecord).toHaveBeenCalledOnce();
  });

  it('必填 User 输入未完成时不调用生成', async () => {
    const record = applyPatch(makeRecord(), { complete: false, blocks: [{ key: 'q', kind: 'input', author: 'user', title: '', content: '', targetIds: [], input: { type: 'short', label: '回答', placeholder: '', required: true, options: [], min: 1, max: 5, minLabel: '', maxLabel: '' } }] }, 'opening');
    const { engine, gateway } = setup();
    await expect(engine.continue(record)).rejects.toThrow('必填');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
  });

  it('超过预算时先摘要早期轮次，再进行主生成', async () => {
    let record = makeRecord();
    for (let index = 0; index < 5; index += 1) {
      record = applyPatch(record, { complete: false, blocks: [{ key: `a${index}`, kind: 'text', author: 'char', title: '', content: `旧内容${index}`, targetIds: [] }] }, index ? 'continuation' : 'opening');
    }
    const { engine, gateway } = setup({ tokens: 20_000 });
    const result = await engine.continue(record);
    expect(gateway.summarize).toHaveBeenCalledOnce();
    expect(gateway.generatePatch).toHaveBeenCalledOnce();
    expect(result.record.rollingSummary).toBe('早期摘要');
  });

  it('摘要失败会阻止主生成和新卡片写入', async () => {
    let record = makeRecord();
    for (let index = 0; index < 5; index += 1) record = applyPatch(record, { complete: false, blocks: [{ key: `a${index}`, kind: 'text', author: 'char', title: '', content: '旧内容', targetIds: [] }] }, 'continuation');
    const { engine, gateway } = setup({ tokens: 20_000, summarize: async () => { throw new Error('摘要失败'); } });
    await expect(engine.continue(record)).rejects.toThrow('摘要失败');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
  });
});
