<script setup lang="ts">
import Giscus from '@giscus/vue'
import { useRoute, useData } from 'vitepress'
import { computed } from 'vue'

const route = useRoute()
const { frontmatter } = useData()

const term = computed(() => route.path)
// Pages can opt out of comments with `comments: false` in frontmatter
const showComments = computed(() => frontmatter.value.comments !== false)
</script>

<template>
  <div v-if="showComments" class="giscus-wrapper">
    <Giscus
      repo="lightproud/brain-in-a-vat"
      repo-id=""
      category="Wiki Comments"
      category-id=""
      mapping="pathname"
      :term="term"
      strict="0"
      reactions-enabled="1"
      emit-metadata="0"
      input-position="top"
      theme="dark_dimmed"
      lang="zh-CN"
      loading="lazy"
    />
  </div>
</template>

<style scoped>
.giscus-wrapper {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
}
</style>
