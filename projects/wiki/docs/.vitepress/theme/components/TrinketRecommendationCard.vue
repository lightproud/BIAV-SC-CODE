<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()
const recs = computed(() => props.character.trinkets_recommended || [])

const PRIORITY_LABEL: Record<string, string> = {
  BiS: '最优 (BiS)',
  alt: '替代',
  budget: '平民',
}
</script>

<template>
  <section v-if="recs.length" class="m-trinkets">
    <h2 class="m-trinkets__h2">推荐神器</h2>
    <ul class="m-trinkets__list">
      <li v-for="r in recs" :key="r.trinket_id" :data-priority="r.priority || 'alt'" class="m-trinkets__item">
        <header>
          <strong class="m-trinkets__name">{{ r.trinket_id }}</strong>
          <span class="m-trinkets__priority">{{ PRIORITY_LABEL[r.priority || 'alt'] || r.priority }}</span>
        </header>
        <p v-if="r.note" class="m-trinkets__note">{{ r.note }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.m-trinkets { margin-bottom: var(--m-sp-10); }
.m-trinkets__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-trinkets__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--m-sp-3);
  list-style: none;
  margin: 0;
  padding: 0;
}
.m-trinkets__item {
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  padding: var(--m-sp-4);
  border-left-width: 3px;
}
.m-trinkets__item[data-priority='BiS']    { border-left-color: var(--m-gold-light); }
.m-trinkets__item[data-priority='alt']    { border-left-color: var(--m-gold-primary); }
.m-trinkets__item[data-priority='budget'] { border-left-color: var(--m-gold-dim); }
.m-trinkets__item header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: var(--m-sp-2);
}
.m-trinkets__name {
  font-family: var(--m-font-code);
  color: var(--m-text-primary);
  font-size: var(--m-fs-body);
  word-break: break-all;
}
.m-trinkets__priority {
  font-size: var(--m-fs-small);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-caps);
  white-space: nowrap;
  margin-left: var(--m-sp-2);
}
.m-trinkets__note {
  margin: 0;
  font-size: var(--m-fs-caption);
  color: var(--m-text-muted);
  line-height: var(--m-lh-normal);
}
</style>
