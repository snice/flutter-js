<route>
{"title": "下拉刷新", "tag": "refresh", "group": "交互反馈", "platforms": ["app"]}
</route>

<script setup lang="ts">
// refresh：映射 RefreshIndicator，下拉回派 @refresh（原生 600ms 后自动收起）。
import { ref } from 'vue';
import Panel from '../../components/Panel.vue';

// 文件名与内置标签同名：显式命名，模板里的 <refresh> 才不会被当成自引用。
defineOptions({ name: 'RefreshPage' });

const times = ref(0);
const rows = ref(Array.from({ length: 12 }, (_, i) => `初始数据 ${i + 1}`));

function onRefresh() {
  times.value++;
  rows.value = [
    `第 ${times.value} 次下拉刷新 · ${new Date().toLocaleTimeString()}`,
    ...rows.value,
  ].slice(0, 20);
}
</script>

<template>
  <view>
    <Panel title="下拉刷新" :desc="`已刷新 ${times} 次；在下面的列表里下拉`">
      <refresh class="pull" @refresh="onRefresh">
        <list-view>
          <view v-for="(row, i) in rows" :key="row + i" class="row">
            <text>{{ row }}</text>
          </view>
        </list-view>
      </refresh>
    </Panel>
  </view>
</template>

<style scoped>
.pull {
  height: 300px;
}
.row {
  padding: 12px 4px;
}
</style>
