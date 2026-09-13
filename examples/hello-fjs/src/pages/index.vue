<route>
{"title": "内置组件", "tab": 0}
</route>

<script setup lang="ts">
// 首页：分类手风琴，点条目进二级页（和 hello uni-app 的首页结构一致）。
import { ref } from 'vue';
import { useRouter } from 'fjs/router';
import { catalog } from '@/catalog';

const router = useRouter();
const groups = catalog();

const open = ref<string | null>('视图容器');

function toggle(name: string) {
  open.value = open.value === name ? null : name;
}
</script>

<template>
  <scroll-view class="page">
    <view class="hero">
      <text class="hero-logo">{{ '</>' }}</text>
      <text class="hero-desc">
        flutter-js 内置组件示例。每个页面都是 Vue 3 SFC，标签由 Dart 侧映射成 Flutter Widget。
      </text>
    </view>

    <view v-for="cat in groups" :key="cat.name" class="group">
      <view class="group-head" @tap="() => toggle(cat.name)">
        <text class="group-title">{{ cat.name }}</text>
        <text class="chev">{{ open === cat.name ? '⌃' : '⌄' }}</text>
      </view>

      <view v-if="open === cat.name">
        <view v-for="item in cat.items" :key="item.tag">
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
.item:active {
  background-color: #f7f7f7;
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
