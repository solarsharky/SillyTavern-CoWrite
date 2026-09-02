import type { GenerationGateway, GenerateOptions } from '../adapters/generation';
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
  InputValueSchema,
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
  constructor(private readonly deps: ActivityEngineDependencies) {}

  async start(template: CowriteTemplate): Promise<EngineResult> {
    const character = this.deps.tavern.currentCharacter();
    if (!character) throw new Error('请先打开一个单角色聊天；共笔首版暂不支持群聊。');
    const date = new Date().toISOString();
    const record: CowriteRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: crypto.randomUUID(),
      title: `${template.name} · ${new Date().toLocaleDateString('zh-CN')}`,
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
    return await this.deps.gateway.stop();
  }

  async updateInput(record: CowriteRecord, blockId: string, value: z.infer<typeof InputValueSchema>): Promise<EngineResult> {
    const next = cloneJson(record);
    const block = next.blocks.find((item) => item.id === blockId);
    if (!block || block.kind !== 'input' || !block.input) throw new Error('找不到可编辑的 User 输入卡片。');
    block.input.value = value;
    next.updatedAt = new Date().toISOString();
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async undo(record: CowriteRecord): Promise<EngineResult> {
    const next = cloneJson(record);
    const cycle = [...next.cycles].reverse().find((item) => item.status === 'applied');
    if (!cycle) throw new Error('没有可撤销的生成轮次。');
    const blockIds = new Set(cycle.blockSnapshot.map((block) => block.id));
    cycle.blockSnapshot = next.blocks.filter((block) => blockIds.has(block.id));
    next.blocks = next.blocks.filter((block) => !blockIds.has(block.id));
    cycle.status = 'undone';
    next.status = 'active';
    next.updatedAt = new Date().toISOString();
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async redo(record: CowriteRecord): Promise<EngineResult> {
    const next = cloneJson(record);
    const cycle = next.cycles.find((item) => item.status === 'undone');
    if (!cycle) throw new Error('没有可重做的生成轮次。');
    const cycleIndex = next.cycles.findIndex((item) => item.id === cycle.id);
    if (next.cycles.slice(cycleIndex + 1).some((item) => item.status === 'applied')) {
      throw new Error('撤销后已经产生了新内容，不能再重做旧分支。');
    }
    next.blocks.push(...cycle.blockSnapshot);
    cycle.status = 'applied';
    next.updatedAt = new Date().toISOString();
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async setStatus(record: CowriteRecord, status: CowriteRecord['status']): Promise<EngineResult> {
    const next = { ...cloneJson(record), status, updatedAt: new Date().toISOString() };
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async toggleStar(record: CowriteRecord): Promise<EngineResult> {
    const next = { ...cloneJson(record), starred: !record.starred, updatedAt: new Date().toISOString() };
    return { record: RecordSchema.parse(next), save: await this.deps.repository.saveRecord(next), warnings: [] };
  }

  async createNextVolume(record: CowriteRecord): Promise<EngineResult> {
    const date = new Date().toISOString();
    const next: CowriteRecord = {
      ...cloneJson(record),
      id: crypto.randomUUID(),
      title: `${record.title} · 下一卷`,
      status: 'active',
      blocks: [],
      cycles: [],
      rollingSummary: record.rollingSummary || serializeRecordForModel(record),
      summaryThroughCycle: '',
      parentRecordId: record.id,
      createdAt: date,
      updatedAt: date,
    };
    return await this.runGeneration(next, 'continuation');
  }

  private async runGeneration(source: CowriteRecord, stage: GenerationStage): Promise<EngineResult> {
    const record = cloneJson(source);
    const template = record.templateSnapshot;
    const manualLore = await this.deps.tavern.loadManualLore(template);
    if (manualLore.tokenCount > template.context.manualLoreTokenBudget) {
      throw new Error(`手选世界书约 ${manualLore.tokenCount} tokens，超过模板预算 ${template.context.manualLoreTokenBudget}。请减少条目或提高预算。`);
    }
    const resolved = this.deps.resolveConnection(template.connectionId);
    await this.summarizeIfNeeded(record, resolved.profile, resolved.apiKey, manualLore.content);
    const patch = await this.deps.gateway.generatePatch({
      template,
      record,
      stage,
      connection: resolved.profile,
      apiKey: resolved.apiKey,
      manualLore: manualLore.content,
    });
    const next = applyPatch(record, patch, stage);
    const save = await this.deps.repository.saveRecord(next);
    const warnings: string[] = [];
    if (manualLore.missing.length) warnings.push(`${manualLore.missing.length} 个世界书条目已缺失或停用，已跳过。`);
    if (!save.synced) warnings.push(`账户文件未同步：${save.error || '未知错误'}。已保存在浏览器草稿中。`);
    return { record: next, save, warnings };
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
      throw new Error('记录已超过上下文预算，但还没有可压缩的早期轮次。请提高预算或创建下一卷。');
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
    const saved = await this.deps.repository.saveRecord(record);
    if (!saved.synced && saved.error) console.warn('[CoWrite] 摘要已缓存但尚未同步：', saved.error);
  }

  private assertCanContinue(record: CowriteRecord): void {
    if (record.status === 'archived') throw new Error('归档记录需要先重新打开。');
    if (record.status === 'completed') throw new Error('已完成的记录需要先重新打开。');
    const missing = record.blocks.filter((block) => block.kind === 'input' && block.input?.required && !isInputAnswered(block));
    if (missing.length) throw new Error(`还有 ${missing.length} 个必填项未完成。`);
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
    return BlockSchema.parse({
      id: keyMap.get(generated.key),
      cycleId,
      kind: generated.kind,
      author: generated.author,
      title: generated.title,
      content: generated.content,
      input: generated.input ? { ...generated.input, value: null } : undefined,
      targetIds,
      createdAt: date,
    });
  });
  next.blocks.push(...blocks);
  next.cycles.push({ id: cycleId, stage, status: 'applied', blockSnapshot: cloneJson(blocks), createdAt: date });
  if (patch.title?.trim()) next.title = patch.title.trim();
  if (patch.complete) next.status = 'completed';
  if (patch.summaryUpdate?.trim()) next.rollingSummary = patch.summaryUpdate.trim();
  next.updatedAt = date;
  return RecordSchema.parse(next);
}
