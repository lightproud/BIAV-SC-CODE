<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()
const aff = computed(() => props.character.affinities)
const hasContent = computed(() => {
  if (!aff.value) return false
  return Boolean(
    aff.value.traits?.length ||
    aff.value.super_effective_against?.length ||
    aff.value.weak_against?.length
  )
})
</script>

<template>
  <section v-if="hasContent" class="m-aff">
    <h2 class="m-aff__h2">特性与适性</h2>
    <div class="m-aff__group" v-if="aff!.traits?.length">
      <h3>特性</h3>
      <ul><li v-for="t in aff!.traits" :key="t" class="m-aff__chip">{{ t }}</li></ul>
    </div>
    <div class="m-aff__group" v-if="aff!.super_effective_against?.length">
      <h3>克制（特攻）</h3>
      <ul><li v-for="t in aff!.super_effective_against" :key="t" class="m-aff__chip m-aff__chip--strong">{{ t }}</li></ul>
    </div>
    <div class="m-aff__group" v-if="aff!.weak_against?.length">
      <h3>被克制</h3>
      <ul><li v-for="t in aff!.weak_against" :key="t" class="m-aff__chip m-aff__chip--weak">{{ t }}</li></ul>
    </div>
  </section>
</template>

<style scoped>
.m-aff { margin-bottom: var(--m-sp-10); }
.m-aff__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-aff__group { margin-bottom: var(--m-sp-5); }
.m-aff__group h3 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h3);
  color: var(--m-gold-primary);
  margin: 0 0 var(--m-sp-3);
  letter-spacing: var(--m-ls-title);
}
.m-aff__group ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--m-sp-2);
}
.m-aff__chip {
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-sm);
  padding: var(--m-sp-1) var(--m-sp-3);
  font-size: var(--m-fs-caption);
  color: var(--m-text-primary);
}
.m-aff__chip--strong { border-color: var(--m-fn-success); color: var(--m-fn-success); }
.m-aff__chip--weak   { border-color: var(--m-fn-error);   color: var(--m-fn-error); }
</style>
