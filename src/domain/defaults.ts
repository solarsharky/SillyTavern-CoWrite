import type { CowriteSettings, CowriteTemplate } from './schema';
import { SCHEMA_VERSION } from './schema';
import { cloneJson } from '../core/clone';

const now = '2026-01-01T00:00:00.000Z';

function template(input: Omit<CowriteTemplate, 'schemaVersion' | 'builtin' | 'starred' | 'createdAt' | 'updatedAt'>): CowriteTemplate {
  return {
    schemaVersion: SCHEMA_VERSION,
    builtin: true,
    starred: false,
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

export const BUILTIN_TEMPLATES: CowriteTemplate[] = [
  template({
    id: 'builtin-shared-questionnaire',
    name: '双人问卷',
    description: '双方依次回答并评价彼此答案。',
    icon: '💞',
    accent: '#b85c74',
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `这是 {{char}} 与 {{user}} 共同完成的双人问卷。保持 {{char}} 的性格、措辞和关系认知。每次只推进一个自然阶段，不要替 {{user}} 填写。`,
      opening: `创建 5 道有趣且有关系感的问题，混合使用短答、长答、单选、多选或量表。为每题创建一个交给 User 的 input 卡片，不要在首轮替 User 回答。`,
      continuation: `检查当前记录：如果 User 已回答首轮问题，就让 {{char}} 逐题给出自己的答案，并追加让 User 评价 Char 答案的输入位；如果 User 已完成这些评价，就由 {{char}} 评价 User 的原答案与反馈并将记录标记为完成。否则生成最合适的下一步。`,
    },
  }),
  template({
    id: 'builtin-char-questionnaire',
    name: 'Char 给 User 的问卷',
    description: 'Char 出题，User 作答，Char 再逐题评价。',
    icon: '📋',
    accent: '#8f6f3e',
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `由 {{char}} 主持一份面向 {{user}} 的问卷。问题应符合角色性格和当前关系，不替 User 作答。`,
      opening: `以 {{char}} 的口吻生成 5 道问题，允许短答、长答、单选、多选和量表，并全部创建为 User input 卡片。`,
      continuation: `如果 User 已回答，{{char}} 应逐题给出真诚、有角色感的评价，最后写一段总结并标记完成；若仍有未答必填题，只温和提醒，不重复出题。`,
    },
  }),
  template({
    id: 'builtin-exchange-diary',
    name: '交换日记',
    description: 'Char 与 User 轮流写下日记并回应上一页。',
    icon: '📖',
    accent: '#4f7c6a',
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `这是 {{char}} 与 {{user}} 的交换日记。文字私密、自然、符合角色，不要替 User 写日记。记录可持续多轮，除非 User 主动结束，否则不要标记完成。`,
      opening: `让 {{char}} 写第一篇日记，可以提到近期相处或一个想对 User 说的话；随后创建一个长文本 input，邀请 User 写下一页。`,
      continuation: `阅读 User 最新日记，让 {{char}} 先自然回应，再写下一页自己的日记，并创建新的 User 长文本输入位。不要重复已经说过的内容。`,
    },
  }),
];

export const DEFAULT_SETTINGS: CowriteSettings = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  defaultConnectionId: 'st-main',
  starredTemplateIds: [],
  connections: [{ id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true }],
  ui: { x: null, y: null, edgeTuck: true },
};

export function cloneBuiltinTemplate(source: CowriteTemplate, id: string, date = new Date().toISOString()): CowriteTemplate {
  return {
    ...cloneJson(source),
    id,
    name: `${source.name}（副本）`,
    builtin: false,
    createdAt: date,
    updatedAt: date,
  };
}
