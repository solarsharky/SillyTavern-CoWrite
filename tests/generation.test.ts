import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationOutputError, GenerationStoppedError, parseGenerationPatch, TavernGenerationGateway, withTimeout } from '../src/adapters/generation';
import type { TavernBridge } from '../src/adapters/tavern';
import type { ConnectionProfile } from '../src/domain/schema';
import { makeQuestionPatch, makeRecord, makeTemplate } from './fixtures';

const valid = JSON.stringify({ complete: false, blocks: [{ key: 'a', kind: 'text', author: 'char', title: '', content: '好', targetIds: [] }] });

function setup(responses: Array<string | Promise<string>>) {
  const generateRaw = vi.fn();
  for (const response of responses) generateRaw.mockImplementationOnce(() => Promise.resolve(response));
  const stopGenerationById = vi.fn(async () => true);
  const tavern = { helper: { generateRaw, stopGenerationById } } as unknown as TavernBridge;
  return { gateway: new TavernGenerationGateway(tavern), generateRaw, stopGenerationById };
}

function options(connection: ConnectionProfile = { id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true }) {
  return { template: makeTemplate({ id: 'test-format' }), record: makeRecord(), stage: 'opening' as const, connection, apiKey: connection.type === 'custom' ? 'secret' : undefined, manualLore: '' };
}

describe('生成网关', () => {
  afterEach(() => vi.useRealTimers());
  it('跟随 ST 时不发送 custom_api', async () => {
    const { gateway, generateRaw } = setup([valid]);
    await gateway.generatePatch(options());
    expect(generateRaw.mock.calls[0]?.[0].custom_api).toBeUndefined();
    expect(generateRaw.mock.calls[0]?.[0].should_stream).toBe(false);
    expect(generateRaw.mock.calls[0]?.[0].should_silence).toBe(true);
    expect(generateRaw.mock.calls[0]?.[0].max_chat_history).toBe(12);
    expect(generateRaw.mock.calls[0]?.[0].ordered_prompts).toEqual(expect.arrayContaining(['world_info_before', 'world_info_after', 'chat_history']));
  });

  it('关闭历史聊天和世界书时不会加入对应提示词位置', async () => {
    const { gateway, generateRaw } = setup([valid]);
    const template = makeTemplate({ id: 'test-format', context: { ...makeTemplate().context, recentChatCount: 0, worldInfoMode: 'off' } });
    await gateway.generatePatch({ ...options(), template });
    const config = generateRaw.mock.calls[0]?.[0];
    expect(config.max_chat_history).toBe(0);
    expect(config.ordered_prompts).not.toContain('chat_history');
    expect(config.ordered_prompts).not.toContain('world_info_before');
    expect(config.ordered_prompts).not.toContain('world_info_after');
  });

  it('手选世界书内容作为独立系统数据注入且不启用当前世界书位置', async () => {
    const { gateway, generateRaw } = setup([valid]);
    const template = makeTemplate({ id: 'test-format', context: { ...makeTemplate().context, worldInfoMode: 'manual' } });
    await gateway.generatePatch({ ...options(), template, manualLore: '<lore_data>条目内容</lore_data>' });
    const prompts = generateRaw.mock.calls[0]?.[0].ordered_prompts;
    expect(prompts).toContainEqual(expect.objectContaining({ role: 'system', content: expect.stringContaining('条目内容') }));
    expect(prompts).not.toContain('world_info_before');
    expect(prompts).not.toContain('world_info_after');
  });

  it('独立连接仅在请求时带上密钥与参数', async () => {
    const { gateway, generateRaw } = setup([valid]);
    const custom: ConnectionProfile = { id: 'c1', type: 'custom', name: '私有', apiUrl: 'https://example.com/v1', model: 'm', temperature: .4, maxTokens: 1000, rememberKey: false };
    await gateway.generatePatch(options(custom));
    expect(generateRaw.mock.calls[0]?.[0].custom_api).toMatchObject({ apiurl: custom.apiUrl, key: 'secret', model: 'm' });
  });

  it('无效 JSON 自动修复一次', async () => {
    const { gateway, generateRaw } = setup(['not-json', valid]);
    const patch = await gateway.generatePatch(options());
    expect(patch.blocks[0]?.content).toBe('好');
    expect(generateRaw).toHaveBeenCalledTimes(2);
  });

  it('修复仍失败时保留原始响应且不返回 patch', async () => {
    const { gateway } = setup(['original-bad', 'repair-bad']);
    const error = await gateway.generatePatch(options()).catch((value) => value);
    expect(error).toBeInstanceOf(GenerationOutputError);
    expect(error.rawOutput).toBe('original-bad');
  });

  it('可按本轮 generation id 停止', async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const { gateway, generateRaw, stopGenerationById } = setup([pending]);
    const request = gateway.generatePatch(options()).catch((error) => error as Error);
    await vi.waitFor(() => expect(generateRaw).toHaveBeenCalledOnce());
    expect(await gateway.stop()).toBe(true);
    expect(stopGenerationById).toHaveBeenCalledWith(generateRaw.mock.calls[0]?.[0].generation_id);
    resolve(valid);
    const result = await request as Error;
    expect(result).toBeInstanceOf(GenerationStoppedError);
    expect(result.message).toContain('后续响应已丢弃');
  });

  it('兼容实际返回的顶层数组、value 字段与未转义中文引号', () => {
    const raw = [
      '```json',
      '[',
      '{"key":"intro","kind":"text","author":"char","value":"来做一份问卷吧。"},',
      '{"key":"q1","kind":"input","author":"user","title":"最想听我说什么？","value":"","input":{"type":"multi","label":"请填写","options":["晚安","主动说"我想你了""]}},',
      '{"key":"q2","kind":"input","author":"user","value":"","input":{"type":"scale","label":"给"我的撒娇水平"打几分？","min":1,"max":10}}',
      ']',
      '```',
    ].join('\n');
    const patch = parseGenerationPatch(raw);
    expect(patch.complete).toBe(false);
    expect(patch.blocks[0]?.content).toBe('来做一份问卷吧。');
    expect(patch.blocks[1]?.input?.label).toBe('最想听我说什么？');
    expect(patch.blocks[1]?.input?.options).toContain('主动说"我想你了"');
    expect(patch.blocks[2]?.input?.label).toBe('给"我的撒娇水平"打几分？');
  });

  it('没有任何可见题干的输入卡会被拒绝并进入修复流程', () => {
    const raw = JSON.stringify({ blocks: [{ key: 'q', kind: 'input', author: 'user', title: '', content: '', targetIds: [], input: { type: 'short', label: '请填写' } }], complete: false });
    expect(() => parseGenerationPatch(raw)).toThrow('完整、可见的题干');
  });

  it('双人首轮漏掉 Char 答案时自动修复为同题配对答案', async () => {
    const pair = makeQuestionPatch('multi', ['散步', '读书']);
    const { gateway, generateRaw } = setup([
      JSON.stringify({ complete: false, blocks: [pair.blocks[0]] }),
      JSON.stringify(pair),
    ]);
    const patch = await gateway.generatePatch({ ...options(), template: makeTemplate() });
    expect(generateRaw).toHaveBeenCalledTimes(2);
    expect(patch.blocks[1]?.answer).toEqual(['散步', '读书']);
    expect(patch.blocks[0]?.input).not.toHaveProperty('value');
  });

  it('双人首轮修复后仍无 Char 答案则不接受半份问卷', async () => {
    const { gateway } = setup([valid, valid]);
    await expect(gateway.generatePatch({ ...options(), template: makeTemplate() })).rejects.toBeInstanceOf(GenerationOutputError);
  });

  it('超时会停止请求并返回不写入提示', async () => {
    vi.useFakeTimers();
    const stop = vi.fn(async () => true);
    const result = withTimeout(new Promise<string>(() => undefined), 100, stop).catch((error) => error as Error);
    await vi.advanceTimersByTimeAsync(100);
    const outcome = await result;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain('已停止且未写入');
    expect(stop).toHaveBeenCalledOnce();
  });
});
