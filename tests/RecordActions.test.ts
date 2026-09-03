import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import App from '../src/App.vue';
import { useCowriteStore } from '../src/stores/app';
import { AccountFileRepository } from '../src/adapters/repository';
import { TavernGenerationGateway } from '../src/adapters/generation';
import { TavernBridge } from '../src/adapters/tavern';
import { applyPatch } from '../src/core/engine';
import { makeQuestionPatch, makeRecord } from './fixtures';

function setup() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useCowriteStore();
  const record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
  store.initialized = true;
  store.characterId = 'char-1';
  store.characterName = '阿澜';
  store.open = true;
  store.records = [record];
  store.selectedRecordId = record.id;
  return { store, record, pinia };
}

describe('记录操作', () => {
  beforeEach(() => {
    vi.spyOn(AccountFileRepository.prototype, 'saveRecord').mockResolvedValue({ synced: true });
    vi.spyOn(TavernBridge.prototype, 'currentCharacter').mockReturnValue({ id: 'char-1', name: '阿澜' });
    vi.spyOn(TavernBridge.prototype, 'loadManualLore').mockResolvedValue({ content: '', tokenCount: 0, missing: [] });
    vi.spyOn(TavernBridge.prototype, 'countTokens').mockResolvedValue(10);
    vi.spyOn(TavernBridge.prototype, 'maxContext').mockReturnValue(32768);
    vi.spyOn(TavernGenerationGateway.prototype, 'generatePatch').mockResolvedValue({ complete: true, blocks: [{ key: 'r', kind: 'text', author: 'char', title: '', content: '回应', targetIds: [] }] });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['active', 'completed', 'archived'] as const)('%s 状态下都显示四个明确操作且允许填写', (status) => {
    const { store, pinia } = setup();
    store.records[0]!.status = status;
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    expect(wrapper.findAll('.cw-actionbar button').map((button) => button.text())).toEqual(['交给他写', '重roll', '清空重填', '生成更多题']);
    expect(wrapper.find('.cw-block--user fieldset').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('填完立即点击交给他写，会等所有手填保存完再生成，且防止重复提交', async () => {
    const { store, record } = setup();
    let finish!: () => void;
    vi.mocked(AccountFileRepository.prototype.saveRecord).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ synced: true }); }));
    const input = store.commitInput(record.blocks[0]!.id, '刚刚填好的答案');
    const generation = store.continueRecord();
    await store.continueRecord();
    await vi.waitFor(() => expect(AccountFileRepository.prototype.saveRecord).toHaveBeenCalledOnce());
    expect(TavernGenerationGateway.prototype.generatePatch).not.toHaveBeenCalled();
    finish();
    await Promise.all([input, generation]);
    expect(TavernGenerationGateway.prototype.generatePatch).toHaveBeenCalledOnce();
    const options = vi.mocked(TavernGenerationGateway.prototype.generatePatch).mock.calls[0]![0];
    expect(options.record.blocks[0]?.input?.value).toBe('刚刚填好的答案');
    expect(store.selectedRecord?.blocks[0]?.input?.value).toBe('刚刚填好的答案');
  });

  it('等待手填保存时点击停止，不会随后偷偷开始生成', async () => {
    const { store, record } = setup();
    let finish!: () => void;
    vi.mocked(AccountFileRepository.prototype.saveRecord).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ synced: true }); }));
    const input = store.commitInput(record.blocks[0]!.id, '保留这句');
    const generation = store.continueRecord();
    await vi.waitFor(() => expect(AccountFileRepository.prototype.saveRecord).toHaveBeenCalledOnce());
    await store.stopGeneration();
    finish();
    await Promise.all([input, generation]);
    expect(TavernGenerationGateway.prototype.generatePatch).not.toHaveBeenCalled();
    expect(store.selectedRecord?.blocks[0]?.input?.value).toBe('保留这句');
    expect(store.busy).toBe(false);
  });

  it('取消清空确认后保留答案，确认后保留题目与他的答案', async () => {
    const { store, pinia } = setup();
    store.records[0]!.blocks[0]!.input!.value = '我的原答案';
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const button = wrapper.findAll('.cw-actionbar button').find((button) => button.text() === '清空重填')!;
    await button.trigger('click');
    expect(store.selectedRecord?.blocks[0]?.input?.value).toBe('我的原答案');
    expect(AccountFileRepository.prototype.saveRecord).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await button.trigger('click');
    await vi.waitFor(() => expect(store.selectedRecord?.blocks[0]?.input?.value).toBeNull());
    expect(store.selectedRecord?.blocks[1]?.input?.value).toBe('一起散步');
    wrapper.unmount();
  });
});
