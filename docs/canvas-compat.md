# Canvas 兼容清单

> 第二层第 4 篇。这是 `<canvas>` **支持范围的单一事实来源**：加了新能力，先改这张表。
>
> fjs 的 canvas 两端底子不同：web 侧是浏览器原生 `CanvasRenderingContext2D`，
> App 侧是 JS 实现的同名状态机
> （[`canvas/context-2d.ts`](../packages/fjs-runtime/src/canvas/context-2d.ts)）
> 把命令编码成显示列表，交给 Flutter 的 `CustomPaint` 回放
> （[`canvas/replay.dart`](../packages/flutter_fjs/lib/src/canvas/replay.dart)）。
> **所以这张表的本质是「Flutter 侧能到哪」**，和
> [css-compat.md](css-compat.md) 一样。
>
> 类型层面还有一道保险：页面拿到的 context 类型是
> [`canvas/types.ts`](../packages/fjs-runtime/src/canvas/types.ts) 里的
> `FjsCanvasContext2D`，**不是** DOM 的那个。表里 ❌ 的东西在类型上就不存在，
> 写了会编译报错，而不是等到两端截图对比才发现。

图例：✅ 两端一致　⚠️ 支持但有差异　❌ 不支持（调用会 `warnOnce`，不静默）

## 0. canvas 是一个盒子

`<canvas>` 是一个**包装组件**：它渲染一个盒子，里面是真正的绘制面
（元素标签 `inner-canvas`，页面不直接写它），盒子里还留了一个插槽给
**画在画布上面、而不是画进位图里**的内容——tooltip、图例、加载遮罩、
可点区域。

```vue
<canvas ref="cv" class="chart" @resize="paint">
  <!-- 普通 fjs 节点：能用 CSS、能 v-if、能跟主题走 -->
  <view v-if="tip" class="tip" :style="tipStyle">
    <text>{{ tip.title }}</text>
  </view>
</canvas>
```

- 盒子本身就是**定位上下文**，插槽内容用 `position: absolute` + `left/top`
  贴到触点上（触点坐标见 §9）。
- 插槽内容**不是绝对定位**的话会参与盒子的 flex 布局，把画布挤小——通常不是
  你要的。
- 绘制面永远铺满盒子；页面只给 `<canvas>` 写尺寸。

为什么不把 tooltip 画进位图：那等于在画布里重写一遍文本排版、换行和主题，
而且它就脱离了页面平时用的一切（CSS、`v-if`、事件）。ECharts 自带的两种
tooltip 在这里也都不合用——HTML 模式要 DOM，`richText` 模式画进位图。

## 1. 拿到画布

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { FjsCanvasApi } from 'fjs';

const cv = ref<FjsCanvasApi>();

onMounted(() => {
  const ctx = cv.value?.getContext('2d');
  ctx?.fillRect(0, 0, 100, 50);
});
</script>

<template>
  <canvas ref="cv" class="cv" />
</template>

<style scoped>
.cv { width: 100%; height: 200px; }
</style>
```

| API | 支持 | 说明 |
|---|---|---|
| `getContext('2d')` | ✅ | 同一个 canvas 多次调用返回**同一个对象**（web 语义）|
| `getContext('webgl')` / `'webgl2'` | ⚠️ | **两端都返回 `null`** 并告警一次。web 上浏览器其实有 WebGL，这里仍然不给：否则页面在浏览器里跑通、到 App 上整块空白（宪法 I）。`getContext` 是一张注册表（[`context-registry.ts`](../packages/fjs-runtime/src/canvas/context-registry.ts)），将来 WebGL 由模块注册进来，`canvas` 标签本身不用改 |
| `canvas.width` / `height` | ⚠️ | **只读的逻辑像素布局尺寸**，不是位图尺寸，也不能赋值。宿主负责设备像素（Flutter 整场景按 dpr 光栅化，web 侧组件按 dpr 设 backing store 并预置 `setTransform`），**页面永远不用自己乘 devicePixelRatio** |
| `canvas.toDataURL(type?, quality?)` | ⚠️ | 返回 **Promise**（DOM 是同步的）：App 侧要等宿主画完一帧再读回来。只支持 `image/png` |
| `canvas.style` / `getBoundingClientRect` / `appendChild` | ❌ | canvas 不是 DOM 元素。尺寸用 CSS 类写在标签上 |

尺寸未知时（首帧、布局前）`width`/`height` 是 `0`；此时画的命令**不会丢**，
宿主拿到尺寸后照常回放。

**要按尺寸画就在 `@resize` 里画，不要在 `onMounted` 里画。** App 侧的 canvas
要等宿主布局完才有尺寸，`onMounted` 时读到的是 0；`@resize` 两端都派、载荷相同
（`{"width":n,"height":n}`，逻辑像素），所以同一份代码两端都对：

```vue
<canvas ref="cv" class="cv" @resize="paint" />
```

只画绝对坐标（不读 `width`/`height`）的页面不受影响，`onMounted` 里画也可以。

## 2. 状态与变换

| API | 支持 | 说明 |
|---|---|---|
| `save()` / `restore()` | ✅ | |
| `reset()` | ✅ | 清空画面并复位状态 |
| `scale` / `rotate` / `translate` / `transform` / `setTransform` / `resetTransform` | ✅ | |
| `getTransform()` | ⚠️ | 返回普通对象 `{a,b,c,d,e,f}`，不是 `DOMMatrix` |
| `globalAlpha` | ✅ | |
| `globalCompositeOperation` | ⚠️ | DOM 的 26 个值全部映射到 Flutter `BlendMode`。非 `source-over` 的模式在宿主侧包一层 `saveLayer`（`destination-out` 这类是对整层生效的），因此比 `source-over` 贵；不认识的值告警并保持原值 |
| `filter` | ❌ | 需要一整套 CSS 滤镜解析 + shader 链 |

## 3. 样式、线条

| API | 支持 | 说明 |
|---|---|---|
| `fillStyle` / `strokeStyle`（颜色串）| ⚠️ | 走和 CSS 引擎同一个颜色解析器：`#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / `hsl()` / `hsla()` / CSS 具名色 / `transparent`。**解析不出来的字符串在 App 侧按黑色画**（DOM 是「忽略这次赋值」），web 侧照浏览器；拼颜色串时注意这条差异 |
| `fillStyle` / `strokeStyle`（渐变、图案）| ✅ | 见下节 |
| `lineWidth` / `lineCap` / `lineJoin` / `miterLimit` | ✅ | |
| `setLineDash()` / `getLineDash()` / `lineDashOffset` | ⚠️ | 奇数长度按规范翻倍。Flutter 没有虚线画笔，宿主把路径按 metrics 切成实段——**极长路径上有成本**，密集虚线尤其 |
| `shadowColor` / `shadowBlur` / `shadowOffsetX` / `shadowOffsetY` | ⚠️ | 宿主画两遍（偏移+模糊一遍、正常一遍），模糊用 `MaskFilter.blur(σ = blur/2)`，**和浏览器不是逐像素相同**。shadowColor 全透明时不画阴影那一遍 |

## 4. 渐变与图案

| API | 支持 | 说明 |
|---|---|---|
| `createLinearGradient` / `createRadialGradient` | ✅ | 句柄式：定义只过一次桥，之后按 id 引用 |
| `gradient.addColorStop()` | ✅ | 只有一个 stop 时宿主自动补成两个（Flutter 要求 ≥2）|
| `createPattern(image, repetition)` | ⚠️ | `image` 必须是 `loadCanvasImage()` 得到的图片；四种 repetition 都支持 |
| `createConicGradient` | ❌ | |

## 5. 路径

| API | 支持 | 说明 |
|---|---|---|
| `beginPath` / `closePath` / `moveTo` / `lineTo` | ✅ | |
| `bezierCurveTo` / `quadraticCurveTo` | ✅ | |
| `arc` / `ellipse` | ✅ | 含 `counterclockwise`。整圈（`0` → `2π`）在宿主侧走 `addOval`——Skia 把首尾角相同的弧当成空路径，直接用 `arcTo` 会**什么都不画** |
| `arcTo` | ⚠️ | 映射到 Flutter 的 `arcToPoint`（SVG 弧）。圆角矩形这类常见用法一致，极端夹角可能有差 |
| `rect` | ✅ | |
| `fill()` / `fill('evenodd')` / `stroke()` / `clip()` | ✅ | 两种填充规则都支持；`clip` 之后的绘制被裁到路径内 |
| `Path2D`（`new Path2D()` / `addPath`）| ⚠️ | 支持编程构造；`new Path2D('M0 0 L10 10')` 的 **SVG 串不支持**（告警）|
| `roundRect()` | ❌ | 用 `arcTo` 拼圆角 |
| `isPointInPath` / `isPointInStroke` | ❌ | 命中测试请在页面侧对着自己画的几何做（图表库都自带）|

## 6. 文本

| API | 支持 | 说明 |
|---|---|---|
| `font` | ⚠️ | 只解析 `[style] [weight] <size>px [family]`。`caption` 这类系统关键字、`em`/`%` 单位、`font-stretch`、`size/line-height` 写法都不认——**告警并保留上一次可解析的字体**。字体列表只取第一个 |
| `fillText` / `strokeText` | ✅ | `maxWidth` 用横向压缩近似（DOM 是逐字压缩）。C0 控制字符（除 tab / newline）两端都丢掉：浏览器官方就不画，App 上否则会画出 `.notdef` 方块。插槽里的 `<text>`（`setText`）走同一条规则——ECharts 未命名 series 的内部 id 是 `series\0${index}`，不剥的话插槽 tooltip 会画出方块 |
| `textAlign` | ✅ | `start`/`end` 按 LTR 处理 |
| `textBaseline` | ✅ | 六个值都支持 |
| `measureText()` | ⚠️ | **两端不可能逐像素相同**：Flutter 用 `TextPainter` 量系统字体，浏览器用自己的排版引擎，亚像素级差异是物理事实，不是 bug。返回 `width` 与 `actualBoundingBox*` / `fontBoundingBox*`；App 侧是一次同步 host 调用，JS 侧带 LRU 缓存（同 font+text 只量一次）|
| `direction` | ❌ | |

## 7. 图片

| API | 支持 | 说明 |
|---|---|---|
| `loadCanvasImage(src, onload, onerror)`（`import { loadCanvasImage } from 'fjs'`）| ✅ | src 的三种写法和 `<image>` 完全一致（见 [ui-api.md](ui-api.md)），共用同一个解析函数。解码后的位图留在宿主，JS 只拿句柄 |
| `drawImage(image, ...)` | ✅ | 3 / 5 / 9 参三种形式 |
| `drawImage(<另一个 canvas>)` / `<video>` | ❌ | 只接受上面那种图片 |
| `new Image()` | ❌ | 没有 DOM，用 `loadCanvasImage()` |

图片还没解码完时 `drawImage` 什么都不画；解码完成的回调里重画即可。

## 8. 像素读回

| API | 支持 | 说明 |
|---|---|---|
| `canvas.toDataURL()` | ⚠️ | 整图导出，返回 Promise（见 §1）|
| `getImageData` / `putImageData` / `createImageData` | ❌ | 位图要整块跨界（v1 ABI 只过标量，base64 一帧图的成本远超绘制本身）。需要导出整图请用 `toDataURL` |
| `canvas.toBlob()` | ❌ | |
| `OffscreenCanvas` / `ImageBitmap` | ❌ | |

## 9. 事件

| 事件 | 载荷 | 说明 |
|---|---|---|
| `@resize` | `{"width":n,"height":n}` | 盒子布局完成或尺寸变化。两端都派；App 侧这是 canvas **第一次有尺寸**的时刻 |

其余用通用的触摸事件：`@touchstart` / `@touchmove` /
`@touchend` / `@touchcancel`（载荷见 [ui-api.md](ui-api.md)），
命中测试用 `touch.offsetX` / `offsetY`（相对 canvas 左上角的逻辑像素）——
`clientX` / `clientY` 是**页面**坐标，拿去画布上找点会差一整个页面的偏移。
`@tap` / `@longpress` 也可用。

给图表这类自己处理手势的 canvas 写上 `touch-action: none`，
否则外层 `scroll-view` 会把 `touchmove` 抢走。

## 10. 保留语义与性能

canvas 是**保留式**的：画完的东西留着，直到被清掉。两端的实现方式不同，
但页面观察到的行为一致：

| | Flutter | Web |
|---|---|---|
| 命令怎么过去 | 每帧只发新命令，宿主累积（op 10 显示列表）| 直接画在位图上 |
| 什么时候丢弃 | 覆盖整块画布的 `clearRect(0,0,w,h)` 或 `reset()` | 同左（位图被覆盖）|
| 尺寸变化 | **清空**画面 | **清空**画面（浏览器改 backing store 必清）|

两条实践：

1. **每帧重画就先 `clearRect(0, 0, canvas.width, canvas.height)`**。这既是
   web 的常规写法，也是宿主丢弃旧命令的信号；只清一部分不会触发丢弃。
   一直不清的页面，宿主累积到 8MB 命令时会告警一次。
2. **属性赋值是去重的**：`ctx.fillStyle = '#fff'` 连着写一千遍只过一条命令，
   所以图表库那种「每个图形前都设一遍样式」的写法没有额外成本。

## 11. ECharts

跑得通，接法见
[`examples/hello-fjs/src/echarts/adapter.ts`](../examples/hello-fjs/src/echarts/adapter.ts)。
三件事是必须的：

0. **不要给页面留一个「解析不出来的颜色」**：ECharts 的 legend 会用
   `transparent` 当背景色，早期版本这里解析失败回落成黑色，图例就变成两个黑块。
   `transparent` 现在是支持的；自定义主题里的颜色写法照上面那张表核对。
1. **`echarts.init(canvasLike, ...)`**：传一个 `{ width, height, getContext,
   addEventListener, removeEventListener }` 的普通对象，不要直接传 fjs 的
   canvas —— zrender 会往 `width`/`height` 上写，而 fjs 的这两个是只读的；
   两个 `EventListener` 空壳也是必需的，zrender 一上来就往画布根上挂 DOM 监听。
2. **`devicePixelRatio: 1`**：宿主已经处理了设备像素，再乘一次会画大一倍。
3. **`tooltip.renderMode: 'richText'`**：默认 tooltip 是一个 HTML `<div>`，
   没有 DOM 可挂。适配层已经统一改写，页面照常写 `tooltip: { trigger: 'axis' }`。

触摸要自己转发给 zrender（`chart.getZr().handler.dispatch('mousedown', {zrX,
zrY, ...})`），适配层的 `handleTouch()` 就是干这个的。

**离屏 canvas 不支持**：ECharts 少数特效路径会调 `createCanvas()`，适配层会
告警，那个功能画不出来。

## 12. 老宿主

canvas 走 op 协议第 3 版。宿主（`flutter_fjs`）太旧时 JS 侧
**告警一次并且不发送绘制命令**——canvas 区域空白，页面其余部分照常。
不做 JSON 回落（宪法 V：静默失效是 bug，两套编码路径的成本又远大于收益）。
