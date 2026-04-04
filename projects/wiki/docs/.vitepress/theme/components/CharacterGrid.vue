<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useData, withBase } from 'vitepress'

interface Character {
  id: string
  name: string
  name_en: string
  rarity: string
  realm: string
  role: string
  is_limited: boolean
  description?: string
  tags?: string[]
}

const router = useRouter()
const { lang } = useData()
const characters = ref<Character[]>([])
const loading = ref(true)
const error = ref('')

const filterRealm = ref('all')
const filterRole = ref('all')
const filterRarity = ref('all')
const sortBy = ref('name')
const searchQuery = ref('')

const realmLabels: Record<string, string> = {
  chaos: 'Chaos',
  aequor: 'Aequor',
  caro: 'Caro',
  ultra: 'Ultra',
}

const roleLabels: Record<string, string> = {
  attack: 'Attack',
  sub_attack: 'Sub-Attack',
  defense: 'Defense',
  support: 'Support',
  healer: 'Healer',
  chorus: 'Chorus',
}

const realmEmoji: Record<string, string> = {
  chaos: '\u{1F30C}',
  aequor: '\u{1F30A}',
  caro: '\u{1FA78}',
  ultra: '\u{269B}\uFE0F',
}

onMounted(async () => {
  try {
    const res = await fetch(withBase('/data/db/characters.json'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    characters.value = [...(data.characters || []), ...(data.sr_characters || [])]
  } catch (e: any) {
    error.value = `Failed to load character data: ${e.message}`
  } finally {
    loading.value = false
  }
})

const filteredCharacters = computed(() => {
  let result = [...characters.value]

  if (filterRealm.value !== 'all') {
    result = result.filter(c => c.realm === filterRealm.value)
  }
  if (filterRole.value !== 'all') {
    result = result.filter(c => c.role === filterRole.value)
  }
  if (filterRarity.value !== 'all') {
    result = result.filter(c => c.rarity === filterRarity.value)
  }
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.name_en.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    )
  }

  result.sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name_en.localeCompare(b.name_en)
      case 'realm':
        return a.realm.localeCompare(b.realm) || a.name_en.localeCompare(b.name_en)
      case 'role':
        return a.role.localeCompare(b.role) || a.name_en.localeCompare(b.name_en)
      case 'rarity':
        return (b.rarity === 'SSR' ? 1 : 0) - (a.rarity === 'SSR' ? 1 : 0)
      default:
        return 0
    }
  })

  return result
})

function navigateToCharacter(id: string) {
  // zh is rewritten to root via VitePress rewrites; en/ja keep prefix
  const l = lang.value || 'zh'
  const prefix = l === 'zh' || l === 'root' ? '' : `/${l}`
  router.go(withBase(`${prefix}/awakeners/${id}.html`))
}

function getPortraitUrl(id: string): string {
  return withBase(`/portraits/${id}.png`)
}
</script>

<template>
  <div class="character-grid-wrapper">
    <div class="cg-toolbar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search..."
        class="cg-search-input"
      />
      <select v-model="filterRealm" class="cg-select">
        <option value="all">Realm</option>
        <option v-for="(label, key) in realmLabels" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterRole" class="cg-select">
        <option value="all">Role</option>
        <option v-for="(label, key) in roleLabels" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterRarity" class="cg-select">
        <option value="all">Rarity</option>
        <option value="SSR">SSR</option>
        <option value="SR">SR</option>
      </select>
    </div>

    <div v-if="loading" class="cg-loading">Loading...</div>
    <div v-else-if="error" class="cg-error">{{ error }}</div>

    <div class="cg-grid" v-if="!loading && !error">
      <div
        v-for="char in filteredCharacters"
        :key="char.id"
        class="cg-card"
        :class="`cg-card--${char.realm}`"
        @click="navigateToCharacter(char.id)"
        role="button"
        tabindex="0"
        @keydown.enter="navigateToCharacter(char.id)"
      >
        <div class="cg-card__portrait">
          <img
            :src="getPortraitUrl(char.id)"
            :alt="char.name_en"
            loading="lazy"
            @error="($event.target as HTMLImageElement).src = withBase('/portraits/placeholder.png')"
          />
          <span class="cg-card__rarity" :class="`rarity-${char.rarity.toLowerCase()}`">
            {{ char.rarity }}
          </span>
          <span v-if="char.is_limited" class="cg-card__limited">Limited</span>
        </div>
        <div class="cg-card__info">
          <div class="cg-card__name">{{ char.name }} <span class="cg-card__name-en">{{ char.name_en }}</span></div>
          <div class="cg-card__meta">
            <span class="cg-realm-badge" :class="`realm-${char.realm}`">
              {{ realmEmoji[char.realm] }} {{ realmLabels[char.realm] }}
            </span>
            <span class="cg-role-badge">{{ roleLabels[char.role] || char.role }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.character-grid-wrapper {
  margin: 0;
}

.cg-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.cg-search-input {
  flex: 1;
  min-width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.cg-search-input:focus {
  border-color: var(--vp-c-brand-1);
}

.cg-select {
  padding: 6px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.cg-select:focus {
  border-color: var(--vp-c-brand-1);
}

.cg-loading, .cg-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.cg-error {
  color: var(--vp-c-danger-1);
}

.cg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.cg-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.25s ease;
  background: var(--vp-c-bg);
}

.cg-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  border-color: var(--vp-c-brand-1);
}

.cg-card--chaos { border-top: 3px solid #7c3aed; }
.cg-card--aequor { border-top: 3px solid #06b6d4; }
.cg-card--caro { border-top: 3px solid #ef4444; }
.cg-card--ultra { border-top: 3px solid #3b82f6; }

.cg-card__portrait {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}

.cg-card__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.cg-card__rarity {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.rarity-ssr {
  color: #fbbf24;
}

.rarity-sr {
  color: #c084fc;
}

.cg-card__limited {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
  backdrop-filter: blur(4px);
}

.cg-card__info {
  padding: 8px 10px;
}

.cg-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
  margin-bottom: 4px;
}

.cg-card__name-en {
  font-size: 11px;
  color: var(--vp-c-text-2);
  font-weight: 400;
}

.cg-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.cg-realm-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.realm-chaos { background: #4c1d95; color: #e9d5ff; }
.realm-aequor { background: #164e63; color: #cffafe; }
.realm-caro { background: #7f1d1d; color: #fecaca; }
.realm-ultra { background: #1e3a5f; color: #bfdbfe; }

.cg-role-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

@media (max-width: 640px) {
  .cg-toolbar {
    gap: 4px;
  }

  .cg-search-input {
    flex-basis: 100%;
  }

  .cg-select {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    padding: 5px 4px;
  }

  .cg-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .cg-card {
    border-radius: 8px;
  }

  .cg-card__portrait {
    aspect-ratio: 1;
  }

  .cg-card__info {
    padding: 4px 6px 6px;
  }

  .cg-card__name {
    font-size: 12px;
    line-height: 1.2;
  }

  .cg-card__name-en {
    display: none;
  }

  .cg-card__meta {
    gap: 3px;
  }

  .cg-realm-badge,
  .cg-role-badge {
    font-size: 9px;
    padding: 1px 4px;
  }

  .cg-card__rarity {
    font-size: 9px;
    padding: 1px 5px;
    top: 4px;
    left: 4px;
  }

  .cg-card__limited {
    font-size: 8px;
    padding: 1px 4px;
    top: 4px;
    right: 4px;
  }
}
</style>
