<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { withBase } from 'vitepress'

interface Wheel {
  name: string
  name_en?: string
  character?: string | null
  recommended?: string[]
  effect?: string
  main_stat?: string
  category: string
  rarity: string
  type: string
}

const wheels = ref<Wheel[]>([])
const loading = ref(true)
const error = ref('')

const filterRarity = ref('all')
const filterType = ref('all')
const sortBy = ref('name')
const searchQuery = ref('')

const categoryMeta: Record<string, { rarity: string; type: string; label: string }> = {
  ssr_limited_oblivion: { rarity: 'SSR', type: 'limited', label: 'SSR Limited (Oblivion)' },
  ssr_limited_stellar: { rarity: 'SSR', type: 'limited', label: 'SSR Limited (Stellar)' },
  ssr_standard: { rarity: 'SSR', type: 'standard', label: 'SSR Standard' },
  sr_wheels: { rarity: 'SR', type: 'standard', label: 'SR' },
  r_wheels: { rarity: 'R', type: 'standard', label: 'R' },
}

onMounted(async () => {
  try {
    const res = await fetch(withBase('/data/db/equipment.json'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const wod = data.wheels_of_destiny || {}
    const allWheels: Wheel[] = []

    for (const [catKey, meta] of Object.entries(categoryMeta)) {
      const items = wod[catKey]
      if (!Array.isArray(items)) continue
      for (const item of items) {
        allWheels.push({
          ...item,
          category: meta.label,
          rarity: meta.rarity,
          type: meta.type,
        })
      }
    }

    wheels.value = allWheels
  } catch (e: any) {
    error.value = `Failed to load equipment data: ${e.message}`
  } finally {
    loading.value = false
  }
})

const filteredWheels = computed(() => {
  let result = [...wheels.value]

  if (filterRarity.value !== 'all') {
    result = result.filter(w => w.rarity === filterRarity.value)
  }
  if (filterType.value !== 'all') {
    result = result.filter(w => w.type === filterType.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(w =>
      w.name.toLowerCase().includes(q) ||
      (w.name_en || '').toLowerCase().includes(q) ||
      (w.character || '').toLowerCase().includes(q) ||
      (w.recommended || []).some(r => r.toLowerCase().includes(q))
    )
  }

  result.sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name, 'zh')
      case 'name_en':
        return (a.name_en || '').localeCompare(b.name_en || '')
      case 'rarity': {
        const order: Record<string, number> = { SSR: 0, SR: 1, R: 2 }
        return (order[a.rarity] ?? 9) - (order[b.rarity] ?? 9)
      }
      case 'character':
        return (a.character || 'zzz').localeCompare(b.character || 'zzz', 'zh')
      default:
        return 0
    }
  })

  return result
})
</script>

<template>
  <div class="wl-wrapper">
    <div class="wl-toolbar">
      <div class="wl-search">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search wheels by name, character..."
          class="wl-search-input"
        />
      </div>
      <div class="wl-filters">
        <select v-model="filterRarity" class="wl-select">
          <option value="all">All Rarities</option>
          <option value="SSR">SSR</option>
          <option value="SR">SR</option>
          <option value="R">R</option>
        </select>

        <select v-model="filterType" class="wl-select">
          <option value="all">All Types</option>
          <option value="limited">Limited</option>
          <option value="standard">Standard</option>
        </select>

        <select v-model="sortBy" class="wl-select">
          <option value="name">Sort: Name (ZH)</option>
          <option value="name_en">Sort: Name (EN)</option>
          <option value="rarity">Sort: Rarity</option>
          <option value="character">Sort: Character</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="wl-loading">Loading wheels...</div>
    <div v-else-if="error" class="wl-error">{{ error }}</div>

    <div class="wl-count" v-if="!loading && !error">
      {{ filteredWheels.length }} wheel{{ filteredWheels.length !== 1 ? 's' : '' }}
    </div>

    <div class="wl-list" v-if="!loading && !error">
      <div
        v-for="(wheel, idx) in filteredWheels"
        :key="idx"
        class="wl-item"
        :class="`wl-item--${wheel.rarity.toLowerCase()}`"
      >
        <div class="wl-item__header">
          <span class="wl-item__rarity" :class="`wl-rarity-${wheel.rarity.toLowerCase()}`">
            {{ wheel.rarity }}
          </span>
          <span v-if="wheel.type === 'limited'" class="wl-item__limited">Limited</span>
          <span class="wl-item__category">{{ wheel.category }}</span>
        </div>

        <div class="wl-item__name">{{ wheel.name }}</div>
        <div class="wl-item__name-en" v-if="wheel.name_en">{{ wheel.name_en }}</div>

        <div class="wl-item__details">
          <div v-if="wheel.character" class="wl-item__character">
            <span class="wl-detail-label">Character:</span> {{ wheel.character }}
          </div>
          <div v-if="wheel.recommended?.length" class="wl-item__recommended">
            <span class="wl-detail-label">Recommended:</span>
            <span
              v-for="(r, i) in wheel.recommended"
              :key="i"
              class="wl-rec-tag"
            >{{ r }}</span>
          </div>
          <div v-if="wheel.main_stat" class="wl-item__stat">
            <span class="wl-detail-label">Main Stat:</span> {{ wheel.main_stat }}
          </div>
          <div v-if="wheel.effect" class="wl-item__effect">
            {{ wheel.effect }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wl-wrapper {
  margin: 16px 0;
}

.wl-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
}

.wl-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.wl-search-input:focus {
  border-color: var(--vp-c-brand-1);
}

.wl-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wl-select {
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  cursor: pointer;
  outline: none;
  min-width: 160px;
}

.wl-select:focus {
  border-color: var(--vp-c-brand-1);
}

.wl-count {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-bottom: 12px;
}

.wl-loading, .wl-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.wl-error {
  color: var(--vp-c-danger-1);
}

.wl-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wl-item {
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  transition: all 0.2s;
}

.wl-item:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 12px rgba(109, 93, 252, 0.08);
}

.wl-item--ssr { border-left: 4px solid #fbbf24; }
.wl-item--sr { border-left: 4px solid #c084fc; }
.wl-item--r { border-left: 4px solid #60a5fa; }

.wl-item__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.wl-item__rarity {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.wl-rarity-ssr { background: #fef3c7; color: #92400e; }
.wl-rarity-sr { background: #f3e8ff; color: #6b21a8; }
.wl-rarity-r { background: #dbeafe; color: #1e40af; }

.wl-item__limited {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.wl-item__category {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.wl-item__name {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.wl-item__name-en {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.wl-item__details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.wl-detail-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.wl-item__character {
  font-size: 13px;
  color: var(--vp-c-text-1);
}

.wl-item__recommended {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.wl-rec-tag {
  display: inline-block;
  padding: 1px 8px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.wl-item__stat {
  font-size: 13px;
  color: var(--vp-c-text-1);
}

.wl-item__effect {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  padding: 8px;
  background: var(--vp-c-bg-soft);
  border-radius: 6px;
  margin-top: 4px;
}

@media (max-width: 640px) {
  .wl-filters {
    flex-direction: column;
  }

  .wl-select {
    width: 100%;
  }
}
</style>
