import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../src/core/id';

describe('浏览器兼容 UUID', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('原生 randomUUID 可用时保留其调用上下文', () => {
    const nativeId = globalThis.crypto.randomUUID();
    const browserCrypto = {
      randomUUID: vi.fn(function (this: unknown) {
        expect(this).toBe(browserCrypto);
        return nativeId;
      }),
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal('crypto', browserCrypto);
    expect(createId()).toBe(nativeId);
    expect(browserCrypto.getRandomValues).not.toHaveBeenCalled();
  });

  it('HTTP 环境使用随机字节生成标准 v4 UUID，且不修改宿主接口', () => {
    const browserCrypto = { getRandomValues: vi.fn((bytes: Uint8Array) => bytes.fill(255)) };
    vi.stubGlobal('crypto', browserCrypto);
    expect(createId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(browserCrypto.getRandomValues).toHaveBeenCalledOnce();
    expect(browserCrypto).not.toHaveProperty('randomUUID');
  });
});
