<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()
const curve = computed(() => props.character.stat_growth_curve)

const dimensions = computed(() => {
  if (!curve.value?.levels?.length) return []
  const all = new Set<string>()
  for (const lvl of curve.value.levels) {
    for (const k of Object.keys(lvl)) if (k !== 'level') all.add(k)
  }
  return Array.from(all)
})

const maxValuePerDim = computed(() => {
  const out: Record<string, number> = {}
  if (!curve.value) return out
  for (const dim of dimensions.value) {
    out[dim] = Math.max(...curve.value.levels.map((l: any) => Number(l[dim] || 0)))
  }
  return out
})

const DIM_LABEL: Record<string, string> = {
  atk: '攻击',
  hp: '生命',
  defense: '防御',
  speed: '速度',
}

function pct(value: number, max: number): string {
  return max > 0 ? `${(value / max) * 100}%` : '0%'
}
</script>

<template>
  <section v-if="curve" class="m-stats">
    <h2 class="m-stats__h2">数值成长曲线</h2>
    <table class="m-stats__table">
      <thead>
        <tr>
          <th>等级</th>
          <th v-for="d in dimensions" :key="d">{{ DIM_LABEL[d] || d }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="lvl in curve.levels" :key="(lvl as any).level">
          <td class="m-stats__lvl">Lv.{{ (lvl as any).level }}</td>
          <td v-for="d in dimensions" :key="d">
            <div class="m-stats__bar">
              <span class="m-stats__bar-fill" :style="{ width: pct(Number((lvl as any)[d] || 0), maxValuePerDim[d]) }"></span>
              <span class="m-stats__bar-num">{{ (lvl as any)[d] ?? '—' }}</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="curve.note" class="m-stats__note">{{ curve.note }}</p>
  </section>
</template>

<style scoped>
.m-stats { margin-bottom: var(--m-sp-10); }
.m-stats__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-stats__table {
  width: 100%;
  border-collapse: collapse;
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  overflow: hidden;
}
.m-stats__table th {
  background: var(--m-bg-card);
  color: var(--m-gold-light);
  font-family: var(--m-font-title);
  font-size: var(--m-fs-caption);
  letter-spacing: var(--m-ls-caps);
  padding: var(--m-sp-3) var(--m-sp-4);
  text-align: left;
  border-bottom: 1px solid var(--m-border-default);
}
.m-stats__table td {
  padding: var(--m-sp-3) var(--m-sp-4);
  border-bottom: 1px solid var(--m-border-subtle);
  font-size: var(--m-fs-body);
}
.m-stats__table tr:last-child td { border-bottom: 0; }
.m-stats__lvl {
  font-family: var(--m-font-code);
  color: var(--m-gold-light);
  white-space: nowrap;
}
.m-stats__bar {
  position: relative;
  background: rgba(197, 163, 86, 0.06);
  border-radius: var(--m-radius-sm);
  height: 22px;
  display: flex;
  align-items: center;
  padding: 0 var(--m-sp-2);
  min-width: 100px;
  overflow: hidden;
}
.m-stats__bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, var(--m-gold-dim), var(--m-gold-primary));
  opacity: 0.4;
  transition: width var(--m-dur-normal) var(--m-ease-default);
}
.m-stats__bar-num {
  position: relative;
  z-index: 1;
  font-family: var(--m-font-code);
  color: var(--m-text-primary);
  font-weight: var(--m-fw-medium);
}
.m-stats__note {
  margin-top: var(--m-sp-3);
  font-size: var(--m-fs-caption);
  color: var(--m-text-dim);
  font-style: italic;
}
</style>
