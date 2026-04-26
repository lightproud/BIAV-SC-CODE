<script setup lang="ts">
import { computed, ref } from 'vue'
import { characters, REALM_LABELS, ROLE_LABELS } from '../data/characters'
import type { MorimensCharacter } from '../data/characters'

const realmFilter = ref<string>('all')
const roleFilter = ref<string>('all')
const statusFilter = ref<string>('all')
const search = ref<string>('')

const realms = computed(() => {
  const set = new Set<string>()
  for (const c of characters) if (c.realm) set.add(c.realm)
  return Array.from(set).sort()
})
const roles = computed(() => {
  const set = new Set<string>()
  for (const c of characters) if (c.role) set.add(c.role)
  return Array.from(set).sort()
})
const statuses = computed(() => {
  const set = new Set<string>()
  for (const c of characters) set.add(c.status)
  return Array.from(set).sort()
})

const filtered = computed<MorimensCharacter[]>(() => {
  return characters.filter((c) => {
    if (realmFilter.value !== 'all' && c.realm !== realmFilter.value) return false
    if (roleFilter.value !== 'all' && c.role !== roleFilter.value) return false
    if (statusFilter.value !== 'all' && c.status !== statusFilter.value) return false
    if (search.value) {
      const q = search.value.toLowerCase()
      const hay = [c.name_zh, c.name_en, c.slug, c.title_zh].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

function reset() {
  realmFilter.value = 'all'
  roleFilter.value = 'all'
  statusFilter.value = 'all'
  search.value = ''
}
</script>

<template>
  <div class="m-grid">
    <header class="m-grid__filters">
      <input v-model="search" type="search" placeholder="搜索唤醒体..." class="m-grid__search" />
      <label>
        界域：
        <select v-model="realmFilter">
          <option value="all">全部</option>
          <option v-for="r in realms" :key="r" :value="r">{{ REALM_LABELS[r] || r }}</option>
        </select>
      </label>
      <label>
        角色：
        <select v-model="roleFilter">
          <option value="all">全部</option>
          <option v-for="r in roles" :key="r" :value="r">{{ ROLE_LABELS[r] || r }}</option>
        </select>
      </label>
      <label>
        状态：
        <select v-model="statusFilter">
          <option value="all">全部</option>
          <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <button class="m-grid__reset" @click="reset">重置</button>
      <span class="m-grid__count">{{ filtered.length }} / {{ characters.length }}</span>
    </header>
    <ul class="m-grid__list">
      <li v-for="c in filtered" :key="c.id" :data-realm="c.realm || 'unknown'" class="m-grid__card">
        <a :href="`/zh/awakeners/${c.slug}`" class="m-grid__link">
          <div class="m-grid__portrait">
            <img :src="c.portraits?.default || `/portraits/${c.slug}.png`" :alt="c.name_zh" loading="lazy" />
          </div>
          <div class="m-grid__meta">
            <strong>{{ c.name_zh }}</strong>
            <span class="m-grid__name-en">{{ c.name_en || '—' }}</span>
            <span class="m-grid__chips">
              <span v-if="c.realm" class="m-grid__chip">{{ REALM_LABELS[c.realm] || c.realm }}</span>
              <span v-if="c.role" class="m-grid__chip">{{ ROLE_LABELS[c.role] || c.role }}</span>
              <span v-if="c.status !== 'complete'" class="m-grid__chip m-grid__chip--status">{{ c.status }}</span>
            </span>
          </div>
        </a>
      </li>
    </ul>
    <p v-if="!filtered.length" class="m-grid__empty">没有匹配的唤醒体。</p>
  </div>
</template>

<style scoped>
.m-grid { padding-bottom: var(--m-sp-12); }
.m-grid__filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--m-sp-3);
  align-items: center;
  margin-bottom: var(--m-sp-6);
  padding: var(--m-sp-4);
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
}
.m-grid__filters label {
  display: flex;
  align-items: center;
  gap: var(--m-sp-2);
  color: var(--m-text-muted);
  font-size: var(--m-fs-caption);
}
.m-grid__filters select {
  background: var(--m-bg-card);
  border: 1px solid var(--m-border-default);
  color: var(--m-text-primary);
  padding: var(--m-sp-1) var(--m-sp-2);
  border-radius: var(--m-radius-sm);
  font-family: var(--m-font-body);
  font-size: var(--m-fs-caption);
}
.m-grid__search {
  flex: 1 1 200px;
  background: var(--m-bg-card);
  border: 1px solid var(--m-border-default);
  color: var(--m-text-primary);
  padding: var(--m-sp-2) var(--m-sp-3);
  border-radius: var(--m-radius-sm);
  font-family: var(--m-font-body);
  font-size: var(--m-fs-caption);
}
.m-grid__reset {
  background: transparent;
  border: 1px solid var(--m-border-default);
  color: var(--m-gold-light);
  padding: var(--m-sp-2) var(--m-sp-4);
  border-radius: var(--m-radius-sm);
  cursor: pointer;
  font-size: var(--m-fs-caption);
  letter-spacing: var(--m-ls-caps);
}
.m-grid__reset:hover { border-color: var(--m-gold-primary); }
.m-grid__count {
  color: var(--m-text-dim);
  font-family: var(--m-font-code);
  font-size: var(--m-fs-caption);
  margin-left: auto;
}
.m-grid__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--m-sp-3);
}
.m-grid__card {
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  overflow: hidden;
  transition: border-color var(--m-dur-fast) var(--m-ease-default), transform var(--m-dur-fast) var(--m-ease-default);
}
.m-grid__card:hover { border-color: var(--m-border-hover); transform: translateY(-2px); }
.m-grid__link {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  color: inherit;
}
.m-grid__portrait {
  aspect-ratio: 3 / 4;
  background: var(--m-bg-card);
  overflow: hidden;
}
.m-grid__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.m-grid__meta {
  padding: var(--m-sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--m-sp-1);
}
.m-grid__meta strong {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h3);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
}
.m-grid__name-en {
  font-size: var(--m-fs-small);
  color: var(--m-text-dim);
  letter-spacing: var(--m-ls-title);
}
.m-grid__chips { display: flex; flex-wrap: wrap; gap: var(--m-sp-1); margin-top: var(--m-sp-2); }
.m-grid__chip {
  background: var(--m-bg-card);
  color: var(--m-text-muted);
  font-size: var(--m-fs-small);
  padding: 2px 6px;
  border-radius: var(--m-radius-sm);
  letter-spacing: var(--m-ls-caps);
}
.m-grid__chip--status {
  border: 1px solid var(--m-fn-warning);
  color: var(--m-fn-warning);
}
.m-grid__empty {
  text-align: center;
  color: var(--m-text-dim);
  padding: var(--m-sp-8);
  font-style: italic;
}
</style>
