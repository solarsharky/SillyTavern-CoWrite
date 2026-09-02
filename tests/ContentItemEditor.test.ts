import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ContentItemEditor from '../src/components/ContentItemEditor.vue';

describe('ContentItemEditor', () => {
  it('只编辑内容要求，并把所属分类作为只读语境显示', async () => {
    const wrapper = mount(ContentItemEditor, {
      props: {
        categoryName: '双人问卷',
        modelValue: {
          id: 'content-1',
          name: '自由主题',
          description: '让 Char 自由出题',
          guidance: '',
        },
      },
    });

    expect(wrapper.text()).toContain('双人问卷 · 内容项');
    expect(wrapper.text()).toContain('格式由所属分类统一管理');
    expect(wrapper.findAll('textarea')).toHaveLength(1);

    await wrapper.find('input[placeholder="例如：依恋类型"]').setValue('依恋类型');
    await wrapper.find('textarea').setValue('围绕安全感出题，必须加入一道具体情境题。');
    await wrapper.get('button.cw-button--primary').trigger('click');

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      id: 'content-1',
      name: '依恋类型',
      guidance: '围绕安全感出题，必须加入一道具体情境题。',
    });
  });
});
