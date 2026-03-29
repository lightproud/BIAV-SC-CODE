<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{ characterId?: string }>()

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

const voiceData = ref<CharacterVoice[]>([])
const selectedChar = ref('')
const activeTab = ref('login')

const triggers = [
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

onMounted(async () => {
  try {
    const res = await fetch(import.meta.env.BASE_URL + 'data/db/voice_lines.json')
    const data = await res.json()
    voiceData.value = data.characters || []
    if (props.characterId) {
      selectedChar.value = props.characterId
    } else if (voiceData.value.length > 0) {
      selectedChar.value = voiceData.value[0].id
    }
  } catch (e) {
    console.warn('Failed to load voice lines:', e)
  }
})

const currentChar = computed(() =>
  voiceData.value.find(c => c.id === selectedChar.value)
)

const currentLine = computed(() =>
  currentChar.value?.lines.find(l => l.trigger === activeTab.value)
)
</script>

<template>
  <div class="voice-lines" v-if="voiceData.length">
    <div class="char-select" v-if="!characterId">
      <label>角色 Character：</label>
      <select v-model="selectedChar">
        <option v-for="c in voiceData" :key="c.id" :value="c.id">
          {{ c.name }} ({{ c.name_en }})
        </option>
      </select>
    </div>

    <div class="tabs">
      <button
        v-for="t in triggers"
        :key="t.id"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >
        {{ t.zh }}
      </button>
    </div>

    <div class="line-content" v-if="currentLine">
      <table>
        <thead>
          <tr>
            <th>语言</th>
            <th>台词</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="lang-label">中文</td>
            <td>{{ currentLine.text_zh }}</td>
          </tr>
          <tr>
            <td class="lang-label">English</td>
            <td>{{ currentLine.text_en }}</td>
          </tr>
          <tr>
            <td class="lang-label">日本語</td>
            <td>{{ currentLine.text_ja }}</td>
          </tr>
          <tr class="audio-row">
            <td class="lang-label">🔊 语音</td>
            <td class="audio-placeholder">语音文件待接入</td>
          </tr>
        </tbody>
      </table>
      <div class="source-tag" v-if="currentLine.text_source === 'placeholder'">
        ⚠ 台词待补充 (placeholder)
      </div>
    </div>
  </div>
</template>

<style scoped>
.voice-lines {
  margin: 1rem 0;
}

.char-select {
  margin-bottom: 1rem;
}

.char-select select {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.95rem;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.tabs button {
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.tabs button.active {
  background: var(--vp-c-brand-1);
  color: #fff;
  border-color: var(--vp-c-brand-1);
}

.line-content table {
  width: 100%;
  border-collapse: collapse;
}

.line-content th,
.line-content td {
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--vp-c-divider);
  text-align: left;
}

.line-content th {
  background: var(--vp-c-bg-soft);
  font-weight: 600;
}

.lang-label {
  width: 80px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}

.audio-row {
  opacity: 0.5;
}

.audio-placeholder {
  font-style: italic;
  color: var(--vp-c-text-3);
}

.source-tag {
  margin-top: 0.5rem;
  padding: 0.3rem 0.6rem;
  background: var(--vp-c-warning-soft);
  border-radius: 4px;
  font-size: 0.85rem;
  color: var(--vp-c-warning-1);
  display: inline-block;
}
</style>
