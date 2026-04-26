<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()
const bonds = computed(() => props.character.bond_rewards || [])
</script>

<template>
  <section v-if="bonds.length" class="m-bond">
    <h2 class="m-bond__h2">羁绊奖励</h2>
    <ol class="m-bond__list">
      <li v-for="b in bonds" :key="b.level" class="m-bond__item">
        <div class="m-bond__level">Lv.{{ b.level }}</div>
        <ul class="m-bond__unlocks">
          <li v-for="(u, i) in b.unlocks" :key="i">{{ u }}</li>
        </ul>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.m-bond { margin-bottom: var(--m-sp-10); }
.m-bond__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-bond__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--m-sp-3);
}
.m-bond__item {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: var(--m-sp-4);
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  padding: var(--m-sp-3) var(--m-sp-4);
}
.m-bond__level {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h2);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  align-self: center;
  text-align: center;
  border-right: 1px solid var(--m-border-subtle);
}
.m-bond__unlocks {
  list-style: disc;
  margin: 0;
  padding-left: var(--m-sp-5);
  color: var(--m-text-primary);
  font-size: var(--m-fs-body);
}
.m-bond__unlocks li { padding: var(--m-sp-1) 0; }
</style>
