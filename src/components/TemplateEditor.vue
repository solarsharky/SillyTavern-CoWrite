<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DEFAULT_PROTOCOL } from '../core/protocol';
import { buildPromptPreview } from '../core/prompt';
import { TemplateSchema, type CowriteTemplate } from '../domain/schema';
import { cloneJson } from '../core/clone';

const props = defineProps<{ modelValue: CowriteTemplate }>();
const emit = defineEmits<{ save: [template: CowriteTemplate]; close: [] }>();

const draft = ref<CowriteTemplate>(cloneJson(props.modelValue));
const advancedConfirmed = ref(false);
const editorError = ref('');
const promptPreview = computed(() => buildPromptPreview(draft.value));

watch(() => props.modelValue, (value) => { draft.value = cloneJson(value); }, { deep: true });

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
        <span class="cw-kicker">格式分类编辑器</span>
        <h2>{{ draft.name }}</h2>
      </div>
      <button class="cw-icon-btn" title="关闭" @click="emit('close')">×</button>
    </header>

    <div class="cw-editor__scroll">
      <p class="cw-notice">分类就是格式：这里管理双方如何轮流、首轮和后续如何推进。具体主题和题目要求请回到分类卡片中新增“内容项”。</p>
      <div class="cw-form-grid">
        <label>分类名称<input v-model="draft.name" class="cw-field" maxlength="80" /></label>
        <label>图标<input v-model="draft.icon" class="cw-field" maxlength="8" /></label>
        <label>强调色<input v-model="draft.accent" class="cw-field cw-color" type="color" /></label>
        <label class="cw-span-2">说明<textarea v-model="draft.description" class="cw-field" rows="2" /></label>
      </div>

      <details class="cw-editor-section">
        <summary>编辑分类格式与玩法流程</summary>
        <p class="cw-help">这里决定玩法如何推进。可用变量：<code v-text="'{{char}}'" />、<code v-text="'{{user}}'" />、<code v-text="'{{round}}'" />、<code v-text="'{{record_title}}'" /></p>
        <label>角色与玩法规则<textarea v-model="draft.prompts.rules" class="cw-field cw-code" rows="6" /></label>
        <label>首轮流程<textarea v-model="draft.prompts.opening" class="cw-field cw-code" rows="6" /></label>
        <label>继续流程<textarea v-model="draft.prompts.continuation" class="cw-field cw-code" rows="7" /></label>
      </details>

      <details class="cw-editor-section">
        <summary>最终提示词预览</summary>
        <pre class="cw-preview">{{ promptPreview }}</pre>
      </details>

      <details class="cw-editor-section cw-danger-zone">
        <summary>高级：输出格式与 JSON 协议</summary>
        <p class="cw-warning">这部分只规定卡片和 JSON 格式，日常修改内容时不要动。错误的协议可能让模型无法生成；结构校验、User 内容保护和事务规则不会因此关闭。</p>
        <label v-if="!advancedConfirmed" class="cw-choice">
          <input v-model="advancedConfirmed" type="checkbox" />
          <span>我知道风险，允许编辑本模板的格式协议</span>
        </label>
        <textarea v-model="draft.advancedProtocol" class="cw-field cw-code" rows="12" :readonly="!advancedConfirmed" :placeholder="DEFAULT_PROTOCOL" />
        <button class="cw-small-btn" @click="draft.advancedProtocol = DEFAULT_PROTOCOL">恢复默认格式协议</button>
      </details>
      <p v-if="editorError" class="cw-error">{{ editorError }}</p>
    </div>

    <footer class="cw-editor__footer">
      <button class="cw-button cw-button--quiet" @click="emit('close')">取消</button>
      <button class="cw-button cw-button--primary" @click="save">保存格式分类</button>
    </footer>
  </div>
</template>
