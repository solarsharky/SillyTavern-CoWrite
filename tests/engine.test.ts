import { describe, expect, it, vi } from 'vitest';
import { ActivityEngine, applyPatch } from '../src/core/engine';
import type { GenerationGateway } from '../src/adapters/generation';
import type { RecordRepository } from '../src/adapters/repository';
import type { TavernBridge } from '../src/adapters/tavern';
import type { ConnectionProfile, GlobalPrompt } from '../src/domain/schema';
import { makeQuestionPatch, makeRecord, makeTemplate } from './fixtures';

const connection: ConnectionProfile = { id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true, streaming: false };
const generatedPatch = { complete: false, blocks: [{ key: 'a', kind: 'text' as const, author: 'char' as const, title: '', content: '生成内容', targetIds: [] }] };

function setup(overrides: { tokens?: number; summarize?: () => Promise<string>; getGlobalPrompt?: () => GlobalPrompt } = {}) {
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
  const engine = new ActivityEngine({ repository, gateway, tavern, resolveConnection: () => ({ profile: connection }), getGlobalPrompt: overrides.getGlobalPrompt });
  return { engine, repository, gateway, tavern };
}

describe('ActivityEngine 深模块', () => {
  it('首轮成功后才一次性保存完整事务', async () => {
    const { engine, repository } = setup();
    const result = await engine.start(makeTemplate({ contentTitle: '依恋类型', contentGuidance: '围绕安全感出题。' }));
    expect(result.record.blocks[0]?.content).toBe('生成内容');
    expect(result.record.title).toContain('依恋类型');
    expect(result.record.templateSnapshot.contentGuidance).toBe('围绕安全感出题。');
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
    const { engine, gateway, repository } = setup({ tokens: 20_000, summarize: async () => { throw new Error('摘要失败'); } });
    await expect(engine.continue(record)).rejects.toThrow('摘要失败');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('同一次生成的摘要和主请求使用一致的全局 Prompt，下一次请求读取最新设置', async () => {
    let record = makeRecord();
    for (let index = 0; index < 5; index += 1) record = applyPatch(record, generatedPatch, index ? 'continuation' : 'opening');
    const globalPrompt = { enabled: true, prefix: '前置', suffix: '后置' };
    const { engine, gateway } = setup({
      tokens: 20_000,
      getGlobalPrompt: () => globalPrompt,
      summarize: async () => { globalPrompt.suffix = '之后使用的新后置'; return '摘要'; },
    });
    const result = await engine.continue(record);
    expect(vi.mocked(gateway.summarize).mock.calls[0]?.[0].globalPrompt?.suffix).toBe('后置');
    expect(vi.mocked(gateway.generatePatch).mock.calls[0]?.[0].globalPrompt?.suffix).toBe('后置');
    await engine.continue(result.record);
    expect(vi.mocked(gateway.generatePatch).mock.calls[1]?.[0].globalPrompt?.suffix).toBe('之后使用的新后置');
    expect(result.record.templateSnapshot).not.toHaveProperty('globalPrompt');
  });

  it('读取世界书期间停止也会取消整轮且不保存', async () => {
    let finishLore!: () => void;
    const lorePending = new Promise<void>((resolve) => { finishLore = resolve; });
    const { engine, repository, gateway, tavern } = setup();
    vi.mocked(tavern.loadManualLore).mockImplementationOnce(async () => {
      await lorePending;
      return { content: '', tokenCount: 0, missing: [] };
    });
    const request = engine.start(makeTemplate()).catch((error) => error as Error);
    await vi.waitFor(() => expect(tavern.loadManualLore).toHaveBeenCalledOnce());
    expect(await engine.stop()).toBe(true);
    finishLore();
    const result = await request as Error;
    expect(result.message).toContain('已停止本轮生成');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });

  it('重roll重新请求最近一轮，保留之前的手填答案且只保存最终结果', async () => {
    const opening = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    opening.blocks[0]!.input!.value = '我想读书';
    const record = applyPatch(opening, { ...generatedPatch, complete: true, summaryUpdate: '即将被替换的旧答案' }, 'continuation');
    const original = structuredClone(record);
    const { engine, gateway, repository } = setup();
    const result = await engine.reroll(record);
    const request = vi.mocked(gateway.generatePatch).mock.calls[0]![0];
    expect(request.stage).toBe('continuation');
    expect(request.record.blocks).toEqual(opening.blocks);
    expect(request.record.rollingSummary).not.toContain('即将被替换');
    expect(result.record.blocks[0]?.input?.value).toBe('我想读书');
    expect(result.record.cycles).toHaveLength(2);
    expect(result.record.cycles.at(-1)?.id).not.toBe(record.cycles.at(-1)?.id);
    expect(repository.saveRecord).toHaveBeenCalledOnce();
    expect(record).toEqual(original);
  });

  it('首轮重roll不受当前空白必填题阻止，追加题重roll仍然走追加流程', async () => {
    const { engine, gateway } = setup();
    const opening = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    await engine.reroll(opening);
    expect(vi.mocked(gateway.generatePatch).mock.calls[0]![0].stage).toBe('opening');
    expect(vi.mocked(gateway.generatePatch).mock.calls[0]![0].record.blocks).toEqual([]);
    const more = applyPatch(opening, makeQuestionPatch(), 'more');
    await engine.reroll(more);
    expect(vi.mocked(gateway.generatePatch).mock.calls[1]![0].stage).toBe('more');
    expect(vi.mocked(gateway.generatePatch).mock.calls[1]![0].record.blocks).toEqual(opening.blocks);
  });

  it('重roll失败时不会先清空或保存旧内容', async () => {
    const record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    const original = structuredClone(record);
    const { engine, gateway, repository } = setup();
    vi.mocked(gateway.generatePatch).mockRejectedValueOnce(new Error('连接失败'));
    await expect(engine.reroll(record)).rejects.toThrow('连接失败');
    expect(repository.saveRecord).not.toHaveBeenCalled();
    expect(record).toEqual(original);
  });

  it('重roll停止后丢弃迟到响应并保留原题和答案', async () => {
    const record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    const original = structuredClone(record);
    const { engine, gateway, repository } = setup();
    let finish!: (patch: typeof generatedPatch) => void;
    vi.mocked(gateway.generatePatch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const request = engine.reroll(record).catch((error) => error as Error);
    await vi.waitFor(() => expect(gateway.generatePatch).toHaveBeenCalledOnce());
    await engine.stop();
    finish(generatedPatch);
    expect(await request).toMatchObject({ name: 'GenerationStoppedError' });
    expect(repository.saveRecord).not.toHaveBeenCalled();
    expect(record).toEqual(original);
  });

  it('清空重填保留所有批次原题和随题的角色答案，清除手填、后续回应及残留摘要', async () => {
    let record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    record.blocks[0]!.input!.value = '旧的手填';
    record = applyPatch(record, { ...generatedPatch, summaryUpdate: '旧的手填摘要' }, 'continuation');
    record = applyPatch(record, makeQuestionPatch('multi', ['散步']), 'more');
    const latestQuestion = record.blocks.find((block) => block.kind === 'input' && block.cycleId === record.cycles.at(-1)?.id)!;
    latestQuestion.input!.value = ['读书'];
    record.status = 'completed';
    const { engine, gateway } = setup();
    const result = await engine.clearAnswers(record);
    expect(result.record.blocks.filter((block) => block.kind === 'input').map((block) => block.input?.value)).toEqual([null, null]);
    expect(result.record.blocks.filter((block) => block.kind === 'answer').map((block) => block.input?.value)).toEqual(['一起散步', ['散步']]);
    expect(result.record.blocks).toHaveLength(4);
    expect(result.record.cycles.map((cycle) => cycle.stage)).toEqual(['opening', 'more']);
    expect(JSON.stringify(result.record)).not.toContain('旧的手填');
    expect(result.record.status).toBe('active');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
  });

  it.each(['completed', 'archived'] as const)('%s 旧记录可直接交给他写，并可在原记录追加新题', async (status) => {
    const record = applyPatch(makeRecord(), generatedPatch, 'opening');
    record.status = status;
    const { engine, gateway } = setup();
    await engine.continue(record);
    expect(vi.mocked(gateway.generatePatch).mock.calls[0]![0].record.status).toBe('active');
    vi.mocked(gateway.generatePatch).mockResolvedValueOnce({ ...makeQuestionPatch(), complete: true, title: '不应替换原标题' });
    const more = await engine.generateMore(record);
    expect(more.record.id).toBe(record.id);
    expect(more.record.title).toBe(record.title);
    expect(more.record.blocks.slice(0, record.blocks.length)).toEqual(record.blocks);
    expect(more.record.status).toBe('active');
    expect(more.record.cycles.at(-1)?.stage).toBe('more');
  });

  it('切换到其他角色或没有单角色聊天时，不能生成、重roll或清空旧记录', async () => {
    const { engine, tavern, gateway, repository } = setup();
    vi.mocked(tavern.currentCharacter).mockReturnValue(null);
    const record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    await expect(engine.continue(record)).rejects.toThrow('请切换回角色');
    await expect(engine.reroll(record)).rejects.toThrow('请切换回角色');
    await expect(engine.generateMore(record)).rejects.toThrow('请切换回角色');
    await expect(engine.clearAnswers(record)).rejects.toThrow('请切换回角色');
    expect(gateway.generatePatch).not.toHaveBeenCalled();
    expect(repository.saveRecord).not.toHaveBeenCalled();
  });
});
