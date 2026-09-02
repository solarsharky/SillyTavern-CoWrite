import { z } from 'zod';
import { GenerationPatchSchema, type ConnectionProfile, type CowriteRecord, type CowriteTemplate, type GenerationPatch } from '../domain/schema';
import { buildStagePrompt, type GenerationStage } from '../core/prompt';
import { DEFAULT_PROTOCOL, PATCH_JSON_SCHEMA, SUMMARY_JSON_SCHEMA } from '../core/protocol';
import type { TavernBridge } from './tavern';

const GENERATION_TIMEOUT_MS = 180_000;

export interface GenerateOptions {
  template: CowriteTemplate;
  record: CowriteRecord;
  stage: GenerationStage;
  connection: ConnectionProfile;
  apiKey?: string;
  manualLore: string;
}

export interface GenerationGateway {
  generatePatch(options: GenerateOptions): Promise<GenerationPatch>;
  summarize(options: Omit<GenerateOptions, 'stage'>, source: string): Promise<string>;
  stop(): Promise<boolean>;
}

export class TavernGenerationGateway implements GenerationGateway {
  private activeGenerationId = '';

  constructor(private readonly tavern: TavernBridge) {}

  async generatePatch(options: GenerateOptions): Promise<GenerationPatch> {
    const generationId = crypto.randomUUID();
    this.activeGenerationId = generationId;
    const protocol = options.template.advancedProtocol?.trim() || DEFAULT_PROTOCOL;
    const raw = await withTimeout(this.tavern.helper.generateRaw({
      generation_id: generationId,
      user_input: buildStagePrompt(options.template, options.record, options.stage),
      ordered_prompts: this.orderedPrompts(options.template, protocol, options.manualLore),
      should_stream: false,
      should_silence: true,
      max_chat_history: options.template.context.recentChatCount,
      custom_api: customApi(options.connection, options.apiKey),
      json_schema: PATCH_JSON_SCHEMA,
    }), GENERATION_TIMEOUT_MS, () => this.tavern.helper.stopGenerationById(generationId)).finally(() => {
      if (this.activeGenerationId === generationId) this.activeGenerationId = '';
    });

    const text = extractContent(raw);
    try {
      return GenerationPatchSchema.parse(parseJson(text));
    } catch (error) {
      return await this.repairPatch(text, error, options);
    }
  }

  async summarize(options: Omit<GenerateOptions, 'stage'>, source: string): Promise<string> {
    const generationId = crypto.randomUUID();
    this.activeGenerationId = generationId;
    const raw = await withTimeout(this.tavern.helper.generateRaw({
      generation_id: generationId,
      user_input: `请把以下共笔早期记录压缩成忠实、可供后续继续写作的摘要。保留关系变化、重要答案、未解决话题和双方语气，不添加新事实。\n\n<record_data>\n${source}\n</record_data>`,
      ordered_prompts: [{ role: 'system', content: '只返回 JSON：{"summary":"..."}。' }, 'user_input'],
      should_stream: false,
      should_silence: true,
      max_chat_history: 0,
      custom_api: customApi(options.connection, options.apiKey),
      json_schema: SUMMARY_JSON_SCHEMA,
    }), GENERATION_TIMEOUT_MS, () => this.tavern.helper.stopGenerationById(generationId)).finally(() => {
      if (this.activeGenerationId === generationId) this.activeGenerationId = '';
    });
    const parsed = z.object({ summary: z.string().min(1).max(12000) }).parse(parseJson(extractContent(raw)));
    return parsed.summary;
  }

  async stop(): Promise<boolean> {
    if (!this.activeGenerationId) return false;
    return await this.tavern.helper.stopGenerationById(this.activeGenerationId);
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
    const repairId = crypto.randomUUID();
    this.activeGenerationId = repairId;
    const repaired = await withTimeout(this.tavern.helper.generateRaw({
      generation_id: repairId,
      user_input: `下列输出无法通过共笔协议。请只修复结构，不改变原意，不补写 User 答案。\n校验错误：${errorText}\n\n原始输出：\n${raw}`,
      ordered_prompts: [{ role: 'system', content: DEFAULT_PROTOCOL }, 'user_input'],
      should_stream: false,
      should_silence: true,
      max_chat_history: 0,
      custom_api: customApi(options.connection, options.apiKey),
      json_schema: PATCH_JSON_SCHEMA,
    }), GENERATION_TIMEOUT_MS, () => this.tavern.helper.stopGenerationById(repairId)).finally(() => {
      if (this.activeGenerationId === repairId) this.activeGenerationId = '';
    });
    try {
      return GenerationPatchSchema.parse(parseJson(extractContent(repaired)));
    } catch (repairError) {
      throw new GenerationOutputError('模型两次返回的卡片结构都无效，记录未被修改。', raw, repairError);
    }
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
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('响应中没有可解析的 JSON 对象');
  }
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
