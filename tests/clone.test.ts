import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { cloneJson } from '../src/core/clone';

describe('JSON 数据克隆', () => {
  it('可以克隆 Vue 响应式 Proxy，并返回与源数据分离的普通对象', () => {
    const source = reactive({ title: '问卷', context: { recentChatCount: 12 }, items: ['A'] });
    const cloned = cloneJson(source);

    expect(cloned).toEqual({ title: '问卷', context: { recentChatCount: 12 }, items: ['A'] });
    cloned.context.recentChatCount = 3;
    cloned.items.push('B');
    expect(source.context.recentChatCount).toBe(12);
    expect(source.items).toEqual(['A']);
  });
});
