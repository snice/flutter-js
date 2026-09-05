# Spec: canvas 组件与 2D 上下文

- **ID**: 019-canvas
- **状态**: done
- **日期**: 2026-09-05

## 1. 要解决什么

fjs 现在没有任何**逐像素/自由绘制**的能力。标签全集（`tags.json` 25 个）都是
盒模型控件，页面能做的只有「摆盒子 + 摆文字 + 摆图」。凡是画面本身由数据算出来的
场景都做不了：

- **图表**——柱状、折线、饼图。这是最常被问的一类，现成的生态（ECharts / Chart.js）
  全部建立在 `canvas.getContext('2d')` 上；
- 签名板、涂鸦、刮刮卡、圆形进度、二维码、图片裁剪框、K 线。

绕不过去：用 `view` 拼柱状图勉强能做，折线和饼图不行；用 `image` 加载服务端渲染的
图片要多一次网络往返，还失去交互。`web-view` 里套一张 H5 图表页倒是能显示，但它是
一个独立的浏览器实例——数据要跨 `postMessage` 字符串桥，滚动/手势和外面打架
（specs/016），首帧慢，样式和应用主题对不上。

同时这是**唯一一处 web 的标准 API 已经定死、我们只能对标而不能重新设计**的能力：
页面里写的是 `ctx.fillRect(...)`，那么 App 端就必须提供**同名同签名**的
`CanvasRenderingContext2D`，否则 ECharts 这类库一行都跑不起来。

参考：MDN `CanvasRenderingContext2D`、微信小程序 `canvas type="2d"`（同样是「对标
web API」的做法）。

## 2. 不做什么（Non-goals）

- **不实现 WebGL**。`getContext('webgl')` / `'webgl2'` 本期返回 `null` 并
  `warnOnce`（宪法 V），但 `getContext` 必须是**可扩展的注册表**：上下文类型 →
  工厂，`'2d'` 只是第一个注册进去的实现，之后 `@ufjs/webgl` 这样的模块能把
  `'webgl'` 注册进来而不改 `canvas` 标签本身。架构位留出来，实现不做。
- **不做 OffscreenCanvas / Worker 内绘制**。
- **不做 DOM**。`canvas` 不会变成 `HTMLCanvasElement`：没有 `style` 对象、没有
  `getBoundingClientRect`、没有 `appendChild`。ECharts 需要的那几个属性由适配层
  （§3.4）喂给它，不是靠伪装 DOM。
- **不实现 `filter`**（CSS 滤镜字符串）、`ctx.drawFocusIfNeeded`、
  `ellipse` 之外的 Path2D 构造语法糖（`Path2D(svgString)`）、`isPointInStroke`。
- **不做 SVG 渲染器**，ECharts 只跑 canvas renderer。
- 不改 `invokeHost` 的 v1 ABI，不新开 C ABI（宪法 II）。

## 3. 用户可见的行为

### 3.1 标签与上下文

> **实现期修订**：`canvas` 最终是一个**包装组件**（`view` + 绘制面
> `inner-canvas` + overlay 插槽），不是裸元素标签。页面写法不变，多了一个放
> tooltip / 图例的地方。理由见 plan §3.10。

`canvas` 进 `tags.json`（内置标签，不是模块）：绘图要 Flutter 的
`CustomPaint`，JS 侧包不出来，属于宪法 VII 里「需要 Flutter 渲染能力」的例外。

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';

const cv = ref();

onMounted(() => {
  const ctx = cv.value.getContext('2d');
  ctx.fillStyle = '#07c160';
  ctx.fillRect(20, 20, 120, 60);
  ctx.font = '14px sans-serif';
  ctx.fillText('hello canvas', 20, 110);
});
</script>

<template>
  <canvas ref="cv" class="cv" />
</template>

<style scoped>
.cv { width: 300px; height: 200px; }
</style>
```

- **同一份源码两端都跑**：web 上 `cv.value` 背后是真的 `<canvas>`，
  App 上是 fjs 的 canvas 元素。两端 `getContext('2d')` 都返回一个
  实现同一批方法/属性的对象（web 上就是浏览器原生的那个）。
- **尺寸由样式决定**，不需要写 `width` / `height` 属性。位图分辨率
  = 逻辑尺寸 × devicePixelRatio，由宿主处理；页面坐标系永远是**逻辑像素**，
  不用自己 `ctx.scale(dpr, dpr)`（这一条和 web 的 `<canvas width>` 语义不同，
  是刻意的差异，登记在 §4）。
- 写了 `width` / `height` 属性时按 web 语义处理（位图尺寸），登记在兼容表。

### 3.2 绘制何时上屏

`ctx.*` 调用是**即时语义**（和 web 一致，页面不需要调 `draw()` / `commit()`）。
实现上按帧聚合：一轮同步代码里的绘制命令攒成一个显示列表，在同一个微任务
flush 里随 UI 帧过去（和 element API 的 op 帧同一条路）。**页面观察不到差异**，
除非它在同一帧里画完立刻读回像素——那属于 §7 待澄清的 `getImageData`。

### 3.3 兼容列表

新增 `docs/canvas-compat.md`，形状照 `docs/css-compat.md`：
✅ 两端一致 / ⚠️ 有差异 / ❌ 不支持（调用会 `warnOnce`，不静默）。
它是 canvas 支持范围的**单一事实来源**，第一批覆盖：

| 组 | 目标（本期做到 ✅） |
|---|---|
| 状态 | `save` / `restore` / `scale` / `rotate` / `translate` / `transform` / `setTransform` / `resetTransform` / `globalAlpha` / `globalCompositeOperation`(常用子集) |
| 样式 | `fillStyle` / `strokeStyle`（色值 + 渐变 + 图案）/ `lineWidth` / `lineCap` / `lineJoin` / `miterLimit` / `setLineDash` / `getLineDash` / `lineDashOffset` |
| 矩形 | `clearRect` / `fillRect` / `strokeRect` |
| 路径 | `beginPath` / `closePath` / `moveTo` / `lineTo` / `bezierCurveTo` / `quadraticCurveTo` / `arc` / `arcTo` / `ellipse` / `rect` / `fill`(nonzero+evenodd) / `stroke` / `clip` / `isPointInPath` |
| 文本 | `font` / `textAlign` / `textBaseline` / `fillText` / `strokeText` / `measureText`（至少 `width`，理想含 `actualBoundingBox*`）|
| 渐变/图案 | `createLinearGradient` / `createRadialGradient` / `addColorStop` / `createPattern` |
| 阴影 | `shadowColor` / `shadowBlur` / `shadowOffsetX` / `shadowOffsetY` |
| 图片 | `drawImage`（3/5/9 参）|
| 类型 | `Path2D`（编程构造，非 SVG 串）、`DOMMatrix` 的最小面（`getTransform`）|

像素读回只做 `toDataURL`（整图导出，低频一次性，base64 过 ABI）。

❌ 一栏至少要显式登记：`getImageData` / `putImageData`、`filter`、
`getContext('webgl')`、`OffscreenCanvas`、`ImageBitmap`、`ctx.canvas.toBlob`。

### 3.4 ECharts 跑通

验收用的真实案例：`examples/hello-fjs/src/pages/example/echarts.vue`，
**一份源码在 web 和 Android/iOS 上画出同一张图**，至少包含折线 + 柱状 + 饼图
三个 series 类型和一次 `setOption` 更新。

ECharts 5 官方就有非浏览器接入点，不需要伪装 DOM：

```ts
import * as echarts from 'echarts/core';
// createCanvas 返回我们的 canvas，measureText 走 §3.3 的 measureText
echarts.setPlatformAPI({ createCanvas, measureText, loadImage });
const chart = echarts.init(canvasLike, undefined, { width, height, devicePixelRatio });
```

交互（点击柱子出 tooltip）靠把 `@touchstart` / `@touchmove` / `@touchend`
转成 zrender 的 `mousedown` / `mousemove` / `mouseup` 派进
`chart.getZr().handler.dispatch(...)`——这是小程序适配器的既有做法。

适配层写在哪（示例内 / 新 npm 包 `@ufjs/echarts`）见 §7。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 标签 | `canvas` → `CustomPaint`（显示列表回放） | `<canvas>` 真元素 |
| 上下文 | JS 侧 `CanvasRenderingContext2D` 实现，命令编码后交给 Dart 回放 | 浏览器原生 context，直接透传 |
| 坐标系 | 逻辑像素，DPR 由宿主放大 | 逻辑像素，宿主同样按 DPR 设 backing store |
| `measureText` | 同步 `invokeHost`（Dart `TextPainter`）| 浏览器原生 |
| 事件 | 复用现有 touch（15-18），载荷仍是字符串 | 同 |
| 已知差异 | 见下 | |

**已知差异（要写进 `docs/canvas-compat.md` 和 `docs/web.md`）**：

1. **字体度量不可能逐像素相同**。Flutter 用系统字体经 `TextPainter` 量，浏览器
   用自己的排版引擎；`measureText().width` 会有亚像素级差别，图表的文字位置因此
   可能差 1px 内。这是物理事实，不是 bug，不做「像素级一致」的验收。
2. **`font` 字符串的解析子集**：只保证 `[style] [weight] <size>px [family]`
   这一形状；`font: caption` 之类的系统关键字不支持。
3. **`globalCompositeOperation`** 只覆盖 Flutter `BlendMode` 有对应的那些，其余
   `warnOnce` 后按 `source-over` 画。
4. 未实现的 API 在两端行为一致：**Flutter 侧告警并跳过**，web 侧是浏览器原生
   （即 web 上可能"能用"）。兼容表里这类必须标 ⚠️，否则页面在 web 上跑通、
   到 App 上才发现少东西。

## 5. 契约变更（宪法 II）

- [x] **UI op 协议**（`fjs-runtime/src/ui/ops.ts` + `flutter_fjs/lib/src/ui_ops.dart`
      + `native/tools/fjsrun.cpp` 的 dump）：新增一个「canvas 显示列表」op。
      理由：一帧图表是几千条绘制命令，走 `setProps` 的 JSON 会把每次
      `setOption` 变成一次大字符串序列化 + 解析，正是宪法 III 要躲的那类开销。
      具体编码在 `/plan` 定；`__fjsHost.uiOpsVersion` 要跟着 +1，老宿主降级路径
      要写明（建议：告警 + 不绘制，不做 JSON 回落）。
- [x] **natives 表**：不新增 C ABI，但会新增 host 模块名（`invokeHost('canvas.*')`），
      至少 `measureText`。`native-global.d.ts` 不变，Dart 侧 `registry/host.dart` 加注册。
- [ ] 事件类型（`element.ts` + `fjs.h`）——复用 touch，不新增。

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm test` 通过；新增的 2D 上下文有单测
   （命令编码 + 状态栈 + `font` 解析），`pnpm test` 里能看到。
2. `packages/flutter_fjs` 侧有 widget 测试覆盖显示列表回放；**不是 `No tests ran`**
   （AGENTS.md §3 的坑）。
3. `examples/hello-fjs/src/pages/comp/canvas.vue`（组件画廊页）在
   `pnpm --filter hello-fjs run dev:web` 与 `fjs run android` 上画出同样的内容：
   矩形/路径/文本/渐变/阴影/`drawImage`/裁剪各一块。
4. `examples/hello-fjs/src/pages/example/echarts.vue` 在两端都渲染出折线+柱状+饼图，
   点击/拖动能出 tooltip，`setOption` 更新后画面跟着变。
5. `docs/canvas-compat.md` 存在，`docs/ui-api.md` 的标签表里有 `canvas` 行，
   `docs/roadmap.md` 对应条目打勾（宪法 VIII）。
6. `getContext('webgl')` 返回 `null` 且控制台恰好一条 `[fjs]` 告警；
   `getContext('2d')` 二次调用返回**同一个**对象（web 语义）。
7. 性能：ECharts 页面在 Android 真机上 `setOption` 一次不掉帧到卡顿可感
   （具体阈值 `/plan` 里定，参照 `docs/performance.md` 的量法）。

## 7. 待澄清

已由用户拍板，无遗留问题：

1. **像素读回**：本期只做 `toDataURL`；`getImageData` / `putImageData` 进兼容表 ❌
   + roadmap。
2. **ECharts 适配层**：先写在 `examples/hello-fjs` 里当示例代码，形状稳定后再考虑
   抽成 `@ufjs/echarts`。本 spec 只承诺前者。
3. **echarts 依赖**：装在 `hello-fjs`；`demo` 保持零业务依赖。
4. **老宿主降级**（`uiOpsVersion` 不够）：canvas 区域空白 + 恰好一条 `[fjs]` 告警，
   页面其余部分照常，不做 JSON 回落（宪法 V）。
5. **`@ready` 事件**：不新增。首帧命令在 JS 侧排队，Flutter 侧布局尺寸确定后回放，
   对页面不可见。

   **实现期修订（2026-09-05）**：这一条只覆盖了「画绝对坐标」的情况，实机跑
   `/comp/canvas` 才暴露：**按尺寸画的页面在 App 上全画歪了**——`onMounted` 时
   `canvas.width/height` 还是 0（尺寸要等宿主布局），渐变块只画出一条 20px 的
   竖条，裁剪块基本空白，坐标系块直接显示「盒子 0 x 0」。命令排队解决的是「画
   了但还没尺寸」，解决不了「页面需要读尺寸才知道画什么」。
   所以**新增 `@resize` 事件**（复用 canvas 子系统的号 30，载荷
   `{"width":n,"height":n}`），两端都派、载荷相同，页面把首绘写在它里面。
   这比 `@ready` 更实用：尺寸变化也要重画，一个事件覆盖两件事。
