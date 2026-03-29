<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { withBase } from 'vitepress'

interface Skill {
  name: string
  name_en?: string
  cost?: number
  effect: string
  note?: string
}

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
  skills?: {
    command_cards?: Skill[]
    rouse?: { name: string; effect: string }
    exalt?: { name: string; name_en?: string; effect: string }
    enlighten?: { level: number; name: string; name_en?: string; effect: string }[]
    [key: string]: any
  }
}

const characters = ref<Character[]>([])
const loading = ref(true)
const error = ref('')
const leftId = ref('')
const rightId = ref('')

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

const leftChar = computed(() => characters.value.find(c => c.id === leftId.value))
const rightChar = computed(() => characters.value.find(c => c.id === rightId.value))

function getPortraitUrl(id: string): string {
  return withBase(`/portraits/${id}.png`)
}

function isDifferent(field: string): boolean {
  if (!leftChar.value || !rightChar.value) return false
  return (leftChar.value as any)[field] !== (rightChar.value as any)[field]
}

interface CompareRow {
  label: string
  field: string
  format?: (val: any) => string
}

const compareRows: CompareRow[] = [
  { label: 'Rarity', field: 'rarity' },
  { label: 'Realm', field: 'realm', format: (v: string) => realmLabels[v] || v },
  { label: 'Role', field: 'role', format: (v: string) => roleLabels[v] || v },
  { label: 'Limited', field: 'is_limited', format: (v: boolean) => v ? 'Yes' : 'No' },
]

function getFieldValue(char: Character | undefined, row: CompareRow): string {
  if (!char) return '-'
  const val = (char as any)[row.field]
  return row.format ? row.format(val) : String(val ?? '-')
}
</script>

<template>
  <div class="cc-wrapper">
    <div v-if="loading" class="cc-loading">Loading characters...</div>
    <div v-else-if="error" class="cc-error">{{ error }}</div>

    <template v-else>
      <div class="cc-selectors">
        <div class="cc-selector">
          <label class="cc-label">Character A</label>
          <select v-model="leftId" class="cc-select">
            <option value="">-- Select --</option>
            <option
              v-for="c in characters"
              :key="c.id"
              :value="c.id"
              :disabled="c.id === rightId"
            >
              {{ c.name }} ({{ c.name_en }})
            </option>
          </select>
        </div>
        <div class="cc-vs">VS</div>
        <div class="cc-selector">
          <label class="cc-label">Character B</label>
          <select v-model="rightId" class="cc-select">
            <option value="">-- Select --</option>
            <option
              v-for="c in characters"
              :key="c.id"
              :value="c.id"
              :disabled="c.id === leftId"
            >
              {{ c.name }} ({{ c.name_en }})
            </option>
          </select>
        </div>
      </div>

      <div v-if="leftChar || rightChar" class="cc-comparison">
        <!-- Portraits -->
        <div class="cc-portraits">
          <div class="cc-portrait-card" v-if="leftChar">
            <img
              :src="getPortraitUrl(leftChar.id)"
              :alt="leftChar.name_en"
              @error="($event.target as HTMLImageElement).src = withBase('/portraits/placeholder.png')"
            />
            <div class="cc-portrait-name">{{ leftChar.name }}</div>
            <div class="cc-portrait-name-en">{{ leftChar.name_en }}</div>
          </div>
          <div class="cc-portrait-placeholder" v-else>
            <span>Select a character</span>
          </div>

          <div class="cc-portrait-card" v-if="rightChar">
            <img
              :src="getPortraitUrl(rightChar.id)"
              :alt="rightChar.name_en"
              @error="($event.target as HTMLImageElement).src = withBase('/portraits/placeholder.png')"
            />
            <div class="cc-portrait-name">{{ rightChar.name }}</div>
            <div class="cc-portrait-name-en">{{ rightChar.name_en }}</div>
          </div>
          <div class="cc-portrait-placeholder" v-else>
            <span>Select a character</span>
          </div>
        </div>

        <!-- Attribute comparison table -->
        <table class="cc-table">
          <thead>
            <tr>
              <th>Attribute</th>
              <th>{{ leftChar?.name_en || '-' }}</th>
              <th>{{ rightChar?.name_en || '-' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in compareRows"
              :key="row.field"
              :class="{ 'cc-diff': isDifferent(row.field) }"
            >
              <td class="cc-attr-label">{{ row.label }}</td>
              <td>
                <span
                  v-if="row.field === 'realm' && leftChar"
                  class="cc-realm-badge"
                  :class="`realm-${leftChar.realm}`"
                >{{ getFieldValue(leftChar, row) }}</span>
                <span v-else>{{ getFieldValue(leftChar, row) }}</span>
              </td>
              <td>
                <span
                  v-if="row.field === 'realm' && rightChar"
                  class="cc-realm-badge"
                  :class="`realm-${rightChar.realm}`"
                >{{ getFieldValue(rightChar, row) }}</span>
                <span v-else>{{ getFieldValue(rightChar, row) }}</span>
              </td>
            </tr>
            <tr>
              <td class="cc-attr-label">Tags</td>
              <td>{{ leftChar?.tags?.join(', ') || '-' }}</td>
              <td>{{ rightChar?.tags?.join(', ') || '-' }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Skills comparison -->
        <div class="cc-skills-section" v-if="leftChar?.skills || rightChar?.skills">
          <h3 class="cc-section-title">Skills</h3>

          <div class="cc-skills-grid">
            <div class="cc-skill-col">
              <template v-if="leftChar?.skills">
                <div v-if="leftChar.skills.rouse" class="cc-skill-block">
                  <div class="cc-skill-type">Rouse</div>
                  <div class="cc-skill-name">{{ leftChar.skills.rouse.name }}</div>
                  <div class="cc-skill-effect">{{ leftChar.skills.rouse.effect }}</div>
                </div>
                <div v-if="leftChar.skills.exalt" class="cc-skill-block">
                  <div class="cc-skill-type">Exalt</div>
                  <div class="cc-skill-name">{{ leftChar.skills.exalt.name }}</div>
                  <div class="cc-skill-effect">{{ leftChar.skills.exalt.effect }}</div>
                </div>
                <div
                  v-for="card in (leftChar.skills.command_cards || [])"
                  :key="card.name"
                  class="cc-skill-block"
                >
                  <div class="cc-skill-type">
                    Command Card
                    <span v-if="card.cost !== undefined" class="cc-cost">{{ card.cost }}</span>
                  </div>
                  <div class="cc-skill-name">{{ card.name }}</div>
                  <div class="cc-skill-effect">{{ card.effect }}</div>
                </div>
              </template>
              <div v-else class="cc-no-skills">No skill data</div>
            </div>

            <div class="cc-skill-col">
              <template v-if="rightChar?.skills">
                <div v-if="rightChar.skills.rouse" class="cc-skill-block">
                  <div class="cc-skill-type">Rouse</div>
                  <div class="cc-skill-name">{{ rightChar.skills.rouse.name }}</div>
                  <div class="cc-skill-effect">{{ rightChar.skills.rouse.effect }}</div>
                </div>
                <div v-if="rightChar.skills.exalt" class="cc-skill-block">
                  <div class="cc-skill-type">Exalt</div>
                  <div class="cc-skill-name">{{ rightChar.skills.exalt.name }}</div>
                  <div class="cc-skill-effect">{{ rightChar.skills.exalt.effect }}</div>
                </div>
                <div
                  v-for="card in (rightChar.skills.command_cards || [])"
                  :key="card.name"
                  class="cc-skill-block"
                >
                  <div class="cc-skill-type">
                    Command Card
                    <span v-if="card.cost !== undefined" class="cc-cost">{{ card.cost }}</span>
                  </div>
                  <div class="cc-skill-name">{{ card.name }}</div>
                  <div class="cc-skill-effect">{{ card.effect }}</div>
                </div>
              </template>
              <div v-else class="cc-no-skills">No skill data</div>
            </div>
          </div>
        </div>

        <!-- Description comparison -->
        <div class="cc-desc-section" v-if="leftChar?.description || rightChar?.description">
          <h3 class="cc-section-title">Description</h3>
          <div class="cc-desc-grid">
            <div class="cc-desc-block">{{ leftChar?.description || '-' }}</div>
            <div class="cc-desc-block">{{ rightChar?.description || '-' }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cc-wrapper {
  margin: 16px 0;
}

.cc-loading, .cc-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.cc-error {
  color: var(--vp-c-danger-1);
}

.cc-selectors {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.cc-selector {
  flex: 1;
  min-width: 200px;
}

.cc-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
}

.cc-select {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  cursor: pointer;
  outline: none;
}

.cc-select:focus {
  border-color: var(--vp-c-brand-1);
}

.cc-vs {
  font-size: 20px;
  font-weight: 800;
  color: var(--vp-c-brand-1);
  padding-bottom: 6px;
}

.cc-portraits {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
}

.cc-portrait-card {
  text-align: center;
}

.cc-portrait-card img {
  width: 160px;
  height: 160px;
  object-fit: cover;
  border-radius: 12px;
  border: 2px solid var(--vp-c-divider);
}

.cc-portrait-name {
  font-size: 18px;
  font-weight: 700;
  margin-top: 8px;
  color: var(--vp-c-text-1);
}

.cc-portrait-name-en {
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.cc-portrait-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  border: 2px dashed var(--vp-c-divider);
  border-radius: 12px;
  color: var(--vp-c-text-3);
}

.cc-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;
}

.cc-table th,
.cc-table td {
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
  font-size: 14px;
}

.cc-table th {
  background: var(--vp-c-bg-soft);
  font-weight: 600;
}

.cc-diff {
  background: rgba(109, 93, 252, 0.06);
}

.cc-diff td {
  font-weight: 600;
}

.cc-attr-label {
  font-weight: 600;
  color: var(--vp-c-text-2);
  width: 120px;
}

.cc-realm-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.realm-chaos { background: #4c1d95; color: #e9d5ff; }
.realm-aequor { background: #164e63; color: #cffafe; }
.realm-caro { background: #7f1d1d; color: #fecaca; }
.realm-ultra { background: #1e3a5f; color: #bfdbfe; }

.cc-section-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--vp-c-brand-1);
}

.cc-skills-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.cc-skill-block {
  padding: 12px;
  margin-bottom: 10px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.cc-skill-type {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  margin-bottom: 4px;
}

.cc-cost {
  display: inline-block;
  background: #dbeafe;
  color: #1e40af;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 11px;
  margin-left: 4px;
}

.cc-skill-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
}

.cc-skill-effect {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

.cc-no-skills {
  text-align: center;
  padding: 24px;
  color: var(--vp-c-text-3);
  font-style: italic;
}

.cc-desc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.cc-desc-block {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  padding: 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
}

@media (max-width: 640px) {
  .cc-selectors {
    flex-direction: column;
    align-items: stretch;
  }

  .cc-vs {
    text-align: center;
    padding: 0;
  }

  .cc-portraits,
  .cc-skills-grid,
  .cc-desc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
