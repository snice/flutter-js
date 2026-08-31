<route>
{"title": "开关", "tag": "switch", "group": "表单组件"}
</route>

<script setup lang="ts">
// switch：映射 Switch，@change 回派 "1" / "0"。
import { ref } from 'vue';
import Panel from '@/components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <switch> 才不会被当成自引用。
defineOptions({ name: 'SwitchPage' });

const wifi = ref(true);
const push = ref(false);
const locked = ref(true);
</script>

<template>
  <view>
    <Panel title="开关列表">
      <view class="row">
        <text class="row-label">Wi-Fi</text>
        <switch :value="wifi" @change="(v: string) => (wifi = v === '1')" />
      </view>
      <view class="row">
        <text class="row-label">消息推送</text>
        <switch :value="push" @change="(v: string) => (push = v === '1')" />
      </view>
      <view class="row">
        <text class="row-label">禁用状态</text>
        <switch :value="locked" :disabled="true" />
      </view>
    </Panel>

    <Panel title="联动">
      <text class="summary">
        Wi-Fi {{ wifi ? '已开启' : '已关闭' }}，推送 {{ push ? '已开启' : '已关闭' }}
      </text>
      <view v-if="push" class="tip">
        <text class="tip-t">开启后将接收活动通知</text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.row-label {
  font-size: 15px;
  color: #333333;
}
.summary {
  color: #666666;
}
.tip {
  background-color: #eef4ff;
  border-radius: 8px;
  padding: 10px;
}
.tip-t {
  font-size: 12px;
  color: #007aff;
}
</style>
