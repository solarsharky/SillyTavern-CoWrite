import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, upgradeBuiltinPrompts } from '../src/domain/defaults';
import { prepareTemplateForGeneration } from '../src/core/template';
import { buildStagePrompt } from '../src/core/prompt';
import { makeRecord, makeSettings, makeTemplate } from './fixtures';

// Released beta.10 values: keep fixed so migration tests represent saved user data.
const oldSharedOpening = '创建恰好 5 道有趣且有关系感的问题，混合使用短答、长答、单选、多选或量表。每道题同时创建一张交给 User 的 input 卡片和一张 {{char}} 已填写的 answer 卡片，共 5 对；可另加一张简短开场 text。input.label 写完整题干，title 只写题号，content 留空。single/multi 给出清晰 options，scale 给出 min、max 和两端含义。Char 答案使用 kind=answer、author=char，targetIds 引用对应 input 的 key，answer 按原题型填写字符串、选项数组或数字，不另设题型或选项。首轮就写好 Char 自己的答案，User 的输入必须保持空白。';
const oldCharOpening = '以 {{char}} 的口吻创建恰好 5 道具体、有角色感的问题。除至多一张简短的 Char 开场 text 卡片外，只创建 5 张 User input 卡片。每张 input.label 必须是完整可见的题目，不能只写“请填写”“请作答”“第几题”，也不能把题干另放在 text 卡片中。题型可混用 short、long、single、multi、scale；single/multi 必须给出清晰 options，scale 必须给 min、max、minLabel、maxLabel。content 留空，绝不替 User 作答。';
const oldAttachment = {
  id: 'shared-attachment', name: '依恋类型', description: '探索亲密关系中的依恋与安全感。',
  guidance: '围绕依恋类型、亲密关系模式与安全感设计问题。不要直接下心理诊断结论。',
};

describe('已有内置格式升级', () => {
  it.each([
    ['builtin-shared-questionnaire', oldSharedOpening],
    ['builtin-char-questionnaire', oldCharOpening],
  ])('%s 的已保存五题默认值升级后用于首轮和追加题', (id, opening) => {
    const current = BUILTIN_TEMPLATES.find((item) => item.id === id)!;
    const source = structuredClone(current);
    source.prompts.opening = opening;
    const upgraded = prepareTemplateForGeneration(source, makeSettings().generationContext);
    expect(upgraded.prompts.opening).toBe(current.prompts.opening);
    for (const stage of ['opening', 'more'] as const) {
      const prompt = buildStagePrompt(upgraded, makeRecord({ templateSnapshot: upgraded }), stage);
      expect(prompt).toContain('恰好 10 道');
      expect(prompt).not.toContain('恰好 5 道');
    }
    expect(source.prompts.opening).toBe(opening);
    expect(upgradeBuiltinPrompts(upgraded)).toEqual(upgraded);
  });

  it('从旧内容项开始测试时使用新指导，而继续旧记录时保留其内容快照', () => {
    const source = makeTemplate({ contentItems: [oldAttachment], contentTitle: oldAttachment.name, contentGuidance: oldAttachment.guidance });
    const context = makeSettings().generationContext;
    const current = BUILTIN_TEMPLATES[0]!.contentItems.find((item) => item.id === oldAttachment.id)!;
    const fresh = prepareTemplateForGeneration(source, context, oldAttachment);
    expect(fresh.contentGuidance).toBe(current.guidance);
    expect(fresh.contentItems[0]).toEqual(current);
    const prompt = buildStagePrompt(fresh, makeRecord({ templateSnapshot: fresh }), 'continuation');
    expect(prompt).toContain('小鱼的测试结果');
    expect(prompt).toContain('阿澜的测试结果');
    expect(prompt).toContain('我们的相处建议');
    const existing = prepareTemplateForGeneration(source, context);
    expect(existing.contentGuidance).toBe(oldAttachment.guidance);
    expect(source.contentItems).toEqual([oldAttachment]);
  });

  it('自定义题数、编辑过的内容及用户副本均不被默认值覆盖', () => {
    const source = makeTemplate({ contentItems: [{ ...oldAttachment, description: '我自己的介绍', guidance: '按我指定的 8 题出题' }] });
    source.prompts.opening = '创建恰好 8 道问题';
    expect(upgradeBuiltinPrompts(source)).toEqual(source);
    const prepared = prepareTemplateForGeneration(source, makeSettings().generationContext, { ...oldAttachment, guidance: '尚未保存的自定义内容' });
    expect(prepared.contentGuidance).toBe('尚未保存的自定义内容');
    const copy = makeTemplate({ id: 'my-copy', builtin: false, contentItems: [oldAttachment] });
    copy.prompts.opening = oldSharedOpening;
    expect(upgradeBuiltinPrompts(copy)).toEqual(copy);
  });

  it('不会恢复已删除的依恋内容项，升级提示词时保留自定义名称与描述', () => {
    expect(upgradeBuiltinPrompts(makeTemplate({ contentItems: [] })).contentItems).toEqual([]);
    const source = makeTemplate({ contentItems: [{ ...oldAttachment, name: '我的依恋测试', description: '自己写的介绍' }] });
    const item = upgradeBuiltinPrompts(source).contentItems[0]!;
    expect(item.name).toBe('我的依恋测试');
    expect(item.description).toBe('自己写的介绍');
    expect(item.guidance).not.toBe(oldAttachment.guidance);
  });
});
