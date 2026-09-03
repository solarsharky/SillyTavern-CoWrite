<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCowriteStore } from '../stores/app';
import type { ConnectionProfile, ManualLoreEntry } from '../domain/schema';
import { cloneJson } from '../core/clone';
import { compareVersion, type WorldbookEntry } from '../adapters/tavern';

const store = useCowriteStore();
const { settings, sessionKeys, helperVersion } = storeToRefs(store);
const connections = ref<ConnectionProfile[]>(cloneJson(settings.value.connections));
const testingId = ref('');
const testMessage = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const helperSupported = computed(() => compareVersion(helperVersion.value, '4.9.3') >= 0);
const selectedBook = ref('');
const entries = ref<WorldbookEntry[]>([]);
const bookCache = ref<Record<string, WorldbookEntry[]>>({});
const loreBusy = ref(false);
const contextMessage = ref('');
const globalPromptMessage = ref('');
const connectionMessage = ref('');
const worldbookNames = computed(() => {
  try { return window.TavernHelper?.getWorldbookNames() || []; } catch { return []; }
});
const isManualLore = computed(() => ['manual', 'both'].includes(settings.value.generationContext.worldInfoMode));
const estimatedLoreTokens = computed(() => Math.ceil(settings.value.generationContext.manualEntries.reduce((total, selected) => {
  const entry = bookCache.value[selected.bookName]?.find((item) => item.uid === selected.uid);
  return total + (entry?.enabled ? entry.content.length : 0);
}, 0) / 3));

watch(() => settings.value.connections, (value) => { connections.value = cloneJson(value); }, { deep: true });

onMounted(async () => {
  const books = [...new Set(settings.value.generationContext.manualEntries.map((item) => item.bookName))];
  await Promise.all(books.map(async (name) => {
    try { bookCache.value[name] = await loadWorldbook(name); } catch { bookCache.value[name] = []; }
  }));
});

async function loadWorldbook(name: string): Promise<WorldbookEntry[]> {
  return await window.TavernHelper?.getWorldbook(name) as WorldbookEntry[] || [];
}

async function selectBook(): Promise<void> {
  if (!selectedBook.value) {
    entries.value = [];
    return;
  }
  loreBusy.value = true;
  contextMessage.value = '';
  try {
    entries.value = await loadWorldbook(selectedBook.value);
    bookCache.value[selectedBook.value] = entries.value;
  } catch (caught) {
    entries.value = [];
    contextMessage.value = caught instanceof Error ? caught.message : String(caught);
  } finally { loreBusy.value = false; }
}

function isSelected(entry: WorldbookEntry): boolean {
  return settings.value.generationContext.manualEntries.some((item) => item.bookName === selectedBook.value && item.uid === entry.uid);
}

function toggleEntry(entry: WorldbookEntry): void {
  const selected: ManualLoreEntry = { bookName: selectedBook.value, uid: entry.uid, name: entry.name || `条目 ${entry.uid}` };
  const list = settings.value.generationContext.manualEntries;
  const index = list.findIndex((item) => item.bookName === selected.bookName && item.uid === selected.uid);
  if (index >= 0) list.splice(index, 1);
  else list.push(selected);
}

function saveContext(): void {
  contextMessage.value = '';
  try {
    store.saveSettings();
    contextMessage.value = '上下文设置已保存，之后所有分类和记录都会使用它。';
  } catch (caught) {
    contextMessage.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function saveGlobalPrompt(): void {
  globalPromptMessage.value = '';
  try {
    store.saveSettings();
    globalPromptMessage.value = '前置和后置 Prompt 已保存，之后所有生成请求都会使用。';
  } catch (caught) {
    globalPromptMessage.value = caught instanceof Error ? caught.message : String(caught);
  }
}

function add(): void {
  connections.value.push(store.addConnection());
}

function remove(id: string): void {
  connections.value = connections.value.filter((item) => item.id !== id);
  if (settings.value.defaultConnectionId === id) settings.value.defaultConnectionId = 'st-main';
}

async function save(): Promise<void> {
  connectionMessage.value = '';
  try {
    await store.saveConnections(connections.value);
    connectionMessage.value = 'API 连接和输出模式已保存。';
  } catch (caught) {
    connectionMessage.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function test(profile: ConnectionProfile): Promise<void> {
  testingId.value = profile.id;
  testMessage.value = '';
  try {
    const models = await store.testConnection(profile);
    testMessage.value = models.length ? `连接成功，读取到 ${models.length} 个模型。` : '跟随 SillyTavern，无需单独测试。';
    if (profile.type === 'custom' && models.length && !models.includes(profile.model)) profile.model = models[0]!;
  } catch (error) {
    testMessage.value = `连接失败：${error instanceof Error ? error.message : String(error)}`;
  } finally { testingId.value = ''; }
}

async function restore(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await store.restoreBackup(await file.text());
  (event.target as HTMLInputElement).value = '';
}
</script>

<template>
  <div class="cw-settings">
    <section class="cw-paper-section">
      <div class="cw-section-title">
        <div><span class="cw-kicker">DEPENDENCY</span><h2>依赖状态</h2></div>
        <span class="cw-status" :class="helperSupported ? 'cw-status--ok' : 'cw-status--warn'">{{ helperSupported ? '依赖正常' : '需要更新' }}</span>
      </div>
      <dl class="cw-dependency-list">
        <div><dt>SillyTavern</dt><dd>需要 1.12.13+</dd></div>
        <div><dt>酒馆助手</dt><dd>{{ helperVersion }}（需要 4.9.3+）</dd></div>
      </dl>
      <p class="cw-help">首版仅支持当前单角色。群聊中可以浏览记录，但不能新建或继续生成。</p>
      <p class="cw-notice"><b>独立工作区：</b>问卷、答案、互评和日记只保存在共笔记录中。插件可以读取你选择的聊天上下文供模型参考，但生成结果从不新增或修改聊天楼层。</p>
    </section>

    <section class="cw-paper-section">
      <div class="cw-section-title"><div><span class="cw-kicker">CONTEXT</span><h2>生成上下文</h2></div></div>
      <p>这里是全局设置，之后从任何格式分类开始或继续记录时都会使用；无需在模板里重复选择。</p>
      <div class="cw-form-grid">
        <label>近期聊天条数
          <input v-model.number="settings.generationContext.recentChatCount" class="cw-field" type="number" min="0" max="100" />
          <small>填 0 表示不读取聊天历史。</small>
        </label>
        <label>世界书方式
          <select v-model="settings.generationContext.worldInfoMode" class="cw-field">
            <option value="active">当前激活世界书</option>
            <option value="manual">仅手选条目</option>
            <option value="both">当前激活＋手选条目</option>
            <option value="off">不使用世界书</option>
          </select>
        </label>
        <label>自动压缩阈值（tokens）
          <input v-model.number="settings.generationContext.recordTokenBudget" class="cw-field" type="number" min="1000" max="1000000" step="1000" />
          <small>默认 120,000，上限 1,000,000，可自行调高或调低；共笔记录超过此值才尝试摘要压缩。保存后，当前记录的下一次生成就会使用新阈值。</small>
        </label>
        <label v-if="isManualLore">手选世界书预算（tokens）<input v-model.number="settings.generationContext.manualLoreTokenBudget" class="cw-field" type="number" min="0" max="50000" /></label>
      </div>
      <p class="cw-help">压缩只影响后续发送给模型的上下文，完整原文仍保留在记录中。API 或酒馆预设中的模型上下文上限需要在对应连接处设置。</p>
      <p v-if="['active', 'both'].includes(settings.generationContext.worldInfoMode)" class="cw-help">当前激活世界书会通过 SillyTavern 原生的 world_info_before / world_info_after 位置读取。</p>
      <div v-if="isManualLore" class="cw-lore-picker">
        <select v-model="selectedBook" class="cw-field" @change="selectBook">
          <option value="">选择世界书…</option>
          <option v-for="name in worldbookNames" :key="name" :value="name">{{ name }}</option>
        </select>
        <p v-if="worldbookNames.length === 0" class="cw-warning">没有读取到可用世界书，请确认酒馆助手和当前聊天的世界书设置。</p>
        <p v-else-if="loreBusy">正在读取条目…</p>
        <template v-else>
          <label v-for="entry in entries" :key="entry.uid" class="cw-lore-row" :class="{ 'is-disabled': !entry.enabled }">
            <input type="checkbox" :checked="isSelected(entry)" :disabled="!entry.enabled" @change="toggleEntry(entry)" />
            <span>{{ entry.name || `条目 ${entry.uid}` }}</span>
          </label>
        </template>
        <small>已选 {{ settings.generationContext.manualEntries.length }} 条；已读取内容约 {{ estimatedLoreTokens }} tokens。停用或删除的条目会在生成前过滤。</small>
      </div>
      <div class="cw-inline-actions"><button class="cw-button cw-button--primary" @click="saveContext">保存上下文设置</button></div>
      <p v-if="contextMessage" class="cw-help">{{ contextMessage }}</p>
    </section>

    <section class="cw-paper-section cw-global-prompt">
      <div class="cw-section-title"><div><span class="cw-kicker">GLOBAL PROMPT</span><h2>全局 Prompt</h2></div></div>
      <p>开头和结尾分别填写，可以同时生效。应用于所有分类、新旧记录，以及重roll、补题、自动修复和长记录摘要；留空的位置不会插入内容。</p>
      <label class="cw-choice"><input v-model="settings.globalPrompt.enabled" type="checkbox" /><span>启用全局 Prompt</span></label>
      <div class="cw-form-grid cw-global-prompt__fields">
        <label class="cw-span-all">最开头的 Prompt
          <textarea v-model="settings.globalPrompt.prefix" class="cw-field cw-field--long" rows="5" placeholder="放在其他所有提示词之前，可单独填写…" />
        </label>
        <label class="cw-span-all">最结尾的 Prompt
          <textarea v-model="settings.globalPrompt.suffix" class="cw-field cw-field--long" rows="5" placeholder="放在其他所有提示词和当前记录之后，可与开头同时填写…" />
        </label>
      </div>
      <p class="cw-help">发送顺序：最开头的 Prompt → 其他提示词与当前记录 → 最结尾的 Prompt。暂停启用时仍会保留已填写的内容。</p>
      <p class="cw-help">支持变量：<span v-pre>{{char}}、{{user}}、{{round}}、{{record_title}}</span>。</p>
      <button class="cw-button cw-button--primary" @click="saveGlobalPrompt">保存全局 Prompt</button>
      <p v-if="globalPromptMessage" class="cw-help" role="status">{{ globalPromptMessage }}</p>
    </section>

    <section class="cw-paper-section">
      <div class="cw-section-title">
        <div><span class="cw-kicker">CONNECTIONS</span><h2>生成连接</h2></div>
        <button class="cw-small-btn" @click="add">＋ 新连接</button>
      </div>
      <p class="cw-warning">独立连接会把所选角色、聊天和世界书上下文发送给对应 API 服务。请确认你信任服务商。</p>

      <article v-for="profile in connections" :key="profile.id" class="cw-connection">
        <template v-if="profile.type === 'st'">
          <div><b>{{ profile.name }}</b><p>使用 SillyTavern 当前连接与预设，不保存额外密钥。</p></div>
          <span class="cw-chip">酒馆连接</span>
        </template>
        <template v-else>
          <div class="cw-form-grid cw-span-all">
            <label>名称<input v-model="profile.name" class="cw-field" /></label>
            <label>Base URL<input v-model="profile.apiUrl" class="cw-field" placeholder="https://…/v1" /></label>
            <label>模型<input v-model="profile.model" class="cw-field" /></label>
            <label>API Key<input v-model="sessionKeys[profile.id]" class="cw-field" type="password" autocomplete="off" /></label>
            <label>温度<input v-model.number="profile.temperature" class="cw-field" type="number" min="0" max="2" step="0.1" /></label>
            <label>最大输出<input v-model.number="profile.maxTokens" class="cw-field" type="number" min="64" /></label>
          </div>
          <label class="cw-choice"><input v-model="profile.rememberKey" type="checkbox" /><span>记住密钥（明文保存在此浏览器，不进入账户文件或备份）</span></label>
          <div class="cw-inline-actions">
            <button class="cw-small-btn" :disabled="testingId === profile.id" @click="test(profile)">{{ testingId === profile.id ? '测试中…' : '测试连接' }}</button>
            <button class="cw-small-btn cw-small-btn--danger" @click="remove(profile.id)">移除</button>
          </div>
        </template>
        <label class="cw-connection-mode">输出模式
          <select v-model="profile.streaming" class="cw-field" :aria-label="`${profile.name}的输出模式`">
            <option :value="false">非流式输出</option>
            <option :value="true">流式输出</option>
          </select>
          <small>流式会显示接收进度；完整结果返回后统一显示题目。适用于这个连接的所有请求。</small>
        </label>
      </article>
      <p v-if="testMessage" class="cw-help">{{ testMessage }}</p>
      <div class="cw-form-grid">
        <label>全局默认连接
          <select v-model="settings.defaultConnectionId" class="cw-field">
            <option v-for="profile in connections" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="cw-choice cw-choice--setting"><input v-model="settings.ui.edgeTuck" type="checkbox" /><span>悬浮按钮靠边时自动收纳</span></label>
      </div>
      <button class="cw-button cw-button--primary" @click="save">保存设置</button>
      <p v-if="connectionMessage" class="cw-help" role="status">{{ connectionMessage }}</p>
    </section>

    <section class="cw-paper-section">
      <div class="cw-section-title"><div><span class="cw-kicker">BACKUP</span><h2>备份与恢复</h2></div></div>
      <p>整库备份包含格式分类、内容项、记录和不含密钥的设置。建议在批量整理或更新前下载一份。</p>
      <div class="cw-inline-actions">
        <button class="cw-button cw-button--quiet" @click="store.exportBackup">下载整库备份</button>
        <button class="cw-button cw-button--quiet" @click="importInput?.click()">从备份恢复</button>
        <input ref="importInput" class="cw-hidden" type="file" accept="application/json,.json" @change="restore" />
        <button class="cw-button cw-button--quiet" @click="store.restoreBuiltinTemplates">恢复内置格式分类</button>
      </div>
    </section>

    <section class="cw-paper-section">
      <span class="cw-kicker">ABOUT</span>
      <h2>共笔 v0.1.0-beta.13</h2>
      <p>作者 SolarShark · MIT License</p>
      <a href="https://github.com/solarsharky/SillyTavern-CoWrite/issues" target="_blank" rel="noreferrer">反馈问题或建议 ↗</a>
    </section>
  </div>
</template>
