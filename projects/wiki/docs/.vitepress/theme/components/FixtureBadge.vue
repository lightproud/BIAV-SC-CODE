<script setup lang="ts">
defineProps<{ status: string }>()
</script>

<template>
  <div v-if="status === 'fixture'" class="m-fixture-badge">
    <strong>FIXTURE 数据</strong>
    <span>本页字段为合成示例，仅用于验证组件渲染。真实数值待后续 Phase 由制作人或解 Lua 流程覆盖。</span>
  </div>
  <div v-else-if="status === 'stub'" class="m-fixture-badge m-fixture-badge--stub">
    <strong>STUB 数据</strong>
    <span>本角色数据仅包含从游戏客户端抽取的元数据。技能 / 神器 / 觉醒材料尚未填充。</span>
  </div>
</template>

<style scoped>
.m-fixture-badge {
  display: flex;
  flex-direction: column;
  gap: var(--m-sp-1);
  padding: var(--m-sp-3) var(--m-sp-4);
  margin-bottom: var(--m-sp-6);
  border: 1px solid var(--m-fn-warning);
  background: rgba(197, 163, 86, 0.08);
  border-radius: var(--m-radius-md);
  font-size: var(--m-fs-caption);
  color: var(--m-text-muted);
}
.m-fixture-badge strong {
  color: var(--m-gold-light);
  font-family: var(--m-font-title);
  letter-spacing: var(--m-ls-caps);
}
.m-fixture-badge--stub {
  border-color: var(--m-fn-info);
  background: rgba(122, 156, 198, 0.08);
}
.m-fixture-badge--stub strong {
  color: var(--m-fn-info);
}
</style>
