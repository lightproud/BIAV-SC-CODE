<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()

const stages = computed(() => {
  const m = props.character.ascension_materials
  if (!m) return null
  return [
    { key: 'stage_1', label: '阶段一', mats: m.stage_1 || [] },
    { key: 'stage_2', label: '阶段二', mats: m.stage_2 || [] },
    { key: 'stage_3', label: '阶段三', mats: m.stage_3 || [] },
    { key: 'stage_4', label: '阶段四', mats: m.stage_4 || [] },
  ]
})

const total = computed(() => props.character.ascension_materials?.total || [])
</script>

<template>
  <section v-if="stages" class="m-ascension">
    <h2 class="m-ascension__h2">觉醒材料</h2>
    <div class="m-ascension__grid">
      <article v-for="s in stages" :key="s.key" class="m-ascension__card" v-show="s.mats.length">
        <header><h3>{{ s.label }}</h3></header>
        <ul>
          <li v-for="m in s.mats" :key="m.item_id">
            <span class="m-ascension__item">{{ m.item_id }}</span>
            <span class="m-ascension__qty">×{{ m.quantity }}</span>
          </li>
        </ul>
      </article>
    </div>
    <details v-if="total.length" class="m-ascension__total">
      <summary>合计材料（满觉醒）</summary>
      <ul>
        <li v-for="m in total" :key="m.item_id">
          <span class="m-ascension__item">{{ m.item_id }}</span>
          <span class="m-ascension__qty">×{{ m.quantity }}</span>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.m-ascension { margin-bottom: var(--m-sp-10); }
.m-ascension__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-ascension__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--m-sp-4);
}
.m-ascension__card {
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  padding: var(--m-sp-4);
}
.m-ascension__card h3 {
  margin: 0 0 var(--m-sp-3);
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h3);
  color: var(--m-gold-primary);
  letter-spacing: var(--m-ls-title);
}
.m-ascension__card ul,
.m-ascension__total ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.m-ascension__card li,
.m-ascension__total li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: var(--m-sp-2) 0;
  border-bottom: 1px solid var(--m-border-subtle);
  font-size: var(--m-fs-caption);
}
.m-ascension__card li:last-child,
.m-ascension__total li:last-child { border-bottom: 0; }
.m-ascension__item {
  font-family: var(--m-font-code);
  color: var(--m-text-muted);
  word-break: break-all;
}
.m-ascension__qty {
  font-family: var(--m-font-code);
  color: var(--m-gold-light);
  font-weight: var(--m-fw-medium);
  white-space: nowrap;
  margin-left: var(--m-sp-3);
}
.m-ascension__total {
  margin-top: var(--m-sp-5);
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  padding: var(--m-sp-4);
}
.m-ascension__total summary {
  cursor: pointer;
  color: var(--m-gold-primary);
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h3);
  letter-spacing: var(--m-ls-title);
  margin-bottom: var(--m-sp-3);
}
</style>
