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

const characters = ref<Character[]>([])
const loading = ref(true)
const error = ref('')

const team = ref<(Character | null)[]>([null, null, null, null])
const selectedSlot = ref<number | null>(null)
const searchQuery = ref('')

const realmLabels: Record<string, string> = {
  chaos: 'Chaos',
  aequor: 'Aequor',
  caro: 'Caro',
  ultra: 'Ultra',
}

const realmEmoji: Record<string, string> = {
  chaos: '\u{1F30C}',
  aequor: '\u{1F30A}',
  caro: '\u{1FA78}',
  ultra: '\u{269B}\uFE0F',
}

const roleLabels: Record<string, string> = {
  attack: 'Attack',
  sub_attack: 'Sub-Atk',
  defense: 'Defense',
  support: 'Support',
  healer: 'Healer',
  chorus: 'Chorus',
}

// Realm resonance: a team benefits from having characters of the same realm
// 2 same = "Duo", 3 = "Trio", 4 = "Full"
// Mixed realms can cause conflicts (less synergy)
const RESONANCE_THRESHOLDS = [
  { count: 4, label: 'Full Resonance', type: 'excellent' as const },
  { count: 3, label: 'Trio Resonance', type: 'good' as const },
  { count: 2, label: 'Duo Resonance', type: 'ok' as const },
]

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

const teamMembers = computed(() => team.value.filter((c): c is Character => c !== null))

const teamIds = computed(() => new Set(teamMembers.value.map(c => c.id)))

const realmCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const c of teamMembers.value) {
    counts[c.realm] = (counts[c.realm] || 0) + 1
  }
  return counts
})

const resonanceInfo = computed(() => {
  const realms = Object.entries(realmCounts.value)
  if (realms.length === 0) return null

  const results: { realm: string; count: number; label: string; type: string }[] = []

  for (const [realm, count] of realms) {
    for (const threshold of RESONANCE_THRESHOLDS) {
      if (count >= threshold.count) {
        results.push({
          realm,
          count,
          label: `${realmLabels[realm]} ${threshold.label} (${count}/4)`,
          type: threshold.type,
        })
        break
      }
    }
  }

  return results
})

const warnings = computed(() => {
  const warns: string[] = []

  const realms = Object.keys(realmCounts.value)
  if (realms.length >= 3 && teamMembers.value.length >= 3) {
    warns.push('Mixed realms (3+): limited realm resonance synergy. Consider focusing on 1-2 realms.')
  }

  const roles = teamMembers.value.map(c => c.role)
  const attackCount = roles.filter(r => r === 'attack').length
  if (attackCount >= 3) {
    warns.push('Too many Attack characters. Consider adding Support or Defense.')
  }

  const hasDefenseOrSupport = roles.some(r => r === 'defense' || r === 'support' || r === 'healer')
  if (teamMembers.value.length >= 3 && !hasDefenseOrSupport) {
    warns.push('No Defense/Support in team. Team may lack survivability.')
  }

  return warns
})

const availableCharacters = computed(() => {
  let pool = characters.value.filter(c => !teamIds.value.has(c.id))

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    pool = pool.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.name_en.toLowerCase().includes(q)
    )
  }

  return pool.sort((a, b) => a.realm.localeCompare(b.realm) || a.name_en.localeCompare(b.name_en))
})

function openSlot(index: number) {
  selectedSlot.value = index
  searchQuery.value = ''
}

function selectCharacter(char: Character) {
  if (selectedSlot.value !== null) {
    team.value[selectedSlot.value] = char
    selectedSlot.value = null
    searchQuery.value = ''
  }
}

function removeFromSlot(index: number) {
  team.value[index] = null
}

function clearTeam() {
  team.value = [null, null, null, null]
  selectedSlot.value = null
}

function getPortraitUrl(id: string): string {
  return withBase(`/portraits/${id}.png`)
}
</script>

<template>
  <div class="tb-wrapper">
    <div v-if="loading" class="tb-loading">Loading characters...</div>
    <div v-else-if="error" class="tb-error">{{ error }}</div>

    <template v-else>
      <!-- Team slots -->
      <div class="tb-team">
        <div class="tb-team-header">
          <h3 class="tb-title">Your Team</h3>
          <button class="tb-clear-btn" @click="clearTeam" v-if="teamMembers.length > 0">
            Clear All
          </button>
        </div>

        <div class="tb-slots">
          <div
            v-for="(member, idx) in team"
            :key="idx"
            class="tb-slot"
            :class="{
              'tb-slot--filled': member !== null,
              'tb-slot--active': selectedSlot === idx,
              [`tb-slot--${member?.realm}`]: member,
            }"
            @click="member ? undefined : openSlot(idx)"
          >
            <template v-if="member">
              <div class="tb-slot__portrait">
                <img
                  :src="getPortraitUrl(member.id)"
                  :alt="member.name_en"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
              </div>
              <div class="tb-slot__info">
                <div class="tb-slot__name">{{ member.name }}</div>
                <div class="tb-slot__meta">
                  <span class="tb-realm-badge" :class="`realm-${member.realm}`">
                    {{ realmEmoji[member.realm] }} {{ realmLabels[member.realm] }}
                  </span>
                  <span class="tb-role-tag">{{ roleLabels[member.role] }}</span>
                </div>
              </div>
              <button class="tb-slot__remove" @click.stop="removeFromSlot(idx)" title="Remove">
                &times;
              </button>
            </template>
            <template v-else>
              <div class="tb-slot__empty" @click="openSlot(idx)">
                <span class="tb-slot__plus">+</span>
                <span class="tb-slot__label">Slot {{ idx + 1 }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Resonance info -->
      <div class="tb-resonance" v-if="teamMembers.length >= 2">
        <h4 class="tb-resonance-title">Realm Resonance</h4>
        <div class="tb-resonance-list">
          <div
            v-for="(info, idx) in resonanceInfo"
            :key="idx"
            class="tb-resonance-badge"
            :class="`tb-resonance--${info.type}`"
          >
            {{ info.label }}
          </div>
          <div v-if="!resonanceInfo?.length" class="tb-resonance-none">
            No resonance (all different realms)
          </div>
        </div>
      </div>

      <!-- Warnings -->
      <div class="tb-warnings" v-if="warnings.length">
        <div v-for="(warn, idx) in warnings" :key="idx" class="tb-warning">
          {{ warn }}
        </div>
      </div>

      <!-- Realm summary -->
      <div class="tb-realm-summary" v-if="teamMembers.length > 0">
        <div
          v-for="(count, realm) in realmCounts"
          :key="realm"
          class="tb-realm-count"
        >
          <span class="tb-realm-badge" :class="`realm-${realm}`">
            {{ realmEmoji[realm as string] }} {{ realmLabels[realm as string] }}
          </span>
          <span class="tb-realm-num">&times;{{ count }}</span>
        </div>
      </div>

      <!-- Character picker modal -->
      <div class="tb-picker" v-if="selectedSlot !== null">
        <div class="tb-picker-header">
          <h4 class="tb-picker-title">Select Character for Slot {{ (selectedSlot ?? 0) + 1 }}</h4>
          <button class="tb-picker-close" @click="selectedSlot = null">&times;</button>
        </div>

        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search characters..."
          class="tb-picker-search"
        />

        <div class="tb-picker-grid">
          <div
            v-for="char in availableCharacters"
            :key="char.id"
            class="tb-picker-item"
            :class="`tb-picker-item--${char.realm}`"
            @click="selectCharacter(char)"
          >
            <div class="tb-picker-portrait">
              <img
                :src="getPortraitUrl(char.id)"
                :alt="char.name_en"
                loading="lazy"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
            </div>
            <div class="tb-picker-name">{{ char.name }}</div>
            <div class="tb-picker-meta">
              <span class="tb-realm-mini" :class="`realm-${char.realm}`">
                {{ realmLabels[char.realm]?.slice(0, 3) }}
              </span>
              <span class="tb-role-mini">{{ roleLabels[char.role] }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tb-wrapper {
  margin: 16px 0;
}

.tb-loading, .tb-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.tb-error {
  color: var(--vp-c-danger-1);
}

.tb-team-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tb-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}

.tb-clear-btn {
  padding: 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 13px;
  cursor: pointer;
}

.tb-clear-btn:hover {
  border-color: var(--vp-c-danger-1);
  color: var(--vp-c-danger-1);
}

.tb-slots {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.tb-slot {
  position: relative;
  border: 2px solid var(--vp-c-divider);
  border-radius: 12px;
  min-height: 180px;
  background: var(--vp-c-bg);
  overflow: hidden;
  transition: all 0.2s;
}

.tb-slot--active {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.tb-slot--chaos { border-color: #7c3aed; }
.tb-slot--aequor { border-color: #06b6d4; }
.tb-slot--caro { border-color: #ef4444; }
.tb-slot--ultra { border-color: #3b82f6; }

.tb-slot__portrait {
  width: 100%;
  aspect-ratio: 1;
  background: var(--vp-c-bg-soft);
  overflow: hidden;
}

.tb-slot__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tb-slot__info {
  padding: 8px;
}

.tb-slot__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
}

.tb-slot__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tb-slot__remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.tb-slot:hover .tb-slot__remove {
  opacity: 1;
}

.tb-slot__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 180px;
  cursor: pointer;
  color: var(--vp-c-text-3);
  transition: all 0.2s;
}

.tb-slot__empty:hover {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.tb-slot__plus {
  font-size: 32px;
  font-weight: 300;
  line-height: 1;
}

.tb-slot__label {
  font-size: 12px;
  margin-top: 4px;
}

.tb-realm-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}

.realm-chaos { background: #4c1d95; color: #e9d5ff; }
.realm-aequor { background: #164e63; color: #cffafe; }
.realm-caro { background: #7f1d1d; color: #fecaca; }
.realm-ultra { background: #1e3a5f; color: #bfdbfe; }

.tb-role-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

/* Resonance */
.tb-resonance {
  margin-bottom: 16px;
  padding: 14px;
  background: var(--vp-c-bg-soft);
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
}

.tb-resonance-title {
  font-size: 14px;
  font-weight: 700;
  margin: 0 0 10px 0;
}

.tb-resonance-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tb-resonance-badge {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
}

.tb-resonance--excellent {
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  color: #92400e;
  border: 1px solid #f59e0b;
}

.tb-resonance--good {
  background: #dcfce7;
  color: #16a34a;
  border: 1px solid #86efac;
}

.tb-resonance--ok {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #93c5fd;
}

.tb-resonance-none {
  color: var(--vp-c-text-3);
  font-size: 13px;
}

/* Warnings */
.tb-warnings {
  margin-bottom: 16px;
}

.tb-warning {
  padding: 10px 14px;
  margin-bottom: 8px;
  border-radius: 8px;
  font-size: 13px;
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
  line-height: 1.5;
}

.dark .tb-warning {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.3);
}

/* Realm summary */
.tb-realm-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.tb-realm-count {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tb-realm-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

/* Character Picker */
.tb-picker {
  margin-top: 16px;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 2px solid var(--vp-c-brand-1);
  border-radius: 12px;
}

.tb-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tb-picker-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
}

.tb-picker-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tb-picker-close:hover {
  color: var(--vp-c-danger-1);
}

.tb-picker-search {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
  margin-bottom: 12px;
}

.tb-picker-search:focus {
  border-color: var(--vp-c-brand-1);
}

.tb-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.tb-picker-item {
  text-align: center;
  padding: 8px 4px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  cursor: pointer;
  transition: all 0.2s;
}

.tb-picker-item:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.tb-picker-item--chaos:hover { border-color: #7c3aed; }
.tb-picker-item--aequor:hover { border-color: #06b6d4; }
.tb-picker-item--caro:hover { border-color: #ef4444; }
.tb-picker-item--ultra:hover { border-color: #3b82f6; }

.tb-picker-portrait {
  width: 64px;
  height: 64px;
  margin: 0 auto 6px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.tb-picker-portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tb-picker-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
  margin-bottom: 4px;
}

.tb-picker-meta {
  display: flex;
  justify-content: center;
  gap: 4px;
}

.tb-realm-mini {
  display: inline-block;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
}

.tb-role-mini {
  font-size: 9px;
  color: var(--vp-c-text-3);
  font-weight: 600;
}

@media (max-width: 768px) {
  .tb-slots {
    grid-template-columns: repeat(2, 1fr);
  }

  .tb-picker-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  }
}

@media (max-width: 480px) {
  .tb-slots {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
}
</style>
