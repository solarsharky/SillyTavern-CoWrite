<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useCowriteStore } from '../stores/app';
import type { ConnectionProfile } from '../domain/schema';
import { cloneJson } from '../core/clone';
import { compareVersion } from '../adapters/tavern';

const store = useCowriteStore();
const { settings, sessionKeys, helperVersion } = storeToRefs(store);
const connections = ref<ConnectionProfile[]>(cloneJson(settings.value.connections));
const testingId = ref('');
const testMessage = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const helperSupported = computed(() => compareVersion(helperVersion.value, '4.9.3') >= 0);

watch(() => settings.value.connections, (value) => { connections.value = cloneJson(value); }, { deep: true });

function add(): void {
  connections.value.push(store.addConnection());
}

function remove(id: string): void {
  connections.value = connections.value.filter((item) => item.id !== id);
  if (settings.value.defaultConnectionId === id) settings.value.defaultConnectionId = 'st-main';
}

async function save(): Promise<void> {
  await store.saveConnections(connections.value);
  store.saveSettings();
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
      <div class="cw-section-title">
        <div><span class="cw-kicker">CONNECTIONS</span><h2>生成连接</h2></div>
        <button class="cw-small-btn" @click="add">＋ 新连接</button>
      </div>
      <p class="cw-warning">独立连接会把所选角色、聊天和世界书上下文发送给对应 API 服务。请确认你信任服务商。</p>

      <article v-for="profile in connections" :key="profile.id" class="cw-connection">
        <template v-if="profile.type === 'st'">
          <div><b>{{ profile.name }}</b><p>使用 SillyTavern 当前连接与预设，不保存额外密钥。</p></div>
          <span class="cw-chip">只读</span>
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
    </section>

    <section class="cw-paper-section">
      <div class="cw-section-title"><div><span class="cw-kicker">BACKUP</span><h2>备份与恢复</h2></div></div>
      <p>整库备份包含自定义模板、记录和不含密钥的设置。建议在批量整理或更新前下载一份。</p>
      <div class="cw-inline-actions">
        <button class="cw-button cw-button--quiet" @click="store.exportBackup">下载整库备份</button>
        <button class="cw-button cw-button--quiet" @click="importInput?.click()">从备份恢复</button>
        <input ref="importInput" class="cw-hidden" type="file" accept="application/json,.json" @change="restore" />
      </div>
    </section>

    <section class="cw-paper-section">
      <span class="cw-kicker">ABOUT</span>
      <h2>共笔 v0.1.0-beta.6</h2>
      <p>作者 SolarShark · MIT License</p>
      <a href="https://github.com/solarsharky/SillyTavern-CoWrite/issues" target="_blank" rel="noreferrer">反馈问题或建议 ↗</a>
    </section>
  </div>
</template>
