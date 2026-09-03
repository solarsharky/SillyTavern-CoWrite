import { GenerationStoppedError, type GenerationGateway, type GenerateOptions } from '../adapters/generation';
import type { RecordRepository, SaveResult } from '../adapters/repository';
import type { TavernBridge } from '../adapters/tavern';
import {
  BlockSchema,
  RecordSchema,
  SCHEMA_VERSION,
  isInputAnswered,
  type Block,
  type ConnectionProfile,
  type CowriteRecord,
  type CowriteTemplate,
  type GenerationPatch,
  type InputConfig,
  InputValueSchema,
  InputConfigSchema,
} from '../domain/schema';
import { serializeRecordForModel, type GenerationStage } from './prompt';
import { cloneJson } from './clone';
import type { z } from 'zod';

export interface EngineResult {
  record: CowriteRecord;
  save: SaveResult;
  warnings: string[];
}

export interface ActivityEngineDependencies {
  repository: RecordRepository;
  gateway: GenerationGateway;
  tavern: TavernBridge;
  resolveConnection(id: string): { profile: ConnectionProfile; apiKey?: string };
}

export class ActivityEngine {
  private operationActive = false;
  private stopRequested = false;

  constructor(private readonly deps: ActivityEngineDependencies) {}

  async start(template: CowriteTemplate): Promise<EngineResult> {
    const character = this.deps.tavern.currentCharacter();
    if (!character) throw new Error('请先打开一个单角色聊天；共笔首版暂不支持群聊。');
    const date = new Date().toISOString();
    const record: CowriteRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      title: `${template.name}${template.contentTitle ? ` · ${template.contentTitle}` : ''} · ${new Date().toLocaleDateString('zh-CN')}`,
      templateId: template.id,
      templateSnapshot: cloneJson(template),
      characterId: character.id,
      characterName: character.name,
      status: 'active',
      starred: false,
      blocks: [],
      cycles: [],
      rollingSummary: '',
      summaryThroughCycle: '',
      createdAt: date,
      updatedAt: date,
    };
    return await this.runGeneration(record, 'opening');
  }

  async continue(record: CowriteRecord): Promise<EngineResult> {
    this.assertCanContinue(record);
    const stage: GenerationStage = record.cycles.some((cycle) => cycle.status === 'applied') ? 'continuation' : 'opening';
    return await this.runGeneration(record, stage);
  }

  async stop(): Promise<boolean> {
    if (!this.operationActive) return await this.deps.gateway.stop();
    this.stopRequested = true;
    await this.deps.gateway.stop();
    return true;
  }

  async updateInput(record: CowriteRecord, blockId: string, value: z.infer<typeof InputValueSchema>): Promise<EngineResult> {
    this.assertCharacter(record);
    const next = cloneJson(record);
    const block = next.blocks.find((item) => item.id === blockId);
    if (!block || block.kind !== 'input' || !block.input) throw new Error('找不到可编辑的 User 输入卡片。');
    block.input.value = value;
    next.status = 'active';
    next.updatedAt = new Date().toISOString();
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async reroll(record: CowriteRecord): Promise<EngineResult> {
    this.assertCharacter(record);
    const next = cloneJson(record);
    const cycle = [...next.cycles].reverse().find((item) => item.status === 'applied');
    if (!cycle) throw new Error('还没有可以重roll的内容，请先交给他写。');
    next.blocks = next.blocks.filter((block) => block.cycleId !== cycle.id);
    next.cycles = next.cycles.filter((item) => item.status === 'applied' && item.id !== cycle.id);
    next.title = cycle.previousState?.title || next.title;
    next.rollingSummary = cycle.previousState?.rollingSummary || '';
    next.summaryThroughCycle = cycle.previousState?.summaryThroughCycle || '';
    next.status = 'active';
    if (cycle.stage === 'continuation') this.assertCanContinue(next);
    // Only persist after a replacement succeeds, so stopping or failure keeps the original round intact.
    return await this.runGeneration(next, cycle.stage);
  }

  async clearAnswers(record: CowriteRecord): Promise<EngineResult> {
    this.assertCharacter(record);
    const next = cloneJson(record);
    const applied = next.cycles.filter((cycle) => cycle.status === 'applied');
    const firstCycleId = applied[0]?.id;
    // Keep the original questions and every explicitly added set, not follow-up feedback forms.
    next.cycles = applied.filter((cycle) => cycle.id === firstCycleId || cycle.stage === 'opening' || cycle.stage === 'more');
    const keptCycles = new Set(next.cycles.map((cycle) => cycle.id));
    next.blocks = next.blocks.filter((block) => keptCycles.has(block.cycleId));
    const keptBlocks = new Set(next.blocks.map((block) => block.id));
    for (const block of next.blocks) {
      if (block.kind === 'input' && block.input) block.input.value = null;
      block.targetIds = block.targetIds.filter((id) => keptBlocks.has(id));
    }
    for (const cycle of next.cycles) {
      cycle.blockSnapshot = cloneJson(next.blocks.filter((block) => block.cycleId === cycle.id));
      // The previous summaries may contain the answers being cleared.
      delete cycle.previousState;
    }
    next.rollingSummary = '';
    next.summaryThroughCycle = '';
    next.status = 'active';
    next.updatedAt = new Date().toISOString();
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async generateMore(record: CowriteRecord): Promise<EngineResult> {
    this.assertCharacter(record);
    return await this.runGeneration(record, 'more');
  }

  async toggleStar(record: CowriteRecord): Promise<EngineResult> {
    const next = { ...cloneJson(record), starred: !record.starred, updatedAt: new Date().toISOString() };
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  private async runGeneration(source: CowriteRecord, stage: GenerationStage): Promise<EngineResult> {
    this.operationActive = true;
    this.stopRequested = false;
    try {
      const record = cloneJson(source);
      record.status = 'active';
      const template = record.templateSnapshot;
      const manualLore = await this.deps.tavern.loadManualLore(template);
      this.assertNotStopped();
      if (manualLore.tokenCount > template.context.manualLoreTokenBudget) {
        throw new Error(`手选世界书约 ${manualLore.tokenCount} tokens，超过模板预算 ${template.context.manualLoreTokenBudget}。请减少条目或提高预算。`);
      }
      const resolved = this.deps.resolveConnection(template.connectionId);
      await this.summarizeIfNeeded(record, resolved.profile, resolved.apiKey, manualLore.content);
      this.assertNotStopped();
      const patch = await this.deps.gateway.generatePatch({
        template,
        record,
        stage,
        connection: resolved.profile,
        apiKey: resolved.apiKey,
        manualLore: manualLore.content,
      });
      this.assertNotStopped();
      const next = applyPatch(record, patch, stage);
      const save = await this.deps.repository.saveRecord(next);
      const warnings: string[] = [];
      if (manualLore.missing.length) warnings.push(`${manualLore.missing.length} 个世界书条目已缺失或停用，已跳过。`);
      if (!save.synced) warnings.push(`账户文件未同步：${save.error || '未知错误'}。已保存在浏览器草稿中。`);
      return { record: next, save, warnings };
    } finally {
      this.operationActive = false;
      this.stopRequested = false;
    }
  }

  private assertNotStopped(): void {
    if (this.stopRequested) throw new GenerationStoppedError();
  }

  private async summarizeIfNeeded(record: CowriteRecord, connection: ConnectionProfile, apiKey: string | undefined, manualLore: string): Promise<void> {
    const serialized = serializeRecordForModel(record);
    const tokens = await this.deps.tavern.countTokens(serialized);
    const budget = Math.min(record.templateSnapshot.context.recordTokenBudget, 12000, Math.floor(this.deps.tavern.maxContext() * 0.4));
    if (tokens <= budget) return;

    const applied = record.cycles.filter((cycle) => cycle.status === 'applied');
    const recentIds = new Set(applied.slice(-3).map((cycle) => cycle.id));
    const startIndex = record.summaryThroughCycle ? applied.findIndex((cycle) => cycle.id === record.summaryThroughCycle) + 1 : 0;
    const eligible = applied.slice(startIndex).filter((cycle) => !recentIds.has(cycle.id));
    if (!eligible.length) {
      throw new Error('这份记录已超过上下文预算，暂时无法压缩。请在设置中提高长记录预算，或从模板库新建一份记录。');
    }
    const eligibleIds = new Set(eligible.map((cycle) => cycle.id));
    const source = JSON.stringify({
      previousSummary: record.rollingSummary || undefined,
      blocks: record.blocks.filter((block) => eligibleIds.has(block.cycleId)),
    }, null, 2);
    const template = record.templateSnapshot;
    const options: Omit<GenerateOptions, 'stage'> = { template, record, connection, apiKey, manualLore };
    record.rollingSummary = await this.deps.gateway.summarize(options, source);
    record.summaryThroughCycle = eligible.at(-1)?.id || '';
    record.updatedAt = new Date().toISOString();
  }

  private assertCanContinue(record: CowriteRecord): void {
    this.assertCharacter(record);
    const missing = record.blocks.filter((block) => block.kind === 'input' && block.input?.required && !isInputAnswered(block));
    if (missing.length) throw new Error(`还有 ${missing.length} 个必填项未完成。`);
  }

  private assertCharacter(record: CowriteRecord): void {
    const character = this.deps.tavern.currentCharacter();
    if (!character || character.id !== record.characterId) throw new Error(`请切换回角色“${record.characterName}”后继续。`);
  }
}

export function applyPatch(record: CowriteRecord, patch: GenerationPatch, stage: GenerationStage, date = new Date().toISOString()): CowriteRecord {
  const next = cloneJson(record);
  const cycleId = crypto.randomUUID();
  const keys = patch.blocks.map((block) => block.key);
  if (new Set(keys).size !== keys.length) throw new Error('模型在同一轮返回了重复的卡片 key，记录未被修改。');
  const keyMap = new Map<string, string>(patch.blocks.map((block) => [block.key, crypto.randomUUID()]));
  const knownIds = new Set(next.blocks.map((block) => block.id));
  const blocks: Block[] = patch.blocks.map((generated) => {
    const targetIds = generated.targetIds.map((target) => keyMap.get(target) || target);
    for (const target of targetIds) {
      if (!knownIds.has(target) && ![...keyMap.values()].includes(target)) {
        throw new Error(`模型评价引用了不存在的卡片：${target}`);
      }
    }
    let input: InputConfig | undefined = generated.input ? { ...generated.input, value: null } : undefined;
    let title = generated.title;
    if (generated.kind === 'answer') {
      const question = next.blocks.find((block) => block.id === targetIds[0])
        || patch.blocks.find((block) => keyMap.get(block.key) === targetIds[0]);
      if (question?.kind !== 'input' || !question.input) throw new Error('角色答案必须关联一张 User 题目卡片。');
      const answerInput = InputConfigSchema.parse({ ...question.input, value: generated.answer });
      if (answerInput.value === null
        || (typeof answerInput.value === 'string' && !answerInput.value.trim())
        || (Array.isArray(answerInput.value) && !answerInput.value.length)
        || (answerInput.type === 'single' && !answerInput.options.includes(String(answerInput.value)))
        || (answerInput.type === 'scale' && typeof answerInput.value === 'number' && !Number.isInteger(answerInput.value - answerInput.min))
        || (answerInput.type === 'multi' && Array.isArray(answerInput.value) && answerInput.value.some((value) => !answerInput.options.includes(value)))) {
        throw new Error('角色答案必须使用对应题目的选项和题型。');
      }
      input = answerInput;
      title = question.title;
    }
    return BlockSchema.parse({
      id: keyMap.get(generated.key),
      cycleId,
      kind: generated.kind,
      author: generated.author,
      title,
      content: generated.content,
      input,
      targetIds,
      createdAt: date,
    });
  });
  next.blocks.push(...blocks);
  next.cycles.push({
    id: cycleId, stage, status: 'applied', blockSnapshot: cloneJson(blocks), createdAt: date,
    previousState: { title: record.title, rollingSummary: record.rollingSummary, summaryThroughCycle: record.summaryThroughCycle },
  });
  if (stage !== 'more' && patch.title?.trim()) next.title = patch.title.trim();
  next.status = patch.complete && stage !== 'more' ? 'completed' : 'active';
  if (patch.summaryUpdate?.trim()) next.rollingSummary = patch.summaryUpdate.trim();
  next.updatedAt = date;
  return RecordSchema.parse(next);
}
