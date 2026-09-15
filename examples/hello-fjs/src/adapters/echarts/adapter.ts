// 把 ECharts 接到 fjs 的 <canvas> 上。
//
// ECharts 本身不需要 DOM——zrender 的 canvas 画笔只要一个「像 canvas 的对象」：
// 有 getContext、有可写的 width/height、没有 nodeName（走 singleCanvas 路径）。
// 所以这里不伪装 DOM，只搭三样东西：
//
//   1. canvasLike —— 转发 getContext 到 fjs 的 canvas；width/height 是普通可写
//      属性，因为 zrender 会往上写（fjs 的 canvas.width 是宿主报的只读尺寸）。
//   2. setPlatformAPI —— measureText 走 fjs 的 context（App 上是 Flutter 的
//      TextPainter），loadImage 走 fjs 的图片句柄。
//   3. 触摸转发 —— fjs 的 @touchstart/@touchmove/@touchend 变成 zrender 的
//      mousedown/mousemove/mouseup，tooltip 和高亮才有反应。
//
// 设备像素：zrender 会自己 setTransform，把 fjs 在 web 侧预置的 dpr 缩放冲掉，
// 所以这里把 canvas 的 devicePixelRatio 交给 ECharts、让它自己乘——App 上这个
// 值是 1（Flutter 整场景按设备比例光栅化），web 上是浏览器的真实比例。
// 「谁管整块画布，谁负责设备像素」是这条契约的说法，见 docs/canvas-compat.md §11。
import * as echarts from 'echarts';
import type { EChartsType, EChartsOption } from 'echarts';
import { loadCanvasImage } from 'fjs';
import type { FjsCanvasApi, FjsCanvasContext2D } from 'fjs';
import type { FjsTouchEvent } from 'fjs';

let platformInstalled = false;

/** measureText 要在没有图表实例时也能用（ECharts 在布局早期就会问），所以留一
 *  个最近用过的 context 兜底。 */
let lastContext: FjsCanvasContext2D | null = null;

function installPlatform(): void {
  if (platformInstalled) return;
  platformInstalled = true;
  echarts.setPlatformAPI({
    // 离屏 canvas：本期不支持（spec §3.8）。ECharts 只在少数特效路径上要它，
    // 这里明确告警而不是给一个画不出东西的假对象。
    createCanvas: () => {
      console.warn(
        '[fjs] ECharts asked for an offscreen canvas; fjs only supports the ' +
          'main one. The feature that needs it will not render.',
      );
      return { getContext: () => null, width: 0, height: 0 } as never;
    },
    measureText: (text: string, font?: string) => {
      const ctx = lastContext;
      if (!ctx) return { width: text.length * 6 };
      if (font) ctx.font = font;
      return { width: ctx.measureText(text).width };
    },
    loadImage: (src: string, onload: () => void, onerror: () => void) => {
      const image = loadCanvasImage(src, () => onload.call(image), () => onerror.call(image));
      return image as never;
    },
  });
}

/** tooltip 一律走 richText 模式。
 *
 *  ECharts 默认的 tooltip 是一个 HTML `<div>`，它会 `document.createElement`
 *  再 `appendChild` 到图表根上——App 侧没有 DOM，web 侧我们给的根是一个
 *  canvas-like 普通对象，两端都会当场抛 TypeError。richText 模式则由 zrender
 *  把 tooltip 画进画布，走的全是我们已经实现的 2D 命令，两端一致。
 *
 *  放在适配层而不是让每个页面自己写：这是平台约束，不是页面的选择。想要
 *  HTML 那种「浮在画布上、能用 CSS」的 tooltip，用 <canvas> 的插槽自己画
 *  （docs/canvas-compat.md §0），两条路都通。 */
function normalizeOption(option: EChartsOption): EChartsOption {
  const tooltip = option.tooltip;
  if (!tooltip) return option;
  const withRichText = (t: object) => ({ renderMode: 'richText', ...t });
  return {
    ...option,
    tooltip: Array.isArray(tooltip)
      ? tooltip.map(withRichText)
      : withRichText(tooltip as object),
  } as EChartsOption;
}

export interface FjsChart {
  chart: EChartsType;
  /** 用这个而不是 chart.setOption：tooltip 要按上面那条规范化。 */
  setOption(option: EChartsOption): void;
  /** 把 fjs 的触摸事件喂给 zrender。 */
  handleTouch(type: 'start' | 'move' | 'end', event: FjsTouchEvent): void;
  resize(): void;
  dispose(): void;
}

/** 在一个 fjs canvas 上创建图表。canvas 的尺寸要先由宿主报回来（onMounted 之
 *  后），所以这个函数在拿不到尺寸时返回 null，调用方重试即可。 */
export function createChart(
  canvas: FjsCanvasApi | undefined,
  option: EChartsOption,
): FjsChart | null {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
  lastContext = ctx;
  installPlatform();

  let width = canvas.width;
  let height = canvas.height;
  // 没有 nodeName / style：zrender 走 singleCanvas，并跳过 DOM 专属的
  // disableUserSelect / innerHTML 那几步。
  // addEventListener / removeEventListener 是必需的空壳：zrender 的
  // HandlerDomProxy 一上来就往画布根上挂 DOM 监听（mousedown、wheel……），
  // 没有这两个方法会直接抛 TypeError。fjs 上真正的输入从 handleTouch() 进来，
  // 所以这里什么都不用做。
  const canvasLike = {
    width,
    height,
    getContext: (type: string) => (type === '2d' ? ctx : null),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const dpr = canvas.devicePixelRatio || 1;
  const chart = echarts.init(canvasLike as never, undefined, {
    width,
    height,
    devicePixelRatio: dpr,
  });
  // 动画开关：zrender 在 QuickJS 里检测不到 window/document/navigator，把环境
  // 判成 node，而 ECharts 的 isAnimationEnabled() 第一句就是
  // `if (env.node && !ssr) return false` —— 于是 App 上一切动画（切数据的过渡、
  // 点扇区的高亮）全被静默关掉。`ssr: true` 不是出路：zrender 在 ssr 模式下
  // 干脆不 start() 动画循环。
  //
  // 所以在 init **之后**再翻这个标志：init 阶段仍按 node 走，DOM 专属的两条
  // 路（HTML tooltip、DOM 事件代理）都不会被创建；之后这个标志只影响动画判断
  // 和 zrender 层面的 axisPointer 监听（挂在 zr 实例上，不碰 document）。
  echarts.env.node = false;
  chart.setOption(normalizeOption(option));

  type ZrEventName = Parameters<ReturnType<EChartsType['getZr']>['handler']['dispatch']>[0];

  function dispatch(name: ZrEventName, event: FjsTouchEvent): void {
    const touch = event.touches[0] ?? event.changedTouches[0];
    if (!touch) return;
    // offsetX/offsetY 是相对 canvas 左上角的坐标（clientX/Y 是页面坐标，拿它
    // 去命中测试会差一整个页面的偏移）——正是 zrender 要的 zrX/zrY
    chart.getZr().handler.dispatch(name, {
      zrX: touch.offsetX,
      zrY: touch.offsetY,
      which: 1,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
  }

  // zrender 的 click 是它的 DOM proxy 从真实 click 事件里来的，我们绕开了那层，
  // 所以要自己合成：手指没怎么移动就当一次点击。没有它，series 的 click（
  // tooltip、图例、下钻全靠它）永远不会触发。
  const CLICK_SLOP = 8;
  let downAt: { x: number; y: number } | null = null;

  return {
    chart,
    setOption(next) {
      chart.setOption(normalizeOption(next));
    },
    handleTouch(type, event) {
      const point = event.touches[0] ?? event.changedTouches[0];
      if (type === 'start' && point) {
        downAt = { x: point.offsetX, y: point.offsetY };
      }
      if (type === 'end') {
        // 抬手先补一次 mousemove 再 mouseup：zrender 是按「鼠标当前在哪」算命中
        // 的，只发 mouseup 的话它用的还是上一次移动的位置，轻点一下（没有
        // move）就什么都不选中，tooltip 不出来。
        dispatch('mousemove', event);
        dispatch('mouseup', event);
        if (
          downAt &&
          point &&
          Math.abs(point.offsetX - downAt.x) <= CLICK_SLOP &&
          Math.abs(point.offsetY - downAt.y) <= CLICK_SLOP
        ) {
          dispatch('click', event);
        }
        downAt = null;
        // 不发 mouseout：触摸屏上手指离开不等于「指针移出图表」，发了 tooltip
        // 会在抬手的同一瞬间消失。下一次点别处自然会更新。
        return;
      }
      dispatch(type === 'start' ? 'mousedown' : 'mousemove', event);
    },
    resize() {
      if (!canvas) return;
      if (canvas.width === width && canvas.height === height) return;
      width = canvas.width;
      height = canvas.height;
      canvasLike.width = width;
      canvasLike.height = height;
      chart.resize({ width, height });
    },
    dispose() {
      chart.dispose();
      if (lastContext === ctx) lastContext = null;
    },
  };
}
