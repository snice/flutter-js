<script setup lang="ts">
// 演示小节：灰色标题 + 白色卡片，详情页里反复使用。
defineProps<{ title?: string; desc?: string }>();
</script>

<template>
  <view class="section">
    <text v-if="title" class="section-title">{{ title }}</text>
    <text v-if="desc" class="section-desc">{{ desc }}</text>
    <view class="card">
      <slot />
    </view>
  </view>
</template>

<style scoped>
.section {
  margin: 16px 12px 0 12px;
}
.section-title {
  font-size: 13px;
  color: var(--fjs-muted);
  margin: 0 4px 4px 4px;
}
.section-desc {
  font-size: 12px;
  color: var(--fjs-faint);
  margin: 0 4px 8px 4px;
}
.card {
  background-color: var(--fjs-card);
  border-radius: 10px;
  padding: 16px;
  gap: 12px;
}
</style>
