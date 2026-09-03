<route>
{"title": "主题切换压测", "scroll": false, "group": "交互演示", "desc": "改一个根节点的自定义属性，整树换色"}
</route>

<script setup lang="ts">
// 主题切换压测：这一页存在的理由是量，不是好看。
//
// 一次主题切换会让屏上每个节点都重算样式，所以它是这条管线里最重的常见操作。
// 页面上的三个数字对应三段成本：
//
//   JS      样式引擎重算 + op 编码，nowMs() 夹在改动和帧提交之间量出来
//   帧       这一次切换过桥的字节数，通过临时接管 op sink 统计
//   最慢帧   切换之后 30 帧里最长的一帧，requestAnimationFrame 采的
//
// 前两个是 JS 侧的账，第三个是 Flutter 侧的账（重建 + 布局 + 绘制）。两边
// 都要看：JS 再快，整棵树重建一样会掉帧。
//
// 「写法」那一栏对比的是两种写主题的方式。变量式改的是根节点的内联自定义
// 属性；class 式翻的是根节点的 class，这会让所有后代的 chainKey 失效、
// matchCache 整体落空。直觉上后者应该明显更贵——离线基准测下来两者一样
// （见 docs/performance.md），这一页是为了在真机上复核这个结论。
import { computed, nextTick, ref } from 'vue';
import { gc, hasNativeHost, nowMs, setOpSink } from 'fjs';
import { styleEngine } from 'fjs/vue';
import { dark, light, paletteVars, useTheme } from '../../theme';
import ThemeRows from '../../components/ThemeRows.vue';

const theme = useTheme();

const ROW_CHOICES = [200, 1000, 2000];
const rows = ref(200);

type Style = 'vars' | 'class';
const style = ref<Style>('vars');

// 行装在哪种容器里。两边的 JS 侧完全一样——样式引擎照样重算全部元素、帧字节
// 一个不差——差别整个在 Dart 侧：`scroll-view` 把每一行都 build / layout（离屏
// 的 paint 已经被裁掉，见 render/cull.dart），`list-view` 走 ListView.builder，
// 只落实视口里的那十几行。见 docs/performance.md。
const CONTAINERS = ['scroll-view', 'list-view'] as const;
const container = ref<(typeof CONTAINERS)[number]>('scroll-view');

// 列表是内联在这个组件里，还是放进一个不读主题的子组件。
// 两者过桥的字节数完全相同；差的是 Vue 自己重建并 diff 4000 个输出没变的
// vnode 的成本。
const isolated = ref(true);

const items = computed(() =>
  Array.from({ length: rows.value }, (_, i) => ({
    id: i,
    title: `第 ${i + 1} 行`,
    meta: `#${String(i + 1).padStart(4, '0')}`,
    badge: i % 7 === 0 ? 'NEW' : '',
  })),
);

// class 式：整份配色挂在页面根节点的一个 class 上，切换只改 class。
// 变量式：同一份配色作为内联自定义属性挂在同一个节点上。
const darkVars = paletteVars(dark);
const lightVars = paletteVars(light);
// The page root carries the tokens one way or the other: as inline custom
// properties in vars mode, via the `.theme-dark` class in class mode. Both
// arms also pay for Shell doing the same thing above them, which is what
// makes the two comparable.
//
// `undefined` rather than `{}` in class mode: an element carrying ANY inline
// style — even an empty one — is permanently excluded from the compute
// cache, so an empty object here would quietly make class mode look worse
// for a reason that has nothing to do with classes.
const localVars = computed(() =>
  style.value === 'class'
    ? undefined
    : theme.mode.value === 'dark'
      ? darkVars
      : lightVars,
);

// The engine's own counters, on screen rather than in the log: a release
// build on a real device has no dev server to relay through (`fjs run
// --release` bakes the bundle into assets and never sets FJS_DEV), so
// `fjs log` cannot see it. This is the only readout that works everywhere.
const engineBase = ref<string>('—');
/** 引擎计数 + 这一次空跑的分布。分开存是因为前者在 timeSwitch 里就写好了，
 * 后者要等六趟都跑完才知道——computed 把它们拼起来，省掉一次手动重刷。 */
const engineStats = computed(() =>
  engineBase.value + (jsSpread.value === '' ? '' : `\n${jsSpread.value}`),
);
const heapMb = ref<number | null>(null);
const heapObjects = ref<number | null>(null);

/** 上一次切换里空跑那几趟的分布，写在引擎那一行里。 */
const jsSpread = ref<string>('');
const jsMs = ref<number | null>(null);
const bridgeMs = ref<number | null>(null);
const frameBytes = ref<number | null>(null);
const worstFrameMs = ref<number | null>(null);
const sampling = ref(false);

/** 跑一次切换，返回耗时。`deliver` 为 false 时帧被丢掉，不过桥。 */
async function timeSwitch(deliver: boolean): Promise<number> {
  // Collect before timing, so a collection cannot land inside the window.
  // QuickJS collects wherever an allocation crosses its threshold, which on
  // a busy frame is in the middle of the work — on a device that decides the
  // number more than anything this page does. `heap` below says how much
  // there is to scan when it happens.
  const collected = gc();
  if (collected) {
    heapMb.value = +(collected.after / 1024 / 1024).toFixed(1);
    heapObjects.value = collected.objects;
  }
  let bytes = 0;
  const forward = setOpSink((frame) => {
    bytes += frame.length;
    if (deliver) forward(frame);
  });
  styleEngine.resetStats();
  const t0 = nowMs();
  theme.toggle();
  // nextTick 之后 Vue 的 patch、样式引擎的重算和 op flush 都已经跑完；
  // uiOps 是同步的，所以 deliver 为 true 时这里也包含了 Dart 侧的 applyFrame
  await nextTick();
  const dt = nowMs() - t0;
  // `flushMs` vs `markMs` is the split to read first: the recompute pass and
  // the subtree marking that schedules it are timed separately, and the
  // marking runs during Vue's patch, so anything wrapped around the flush
  // alone misses it. `computeMiss` is the second — it should be near zero.
  const st = styleEngine.stats;
  engineBase.value =
    `mark ${st.markMs.toFixed(0)}ms/${st.markVisited}  ` +
    `flush ${st.flushMs.toFixed(0)}ms/${st.recompute}  ` +
    `miss ${st.computeMiss}  applied ${st.applied}\n` +
    `${st.elements} elements  ${st.rules} rules` +
    (heapMb.value == null
      ? ''
      : `  ·  heap ${heapMb.value}MB / ${heapObjects.value} objects`);
  console.log('[style-stats]', JSON.stringify(st));
  setOpSink(forward);
  if (deliver) frameBytes.value = bytes;
  return dt;
}

/** 空跑的趟数。必须是偶数：每一趟都翻一次主题，成对才净效果为零。
 *
 * 为什么不是一趟：**这条路上的单次读数不可信**。同一份工作、计数器分毫不差，
 * 耗时能差好几倍——GC 落在窗口里的那一趟付全部账单。所以报 min（那一趟没有
 * 回收，描述的是代码），med/max 写进引擎那一行。`examples/bench` 的样式基准
 * 和 `examples/hello-js` 的压测屏是同一套方法。 */
const DRY_PASSES = 6;

async function toggle() {
  if (sampling.value) return;

  // 空跑：帧丢掉，量到的就是纯 JS（Vue patch + 样式重算 + 编码）。丢帧这一步
  // 必要，因为 uiOps 是同步调用——不拆的话 Dart 侧的 applyFrame 会被算进
  // 「JS」里，而两者在 debug 构建下差一个数量级。
  const dry: number[] = [];
  for (let i = 0; i < DRY_PASSES; i++) dry.push(await timeSwitch(false));
  // 上面这些趟里发出的 DEFINE_STYLE 原生侧没收到，所以要让 writer 忘掉它的
  // id 目录，下一帧重新发全量定义——否则真正那一趟会引用对端不认识的 id
  (globalThis as { __fjsForgetStyles?: () => void }).__fjsForgetStyles?.();

  const total = await timeSwitch(true);
  const sorted = dry.slice().sort((a, b) => a - b);
  jsSpread.value =
    `js ${sorted[0].toFixed(0)}/${sorted[sorted.length >> 1].toFixed(0)}/` +
    `${sorted[sorted.length - 1].toFixed(0)}ms min/med/max`;
  jsMs.value = +sorted[0].toFixed(2);
  // 桥 = 真跑那一趟减掉紧挨着它的那一趟空跑，不是减 min：两者要挨在一起，才
  // 不会把一次落在其中一边的回收算成过桥的钱
  bridgeMs.value = +Math.max(total - dry[dry.length - 1], 0).toFixed(2);

  sampleFrames();
}

/** 切换之后连采 30 帧，报最长的一帧——掉帧看的是最坏值，不是平均值。 */
function sampleFrames() {
  if (typeof requestAnimationFrame !== 'function') return;
  sampling.value = true;
  worstFrameMs.value = null;
  let worst = 0;
  let last = nowMs();
  let left = 30;
  const step = () => {
    const now = nowMs();
    const dt = now - last;
    last = now;
    if (dt > worst) worst = dt;
    if (--left > 0) {
      requestAnimationFrame(step);
      return;
    }
    worstFrameMs.value = +worst.toFixed(1);
    sampling.value = false;
  };
  requestAnimationFrame(step);
}

function resetReadouts() {
  jsMs.value = null;
  bridgeMs.value = null;
  frameBytes.value = null;
  worstFrameMs.value = null;
  jsSpread.value = '';
}

function setRows(n: number) {
  rows.value = n;
  resetReadouts();
}

// web 上没有桥，帧字节数这一格没有意义——写 0 会让人以为过桥是免费的
const kb = computed(() => {
  if (!hasNativeHost) return 'web 无桥';
  if (frameBytes.value == null) return '—';
  return (frameBytes.value / 1024).toFixed(1) + ' KB';
});
/** 16.7ms 是一帧的预算；超了就是肉眼可见的卡顿。 */
const janky = computed(() => (worstFrameMs.value ?? 0) > 17);
</script>

<template>
  <view
    class="page"
    :class="{ 'theme-dark': style === 'class' && theme.mode.value === 'dark' }"
    :style="localVars"
  >
    <view class="panel">
      <view class="row-controls">
        <text class="label">节点数</text>
        <view class="segs">
          <view
            v-for="n in ROW_CHOICES"
            :key="n"
            class="seg"
            :class="{ on: rows === n }"
            @tap="() => setRows(n)"
          >
            <text class="seg-text">{{ n * 4 }}</text>
          </view>
        </view>
      </view>

      <view class="row-controls">
        <text class="label">列表</text>
        <view class="segs">
          <view class="seg" :class="{ on: isolated }" @tap="() => (isolated = true)">
            <text class="seg-text">独立组件</text>
          </view>
          <view class="seg" :class="{ on: !isolated }" @tap="() => (isolated = false)">
            <text class="seg-text">内联</text>
          </view>
        </view>
      </view>

      <view class="row-controls">
        <text class="label">容器</text>
        <view class="segs">
          <view
            v-for="tag in CONTAINERS"
            :key="tag"
            class="seg"
            :class="{ on: container === tag }"
            @tap="() => { container = tag; resetReadouts(); }"
          >
            <text class="seg-text">{{ tag }}</text>
          </view>
        </view>
      </view>

      <view class="row-controls">
        <text class="label">写法</text>
        <view class="segs">
          <view class="seg" :class="{ on: style === 'vars' }" @tap="() => (style = 'vars')">
            <text class="seg-text">CSS 变量</text>
          </view>
          <view class="seg" :class="{ on: style === 'class' }" @tap="() => (style = 'class')">
            <text class="seg-text">根 class</text>
          </view>
        </view>
      </view>

      <view class="toggle" @tap="toggle">
        <text class="toggle-text">
          切到{{ theme.mode.value === 'dark' ? '亮色' : '暗色' }}
        </text>
      </view>

      <view class="stats">
        <view class="stat">
          <text class="stat-value">{{ kb }}</text>
          <text class="stat-label">帧大小</text>
        </view>
        <view class="stat">
          <text class="stat-value">{{ jsMs == null ? '—' : jsMs + ' ms' }}</text>
          <text class="stat-label">JS 重算 + 编码</text>
        </view>
        <view class="stat">
          <text class="stat-value">{{ bridgeMs == null ? '—' : bridgeMs + ' ms' }}</text>
          <text class="stat-label">过桥 + 应用</text>
        </view>
        <view class="stat">
          <text class="stat-value" :class="{ bad: janky }">
            {{ sampling ? '采样中' : worstFrameMs == null ? '—' : worstFrameMs + ' ms' }}
          </text>
          <text class="stat-label">最慢帧 / 30</text>
        </view>
      </view>

      <view class="engine">
        <text class="engine-text">{{ engineStats }}</text>
      </view>

      <text class="hint">
        16.7ms 是一帧的预算。最慢帧超过它，就是肉眼能看见的那一下卡顿。
        web 上样式由浏览器算、不过桥，所以只有 Flutter 端的数字反映这条管线。
        「列表」那一栏切成内联时，Vue 会连同 1000 行一起重渲染——过桥的字节
        一个不多，但 vnode 的 diff 是白花的。
      </text>
    </view>

    <!-- 同一份行，两种归属：子组件的 props 不随主题变，Vue 会整个跳过它；
         内联的这份则跟着页面一起重渲染 -->
    <ThemeRows v-if="isolated" :items="items" :container="container" />
    <component :is="container" v-else class="rows">
      <view v-for="item in items" :key="item.id" class="item">
        <text class="item-title">{{ item.title }}</text>
        <text class="item-meta">{{ item.meta }}</text>
        <view v-if="item.badge" class="badge">
          <text class="badge-text">{{ item.badge }}</text>
        </view>
      </view>
    </component>
  </view>
</template>

<style scoped>
/* class 式主题：整份配色写在这一个块里，切换只翻根节点的 class。
   变量式走的是根节点的内联 :style，两者产出完全一样的视觉。 */
.theme-dark {
  --fjs-primary: #0a84ff;
  --fjs-page: #000000;
  --fjs-card: #1c1c1e;
  --fjs-card-active: #2c2c2e;
  --fjs-border: #38383a;
  --fjs-title: #f2f2f7;
  --fjs-text: #d8d8dc;
  --fjs-muted: #8e8e93;
  --fjs-faint: #636366;
}

.page {
  /* 这一页自己管滚动（`<route>` 里 "scroll": false），所以外壳不再套一层
     scroll-view：面板钉在上面，行在自己的容器里滚。嵌套的滚动容器会让内层
     的视口和内容一样高，离屏裁剪就没有窗口可裁了。 */
  flex-grow: 1;
  background-color: var(--fjs-page);
}
.rows {
  flex-grow: 1;
  padding-bottom: 24px;
}

.panel {
  background-color: var(--fjs-card);
  border-radius: 10px;
  margin: 12px;
  padding: 16px;
  gap: 14px;
}
.row-controls {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.label {
  width: 48px;
  font-size: 13px;
  color: var(--fjs-muted);
}
.segs {
  flex-grow: 1;
  flex-direction: row;
  gap: 8px;
}
.seg {
  flex-grow: 1;
  align-items: center;
  padding: 7px 0;
  border-radius: 7px;
  border-color: var(--fjs-border);
  background-color: var(--fjs-page);
}
.seg.on {
  background-color: var(--fjs-primary);
  border-color: var(--fjs-primary);
}
.seg-text {
  font-size: 13px;
  color: var(--fjs-text);
}
.seg.on .seg-text {
  color: #ffffff;
}

.toggle {
  align-items: center;
  padding: 12px 0;
  border-radius: 8px;
  background-color: var(--fjs-primary);
}
.toggle:active {
  opacity: 0.7;
}
.toggle-text {
  font-size: 15px;
  font-weight: 600;
  color: #ffffff;
}

.stats {
  flex-direction: row;
  gap: 8px;
}
.stat {
  flex-grow: 1;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  border-radius: 8px;
  background-color: var(--fjs-page);
}
.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--fjs-title);
}
.stat-value.bad {
  color: var(--fjs-danger);
}
.stat-label {
  font-size: 11px;
  color: var(--fjs-muted);
}
.engine {
  padding: 8px 10px;
  border-radius: 6px;
  background-color: var(--fjs-page);
}
.engine-text {
  font-size: 10px;
  font-family: Menlo;
  color: var(--fjs-muted);
  line-height: 1.5;
}
.hint {
  font-size: 11px;
  color: var(--fjs-faint);
  line-height: 1.5;
}

.item {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0 12px 6px 12px;
  padding: 12px 16px;
  border-radius: 8px;
  border-color: var(--fjs-border);
  background-color: var(--fjs-card);
}
.item:active {
  background-color: var(--fjs-card-active);
}
.item-title {
  flex-grow: 1;
  font-size: 15px;
  color: var(--fjs-title);
}
.item-meta {
  font-size: 12px;
  color: var(--fjs-muted);
}
.badge {
  /* 行里没有 flex-grow 的子节点拿到的是无界宽度，而 view 默认是 column、
     交叉轴默认 stretch —— 两件事撞在一起就是「给文字一个无限宽」。显式写
     align-items 是这一类的通解，见 docs/css-compat.md 的 align-items 一行。 */
  align-items: center;
  border-radius: 4px;
  padding: 2px 6px;
  background-color: var(--fjs-primary);
}
.badge-text {
  font-size: 10px;
  color: #ffffff;
}
</style>
