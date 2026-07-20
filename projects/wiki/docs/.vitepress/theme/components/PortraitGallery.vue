<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MorimensCharacter } from '../data/characters'

const props = defineProps<{ character: MorimensCharacter }>()

const items = computed(() => {
  const out: Array<{ key: string; label: string; src: string }> = []
  const p = props.character.portraits
  if (p?.default) out.push({ key: 'default', label: '初始形态', src: p.default })
  if (p?.awaker) out.push({ key: 'awaker', label: '觉醒形态', src: p.awaker })
  ;(p?.skins || []).forEach((s, i) => out.push({ key: `skin-${i}`, label: `皮肤 ${i + 1}`, src: s }))
  if (out.length === 0) {
    out.push({ key: 'fallback', label: '默认立绘', src: `/portraits/${props.character.slug}.png` })
  }
  return out
})

const lightbox = ref<{ src: string; label: string } | null>(null)
function open(item: { src: string; label: string }) { lightbox.value = item }
function close() { lightbox.value = null }
</script>

<template>
  <section class="m-gallery">
    <h2 class="m-gallery__h2">立绘与战斗形象</h2>
    <ul class="m-gallery__grid">
      <li v-for="it in items" :key="it.key" class="m-gallery__item" @click="open(it)">
        <img :src="it.src" :alt="it.label" loading="lazy" />
        <span class="m-gallery__label">{{ it.label }}</span>
      </li>
    </ul>
    <div v-if="lightbox" class="m-gallery__lightbox" @click.self="close">
      <button class="m-gallery__close" @click="close" aria-label="关闭">×</button>
      <figure>
        <img :src="lightbox.src" :alt="lightbox.label" />
        <figcaption>{{ lightbox.label }}</figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.m-gallery { margin-bottom: var(--m-sp-10); }
.m-gallery__h2 {
  font-family: var(--m-font-title);
  font-size: var(--m-fs-h1);
  color: var(--m-gold-light);
  letter-spacing: var(--m-ls-title);
  border-bottom: 1px solid var(--m-border-default);
  padding-bottom: var(--m-sp-2);
  margin: 0 0 var(--m-sp-6);
}
.m-gallery__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--m-sp-3);
}
.m-gallery__item {
  position: relative;
  background: var(--m-bg-elevated);
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
  overflow: hidden;
  cursor: zoom-in;
  aspect-ratio: 3 / 4;
  transition: border-color var(--m-dur-fast) var(--m-ease-default);
}
.m-gallery__item:hover { border-color: var(--m-border-hover); }
.m-gallery__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.m-gallery__label {
  position: absolute;
  inset: auto 0 0 0;
  background: linear-gradient(180deg, transparent, rgba(10, 11, 16, 0.85));
  color: var(--m-text-primary);
  padding: var(--m-sp-3);
  font-size: var(--m-fs-caption);
  font-family: var(--m-font-title);
  letter-spacing: var(--m-ls-title);
}
.m-gallery__lightbox {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(10, 11, 16, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--m-sp-6);
}
.m-gallery__lightbox figure {
  margin: 0;
  max-width: min(90vw, 720px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--m-sp-3);
}
.m-gallery__lightbox img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border: 1px solid var(--m-border-default);
  border-radius: var(--m-radius-md);
}
.m-gallery__lightbox figcaption {
  color: var(--m-text-primary);
  font-family: var(--m-font-title);
  letter-spacing: var(--m-ls-title);
}
.m-gallery__close {
  position: absolute;
  top: var(--m-sp-4);
  right: var(--m-sp-4);
  background: transparent;
  border: 1px solid var(--m-border-default);
  border-radius: 999px;
  color: var(--m-text-primary);
  width: 36px;
  height: 36px;
  cursor: pointer;
  font-size: 24px;
  line-height: 1;
}
.m-gallery__close:hover { border-color: var(--m-gold-primary); color: var(--m-gold-light); }
</style>
