import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

describe('插件入口', () => {
  it('首帧显示悬浮按钮，并在扩展设置页提供备用入口', async () => {
    document.body.innerHTML = '<div id="extensions_settings2"></div>';
    await import('../src/index');
    await nextTick();

    const fab = document.querySelector<HTMLElement>('.cw-fab');
    const launcher = document.querySelector<HTMLButtonElement>('#cowrite-settings-launcher button');
    expect(fab).not.toBeNull();
    expect(Number.parseFloat(getComputedStyle(fab!).top)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(getComputedStyle(fab!).top)).toBeLessThan(window.innerHeight);
    expect(launcher?.textContent).toBe('打开共笔');

    launcher?.click();
    await nextTick();
    expect(document.querySelector('.cw-backdrop')).not.toBeNull();
  });
});
