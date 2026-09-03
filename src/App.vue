<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import RecordPages from './components/RecordPages.vue';
import ContentItemEditor from './components/ContentItemEditor.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TemplateEditor from './components/TemplateEditor.vue';
import { BUILTIN_TEMPLATES, cloneBuiltinTemplate } from './domain/defaults';
import type { ContentItem, CowriteRecord, CowriteTemplate, InputConfig } from './domain/schema';
import { useCowriteStore, type AppTab } from './stores/app';
import { cloneJson } from './core/clone';
import { isInputAnswered } from './domain/schema';

const store = useCowriteStore();
const {
  busy, open, tab, error, notices, rawOutput, records, unsyncedRecordIds, templates, selectedRecordId, selectedRecord,
  characterId, characterName, settings, canGenerate,
} = storeToRefs(store);

const fab = ref<HTMLElement | null>(null);
const templateEditor = ref<CowriteTemplate | null>(null);
const contentEditor = ref<{ template: CowriteTemplate; item: ContentItem } | null>(null);
const templateImport = ref<HTMLInputElement | null>(null);
const recordImport = ref<HTMLInputElement | null>(null);
const query = ref('');
const statusFilter = ref('all');
const templateFilter = ref('all');
const dateFilter = ref('');
const sortedTemplates = computed(() => [...templates.value].sort((a, b) => Number(b.starred) - Number(a.starred)));
const filteredRecords = computed(() => records.value.filter((record) => {
  const text = `${record.title} ${record.characterName} ${record.templateSnapshot.name}`.toLocaleLowerCase();
  if (query.value && !text.includes(query.value.toLocaleLowerCase())) return false;
  if (statusFilter.value !== 'all' && record.status !== statusFilter.value) return false;
  if (templateFilter.value !== 'all' && record.templateId !== templateFilter.value) return false;
  return !dateFilter.value || record.updatedAt.slice(0, 10) >= dateFilter.value;
}));
const canEditRecord = computed(() => canGenerate.value && selectedRecord.value?.characterId === characterId.value);
const latestCycle = computed(() => [...(selectedRecord.value?.cycles || [])].reverse().find((cycle) => cycle.status === 'applied'));
const moreLabel = computed(() => selectedRecord.value?.templateId === 'builtin-exchange-diary' ? '再写一页' : '生成更多题');

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
  templateEditor.value = cloneJson(template);
}

function createTemplate(): void {
  const source = BUILTIN_TEMPLATES[0]!;
  const draft = cloneBuiltinTemplate(source, crypto.randomUUID());
  draft.name = '我的新分类';
  draft.description = '';
  draft.icon = '🗂️';
  draft.contentItems = [];
  draft.contentGuidance = '';
  draft.contentTitle = '';
  templateEditor.value = draft;
}

function openContentEditor(template: CowriteTemplate, item?: ContentItem): void {
  contentEditor.value = {
    template: cloneJson(template),
    item: item ? cloneJson(item) : { id: crypto.randomUUID(), name: '新内容', description: '', guidance: '' },
  };
}

async function saveContentItem(item: ContentItem): Promise<void> {
  if (!contentEditor.value) return;
  await store.saveContentItem(contentEditor.value.template, item);
  contentEditor.value = null;
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

function selectRecord(record: CowriteRecord): void {
  selectedRecordId.value = record.id;
  tab.value = 'current';
}

async function removeRecord(record: CowriteRecord): Promise<void> {
  if (window.confirm(`确定删除“${record.title}”吗？这会删除账户文件，无法在插件内撤销。`)) await store.removeRecord(record);
}

async function removeTemplate(template: CowriteTemplate): Promise<void> {
  const hint = template.builtin ? '内置分类之后可在设置中恢复。' : '这个操作不会删除已有记录。';
  if (window.confirm(`确定删除分类“${template.name}”吗？${hint}`)) await store.removeTemplate(template);
}

async function removeContentItem(template: CowriteTemplate, item: ContentItem): Promise<void> {
  if (window.confirm(`确定删除内容“${item.name}”吗？已有记录不会受影响。`)) await store.removeContentItem(template, item);
}

function commitInput(blockId: string, value: InputConfig['value']): void {
  void store.commitInput(blockId, value);
}

async function reroll(): Promise<void> {
  const answered = selectedRecord.value?.blocks.some((block) => block.cycleId === latestCycle.value?.id && block.kind === 'input' && isInputAnswered(block));
  if (answered && !window.confirm('重roll会替换他最近一次生成的内容，其中新题目下你已填写的答案也会清除。更早的题目和答案会保留，是否继续？')) return;
  await store.reroll();
}

async function clearAnswers(): Promise<void> {
  if (!window.confirm('清空所有已填答案和后续评价，保留原题及他随题写好的答案，重新填写？')) return;
  await store.clearAnswers();
}

function statusLabel(status: CowriteRecord['status']): string {
  return status === 'active' ? '进行中' : status === 'completed' ? '已回应' : '历史记录';
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
    ><span>✏️</span></button>

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
          <button v-for="item in ([['templates','模板库'],['current','当前记录'],['records','记录库'],['settings','设置']] as const)" :key="item[0]" :class="{ active: tab === item[0] }" @click="selectTab(item[0])">{{ item[1] }}</button>
        </nav>

        <div v-if="error || notices.length" class="cw-messages">
          <div v-if="error" class="cw-error"><b>没有写入本轮：</b>{{ error }} <button v-if="rawOutput" class="cw-link-btn" @click="store.exportRawOutput">下载原始响应</button></div>
          <div v-for="notice in notices" :key="notice" class="cw-notice">{{ notice }}</div>
        </div>

        <div class="cw-content">
          <section v-if="tab === 'current'" class="cw-current">
            <div class="cw-current-toolbar"><button class="cw-small-btn" @click="selectTab('records')">← 返回记录库</button></div>
            <template v-if="selectedRecord">
              <header class="cw-record-heading">
                <div><span class="cw-kicker">{{ selectedRecord.templateSnapshot.name }}{{ selectedRecord.templateSnapshot.contentTitle ? ` · ${selectedRecord.templateSnapshot.contentTitle}` : '' }} · {{ statusLabel(selectedRecord.status) }}</span><h2>{{ selectedRecord.title }}</h2><p>与 {{ selectedRecord.characterName }} · 更新于 {{ dateLabel(selectedRecord.updatedAt) }}</p></div>
                <button class="cw-star" :class="{ active: selectedRecord.starred }" title="星标" @click="store.toggleRecordStar()">★</button>
              </header>

              <RecordPages v-if="selectedRecord.blocks.length" :blocks="selectedRecord.blocks" :character-name="selectedRecord.characterName" :disabled="!canEditRecord" @commit="commitInput" />
              <div v-else class="cw-empty"><span>📝</span><h3>这一页还是空的</h3><p>上次生成可能没有完成，可以重试或删除这份记录。</p></div>

              <footer class="cw-actionbar">
                <button v-if="busy" class="cw-button cw-button--danger" @click="store.stopGeneration">停止生成</button>
                <button v-else class="cw-button cw-button--primary" :disabled="!canEditRecord" title="把已填好的内容交给他，让他接着回答或评价" @click="store.continueRecord()">交给他写</button>
                <button v-if="unsyncedRecordIds.includes(selectedRecord.id)" class="cw-button cw-button--danger" @click="store.retrySync()">重试同步</button>
                <button class="cw-button cw-button--quiet" :disabled="!canEditRecord || !latestCycle" title="重新生成他最近一次写的内容，成功后替换；更早的内容保持不变" @click="reroll">重roll</button>
                <button class="cw-button cw-button--quiet" :disabled="!canEditRecord || !selectedRecord.blocks.length" title="保留原题和他随题写好的答案，清空我的填写及后续回应" @click="clearAnswers">清空重填</button>
                <button class="cw-button cw-button--quiet" :disabled="!canEditRecord" title="保留已有内容，在当前记录后追加新内容" @click="store.generateMore">{{ moreLabel }}</button>
              </footer>
            </template>
            <div v-else class="cw-welcome">
              <span class="cw-welcome__mark">✦</span><h2>{{ characterId ? `和 ${characterName} 开始一份共笔` : '先打开一个单角色聊天' }}</h2>
              <p>{{ characterId ? '先到模板库选择一个格式分类，再从分类中挑选要写的内容。所有生成只进入共笔，不会改动聊天楼层。' : '群聊或没有当前角色时仍可到记录库浏览旧记录。' }}</p>
              <button v-if="characterId" class="cw-button cw-button--primary" @click="selectTab('templates')">前往模板库</button>
            </div>
          </section>

          <section v-else-if="tab === 'templates'" class="cw-library">
            <header class="cw-page-header"><div><span class="cw-kicker">FORMATS & CONTENTS</span><h2>模板库</h2><p>分类就是格式；每个分类里可以自由添加、编辑和删除不同内容。</p></div><div class="cw-inline-actions"><button class="cw-small-btn" @click="templateImport?.click()">导入分类</button><button class="cw-button cw-button--primary" @click="createTemplate">＋ 新分类</button><input ref="templateImport" class="cw-hidden" type="file" accept="application/json,.json" @change="importTemplateFile" /></div></header>
            <div class="cw-format-list">
              <article v-for="template in sortedTemplates" :key="template.id" class="cw-template-card cw-format-card" :style="{ '--accent': template.accent }">
                <div class="cw-template-card__top"><span class="cw-template-card__icon">{{ template.icon }}</span><button class="cw-star" :class="{ active: template.starred }" @click="store.toggleTemplateStar(template)">★</button></div>
                <span class="cw-chip">{{ template.builtin ? '内置格式' : '自定义格式' }}</span><h3>{{ template.name }}</h3><p>{{ template.description }}</p>
                <div class="cw-template-card__actions"><button class="cw-small-btn" @click="openTemplateEditor(template)">编辑格式</button><button class="cw-small-btn" @click="store.exportTemplate(template)">导出分类</button><button class="cw-small-btn cw-small-btn--danger" @click="removeTemplate(template)">删除分类</button></div>
                <div class="cw-content-collection">
                  <div class="cw-content-collection__header"><div><b>内容</b><small>{{ template.contentItems.length }} 项</small></div><button class="cw-small-btn" @click="openContentEditor(template)">＋ 添加内容</button></div>
                  <div v-if="template.contentItems.length" class="cw-content-items">
                    <article v-for="item in template.contentItems" :key="item.id" class="cw-content-item">
                      <div class="cw-content-item__text"><b>{{ item.name }}</b><p>{{ item.description || item.guidance || '按此内容开始一份共笔。' }}</p></div>
                      <div class="cw-inline-actions"><button class="cw-button cw-button--primary" :disabled="!canGenerate" @click="store.start(template, item)">开始</button><button class="cw-small-btn" @click="openContentEditor(template, item)">编辑</button><button class="cw-small-btn cw-small-btn--danger" @click="removeContentItem(template, item)">删除</button></div>
                    </article>
                  </div>
                  <div v-else class="cw-content-empty"><span>这个分类还没有内容。</span><button class="cw-small-btn" @click="openContentEditor(template)">添加第一项</button></div>
                </div>
              </article>
            </div>
          </section>

          <section v-else-if="tab === 'records'" class="cw-library">
            <header class="cw-page-header"><div><span class="cw-kicker">ARCHIVE</span><h2>记录库</h2><p>{{ records.length }} 份独立记录；切换角色不会丢失。</p></div><div><button class="cw-small-btn" @click="recordImport?.click()">导入记录</button><input ref="recordImport" class="cw-hidden" type="file" accept="application/json,.json" @change="importRecordFile" /></div></header>
            <div class="cw-filters">
              <input v-model="query" class="cw-field" placeholder="搜索标题、角色或模板…" />
              <select v-model="statusFilter" class="cw-field"><option value="all">全部状态</option><option value="active">进行中</option><option value="completed">已回应</option><option value="archived">历史记录</option></select>
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

        <div v-if="busy" class="cw-busy"><span class="cw-busy__pen">✒</span><p>正在和 {{ characterName }} 商量下一页…</p><button class="cw-small-btn cw-small-btn--danger" @click="store.stopGeneration">停止本轮</button></div>
        <div v-if="templateEditor" class="cw-editor-layer"><TemplateEditor :model-value="templateEditor" @save="saveTemplate" @close="templateEditor = null" /></div>
        <div v-if="contentEditor" class="cw-editor-layer"><ContentItemEditor :model-value="contentEditor.item" :category-name="contentEditor.template.name" @save="saveContentItem" @close="contentEditor = null" /></div>
      </main>
    </div>
  </div>
</template>
