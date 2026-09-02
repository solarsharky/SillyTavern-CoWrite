import type { CowriteSettings, CowriteTemplate } from './schema';
import { SCHEMA_VERSION } from './schema';
import { cloneJson } from '../core/clone';

const now = '2026-01-01T00:00:00.000Z';

function template(input: Omit<CowriteTemplate, 'schemaVersion' | 'builtin' | 'starred' | 'contentGuidance' | 'contentTitle' | 'createdAt' | 'updatedAt'>): CowriteTemplate {
  return {
    schemaVersion: SCHEMA_VERSION,
    builtin: true,
    starred: false,
    contentGuidance: '',
    contentTitle: '',
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
    contentItems: [
      { id: 'shared-free', name: '自由主题', description: '根据角色和当前关系自然出题。', guidance: '' },
      { id: 'shared-attachment', name: '依恋类型', description: '探索亲密关系中的依恋与安全感。', guidance: '围绕依恋类型、亲密关系模式与安全感设计问题。不要直接下心理诊断结论。' },
      { id: 'shared-zodiac', name: '星座与相处', description: '聊星座、性格和两人的相处方式。', guidance: '围绕星座、性格印象和两人的相处方式设计内容，保持轻松有角色感。' },
      { id: 'shared-nsfw', name: '私密 / NSFW', description: '更私密、更成人向的双人问题。', guidance: '本轮可以更私密、更成人向，同时保持角色设定、双方边界和自然措辞。' },
    ],
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `这是 {{char}} 与 {{user}} 共同完成的双人问卷。保持 {{char}} 的性格、措辞和关系认知。每次只推进一个自然阶段，不要替 {{user}} 填写。每道给 User 的问题都必须是一张 input 卡片，完整题干写入 input.label；title 只写题号，content 留空。`,
      opening: `创建恰好 5 道有趣且有关系感的问题，混合使用短答、长答、单选、多选或量表。除至多一张简短的 Char 开场 text 卡片外，只创建 5 张交给 User 的 input 卡片。每张 input.label 必须包含完整、具体、可见的题目，不能只写“请填写”“第1题”等泛称，也不能用独立 text 卡片承载题干。单选/多选给出清晰 options，量表给出 min、max 和两端含义。首轮绝不替 User 回答。`,
      continuation: `检查当前记录：如果 User 已回答首轮问题，就让 {{char}} 逐题给出自己的答案，并追加让 User 评价 Char 答案的输入位；如果 User 已完成这些评价，就由 {{char}} 评价 User 的原答案与反馈并将记录标记为完成。否则生成最合适的下一步。`,
    },
  }),
  template({
    id: 'builtin-char-questionnaire',
    name: 'Char 给 User 的问卷',
    description: 'Char 出题，User 作答，Char 再逐题评价。',
    icon: '📋',
    accent: '#8f6f3e',
    contentItems: [
      { id: 'char-free', name: '自由主题', description: '由 Char 按照性格自由出题。', guidance: '' },
      { id: 'char-understanding', name: '你真的了解我吗', description: '由 Char 测试 User 对自己的了解。', guidance: '问题围绕 User 是否真正了解 Char 的习惯、偏好、经历和情绪反应。' },
      { id: 'char-relationship', name: '关系小测验', description: '聚焦双方关系和相处细节。', guidance: '围绕两人的关系、共同记忆、矛盾处理和未来期待设计问题。' },
    ],
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `由 {{char}} 主持一份面向 {{user}} 的问卷。问题应符合角色性格和当前关系，不替 User 作答。每道题都必须是一张 input 卡片，完整题干写入 input.label；title 只写题号，content 留空。`,
      opening: `以 {{char}} 的口吻创建恰好 5 道具体、有角色感的问题。除至多一张简短的 Char 开场 text 卡片外，只创建 5 张 User input 卡片。每张 input.label 必须是完整可见的题目，不能只写“请填写”“请作答”“第几题”，也不能把题干另放在 text 卡片中。题型可混用 short、long、single、multi、scale；single/multi 必须给出清晰 options，scale 必须给 min、max、minLabel、maxLabel。content 留空，绝不替 User 作答。`,
      continuation: `如果 User 已回答，{{char}} 应逐题给出真诚、有角色感的评价，最后写一段总结并标记完成；若仍有未答必填题，只温和提醒，不重复出题。`,
    },
  }),
  template({
    id: 'builtin-exchange-diary',
    name: '交换日记',
    description: 'Char 与 User 轮流写下日记并回应上一页。',
    icon: '📖',
    accent: '#4f7c6a',
    contentItems: [
      { id: 'diary-free', name: '自由日记', description: '根据近期相处自然写一页。', guidance: '' },
      { id: 'diary-memory', name: '共同回忆', description: '围绕一段共同经历交换日记。', guidance: '本轮围绕一段双方共同经历或印象深刻的相处片段来写。' },
      { id: 'diary-unsaid', name: '没说出口的话', description: '写下平时难以直接表达的内容。', guidance: '本轮围绕平时没有说出口的话、隐藏的情绪或想让对方知道的心意来写。' },
    ],
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: 12000,
    },
    prompts: {
      rules: `这是 {{char}} 与 {{user}} 的交换日记。文字私密、自然、符合角色，不要替 User 写日记。记录可持续多轮，除非 User 主动结束，否则不要标记完成。给 User 的书写邀请必须是一张 long input 卡片，完整邀请写入 input.label，content 留空。`,
      opening: `让 {{char}} 用一张 text 卡片写第一篇日记，可以提到近期相处或一个想对 User 说的话；随后创建一张 long input 卡片邀请 User 写下一页。input.label 要写完整、具体的邀请，不能只写“请填写”。`,
      continuation: `阅读 User 最新日记，让 {{char}} 先自然回应，再用 text 卡片写下一页自己的日记，并创建新的 long input 卡片邀请 User 接力。input.label 必须完整可见，不要重复已经说过的内容。`,
    },
  }),
];

export const DEFAULT_SETTINGS: CowriteSettings = {
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  defaultConnectionId: 'st-main',
  starredTemplateIds: [],
  hiddenTemplateIds: [],
  generationContext: {
    recentChatCount: 12,
    worldInfoMode: 'active',
    manualEntries: [],
    manualLoreTokenBudget: 4000,
    recordTokenBudget: 12000,
  },
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
