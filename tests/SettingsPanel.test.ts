import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import SettingsPanel from '../src/components/SettingsPanel.vue';
import { useCowriteStore } from '../src/stores/app';
import { AccountFileRepository } from '../src/adapters/repository';
import { TavernBridge } from '../src/adapters/tavern';

describe('API 与全局 Prompt 设置', () => {
  afterEach(() => vi.restoreAllMocks());

  it('分别保存首尾 Prompt 和两个 API 的输出模式，重新初始化后仍然保留', async () => {
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
  });
});
