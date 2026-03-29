<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useData } from 'vitepress'

interface FeedEntry {
  title: string
  link: string
  guid: string
  description: string
  category: string
  pubDate: string
}

const { lang } = useData()
const entries = ref<FeedEntry[]>([])
const loading = ref(true)
const error = ref('')
const lastChecked = ref<Date | null>(null)

const isZh = computed(() => lang.value === 'zh-CN')

const i18n = computed(() => isZh.value ? {
  loading: '加载最近更新...',
  error: '加载失败',
  noEntries: '暂无最近更新',
  lastUpdated: '最后检查',
  gameUpdate: '游戏更新',
  wikiUpdate: 'Wiki更新',
  ago: '前',
  justNow: '刚刚',
  minutes: '分钟',
  hours: '小时',
  days: '天',
  subscribe: '订阅RSS',
  title: '最近更新',
} : {
  loading: 'Loading recent changes...',
  error: 'Failed to load',
  noEntries: 'No recent updates',
  lastUpdated: 'Last checked',
  gameUpdate: 'Game Update',
  wikiUpdate: 'Wiki Update',
  ago: ' ago',
  justNow: 'just now',
  minutes: 'min',
  hours: 'h',
  days: 'd',
  subscribe: 'Subscribe RSS',
  title: 'Recent Updates',
})

onMounted(async () => {
  try {
    // Try to parse RSS feed for entries
    const feedUrl = new URL('/brain-in-a-vat/wiki/feed.xml', window.location.origin).href
    const res = await fetch(feedUrl)

    if (res.ok) {
      const text = await res.text()
      const parser = new DOMParser()
      const xml = parser.parseFromString(text, 'text/xml')
      const items = xml.querySelectorAll('item')

      const parsed: FeedEntry[] = []
      items.forEach((item, index) => {
        if (index >= 15) return
        parsed.push({
          title: item.querySelector('title')?.textContent || '',
          link: item.querySelector('link')?.textContent || '',
          guid: item.querySelector('guid')?.textContent || `entry-${index}`,
          description: item.querySelector('description')?.textContent || '',
          category: item.querySelector('category')?.textContent || '',
          pubDate: item.querySelector('pubDate')?.textContent || '',
        })
      })

      entries.value = parsed
      const buildDate = xml.querySelector('lastBuildDate')?.textContent
      if (buildDate) {
        lastChecked.value = new Date(buildDate)
      }
    } else {
      // Feed not available yet; show placeholder
      entries.value = []
    }
  } catch (e: any) {
    // Feed file may not exist yet, that's OK
    console.warn('Feed not available:', e.message)
    entries.value = []
  } finally {
    loading.value = false
  }
})

function formatTimeAgo(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return i18n.value.justNow
    if (diffMin < 60) return `${diffMin} ${i18n.value.minutes}${i18n.value.ago}`
    if (diffHr < 24) return `${diffHr} ${i18n.value.hours}${i18n.value.ago}`
    return `${diffDay} ${i18n.value.days}${i18n.value.ago}`
  } catch {
    return dateStr
  }
}

function getCategoryClass(category: string): string {
  if (category === 'game-version') return 'cf-cat--game'
  if (category === 'wiki-update') return 'cf-cat--wiki'
  return ''
}

function getCategoryLabel(category: string): string {
  if (category === 'game-version') return i18n.value.gameUpdate
  if (category === 'wiki-update') return i18n.value.wikiUpdate
  return category
}
</script>

<template>
  <div class="changelog-feed">
    <div class="cf-header">
      <h3 class="cf-title">{{ i18n.title }}</h3>
      <div class="cf-meta">
        <span v-if="lastChecked" class="cf-last-updated">
          {{ i18n.lastUpdated }}: {{ formatTimeAgo(lastChecked.toISOString()) }}
        </span>
        <a href="/brain-in-a-vat/wiki/feed.xml" class="cf-rss-link" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="6.18" cy="17.82" r="2.18"/>
            <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/>
          </svg>
          {{ i18n.subscribe }}
        </a>
      </div>
    </div>

    <div v-if="loading" class="cf-loading">{{ i18n.loading }}</div>
    <div v-else-if="entries.length === 0" class="cf-empty">
      <p>{{ i18n.noEntries }}</p>
      <p class="cf-hint" v-if="isZh">RSS 订阅源将在数据更新后自动生成。</p>
      <p class="cf-hint" v-else>RSS feeds will be generated automatically when data is updated.</p>
    </div>

    <div v-else class="cf-list">
      <a
        v-for="entry in entries"
        :key="entry.guid"
        :href="entry.link"
        class="cf-item"
        target="_blank"
        rel="noopener"
      >
        <span class="cf-cat" :class="getCategoryClass(entry.category)">
          {{ getCategoryLabel(entry.category) }}
        </span>
        <span class="cf-item-title">{{ entry.title.replace(/^\[(Game|Wiki)\]\s*/, '') }}</span>
        <span class="cf-item-time">{{ formatTimeAgo(entry.pubDate) }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.changelog-feed {
  margin: 24px 0;
  padding: 16px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
}

.cf-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.cf-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.cf-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.cf-last-updated {
  color: var(--vp-c-text-3);
}

.cf-rss-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  text-decoration: none;
  transition: opacity 0.2s;
}

.cf-rss-link:hover {
  opacity: 0.8;
}

.cf-loading, .cf-empty {
  text-align: center;
  padding: 20px;
  color: var(--vp-c-text-3);
  font-size: 14px;
}

.cf-hint {
  font-size: 12px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
}

.cf-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--vp-c-text-1);
  transition: background 0.15s;
  font-size: 14px;
}

.cf-item:hover {
  background: var(--vp-c-bg);
}

.cf-cat {
  display: inline-block;
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.cf-cat--game {
  background: #7c3aed20;
  color: #7c3aed;
}

.cf-cat--wiki {
  background: #06b6d420;
  color: #06b6d4;
}

.cf-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cf-item-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

@media (max-width: 640px) {
  .cf-item {
    flex-wrap: wrap;
    gap: 4px;
  }

  .cf-item-time {
    width: 100%;
    padding-left: 0;
  }
}
</style>
