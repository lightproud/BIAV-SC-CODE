<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const currentStamina = ref(120)
const maxStamina = ref(240)

// Regen: 1 stamina per 6 minutes
const REGEN_INTERVAL_MINUTES = 6

const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const staminaToFull = computed(() => {
  return Math.max(0, maxStamina.value - currentStamina.value)
})

const minutesToFull = computed(() => {
  return staminaToFull.value * REGEN_INTERVAL_MINUTES
})

const fullTime = computed(() => {
  const target = new Date(now.value.getTime() + minutesToFull.value * 60 * 1000)
  return target
})

const fullTimeFormatted = computed(() => {
  if (staminaToFull.value <= 0) return 'Full now!'
  const t = fullTime.value
  const hours = t.getHours().toString().padStart(2, '0')
  const mins = t.getMinutes().toString().padStart(2, '0')
  const isToday = t.toDateString() === now.value.toDateString()
  const dayLabel = isToday ? 'Today' : 'Tomorrow'
  return `${dayLabel} ${hours}:${mins}`
})

const timeRemainingFormatted = computed(() => {
  if (staminaToFull.value <= 0) return '0h 0m'
  const totalMins = minutesToFull.value
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  return `${h}h ${m}m`
})

const staminaPercentage = computed(() => {
  return Math.min(100, Math.round((currentStamina.value / maxStamina.value) * 100))
})

// Common stamina costs for quick subtraction
const quickCosts = [
  { label: 'Story Stage', cost: 20, icon: 'S' },
  { label: 'Resource Dungeon', cost: 30, icon: 'R' },
  { label: 'Challenge', cost: 40, icon: 'C' },
  { label: 'Boss', cost: 60, icon: 'B' },
]

function spendStamina(cost: number) {
  currentStamina.value = Math.max(0, currentStamina.value - cost)
}

function refillStamina(amount: number) {
  currentStamina.value = Math.min(maxStamina.value, currentStamina.value + amount)
}

// Calculate how many runs you can do with current stamina
function runsAvailable(cost: number): number {
  return Math.floor(currentStamina.value / cost)
}

// Overflow warning
const isOverCap = computed(() => currentStamina.value >= maxStamina.value)

// Silver exchange: 50 Silver = 120 Menophine
const silverExchangeAmount = 120
</script>

<template>
  <div class="st-wrapper">
    <h2 class="st-title">Stamina Tracker</h2>
    <p class="st-desc">Track your Menophine (stamina) and see when it will be full. Plan your stage runs efficiently.</p>

    <!-- Main Stamina Display -->
    <div class="st-main">
      <div class="st-gauge-section">
        <div class="st-gauge-label">Current Menophine</div>
        <div class="st-gauge-display">
          <input
            type="number"
            v-model.number="currentStamina"
            min="0"
            :max="maxStamina * 2"
            class="st-gauge-input"
          />
          <span class="st-gauge-sep">/</span>
          <input
            type="number"
            v-model.number="maxStamina"
            min="100"
            max="999"
            class="st-gauge-cap"
          />
        </div>
        <div class="st-bar-container">
          <div
            class="st-bar-fill"
            :class="{ 'st-bar-full': isOverCap }"
            :style="{ width: staminaPercentage + '%' }"
          ></div>
        </div>
        <div v-if="isOverCap" class="st-overflow-warn">
          Stamina is at cap! Use it before it stops regenerating.
        </div>
      </div>

      <div class="st-time-section">
        <div class="st-time-card">
          <div class="st-time-label">Time to Full</div>
          <div class="st-time-value">{{ timeRemainingFormatted }}</div>
        </div>
        <div class="st-time-card">
          <div class="st-time-label">Full At</div>
          <div class="st-time-value st-time-highlight">{{ fullTimeFormatted }}</div>
        </div>
        <div class="st-time-card">
          <div class="st-time-label">Regen Rate</div>
          <div class="st-time-value st-time-small">1 per {{ REGEN_INTERVAL_MINUTES }}min</div>
        </div>
      </div>
    </div>

    <!-- Quick Spend Buttons -->
    <div class="st-section">
      <h3>Quick Spend</h3>
      <div class="st-quick-grid">
        <div
          v-for="qc in quickCosts"
          :key="qc.label"
          class="st-quick-card"
          :class="{ 'st-quick-disabled': currentStamina < qc.cost }"
        >
          <div class="st-quick-header">
            <span class="st-quick-icon">{{ qc.icon }}</span>
            <span class="st-quick-name">{{ qc.label }}</span>
          </div>
          <div class="st-quick-cost">-{{ qc.cost }} Menophine</div>
          <div class="st-quick-runs">{{ runsAvailable(qc.cost) }} runs available</div>
          <button
            class="st-quick-btn"
            @click="spendStamina(qc.cost)"
            :disabled="currentStamina < qc.cost"
          >
            Spend
          </button>
        </div>
      </div>
    </div>

    <!-- Refill Section -->
    <div class="st-section">
      <h3>Quick Refill</h3>
      <div class="st-refill-row">
        <button class="st-refill-btn" @click="refillStamina(60)">
          +60 (Small Potion)
        </button>
        <button class="st-refill-btn" @click="refillStamina(120)">
          +120 (50 Silver Exchange)
        </button>
        <button class="st-refill-btn" @click="currentStamina = maxStamina">
          Fill to Cap
        </button>
        <button class="st-refill-btn st-refill-reset" @click="currentStamina = 0">
          Reset to 0
        </button>
      </div>
    </div>

    <!-- Runs Calculator Table -->
    <div class="st-section">
      <h3>Runs Calculator</h3>
      <table class="st-table">
        <thead>
          <tr>
            <th>Stage Type</th>
            <th>Cost</th>
            <th>Available Runs</th>
            <th>Leftover</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="qc in quickCosts" :key="qc.label">
            <td>{{ qc.label }}</td>
            <td>{{ qc.cost }}</td>
            <td class="st-runs-val">{{ runsAvailable(qc.cost) }}</td>
            <td>{{ currentStamina % qc.cost }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Info Box -->
    <div class="st-info">
      <p><strong>Menophine</strong> is the stamina resource in Morimens. It regenerates at 1 point per 6 minutes (10 per hour), with a cap of 240.</p>
      <p>You can exchange 50 Silver for 120 Menophine, or obtain it from potions and gift boxes.</p>
    </div>
  </div>
</template>

<style scoped>
.st-wrapper {
  margin: 16px 0;
}

.st-title {
  font-size: 1.5em;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
  border: none;
}

.st-desc {
  color: var(--vp-c-text-2);
  font-size: 14px;
  margin-bottom: 24px;
}

.st-main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

.st-gauge-section {
  padding: 20px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.st-gauge-label {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
  font-weight: 500;
}

.st-gauge-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 12px;
}

.st-gauge-input {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 28px;
  font-weight: 800;
  outline: none;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.st-gauge-input:focus {
  border-color: var(--vp-c-brand-1);
}

.st-gauge-sep {
  font-size: 20px;
  color: var(--vp-c-text-3);
}

.st-gauge-cap {
  width: 70px;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 16px;
  outline: none;
  text-align: center;
}

.st-gauge-cap:focus {
  border-color: var(--vp-c-brand-1);
}

.st-bar-container {
  width: 100%;
  height: 10px;
  background: var(--vp-c-bg);
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
}

.st-bar-fill {
  height: 100%;
  background: var(--vp-c-brand-1);
  border-radius: 5px;
  transition: width 0.3s ease;
}

.st-bar-full {
  background: #22c55e;
}

.st-overflow-warn {
  margin-top: 8px;
  font-size: 12px;
  color: #f59e0b;
  font-weight: 600;
}

.st-time-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.st-time-card {
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  text-align: center;
}

.st-time-label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.st-time-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.st-time-highlight {
  color: var(--vp-c-brand-1);
}

.st-time-small {
  font-size: 16px;
}

.st-section {
  margin-bottom: 24px;
}

.st-section h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 12px 0;
  border: none;
}

.st-quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.st-quick-card {
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  text-align: center;
  transition: all 0.2s;
}

.st-quick-disabled {
  opacity: 0.5;
}

.st-quick-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}

.st-quick-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 800;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.st-quick-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.st-quick-cost {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-bottom: 4px;
}

.st-quick-runs {
  font-size: 12px;
  color: var(--vp-c-text-3);
  margin-bottom: 10px;
}

.st-quick-btn {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.st-quick-btn:hover:not(:disabled) {
  background: var(--vp-c-brand-1);
  color: #fff;
}

.st-quick-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.st-refill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.st-refill-btn {
  padding: 8px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.st-refill-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.st-refill-reset {
  color: var(--vp-c-text-3);
}

.st-refill-reset:hover {
  border-color: var(--vp-c-danger-1);
  color: var(--vp-c-danger-1);
  background: transparent;
}

.st-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.st-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  border-bottom: 2px solid var(--vp-c-divider);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.st-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.st-runs-val {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.st-info {
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.st-info p {
  margin: 4px 0;
}

@media (max-width: 640px) {
  .st-main {
    grid-template-columns: 1fr;
  }

  .st-quick-grid {
    grid-template-columns: 1fr 1fr;
  }

  .st-gauge-input {
    font-size: 22px;
    width: 80px;
  }

  .st-time-value {
    font-size: 18px;
  }

  .st-refill-row {
    flex-direction: column;
  }
}
</style>
