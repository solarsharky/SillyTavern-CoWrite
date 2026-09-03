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

  it.each([120_000, 1_000_000])('当前问卷超出旧预算后，在设置提高到 %i 即可继续生成逐题点评', async (budgetTokens) => {
    const { store, pinia, record } = setup();
    vi.mocked(TavernBridge.prototype.countTokens).mockResolvedValue(budgetTokens / 2);
    if (budgetTokens === 1_000_000) {
      const connection = store.addConnection();
      store.settings.connections.push(connection);
      store.settings.defaultConnectionId = connection.id;
      store.sessionKeys[connection.id] = 'test-key';
    }
    store.settings.generationContext.recordTokenBudget = 12_000;
    store.records[0]!.templateSnapshot.context.recordTokenBudget = 12_000;
    store.records[0]!.blocks[0]!.input!.value = '已填写的答案';
    vi.mocked(TavernGenerationGateway.prototype.generatePatch).mockResolvedValue({
      complete: true,
      blocks: [{ key: 'review', kind: 'review', author: 'char', title: '', content: '这是对你答案的点评', targetIds: [record.blocks[0]!.id] }],
    });
    await store.continueRecord();
    expect(store.error).toContain('阈值');
    expect(TavernGenerationGateway.prototype.generatePatch).not.toHaveBeenCalled();

    store.tab = 'settings';
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const budget = wrapper.findAll('label').find((label) => label.text().includes('自动压缩阈值'))!.find('input');
    await budget.setValue(budgetTokens);
    await wrapper.findAll('button').find((button) => button.text() === '保存上下文设置')!.trigger('click');
    store.tab = 'current';
    await wrapper.vm.$nextTick();
    await wrapper.findAll('.cw-actionbar button').find((button) => button.text() === '交给他写')!.trigger('click');
    await vi.waitFor(() => expect(store.busy).toBe(false));
    expect(store.error).toBe('');
    expect(TavernGenerationGateway.prototype.generatePatch).toHaveBeenCalledOnce();
    const request = vi.mocked(TavernGenerationGateway.prototype.generatePatch).mock.calls[0]![0];
    expect(request.template.context.recordTokenBudget).toBe(budgetTokens);
    expect(request.connection.type).toBe(budgetTokens === 1_000_000 ? 'custom' : 'st');
    expect(store.selectedRecord?.id).toBe(record.id);
    expect(store.selectedRecord?.blocks[0]?.input?.value).toBe('已填写的答案');
    expect(wrapper.find('.cw-inline-reviews--user').text()).toContain('这是对你答案的点评');
    wrapper.unmount();
  });

  it('用户调低压缩阈值后先摘要再点评，完整原文和已填答案仍保留', async () => {
    const { store, pinia, record } = setup();
    let source = record;
    source.blocks[0]!.input!.value = '完整保留这份答案';
    for (let index = 0; index < 4; index += 1) {
      source = applyPatch(source, { complete: false, blocks: [{ key: `text-${index}`, kind: 'text', author: 'char', title: '', content: `第 ${index} 次对话`, targetIds: [] }] }, 'continuation');
    }
    store.records = [source];
    store.tab = 'settings';
    vi.mocked(TavernBridge.prototype.countTokens).mockResolvedValue(40_000);
    const summarize = vi.spyOn(TavernGenerationGateway.prototype, 'summarize').mockResolvedValue('早期摘要');
    const wrapper = mount(App, { global: { plugins: [pinia] } });
    const threshold = wrapper.findAll('label').find((label) => label.text().includes('自动压缩阈值'))!.find('input');
    await threshold.setValue(30_000);
    await wrapper.findAll('button').find((button) => button.text() === '保存上下文设置')!.trigger('click');
    store.tab = 'current';
    await wrapper.vm.$nextTick();
    await wrapper.findAll('.cw-actionbar button').find((button) => button.text() === '交给他写')!.trigger('click');
    await vi.waitFor(() => expect(store.busy).toBe(false));
    expect(store.error).toBe('');
    expect(summarize).toHaveBeenCalledOnce();
    expect(TavernGenerationGateway.prototype.generatePatch).toHaveBeenCalledOnce();
    expect(summarize.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(TavernGenerationGateway.prototype.generatePatch).mock.invocationCallOrder[0]!);
    expect(store.selectedRecord?.rollingSummary).toBe('早期摘要');
    expect(store.selectedRecord?.blocks.slice(0, source.blocks.length)).toEqual(source.blocks);
    expect(store.selectedRecord?.blocks[0]?.input?.value).toBe('完整保留这份答案');
    wrapper.unmount();
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
