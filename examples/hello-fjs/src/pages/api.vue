<route>
{"title": "接口", "tab": 1}
</route>

<script setup lang="ts">
// 接口页：示例页同款结构，分组从路由表里推导——新增一个接口页只要放进
// src/pages/api/ 并在它自己的 <route> 块里写 "group"，这里不用改。
import { ref } from 'vue';
import { useRouter } from 'fjs/router';
import { apis } from '@/catalog';

const router = useRouter();
const groups = apis();

const open = ref<string | null>(groups[0]?.name ?? null);

function toggle(name: string) {
  open.value = open.value === name ? null : name;
}
</script>

<template>
  <scroll-view class="page">
    <view class="hero">
      <text class="hero-logo">{{ '{ }' }}</text>
      <text class="hero-desc">
        ufjs 接口页。这里放运行时提供的非 UI 能力：网络、定时器、Worker 等。
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
