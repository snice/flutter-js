<route>
{"title": "示例", "tab": 2}
</route>

<script setup lang="ts">
// 示例页：首页同款结构，分组同样从路由表里推导——新增一个示例页只要在它自己
// 的 <route> 块里写 "group"，这里不用改。
import { ref } from 'vue';
import { useRouter } from 'fjs/router';
import { examples } from '@/catalog';

const router = useRouter();
const groups = examples();

const open = ref<string | null>(groups[0]?.name ?? null);

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

    <view v-for="cat in groups" :key="cat.name" class="group">
      <view class="group-head" @tap="() => toggle(cat.name)">
        <text class="group-title">{{ cat.name }}</text>
        <text class="chev">{{ open === cat.name ? '⌃' : '⌄' }}</text>
      </view>

      <view v-if="open === cat.name">
        <view v-for="item in cat.items" :key="item.path">
          <view class="hairline" />
          <view class="item" @tap="() => router.push(item.path)">
            <view class="item-main">
              <text class="item-title">{{ item.title }}</text>
              <text v-if="item.desc" class="item-desc">{{ item.desc }}</text>
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
.item-title {
  font-size: 14px;
  color: #007aff;
}
.item-desc {
  font-size: 12px;
  color: #999999;
}
</style>
