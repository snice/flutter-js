<script setup lang="ts">
// 只有一个全屏页面：外壳只负责把页面撑满，不要导航栏也不要滚动区。
import type { RouteLocation } from 'fjs/router';

defineProps<{ route: RouteLocation }>();
</script>

<template>
  <view class="shell">
    <slot />
  </view>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  background-color: #0e1116;
}
</style>
