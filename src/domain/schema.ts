import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;
export const DEFAULT_RECORD_TOKEN_BUDGET = 120_000;

export const InputTypeSchema = z.enum(['short', 'long', 'single', 'multi', 'scale']);
export type InputType = z.infer<typeof InputTypeSchema>;

export const InputValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.number(),
  z.null(),
]);

const InputConfigBaseSchema = z.object({
  type: InputTypeSchema,
  label: z.string().default(''),
  placeholder: z.string().default(''),
  required: z.boolean().default(false),
  options: z.array(z.string()).default([]),
  min: z.number().default(1),
  max: z.number().default(5),
  minLabel: z.string().default(''),
  maxLabel: z.string().default(''),
  value: InputValueSchema.default(null),
});

export const InputConfigSchema = InputConfigBaseSchema.superRefine((input, ctx) => {
  if (['single', 'multi'].includes(input.type) && input.options.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: '单选和多选至少需要一个选项' });
  }
  if (input.type === 'scale' && input.max < input.min) {
    ctx.addIssue({ code: 'custom', path: ['max'], message: '量表最大值不能小于最小值' });
  }
  if (input.value === null) return;
  if (['short', 'long', 'single'].includes(input.type) && typeof input.value !== 'string') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '此输入需要字符串值' });
  }
  if (input.type === 'multi' && !Array.isArray(input.value)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '多选输入需要字符串数组' });
  }
  if (input.type === 'scale' && (typeof input.value !== 'number' || input.value < input.min || input.value > input.max)) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '量表值超出范围' });
  }
});
export type InputConfig = z.infer<typeof InputConfigSchema>;

export const BlockKindSchema = z.enum(['section', 'text', 'input', 'answer', 'review', 'divider']);
export const BlockAuthorSchema = z.enum(['system', 'char', 'user']);

export const BlockSchema = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  kind: BlockKindSchema,
  author: BlockAuthorSchema,
  title: z.string().default(''),
  content: z.string().default(''),
  input: InputConfigSchema.optional(),
  targetIds: z.array(z.string()).default([]),
  createdAt: z.string(),
}).superRefine((block, ctx) => {
  if (block.kind === 'input' && !block.input) {
    ctx.addIssue({ code: 'custom', message: '输入卡片必须包含 input 配置' });
  }
  if (block.kind === 'input' && block.author !== 'user') {
    ctx.addIssue({ code: 'custom', message: '输入卡片必须属于 User' });
  }
  if (block.kind === 'answer' && (block.author !== 'char' || !block.input || block.input.value === null || block.targetIds.length !== 1)) {
    ctx.addIssue({ code: 'custom', message: '角色答案必须属于 Char，包含已填写的题型配置，并关联一道题' });
  }
  if (block.kind !== 'input' && block.author === 'user') {
    ctx.addIssue({ code: 'custom', message: 'AI 不得创建已填写的 User 内容' });
  }
});
export type Block = z.infer<typeof BlockSchema>;

export const GeneratedBlockSchema = z.object({
  key: z.string().min(1).max(80),
  kind: BlockKindSchema,
  author: BlockAuthorSchema.default('char'),
  title: z.string().default(''),
  content: z.string().default(''),
  input: InputConfigBaseSchema.omit({ value: true }).optional(),
  answer: InputValueSchema.optional(),
  targetIds: z.array(z.string()).default([]),
}).superRefine((block, ctx) => {
  if (block.kind === 'answer' && (block.author !== 'char' || block.answer == null || block.targetIds.length !== 1)) {
    ctx.addIssue({ code: 'custom', message: '角色答案必须使用 author=char、answer 答案值，并在 targetIds 中关联一道题' });
  }
  if (block.kind !== 'answer' && block.answer !== undefined) {
    ctx.addIssue({ code: 'custom', message: '只有 Char 的 answer 卡片可以携带答案值' });
  }
  if (block.kind === 'input') {
    if (!block.input) ctx.addIssue({ code: 'custom', message: 'input 卡片缺少配置' });
    if (block.author !== 'user') ctx.addIssue({ code: 'custom', message: 'input 卡片必须交给 user' });
    if (block.input && (!block.input.label.trim() || /^(请填写|请作答|回答|作答)$/.test(block.input.label.trim()))) {
      ctx.addIssue({ code: 'custom', path: ['input', 'label'], message: 'input.label 必须包含完整、可见的题干' });
    }
    if (block.input && ['single', 'multi'].includes(block.input.type) && block.input.options.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['input', 'options'], message: '单选和多选至少需要一个选项' });
    }
    if (block.input?.type === 'scale' && block.input.max < block.input.min) {
      ctx.addIssue({ code: 'custom', path: ['input', 'max'], message: '量表最大值不能小于最小值' });
    }
  }
  if (block.kind !== 'input' && block.author === 'user') {
    ctx.addIssue({ code: 'custom', message: 'AI 不能代替 User 填写文本' });
  }
});
export type GeneratedBlock = z.infer<typeof GeneratedBlockSchema>;

export const GenerationPatchSchema = z.object({
  title: z.string().max(120).optional(),
  blocks: z.array(GeneratedBlockSchema).min(1).max(30),
  complete: z.boolean().default(false),
  summaryUpdate: z.string().max(12000).optional(),
});
export type GenerationPatch = z.infer<typeof GenerationPatchSchema>;

export const ManualLoreEntrySchema = z.object({
  bookName: z.string().min(1),
  uid: z.number().int().nonnegative(),
  name: z.string().default(''),
});
export type ManualLoreEntry = z.infer<typeof ManualLoreEntrySchema>;

export const GenerationContextSchema = z.object({
  recentChatCount: z.number().int().min(0).max(100).default(12),
  worldInfoMode: z.enum(['active', 'manual', 'both', 'off']).default('active'),
  manualEntries: z.array(ManualLoreEntrySchema).default([]),
  manualLoreTokenBudget: z.number().int().min(0).max(50000).default(4000),
  recordTokenBudget: z.number().int().min(1000).max(1_000_000).default(DEFAULT_RECORD_TOKEN_BUDGET),
});
export type GenerationContext = z.infer<typeof GenerationContextSchema>;

export const ContentItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(300).default(''),
  guidance: z.string().max(8000).default(''),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const TemplateSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  icon: z.string().max(8).default('📝'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b7794b'),
  builtin: z.boolean().default(false),
  starred: z.boolean().default(false),
  contentGuidance: z.string().max(8000).default(''),
  contentTitle: z.string().max(80).default(''),
  contentItems: z.array(ContentItemSchema).default([]),
  prompts: z.object({
    rules: z.string().min(1),
    opening: z.string().min(1),
    continuation: z.string().min(1),
  }),
  context: GenerationContextSchema,
  connectionId: z.string().default('default'),
  advancedProtocol: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CowriteTemplate = z.infer<typeof TemplateSchema>;

export const CycleSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(['opening', 'continuation', 'more']),
  status: z.enum(['applied', 'undone']).default('applied'),
  blockSnapshot: z.array(BlockSchema),
  previousState: z.object({
    title: z.string(),
    rollingSummary: z.string(),
    summaryThroughCycle: z.string(),
  }).optional(),
  createdAt: z.string(),
});
export type Cycle = z.infer<typeof CycleSchema>;

export const RecordStatusSchema = z.enum(['active', 'completed', 'archived']);

export const RecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  templateId: z.string().min(1),
  templateSnapshot: TemplateSchema,
  characterId: z.string().min(1),
  characterName: z.string().min(1),
  status: RecordStatusSchema.default('active'),
  starred: z.boolean().default(false),
  blocks: z.array(BlockSchema).default([]),
  cycles: z.array(CycleSchema).default([]),
  rollingSummary: z.string().default(''),
  summaryThroughCycle: z.string().default(''),
  parentRecordId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).superRefine((record, ctx) => {
  const blockIds = record.blocks.map((block) => block.id);
  if (new Set(blockIds).size !== blockIds.length) ctx.addIssue({ code: 'custom', path: ['blocks'], message: '记录包含重复卡片 ID' });
  const cycleIds = record.cycles.map((cycle) => cycle.id);
  if (new Set(cycleIds).size !== cycleIds.length) ctx.addIssue({ code: 'custom', path: ['cycles'], message: '记录包含重复轮次 ID' });
});
export type CowriteRecord = z.infer<typeof RecordSchema>;

export const ConnectionProfileSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.literal('st-main'),
    type: z.literal('st'),
    name: z.string(),
    readonly: z.literal(true),
    streaming: z.boolean().default(false),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('custom'),
    name: z.string().min(1),
    apiUrl: z.string().min(1),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().int().min(64).max(131072).default(4096),
    rememberKey: z.boolean().default(false),
    streaming: z.boolean().default(false),
  }),
]);
export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;

export const GlobalPromptSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().default(''),
  suffix: z.string().default(''),
});
export type GlobalPrompt = z.infer<typeof GlobalPromptSchema>;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  recordBudgetDefaultsVersion: z.number().int().nonnegative().default(0),
  enabled: z.boolean().default(true),
  defaultConnectionId: z.string().default('st-main'),
  starredTemplateIds: z.array(z.string()).default([]),
  hiddenTemplateIds: z.array(z.string()).default([]),
  globalPrompt: GlobalPromptSchema.default({ enabled: true, prefix: '', suffix: '' }),
  generationContext: GenerationContextSchema.default({
    recentChatCount: 12,
    worldInfoMode: 'active',
    manualEntries: [],
    manualLoreTokenBudget: 4000,
    recordTokenBudget: DEFAULT_RECORD_TOKEN_BUDGET,
  }),
  connections: z.array(ConnectionProfileSchema),
  ui: z.object({
    x: z.number().nullable().default(null),
    y: z.number().nullable().default(null),
    edgeTuck: z.boolean().default(true),
  }),
});
export type CowriteSettings = z.infer<typeof SettingsSchema>;

export const CatalogSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  records: z.array(z.object({
    id: z.string(),
    file: z.string(),
    title: z.string(),
    templateName: z.string(),
    characterId: z.string(),
    characterName: z.string(),
    status: RecordStatusSchema,
    starred: z.boolean(),
    updatedAt: z.string(),
  })).default([]),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const BackupSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  exportedAt: z.string(),
  settings: SettingsSchema,
  templates: z.array(TemplateSchema),
  records: z.array(RecordSchema),
});
export type CowriteBackup = z.infer<typeof BackupSchema>;

export function isInputAnswered(block: Block): boolean {
  if (block.kind !== 'input' || !block.input) return true;
  const value = block.input.value;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null;
}

export function parseVersionedRecord(input: unknown): CowriteRecord {
  return RecordSchema.parse(input);
}
