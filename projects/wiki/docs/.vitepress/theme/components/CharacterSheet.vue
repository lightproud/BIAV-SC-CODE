<script setup lang="ts">
import { computed } from 'vue'
import { findById, findBySlug } from '../data/characters'
import FixtureBadge from './FixtureBadge.vue'
import CharacterInfobox from './CharacterInfobox.vue'
import SkillTable from './SkillTable.vue'
import AscensionMaterialBlock from './AscensionMaterialBlock.vue'
import TrinketRecommendationCard from './TrinketRecommendationCard.vue'
import BondRewardList from './BondRewardList.vue'
import StatGrowthChart from './StatGrowthChart.vue'
import AffinityTags from './AffinityTags.vue'
import VoiceLineList from './VoiceLineList.vue'
import PortraitGallery from './PortraitGallery.vue'

const props = defineProps<{
  characterId?: string
  slug?: string
}>()

const character = computed(() => {
  if (props.characterId) return findById(props.characterId)
  if (props.slug) return findBySlug(props.slug)
  return undefined
})
</script>

<template>
  <article v-if="character" class="m-sheet" :data-realm="character.realm || 'unknown'">
    <FixtureBadge :status="character.status" />
    <CharacterInfobox :character="character" />
    <p v-if="character.introduction" class="m-sheet__intro">{{ character.introduction }}</p>
    <p v-if="character.awaker_introduction" class="m-sheet__intro m-sheet__intro--awaker">
      <strong>觉醒形态：</strong>{{ character.awaker_introduction }}
    </p>
    <AffinityTags :character="character" />
    <SkillTable :character="character" />
    <AscensionMaterialBlock :character="character" />
    <TrinketRecommendationCard :character="character" />
    <StatGrowthChart :character="character" />
    <BondRewardList :character="character" />
    <PortraitGallery :character="character" />
    <VoiceLineList :character="character" />
    <footer class="m-sheet__footer">
      <span>last_verified: {{ character.last_verified }}</span>
      <span>status: {{ character.status }}</span>
      <span>source: {{ character.source.extracted_from }}</span>
    </footer>
  </article>
  <div v-else class="m-sheet__missing">
    未找到 ID 为 <code>{{ characterId || slug }}</code> 的角色。
  </div>
</template>

<style scoped>
.m-sheet {
  max-width: var(--m-content-max);
  margin: 0 auto;
  padding-bottom: var(--m-sp-12);
}
.m-sheet__intro {
  font-size: var(--m-fs-body);
  color: var(--m-text-primary);
  line-height: var(--m-lh-normal);
  background: var(--m-bg-elevated);
  border-left: 2px solid var(--m-gold-primary);
  padding: var(--m-sp-3) var(--m-sp-4);
  border-radius: var(--m-radius-sm);
  margin: 0 0 var(--m-sp-4);
}
.m-sheet__intro--awaker {
  border-left-color: var(--m-gold-light);
  background: rgba(197, 163, 86, 0.04);
}
.m-sheet__intro strong {
  color: var(--m-gold-light);
  font-family: var(--m-font-title);
  letter-spacing: var(--m-ls-title);
}
.m-sheet__footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--m-sp-4);
  margin-top: var(--m-sp-8);
  padding-top: var(--m-sp-4);
  border-top: 1px solid var(--m-border-subtle);
  font-family: var(--m-font-code);
  font-size: var(--m-fs-small);
  color: var(--m-text-dim);
}
.m-sheet__missing {
  max-width: var(--m-content-max);
  margin: var(--m-sp-12) auto;
  padding: var(--m-sp-6);
  background: var(--m-bg-elevated);
  border: 1px dashed var(--m-fn-error);
  border-radius: var(--m-radius-md);
  color: var(--m-text-muted);
  text-align: center;
}
.m-sheet__missing code {
  background: var(--m-bg-card);
  padding: 2px 6px;
  border-radius: var(--m-radius-sm);
  color: var(--m-fn-error);
}
</style>
