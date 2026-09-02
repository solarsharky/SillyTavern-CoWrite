import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SillyTavern manifest 启动条件', () => {
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as Record<string, unknown>;

  it('不按第三方扩展安装文件夹名阻止入口加载', () => {
    expect(manifest.dependencies).toBeUndefined();
  });

  it('与酒馆助手 4.9.3 的最低 ST 版本保持兼容', () => {
    expect(manifest.minimum_client_version).toBe('1.12.13');
    expect(manifest.version).toBe('0.1.0-beta.7');
  });
});
