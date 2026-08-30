<template>
  <safe-area>
    <view class="shell">
      <slot />
    </view>
  </safe-area>
</template>

<style scoped>
.shell {
  flex-grow: 1;
  align-items: center;
  justify-content: center;
  background-color: #ffffff;
}
</style>
