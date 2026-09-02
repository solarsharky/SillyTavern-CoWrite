import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BlockCard from '../src/components/BlockCard.vue';
import type { Block, InputType } from '../src/domain/schema';

function block(type: InputType): Block {
  return {
    id: `input-${type}`, cycleId: 'c', kind: 'input', author: 'user', title: '', content: '', targetIds: [], createdAt: new Date().toISOString(),
    input: { type, label: `填写 ${type}`, placeholder: '写在这里', required: true, options: ['甲', '乙'], min: 1, max: 3, minLabel: '少', maxLabel: '多', value: type === 'multi' ? [] : null },
  };
}

describe('五类 User 输入卡片', () => {
  it.each([
    ['short', 'input[type="text"]'],
    ['long', 'textarea'],
    ['single', 'input[type="radio"]'],
    ['multi', 'input[type="checkbox"]'],
    ['scale', '.cw-scale input[type="radio"]'],
  ] as const)('渲染 %s 输入', (type, selector) => {
    const wrapper = mount(BlockCard, { props: { block: block(type), characterName: '阿澜' } });
    expect(wrapper.find(selector).exists()).toBe(true);
    expect(wrapper.text()).toContain(`填写 ${type}`);
  });

  it('只通过 commit 事件交回 User 手填值', async () => {
    const wrapper = mount(BlockCard, { props: { block: block('short'), characterName: '阿澜' } });
    await wrapper.find('input').setValue('这是我的答案');
    await wrapper.find('input').trigger('change');
    expect(wrapper.emitted('commit')?.at(-1)).toEqual(['input-short', '这是我的答案']);
  });

  it('模型只给泛化标签时仍显示卡片中的完整题干', () => {
    const item = block('single');
    item.title = '如果周末只选一件事，你想和我做什么？';
    item.input!.label = '请填写';
    const wrapper = mount(BlockCard, { props: { block: item, characterName: '阿澜' } });
    expect(wrapper.find('legend').text()).toContain('如果周末只选一件事，你想和我做什么？');
  });
});
