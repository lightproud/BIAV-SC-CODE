<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { withBase, useData } from 'vitepress'

const props = defineProps<{ characterId: string }>()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Skill {
  name: string
  name_en?: string
  cost?: number
  effect: string
  note?: string
  upgrades?: { name: string; effect: string }[]
}

interface Character {
  id: string
  name: string
  name_en: string
  rarity: string
  realm: string
  role: string
  is_limited: boolean
  obtain?: string
  description?: string
  tags?: string[]
  aliases?: string[]
  skills?: {
    command_cards?: Skill[]
    rouse?: { name: string; effect: string }
    exalt?: { name: string; name_en?: string; effect: string; scaling?: string; note?: string }
    overexalt?: { name: string; name_en?: string; effect: string }
    enlighten?: { level: number; name: string; name_en?: string; effect: string }[]
    talent?: { name: string; name_en?: string; effect: string }
    command_cards_note?: string
  }
}

interface Wheel {
  name: string
  name_en?: string
  character?: string
  effect?: string
  effect_en?: string
  recommended?: string[]
}

interface VoiceLine {
  trigger: string
  trigger_zh: string
  text_zh: string
  text_en: string
  text_ja: string
  text_source: string
}

interface CharacterVoice {
  id: string
  name: string
  name_en: string
  lines: VoiceLine[]
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------
const { lang } = useData()

const LABELS: Record<string, Record<string, string>> = {
  zh: {
    overview: '概览', skills: '技能', equipment: '装备', voiceLines: '语音', compare: '对比',
    rarity: '稀有度', realm: '界域', role: '职能', limited: '限定', obtain: '获取',
    yes: '是', no: '否', pending: '数据待补充',
    exalt: '狂气爆发', overexalt: '超限爆发', rouse: '觉醒卡',
    enlighten: '启灵', talent: '天赋', cost: '费用',
    signatureWheel: '专属命轮', recommendedWheel: '推荐命轮',
    intro: '角色简介', tags: '标签',
  },
  en: {
    overview: 'Overview', skills: 'Skills', equipment: 'Equipment', voiceLines: 'Voice', compare: 'Compare',
    rarity: 'Rarity', realm: 'Realm', role: 'Role', limited: 'Limited', obtain: 'Availability',
    yes: 'Yes', no: 'No', pending: 'Data pending',
    exalt: 'Exalt', overexalt: 'Over-Exalt', rouse: 'Rouse',
    enlighten: 'Enlighten', talent: 'Talent', cost: 'Cost',
    signatureWheel: 'Signature Wheel', recommendedWheel: 'Recommended Wheel',
    intro: 'Introduction', tags: 'Tags',
  },
  ja: {
    overview: '概要', skills: 'スキル', equipment: '装備', voiceLines: 'ボイス', compare: '比較',
    rarity: 'レアリティ', realm: '界域', role: '役割', limited: '限定', obtain: '入手方法',
    yes: 'はい', no: 'いいえ', pending: 'データ準備中',
    exalt: '狂気爆発', overexalt: '超限爆発', rouse: '覚醒カード',
    enlighten: '啓霊', talent: '天賦', cost: 'コスト',
    signatureWheel: '専用命輪', recommendedWheel: '推奨命輪',
    intro: 'キャラクター紹介', tags: 'タグ',
  },
}

const REALM_NAMES: Record<string, Record<string, string>> = {
  zh: { chaos: '混沌', aequor: '深海', caro: '血肉', ultra: '超维' },
  en: { chaos: 'Chaos', aequor: 'Aequor', caro: 'Caro', ultra: 'Ultra' },
  ja: { chaos: '混沌', aequor: '深海', caro: '血肉', ultra: '超次元' },
}

const ROLE_NAMES: Record<string, Record<string, string>> = {
  zh: { attack: '输出', sub_attack: '副输出', support: '辅助', defense: '防御', healer: '治疗', chorus: '合唱', dps: '输出' },
  en: { attack: 'Attack', sub_attack: 'Sub-Attack', support: 'Support', defense: 'Defense', healer: 'Healer', chorus: 'Chorus', dps: 'DPS' },
  ja: { attack: '攻撃型', sub_attack: '副攻撃型', support: '支援型', defense: '防御型', healer: '回復型', chorus: '合唱型', dps: '攻撃型' },
}

const L = computed(() => LABELS[lang.value] || LABELS.zh)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const activeTab = ref('overview')
const loading = ref(true)

const tabs = computed(() => [
  { id: 'overview', label: L.value.overview },
  { id: 'skills', label: L.value.skills },
  { id: 'equipment', label: L.value.equipment },
  { id: 'voiceLines', label: L.value.voiceLines },
  { id: 'compare', label: L.value.compare },
])

// Module-level caches (shared across component instances for SPA navigation)
let _charCache: Character[] | null = null
let _srCharCache: Character[] | null = null
let _wheelCache: Record<string, Wheel[]> | null = null
let _voiceCache: CharacterVoice[] | null = null

const character = ref<Character | null>(null)
const allCharacters = ref<Character[]>([])
const charWheels = ref<Wheel[]>([])
const voiceLines = ref<VoiceLine[]>([])

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function fetchJSON(path: string) {
  const res = await fetch(withBase(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function buildWheelIndex(equipData: any): Record<string, Wheel[]> {
  const index: Record<string, Wheel[]> = {}
  const wheels = equipData?.wheels_of_destiny || {}
  for (const [, wheelList] of Object.entries(wheels)) {
    if (!Array.isArray(wheelList)) continue
    for (const w of wheelList) {
      if (!w || typeof w !== 'object') continue
      if (w.character) {
        const cnName = w.character.split('(')[0].trim()
        if (!index[cnName]) index[cnName] = []
        index[cnName].push(w)
      }
      for (const rec of w.recommended || []) {
        if (!index[rec]) index[rec] = []
        index[rec].push(w)
      }
    }
  }
  return index
}

async function loadData() {
  loading.value = true
  try {
    // Parallel fetch with caching
    const [charData, equipData, voiceData] = await Promise.all([
      _charCache ? Promise.resolve(null) : fetchJSON('/data/db/characters.json'),
      _wheelCache ? Promise.resolve(null) : fetchJSON('/data/db/equipment.json'),
      _voiceCache ? Promise.resolve(null) : fetchJSON('/data/db/voice_lines.json').catch(() => ({ characters: [] })),
    ])

    if (charData) {
      _charCache = charData.characters || []
      _srCharCache = charData.sr_characters || []
    }
    if (equipData) {
      _wheelCache = buildWheelIndex(equipData)
    }
    if (voiceData) {
      _voiceCache = voiceData.characters || []
    }

    const all = [...(_charCache || []), ...(_srCharCache || [])]
    allCharacters.value = all
    character.value = all.find(c => c.id === props.characterId) || null

    // Wheels for this character
    if (_wheelCache && character.value) {
      const byName = _wheelCache[character.value.name] || []
      const byEn = _wheelCache[character.value.name_en] || []
      // Deduplicate
      const seen = new Set<string>()
      const combined: Wheel[] = []
      for (const w of [...byName, ...byEn]) {
        if (!seen.has(w.name)) {
          seen.add(w.name)
          combined.push(w)
        }
      }
      charWheels.value = combined
    }

    // Voice lines
    const vc = (_voiceCache || []).find(v => v.id === props.characterId)
    voiceLines.value = vc?.lines || []

    // Restore tab from hash
    const hash = window.location.hash.slice(1)
    if (hash && tabs.value.some(t => t.id === hash)) {
      activeTab.value = hash
    }
  } catch (e) {
    console.warn('CharacterSheet: failed to load data', e)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function realmDisplay(key: string): string {
  const l = lang.value || 'zh'
  return REALM_NAMES[l]?.[key] || key
}

function roleDisplay(key: string): string {
  const l = lang.value || 'zh'
  return ROLE_NAMES[l]?.[key] || key
}

function displayName(char: Character): string {
  const l = lang.value || 'zh'
  return l === 'en' ? `${char.name_en} (${char.name})` : `${char.name} (${char.name_en})`
}

function skillName(skill: { name: string; name_en?: string }): string {
  const l = lang.value || 'zh'
  return l === 'en' ? (skill.name_en || skill.name) : skill.name
}

function wheelDisplayName(w: Wheel): string {
  const l = lang.value || 'zh'
  if (l === 'en') return w.name_en || w.name
  if (l === 'ja') return w.name_en ? `${w.name}（${w.name_en}）` : w.name
  return w.name
}

function wheelEffect(w: Wheel): string {
  const l = lang.value || 'zh'
  return (l === 'en' && w.effect_en) ? w.effect_en : (w.effect || '')
}

function isBasicCard(card: Skill): boolean {
  const n = (card.name + (card.name_en || '')).toLowerCase()
  return n.includes('打击') || n.includes('防御') || n.includes('strike') || n.includes('defense') || n.includes('defend')
}

// Skill ordering: exalt → rouse → skill cards → basic cards → talent → enlighten
const orderedSkillCards = computed(() => {
  const cards = character.value?.skills?.command_cards || []
  const skill: Skill[] = []
  const basic: Skill[] = []
  for (const c of cards) {
    if (isBasicCard(c)) basic.push(c)
    else skill.push(c)
  }
  return { skill, basic }
})

// Voice line triggers
const voiceTriggers = [
  { id: 'login', zh: '登录', en: 'Login', ja: 'ログイン' },
  { id: 'idle', zh: '闲置', en: 'Idle', ja: '待機' },
  { id: 'battle_start', zh: '战斗开始', en: 'Battle Start', ja: '戦闘開始' },
  { id: 'skill', zh: '技能', en: 'Skill', ja: 'スキル' },
  { id: 'rouse', zh: '觉醒', en: 'Rouse', ja: '覚醒' },
  { id: 'victory', zh: '胜利', en: 'Victory', ja: '勝利' },
  { id: 'defeat', zh: '阵亡', en: 'Defeat', ja: '撃破' },
  { id: 'affection_1', zh: '好感度1', en: 'Affection 1', ja: '好感度1' },
  { id: 'affection_2', zh: '好感度2', en: 'Affection 2', ja: '好感度2' },
]
const activeVoiceTrigger = ref('login')
const currentVoiceLine = computed(() =>
  voiceLines.value.find(l => l.trigger === activeVoiceTrigger.value)
)

function triggerLabel(t: typeof voiceTriggers[0]): string {
  const l = lang.value || 'zh'
  return l === 'en' ? t.en : l === 'ja' ? t.ja : t.zh
}

function switchTab(id: string) {
  activeTab.value = id
  history.replaceState(null, '', `#${id}`)
}
</script>

<template>
  <div class="cs-root" v-if="!loading && character">
    <!-- ========== HEADER ========== -->
    <div class="cs-header">
      <img
        :src="withBase(`/portraits/${character.id}.png`)"
        :alt="character.name"
        class="cs-portrait"
      />
      <div class="cs-header-info">
        <h1 class="cs-name">{{ displayName(character) }}</h1>
        <div class="cs-badges">
          <span :class="['cs-badge', `realm-${character.realm}`]">{{ realmDisplay(character.realm) }}</span>
          <span :class="['cs-badge', character.rarity === 'SSR' ? 'rarity-ssr' : 'rarity-sr']">{{ character.rarity }}</span>
          <span class="cs-badge cs-role">{{ roleDisplay(character.role) }}</span>
          <span v-if="character.is_limited" class="cs-badge cs-limited">{{ L.limited }}</span>
        </div>
        <div class="cs-meta" v-if="character.obtain">
          <span class="cs-meta-label">{{ L.obtain }}:</span> {{ character.obtain }}
        </div>
        <div class="cs-tags" v-if="character.tags?.length">
          <span v-for="tag in character.tags" :key="tag" class="cs-tag">{{ tag }}</span>
        </div>
      </div>
    </div>

    <!-- ========== TAB BAR ========== -->
    <div class="cs-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['cs-tab', { active: activeTab === tab.id }]"
        @click="switchTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ========== OVERVIEW TAB ========== -->
    <div class="cs-panel" v-show="activeTab === 'overview'">
      <div class="cs-section">
        <h2 class="cs-section-title">{{ L.intro }}</h2>
        <p class="cs-description">{{ character.description || L.pending }}</p>
      </div>

      <div class="cs-quick-stats">
        <table class="cs-stats-table">
          <tbody>
            <tr>
              <td class="cs-stat-label">{{ L.rarity }}</td>
              <td><span :class="character.rarity === 'SSR' ? 'rarity-ssr' : 'rarity-sr'">{{ character.rarity }}</span></td>
            </tr>
            <tr>
              <td class="cs-stat-label">{{ L.realm }}</td>
              <td><span :class="['realm-badge', `realm-${character.realm}`]">{{ realmDisplay(character.realm) }}</span></td>
            </tr>
            <tr>
              <td class="cs-stat-label">{{ L.role }}</td>
              <td>{{ roleDisplay(character.role) }}</td>
            </tr>
            <tr>
              <td class="cs-stat-label">{{ L.limited }}</td>
              <td>{{ character.is_limited ? L.yes : L.no }}</td>
            </tr>
            <tr>
              <td class="cs-stat-label">{{ L.obtain }}</td>
              <td>{{ character.obtain || L.pending }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ========== SKILLS TAB ========== -->
    <div class="cs-panel" v-show="activeTab === 'skills'">
      <template v-if="character.skills">
        <!-- Exalt -->
        <div class="cs-skill-card cs-skill-featured" v-if="character.skills.exalt">
          <div class="cs-skill-header">
            <span class="cs-skill-type">{{ L.exalt }}</span>
          </div>
          <div class="cs-skill-name">{{ skillName(character.skills.exalt) }}</div>
          <div class="cs-skill-effect">{{ character.skills.exalt.effect }}</div>
          <div class="cs-skill-note" v-if="character.skills.exalt.scaling">{{ character.skills.exalt.scaling }}</div>
          <div class="cs-skill-note" v-if="character.skills.exalt.note">{{ character.skills.exalt.note }}</div>
        </div>

        <!-- Over-Exalt -->
        <div class="cs-skill-card cs-skill-featured" v-if="character.skills.overexalt">
          <div class="cs-skill-header">
            <span class="cs-skill-type">{{ L.overexalt }}</span>
          </div>
          <div class="cs-skill-name">{{ skillName(character.skills.overexalt) }}</div>
          <div class="cs-skill-effect">{{ character.skills.overexalt.effect }}</div>
        </div>

        <!-- Rouse -->
        <div class="cs-skill-card cs-skill-rouse" v-if="character.skills.rouse">
          <div class="cs-skill-header">
            <span class="cs-skill-type">{{ L.rouse }}</span>
          </div>
          <div class="cs-skill-name">{{ character.skills.rouse.name }}</div>
          <div class="cs-skill-effect">{{ character.skills.rouse.effect }}</div>
        </div>

        <!-- Command Cards (non-basic) -->
        <div class="cs-cards-grid" v-if="orderedSkillCards.skill.length">
          <div class="cs-skill-card" v-for="card in orderedSkillCards.skill" :key="card.name">
            <div class="cs-skill-header">
              <span class="cs-skill-name">{{ skillName(card) }}</span>
              <span class="cs-cost-badge" v-if="card.cost !== undefined">{{ card.cost }}</span>
            </div>
            <div class="cs-skill-effect">{{ card.effect }}</div>
            <div class="cs-skill-note" v-if="card.note">{{ card.note }}</div>
            <div class="cs-upgrade" v-for="upg in (card.upgrades || [])" :key="upg.name">
              <span class="cs-upgrade-arrow">↳</span>
              <span class="cs-upgrade-name">{{ upg.name }}</span>
              <span class="cs-upgrade-effect">{{ upg.effect }}</span>
            </div>
          </div>
        </div>

        <!-- Command Cards (basic: strike/defense) -->
        <div class="cs-cards-grid cs-basic-cards" v-if="orderedSkillCards.basic.length">
          <div class="cs-skill-card cs-skill-basic" v-for="card in orderedSkillCards.basic" :key="card.name">
            <div class="cs-skill-header">
              <span class="cs-skill-name">{{ skillName(card) }}</span>
              <span class="cs-cost-badge" v-if="card.cost !== undefined">{{ card.cost }}</span>
            </div>
            <div class="cs-skill-effect">{{ card.effect }}</div>
          </div>
        </div>

        <!-- Talent -->
        <div class="cs-skill-card cs-skill-talent" v-if="character.skills.talent">
          <div class="cs-skill-header">
            <span class="cs-skill-type">{{ L.talent }}</span>
          </div>
          <div class="cs-skill-name">{{ skillName(character.skills.talent) }}</div>
          <div class="cs-skill-effect">{{ character.skills.talent.effect }}</div>
        </div>

        <!-- Enlighten -->
        <div class="cs-enlighten" v-if="character.skills.enlighten?.length">
          <h3 class="cs-subsection-title">{{ L.enlighten }}</h3>
          <div class="cs-enlighten-list">
            <div class="cs-enlighten-item" v-for="e in character.skills.enlighten" :key="e.level">
              <div class="cs-enlighten-level">{{ e.level }}</div>
              <div class="cs-enlighten-content">
                <div class="cs-enlighten-name">{{ skillName(e) }}</div>
                <div class="cs-enlighten-effect">{{ e.effect }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Command cards note -->
        <div class="cs-note-box" v-if="character.skills.command_cards_note">
          {{ character.skills.command_cards_note }}
        </div>
      </template>
      <p v-else class="cs-pending">{{ L.pending }}</p>
    </div>

    <!-- ========== EQUIPMENT TAB ========== -->
    <div class="cs-panel" v-show="activeTab === 'equipment'">
      <template v-if="charWheels.length">
        <div class="cs-wheels-grid">
          <div
            v-for="w in charWheels"
            :key="w.name"
            :class="['cs-wheel-card', { 'cs-wheel-signature': w.character }]"
          >
            <div class="cs-wheel-tag">
              {{ w.character ? L.signatureWheel : L.recommendedWheel }}
            </div>
            <div class="cs-wheel-name">{{ wheelDisplayName(w) }}</div>
            <div class="cs-wheel-effect">{{ wheelEffect(w) }}</div>
          </div>
        </div>
      </template>
      <p v-else class="cs-pending">{{ L.pending }}</p>
    </div>

    <!-- ========== VOICE LINES TAB ========== -->
    <div class="cs-panel" v-show="activeTab === 'voiceLines'">
      <template v-if="voiceLines.length">
        <div class="cs-voice-triggers">
          <button
            v-for="t in voiceTriggers"
            :key="t.id"
            :class="['cs-tab cs-voice-tab', { active: activeVoiceTrigger === t.id }]"
            @click="activeVoiceTrigger = t.id"
          >
            {{ triggerLabel(t) }}
          </button>
        </div>
        <div class="cs-voice-content" v-if="currentVoiceLine">
          <table class="cs-stats-table">
            <tbody>
              <tr>
                <td class="cs-stat-label">中文</td>
                <td>{{ currentVoiceLine.text_zh }}</td>
              </tr>
              <tr>
                <td class="cs-stat-label">English</td>
                <td>{{ currentVoiceLine.text_en }}</td>
              </tr>
              <tr>
                <td class="cs-stat-label">日本語</td>
                <td>{{ currentVoiceLine.text_ja }}</td>
              </tr>
            </tbody>
          </table>
          <div class="cs-voice-placeholder" v-if="currentVoiceLine.text_source === 'placeholder'">
            ⚠ {{ L.pending }}
          </div>
        </div>
        <p v-else class="cs-pending">{{ L.pending }}</p>
      </template>
      <p v-else class="cs-pending">{{ L.pending }}</p>
    </div>

    <!-- ========== COMPARE TAB ========== -->
    <div class="cs-panel" v-show="activeTab === 'compare'">
      <CharacterCompare />
    </div>
  </div>

  <!-- Loading state -->
  <div class="cs-loading" v-else-if="loading">
    <div class="cs-skeleton-header">
      <div class="cs-skeleton cs-skeleton-portrait"></div>
      <div class="cs-skeleton-info">
        <div class="cs-skeleton cs-skeleton-title"></div>
        <div class="cs-skeleton cs-skeleton-badges"></div>
      </div>
    </div>
    <div class="cs-skeleton cs-skeleton-tabs"></div>
    <div class="cs-skeleton cs-skeleton-content"></div>
  </div>
</template>

<style scoped>
/* ========== ROOT ========== */
.cs-root {
  margin: -24px -24px 0;
  padding: 0;
}

/* ========== HEADER ========== */
.cs-header {
  display: flex;
  gap: 24px;
  padding: 24px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.cs-portrait {
  width: 160px;
  height: 160px;
  object-fit: cover;
  border-radius: 12px;
  border: 2px solid var(--vp-c-brand-2);
  flex-shrink: 0;
}

.cs-header-info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-width: 0;
}

.cs-name {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0;
  color: var(--vp-c-text-1);
  border: none;
  padding: 0;
  line-height: 1.3;
}

.cs-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cs-badge {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
}

.cs-role {
  background: rgba(197, 163, 86, 0.12);
  color: var(--vp-c-brand-1);
}

.cs-limited {
  background: rgba(231, 76, 60, 0.15);
  color: #ec7063;
}

.cs-meta {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

.cs-meta-label {
  color: var(--vp-c-text-3);
}

.cs-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cs-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

/* ========== TAB BAR ========== */
.cs-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--vp-c-divider);
  padding: 0 24px;
  background: var(--vp-c-bg);
  position: sticky;
  top: var(--vp-nav-height, 64px);
  z-index: 10;
}

.cs-tab {
  padding: 12px 20px;
  border: none;
  background: none;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 500;
  position: relative;
  transition: color 0.2s;
}

.cs-tab:hover {
  color: var(--vp-c-text-1);
}

.cs-tab.active {
  color: var(--vp-c-brand-1);
}

.cs-tab.active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--vp-c-brand-1);
}

/* ========== PANEL ========== */
.cs-panel {
  padding: 24px;
  min-height: 300px;
}

.cs-section-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin: 0 0 12px;
  border: none;
  padding: 0;
}

.cs-subsection-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin: 24px 0 12px;
  border: none;
  padding: 0;
}

.cs-description {
  color: var(--vp-c-text-1);
  line-height: 1.7;
  margin: 0;
}

.cs-pending {
  color: var(--vp-c-text-3);
  font-style: italic;
}

/* ========== STATS TABLE ========== */
.cs-quick-stats {
  margin-top: 20px;
}

.cs-stats-table {
  width: 100%;
  border-collapse: collapse;
}

.cs-stats-table td {
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.cs-stat-label {
  width: 120px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
}

/* ========== SKILL CARDS ========== */
.cs-skill-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: border-color 0.2s;
}

.cs-skill-card:hover {
  border-color: var(--vp-c-brand-3);
}

.cs-skill-featured {
  border-left: 3px solid var(--vp-c-brand-1);
  background: linear-gradient(135deg, rgba(197, 163, 86, 0.06), var(--vp-c-bg-soft));
}

.cs-skill-rouse {
  border-left: 3px solid #5dade2;
  background: linear-gradient(135deg, rgba(93, 173, 226, 0.06), var(--vp-c-bg-soft));
}

.cs-skill-talent {
  border-left: 3px solid #bb8fce;
  background: linear-gradient(135deg, rgba(187, 143, 206, 0.06), var(--vp-c-bg-soft));
}

.cs-skill-basic {
  opacity: 0.75;
}

.cs-skill-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.cs-skill-type {
  font-size: 0.8em;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(197, 163, 86, 0.15);
  color: var(--vp-c-brand-1);
}

.cs-skill-name {
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-size: 1rem;
}

.cs-skill-effect {
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin-top: 4px;
  font-size: 0.93rem;
}

.cs-skill-note {
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  margin-top: 6px;
  font-style: italic;
}

.cs-cost-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(197, 163, 86, 0.18);
  color: var(--vp-c-brand-1);
  font-size: 0.85em;
  font-weight: 700;
  flex-shrink: 0;
}

.cs-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.cs-upgrade {
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--vp-c-bg);
  border-radius: 4px;
  font-size: 0.88rem;
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.cs-upgrade-arrow {
  color: var(--vp-c-brand-2);
  flex-shrink: 0;
}

.cs-upgrade-name {
  font-weight: 600;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}

.cs-upgrade-effect {
  color: var(--vp-c-text-3);
}

/* ========== ENLIGHTEN ========== */
.cs-enlighten-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cs-enlighten-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.cs-enlighten-level {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  color: #0a0b10;
  font-weight: 700;
  font-size: 1rem;
  flex-shrink: 0;
}

.cs-enlighten-content {
  flex: 1;
  min-width: 0;
}

.cs-enlighten-name {
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 4px;
}

.cs-enlighten-effect {
  color: var(--vp-c-text-2);
  font-size: 0.93rem;
  line-height: 1.5;
}

.cs-note-box {
  margin-top: 16px;
  padding: 12px 16px;
  background: rgba(197, 163, 86, 0.08);
  border: 1px solid rgba(197, 163, 86, 0.2);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

/* ========== WHEELS ========== */
.cs-wheels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.cs-wheel-card {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 16px;
  transition: border-color 0.2s;
}

.cs-wheel-card:hover {
  border-color: var(--vp-c-brand-3);
}

.cs-wheel-signature {
  border-left: 3px solid var(--vp-c-brand-1);
}

.cs-wheel-tag {
  font-size: 0.78em;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cs-wheel-name {
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 8px;
  font-size: 1rem;
}

.cs-wheel-effect {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.5;
}

/* ========== VOICE LINES ========== */
.cs-voice-triggers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.cs-voice-tab {
  padding: 6px 14px !important;
  font-size: 0.85rem !important;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}

.cs-voice-tab.active {
  border-color: var(--vp-c-brand-1);
}

.cs-voice-placeholder {
  margin-top: 8px;
  padding: 6px 12px;
  background: var(--vp-c-warning-soft);
  border-radius: 4px;
  font-size: 0.85rem;
  color: var(--vp-c-warning-1);
  display: inline-block;
}

/* ========== SKELETON LOADING ========== */
.cs-loading {
  padding: 24px;
}

.cs-skeleton {
  background: linear-gradient(90deg, var(--vp-c-bg-soft) 25%, var(--vp-c-bg-elv) 50%, var(--vp-c-bg-soft) 75%);
  background-size: 200% 100%;
  animation: cs-shimmer 1.5s infinite;
  border-radius: 8px;
}

@keyframes cs-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.cs-skeleton-header {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.cs-skeleton-portrait {
  width: 160px;
  height: 160px;
  border-radius: 12px;
}

.cs-skeleton-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
}

.cs-skeleton-title {
  height: 32px;
  width: 60%;
}

.cs-skeleton-badges {
  height: 28px;
  width: 40%;
}

.cs-skeleton-tabs {
  height: 48px;
  width: 100%;
  margin-bottom: 24px;
}

.cs-skeleton-content {
  height: 200px;
  width: 100%;
}

/* ========== RESPONSIVE ========== */
@media (max-width: 768px) {
  .cs-root {
    margin: -16px -16px 0;
  }

  .cs-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 16px;
  }

  .cs-portrait {
    width: 120px;
    height: 120px;
  }

  .cs-badges {
    justify-content: center;
  }

  .cs-name {
    font-size: 1.3rem;
  }

  .cs-tabs {
    padding: 0 12px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .cs-tab {
    padding: 10px 14px;
    font-size: 0.88rem;
    white-space: nowrap;
  }

  .cs-panel {
    padding: 16px;
  }

  .cs-cards-grid,
  .cs-wheels-grid {
    grid-template-columns: 1fr;
  }

  .cs-stat-label {
    width: 90px;
  }
}
</style>
