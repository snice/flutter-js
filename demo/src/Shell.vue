<template>
  <safe-area>
    <view class="shell">
      <view class="side" @tap="router.back()">
        <text class="back">←</text>
      </view>
      <slot />
    </view>
  </safe-area>
</template>

<script setup lang="ts">
import { useRouter } from 'fjs/router'
const router = useRouter()
</script>

<style scoped>
.shell {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  background-color: #ffffff;
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
</style>
