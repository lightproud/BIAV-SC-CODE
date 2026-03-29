<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { withBase } from 'vitepress'

interface Character {
  id: string
  name: string
  name_en: string
  rarity: string
  realm: string
  role: string
  is_limited: boolean
}

interface PullResult {
  character: Character
  isNew: boolean
  animation: string
}

const characters = ref<Character[]>([])
const loading = ref(true)
const error = ref('')

// Gacha state
const pityCounter = ref(0)
const totalPulls = ref(0)
const ssrCount = ref(0)
const srCount = ref(0)
const pullHistory = ref<PullResult[]>([])
const currentResults = ref<PullResult[]>([])
const showResults = ref(false)
const isAnimating = ref(false)
const obtained = ref<Set<string>>(new Set())

// Gacha config (v2.0+)
const SSR_RATE = 0.03     // 3%
const SR_RATE = 0.10      // approximate SR rate
const HARD_PITY = 30      // hard pity at 30

onMounted(async () => {
  try {
    const res = await fetch(withBase('/data/db/characters.json'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    characters.value = data.characters || []
  } catch (e: any) {
    error.value = `Failed to load character data: ${e.message}`
  } finally {
    loading.value = false
  }
})

const ssrPool = computed(() => characters.value.filter(c => c.rarity === 'SSR'))
const srPool = computed(() => characters.value.filter(c => c.rarity === 'SR'))

function getRandomFromPool(pool: Character[]): Character {
  if (pool.length === 0) {
    return {
      id: 'unknown',
      name: '???',
      name_en: 'Unknown',
      rarity: 'SR',
      realm: 'chaos',
      role: 'support',
      is_limited: false,
    }
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

function singlePull(): PullResult {
  pityCounter.value++
  totalPulls.value++

  let rarity: 'SSR' | 'SR' | 'R'

  // Hard pity
  if (pityCounter.value >= HARD_PITY) {
    rarity = 'SSR'
  } else {
    // Soft pity ramp from pull 20+
    let ssrRate = SSR_RATE
    if (pityCounter.value >= 20) {
      ssrRate += (pityCounter.value - 19) * 0.03
    }
    const roll = Math.random()
    if (roll < ssrRate) {
      rarity = 'SSR'
    } else if (roll < ssrRate + SR_RATE) {
      rarity = 'SR'
    } else {
      rarity = 'R'
    }
  }

  let character: Character

  if (rarity === 'SSR') {
    character = getRandomFromPool(ssrPool.value)
    ssrCount.value++
    pityCounter.value = 0
  } else if (rarity === 'SR') {
    character = getRandomFromPool(srPool.value.length > 0 ? srPool.value : ssrPool.value)
    srCount.value++
  } else {
    // R result - use a placeholder since we don't have R characters
    character = {
      id: `r-${Math.floor(Math.random() * 100)}`,
      name: 'R Card',
      name_en: 'R Card',
      rarity: 'R',
      realm: ['chaos', 'aequor', 'caro', 'ultra'][Math.floor(Math.random() * 4)],
      role: 'support',
      is_limited: false,
    }
  }

  const isNew = !obtained.value.has(character.id)
  if (character.rarity !== 'R') {
    obtained.value.add(character.id)
  }

  return {
    character,
    isNew,
    animation: rarity === 'SSR' ? 'ssr-glow' : rarity === 'SR' ? 'sr-glow' : '',
  }
}

async function pull(count: number) {
  if (isAnimating.value) return
  isAnimating.value = true
  showResults.value = false
  currentResults.value = []

  await new Promise(resolve => setTimeout(resolve, 300))

  const results: PullResult[] = []
  for (let i = 0; i < count; i++) {
    results.push(singlePull())
  }

  // Sort: SSR first, then SR, then R
  results.sort((a, b) => {
    const order: Record<string, number> = { SSR: 0, SR: 1, R: 2 }
    return (order[a.character.rarity] ?? 9) - (order[b.character.rarity] ?? 9)
  })

  currentResults.value = results
  pullHistory.value = [...results, ...pullHistory.value]
  showResults.value = true
  isAnimating.value = false
}

function resetSimulator() {
  pityCounter.value = 0
  totalPulls.value = 0
  ssrCount.value = 0
  srCount.value = 0
  pullHistory.value = []
  currentResults.value = []
  showResults.value = false
  obtained.value = new Set()
}

const ssrRate = computed(() => {
  if (totalPulls.value === 0) return '0.00'
  return ((ssrCount.value / totalPulls.value) * 100).toFixed(2)
})

function getPortraitUrl(id: string): string {
  return withBase(`/portraits/${id}.png`)
}

function getRarityClass(rarity: string): string {
  return `gs-rarity-${rarity.toLowerCase()}`
}
</script>

<template>
  <div class="gs-wrapper">
    <div v-if="loading" class="gs-loading">Loading...</div>
    <div v-else-if="error" class="gs-error">{{ error }}</div>

    <template v-else>
      <!-- Stats panel -->
      <div class="gs-stats">
        <div class="gs-stat">
          <div class="gs-stat__value">{{ totalPulls }}</div>
          <div class="gs-stat__label">Total Pulls</div>
        </div>
        <div class="gs-stat">
          <div class="gs-stat__value gs-gold">{{ ssrCount }}</div>
          <div class="gs-stat__label">SSR</div>
        </div>
        <div class="gs-stat">
          <div class="gs-stat__value gs-purple">{{ srCount }}</div>
          <div class="gs-stat__label">SR</div>
        </div>
        <div class="gs-stat">
          <div class="gs-stat__value">{{ ssrRate }}%</div>
          <div class="gs-stat__label">SSR Rate</div>
        </div>
        <div class="gs-stat">
          <div class="gs-stat__value gs-brand">{{ pityCounter }}</div>
          <div class="gs-stat__label">Pity ({{ HARD_PITY }})</div>
        </div>
      </div>

      <!-- Pity bar -->
      <div class="gs-pity-bar-wrapper">
        <div class="gs-pity-label">Pity Progress: {{ pityCounter }} / {{ HARD_PITY }}</div>
        <div class="gs-pity-bar">
          <div
            class="gs-pity-fill"
            :style="{ width: `${(pityCounter / HARD_PITY) * 100}%` }"
            :class="{ 'gs-pity-near': pityCounter >= 20 }"
          />
        </div>
      </div>

      <!-- Action buttons -->
      <div class="gs-actions">
        <button
          class="gs-btn gs-btn--pull1"
          @click="pull(1)"
          :disabled="isAnimating"
        >
          Pull x1
        </button>
        <button
          class="gs-btn gs-btn--pull10"
          @click="pull(10)"
          :disabled="isAnimating"
        >
          Pull x10
        </button>
        <button
          class="gs-btn gs-btn--reset"
          @click="resetSimulator"
          :disabled="isAnimating"
        >
          Reset
        </button>
      </div>

      <!-- Animation overlay -->
      <div v-if="isAnimating" class="gs-animating">
        <div class="gs-spinner" />
        <div class="gs-anim-text">Summoning...</div>
      </div>

      <!-- Results -->
      <div v-if="showResults && currentResults.length" class="gs-results">
        <div class="gs-results-title">Results</div>
        <div class="gs-results-grid">
          <div
            v-for="(result, idx) in currentResults"
            :key="idx"
            class="gs-result-card"
            :class="[
              result.animation,
              `gs-result-card--${result.character.rarity.toLowerCase()}`
            ]"
          >
            <div class="gs-result-portrait">
              <img
                v-if="result.character.rarity !== 'R'"
                :src="getPortraitUrl(result.character.id)"
                :alt="result.character.name_en"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <div v-else class="gs-result-r-placeholder">R</div>
            </div>
            <div class="gs-result-info">
              <span class="gs-result-rarity" :class="getRarityClass(result.character.rarity)">
                {{ result.character.rarity }}
              </span>
              <span v-if="result.isNew && result.character.rarity !== 'R'" class="gs-result-new">NEW</span>
            </div>
            <div class="gs-result-name">{{ result.character.name }}</div>
            <div class="gs-result-name-en" v-if="result.character.rarity !== 'R'">
              {{ result.character.name_en }}
            </div>
          </div>
        </div>
      </div>

      <!-- Disclaimer -->
      <div class="gs-disclaimer">
        This simulator is for entertainment only. Rates approximate the v2.0+ system (3% SSR base, 30 hard pity).
        Actual in-game rates and mechanics may differ.
      </div>
    </template>
  </div>
</template>

<style scoped>
.gs-wrapper {
  margin: 16px 0;
}

.gs-loading, .gs-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.gs-error {
  color: var(--vp-c-danger-1);
}

.gs-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.gs-stat {
  flex: 1;
  min-width: 100px;
  text-align: center;
  padding: 14px 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
}

.gs-stat__value {
  font-size: 24px;
  font-weight: 800;
  color: var(--vp-c-text-1);
  line-height: 1.2;
}

.gs-stat__label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}

.gs-gold { color: #f59e0b; }
.gs-purple { color: #a855f7; }
.gs-brand { color: var(--vp-c-brand-1); }

.gs-pity-bar-wrapper {
  margin-bottom: 20px;
}

.gs-pity-label {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
}

.gs-pity-bar {
  height: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  overflow: hidden;
}

.gs-pity-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  border-radius: 5px;
  transition: width 0.3s ease;
}

.gs-pity-fill.gs-pity-near {
  background: linear-gradient(90deg, #f59e0b, #ef4444);
}

.gs-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.gs-btn {
  padding: 12px 28px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  color: #fff;
}

.gs-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.gs-btn--pull1 {
  background: var(--vp-c-brand-1);
}

.gs-btn--pull1:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(109, 93, 252, 0.3);
}

.gs-btn--pull10 {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
}

.gs-btn--pull10:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

.gs-btn--reset {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

.gs-btn--reset:hover:not(:disabled) {
  border-color: var(--vp-c-text-2);
}

.gs-animating {
  text-align: center;
  padding: 40px;
}

.gs-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--vp-c-divider);
  border-top-color: var(--vp-c-brand-1);
  border-radius: 50%;
  margin: 0 auto 12px;
  animation: gs-spin 0.8s linear infinite;
}

@keyframes gs-spin {
  to { transform: rotate(360deg); }
}

.gs-anim-text {
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.gs-results {
  margin-bottom: 24px;
}

.gs-results-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--vp-c-text-1);
}

.gs-results-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.gs-result-card {
  text-align: center;
  padding: 12px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  animation: gs-card-appear 0.4s ease-out;
}

.gs-result-card--ssr {
  border-color: #f59e0b;
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.2);
}

.gs-result-card--sr {
  border-color: #a855f7;
  box-shadow: 0 0 8px rgba(168, 85, 247, 0.15);
}

@keyframes gs-card-appear {
  from {
    opacity: 0;
    transform: scale(0.8) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.ssr-glow {
  animation: gs-card-appear 0.4s ease-out, gs-ssr-glow 2s ease-in-out infinite alternate;
}

@keyframes gs-ssr-glow {
  from { box-shadow: 0 0 12px rgba(245, 158, 11, 0.2); }
  to { box-shadow: 0 0 24px rgba(245, 158, 11, 0.4); }
}

.sr-glow {
  animation: gs-card-appear 0.4s ease-out;
}

.gs-result-portrait {
  width: 80px;
  height: 80px;
  margin: 0 auto 8px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.gs-result-portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gs-result-r-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 800;
  color: var(--vp-c-text-3);
}

.gs-result-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 4px;
}

.gs-result-rarity {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
}

.gs-rarity-ssr { background: #fef3c7; color: #92400e; }
.gs-rarity-sr { background: #f3e8ff; color: #6b21a8; }
.gs-rarity-r { background: var(--vp-c-bg-soft); color: var(--vp-c-text-3); }

.gs-result-new {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  background: #dcfce7;
  color: #16a34a;
}

.gs-result-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.gs-result-name-en {
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.gs-disclaimer {
  font-size: 12px;
  color: var(--vp-c-text-3);
  text-align: center;
  padding: 16px;
  border-top: 1px solid var(--vp-c-divider);
  line-height: 1.5;
}

@media (max-width: 640px) {
  .gs-stats {
    flex-wrap: wrap;
  }

  .gs-stat {
    min-width: 80px;
  }

  .gs-results-grid {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
  }

  .gs-result-portrait {
    width: 60px;
    height: 60px;
  }

  .gs-actions {
    flex-direction: column;
  }

  .gs-btn {
    width: 100%;
  }
}
</style>
