<route>
{"title": "进度条", "tag": "progress", "group": "基础内容"}
</route>

<script setup lang="ts">
// progress：value(0-1) 走 LinearProgressIndicator，缺省是不确定进度，
// type: 'circular' 换成圆形。
import { onMounted, onUnmounted, ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <progress> 才不会被当成自引用。
defineOptions({ name: 'ProgressPage' });

const value = ref(0.3);
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => {
    value.value = value.value >= 1 ? 0 : +(value.value + 0.05).toFixed(2);
  }, 300);
});
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});
</script>

<template>
  <view>
    <Panel title="确定进度" :desc="`value: ${value}`">
      <progress :value="value" />
      <view class="row">
        <view class="bar"><progress :value="0.65" /></view>
        <text class="pct">65%</text>
      </view>
    </Panel>

    <Panel title="不确定进度" desc="不传 value">
      <progress />
    </Panel>

    <Panel title="圆形" desc="type: 'circular'">
      <view class="center">
        <progress type="circular" />
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  gap: 12px;
  align-items: center;
}
.bar {
  flex-grow: 1;
}
.pct {
  font-size: 12px;
  color: #999999;
}
.center {
  align-items: center;
}
</style>
