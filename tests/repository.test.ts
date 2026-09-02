import { afterEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import { AccountFileRepository } from '../src/adapters/repository';
import { makeRecord } from './fixtures';

describe('账户文件与离线草稿', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await localforage.dropInstance({ name: 'cowrite' });
  });

  it('服务器保存失败时标记未同步，并可从本地草稿恢复', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const repository = new AccountFileRepository();
    const result = await repository.saveRecord(makeRecord());
    expect(result.synced).toBe(false);
    expect(result.error).toContain('503');
    const restored = await new AccountFileRepository().loadRecords();
    expect(restored[0]?.id).toBe('record-1');
  });
});
