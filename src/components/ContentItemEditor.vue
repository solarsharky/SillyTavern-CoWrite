<script setup lang="ts">
import { ref } from 'vue';
import { ContentItemSchema, type ContentItem } from '../domain/schema';
import { cloneJson } from '../core/clone';

const props = defineProps<{ modelValue: ContentItem; categoryName: string }>();
const emit = defineEmits<{ save: [item: ContentItem]; close: [] }>();
const draft = ref(cloneJson(props.modelValue));
const error = ref('');

function save(): void {
  error.value = '';
  try { emit('save', ContentItemSchema.parse(draft.value)); }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught); }
}
</script>

<template>
  <div class="cw-editor cw-content-item-editor">
    <header class="cw-editor__header">
      <div><span class="cw-kicker">{{ categoryName }} · 内容项</span><h2>{{ draft.name || '新内容' }}</h2></div>
      <button class="cw-icon-btn" title="关闭" @click="emit('close')">×</button>
    </header>

    <div class="cw-editor__scroll">
      <p class="cw-notice">这里只描述“写什么”，不用规定问卷卡片或 JSON 格式；格式由所属分类统一管理。</p>
      <div class="cw-form-grid">
        <label>内容名称<input v-model="draft.name" class="cw-field" maxlength="80" placeholder="例如：依恋类型" /></label>
        <label>列表说明<input v-model="draft.description" class="cw-field" maxlength="300" placeholder="一句话说明这个主题" /></label>
      </div>
      <label class="cw-content-request">内容要求
        <textarea
          v-model="draft.guidance"
          class="cw-field"
          rows="12"
          maxlength="8000"
          placeholder="例如：围绕依恋类型和安全感设计题目；必须包含‘发生矛盾时谁会先低头’这道题；语气亲密一点。"
        />
      </label>
      <p class="cw-help">可以写主题、尺度、语气、禁区和必须出现的具体题目。留空表示让 Char 按分类格式自由发挥。</p>
      <p v-if="error" class="cw-error">{{ error }}</p>
    </div>

    <footer class="cw-editor__footer">
      <button class="cw-button cw-button--quiet" @click="emit('close')">取消</button>
      <button class="cw-button cw-button--primary" @click="save">保存内容</button>
    </footer>
  </div>
</template>
