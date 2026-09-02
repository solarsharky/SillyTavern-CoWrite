import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

describe('插件入口', () => {
  it('首帧显示悬浮按钮，并在扩展设置页提供备用入口', async () => {
    document.body.innerHTML = '<div id="extensions_settings2"></div><div id="extensionsMenu"></div>';
    await import('../src/index');
    await nextTick();

    const fab = document.querySelector<HTMLElement>('.cw-fab');
    const launcher = document.querySelector<HTMLButtonElement>('#cowrite-settings-launcher button');
    expect(fab).not.toBeNull();
    expect(Number.parseFloat(getComputedStyle(fab!).top)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(getComputedStyle(fab!).top)).toBeLessThan(window.innerHeight);
    expect(launcher?.textContent).toBe('打开共笔');
    expect(document.querySelector('#cowrite-settings-launcher.inline-drawer')).not.toBeNull();
    expect(document.querySelector('#cowrite-wand-launcher')?.textContent).toBe('共笔');

    fab?.click();
    await nextTick();
    expect(document.querySelector('.cw-backdrop')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.cw-window > .cw-topbar .cw-icon-btn')?.click();
    await nextTick();
    launcher?.click();
    await nextTick();
    expect(document.querySelector('.cw-backdrop')).not.toBeNull();

    const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.cw-tabs button')]
      .find((button) => button.textContent === label);
    tab('模板库')?.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.cw-template-card').length).toBeGreaterThan(0));
    const setupButton = [...document.querySelectorAll<HTMLButtonElement>('.cw-template-card button')]
      .find((button) => button.textContent?.includes('设置并开始'));
    expect(setupButton).toBeDefined();
    setupButton!.disabled = false;
    setupButton?.click();
    await nextTick();
    expect(document.querySelector('.cw-generation-setup')?.textContent).toContain('历史聊天');
    expect(document.querySelector('.cw-generation-setup')?.textContent).toContain('世界书');
    expect(document.querySelector('.cw-generation-setup')?.textContent).toContain('生成结果仍只写入共笔');
    document.querySelector<HTMLButtonElement>('.cw-generation-setup .cw-icon-btn')?.click();
    await nextTick();
    const newTemplate = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('新模板'));
    newTemplate?.click();
    await nextTick();
    expect(document.querySelector('.cw-editor')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.cw-editor .cw-icon-btn')?.click();
    await nextTick();

    tab('设置')?.click();
    await nextTick();
    expect(document.querySelector('.cw-settings')?.textContent).toContain('生成连接');
    expect(document.querySelector('.cw-settings')?.textContent).toContain('从不新增或修改聊天楼层');
  });
});
