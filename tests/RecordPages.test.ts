import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RecordPages from '../src/components/RecordPages.vue';
import BlockCard from '../src/components/BlockCard.vue';
import { applyPatch } from '../src/core/engine';
import { makeQuestionPatch, makeRecord } from './fixtures';

describe('按题阅读双人问卷', () => {
  it('双方使用相同选项并排展示，角色答案只读且不会填进我的答案', async () => {
    const record = applyPatch(makeRecord(), makeQuestionPatch('single', '散步'), 'opening');
    const wrapper = mount(RecordPages, { props: { blocks: record.blocks, characterName: '阿澜' } });
    const pair = wrapper.find('.cw-question-pair');
    expect(wrapper.findAll('.cw-record-entry')).toHaveLength(1);
    expect(pair.findAll('legend').map((legend) => legend.text().replace('必填', '').trim())).toEqual(['你想怎么度过周末？', '你想怎么度过周末？']);
    const charCard = pair.find('.cw-block--answer');
    expect(charCard.text()).toContain('阿澜的答案');
    expect(charCard.find('fieldset').attributes('disabled')).toBeDefined();
    expect(charCard.find<HTMLInputElement>('input[value="散步"]').element.checked).toBe(true);
    expect(pair.find('.cw-block--user').text()).toContain('我的答案');
    expect(pair.findAll<HTMLInputElement>('.cw-block--user input').every((input) => !input.element.checked)).toBe(true);
    await pair.find('.cw-block--user input[value="读书"]').setValue(true);
    expect(wrapper.emitted('commit')?.at(-1)).toEqual([record.blocks[0]?.id, '读书']);
    expect(charCard.find<HTMLInputElement>('input[value="散步"]').element.checked).toBe(true);
  });

  it('每道题的评价只出现在对应答案下面，多目标评价也不会漏掉', () => {
    let record = applyPatch(makeRecord(), makeQuestionPatch(), 'opening');
    const firstId = record.blocks[0]!.id;
    record = applyPatch(record, makeQuestionPatch(), 'more');
    const secondId = record.blocks[2]!.id;
    record = applyPatch(record, { complete: true, blocks: [
      { key: 'r2', kind: 'review', author: 'char', title: '', content: '第二题的评价', targetIds: [secondId] },
      { key: 'r1', kind: 'review', author: 'char', title: '', content: '第一题的批改', targetIds: [firstId] },
      { key: 'both', kind: 'review', author: 'char', title: '', content: '两题的关联', targetIds: [firstId, secondId] },
    ] }, 'continuation');
    const wrapper = mount(RecordPages, { props: { blocks: record.blocks, characterName: '阿澜' } });
    const pages = wrapper.findAll('.cw-record-entry');
    expect(pages).toHaveLength(2);
    expect(pages[0]?.find('.cw-block--user + .cw-inline-reviews').text()).toContain('第一题的批改');
    expect(pages[0]?.text()).not.toContain('第二题的评价');
    expect(pages[1]?.find('.cw-block--user + .cw-inline-reviews').text()).toContain('第二题的评价');
    expect(pages[1]?.text()).not.toContain('第一题的批改');
    expect(wrapper.findAll('.cw-inline-reviews').every((reviews) => reviews.text().includes('两题的关联'))).toBe(true);
    expect(wrapper.find('.cw-block__targets').exists()).toBe(false);
  });

  it('只读角色卡不会通过 commit 发出修改', async () => {
    const record = applyPatch(makeRecord(), makeQuestionPatch('multi', ['散步']), 'opening');
    const wrapper = mount(BlockCard, { props: { block: record.blocks[1]!, characterName: '阿澜' } });
    await wrapper.find('input').trigger('change');
    expect(wrapper.emitted('commit')).toBeUndefined();
  });

  it('每题默认显示我的答案，切换双方答案保留未提交草稿', async () => {
    const record = applyPatch(makeRecord(), makeQuestionPatch('long', '他的长答案'), 'opening');
    const wrapper = mount(RecordPages, { props: { blocks: record.blocks, characterName: '阿澜' } });
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    const input = wrapper.find<HTMLTextAreaElement>('.cw-block--user textarea');
    input.element.value = '还没有失焦提交的草稿';
    await input.trigger('input');
    await tabs[1]!.trigger('click');
    expect(wrapper.find('.cw-answer-column--char').classes()).toContain('is-active');
    expect(wrapper.find('.cw-answer-column--user').classes()).not.toContain('is-active');
    await tabs[0]!.trigger('click');
    expect(input.element.value).toBe('还没有失焦提交的草稿');
    expect(wrapper.find('.cw-answer-column--user').classes()).toContain('is-active');
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' });
    expect(tabs[1]?.attributes('aria-selected')).toBe('true');
  });
});
