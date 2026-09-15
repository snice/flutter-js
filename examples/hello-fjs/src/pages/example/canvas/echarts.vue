<route>
{"title": "ECharts 图表", "group": "画布演示", "desc": "canvas + ECharts，一份源码两端出图"}
</route>

<script setup lang="ts">
// 一份源码，两端画同一张图：ECharts 只要一个「像 canvas 的对象」，fjs 的
// <canvas> 两端都给得出来（src/echarts/adapter.ts 说明怎么接的）。
//
// 两种 tooltip 都演示：柱状图用 ECharts 自带的（适配层统一转成 richText，由
// zrender 画进画布）；饼图用 <canvas> 的插槽自己画（普通 view/text 节点，能用
// CSS、能跟主题走）。两条路两端都通，按需要选。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import type { FjsTouchEvent } from 'fjs';
import Panel from '@/components/Panel.vue';
import { createChart, type FjsChart } from '@/echarts/adapter';

const lineBar = ref();
const pie = ref();
const gauge = ref();

let lineBarChart: FjsChart | null = null;
let pieChart: FjsChart | null = null;
let gaugeChart: FjsChart | null = null;
let gaugeTimer: ReturnType<typeof setInterval> | null = null;

const quarter = ref(0);
const DATA = [
  { name: 'Q1', sales: [120, 200, 150, 80, 170, 110], visits: [60, 140, 90, 40, 120, 70] },
  { name: 'Q2', sales: [90, 240, 210, 130, 90, 160], visits: [50, 180, 160, 90, 60, 120] },
];

function lineBarOption(index: number): EChartsOption {
  const d = DATA[index];
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['销量', '访问'], top: 0 },
    grid: { left: 40, right: 12, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: ['一', '二', '三', '四', '五', '六'] },
    yAxis: { type: 'value' },
    series: [
      { name: '销量', type: 'bar', data: d.sales, itemStyle: { color: '#007aff' } },
      { name: '访问', type: 'line', data: d.visits, smooth: true, itemStyle: { color: '#07c160' } },
    ],
  };
}

const pieOption: EChartsOption = {
  series: [
    {
      // 不写 name 时 ECharts 内部 id 是 `series\0${index}`，插槽 tooltip 会
      // 把它当标签画出来——浏览器跳过 NUL，App 上曾经是方块。给一个能读的名字。
      name: '来源',
      type: 'pie',
      radius: ['40%', '70%'],
      data: [
        { value: 1048, name: '搜索' },
        { value: 735, name: '直达' },
        { value: 580, name: '推荐' },
        { value: 484, name: '广告' },
      ],
      label: { fontSize: 12 },
    },
  ],
};

/** 官方 gauge-stage（阶段速度仪表盘）。字号/线宽按 240px 高的手机画布收了一档，
 *  色停和指针语义与 https://echarts.apache.org/examples/zh/editor.html?c=gauge-stage
 *  同一份。 */
function gaugeOption(value: number): EChartsOption {
  return {
    series: [
      {
        type: 'gauge',
        radius: '72%',
        center: ['50%', '52%'],
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.3, '#67e0e3'],
              [0.7, '#37a2da'],
              [1, '#fd666d'],
            ],
          },
        },
        pointer: { itemStyle: { color: 'auto' } },
        axisTick: {
          distance: -14,
          length: 6,
          lineStyle: { color: '#ffffff', width: 1 },
        },
        splitLine: {
          distance: -14,
          length: 14,
          lineStyle: { color: '#ffffff', width: 2 },
        },
        axisLabel: { color: 'inherit', distance: 16, fontSize: 10 },
        detail: {
          valueAnimation: true,
          formatter: '{value} km/h',
          color: 'inherit',
          fontSize: 16,
          offsetCenter: [0, '76%'],
        },
        data: [{ value }],
      },
    ],
  };
}

// 在 @resize 里建图表：App 侧 canvas 要等宿主布局完才有尺寸（onMounted 时还是
// 0），两端都派这个事件，所以这一份代码两端通用。已经建好的就只做 resize。
function mountLineBar(): void {
  if (!lineBarChart) {
    lineBarChart = createChart(lineBar.value, lineBarOption(quarter.value));
  }
  lineBarChart?.resize();
}

function mountPie(): void {
  if (!pieChart) {
    pieChart = createChart(pie.value, pieOption);
    if (pieChart) bindTooltip(pieChart, 'pie');
  }
  pieChart?.resize();
}

function mountGauge(): void {
  if (!gaugeChart) {
    gaugeChart = createChart(gauge.value, gaugeOption(70));
    if (gaugeChart && !gaugeTimer) {
      gaugeTimer = setInterval(() => {
        gaugeChart?.setOption(gaugeOption(+(Math.random() * 100).toFixed(2)));
      }, 2000);
    }
  }
  gaugeChart?.resize();
}

onBeforeUnmount(() => {
  if (gaugeTimer) {
    clearInterval(gaugeTimer);
    gaugeTimer = null;
  }
  lineBarChart?.dispose();
  pieChart?.dispose();
  gaugeChart?.dispose();
});

watch(quarter, (index) => {
  lineBarChart?.setOption(lineBarOption(index));
});

// ---- 插槽 tooltip ----------------------------------------------------------
//
// ECharts 的 click 事件给的是数据，位置用触点自己记：两端的触点都带
// offsetX/offsetY（相对 canvas 左上角），正好是 overlay 要的坐标。
interface Tip {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

const pieTip = ref<Tip | null>(null);
/** 最后一次触点，click 回调里取位置用。 */
const lastPoint = { lineBar: { x: 0, y: 0 }, pie: { x: 0, y: 0 }, gauge: { x: 0, y: 0 } };

function tipStyle(tip: Tip | null, boxWidth: number) {
  if (!tip) return '';
  // 贴着触点，但不越出画布左右边
  const left = Math.min(Math.max(tip.x - 60, 4), Math.max(boxWidth - 124, 4));
  return `left: ${left}px; top: ${Math.max(tip.y - 64, 4)}px;`;
}

const pieTipStyle = computed(() => tipStyle(pieTip.value, pie.value?.width ?? 0));

/** ECharts 未命名 series 的内部 id 是 `series\0${index}`，不能当人读标签。 */
function seriesLabel(name?: string): string {
  if (!name || name.includes('\0')) return '数值';
  return name;
}

/** 插槽 tooltip：ECharts 的 click 给数据，位置用触点自己记。 */
function bindTooltip(chart: FjsChart, which: 'lineBar' | 'pie'): void {
  const target = pieTip;
  if (which !== 'pie') return;
  chart.chart.on('click', (params: { name?: string; seriesName?: string; value?: unknown }) => {
    const point = lastPoint[which];
    target.value = {
      x: point.x,
      y: point.y,
      title: String(params.name ?? ''),
      lines: [`${seriesLabel(params.seriesName)}：${String(params.value ?? '')}`],
    };
  });
  chart.chart.getZr().on('click', (event: { target?: unknown }) => {
    // 点空白处收起
    if (!event.target) target.value = null;
  });
}

/** 触摸转发。写成「事件里调用」而不是「返回一个函数」：模板里的
 *  `@touchstart="touch(chart, 'start')"` 是一个**调用表达式**，Vue 在事件发生
 *  时执行它、把返回值丢掉——返回处理函数的写法在这里是收不到事件的。 */
function onTouch(
  which: 'lineBar' | 'pie' | 'gauge',
  type: 'start' | 'move' | 'end',
  event: FjsTouchEvent,
): void {
  const chart = which === 'lineBar' ? lineBarChart : which === 'pie' ? pieChart : gaugeChart;
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (touch) lastPoint[which] = { x: touch.offsetX, y: touch.offsetY };
  chart?.handleTouch(type, event);
}
</script>

<template>
  <view>
    <Panel title="柱状 + 折线" :desc="`自带 tooltip（richText）· 当前 ${DATA[quarter].name}`">
      <canvas
        ref="lineBar"
        class="chart"
        @resize="mountLineBar"
        @touchstart="(e: FjsTouchEvent) => onTouch('lineBar', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('lineBar', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('lineBar', 'end', e)"
      />
      <view class="row">
        <button
          v-for="(d, i) in DATA"
          :key="d.name"
          size="mini"
          :type="quarter === i ? 'primary' : 'default'"
          @tap="quarter = i"
        >
          {{ d.name }}
        </button>
      </view>
    </Panel>

    <Panel title="阶段速度表" desc="官方 gauge-stage · 分段色轴 + 指针，约 2s 更新">
      <canvas
        ref="gauge"
        class="chart gauge"
        @resize="mountGauge"
        @touchstart="(e: FjsTouchEvent) => onTouch('gauge', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('gauge', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('gauge', 'end', e)"
      />
    </Panel>

    <Panel title="饼图" desc="插槽 tooltip：画在画布上面的普通节点">
      <canvas
        ref="pie"
        class="chart"
        @resize="mountPie"
        @touchstart="(e: FjsTouchEvent) => onTouch('pie', 'start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('pie', 'move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('pie', 'end', e)"
      >
        <view v-if="pieTip" class="tip" :style="pieTipStyle">
          <text class="tip-title">{{ pieTip.title }}</text>
          <text v-for="line in pieTip.lines" :key="line" class="tip-line">{{ line }}</text>
        </view>
      </canvas>
    </Panel>
  </view>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 240px;
  /* 图表自己处理手势，别让外层滚动把 touchmove 抢走 */
  touch-action: none;
}
.gauge {
  /* 表盘是圆的，盒子越扁左右白边越多：高度收一档，图形按 radius 占满 */
  height: 220px;
}
.tip {
  /* 相对 canvas 盒子定位：<canvas> 是包装组件，它就是定位上下文 */
  position: absolute;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: rgba(0, 0, 0, 0.75);
  gap: 2px;
}
.tip-title {
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
}
.tip-line {
  color: #dddddd;
  font-size: 12px;
}
.row {
  flex-direction: row;
  gap: 8px;
  margin-top: 8px;
}
</style>
