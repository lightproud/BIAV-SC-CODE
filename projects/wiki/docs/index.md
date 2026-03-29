---
layout: home
title: 忘却前夜 Wiki
---

<script setup>
import { onMounted } from 'vue'
import { withBase } from 'vitepress'

onMounted(() => {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('ja')) {
    window.location.href = withBase('/ja/')
  } else if (lang.startsWith('en')) {
    window.location.href = withBase('/en/')
  } else {
    window.location.href = withBase('/zh/')
  }
})
</script>

<div style="text-align:center; padding: 4rem 2rem;">
  <p>正在跳转 / Redirecting...</p>
  <p><a href="./zh/">简体中文</a> · <a href="./en/">English</a> · <a href="./ja/">日本語</a></p>
</div>
