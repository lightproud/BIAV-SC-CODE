<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { withBase, useData } from 'vitepress'

interface Version {
  version: string
  title: string
  period: string
  highlights: string[]
  _auto_detected?: boolean
}

interface VersionsData {
  description: string
  versions: Version[]
  major_system_changes: Array<{
    version: string
    change: string
    detail: string
  }>
}

const { lang } = useData()

const data = ref<VersionsData | null>(null)
const loading = ref(true)
const error = ref('')
const expandedVersions = ref<Set<string>>(new Set())

const isZh = computed(() => lang.value === 'zh-CN')

const i18n = computed(() => isZh.value ? {
  loading: '加载中...',
  error: '加载失败',
  current: '当前版本',
  upcoming: '即将推出',
  autoDetected: '自动检测',
  showMore: '展开详情',
  showLess: '收起',
  systemChanges: '重大系统变更',
  noData: '暂无版本数据',
} : {
  loading: 'Loading...',
  error: 'Failed to load',
  current: 'Current',
  upcoming: 'Upcoming',
  autoDetected: 'Auto-detected',
  showMore: 'Show details',
  showLess: 'Collapse',
  systemChanges: 'Major System Changes',
  noData: 'No version data available',
})

onMounted(async () => {
  try {
    const res = await fetch(withBase('/data/db/versions.json'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

const sortedVersions = computed(() => {
  if (!data.value) return []
  return [...data.value.versions].reverse()
})

const currentVersionIndex = computed(() => {
  // The second-to-last in the original order (last is upcoming preview)
  // After reversing, it's index 1 if last entry is a preview
  const versions = sortedVersions.value
  if (versions.length === 0) return -1
  // Check if the first (latest) version looks like a preview
  if (versions[0]?.title?.includes('预告') || versions[0]?.title?.includes('Upcoming')) {
    return 1
  }
  return 0
})

const systemChangesForVersion = computed(() => {
  if (!data.value) return {}
  const map: Record<string, Array<{ change: string; detail: string }>> = {}
  for (const sc of data.value.major_system_changes || []) {
    if (!map[sc.version]) map[sc.version] = []
    map[sc.version].push({ change: sc.change, detail: sc.detail })
  }
  return map
})

function toggleExpand(version: string) {
  if (expandedVersions.value.has(version)) {
    expandedVersions.value.delete(version)
  } else {
    expandedVersions.value.add(version)
  }
}

function isExpanded(version: string): boolean {
  return expandedVersions.value.has(version)
}

function isMajorVersion(version: string): boolean {
  return version.endsWith('.0') || !version.includes('.') || parseFloat(version) === Math.floor(parseFloat(version))
}
</script>

<template>
  <div class="update-timeline">
    <div v-if="loading" class="ut-loading">{{ i18n.loading }}</div>
    <div v-else-if="error" class="ut-error">{{ i18n.error }}: {{ error }}</div>
    <div v-else-if="!data || sortedVersions.length === 0" class="ut-empty">{{ i18n.noData }}</div>

    <div v-else class="ut-track">
      <div
        v-for="(v, index) in sortedVersions"
        :key="v.version"
        class="ut-entry"
        :class="{
          'ut-entry--current': index === currentVersionIndex,
          'ut-entry--upcoming': index < currentVersionIndex,
          'ut-entry--major': isMajorVersion(v.version),
          'ut-entry--auto': v._auto_detected,
        }"
      >
        <div class="ut-line">
          <div class="ut-dot" />
        </div>

        <div class="ut-content">
          <div class="ut-header">
            <span class="ut-version">v{{ v.version }}</span>
            <span class="ut-title">{{ v.title }}</span>
            <span v-if="index === currentVersionIndex" class="ut-badge ut-badge--current">
              {{ i18n.current }}
            </span>
            <span v-if="index === 0 && index < currentVersionIndex" class="ut-badge ut-badge--upcoming">
              {{ i18n.upcoming }}
            </span>
            <span v-if="v._auto_detected" class="ut-badge ut-badge--auto">
              {{ i18n.autoDetected }}
            </span>
          </div>

          <div class="ut-period">{{ v.period }}</div>

          <ul class="ut-highlights" v-if="v.highlights.length <= 3 || isExpanded(v.version)">
            <li v-for="(h, hi) in v.highlights" :key="hi">{{ h }}</li>
          </ul>
          <ul class="ut-highlights" v-else>
            <li v-for="(h, hi) in v.highlights.slice(0, 3)" :key="hi">{{ h }}</li>
          </ul>

          <button
            v-if="v.highlights.length > 3"
            class="ut-toggle"
            @click="toggleExpand(v.version)"
          >
            {{ isExpanded(v.version) ? i18n.showLess : `${i18n.showMore} (+${v.highlights.length - 3})` }}
          </button>

          <!-- System changes for this version -->
          <div
            v-if="systemChangesForVersion[v.version] && isExpanded(v.version)"
            class="ut-system-changes"
          >
            <h4>{{ i18n.systemChanges }}</h4>
            <div
              v-for="(sc, sci) in systemChangesForVersion[v.version]"
              :key="sci"
              class="ut-sc-item"
            >
              <strong>{{ sc.change }}</strong>
              <p>{{ sc.detail }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.update-timeline {
  margin: 24px 0;
}

.ut-loading, .ut-error, .ut-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--vp-c-text-2);
}

.ut-error { color: var(--vp-c-danger-1); }

.ut-track {
  position: relative;
  padding-left: 0;
}

.ut-entry {
  display: flex;
  gap: 16px;
  padding-bottom: 32px;
  position: relative;
}

.ut-entry:last-child {
  padding-bottom: 0;
}

.ut-line {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 24px;
  position: relative;
}

.ut-line::after {
  content: '';
  position: absolute;
  top: 24px;
  bottom: -32px;
  width: 2px;
  background: var(--vp-c-divider);
}

.ut-entry:last-child .ut-line::after {
  display: none;
}

.ut-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vp-c-divider);
  border: 2px solid var(--vp-c-bg);
  box-shadow: 0 0 0 2px var(--vp-c-divider);
  z-index: 1;
  flex-shrink: 0;
  margin-top: 5px;
}

.ut-entry--current .ut-dot {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
  width: 18px;
  height: 18px;
  margin-top: 3px;
}

.ut-entry--upcoming .ut-dot {
  background: transparent;
  border: 2px dashed var(--vp-c-text-3);
  box-shadow: none;
}

.ut-entry--major .ut-dot {
  width: 16px;
  height: 16px;
  margin-top: 4px;
}

.ut-content {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.2s;
}

.ut-entry--current .ut-content {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.ut-entry--upcoming .ut-content {
  opacity: 0.7;
  border-style: dashed;
}

.ut-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.ut-version {
  font-size: 16px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
}

.ut-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.ut-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ut-badge--current {
  background: var(--vp-c-brand-1);
  color: #fff;
}

.ut-badge--upcoming {
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-warning-1);
  border: 1px solid var(--vp-c-warning-1);
}

.ut-badge--auto {
  background: var(--vp-c-tip-soft);
  color: var(--vp-c-tip-1);
  border: 1px solid var(--vp-c-tip-1);
}

.ut-period {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-bottom: 8px;
}

.ut-highlights {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.ut-highlights li {
  margin-bottom: 2px;
}

.ut-toggle {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 10px;
  font-size: 12px;
  color: var(--vp-c-brand-1);
  background: transparent;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.ut-toggle:hover {
  background: var(--vp-c-brand-soft);
}

.ut-system-changes {
  margin-top: 12px;
  padding: 12px;
  background: var(--vp-c-bg);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.ut-system-changes h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.ut-sc-item {
  margin-bottom: 8px;
  font-size: 13px;
}

.ut-sc-item strong {
  color: var(--vp-c-text-1);
}

.ut-sc-item p {
  margin: 2px 0 0 0;
  color: var(--vp-c-text-2);
}

@media (max-width: 640px) {
  .ut-entry {
    gap: 10px;
  }

  .ut-content {
    padding: 10px 12px;
  }

  .ut-version { font-size: 14px; }
  .ut-title { font-size: 13px; }
  .ut-highlights { font-size: 13px; }
}
</style>
