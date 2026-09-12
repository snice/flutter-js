<route>
{"title": "异步宿主调用", "group": "交互演示", "desc": "invokeHostAsync：等得起 Dart 的宿主模块"}
</route>

<script setup lang="ts">
// invokeHostAsync 的演示页（spec 039）。
//
// 同步的 invokeHost 要求 Dart 当场给出返回值，凡是 Future 结尾的能力——
// 插件读写、权限、三方 SDK——都做不成宿主模块。invokeHostAsync 走的是
// fetch 的老路：同步发起（invokeHost 'fjs.async.invoke'），Dart 干完活
// 用 dispatchEvent 把结果送回来，Promise 就地 settle。
//
// 这一页连的是宿主 main.dart 里注册的 demo.asyncStore——一个延迟 400ms
// 应答的假 KV 存储。Web 端没有 Dart 宿主，invokeHostAsync 会 reject，
// 下面任一按钮的「×」行就是那条路径：同样的页面代码，两条边都看得见。
import { ref } from 'vue';
import { invokeHostAsync } from 'fjs';
import Panel from '@/components/Panel.vue';

const lines = ref<string[]>([]);
const busy = ref(false);

function log(text: string): void {
  lines.value.push(text);
}

async function run(label: string, op: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  const t0 = Date.now();
  log(`→ ${label}`);
  try {
    const value = await op();
    log(`← ${label} · ${Date.now() - t0}ms · ${JSON.stringify(value)}`);
  } catch (e) {
    log(`× ${label} · ${Date.now() - t0}ms · ${String(e)}`);
  } finally {
    busy.value = false;
  }
}

// 连发三个调用：三个 callId 各自 settle，耗时里能看到它们是并行的
// （约 400ms 一次应答，三个一起发也是约 400ms，而不是 1200ms）。
function write(): void {
  void run('set × 3', async () => {
    const [a, b, c] = await Promise.all([
      invokeHostAsync('demo.asyncStore', 'set', 'name', 'fjs'),
      invokeHostAsync('demo.asyncStore', 'set', 'kind', 'async'),
      invokeHostAsync('demo.asyncStore', 'set', 'year', '2026'),
    ]);
    return [a, b, c];
  });
}

function read(): void {
  void run('get name', () => invokeHostAsync<string>('demo.asyncStore', 'get', 'name'));
}

function keys(): void {
  void run('keys', () => invokeHostAsync<string[]>('demo.asyncStore', 'keys'));
}

// 未注册的名字：Dart 侧立即回错误载荷，Promise 马上 reject，不悬挂。
function missing(): void {
  void run('未注册模块', () => invokeHostAsync('demo.asyncStore.missing', 'get', 'name'));
}
</script>

<template>
  <view>
    <Panel title="这一页在干什么" desc="宿主模块 demo.asyncStore · 每次应答延迟 400ms">
      <text class="body">
        invokeHostAsync 把 fetch 的通道范式推广到所有宿主模块：同步发起，
        Dart 的 Future 结束后 dispatchEvent 回结果。← 是成功，× 是
        reject——两个方向都不会静默。
      </text>
    </Panel>

    <Panel title="试一试" desc="App 走真通道；web 端无宿主，任何按钮都会走出 reject 路径">
      <view class="row">
        <button size="mini" type="primary" :disabled="busy" @tap="write">写入 ×3</button>
        <button size="mini" :disabled="busy" @tap="read">读取</button>
        <button size="mini" :disabled="busy" @tap="keys">列 key</button>
        <button size="mini" :disabled="busy" @tap="missing">未注册模块</button>
      </view>
      <text class="hint">
        「写入 ×3」的耗时接近 400ms 而不是 1200ms：三个调用是并发的，各自的
        callId 各自 settle。
      </text>
    </Panel>

    <Panel title="时间线" desc="一次会话的发起与应答">
      <text v-for="(line, i) in lines" :key="`${i}-${line}`" class="line">{{ line }}</text>
      <text v-if="lines.length === 0" class="hint">还没有调用。</text>
    </Panel>
  </view>
</template>

<style scoped>
.body {
  font-size: 14px;
  color: var(--fjs-text);
  line-height: 20px;
}
.line {
  font-size: 12px;
  color: var(--fjs-muted);
  line-height: 18px;
}
.hint {
  font-size: 12px;
  color: var(--fjs-faint);
  line-height: 18px;
}
.row {
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
