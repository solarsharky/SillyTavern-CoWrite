import { describe, expect, it, vi } from 'vitest';
import { TavernBridge, compareVersion } from '../src/adapters/tavern';
import { makeTemplate } from './fixtures';

describe('酒馆助手适配', () => {
  it('正确比较最低依赖版本', () => {
    expect(compareVersion('4.9.3', '4.9.3')).toBe(0);
    expect(compareVersion('4.10.0', '4.9.3')).toBe(1);
    expect(compareVersion('4.9.2', '4.9.3')).toBe(-1);
  });

  it('手选世界书只注入仍存在且启用的条目并估算 tokens', async () => {
    const bridge = new TavernBridge();
    vi.spyOn(bridge, 'getWorldbook').mockResolvedValue([
      { uid: 1, name: '启用条目', enabled: true, content: '有效内容' },
      { uid: 2, name: '停用条目', enabled: false, content: '不能注入' },
    ]);
    vi.spyOn(bridge, 'countTokens').mockResolvedValue(3);
    const template = makeTemplate({ context: { recentChatCount: 12, worldInfoMode: 'manual', manualEntries: [
      { bookName: '设定集', uid: 1, name: '启用条目' },
      { bookName: '设定集', uid: 2, name: '停用条目' },
      { bookName: '设定集', uid: 99, name: '已删除' },
    ], manualLoreTokenBudget: 4000, recordTokenBudget: 12000 } });
    const result = await bridge.loadManualLore(template);
    expect(result.content).toContain('有效内容');
    expect(result.content).not.toContain('不能注入');
    expect(result.missing).toHaveLength(2);
    expect(result.tokenCount).toBe(3);
  });
});
