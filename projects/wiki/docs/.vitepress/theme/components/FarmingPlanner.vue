<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { withBase } from 'vitepress'

interface Character {
  id: string
  name: string
  name_en: string
  rarity: string
  realm: string
  role: string
}

interface MaterialNeed {
  name: string
  name_en: string
  category: string
  amount: number
  source: string
}

interface SelectedChar {
  character: Character
  currentLevel: number
  targetLevel: number
  skillLevel: number
  targetSkillLevel: number
}

const characters = ref<Character[]>([])
const loading = ref(true)
const error = ref('')
const selectedChars = ref<SelectedChar[]>([])
const searchQuery = ref('')
const showCharPicker = ref(false)
const dailyStamina = ref(240)

const realmLabels: Record<string, string> = {
  chaos: 'Chaos',
  aequor: 'Aequor',
  caro: 'Caro',
  ultra: 'Ultra',
}

const realmColors: Record<string, string> = {
  chaos: '#7c3aed',
  aequor: '#06b6d4',
  caro: '#ef4444',
  ultra: '#3b82f6',
}

// Leveling cost table (approximate EXP per level range)
const levelExpCosts: Record<string, number> = {
  '1-10': 3200,
  '10-20': 12000,
  '20-30': 28000,
  '30-40': 52000,
  '40-50': 84000,
  '50-60': 130000,
  '60-70': 200000,
}

// Ascension material requirements per breakpoint
const ascensionBreakpoints = [
  { level: 10, caskets: { basic: 4 }, realmMat: 0 },
  { level: 20, caskets: { basic: 8, intermediate: 2 }, realmMat: 0 },
  { level: 30, caskets: { intermediate: 6, advanced: 1 }, realmMat: 1 },
  { level: 40, caskets: { intermediate: 8, advanced: 3 }, realmMat: 1 },
  { level: 50, caskets: { advanced: 6 }, realmMat: 2 },
  { level: 60, caskets: { advanced: 10 }, realmMat: 2, gnosis: 1 },
]

// Skill upgrade costs per level
const skillCosts = [
  { level: 2, basic: 3, intermediate: 0, advanced: 0, residue: 0, gold: 5000 },
  { level: 3, basic: 6, intermediate: 0, advanced: 0, residue: 0, gold: 10000 },
  { level: 4, basic: 0, intermediate: 4, advanced: 0, residue: 2, gold: 20000 },
  { level: 5, basic: 0, intermediate: 8, advanced: 0, residue: 4, gold: 35000 },
  { level: 6, basic: 0, intermediate: 0, advanced: 3, residue: 6, gold: 50000 },
  { level: 7, basic: 0, intermediate: 0, advanced: 6, residue: 8, gold: 75000 },
  { level: 8, basic: 0, intermediate: 0, advanced: 10, residue: 12, gold: 100000 },
]

// Stamina cost per resource dungeon run
const STAMINA_PER_RUN = 30
// Approximate materials per run
const MATS_PER_RUN = {
  exp: 25000,
  casket_basic: 3,
  casket_intermediate: 1.5,
  casket_advanced: 0.5,
  skill_basic: 3,
  skill_intermediate: 1.5,
  skill_advanced: 0.5,
  residue: 1,
  gold: 15000,
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

const filteredPickerChars = computed(() => {
  const selected = new Set(selectedChars.value.map(s => s.character.id))
  let result = characters.value.filter(c => !selected.has(c.id))
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.name_en.toLowerCase().includes(q)
    )
  }
  return result
})

function addCharacter(char: Character) {
  selectedChars.value.push({
    character: char,
    currentLevel: 1,
    targetLevel: 60,
    skillLevel: 1,
    targetSkillLevel: 5,
  })
  showCharPicker.value = false
  searchQuery.value = ''
}

function removeCharacter(index: number) {
  selectedChars.value.splice(index, 1)
}

function getExpNeeded(from: number, to: number): number {
  let total = 0
  const ranges = [
    [1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 70],
  ]
  for (const [lo, hi] of ranges) {
    const key = `${lo}-${hi}`
    if (from >= hi || to <= lo) continue
    const fraction = (Math.min(to, hi) - Math.max(from, lo)) / (hi - lo)
    total += (levelExpCosts[key] || 0) * fraction
  }
  return Math.ceil(total)
}

const totalMaterials = computed<MaterialNeed[]>(() => {
  const mats: Record<string, MaterialNeed> = {}

  function add(key: string, name: string, nameEn: string, cat: string, amount: number, source: string) {
    if (amount <= 0) return
    if (!mats[key]) {
      mats[key] = { name, name_en: nameEn, category: cat, amount: 0, source }
    }
    mats[key].amount += amount
  }

  for (const sel of selectedChars.value) {
    // EXP materials
    const exp = getExpNeeded(sel.currentLevel, sel.targetLevel)
    if (exp > 0) {
      add('exp', 'Gnosis Elixir (EXP)', 'Gnosis Elixir', 'Experience', exp, 'Dissolution Ruins')
    }

    // Ascension materials
    for (const bp of ascensionBreakpoints) {
      if (sel.currentLevel >= bp.level || sel.targetLevel < bp.level) continue
      if (bp.caskets.basic) {
        add('casket_basic', 'Basic Ascension Casket', 'Basic Ascension Casket', 'Ascension', bp.caskets.basic, 'Dissolution Ruins')
      }
      if (bp.caskets.intermediate) {
        add('casket_intermediate', 'Intermediate Ascension Casket', 'Intermediate Ascension Casket', 'Ascension', bp.caskets.intermediate, 'Dissolution Ruins')
      }
      if (bp.caskets.advanced) {
        add('casket_advanced', 'Advanced Ascension Casket', 'Advanced Ascension Casket', 'Ascension', bp.caskets.advanced, 'Dissolution Ruins')
      }
      if (bp.realmMat) {
        add(`realm_${sel.character.realm}`, `${realmLabels[sel.character.realm]} Realm Material`, `${realmLabels[sel.character.realm]} Breakthrough`, 'Ascension', bp.realmMat, `${realmLabels[sel.character.realm]} Dissolution Ruins`)
      }
      if (bp.gnosis) {
        add('gnosis_core', 'Primordial Spirit Core', 'Primordial Spirit Core', 'Ascension', bp.gnosis, 'Sediment Shop')
      }
    }

    // Skill materials
    for (const sc of skillCosts) {
      if (sel.skillLevel >= sc.level || sel.targetSkillLevel < sc.level) continue
      if (sc.basic) {
        add('skill_basic', 'Basic Skill Supply', 'Basic Skill Supply', 'Skill', sc.basic, 'Dissolution Ruins / Forbidden Inscriptions')
      }
      if (sc.intermediate) {
        add('skill_intermediate', 'Intermediate Skill Supply', 'Intermediate Skill Supply', 'Skill', sc.intermediate, 'Dissolution Ruins / Forbidden Inscriptions')
      }
      if (sc.advanced) {
        add('skill_advanced', 'Advanced Skill Supply', 'Advanced Skill Supply', 'Skill', sc.advanced, 'Dissolution Ruins / Forbidden Inscriptions')
      }
      if (sc.residue) {
        add(`residue_${sel.character.realm}`, `${realmLabels[sel.character.realm]} Residue`, `${realmLabels[sel.character.realm]} Residue`, 'Skill', sc.residue, `${realmLabels[sel.character.realm]} Dissolution Ruins`)
      }
      if (sc.gold) {
        add('gold', 'Rose Scrip', 'Rose Scrip', 'Currency', sc.gold, 'Dissolution Ruins / Dispatch')
      }
    }
  }

  return Object.values(mats).sort((a, b) => {
    const catOrder = ['Experience', 'Ascension', 'Skill', 'Currency']
    return catOrder.indexOf(a.category) - catOrder.indexOf(b.category)
  })
})

const estimatedRuns = computed(() => {
  let maxRuns = 0
  for (const mat of totalMaterials.value) {
    if (mat.category === 'Currency') continue
    let perRun = 1
    if (mat.name_en.includes('Gnosis')) perRun = MATS_PER_RUN.exp
    else if (mat.name_en.includes('Basic Ascension')) perRun = MATS_PER_RUN.casket_basic
    else if (mat.name_en.includes('Intermediate Ascension')) perRun = MATS_PER_RUN.casket_intermediate
    else if (mat.name_en.includes('Advanced Ascension')) perRun = MATS_PER_RUN.casket_advanced
    else if (mat.name_en.includes('Basic Skill')) perRun = MATS_PER_RUN.skill_basic
    else if (mat.name_en.includes('Intermediate Skill')) perRun = MATS_PER_RUN.skill_intermediate
    else if (mat.name_en.includes('Advanced Skill')) perRun = MATS_PER_RUN.skill_advanced
    else if (mat.name_en.includes('Residue')) perRun = MATS_PER_RUN.residue
    const runs = Math.ceil(mat.amount / perRun)
    maxRuns = Math.max(maxRuns, runs)
  }
  return maxRuns
})

const totalStaminaCost = computed(() => estimatedRuns.value * STAMINA_PER_RUN)

const estimatedDays = computed(() => {
  if (dailyStamina.value <= 0) return Infinity
  return Math.ceil(totalStaminaCost.value / dailyStamina.value)
})

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}
</script>

<template>
  <div class="fp-wrapper">
    <h2 class="fp-title">Farming Planner</h2>
    <p class="fp-desc">Select characters to level up and see the total materials needed, farming locations, and estimated time.</p>

    <!-- Selected Characters -->
    <div class="fp-selected" v-if="selectedChars.length > 0">
      <div
        v-for="(sel, idx) in selectedChars"
        :key="sel.character.id"
        class="fp-char-card"
      >
        <div class="fp-char-header">
          <span
            class="fp-char-realm-dot"
            :style="{ background: realmColors[sel.character.realm] }"
          ></span>
          <span class="fp-char-name">{{ sel.character.name_en }}</span>
          <span class="fp-char-rarity" :class="`rarity-${sel.character.rarity.toLowerCase()}`">
            {{ sel.character.rarity }}
          </span>
          <button class="fp-remove-btn" @click="removeCharacter(idx)" title="Remove">x</button>
        </div>
        <div class="fp-char-controls">
          <label class="fp-label">
            <span>Current Lv</span>
            <input type="number" v-model.number="sel.currentLevel" min="1" max="70" class="fp-input" />
          </label>
          <label class="fp-label">
            <span>Target Lv</span>
            <input type="number" v-model.number="sel.targetLevel" min="1" max="70" class="fp-input" />
          </label>
          <label class="fp-label">
            <span>Skill Lv</span>
            <input type="number" v-model.number="sel.skillLevel" min="1" max="8" class="fp-input" />
          </label>
          <label class="fp-label">
            <span>Target Skill</span>
            <input type="number" v-model.number="sel.targetSkillLevel" min="1" max="8" class="fp-input" />
          </label>
        </div>
      </div>
    </div>

    <!-- Add Character -->
    <div class="fp-add-section">
      <button class="fp-add-btn" @click="showCharPicker = !showCharPicker">
        {{ showCharPicker ? 'Cancel' : '+ Add Character' }}
      </button>
    </div>

    <div v-if="showCharPicker" class="fp-picker">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search characters..."
        class="fp-search"
      />
      <div class="fp-picker-grid">
        <div
          v-for="char in filteredPickerChars"
          :key="char.id"
          class="fp-picker-item"
          @click="addCharacter(char)"
        >
          <span
            class="fp-char-realm-dot"
            :style="{ background: realmColors[char.realm] }"
          ></span>
          <span class="fp-picker-name">{{ char.name_en }}</span>
          <span class="fp-picker-rarity" :class="`rarity-${char.rarity.toLowerCase()}`">{{ char.rarity }}</span>
        </div>
        <div v-if="filteredPickerChars.length === 0" class="fp-picker-empty">No characters found</div>
      </div>
    </div>

    <!-- Stamina Budget -->
    <div v-if="selectedChars.length > 0" class="fp-stamina-budget">
      <h3>Daily Stamina Budget</h3>
      <div class="fp-budget-row">
        <label class="fp-label">
          <span>Daily Menophine</span>
          <input type="number" v-model.number="dailyStamina" min="30" max="960" class="fp-input" />
        </label>
        <div class="fp-budget-info">
          <div class="fp-stat">
            <span class="fp-stat-label">Total Runs</span>
            <span class="fp-stat-value">{{ estimatedRuns }}</span>
          </div>
          <div class="fp-stat">
            <span class="fp-stat-label">Total Stamina</span>
            <span class="fp-stat-value">{{ formatNumber(totalStaminaCost) }}</span>
          </div>
          <div class="fp-stat fp-stat-highlight">
            <span class="fp-stat-label">Estimated Days</span>
            <span class="fp-stat-value">{{ estimatedDays === Infinity ? '--' : estimatedDays }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Material Table -->
    <div v-if="totalMaterials.length > 0" class="fp-materials">
      <h3>Materials Needed</h3>
      <table class="fp-table">
        <thead>
          <tr>
            <th>Material</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="mat in totalMaterials" :key="mat.name_en">
            <td class="fp-mat-name">{{ mat.name_en }}</td>
            <td><span class="fp-cat-badge" :class="`cat-${mat.category.toLowerCase()}`">{{ mat.category }}</span></td>
            <td class="fp-mat-amount">{{ formatNumber(mat.amount) }}</td>
            <td class="fp-mat-source">{{ mat.source }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="selectedChars.length === 0" class="fp-empty">
      <p>Add characters above to start planning your farming route.</p>
    </div>

    <div v-if="loading" class="fp-loading">Loading character data...</div>
    <div v-if="error" class="fp-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.fp-wrapper {
  margin: 16px 0;
}

.fp-title {
  font-size: 1.5em;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
  border: none;
}

.fp-desc {
  color: var(--vp-c-text-2);
  font-size: 14px;
  margin-bottom: 20px;
}

.fp-selected {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.fp-char-card {
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.fp-char-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.fp-char-realm-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.fp-char-name {
  font-weight: 600;
  font-size: 15px;
  color: var(--vp-c-text-1);
}

.fp-char-rarity {
  font-size: 12px;
  font-weight: 700;
}

.fp-remove-btn {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.fp-remove-btn:hover {
  background: var(--vp-c-danger-soft);
  color: var(--vp-c-danger-1);
  border-color: var(--vp-c-danger-1);
}

.fp-char-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.fp-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.fp-input {
  width: 90px;
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.fp-input:focus {
  border-color: var(--vp-c-brand-1);
}

.fp-add-section {
  margin-bottom: 16px;
}

.fp-add-btn {
  padding: 10px 20px;
  border: 2px dashed var(--vp-c-divider);
  border-radius: 12px;
  background: transparent;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  transition: all 0.2s;
}

.fp-add-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.fp-picker {
  margin-bottom: 20px;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.fp-search {
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

.fp-search:focus {
  border-color: var(--vp-c-brand-1);
}

.fp-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.fp-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  cursor: pointer;
  transition: all 0.2s;
}

.fp-picker-item:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.fp-picker-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.fp-picker-rarity {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
}

.fp-picker-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 20px;
  color: var(--vp-c-text-3);
}

.fp-stamina-budget {
  margin-bottom: 24px;
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.fp-stamina-budget h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 16px 0;
  border: none;
}

.fp-budget-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 24px;
}

.fp-budget-info {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.fp-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fp-stat-label {
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.fp-stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.fp-stat-highlight .fp-stat-value {
  color: var(--vp-c-brand-1);
}

.fp-materials {
  margin-bottom: 24px;
}

.fp-materials h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 12px 0;
  border: none;
}

.fp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.fp-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 2px solid var(--vp-c-divider);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.fp-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.fp-mat-name {
  font-weight: 500;
}

.fp-mat-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.fp-mat-source {
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.fp-cat-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.cat-experience { background: #065f46; color: #a7f3d0; }
.cat-ascension { background: #7c2d12; color: #fed7aa; }
.cat-skill { background: #1e3a5f; color: #bfdbfe; }
.cat-currency { background: #713f12; color: #fef08a; }

.fp-empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--vp-c-text-3);
  border: 2px dashed var(--vp-c-divider);
  border-radius: 12px;
}

.fp-loading, .fp-error {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-2);
}

.fp-error {
  color: var(--vp-c-danger-1);
}

@media (max-width: 640px) {
  .fp-char-controls {
    flex-direction: column;
  }

  .fp-input {
    width: 100%;
  }

  .fp-budget-row {
    flex-direction: column;
    gap: 16px;
  }

  .fp-picker-grid {
    grid-template-columns: 1fr;
  }

  .fp-table {
    font-size: 12px;
  }

  .fp-table th, .fp-table td {
    padding: 8px 6px;
  }
}
</style>
