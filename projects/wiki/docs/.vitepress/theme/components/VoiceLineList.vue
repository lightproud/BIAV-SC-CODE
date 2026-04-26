<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()
const refs = computed(() => props.character.voice_line_refs || [])
</script>

<template>
  <section class="m-voice">
    <h2 class="m-voice__h2">语音</h2>
    <p v-if="!refs.length" class="m-voice__empty">
      尚未关联语音条目。voice_lines.json 已存有 2543 条原始台词，待 Phase 3 按角色 id 范围批量关联。
    </p>
    <ul v-else class="m-voice__list">
      <li v-for="id in refs" :key="id" class="m-voice__item">
        <span class="m-voice__id">#{{ id }}</span>
        <span class="m-voice__hint">引用 voice_lines.json 行 id；构建期渲染。</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.m-voice { margin-bottom: var(--m-sp-10); }
.m-voice__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-voice__empty {
  background: var(--m-bg-elevated);
  border: 1px dashed var(--m-border-subtle);
  border-radius: var(--m-radius-md);
  padding: var(--m-sp-4);
  color: var(--m-text-dim);
  font-size: var(--m-fs-caption);
  font-style: italic;
}
.m-voice__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--m-sp-2);
}
.m-voice__item {
  display: flex;
  gap: var(--m-sp-3);
  align-items: baseline;
  padding: var(--m-sp-2) var(--m-sp-3);
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-subtle);
  border-radius: var(--m-radius-sm);
}
.m-voice__id {
  font-family: var(--m-font-code);
  color: var(--m-gold-light);
}
.m-voice__hint {
  font-size: var(--m-fs-caption);
  color: var(--m-text-dim);
}
</style>
