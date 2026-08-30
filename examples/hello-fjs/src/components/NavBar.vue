<script setup lang="ts">
// 顶部导航栏：左侧返回（仅二级页显示）、居中标题。
import { useRouter } from 'fjs/router';

defineProps<{ title: string; back?: boolean }>();

const router = useRouter();
</script>

<template>
  <view>
    <view class="bar">
      <view class="side" @tap="router.back()">
        <text v-if="back" class="back">←</text>
      </view>
      <text class="title">{{ title }}</text>
      <view class="side" />
    </view>
    <view class="hairline" />
  </view>
</template>

<style scoped>
.bar {
  flex-direction: row;
  align-items: center;
  height: 44px;
  background-color: #ffffff;
  padding: 0 8px;
}
.side {
  width: 56px;
  justify-content: center;
}
.back {
  font-size: 22px;
  color: #007aff;
  padding: 0 8px;
}
.title {
  flex-grow: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: #1a1a1a;
}
.hairline {
  height: 1px;
  background-color: #e5e5e5;
}
</style>
