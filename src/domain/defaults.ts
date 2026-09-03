import type { CowriteSettings, CowriteTemplate } from './schema';
import { SCHEMA_VERSION, DEFAULT_RECORD_TOKEN_BUDGET } from './schema';
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
      {
        id: 'shared-attachment', name: '依恋类型', description: '一起完成 10 题测试，获得双方的依恋类型倾向与相处建议。',
        guidance: `这是一份有计分和结果的双人依恋类型趣味测试。目标是通过 {{char}} 与 {{user}} 对同一组题目的回答，分别判断双方本次的依恋类型倾向。
首轮或生成更多题时，每组恰好 10 题，全部使用必填 scale，min=1、max=5、minLabel="完全不符合"、maxLabel="完全符合"。每组前 5 题考察依恋焦虑（如担心被抛下、反复确认爱意、对疏远敏感），后 5 题考察亲密回避（如回避依赖、压抑需求、亲密时退缩）。使用具体情境与第一人称陈述，全部正向计分，分数越高对应维度越强，不使用反向题。每道题仍按分类格式创建 User input 与 Char answer 配对；Char 按真实角色设定独立作答，不能为迎合 User 故意选择某一类型。开场简短说明量表含义和答完后会给双方测试结果，首轮不提前下结论。
User 答完并点击“交给他写”后，先按分类流程生成逐题 review，再额外生成三张 kind=text、author=char、targetIds=[] 的结果卡：标题分别为“{{user}}的测试结果”“{{char}}的测试结果”“我们的相处建议”。分别列出双方各自的焦虑与回避分数（对应 5 题的总分 ÷ 5，保留一位小数），并依据答案解释结果，不能只聊天点评而不给结论。
本趣味测试统一以均分 3 为分界：低于 3 为低，达到 3 为高。低焦虑+低回避→安全型；高焦虑+低回避→焦虑型；低焦虑+高回避→疏离回避型；高焦虑+高回避→恐惧回避型。先给出明确的主要倾向；分数接近分界时补充混合倾向，不把结果说成固定人格或临床诊断，也不宣称这是标准心理量表。每人的结果引用至少 2 道实际答案作为依据，最后结合双方结果给出 2—3 条具体相处建议。
缺答时不把空白计为 0，也不编造答案或完整结果。修改答案后重新按当前值计算。若有多组追加题，按每组自己的前 5 / 后 5 题划分维度，分别报告各组结果；追加题的显示编号仍接续上一组。旧版非量表题不能硬套本计分规则，应说明缺少可计分题目，只依据实际答案解释可能倾向。`,
      },
      { id: 'shared-zodiac', name: '星座与相处', description: '聊星座、性格和两人的相处方式。', guidance: '围绕星座、性格印象和两人的相处方式设计内容，保持轻松有角色感。' },
      { id: 'shared-nsfw', name: '私密 / NSFW', description: '更私密、更成人向的双人问题。', guidance: '本轮可以更私密、更成人向，同时保持角色设定、双方边界和自然措辞。' },
    ],
    connectionId: 'default',
    context: {
      recentChatCount: 12,
      worldInfoMode: 'active',
      manualEntries: [],
      manualLoreTokenBudget: 4000,
      recordTokenBudget: DEFAULT_RECORD_TOKEN_BUDGET,
    },
    prompts: {
      rules: `这是 {{char}} 与 {{user}} 共同完成的双人问卷。保持 {{char}} 的性格、措辞和关系认知。每次只推进一个自然阶段，不要替 {{user}} 填写。每道给 User 的问题都必须是一张 input 卡片，完整题干写入 input.label；title 只写题号，content 留空。`,
      opening: `创建恰好 10 道有趣且有关系感的问题，可使用短答、长答、单选、多选或量表。每道题同时创建一张交给 User 的 input 卡片和一张 {{char}} 已填写的 answer 卡片，共 10 对；可另加一张简短开场 text。input.label 写完整题干，title 只写题号，content 留空。single/multi 给出清晰 options，scale 给出 min、max 和两端含义。Char 答案使用 kind=answer、author=char，targetIds 引用对应 input 的 key，answer 按原题型填写字符串、选项数组或数字，不另设题型或选项。首轮就写好 Char 自己的答案，User 的输入必须保持空白。`,
      continuation: `User 点击“交给他写”后，让 {{char}} 逐题评价 User 刚填写或修改的答案。每道已回答的 User input 各生成一张 kind=review、author=char 卡片，targetIds 只填这道 User input 的 id；content 只写对这一题的评价或批改，可与 Char 自己的答案比较。不要评价尚未填写的题目，不要另建 User 评价输入位，也不要将逐题评价合并成一段总结。旧记录若缺少 Char 自己的答案，可按原题型补上 kind=answer 卡片。所有已答题都评价后可标记 complete=true，这不会阻止用户修改后再次交给他写。`,
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
      recordTokenBudget: DEFAULT_RECORD_TOKEN_BUDGET,
    },
    prompts: {
      rules: `由 {{char}} 主持一份面向 {{user}} 的问卷。问题应符合角色性格和当前关系，不替 User 作答。每道题都必须是一张 input 卡片，完整题干写入 input.label；title 只写题号，content 留空。`,
      opening: `以 {{char}} 的口吻创建恰好 10 道具体、有角色感的问题。除至多一张简短的 Char 开场 text 卡片外，只创建 10 张 User input 卡片。每张 input.label 必须是完整可见的题目，不能只写“请填写”“请作答”“第几题”，也不能把题干另放在 text 卡片中。题型可混用 short、long、single、multi、scale；single/multi 必须给出清晰 options，scale 必须给 min、max、minLabel、maxLabel。content 留空，绝不替 User 作答。`,
      continuation: `如果 User 已回答，{{char}} 应逐题给出真诚、有角色感的评价或批改。每道已回答的 User input 各创建一张 kind=review、author=char 卡片，targetIds 只填对应的 User input id，content 只写这一题的评价，显示在该答案下方；不要把逐题评价集中写进 text。最后可额外写一段简短总结并标记完成；若仍有未答必填题，只温和提醒，不重复出题。`,
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
      recordTokenBudget: DEFAULT_RECORD_TOKEN_BUDGET,
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
  recordBudgetDefaultsVersion: 1,
  enabled: true,
  defaultConnectionId: 'st-main',
  starredTemplateIds: [],
  hiddenTemplateIds: [],
  globalPrompt: { enabled: true, prefix: '', suffix: '' },
  generationContext: {
    recentChatCount: 12,
    worldInfoMode: 'active',
    manualEntries: [],
    manualLoreTokenBudget: 4000,
    recordTokenBudget: DEFAULT_RECORD_TOKEN_BUDGET,
  },
  connections: [{ id: 'st-main', type: 'st', name: '跟随 SillyTavern', readonly: true, streaming: false }],
  ui: { x: null, y: null, edgeTuck: true },
};

export function upgradeSettings(source: CowriteSettings): CowriteSettings {
  const next = cloneJson(source);
  if (next.recordBudgetDefaultsVersion < 1) {
    if (next.generationContext.recordTokenBudget === 12_000) {
      next.generationContext.recordTokenBudget = DEFAULT_RECORD_TOKEN_BUDGET;
    }
    // Mark the migration so a later deliberate choice of 12,000 is preserved.
    next.recordBudgetDefaultsVersion = 1;
  }
  return next;
}

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

// Upgrade only unchanged built-in prompts and content items. Preserve user edits and record content snapshots.
export function upgradeBuiltinPrompts(source: CowriteTemplate): CowriteTemplate {
  const next = cloneJson(source);
  const builtin = BUILTIN_TEMPLATES.find((item) => item.id === source.id);
  if (!builtin) return next;
  const legacyOpening = '创建恰好 5 道有趣且有关系感的问题，混合使用短答、长答、单选、多选或量表。除至多一张简短的 Char 开场 text 卡片外，只创建 5 张交给 User 的 input 卡片。每张 input.label 必须包含完整、具体、可见的题目，不能只写“请填写”“第1题”等泛称，也不能用独立 text 卡片承载题干。单选/多选给出清晰 options，量表给出 min、max 和两端含义。首轮绝不替 User 回答。';
  const legacyPairedOpening = '创建恰好 5 道有趣且有关系感的问题，混合使用短答、长答、单选、多选或量表。每道题同时创建一张交给 User 的 input 卡片和一张 {{char}} 已填写的 answer 卡片，共 5 对；可另加一张简短开场 text。input.label 写完整题干，title 只写题号，content 留空。single/multi 给出清晰 options，scale 给出 min、max 和两端含义。Char 答案使用 kind=answer、author=char，targetIds 引用对应 input 的 key，answer 按原题型填写字符串、选项数组或数字，不另设题型或选项。首轮就写好 Char 自己的答案，User 的输入必须保持空白。';
  const legacyCharOpening = '以 {{char}} 的口吻创建恰好 5 道具体、有角色感的问题。除至多一张简短的 Char 开场 text 卡片外，只创建 5 张 User input 卡片。每张 input.label 必须是完整可见的题目，不能只写“请填写”“请作答”“第几题”，也不能把题干另放在 text 卡片中。题型可混用 short、long、single、multi、scale；single/multi 必须给出清晰 options，scale 必须给 min、max、minLabel、maxLabel。content 留空，绝不替 User 作答。';
  const legacyContinuation = '检查当前记录：如果 User 已回答首轮问题，就让 {{char}} 逐题给出自己的答案，并追加让 User 评价 Char 答案的输入位；如果 User 已完成这些评价，就由 {{char}} 评价 User 的原答案与反馈并将记录标记为完成。否则生成最合适的下一步。';
  const legacyCharContinuation = '如果 User 已回答，{{char}} 应逐题给出真诚、有角色感的评价，最后写一段总结并标记完成；若仍有未答必填题，只温和提醒，不重复出题。';
  if (source.id === 'builtin-shared-questionnaire') {
    if ([legacyOpening, legacyPairedOpening].includes(next.prompts.opening)) next.prompts.opening = builtin.prompts.opening;
    if (next.prompts.continuation === legacyContinuation) next.prompts.continuation = builtin.prompts.continuation;
    const attachment = next.contentItems.find((item) => item.id === 'shared-attachment');
    const currentAttachment = builtin.contentItems.find((item) => item.id === 'shared-attachment')!;
    if (attachment?.guidance === '围绕依恋类型、亲密关系模式与安全感设计问题。不要直接下心理诊断结论。') {
      attachment.guidance = currentAttachment.guidance;
      if (attachment.description === '探索亲密关系中的依恋与安全感。') attachment.description = currentAttachment.description;
    }
  }
  if (source.id === 'builtin-char-questionnaire') {
    if (next.prompts.opening === legacyCharOpening) next.prompts.opening = builtin.prompts.opening;
    if (next.prompts.continuation === legacyCharContinuation) next.prompts.continuation = builtin.prompts.continuation;
  }
  return next;
}
