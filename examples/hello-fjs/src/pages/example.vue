<route>
{"title": "示例", "tab": 2}
</route>

<script setup lang="ts">
// 示例页：首页同款结构，集中放交互演示入口。
import { ref } from 'vue';
import { useRouter } from 'fjs/router';

const router = useRouter();

const open = ref<string | null>('交互演示');

const items = [
  { tag: 'drag', title: '块拖拽', path: '/example/drag' },
  { tag: 'dnd', title: '拖拽排序', path: '/example/dnd' },
  { tag: 'theme', title: '主题切换压测', path: '/example/theme' },
];

function toggle(name: string) {
  open.value = open.value === name ? null : name;
}
</script>

<template>
  <scroll-view class="page">
    <view class="hero">
      <text class="hero-logo">{{ '</>' }}</text>
      <text class="hero-desc">
        flutter-js 交互示例页。这里放手势、拖拽和其他需要单独演示的页面。
      </text>
    </view>

    <view class="group">
      <view class="group-head" @tap="() => toggle('交互演示')">
        <text class="group-title">交互演示</text>
        <text class="chev">{{ open === '交互演示' ? '⌃' : '⌄' }}</text>
      </view>

      <view v-if="open === '交互演示'">
        <view v-for="item in items" :key="item.tag">
          <view class="hairline" />
          <view class="item" @tap="() => router.push(item.path)">
            <view class="item-main">
              <text class="item-tag">&lt;{{ item.tag }}&gt;</text>
              <text class="item-title">{{ item.title }}</text>
            </view>
            <text class="chev">›</text>
          </view>
        </view>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.page {
  padding-bottom: 24px;
}
.hero {
  align-items: center;
  padding: 28px 24px;
  gap: 12px;
}
.hero-logo {
  font-size: 34px;
  color: #666666;
  letter-spacing: 2px;
}
.hero-desc {
  font-size: 13px;
  color: #999999;
  text-align: center;
  line-height: 1.6;
}
.group {
  background-color: #ffffff;
  border-radius: 10px;
  margin: 0 12px 12px 12px;
  overflow: hidden;
}
.group-head {
  flex-direction: row;
  align-items: center;
  padding: 16px;
}
.group-title {
  flex-grow: 1;
  font-size: 16px;
  color: #1a1a1a;
}
.chev {
  font-size: 16px;
  color: #c0c0c0;
}
.hairline {
  height: 1px;
  background-color: #f0f0f0;
  margin: 0 16px;
}
.item {
  flex-direction: row;
  align-items: center;
  padding: 12px 16px;
}
.item-main {
  flex-grow: 1;
  gap: 2px;
}
.item-tag {
  font-size: 14px;
  color: #007aff;
}
.item-title {
  font-size: 12px;
  color: #999999;
}
</style>
