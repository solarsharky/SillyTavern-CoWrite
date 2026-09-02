/// <reference types="vite/client" />

declare global {
type CowriteRolePrompt = { role: 'system' | 'assistant' | 'user'; content: string };
type CowriteOrderedPrompt =
  | 'world_info_before'
  | 'persona_description'
  | 'char_description'
  | 'char_personality'
  | 'scenario'
  | 'world_info_after'
  | 'dialogue_examples'
  | 'chat_history'
  | 'user_input'
  | CowriteRolePrompt;

interface TavernHelperGenerateConfig {
  generation_id?: string;
  user_input?: string;
  ordered_prompts?: CowriteOrderedPrompt[];
  should_stream?: boolean;
  should_silence?: boolean;
  max_chat_history?: 'all' | number;
  custom_api?: {
    apiurl?: string;
    key?: string;
    model?: string;
    source?: string;
    max_tokens?: 'same_as_preset' | 'unset' | number;
    temperature?: 'same_as_preset' | 'unset' | number;
  };
  json_schema?: { name: string; description?: string; value: Record<string, unknown>; strict?: boolean };
}

interface CowriteWorldbookEntry {
  uid: number;
  name: string;
  enabled: boolean;
  content: string;
  [key: string]: unknown;
}

interface TavernHelperInterface {
  generateRaw(config: TavernHelperGenerateConfig): Promise<string | { content: string }>;
  stopGenerationById(id: string): Promise<boolean>;
  getModelList(config: { apiurl: string; key?: string }): Promise<string[]>;
  getWorldbookNames(): string[];
  getWorldbook(name: string): Promise<CowriteWorldbookEntry[]>;
  getCurrentCharacterId(): string | null;
  getTavernHelperVersion(): string;
}

interface SillyTavernContext {
  name1?: string;
  name2?: string;
  groupId?: string | number | null;
  characterId?: number;
  maxContext?: number;
  chat?: Array<{ is_user?: boolean; name?: string; mes?: string }>;
  characters?: Array<Record<string, any>>;
  extensionSettings: Record<string, any>;
  saveSettingsDebounced(): void;
  getRequestHeaders(): Record<string, string>;
  getTokenCountAsync?(text: string): Promise<number>;
  eventSource?: { on(event: string, listener: (...args: any[]) => void): void };
  event_types?: Record<string, string>;
}

  interface Window {
    TavernHelper?: TavernHelperInterface;
    SillyTavern?: { getContext(): SillyTavernContext };
  }
}

export {};
