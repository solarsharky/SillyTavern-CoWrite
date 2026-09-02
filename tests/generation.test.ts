import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationOutputError, TavernGenerationGateway, withTimeout } from '../src/adapters/generation';
import type { TavernBridge } from '../src/adapters/tavern';
import type { ConnectionProfile } from '../src/domain/schema';
import { makeRecord, makeTemplate } from './fixtures';

const valid = JSON.stringify({ complete: false, blocks: [{ key: 'a', kind: 'text', author: 'char', title: '', content: '好', targetIds: [] }] });

function setup(responses: Array<string | Promise<string>>) {
  const generateRaw = vi.fn();
  for (const response of responses) generateRaw.mockImplementationOnce(() => Promise.resolve(response));
  const stopGenerationById = vi.fn(async () => true);
  const tavern = { helper: { generateRaw, stopGenerationById } } as unknown as TavernBridge;
  return { gateway: new TavernGenerationGateway(tavern), generateRaw, stopGenerationById };
}

function options(connection: ConnectionProfile = { id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true }) {
  return { template: makeTemplate(), record: makeRecord(), stage: 'opening' as const, connection, apiKey: connection.type === 'custom' ? 'secret' : undefined, manualLore: '' };
}

describe('生成网关', () => {
  afterEach(() => vi.useRealTimers());
  it('跟随 ST 时不发送 custom_api', async () => {
    const { gateway, generateRaw } = setup([valid]);
    await gateway.generatePatch(options());
    expect(generateRaw.mock.calls[0]?.[0].custom_api).toBeUndefined();
    expect(generateRaw.mock.calls[0]?.[0].should_stream).toBe(false);
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
    const request = gateway.generatePatch(options());
    await vi.waitFor(() => expect(generateRaw).toHaveBeenCalledOnce());
    expect(await gateway.stop()).toBe(true);
    expect(stopGenerationById).toHaveBeenCalledWith(generateRaw.mock.calls[0]?.[0].generation_id);
    resolve(valid);
    await request;
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
