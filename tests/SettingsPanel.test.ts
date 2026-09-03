import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import SettingsPanel from '../src/components/SettingsPanel.vue';
import { useCowriteStore } from '../src/stores/app';
import { AccountFileRepository } from '../src/adapters/repository';
import { TavernBridge } from '../src/adapters/tavern';
import { makeSettings } from './fixtures';

describe('API 与全局 Prompt 设置', () => {
  afterEach(() => vi.restoreAllMocks());

  it('保存首尾 Prompt、API 输出模式和超过旧上限的预算，重新初始化后仍然保留', async () => {
    const context = window.SillyTavern!.getContext();
    vi.spyOn(window.SillyTavern!, 'getContext').mockReturnValue(context);
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useCowriteStore();
    store.settings.connections.push({ id: 'custom-1', name: '测试连接', type: 'custom', apiUrl: 'https://example.com/v1', model: 'test', temperature: .8, maxTokens: 4096, rememberKey: false, streaming: false });
    const wrapper = mount(SettingsPanel, { global: { plugins: [pinia] } });
    const promptInputs = wrapper.findAll('.cw-global-prompt textarea');
    expect(promptInputs).toHaveLength(2);
    await promptInputs[0]!.setValue('独立的开头要求');
    await promptInputs[1]!.setValue('独立的结尾要求');
    await wrapper.find('.cw-global-prompt button').trigger('click');
    expect(context.extensionSettings.cowrite.globalPrompt).toEqual({ enabled: true, prefix: '独立的开头要求', suffix: '独立的结尾要求' });
    const modes = wrapper.findAll('.cw-connection-mode select');
    expect(modes).toHaveLength(2);
    await modes[0]!.setValue('true');
    await modes[1]!.setValue('false');
    await wrapper.findAll('button').find((button) => button.text() === '保存设置')!.trigger('click');
    await vi.waitFor(() => expect(context.extensionSettings.cowrite.connections[0].streaming).toBe(true));
    expect(context.extensionSettings.cowrite.connections[1].streaming).toBe(false);
    const budget = wrapper.findAll('label').find((label) => label.text().includes('自动压缩阈值'))!.find('input');
    expect(budget.element.value).toBe('120000');
    expect(budget.attributes('max')).toBe('1000000');
    await budget.setValue(1_000_000);
    await wrapper.findAll('button').find((button) => button.text() === '保存上下文设置')!.trigger('click');
    expect(context.extensionSettings.cowrite.generationContext.recordTokenBudget).toBe(1_000_000);
    wrapper.unmount();

    vi.spyOn(TavernBridge.prototype, 'assertCompatible').mockImplementation(() => {});
    vi.spyOn(TavernBridge.prototype, 'helper', 'get').mockReturnValue({ getTavernHelperVersion: () => '4.9.3' } as TavernHelperInterface);
    vi.spyOn(AccountFileRepository.prototype, 'loadTemplates').mockResolvedValue([]);
    vi.spyOn(AccountFileRepository.prototype, 'loadRecords').mockResolvedValue([]);
    vi.spyOn(AccountFileRepository.prototype, 'pendingRecordIds').mockResolvedValue([]);
    const reloaded = useCowriteStore(createPinia());
    await reloaded.initialize();
    expect(reloaded.settings.globalPrompt).toEqual({ enabled: true, prefix: '独立的开头要求', suffix: '独立的结尾要求' });
    expect(reloaded.settings.connections.map((profile) => profile.streaming)).toEqual([true, false]);
    expect(reloaded.settings.generationContext.recordTokenBudget).toBe(1_000_000);
  });

  it.each([
    { savedBudget: undefined, expected: 120_000, migrated: false },
    { savedBudget: 12_000, expected: 120_000, migrated: false },
    { savedBudget: 240_000, expected: 240_000, migrated: false },
    { savedBudget: 12_000, expected: 12_000, migrated: true },
  ])('加载预算 $savedBudget（已升级=$migrated）后为 $expected，保存重载保持不变', async ({ savedBudget, expected, migrated }) => {
    const context = window.SillyTavern!.getContext();
    const saved: Record<string, unknown> = makeSettings();
    delete saved.recordBudgetDefaultsVersion;
    if (migrated) saved.recordBudgetDefaultsVersion = 1;
    saved.generationContext = { ...makeSettings().generationContext, recordTokenBudget: savedBudget };
    context.extensionSettings.cowrite = saved;
    vi.spyOn(window.SillyTavern!, 'getContext').mockReturnValue(context);
    vi.spyOn(TavernBridge.prototype, 'assertCompatible').mockImplementation(() => {});
    vi.spyOn(TavernBridge.prototype, 'helper', 'get').mockReturnValue({ getTavernHelperVersion: () => '4.9.3' } as TavernHelperInterface);
    vi.spyOn(AccountFileRepository.prototype, 'loadTemplates').mockResolvedValue([]);
    vi.spyOn(AccountFileRepository.prototype, 'loadRecords').mockResolvedValue([]);
    vi.spyOn(AccountFileRepository.prototype, 'pendingRecordIds').mockResolvedValue([]);
    const store = useCowriteStore(createPinia());
    await store.initialize();
    expect(store.error).toBe('');
    expect(store.settings.generationContext.recordTokenBudget).toBe(expected);
    store.saveSettings();
    const reloaded = useCowriteStore(createPinia());
    await reloaded.initialize();
    expect(reloaded.settings.generationContext.recordTokenBudget).toBe(expected);
  });
});
