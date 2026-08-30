<script setup lang="ts">
// 底部 tabBar。切 tab 用 router.replace：栈里只有首页时它原地换页，
// 不产生一层新的原生路由（Flutter 上表现为无转场，和小程序一致）。
import { useRouter } from 'fjs/router';

defineProps<{ active: number }>();

const router = useRouter();

const tabs = [
  { label: '内置组件', icon: '</>', path: '/' },
  { label: '接口', icon: '{JS}', path: '/api' },
  { label: '关于', icon: '◎', path: '/about' },
];
</script>

<template>
  <view>
    <view class="hairline" />
    <view class="bar">
      <view
        v-for="(item, i) in tabs"
        :key="item.label"
        class="item"
        :class="{ active: active === i }"
        @tap="() => router.replace(item.path)"
      >
        <text class="icon">{{ item.icon }}</text>
        <text class="label">{{ item.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.hairline {
  height: 1px;
  background-color: #e5e5e5;
}
.bar {
  flex-direction: row;
  height: 52px;
  background-color: #ffffff;
}
.item {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  gap: 2px;
  /* 颜色沿树继承：选中态只要换 .item 上的 color，图标和文字一起变 */
  color: #999999;
}
.item.active {
  color: #007aff;
}
.icon {
  font-size: 16px;
}
.label {
  font-size: 11px;
}
</style>
