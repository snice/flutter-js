<route>
{"title": "F2 图表", "group": "画布演示", "desc": "canvas + F2，一份源码两端出图"}
</route>

<script setup lang="ts">
// 和 echarts.vue 同一套接法：fjs 的 <canvas> 给 2D 上下文，库自己画。
// 不用 @antv/f-vue（那层要 DOM canvas）。图表树用 createElement 拼，不配 JSX。
import { onBeforeUnmount, ref } from 'vue';
import { Axis, Chart, Interval, Legend, Line, Tooltip, createElement } from '@antv/f2';
import type { FjsTouchEvent } from 'fjs';
import Panel from '@/components/Panel.vue';
import { createF2Chart, type FjsF2Chart } from '@/f2/adapter';

/** F2 的 createElement 类型认不进带泛型的 Chart / Interval 构造器（库自己的
 *  ElementType 太窄），运行时没问题。 */
function el(type: unknown, props: object | null, ...children: unknown[]) {
  return createElement(type as never, props, ...(children as never[]));
}

const lineEl = ref();
const barEl = ref();
const pieEl = ref();

let lineChart: FjsF2Chart | null = null;
let barChart: FjsF2Chart | null = null;
let pieChart: FjsF2Chart | null = null;

const lineData = [
  { date: '一', value: 60 },
  { date: '二', value: 140 },
  { date: '三', value: 90 },
  { date: '四', value: 40 },
  { date: '五', value: 120 },
  { date: '六', value: 70 },
];

const barData = [
  { genre: '体育', sold: 275 },
  { genre: '策略', sold: 115 },
  { genre: '动作', sold: 120 },
  { genre: '射击', sold: 350 },
  { genre: '其他', sold: 150 },
];

const pieData = [
  { name: '搜索', percent: 1048, a: '1' },
  { name: '直达', percent: 735, a: '1' },
  { name: '推荐', percent: 580, a: '1' },
  { name: '广告', percent: 484, a: '1' },
];

function mountLine(): void {
  if (!lineChart) {
    lineChart = createF2Chart(
      lineEl.value,
      el(
        Chart,
        { data: lineData },
        el(Axis, { field: 'date' }),
        el(Axis, { field: 'value' }),
        el(Line, { x: 'date', y: 'value', color: '#007aff' }),
        el(Tooltip, {}),
      ),
    );
  }
  lineChart?.resize();
}

function mountBar(): void {
  if (!barChart) {
    barChart = createF2Chart(
      barEl.value,
      el(
        Chart,
        { data: barData },
        el(Axis, { field: 'genre' }),
        el(Axis, { field: 'sold' }),
        el(Interval, { x: 'genre', y: 'sold', color: 'genre' }),
        el(Tooltip, {}),
      ),
    );
  }
  barChart?.resize();
}

function mountPie(): void {
  if (!pieChart) {
    pieChart = createF2Chart(
      pieEl.value,
      el(
        Chart,
        {
          data: pieData,
          coord: { type: 'polar', transposed: true, innerRadius: 0.5 },
        },
        el(Interval, {
          x: 'a',
          y: 'percent',
          adjust: 'stack',
          color: 'name',
          // 点扇区高亮，不用 Tooltip：F2 5.14 在「极坐标 + stack」下
          // getSnapRecords 走 _getYSnapRecords，返回的 record 没带
          // xField/yField，Tooltip 拿 chart.getScale(undefined) 得到 null，
          // 一点就 `Cannot read properties of null (reading 'getText')`。
          // 两端都这样，和 fjs 无关（同样的代码接真 <canvas> 也崩）。
          selection: {
            triggerOn: 'click',
            type: 'single',
            cancelable: true,
            // 默认不改样式，点了看不出来；把没选中的扇区调淡
            unSelectedStyle: { fillOpacity: 0.3 },
          },
        }),
        el(Legend, { position: 'right' }),
      ),
    );
  }
  pieChart?.resize();
}

onBeforeUnmount(() => {
  lineChart?.destroy();
  barChart?.destroy();
  pieChart?.destroy();
});

function onTouch(
  which: 'line' | 'bar' | 'pie',
  type: 'start' | 'move' | 'end',
  event: FjsTouchEvent,
): void {
  const chart = which === 'line' ? lineChart : which === 'bar' ? barChart : pieChart;
  chart?.handleTouch(type, event);
}
</script>

<template>
  <view>
    <Panel title="折线" desc="官方基础折线 · 按住出 tooltip，拖动跟手（F2 默认 press 触发）">
      <canvas
        ref="lineEl"
        class="chart"
        @resize="mountLine"
        @touchstart="(e: FjsTouchEvent) => onTouch('line', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('line', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('line', 'end', e)"
      />
    </Panel>

    <Panel title="柱状" desc="官方基础柱状 · 按住出 tooltip，按品类上色">
      <canvas
        ref="barEl"
        class="chart"
        @resize="mountBar"
        @touchstart="(e: FjsTouchEvent) => onTouch('bar', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('bar', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('bar', 'end', e)"
      />
    </Panel>

    <Panel title="饼图" desc="极坐标 + stack，点扇区高亮，Legend 画在画布里">
      <canvas
        ref="pieEl"
        class="chart"
        @resize="mountPie"
        @touchstart="(e: FjsTouchEvent) => onTouch('pie', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('pie', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('pie', 'end', e)"
      />
    </Panel>
  </view>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 240px;
  touch-action: none;
}
</style>
