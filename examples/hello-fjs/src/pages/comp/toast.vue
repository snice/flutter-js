<route>
{"title": "轻提示", "tag": "toast", "group": "交互反馈"}
</route>

<script setup lang="ts">
// toast：不是组件，是 fjs 提供的全局函数（原生 overlay）。
import { ref } from 'vue';
import { toast } from 'fjs';
import Panel from '../../components/Panel.vue';

const count = ref(0);

function show(msg: string) {
  count.value++;
  toast(msg);
}
</script>

<template>
  <view>
    <Panel title="基础用法" desc="import { toast } from 'fjs'">
      <button class="btn" @tap="() => show('操作成功')">成功提示</button>
      <button class="btn" @tap="() => show('网络异常，请稍后重试')">错误提示</button>
      <button class="btn" @tap="() => show('这是一条比较长的提示文案，用来看看换行表现')">
        长文案
      </button>
      <text class="hint">已弹出 {{ count }} 次</text>
    </Panel>

    <Panel title="代码">
      <view class="code">
        <text class="code-t">
          import { toast } from 'fjs';{{ '\n' }}toast('操作成功');
        </text>
      </view>
    </Panel>
  </view>
</template>

<style scoped>
.btn {
  border-radius: 8px;
}
.hint {
  font-size: 12px;
  color: #999999;
}
.code {
  background-color: #f4f5f7;
  border-radius: 8px;
  padding: 12px;
}
.code-t {
  font-size: 12px;
  color: #666666;
  font-family: Menlo;
}
</style>
