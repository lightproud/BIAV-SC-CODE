<script setup lang="ts">
import { computed } from 'vue'
import type { MorimensCharacter } from '../data/characters'
import { REALM_LABELS, ROLE_LABELS } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()

const portraitUrl = computed(() => {
  const p = props.character.portraits?.default
  return p || `/portraits/${props.character.slug}.png`
})

const realmLabel = computed(() => {
  const r = props.character.realm
  return r ? REALM_LABELS[r] || r : '—'
})

const roleLabel = computed(() => {
  const r = props.character.role
  return r ? ROLE_LABELS[r] || r : '—'
})

const rarityLabel = computed(() => props.character.rarity || '—')
</script>

<template>
  <section class="m-infobox">
    <div class="m-infobox__portrait">
      <img :src="portraitUrl" :alt="character.name_zh" loading="lazy" />
    </div>
    <div class="m-infobox__meta">
      <header class="m-infobox__header">
        <p class="m-infobox__id">No. {{ character.id }}</p>
        <h1 class="m-infobox__name">{{ character.name_zh }}</h1>
        <p v-if="character.name_en" class="m-infobox__name-en">{{ character.name_en }}</p>
        <p v-if="character.title_zh && character.title_zh !== character.name_zh" class="m-infobox__title">
          {{ character.title_zh }}
        </p>
      </header>
      <dl class="m-infobox__stats">
        <div class="m-infobox__stat" :data-realm="character.realm || 'unknown'">
          <dt>界域</dt><dd>{{ realmLabel }}</dd>
        </div>
        <div class="m-infobox__stat">
          <dt>角色</dt><dd>{{ roleLabel }}</dd>
        </div>
        <div class="m-infobox__stat" :data-rarity="rarityLabel">
          <dt>稀有度</dt><dd>{{ rarityLabel }}</dd>
        </div>
        <div class="m-infobox__stat"><dt>性别</dt><dd>{{ character.gender }}</dd></div>
        <div class="m-infobox__stat"><dt>生日</dt><dd>{{ character.age }}</dd></div>
        <div class="m-infobox__stat"><dt>身高</dt><dd>{{ character.height }}</dd></div>
        <div class="m-infobox__stat"><dt>体重</dt><dd>{{ character.weight }}</dd></div>
        <div class="m-infobox__stat"><dt>Gi</dt><dd>{{ character.gi }}</dd></div>
        <div class="m-infobox__stat"><dt>声优</dt><dd>{{ character.voice_actor }}</dd></div>
        <div class="m-infobox__stat"><dt>画师</dt><dd>{{ character.painter }}</dd></div>
      </dl>
      <p v-if="character.summon_slogan" class="m-infobox__slogan">「{{ character.summon_slogan }}」</p>
    </div>
  </section>
</template>

<style scoped>
.m-infobox {
  display: grid;
  grid-template-columns: minmax(200px, 280px) 1fr;
  gap: var(--m-sp-8);
  padding: var(--m-sp-6);
  margin-bottom: var(--m-sp-10);
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-lg);
  position: relative;
  overflow: hidden;
}
@media (max-width: 720px) {
  .m-infobox { grid-template-columns: 1fr; }
}
.m-infobox__portrait {
  border-radius: var(--m-radius-md);
  overflow: hidden;
  background: var(--m-bg-card);
  border: 1px solid var(--m-border-subtle);
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-infobox__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.m-infobox__header {
  margin-bottom: var(--m-sp-5);
}
.m-infobox__id {
  font-family: var(--m-font-code);
  color: var(--m-text-dim);
  font-size: var(--m-fs-small);
  letter-spacing: var(--m-ls-caps);
  margin: 0;
}
.m-infobox__name {
  font-family: var(--m-font-title);
  color: var(--m-gold-light);
  font-size: var(--m-fs-hero);
  margin: var(--m-sp-1) 0 0;
  letter-spacing: var(--m-ls-hero);
}
.m-infobox__name-en {
  color: var(--m-text-muted);
  font-size: var(--m-fs-h3);
  margin: var(--m-sp-1) 0 0;
  letter-spacing: var(--m-ls-title);
}
.m-infobox__title {
  color: var(--m-text-dim);
  font-size: var(--m-fs-caption);
  margin: var(--m-sp-2) 0 0;
}
.m-infobox__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--m-sp-3) var(--m-sp-4);
  margin: 0;
}
.m-infobox__stat {
  display: flex;
  flex-direction: column;
  gap: var(--m-sp-1);
  padding: var(--m-sp-2) var(--m-sp-3);
  background: var(--m-bg-card);
  border: 1px solid var(--m-border-subtle);
  border-radius: var(--m-radius-sm);
}
.m-infobox__stat dt {
  font-size: var(--m-fs-small);
  color: var(--m-text-dim);
  letter-spacing: var(--m-ls-caps);
}
.m-infobox__stat dd {
  margin: 0;
  font-size: var(--m-fs-body);
  color: var(--m-text-primary);
  font-weight: var(--m-fw-medium);
}
.m-infobox__stat[data-rarity='SSR'] dd { color: var(--m-rarity-ssr); }
.m-infobox__stat[data-rarity='SR']  dd { color: var(--m-rarity-sr); }
.m-infobox__stat[data-rarity='R']   dd { color: var(--m-rarity-r); }
.m-infobox__slogan {
  margin-top: var(--m-sp-5);
  padding-top: var(--m-sp-4);
  border-top: 1px dashed var(--m-border-subtle);
  color: var(--m-text-muted);
  font-style: italic;
  font-size: var(--m-fs-caption);
}
</style>
