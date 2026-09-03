<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Block, InputConfig } from '../domain/schema';

const props = defineProps<{ block: Block; characterName: string; disabled?: boolean; targetLabels?: string[]; inline?: boolean }>();
const emit = defineEmits<{ commit: [blockId: string, value: InputConfig['value']] }>();

const draft = ref<InputConfig['value']>(cloneValue(props.block.input?.value ?? null));
watch(() => props.block.input?.value, (value) => { draft.value = cloneValue(value ?? null); });

const author = computed(() => props.block.kind === 'answer' ? `${props.characterName}的答案`
  : props.block.kind === 'review' ? `${props.characterName}的评价`
    : props.block.author === 'char' ? props.characterName : props.block.author === 'user' ? '我的答案' : '共笔');
const cardClass = computed(() => `cw-block--${props.block.author} cw-block--${props.block.kind}`);
const scaleValues = computed(() => {
  const min = props.block.input?.min ?? 1;
  const max = props.block.input?.max ?? 5;
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
});
const inputQuestion = computed(() => {
  const generic = /^(请填写|请作答|回答|作答)$/;
  const candidates = [props.block.input?.label, props.block.title, props.block.content];
  return candidates.find((value) => value?.trim() && !generic.test(value.trim()))?.trim()
    || props.block.input?.label?.trim()
    || props.block.title?.trim()
    || props.block.content?.trim()
    || '请填写';
});

function commit(): void {
  if (!props.block.input || props.block.kind !== 'input' || props.disabled) return;
  emit('commit', props.block.id, cloneValue(draft.value));
}

function toggleMulti(option: string): void {
  if (props.block.kind !== 'input' || props.disabled) return;
  const values = Array.isArray(draft.value) ? [...draft.value] : [];
  const index = values.indexOf(option);
  if (index >= 0) values.splice(index, 1);
  else values.push(option);
  draft.value = values;
  commit();
}

function cloneValue(value: InputConfig['value']): InputConfig['value'] {
  return Array.isArray(value) ? [...value] : value;
}
</script>

<template>
  <div v-if="block.kind === 'divider'" class="cw-divider"><span>✦</span></div>
  <section v-else class="cw-block" :class="cardClass">
    <header class="cw-block__header">
      <span class="cw-block__author">{{ author }}</span>
      <h3 v-if="block.title">{{ block.title }}</h3>
    </header>
    <p v-if="block.content" class="cw-block__content">{{ block.content }}</p>
    <div v-if="block.targetIds.length && !inline && block.kind !== 'answer'" class="cw-block__targets">
      ↳ 回应：{{ targetLabels?.join('、') || block.targetIds.join('、') }}
    </div>

    <fieldset v-if="(block.kind === 'input' || block.kind === 'answer') && block.input" class="cw-input" :disabled="disabled || block.kind === 'answer'">
      <legend>
        {{ inputQuestion }}
        <span v-if="block.kind === 'input' && block.input.required" class="cw-required">必填</span>
      </legend>

      <input
        v-if="block.input.type === 'short'"
        v-model="draft as string"
        class="cw-field"
        type="text"
        :placeholder="block.input.placeholder"
        @change="commit"
      />
      <textarea
        v-else-if="block.input.type === 'long'"
        v-model="draft as string"
        class="cw-field cw-field--long"
        :placeholder="block.input.placeholder"
        @change="commit"
      />
      <div v-else-if="block.input.type === 'single'" class="cw-options">
        <label v-for="option in block.input.options" :key="option" class="cw-choice">
          <input v-model="draft" type="radio" :value="option" @change="commit" />
          <span>{{ option }}</span>
        </label>
      </div>
      <div v-else-if="block.input.type === 'multi'" class="cw-options">
        <label v-for="option in block.input.options" :key="option" class="cw-choice">
          <input
            type="checkbox"
            :checked="Array.isArray(draft) && draft.includes(option)"
            @change="toggleMulti(option)"
          />
          <span>{{ option }}</span>
        </label>
      </div>
      <div v-else class="cw-scale">
        <span>{{ block.input.minLabel }}</span>
        <label v-for="number in scaleValues" :key="number">
          <input v-model.number="draft" type="radio" :value="number" @change="commit" />
          <b>{{ number }}</b>
        </label>
        <span>{{ block.input.maxLabel }}</span>
      </div>
    </fieldset>
  </section>
</template>
