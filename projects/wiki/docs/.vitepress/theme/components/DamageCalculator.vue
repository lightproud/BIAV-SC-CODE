<script setup lang="ts">
import { ref, computed } from 'vue'

// Input stats
const characterLevel = ref(50)
const atkStat = ref(1200)
const skillMultiplier = ref(30) // as percentage, e.g. 30 = 30% of ATK
const enemyDef = ref(400)

// Crit
const critRate = ref(25) // percentage
const critDamage = ref(150) // percentage (100% = no extra crit dmg)

// Modifiers
const strengthStacks = ref(0)
const shieldBonus = ref(0) // for shield-scaling chars like Alva
const realmBonus = ref(0) // percentage
const covenantSetBonus = ref(0) // percentage
const vulnerabilityDebuff = ref(0) // percentage on enemy

// Preset characters
const presets = [
  { name: 'Custom', atk: 0, mult: 0 },
  { name: 'Alva (Mind\'s Edge)', atk: 1350, mult: 30 },
  { name: 'Doll (Final Form)', atk: 1500, mult: 45 },
  { name: 'Eleanor (Deep Roar)', atk: 1400, mult: 40 },
  { name: 'Celeste (Starlight)', atk: 1100, mult: 25 },
  { name: 'Shiro (Chain Break)', atk: 1450, mult: 50 },
]

const selectedPreset = ref('Custom')

function applyPreset(name: string) {
  const preset = presets.find(p => p.name === name)
  if (preset && preset.atk > 0) {
    atkStat.value = preset.atk
    skillMultiplier.value = preset.mult
  }
  selectedPreset.value = name
}

// Damage Formula:
// Base = ATK * (Skill% / 100) + Strength
// DEF Factor = 100 / (100 + Enemy DEF)
// Crit Multiplier = 1 + (CritRate/100) * (CritDmg/100 - 1)
// Total = Base * DEF_Factor * Crit * (1 + Realm%) * (1 + Covenant%) * (1 + Vuln%) + ShieldBonus

const baseDamage = computed(() => {
  return atkStat.value * (skillMultiplier.value / 100) + strengthStacks.value
})

const defFactor = computed(() => {
  return 100 / (100 + Math.max(0, enemyDef.value))
})

const critMultiplier = computed(() => {
  const rate = Math.min(100, Math.max(0, critRate.value)) / 100
  const dmg = critDamage.value / 100
  return 1 + rate * (dmg - 1)
})

const totalModifier = computed(() => {
  return (1 + realmBonus.value / 100) *
         (1 + covenantSetBonus.value / 100) *
         (1 + vulnerabilityDebuff.value / 100)
})

const finalDamage = computed(() => {
  return Math.round(
    (baseDamage.value * defFactor.value * critMultiplier.value * totalModifier.value)
    + shieldBonus.value
  )
})

const critHitDamage = computed(() => {
  const raw = baseDamage.value * defFactor.value * (critDamage.value / 100) * totalModifier.value + shieldBonus.value
  return Math.round(raw)
})

const nonCritDamage = computed(() => {
  const raw = baseDamage.value * defFactor.value * totalModifier.value + shieldBonus.value
  return Math.round(raw)
})

// Assuming 3 hits per turn (average card play)
const damagePerTurn = computed(() => finalDamage.value * 3)

function formatNum(n: number): string {
  return n.toLocaleString()
}
</script>

<template>
  <div class="dc-wrapper">
    <h2 class="dc-title">Damage Calculator</h2>
    <p class="dc-desc">Estimate damage output based on character stats, skills, and modifiers. Uses the standard Morimens damage formula.</p>

    <div class="dc-layout">
      <!-- Input Panel -->
      <div class="dc-panel">
        <h3 class="dc-section-title">Character Stats</h3>

        <label class="dc-field">
          <span>Preset</span>
          <select
            :value="selectedPreset"
            @change="applyPreset(($event.target as HTMLSelectElement).value)"
            class="dc-select"
          >
            <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
          </select>
        </label>

        <label class="dc-field">
          <span>Character Level</span>
          <input type="number" v-model.number="characterLevel" min="1" max="70" class="dc-input" />
        </label>

        <label class="dc-field">
          <span>ATK Stat</span>
          <input type="number" v-model.number="atkStat" min="0" max="9999" class="dc-input" />
        </label>

        <label class="dc-field">
          <span>Skill Multiplier (%)</span>
          <input type="number" v-model.number="skillMultiplier" min="0" max="999" class="dc-input" />
          <span class="dc-hint">e.g., 30 = ATK x 30%</span>
        </label>

        <label class="dc-field">
          <span>Enemy DEF</span>
          <input type="number" v-model.number="enemyDef" min="0" max="9999" class="dc-input" />
        </label>

        <h3 class="dc-section-title">Critical Hit</h3>

        <label class="dc-field">
          <span>Crit Rate (%)</span>
          <input type="range" v-model.number="critRate" min="0" max="100" class="dc-range" />
          <span class="dc-range-value">{{ critRate }}%</span>
        </label>

        <label class="dc-field">
          <span>Crit Damage (%)</span>
          <input type="number" v-model.number="critDamage" min="100" max="500" class="dc-input" />
          <span class="dc-hint">Base: 150%</span>
        </label>

        <h3 class="dc-section-title">Modifiers</h3>

        <label class="dc-field">
          <span>Strength Stacks</span>
          <input type="number" v-model.number="strengthStacks" min="0" max="999" class="dc-input" />
          <span class="dc-hint">+1 flat damage per stack per hit</span>
        </label>

        <label class="dc-field">
          <span>Shield Bonus (flat)</span>
          <input type="number" v-model.number="shieldBonus" min="0" max="9999" class="dc-input" />
          <span class="dc-hint">For shield-scaling chars (e.g., Alva)</span>
        </label>

        <label class="dc-field">
          <span>Realm Bonus (%)</span>
          <input type="number" v-model.number="realmBonus" min="0" max="200" class="dc-input" />
        </label>

        <label class="dc-field">
          <span>Covenant Set Bonus (%)</span>
          <input type="number" v-model.number="covenantSetBonus" min="0" max="200" class="dc-input" />
        </label>

        <label class="dc-field">
          <span>Enemy Vulnerability (%)</span>
          <input type="number" v-model.number="vulnerabilityDebuff" min="0" max="200" class="dc-input" />
          <span class="dc-hint">Debuffs that increase damage taken</span>
        </label>
      </div>

      <!-- Output Panel -->
      <div class="dc-output">
        <h3 class="dc-section-title">Results</h3>

        <div class="dc-result-grid">
          <div class="dc-result-card dc-result-main">
            <div class="dc-result-label">Average Damage / Hit</div>
            <div class="dc-result-value">{{ formatNum(finalDamage) }}</div>
          </div>

          <div class="dc-result-card">
            <div class="dc-result-label">Non-Crit Hit</div>
            <div class="dc-result-value dc-val-secondary">{{ formatNum(nonCritDamage) }}</div>
          </div>

          <div class="dc-result-card">
            <div class="dc-result-label">Crit Hit</div>
            <div class="dc-result-value dc-val-crit">{{ formatNum(critHitDamage) }}</div>
          </div>

          <div class="dc-result-card dc-result-wide">
            <div class="dc-result-label">Est. Damage / Turn (3 hits)</div>
            <div class="dc-result-value">{{ formatNum(damagePerTurn) }}</div>
          </div>
        </div>

        <div class="dc-breakdown">
          <h4>Formula Breakdown</h4>
          <div class="dc-formula">
            <div class="dc-formula-row">
              <span>Base Damage</span>
              <span>{{ formatNum(Math.round(baseDamage)) }}</span>
            </div>
            <div class="dc-formula-row">
              <span>= ATK ({{ atkStat }}) x Mult ({{ skillMultiplier }}%) + Str ({{ strengthStacks }})</span>
            </div>
            <div class="dc-formula-row">
              <span>DEF Factor</span>
              <span>{{ (defFactor * 100).toFixed(1) }}%</span>
            </div>
            <div class="dc-formula-row">
              <span>= 100 / (100 + DEF {{ enemyDef }})</span>
            </div>
            <div class="dc-formula-row">
              <span>Avg Crit Multiplier</span>
              <span>x{{ critMultiplier.toFixed(3) }}</span>
            </div>
            <div class="dc-formula-row">
              <span>Total Bonus Modifier</span>
              <span>x{{ totalModifier.toFixed(3) }}</span>
            </div>
            <div class="dc-formula-row" v-if="shieldBonus > 0">
              <span>Shield Bonus (flat)</span>
              <span>+{{ shieldBonus }}</span>
            </div>
          </div>
        </div>

        <div class="dc-note">
          <p>Damage formula: (ATK x Skill% + Strength) x DEF_Factor x CritAvg x Modifiers + ShieldBonus</p>
          <p>Values are estimates. Actual in-game results may vary due to hidden modifiers and rounding.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc-wrapper {
  margin: 16px 0;
}

.dc-title {
  font-size: 1.5em;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
  border: none;
}

.dc-desc {
  color: var(--vp-c-text-2);
  font-size: 14px;
  margin-bottom: 24px;
}

.dc-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: start;
}

.dc-panel {
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.dc-section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin: 16px 0 12px 0;
  padding-top: 12px;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: none;
}

.dc-section-title:first-child,
.dc-panel .dc-section-title:first-child,
.dc-output .dc-section-title:first-child {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.dc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.dc-input, .dc-select {
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.dc-input:focus, .dc-select:focus {
  border-color: var(--vp-c-brand-1);
}

.dc-range {
  width: 100%;
  accent-color: var(--vp-c-brand-1);
}

.dc-range-value {
  font-weight: 600;
  color: var(--vp-c-brand-1);
  font-size: 14px;
}

.dc-hint {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.dc-output {
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  position: sticky;
  top: 80px;
}

.dc-result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.dc-result-card {
  padding: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  text-align: center;
}

.dc-result-main {
  grid-column: 1 / -1;
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.dc-result-wide {
  grid-column: 1 / -1;
}

.dc-result-label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.dc-result-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}

.dc-result-main .dc-result-value {
  color: var(--vp-c-brand-1);
  font-size: 32px;
}

.dc-val-secondary {
  color: var(--vp-c-text-2) !important;
  font-size: 22px !important;
}

.dc-val-crit {
  color: #f59e0b !important;
  font-size: 22px !important;
}

.dc-breakdown {
  margin-bottom: 16px;
}

.dc-breakdown h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin: 0 0 8px 0;
}

.dc-formula {
  padding: 12px;
  background: var(--vp-c-bg);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  font-size: 13px;
  font-family: var(--vp-font-family-mono);
}

.dc-formula-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  color: var(--vp-c-text-2);
}

.dc-formula-row span:last-child {
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.dc-note {
  font-size: 12px;
  color: var(--vp-c-text-3);
  line-height: 1.6;
}

.dc-note p {
  margin: 4px 0;
}

@media (max-width: 768px) {
  .dc-layout {
    grid-template-columns: 1fr;
  }

  .dc-output {
    position: static;
  }

  .dc-result-value {
    font-size: 22px;
  }

  .dc-result-main .dc-result-value {
    font-size: 26px;
  }
}
</style>
