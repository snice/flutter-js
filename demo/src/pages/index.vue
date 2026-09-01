<route>
{"title": "hello-fjs"}
</route>

<script setup lang="ts">
import { useRouter } from 'fjs/router';
import { useCounter } from '@/stores/counter';

const counter = useCounter();
const router = useRouter();
</script>

<template>
  <view class="page">
    <text class="title">count: {{ counter.count }}</text>
    <button class="btn" @tap="counter.inc()">+1</button>
    <button class="btn" @tap="router.push('/about')">go to /about</button>
    <button class="btn" @tap="router.push('/fetch')">fetch live check</button>
  </view>
</template>

<style scoped>
.page {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
}
.title {
  font-size: 24px;
  font-weight: 700;
  color: #111827;
}
.btn {
  margin-top: 12px;
  padding: 8px 16px;
  background-color: #2563eb;
  color: #ffffff;
  border-radius: 6px;
}
</style>
