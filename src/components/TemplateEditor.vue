<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { DEFAULT_PROTOCOL } from '../core/protocol';
import { TemplateSchema, type CowriteTemplate, type ManualLoreEntry } from '../domain/schema';
import type { WorldbookEntry } from '../adapters/tavern';

const props = defineProps<{
  modelValue: CowriteTemplate;
  connectionOptions: Array<{ id: string; name: string }>;
  promptPreview: string;
  worldbookNames: string[];
  loadWorldbook: (name: string) => Promise<WorldbookEntry[]>;
}>();
const emit = defineEmits<{ save: [template: CowriteTemplate]; close: [] }>();

const draft = ref<CowriteTemplate>(structuredClone(props.modelValue));
const advancedOpen = ref(false);
const advancedConfirmed = ref(false);
const selectedBook = ref('');
const entries = ref<WorldbookEntry[]>([]);
const bookCache = ref<Record<string, WorldbookEntry[]>>({});
const loreBusy = ref(false);
const editorError = ref('');

watch(() => props.modelValue, (value) => { draft.value = structuredClone(value); }, { deep: true });
const isManualLore = computed(() => ['manual', 'both'].includes(draft.value.context.worldInfoMode));
const estimatedLoreTokens = computed(() => Math.ceil(draft.value.context.manualEntries.reduce((total, selected) => {
  const entry = bookCache.value[selected.bookName]?.find((item) => item.uid === selected.uid);
  return total + (entry?.enabled ? entry.content.length : 0);
}, 0) / 3));

onMounted(async () => {
  const names = [...new Set(draft.value.context.manualEntries.map((item) => item.bookName))];
  await Promise.all(names.map(async (name) => {
    try { bookCache.value[name] = await props.loadWorldbook(name); } catch { bookCache.value[name] = []; }
  }));
});

async function selectBook(): Promise<void> {
  if (!selectedBook.value) return;
  loreBusy.value = true;
  try {
    entries.value = await props.loadWorldbook(selectedBook.value);
    bookCache.value[selectedBook.value] = entries.value;
  }
  finally { loreBusy.value = false; }
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

function save(): void {
  editorError.value = '';
  try { emit('save', TemplateSchema.parse(draft.value)); }
  catch (error) { editorError.value = error instanceof Error ? error.message : String(error); }
}
</script>

<template>
  <div class="cw-editor">
    <header class="cw-editor__header">
      <div>
        <span class="cw-kicker">模板编辑器</span>
        <h2>{{ draft.name }}</h2>
      </div>
      <button class="cw-icon-btn" title="关闭" @click="emit('close')">×</button>
    </header>

    <div class="cw-editor__scroll">
      <div class="cw-form-grid">
        <label>模板名称<input v-model="draft.name" class="cw-field" maxlength="80" /></label>
        <label>图标<input v-model="draft.icon" class="cw-field" maxlength="8" /></label>
        <label>强调色<input v-model="draft.accent" class="cw-field cw-color" type="color" /></label>
        <label class="cw-span-2">说明<textarea v-model="draft.description" class="cw-field" rows="2" /></label>
      </div>

      <section class="cw-editor-section">
        <h3>提示词</h3>
        <p class="cw-help">可用变量：<code v-text="'{{char}}'" />、<code v-text="'{{user}}'" />、<code v-text="'{{round}}'" />、<code v-text="'{{record_title}}'" /></p>
        <label>共同规则<textarea v-model="draft.prompts.rules" class="cw-field cw-code" rows="6" /></label>
        <label>首轮提示词<textarea v-model="draft.prompts.opening" class="cw-field cw-code" rows="6" /></label>
        <label>继续提示词<textarea v-model="draft.prompts.continuation" class="cw-field cw-code" rows="7" /></label>
      </section>

      <section class="cw-editor-section">
        <h3>上下文与连接</h3>
        <div class="cw-form-grid">
          <label>近期聊天条数<input v-model.number="draft.context.recentChatCount" class="cw-field" type="number" min="0" max="100" /></label>
          <label>生成连接
            <select v-model="draft.connectionId" class="cw-field">
              <option v-for="option in connectionOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
            </select>
          </label>
          <label>记录预算（tokens）<input v-model.number="draft.context.recordTokenBudget" class="cw-field" type="number" min="1000" max="200000" /></label>
          <label>世界书方式
            <select v-model="draft.context.worldInfoMode" class="cw-field">
              <option value="active">当前激活世界书</option>
              <option value="manual">仅手选条目</option>
              <option value="both">激活＋手选</option>
              <option value="off">不使用世界书</option>
            </select>
          </label>
          <label v-if="isManualLore">手选预算（tokens）<input v-model.number="draft.context.manualLoreTokenBudget" class="cw-field" type="number" min="0" /></label>
        </div>
        <div v-if="isManualLore" class="cw-lore-picker">
          <select v-model="selectedBook" class="cw-field" @change="selectBook">
            <option value="">选择世界书…</option>
            <option v-for="name in worldbookNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <p v-if="loreBusy">正在读取条目…</p>
          <label v-for="entry in entries" v-else :key="entry.uid" class="cw-lore-row" :class="{ 'is-disabled': !entry.enabled }">
            <input type="checkbox" :checked="isSelected(entry)" :disabled="!entry.enabled" @change="toggleEntry(entry)" />
            <span>{{ entry.name || `条目 ${entry.uid}` }}</span>
          </label>
          <small>已选择 {{ draft.context.manualEntries.length }} 条，已读取内容约 {{ estimatedLoreTokens }} tokens；生成时会跳过已删除或停用的条目。</small>
        </div>
      </section>

      <details class="cw-editor-section">
        <summary>最终提示词预览</summary>
        <pre class="cw-preview">{{ promptPreview }}</pre>
      </details>

      <section class="cw-editor-section cw-danger-zone">
        <button class="cw-link-btn" @click="advancedOpen = !advancedOpen">{{ advancedOpen ? '收起' : '高级：编辑核心 JSON 协议' }}</button>
        <div v-if="advancedOpen">
          <p class="cw-warning">错误的协议可能让模型无法生成。结构校验、User 内容保护和事务规则不会因此关闭。</p>
          <label v-if="!advancedConfirmed" class="cw-choice">
            <input v-model="advancedConfirmed" type="checkbox" />
            <span>我知道风险，允许编辑本模板的协议</span>
          </label>
          <textarea v-model="draft.advancedProtocol" class="cw-field cw-code" rows="12" :readonly="!advancedConfirmed" :placeholder="DEFAULT_PROTOCOL" />
          <button class="cw-small-btn" @click="draft.advancedProtocol = DEFAULT_PROTOCOL">恢复默认协议</button>
        </div>
      </section>
      <p v-if="editorError" class="cw-error">{{ editorError }}</p>
    </div>

    <footer class="cw-editor__footer">
      <button class="cw-button cw-button--quiet" @click="emit('close')">取消</button>
      <button class="cw-button cw-button--primary" @click="save">保存模板</button>
    </footer>
  </div>
</template>
