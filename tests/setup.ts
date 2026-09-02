import 'fake-indexeddb/auto';
import { vi } from 'vitest';

Object.defineProperty(window, 'SillyTavern', {
  configurable: true,
  writable: true,
  value: {
    getContext: () => ({
      name1: '小鱼',
      name2: '阿澜',
      groupId: null,
      characterId: 0,
      maxContext: 32768,
      chat: [],
      characters: [],
      extensionSettings: {},
      saveSettingsDebounced: vi.fn(),
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      getTokenCountAsync: async (text: string) => Math.ceil(text.length / 3),
    }),
  },
});

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:test');
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
