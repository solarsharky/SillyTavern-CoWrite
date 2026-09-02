<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { WorldbookEntry } from '../adapters/tavern';
import { cloneJson } from '../core/clone';
import { TemplateSchema, type CowriteTemplate, type ManualLoreEntry } from '../domain/schema';

const props = defineProps<{
  template: CowriteTemplate;
  connectionOptions: Array<{ id: string; name: string }>;
  worldbookNames: string[];
  loadWorldbook: (name: string) => Promise<WorldbookEntry[]>;
  actionLabel?: string;
}>();
const emit = defineEmits<{ confirm: [template: CowriteTemplate]; close: [] }>();

const draft = ref(cloneJson(props.template));
const selectedBook = ref('');
const entries = ref<WorldbookEntry[]>([]);
const bookCache = ref<Record<string, WorldbookEntry[]>>({});
const loreBusy = ref(false);
const error = ref('');
const previousChatCount = ref(Math.max(1, draft.value.context.recentChatCount || 12));
const includeRecentChat = computed({
  get: () => draft.value.context.recentChatCount > 0,
  set: (enabled: boolean) => {
    if (enabled) draft.value.context.recentChatCount = previousChatCount.value;
    else {
      if (draft.value.context.recentChatCount > 0) previousChatCount.value = draft.value.context.recentChatCount;
      draft.value.context.recentChatCount = 0;
    }
  },
});
const isManualLore = computed(() => ['manual', 'both'].includes(draft.value.context.worldInfoMode));
const estimatedLoreTokens = computed(() => Math.ceil(draft.value.context.manualEntries.reduce((total, selected) => {
  const entry = bookCache.value[selected.bookName]?.find((item) => item.uid === selected.uid);
  return total + (entry?.enabled ? entry.content.length : 0);
}, 0) / 3));

onMounted(async () => {
  const names = [...new Set(draft.value.context.manualEntries.map((item) => item.bookName))];
  await Promise.all(names.map(async (name) => {
    try { bookCache.value[name] = await props.loadWorldbook(name); }
    catch { bookCache.value[name] = []; }
  }));
});

async function selectBook(): Promise<void> {
  if (!selectedBook.value) {
    entries.value = [];
    return;
  }
  loreBusy.value = true;
  error.value = '';
  try {
    entries.value = await props.loadWorldbook(selectedBook.value);
    bookCache.value[selectedBook.value] = entries.value;
  } catch (caught) {
    entries.value = [];
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    loreBusy.value = false;
  }
}

function isSelected(entry: WorldbookEntry): boolean {
  return draft.value.context.manualEntries.some((item) => item.bookName === selectedBook.value && item.uid === entry.uid);
}

function toggleEntry(entry: WorldbookEntry): void {
  const selected: ManualLoreEntry = { bookName: selectedBook.value, uid: entry.uid, name: entry.name || `条目 ${entry.uid}` };
  const index = draft.value.context.manualEntries.findIndex((item) => item.bookName === selected.bookName && item.uid === selected.uid);
  if (index >= 0) draft.value.context.manualEntries.splice(index, 1);
  else draft.value.context.manualEntries.push(selected);
}

function confirm(): void {
  error.value = '';
  try { emit('confirm', TemplateSchema.parse(draft.value)); }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught); }
}
</script>

<template>
  <div class="cw-editor cw-generation-setup">
    <header class="cw-editor__header">
      <div><span class="cw-kicker">开始前确认</span><h2>{{ draft.name }}</h2></div>
      <button class="cw-icon-btn" title="关闭" @click="emit('close')">×</button>
    </header>

    <div class="cw-editor__scroll">
      <p class="cw-notice">这些选项只控制这份新记录。历史聊天和世界书仅作为模型参考，生成结果仍只写入共笔。</p>

      <section class="cw-editor-section">
        <h3>历史聊天</h3>
        <label class="cw-choice">
          <input v-model="includeRecentChat" type="checkbox" />
          <span>包含当前聊天的近期消息</span>
        </label>
        <label>读取消息数
          <input v-model.number="draft.context.recentChatCount" class="cw-field" type="number" min="1" max="100" :disabled="!includeRecentChat" />
        </label>
        <small>{{ includeRecentChat ? `将通过酒馆助手的 chat_history 位置读取最近 ${draft.context.recentChatCount} 条消息。` : '不会向模型发送历史聊天。' }}</small>
      </section>

      <section class="cw-editor-section">
        <h3>世界书</h3>
        <label>使用方式
          <select v-model="draft.context.worldInfoMode" class="cw-field">
            <option value="active">当前激活世界书</option>
            <option value="manual">仅手选条目</option>
            <option value="both">当前激活＋手选条目</option>
            <option value="off">不使用世界书</option>
          </select>
        </label>
        <p v-if="['active', 'both'].includes(draft.context.worldInfoMode)" class="cw-help">当前激活的世界书会通过 SillyTavern 原生的 world_info_before / world_info_after 位置加入。</p>
        <p v-else-if="draft.context.worldInfoMode === 'off'" class="cw-help">本次生成不会读取世界书。</p>

        <div v-if="isManualLore" class="cw-lore-picker">
          <div class="cw-form-grid">
            <label>选择世界书
              <select v-model="selectedBook" class="cw-field" @change="selectBook">
                <option value="">请选择…</option>
                <option v-for="name in worldbookNames" :key="name" :value="name">{{ name }}</option>
              </select>
            </label>
            <label>手选预算（tokens）<input v-model.number="draft.context.manualLoreTokenBudget" class="cw-field" type="number" min="0" max="50000" /></label>
          </div>
          <p v-if="worldbookNames.length === 0" class="cw-warning">没有读取到可用世界书。请确认酒馆助手版本与当前角色/聊天的世界书设置。</p>
          <p v-else-if="loreBusy">正在读取条目…</p>
          <template v-else>
            <label v-for="entry in entries" :key="entry.uid" class="cw-lore-row" :class="{ 'is-disabled': !entry.enabled }">
              <input type="checkbox" :checked="isSelected(entry)" :disabled="!entry.enabled" @change="toggleEntry(entry)" />
              <span>{{ entry.name || `条目 ${entry.uid}` }}</span>
            </label>
          </template>
          <small>已选 {{ draft.context.manualEntries.length }} 条；已读取内容约 {{ estimatedLoreTokens }} tokens。停用或已删除条目会在生成前再次过滤。</small>
        </div>
      </section>

      <section class="cw-editor-section">
        <h3>连接</h3>
        <label>生成连接
          <select v-model="draft.connectionId" class="cw-field">
            <option v-for="option in connectionOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
        </label>
      </section>

      <p v-if="error" class="cw-error">{{ error }}</p>
    </div>

    <footer class="cw-editor__footer">
      <button class="cw-button cw-button--quiet" @click="emit('close')">取消</button>
      <button class="cw-button cw-button--primary" @click="confirm">{{ actionLabel || '开始生成' }}</button>
    </footer>
  </div>
</template>
