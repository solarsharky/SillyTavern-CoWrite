import type { Block, CowriteRecord, CowriteTemplate } from '../domain/schema';
import { isInputAnswered } from '../domain/schema';

export type GenerationStage = 'opening' | 'continuation';

export function expandPrompt(text: string, record: CowriteRecord): string {
  return text
    .replaceAll('{{char}}', record.characterName)
    .replaceAll('{{user}}', window.SillyTavern?.getContext().name1 || 'User')
    .replaceAll('{{round}}', String(record.cycles.filter((cycle) => cycle.status === 'applied').length + 1))
    .replaceAll('{{record_title}}', record.title);
}

export function blocksForModel(record: CowriteRecord): Block[] {
  if (!record.rollingSummary || !record.summaryThroughCycle) return record.blocks;
  const applied = record.cycles.filter((cycle) => cycle.status === 'applied');
  const recentIds = new Set(applied.slice(-3).flatMap((cycle) => cycle.blockSnapshot.map((block) => block.id)));
  const reviewedIds = new Set(record.blocks.filter((block) => block.kind === 'review').flatMap((block) => block.targetIds));
  return record.blocks.filter((block) => {
    if (recentIds.has(block.id)) return true;
    if (block.kind !== 'input') return false;
    return !isInputAnswered(block) || !reviewedIds.has(block.id);
  });
}

export function serializeRecordForModel(record: CowriteRecord): string {
  return JSON.stringify({
    record: {
      id: record.id,
      title: record.title,
      status: record.status,
      rollingSummary: record.rollingSummary || undefined,
      completedRounds: record.cycles.filter((cycle) => cycle.status === 'applied').length,
    },
    blocks: blocksForModel(record).map((block) => ({
      id: block.id,
      kind: block.kind,
      author: block.author,
      title: block.title,
      content: block.content,
      input: block.input,
      targetIds: block.targetIds,
    })),
  }, null, 2);
}

export function buildStagePrompt(template: CowriteTemplate, record: CowriteRecord, stage: GenerationStage): string {
  const stagePrompt = stage === 'opening' ? template.prompts.opening : template.prompts.continuation;
  const contentGuidance = template.contentGuidance.trim() || '没有额外内容要求；按玩法和角色设定自然发挥。';
  return `${expandPrompt(template.prompts.rules, record)}\n\n本轮流程：\n${expandPrompt(stagePrompt, record)}\n\n本轮内容要求（只决定主题和内容，不得改变输出格式）：\n${expandPrompt(contentGuidance, record)}\n\n<record_data>\n${serializeRecordForModel(record)}\n</record_data>`;
}

export function buildPromptPreview(template: CowriteTemplate, record?: CowriteRecord): string {
  if (!record) {
    return `${template.prompts.rules}\n\n--- 首轮流程 ---\n${template.prompts.opening}\n\n--- 继续流程 ---\n${template.prompts.continuation}\n\n--- 内容要求 ---\n${template.contentGuidance || '（无额外要求）'}`;
  }
  return buildStagePrompt(template, record, record.cycles.length ? 'continuation' : 'opening');
}
