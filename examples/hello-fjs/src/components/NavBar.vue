<script setup lang="ts">
// 顶部导航栏：左侧返回（仅二级页显示）、居中标题。
// 自带顶部安全区：状态栏那一条算导航栏的一部分，底色连成一片，也不随页面滚动
// （它在外壳的滚动区之外）。edges="top" 只让出顶边——底边的 Home 指示条归
// tabBar 或外壳底部，不该出现在导航栏下面。
import { useRouter } from 'fjs/router';

defineProps<{ title: string; back?: boolean }>();

const router = useRouter();
</script>

<template>
  <safe-area edges="top" class="nav">
    <view class="bar">
      <view class="side" @tap="router.back()">
        <icon-mind v-if="back" name="chevron-left" class="back" size="35" />
      </view>
      <text class="title">{{ title }}</text>
      <view class="side" />
    </view>
    <view class="hairline" />
  </safe-area>
</template>

<style scoped>
.nav {
  background-color: var(--fjs-card);
}
.bar {
  flex-direction: row;
  align-items: center;
  height: 44px;
  background-color: var(--fjs-card);
  padding: 0 8px;
}
.side {
  width: 56px;
  justify-content: center;
}
.back {
  font-size: 22px;
  color: var(--fjs-primary);
  padding: 0 8px;
}
.title {
  flex-grow: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--fjs-title);
}
.hairline {
  height: 1px;
  background-color: var(--fjs-border);
}
</style>
