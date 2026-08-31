<route>
{"title": "接口", "tab": 1}
</route>

<script setup lang="ts">
// 接口 tab：运行时提供的非 UI 能力（toast / 定时器 / Worker / 引擎信息）。
import { onUnmounted, ref } from 'vue';
import { Worker, engineInfo, nowMs, toast } from 'fjs';
import Panel from '@/components/Panel.vue';

const ticks = ref(0);
const running = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

function toggleTimer() {
  if (running.value) {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    running.value = false;
    return;
  }
  running.value = true;
  timer = setInterval(() => ticks.value++, 1000);
}
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer);
});

// Worker：独立 isolate + 独立 QuickJS 实例，适合放 CPU 密集任务
const workerResult = ref('未运行');
let worker: Worker | null = null;
// onmessage 只注册一次，起始时间必须放在闭包外——否则每次回调都在用
// 第一次点击的时间戳做差，测出来的是墙钟时间而不是任务耗时
let workerT0 = 0;
function runWorker() {
  workerResult.value = '计算中…';
  workerT0 = nowMs();
  if (!worker) {
    worker = new Worker(
      [
        'onmessage = function (e) {',
        '  var n = Number(e.data), sum = 0;',
        '  for (var i = 0; i < n; i++) sum += Math.sqrt(i);',
        '  postMessage(String(Math.round(sum)));',
        '};',
      ].join('\n'),
    );
    worker.onmessage = (e) => {
      workerResult.value = `${e.data}（耗时 ${Math.round(nowMs() - workerT0)}ms，主线程未卡顿）`;
    };
  }
  worker.postMessage('3000000');
}

const bench = ref('未运行');
function runBench() {
  const t0 = nowMs();
  let sum = 0;
  for (let i = 0; i < 3000000; i++) sum += Math.sqrt(i);
  bench.value = `${Math.round(sum)}（主线程同步耗时 ${Math.round(nowMs() - t0)}ms）`;
}
</script>

<template>
  <view class="page">
    <Panel title="轻提示" desc="toast(message)">
      <button class="btn" @tap="() => toast('来自 fjs 的 toast')">弹一条 toast</button>
    </Panel>

    <Panel title="定时器" desc="setInterval / clearInterval（原生计时器驱动）">
      <text class="ticks">{{ ticks }}</text>
      <button class="btn" @tap="toggleTimer">{{ running ? '停止' : '开始' }}</button>
    </Panel>

    <Panel title="Worker" desc="独立 isolate + 独立 QuickJS 实例">
      <button class="btn" @tap="runWorker">后台线程计算 300 万次开方</button>
      <text class="result">结果：{{ workerResult }}</text>
      <divider class="sep" />
      <button class="btn" @tap="runBench">同样的计算放在主线程</button>
      <text class="result">结果：{{ bench }}</text>
    </Panel>

    <Panel title="引擎信息">
      <text class="kv">engineId: {{ engineInfo.engineId }}</text>
      <text class="kv">abiVersion: {{ engineInfo.abiVersion }}</text>
    </Panel>
  </view>
</template>

<style scoped>
.page {
  padding-bottom: 24px;
}
.btn {
  border-radius: 8px;
}
.ticks {
  font-size: 28px;
  text-align: center;
}
.result {
  font-size: 12px;
  color: #666666;
}
.sep {
  height: 8px;
}
.kv {
  font-size: 13px;
  color: #666666;
}
</style>
