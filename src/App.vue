<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import BlockCard from './components/BlockCard.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TemplateEditor from './components/TemplateEditor.vue';
import { cloneBuiltinTemplate } from './domain/defaults';
import type { CowriteRecord, CowriteTemplate, InputConfig } from './domain/schema';
import type { WorldbookEntry } from './adapters/tavern';
import { useCowriteStore, type AppTab } from './stores/app';
import { cloneJson } from './core/clone';

const store = useCowriteStore();
const {
  busy, open, tab, error, notices, rawOutput, records, unsyncedRecordIds, templates, selectedRecordId, selectedRecord,
  characterId, characterName, settings, canGenerate,
} = storeToRefs(store);

const fab = ref<HTMLElement | null>(null);
const templateEditor = ref<CowriteTemplate | null>(null);
const templateImport = ref<HTMLInputElement | null>(null);
const recordImport = ref<HTMLInputElement | null>(null);
const query = ref('');
const statusFilter = ref('all');
const templateFilter = ref('all');
const dateFilter = ref('');
const editorPreview = computed(() => templateEditor.value ? store.preview(templateEditor.value) : '');
const worldbookNames = computed(() => {
  try { return window.TavernHelper?.getWorldbookNames() || []; } catch { return []; }
});
const sortedTemplates = computed(() => [...templates.value].sort((a, b) => Number(b.starred) - Number(a.starred)));
const filteredRecords = computed(() => records.value.filter((record) => {
  const text = `${record.title} ${record.characterName} ${record.templateSnapshot.name}`.toLocaleLowerCase();
  if (query.value && !text.includes(query.value.toLocaleLowerCase())) return false;
  if (statusFilter.value !== 'all' && record.status !== statusFilter.value) return false;
  if (templateFilter.value !== 'all' && record.templateId !== templateFilter.value) return false;
  return !dateFilter.value || record.updatedAt.slice(0, 10) >= dateFilter.value;
}));
const blockLabels = computed(() => new Map(selectedRecord.value?.blocks.map((block, index) => [block.id, block.title || block.input?.label || `卡片 ${index + 1}`]) || []));

let pointerId = -1;
let dragStart = { x: 0, y: 0, left: 0, top: 0 };
let moved = false;

onMounted(async () => {
  await nextTick();
  placeFab();
  window.addEventListener('resize', placeFab);
  window.addEventListener('cowrite:open', openFromLauncher);
  const context = window.SillyTavern?.getContext();
  const chatChanged = context?.event_types?.CHAT_CHANGED;
  if (chatChanged) context.eventSource?.on(chatChanged, () => store.refreshCharacter());
  void store.initialize().then(() => placeFab());
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', placeFab);
  window.removeEventListener('cowrite:open', openFromLauncher);
});

function openFromLauncher(): void {
  open.value = true;
}

function placeFab(): void {
  if (!fab.value) return;
  const size = fab.value.offsetWidth || 52;
  const x = settings.value.ui.x ?? window.innerWidth - size - 18;
  const y = settings.value.ui.y ?? Math.max(80, window.innerHeight * 0.56);
  const tuck = settings.value.ui.edgeTuck ? size * .34 : 0;
  fab.value.style.left = `${Math.min(Math.max(-tuck, x), window.innerWidth - size + tuck)}px`;
  fab.value.style.top = `${Math.min(Math.max(8, y), window.innerHeight - size - 8)}px`;
}

function pointerDown(event: PointerEvent): void {
  if (!fab.value) return;
  pointerId = event.pointerId;
  moved = false;
  dragStart = { x: event.clientX, y: event.clientY, left: fab.value.offsetLeft, top: fab.value.offsetTop };
  fab.value.setPointerCapture(pointerId);
}

function pointerMove(event: PointerEvent): void {
  if (!fab.value || event.pointerId !== pointerId) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
  const size = fab.value.offsetWidth;
  fab.value.style.left = `${Math.min(Math.max(0, dragStart.left + dx), window.innerWidth - size)}px`;
  fab.value.style.top = `${Math.min(Math.max(8, dragStart.top + dy), window.innerHeight - size - 8)}px`;
}

function pointerUp(event: PointerEvent): void {
  if (!fab.value || event.pointerId !== pointerId) return;
  if (moved) {
    let x = fab.value.offsetLeft;
    const y = fab.value.offsetTop;
    if (settings.value.ui.edgeTuck) {
      x = x + fab.value.offsetWidth / 2 < window.innerWidth / 2 ? -fab.value.offsetWidth * .34 : window.innerWidth - fab.value.offsetWidth * .66;
      fab.value.style.left = `${x}px`;
    }
    store.saveUiPosition(x, y);
  }
  fab.value.releasePointerCapture(pointerId);
  pointerId = -1;
}

function activateFab(): void {
  if (moved) {
    moved = false;
    return;
  }
  open.value = !open.value;
}

function selectTab(value: AppTab): void {
  tab.value = value;
  store.clearMessages();
}

function openTemplateEditor(template: CowriteTemplate): void {
  templateEditor.value = template.builtin
    ? cloneBuiltinTemplate(template, crypto.randomUUID())
    : cloneJson(template);
}

function createTemplate(): void {
  const source = templates.value[0];
  if (!source) return;
  const draft = cloneBuiltinTemplate(source, crypto.randomUUID());
  draft.name = '我的新模板';
  draft.description = '';
  templateEditor.value = draft;
}

async function saveTemplate(template: CowriteTemplate): Promise<void> {
  await store.saveTemplate(template);
  templateEditor.value = null;
}

async function importTemplateFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) await store.importTemplateJson(await file.text());
  (event.target as HTMLInputElement).value = '';
}

async function importRecordFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) await store.importRecordJson(await file.text());
  (event.target as HTMLInputElement).value = '';
}

async function loadWorldbook(name: string): Promise<WorldbookEntry[]> {
  return await window.TavernHelper?.getWorldbook(name) as WorldbookEntry[] || [];
}

function selectRecord(record: CowriteRecord): void {
  selectedRecordId.value = record.id;
  tab.value = 'current';
}

async function removeRecord(record: CowriteRecord): Promise<void> {
  if (window.confirm(`确定删除“${record.title}”吗？这会删除账户文件，无法在插件内撤销。`)) await store.removeRecord(record);
}

async function removeTemplate(template: CowriteTemplate): Promise<void> {
  if (window.confirm(`确定删除模板“${template.name}”吗？已有记录不会受影响。`)) await store.removeTemplate(template);
}

function commitInput(blockId: string, value: InputConfig['value']): void {
  void store.commitInput(blockId, value);
}

function statusLabel(status: CowriteRecord['status']): string {
  return status === 'active' ? '进行中' : status === 'completed' ? '已完成' : '已归档';
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="cw-root">
    <button
      ref="fab"
      class="cw-fab"
      :class="{ 'is-open': open, 'is-busy': busy }"
      title="打开共笔"
      aria-label="打开共笔"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @click="activateFab"
    ><span>共</span></button>

    <div v-if="open" class="cw-backdrop" @mousedown.self="open = false">
      <main class="cw-window" role="dialog" aria-modal="true" aria-label="共笔">
        <header class="cw-topbar">
          <div class="cw-brand"><span class="cw-brand__seal">共</span><div><h1>共笔</h1><small>和 {{ characterName || '某个角色' }} 一起记点什么</small></div></div>
          <div class="cw-topbar__actions">
            <span v-if="!characterId" class="cw-status cw-status--warn">只读模式</span>
            <button class="cw-icon-btn" title="关闭" @click="open = false">×</button>
          </div>
        </header>

        <nav class="cw-tabs" aria-label="共笔页面">
          <button v-for="item in ([['current','当前记录'],['templates','模板库'],['records','记录库'],['settings','设置']] as const)" :key="item[0]" :class="{ active: tab === item[0] }" @click="selectTab(item[0])">{{ item[1] }}</button>
        </nav>

        <div v-if="error || notices.length" class="cw-messages">
          <div v-if="error" class="cw-error"><b>没有写入本轮：</b>{{ error }} <button v-if="rawOutput" class="cw-link-btn" @click="store.exportRawOutput">下载原始响应</button></div>
          <div v-for="notice in notices" :key="notice" class="cw-notice">{{ notice }}</div>
        </div>

        <div class="cw-content">
          <section v-if="tab === 'current'" class="cw-current">
            <template v-if="selectedRecord">
              <header class="cw-record-heading">
                <div><span class="cw-kicker">{{ selectedRecord.templateSnapshot.name }} · {{ statusLabel(selectedRecord.status) }}</span><h2>{{ selectedRecord.title }}</h2><p>与 {{ selectedRecord.characterName }} · 更新于 {{ dateLabel(selectedRecord.updatedAt) }}</p></div>
                <button class="cw-star" :class="{ active: selectedRecord.starred }" title="星标" @click="store.toggleRecordStar()">★</button>
              </header>

              <div v-if="selectedRecord.blocks.length" class="cw-page-stack">
                <BlockCard
                  v-for="block in selectedRecord.blocks"
                  :key="block.id"
                  :block="block"
                  :character-name="selectedRecord.characterName"
                  :disabled="busy || selectedRecord.status !== 'active'"
                  :target-labels="block.targetIds.map(id => blockLabels.get(id) || id)"
                  @commit="commitInput"
                />
              </div>
              <div v-else class="cw-empty"><span>📝</span><h3>这一页还是空的</h3><p>上次生成可能没有完成，可以重试或删除这份记录。</p></div>

              <footer class="cw-actionbar">
                <button v-if="busy" class="cw-button cw-button--danger" @click="store.stopGeneration">停止生成</button>
                <button v-else-if="selectedRecord.status === 'active'" class="cw-button cw-button--primary" :disabled="!canGenerate" @click="store.continueRecord">{{ selectedRecord.blocks.length ? '继续写一轮' : '重试首轮' }}</button>
                <button v-if="unsyncedRecordIds.includes(selectedRecord.id)" class="cw-button cw-button--danger" @click="store.retrySync()">重试同步</button>
                <button class="cw-button cw-button--quiet" :disabled="busy" @click="store.undo">撤销本轮</button>
                <button class="cw-button cw-button--quiet" :disabled="busy" @click="store.redo">重做</button>
                <button v-if="selectedRecord.status === 'active'" class="cw-button cw-button--quiet" @click="store.setRecordStatus('completed')">完成</button>
                <button v-else-if="selectedRecord.status === 'completed'" class="cw-button cw-button--quiet" @click="store.setRecordStatus('active')">重新打开</button>
                <button v-if="selectedRecord.status === 'archived'" class="cw-button cw-button--quiet" @click="store.setRecordStatus('active')">取消归档</button>
                <button v-else class="cw-button cw-button--quiet" @click="store.setRecordStatus('archived')">归档</button>
                <button class="cw-button cw-button--quiet" @click="store.nextVolume">下一卷</button>
              </footer>
            </template>
            <div v-else class="cw-welcome">
              <span class="cw-welcome__mark">✦</span><h2>{{ characterId ? `和 ${characterName} 开始一份共笔` : '先打开一个单角色聊天' }}</h2>
              <p>{{ characterId ? '选一个玩法，首轮内容会在独立工作区生成，不会改动聊天楼层。' : '群聊或没有当前角色时仍可到记录库浏览旧记录。' }}</p>
              <div v-if="characterId" class="cw-template-quick">
                <button v-for="template in templates.slice(0, 3)" :key="template.id" :style="{ '--accent': template.accent }" :disabled="busy" @click="store.start(template)"><span>{{ template.icon }}</span><b>{{ template.name }}</b><small>{{ template.description }}</small></button>
              </div>
            </div>
          </section>

          <section v-else-if="tab === 'templates'" class="cw-library">
            <header class="cw-page-header"><div><span class="cw-kicker">PLAYBOOKS</span><h2>模板库</h2><p>内置玩法可以直接开始，也可以复制后改成自己的规则。</p></div><div class="cw-inline-actions"><button class="cw-small-btn" @click="templateImport?.click()">导入</button><button class="cw-button cw-button--primary" @click="createTemplate">＋ 新模板</button><input ref="templateImport" class="cw-hidden" type="file" accept="application/json,.json" @change="importTemplateFile" /></div></header>
            <div class="cw-template-grid">
              <article v-for="template in sortedTemplates" :key="template.id" class="cw-template-card" :style="{ '--accent': template.accent }">
                <div class="cw-template-card__top"><span class="cw-template-card__icon">{{ template.icon }}</span><button class="cw-star" :class="{ active: template.starred }" @click="store.toggleTemplateStar(template)">★</button></div>
                <span class="cw-chip">{{ template.builtin ? '内置' : '自定义' }}</span><h3>{{ template.name }}</h3><p>{{ template.description }}</p>
                <div class="cw-template-card__actions"><button class="cw-button cw-button--primary" :disabled="!canGenerate" @click="store.start(template)">开始</button><button class="cw-small-btn" @click="openTemplateEditor(template)">{{ template.builtin ? '复制编辑' : '编辑' }}</button><button class="cw-small-btn" @click="store.exportTemplate(template)">导出</button><button v-if="!template.builtin" class="cw-small-btn cw-small-btn--danger" @click="removeTemplate(template)">删除</button></div>
              </article>
            </div>
          </section>

          <section v-else-if="tab === 'records'" class="cw-library">
            <header class="cw-page-header"><div><span class="cw-kicker">ARCHIVE</span><h2>记录库</h2><p>{{ records.length }} 份独立记录；切换角色不会丢失。</p></div><div><button class="cw-small-btn" @click="recordImport?.click()">导入记录</button><input ref="recordImport" class="cw-hidden" type="file" accept="application/json,.json" @change="importRecordFile" /></div></header>
            <div class="cw-filters">
              <input v-model="query" class="cw-field" placeholder="搜索标题、角色或模板…" />
              <select v-model="statusFilter" class="cw-field"><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已完成</option><option value="archived">已归档</option></select>
              <select v-model="templateFilter" class="cw-field"><option value="all">全部模板</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select>
              <input v-model="dateFilter" class="cw-field" type="date" title="只看此日期及之后更新的记录" />
            </div>
            <div v-if="filteredRecords.length" class="cw-record-list">
              <article v-for="record in filteredRecords" :key="record.id" class="cw-record-row" :class="{ 'is-other-character': characterId && record.characterId !== characterId }">
                <button class="cw-record-row__main" @click="selectRecord(record)"><span class="cw-record-row__icon">{{ record.templateSnapshot.icon }}</span><span><b>{{ record.title }}</b><small>{{ record.characterName }} · {{ record.templateSnapshot.name }} · {{ dateLabel(record.updatedAt) }}</small></span></button>
                <span class="cw-status">{{ unsyncedRecordIds.includes(record.id) ? '未同步' : statusLabel(record.status) }}</span>
                <div class="cw-record-row__actions"><button class="cw-small-btn" @click="store.exportRecord(record, 'markdown')">MD</button><button class="cw-small-btn" @click="store.exportRecord(record, 'json')">JSON</button><button v-if="characterId && record.characterId !== characterId" class="cw-small-btn" @click="store.rebindRecord(record)">绑定当前角色</button><button class="cw-small-btn cw-small-btn--danger" @click="removeRecord(record)">删除</button></div>
              </article>
            </div>
            <div v-else class="cw-empty"><span>📚</span><h3>没有符合条件的记录</h3><p>换个筛选条件，或从模板库开始第一份共笔。</p></div>
          </section>

          <SettingsPanel v-else />
        </div>

        <div v-if="busy" class="cw-busy"><span class="cw-busy__pen">✒</span><p>正在和 {{ characterName }} 商量下一页…</p></div>
        <div v-if="templateEditor" class="cw-editor-layer"><TemplateEditor :model-value="templateEditor" :connection-options="[{ id: 'default', name: '使用全局默认' }, ...settings.connections.map(item => ({ id: item.id, name: item.name }))]" :prompt-preview="editorPreview" :worldbook-names="worldbookNames" :load-worldbook="loadWorldbook" @save="saveTemplate" @close="templateEditor = null" /></div>
      </main>
    </div>
  </div>
</template>
