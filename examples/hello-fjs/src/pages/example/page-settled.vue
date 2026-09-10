<route>
{"title": "转场与重活", "group": "交互演示", "desc": "onPageSettled：把首屏重活挪到转场之后"}
</route>

<script setup lang="ts">
// onPageSettled 的演示页。
//
// 页面刚被 push 进来的那几百毫秒，正是 Navigator（web 上是 <Transition>）在跑
// 转场动画。JS 跑在 UI 线程上，这时候干一段几十上百毫秒的同步活，转场就会
// 肉眼可见地卡一下。onPageSettled 就是「等这一页的转场跑完再说」。
//
// 这一页故意阻塞 BLOCK_MS 毫秒当作「重活」，用 ?mode= 决定什么时候干：
//   ?mode=settled（默认）等转场结束 —— 转场顺，图表/内容晚出现
//   ?mode=now                 立刻干     —— 内容早，但转场当场卡住
// 两个按钮都是 push 到自己，所以能反复来回对比同一段动画。
import { onMounted, onUnmounted, ref } from 'vue';
import { onPageSettled, useRoute, useRouter } from 'fjs/router';
import Panel from '@/components/Panel.vue';

/** 「重活」的时长。挑得比一次转场（Android 默认约 300ms）短一点，这样
 *  mode=now 是「卡一下」而不是「整段动画没了」，对比更清楚。 */
const BLOCK_MS = 200;

const route = useRoute();
const router = useRouter();
const mode = (route.query.mode as string) === 'now' ? 'now' : 'settled';

const t0 = Date.now();
const lines = ref<string[]>([]);
function log(text: string): void {
  lines.value.push(`t=+${String(Date.now() - t0).padStart(4)}ms  ${text}`);
}

/** 一段真的会占住 UI 线程的同步计算——不是 setTimeout，那不占帧。 */
function heavyWork(): void {
  log(`重活开始（同步阻塞 ${BLOCK_MS}ms）`);
  const until = Date.now() + BLOCK_MS;
  let n = 0;
  while (Date.now() < until) n += Math.sqrt(n + 1);
  log(`重活结束（校验值 ${n.toFixed(0)}）`);
}

log('setup()');

onMounted(() => {
  log('onMounted()');
  if (mode === 'now') heavyWork();
});

// 一次性、永远异步；没有转场的页面（初始页、tab 切换、transition: false）
// 立即算 settled，所以这个回调在那些情况下也一定会跑。
onPageSettled(() => {
  log('onPageSettled() 触发 —— 转场已结束');
  if (mode === 'settled') heavyWork();
});

// 「离场动画结束」在两端都没有单独的钩子，因为不需要：路由把页面拆掉本来就
// 排在离场动画之后（App 是 route.dispose() → navPop，web 是 <Transition> 的
// onAfterLeave → KeepAlive 丢弃），所以 onUnmounted 就是那个时机。
onUnmounted(() => {
  console.log('[page-settled] onUnmounted —— 离场动画已经跑完了');
});

function again(next: 'settled' | 'now'): void {
  void router.push({ path: '/example/page-settled', query: { mode: next } });
}
</script>

<template>
  <view>
    <Panel
      title="这一页在干什么"
      :desc="`当前 mode=${mode} · 重活 ${BLOCK_MS}ms`"
    >
      <text class="body">
        {{
          mode === 'settled'
            ? '重活等 onPageSettled 之后才干：进来的转场是顺的，代价是内容晚一个转场时长才出现。'
            : '重活在 onMounted 里立刻干：内容出现得早，但你刚才看到的转场动画卡了一下。'
        }}
      </text>
    </Panel>

    <Panel title="时间线" desc="t=0 是 setup() 执行的那一刻">
      <text v-for="line in lines" :key="line" class="line">{{ line }}</text>
    </Panel>

    <Panel title="来回对比" desc="都是 push 到本页，返回键退回上一层">
      <view class="row">
        <button size="mini" type="primary" @tap="again('settled')">
          等转场（顺）
        </button>
        <button size="mini" @tap="again('now')">立刻干（卡）</button>
      </view>
      <text class="hint">
        盯着标题栏和页面滑入的那一下：mode=now 会在动画刚起步时定住约
        {{ BLOCK_MS }}ms。
      </text>
    </Panel>

    <Panel title="canvas 不用写这个" desc="它有现成的开关">
      <text class="body">
        图表页在 @resize 里建图，给 &lt;canvas&gt; 加 defer-resize 就行，
        首次 @resize 会自动等到转场之后。/example/f2 用的就是它。
      </text>
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
.row {
  flex-direction: row;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: var(--fjs-faint);
  line-height: 18px;
  margin-top: 8px;
}
</style>
