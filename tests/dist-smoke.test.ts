import { describe, expect, it } from 'vitest';
import source from '../dist/index.js?raw';

describe('发布产物启动', () => {
  it('直接执行 dist/index.js 后挂载可见入口', async () => {
    document.body.innerHTML = '<div id="extensions_settings2"></div>';

    expect(source).not.toMatch(/\bprocess\.env\b/);
    window.eval(source);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(document.querySelector('#cowrite-extension-root')).not.toBeNull();
    expect(document.querySelector('.cw-fab')).not.toBeNull();
    expect(document.querySelector('#cowrite-settings-launcher button')?.textContent).toBe('打开共笔');
  });
});
