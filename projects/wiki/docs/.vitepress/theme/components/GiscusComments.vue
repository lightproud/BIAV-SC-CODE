<template>
  <div v-if="showComments" class="giscus-wrapper">
    <div class="giscus-divider" />
    <div ref="giscusContainer" class="giscus-container" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useData } from 'vitepress'

const route = useRoute()
const { frontmatter } = useData()
const giscusContainer = ref<HTMLElement | null>(null)

// Only show on doc pages, not on home page
const showComments = computed(() => {
  return frontmatter.value.layout !== 'home' && frontmatter.value.comments !== false
})

function loadGiscus() {
  if (!giscusContainer.value) return

  // Remove any existing giscus iframe/script
  giscusContainer.value.innerHTML = ''

  const script = document.createElement('script')
  script.src = 'https://giscus.app/client.js'
  script.setAttribute('data-repo', 'lightproud/brain-in-a-vat')
  // Obtain repo-id and category-id from https://giscus.app after enabling Discussions
  script.setAttribute('data-repo-id', 'FILL_IN_REPO_ID')
  script.setAttribute('data-category', 'General')
  script.setAttribute('data-category-id', 'FILL_IN_CATEGORY_ID')
  script.setAttribute('data-mapping', 'pathname')
  script.setAttribute('data-strict', '0')
  script.setAttribute('data-reactions-enabled', '1')
  script.setAttribute('data-emit-metadata', '0')
  script.setAttribute('data-input-position', 'top')
  script.setAttribute('data-theme', 'transparent_dark')
  script.setAttribute('data-lang', 'zh-CN')
  script.setAttribute('data-loading', 'lazy')
  script.setAttribute('crossorigin', 'anonymous')
  script.async = true

  giscusContainer.value.appendChild(script)
}

function refreshGiscus() {
  const iframe = document.querySelector<HTMLIFrameElement>('iframe.giscus-frame')
  if (iframe) {
    // Send setConfig message to update the pathname without reloading
    iframe.contentWindow?.postMessage(
      { giscus: { setConfig: { term: route.path } } },
      'https://giscus.app',
    )
  } else {
    // Iframe not yet loaded, reload the whole widget
    loadGiscus()
  }
}

onMounted(() => {
  if (showComments.value) {
    loadGiscus()
  }
})

watch(
  () => route.path,
  () => {
    if (showComments.value) {
      refreshGiscus()
    }
  },
)
</script>

<style scoped>
.giscus-wrapper {
  margin-top: 48px;
}

.giscus-divider {
  height: 1px;
  background: var(--vp-c-divider);
  margin-bottom: 40px;
}

.giscus-container {
  width: 100%;
}
</style>
