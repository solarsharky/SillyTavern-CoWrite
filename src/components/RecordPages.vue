<script setup lang="ts">
import { computed, ref } from 'vue';
import BlockCard from './BlockCard.vue';
import type { Block, InputConfig } from '../domain/schema';

const props = defineProps<{ blocks: Block[]; characterName: string; disabled?: boolean }>();
const emit = defineEmits<{ commit: [blockId: string, value: InputConfig['value']] }>();
const activeAnswers = ref<Record<string, 'user' | 'char'>>({});

function switchAnswer(blockId: string, event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const current = activeAnswers.value[blockId] || 'user';
  const next = event.key === 'Home' ? 'user' : event.key === 'End' ? 'char' : current === 'user' ? 'char' : 'user';
  activeAnswers.value[blockId] = next;
  const tabs = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs[next === 'user' ? 0 : 1]?.focus();
}

const presentation = computed(() => {
  const byId = new Map(props.blocks.map((block) => [block.id, block]));
  const answers = new Map<string, Block[]>();
  const reviews = new Map<string, Block[]>();
  const attached = new Set<string>();
  for (const block of props.blocks) {
    if (block.kind === 'answer' && byId.get(block.targetIds[0] || '')?.kind === 'input') {
      const target = block.targetIds[0]!;
      answers.set(target, [...(answers.get(target) || []), block]);
      attached.add(block.id);
    }
    if (block.kind === 'review') {
      for (const target of new Set(block.targetIds)) {
        const targetBlock = byId.get(target);
        if (!targetBlock || targetBlock.kind === 'review' || targetBlock.kind === 'divider') continue;
        reviews.set(target, [...(reviews.get(target) || []), block]);
        attached.add(block.id);
      }
    }
  }
  return { pages: props.blocks.filter((block) => !attached.has(block.id)), answers, reviews, byId };
});

function targetLabels(block: Block): string[] {
  return block.targetIds.map((id) => {
    const target = presentation.value.byId.get(id);
    return target?.title || target?.input?.label || id;
  });
}
</script>

<template>
  <div class="cw-page-stack">
    <div v-for="block in presentation.pages" :key="block.id" class="cw-record-entry" :class="{ 'cw-question-pair': presentation.answers.has(block.id) }" :data-block-id="block.id">
      <div v-if="presentation.answers.has(block.id)" class="cw-question-tabs" role="tablist" :aria-label="`${block.title || block.input?.label || '这一题'}的双方答案`" @keydown="switchAnswer(block.id, $event)">
        <button :id="`${block.id}-user-tab`" type="button" role="tab" :aria-selected="activeAnswers[block.id] !== 'char'" :aria-controls="`${block.id}-user-answer`" :tabindex="activeAnswers[block.id] === 'char' ? -1 : 0" @click="activeAnswers[block.id] = 'user'">我的答案</button>
        <button :id="`${block.id}-char-tab`" type="button" role="tab" :aria-selected="activeAnswers[block.id] === 'char'" :aria-controls="`${block.id}-char-answer`" :tabindex="activeAnswers[block.id] === 'char' ? 0 : -1" @click="activeAnswers[block.id] = 'char'">他的答案</button>
      </div>
      <div v-if="presentation.answers.has(block.id)" :id="`${block.id}-char-answer`" class="cw-answer-column cw-answer-column--char" :class="{ 'is-active': activeAnswers[block.id] === 'char' }" role="tabpanel" :aria-labelledby="`${block.id}-char-tab`">
        <template v-for="answer in presentation.answers.get(block.id)" :key="answer.id">
          <BlockCard :block="answer" :character-name="characterName" :disabled="true" />
          <div v-if="presentation.reviews.has(answer.id)" class="cw-inline-reviews">
            <BlockCard v-for="review in presentation.reviews.get(answer.id)" :key="review.id" :block="review" :character-name="characterName" inline />
          </div>
        </template>
      </div>
      <div :id="`${block.id}-user-answer`" class="cw-answer-column cw-answer-column--user" :class="{ 'is-active': activeAnswers[block.id] !== 'char' }" :role="presentation.answers.has(block.id) ? 'tabpanel' : undefined" :aria-labelledby="presentation.answers.has(block.id) ? `${block.id}-user-tab` : undefined">
        <BlockCard :block="block" :character-name="characterName" :disabled="disabled" :target-labels="targetLabels(block)" @commit="(id, value) => emit('commit', id, value)" />
        <div v-if="presentation.reviews.has(block.id)" class="cw-inline-reviews" :class="{ 'cw-inline-reviews--user': block.author === 'user' }">
          <BlockCard v-for="review in presentation.reviews.get(block.id)" :key="review.id" :block="review" :character-name="characterName" inline />
        </div>
      </div>
    </div>
  </div>
</template>
