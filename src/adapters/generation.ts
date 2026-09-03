import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { GenerationPatchSchema, type ConnectionProfile, type CowriteRecord, type CowriteTemplate, type GenerationPatch, type GlobalPrompt } from '../domain/schema';
import { buildStagePrompt, withGlobalPrompts, type GenerationStage } from '../core/prompt';
import { DEFAULT_PROTOCOL, PATCH_JSON_SCHEMA, SUMMARY_JSON_SCHEMA } from '../core/protocol';
import type { TavernBridge } from './tavern';
import { BUILTIN_TEMPLATES } from '../domain/defaults';

const GENERATION_TIMEOUT_MS = 180_000;

export interface GenerateOptions {
  template: CowriteTemplate;
  record: CowriteRecord;
  stage: GenerationStage;
  connection: ConnectionProfile;
  apiKey?: string;
  manualLore: string;
  globalPrompt?: GlobalPrompt;
}

export interface GenerationProgress {
  phase: 'writing' | 'summary' | 'repair';
  streaming: boolean;
  receivedCharacters: number;
}

export interface GenerationGateway {
  generatePatch(options: GenerateOptions): Promise<GenerationPatch>;
  summarize(options: Omit<GenerateOptions, 'stage'>, source: string): Promise<string>;
  stop(): Promise<boolean>;
}

export class TavernGenerationGateway implements GenerationGateway {
  private activeGenerationId = '';
  private readonly cancelledGenerationIds = new Set<string>();
  private activeCancellation: { id: string; cancel: () => void } | null = null;

  constructor(private readonly tavern: TavernBridge, private readonly onProgress?: (progress: GenerationProgress | null) => void) {}

  async generatePatch(options: GenerateOptions): Promise<GenerationPatch> {
    const protocol = options.template.advancedProtocol?.trim() || DEFAULT_PROTOCOL;
    const raw = await this.request(options, 'writing', {
      user_input: buildStagePrompt(options.template, options.record, options.stage),
      ordered_prompts: this.orderedPrompts(options.template, protocol, options.manualLore),
      max_chat_history: options.template.context.recentChatCount,
      json_schema: PATCH_JSON_SCHEMA,
    });

    const text = extractContent(raw);
    try {
      return parsePatchForRequest(text, options);
    } catch (error) {
      return await this.repairPatch(text, error, options);
    }
  }

  async summarize(options: Omit<GenerateOptions, 'stage'>, source: string): Promise<string> {
    const raw = await this.request(options, 'summary', {
      user_input: `请把以下共笔早期记录压缩成忠实、可供后续继续写作的摘要。保留关系变化、重要答案、未解决话题和双方语气，不添加新事实。\n\n<record_data>\n${source}\n</record_data>`,
      ordered_prompts: [{ role: 'system', content: '只返回 JSON：{"summary":"..."}。' }, 'user_input'],
      max_chat_history: 0,
      json_schema: SUMMARY_JSON_SCHEMA,
    });
    const parsed = z.object({ summary: z.string().min(1).max(12000) }).parse(parseJson(extractContent(raw)));
    return parsed.summary;
  }

  async stop(): Promise<boolean> {
    if (!this.activeGenerationId) return false;
    const generationId = this.activeGenerationId;
    this.cancelledGenerationIds.add(generationId);
    if (this.activeCancellation?.id === generationId) this.activeCancellation.cancel();
    try { await this.tavern.helper.stopGenerationById(generationId); }
    catch (error) { console.warn('[CoWrite] 酒馆助手停止请求报错；本地仍会丢弃本轮响应。', error); }
    return true;
  }

  private orderedPrompts(template: CowriteTemplate, protocol: string, manualLore: string): CowriteOrderedPrompt[] {
    const prompts: CowriteOrderedPrompt[] = [{ role: 'system', content: protocol }];
    const activeLore = ['active', 'both'].includes(template.context.worldInfoMode);
    if (activeLore) prompts.push('world_info_before');
    prompts.push('persona_description', 'char_description', 'char_personality', 'scenario');
    if (activeLore) prompts.push('world_info_after');
    if (manualLore.trim()) prompts.push({ role: 'system', content: `以下是用户手动选择的世界书条目：\n${manualLore}` });
    if (template.context.recentChatCount > 0) prompts.push('chat_history');
    prompts.push('user_input');
    return prompts;
  }

  private async repairPatch(raw: string, validationError: unknown, options: GenerateOptions): Promise<GenerationPatch> {
    const errorText = validationError instanceof Error ? validationError.message : String(validationError);
    const repaired = await this.request(options, 'repair', {
      user_input: `下列输出无法通过共笔协议。请只修复结构，不改变原意，不补写 User 答案。\n校验错误：${errorText}\n\n原始输出：\n${raw}`,
      ordered_prompts: [{ role: 'system', content: DEFAULT_PROTOCOL }, 'user_input'],
      max_chat_history: 0,
      json_schema: PATCH_JSON_SCHEMA,
    });
    try {
      return parsePatchForRequest(extractContent(repaired), options);
    } catch (repairError) {
      throw new GenerationOutputError('模型两次返回的卡片结构都无效，记录未被修改。', raw, repairError);
    }
  }

  private async request(options: Omit<GenerateOptions, 'stage'>, phase: GenerationProgress['phase'], config: TavernHelperGenerateConfig): Promise<string | { content: string }> {
    const generationId = crypto.randomUUID();
    const streaming = options.connection.streaming;
    this.activeGenerationId = generationId;
    let unsubscribe = () => {};
    try {
      this.onProgress?.({ phase, streaming, receivedCharacters: 0 });
      if (streaming) {
        unsubscribe = this.tavern.subscribeToStream((text, id) => {
          if (id !== generationId || this.activeGenerationId !== id || this.cancelledGenerationIds.has(id) || typeof text !== 'string') return;
          this.onProgress?.({ phase, streaming, receivedCharacters: text.length });
        });
      }
      return await this.awaitResponse(generationId, () => this.tavern.helper.generateRaw({
        ...config,
        generation_id: generationId,
        ordered_prompts: withGlobalPrompts(config.ordered_prompts || ['user_input'], options.globalPrompt, options.record),
        should_stream: streaming,
        should_silence: true,
        custom_api: customApi(options.connection, options.apiKey),
      }));
    } finally {
      unsubscribe();
      if (this.activeGenerationId === generationId) this.activeGenerationId = '';
      this.onProgress?.(null);
    }
  }

  private async awaitResponse(generationId: string, request: () => Promise<string | { content: string }>): Promise<string | { content: string }> {
    const cancellation = new Promise<never>((_, reject) => {
      this.activeCancellation = { id: generationId, cancel: () => reject(new GenerationStoppedError()) };
    });
    try {
      const response = await withTimeout(Promise.race([request(), cancellation]), GENERATION_TIMEOUT_MS, () => this.tavern.helper.stopGenerationById(generationId));
      if (this.cancelledGenerationIds.has(generationId)) throw new GenerationStoppedError();
      return response;
    } catch (error) {
      if (this.cancelledGenerationIds.has(generationId)) throw new GenerationStoppedError();
      throw error;
    } finally {
      this.cancelledGenerationIds.delete(generationId);
      if (this.activeCancellation?.id === generationId) this.activeCancellation = null;
      if (this.activeGenerationId === generationId) this.activeGenerationId = '';
    }
  }
}

export class GenerationStoppedError extends Error {
  constructor() {
    super('已停止本轮生成；收到的后续响应已丢弃，记录没有被修改。');
    this.name = 'GenerationStoppedError';
  }
}

export class GenerationOutputError extends Error {
  constructor(message: string, readonly rawOutput: string, options?: unknown) {
    super(message, options instanceof Error ? { cause: options } : undefined);
    this.name = 'GenerationOutputError';
  }
}

function customApi(connection: ConnectionProfile, key?: string): TavernHelperGenerateConfig['custom_api'] | undefined {
  if (connection.type === 'st') return undefined;
  return {
    apiurl: connection.apiUrl,
    key: key || '',
    model: connection.model,
    source: 'openai',
    temperature: connection.temperature,
    max_tokens: connection.maxTokens,
  };
}

function extractContent(raw: string | { content: string }): string {
  return typeof raw === 'string' ? raw : raw.content;
}

export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (originalError) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); }
      catch { /* Continue with tolerant repair below. */ }
    }
    try {
      return JSON.parse(jsonrepair(trimmed));
    } catch {
      throw new Error('响应中没有可解析的 JSON 对象', { cause: originalError });
    }
  }
}

export function parseGenerationPatch(text: string): GenerationPatch {
  return GenerationPatchSchema.parse(normalizeGenerationPatch(parseJson(text)));
}

function parsePatchForRequest(text: string, options: GenerateOptions): GenerationPatch {
  const patch = parseGenerationPatch(text);
  const shared = BUILTIN_TEMPLATES.find((template) => template.id === 'builtin-shared-questionnaire')!;
  if (options.stage !== 'continuation' && options.template.id === shared.id && options.template.prompts.opening === shared.prompts.opening) {
    const questions = patch.blocks.filter((block) => block.kind === 'input');
    if (!questions.length || questions.some((question) => !patch.blocks.some((block) => block.kind === 'answer' && block.targetIds[0] === question.key))) {
      throw new Error('双人问卷首轮必须出题，并为每道 User input 同时返回一张 Char answer 卡片；answer.targetIds 引用该题 key，answer 字段填写 Char 自己的答案。');
    }
  }
  return patch;
}

function normalizeGenerationPatch(input: unknown): unknown {
  const source = Array.isArray(input) ? { blocks: input, complete: false } : input;
  if (!source || typeof source !== 'object') return source;
  const record = source as Record<string, unknown>;
  const rawBlocks = Array.isArray(record.blocks)
    ? record.blocks
    : Array.isArray(record.questions) ? record.questions : undefined;
  if (!rawBlocks) return source;

  const blocks = rawBlocks.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const block = { ...(item as Record<string, unknown>) };
    const inputConfig = block.input && typeof block.input === 'object'
      ? { ...(block.input as Record<string, unknown>) }
      : undefined;
    if (block.kind === 'question' && inputConfig) block.kind = 'input';
    if (block.kind === 'input') block.author = 'user';
    if (typeof block.content !== 'string') {
      block.content = typeof block.value === 'string'
        ? block.value
        : typeof block.text === 'string' ? block.text : '';
    }
    if (inputConfig) {
      const aliases: Record<string, string> = { text: 'short', textarea: 'long', radio: 'single', checkbox: 'multi' };
      if (typeof inputConfig.type === 'string' && aliases[inputConfig.type]) inputConfig.type = aliases[inputConfig.type];
      const label = typeof inputConfig.label === 'string' ? inputConfig.label.trim() : '';
      if (!label || /^(请填写|请作答|回答|作答)$/.test(label)) {
        const fallback = [block.question, block.title, block.content]
          .find((value) => typeof value === 'string' && value.trim() && !/^(请填写|请作答|回答|作答)$/.test(value.trim()));
        if (typeof fallback === 'string') inputConfig.label = fallback;
      }
      delete inputConfig.value;
      block.input = inputConfig;
    }
    return block;
  });
  return { ...record, blocks, complete: typeof record.complete === 'boolean' ? record.complete : false };
}

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number, onTimeout: () => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout();
      reject(new Error(`生成请求超过 ${Math.round(milliseconds / 1000)} 秒，已停止且未写入记录。`));
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
