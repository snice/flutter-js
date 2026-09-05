# Plan: canvas 组件与 2D 上下文

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter：`flutter_fjs/lib/src/widgets/canvas.dart` + `lib/src/canvas/`（显示列表解码与回放）+ `node/node_adapters.dart` 注册 `canvas` 适配器；Web：`fjs-runtime/src/web/components/canvas.ts`（真 `<canvas>`）。**两端共用的那一半**是 `fjs-runtime/src/canvas/`：`getContext` 注册表、2D 状态机的取值归一化、`font` 解析、兼容性告警——web 侧也走这一层再落到浏览器 context，所以「哪些 API 支持」在两端是同一份判断（§3.7）。页面源码一行不改 |
| II 边界即契约 | 是（**三张全动**） | ① UI op：`fjs-runtime/src/ui/ops.ts` 加 `UiOp.Canvas = 10`，`flutter_fjs/lib/src/ui_ops.dart` 加 `UiOpCode.canvas` 与解码分支，`native/tools/fjsrun.cpp` 的 dump 与 skip 两个 switch 都加 case 10，`engine.dart:166` 的 `uiOpsVersion` 2 → 3（`fjsrun.cpp:173` 那行字面量同步）。② natives 表：**不加新 C ABI**，只加 host 模块名 `fjs.canvas.measureText` / `.loadImage` / `.toDataURL`，`native-global.d.ts` 不变，Dart 侧在 `engine.dart` 加 `_setupCanvasModule()`。③ 事件类型：新增 `FJS_EVENT_CANVAS = 30`（`element.ts` 的 `EventType` 不加——它不是页面能写的 `@` 事件，而是 canvas 子系统的回调，走 `element.ts` 已有的 `systemHandlers` 那条路，和 worker / nav 同形），`native/include/fjs.h` 与 `lib/src/ffi.dart` 同步。**这是对 spec §5 的一处修订**：spec 写「复用 touch，不新增事件」，那是指页面事件；异步的 `loadImage` / `toDataURL` 结果和 canvas 的尺寸回报没有别的路能走（宪法 II 的 fetch 范式就要求一个回派号）。 |
| III 同步单线程零序列化 | 是 | 绘制命令走**二进制显示列表**，和 op 帧同一次 `uiOps()` 调用过去，没有 JSON 桥；`measureText` 是同步 `invokeHost`（Dart `TextPainter` 当场量完返回），符合「宿主调用同步返回」；`loadImage` / `toDataURL` 是真异步，用 fetch 范式（JS 自分配 id → `invokeHost` 发起 → `dispatchEvent` 回结果），不阻塞 |
| IV 外观照 WeUI | 否 | canvas 里的像素全由页面自己画。宿主只保证盒子：无边框、无默认背景、无内边距，两端一致 |
| V 静默失效是 bug | 是 | 三处必须告警而不是静默：① `getContext('webgl')` / 未知类型 → `warnOnce` + 返回 `null`，**web 侧也一样**（否则 web 能跑、App 才炸，见 §3.7）；② 兼容表里 ❌ 的方法在 JS 侧就是一个 `warnOnce` 后的空实现；③ `uiOpsVersion < 3` 的老宿主 → `warnOnce`「宿主太旧，canvas 不绘制」，画面空白，页面其余部分照常（spec §7.4）。另外 Dart 解码遇到未知命令字节时抛 `UiOpException`（和现有 `unknown op code` 同款），不跳过 |
| VI 注释记录权衡 | 是 | 要写下的取舍：`canvas/display-list.ts` 顶部——为什么是新 op 而不是 `setProps` 的 JSON、为什么坐标用 f32、为什么字符串按帧内表去重；`canvas/retain.ts`（或回放侧）——**保留语义**为什么由「Dart 累积 + 全画布 `clearRect` 截断」实现而不是每帧全量重传（签名板那类增量绘制会退化成 O(n²)）；`canvas.dart`——阴影为什么是 `MaskFilter.blur` 近似、`globalCompositeOperation` 为什么要 `saveLayer`；`context-registry.ts`——为什么 `getContext` 是注册表（webgl 的扩展位） |
| VII JS 能包就不要下 Dart | 是 | **必须下 Dart 的只有回放**：把命令变成像素要 `CustomPaint` / `Canvas` / `TextPainter`，JS 侧没有这个能力，属于 VII 里「需要 Flutter 的渲染能力」。**其余全部留在 JS**：2D 状态机、`save`/`restore` 栈、属性去重、`Path2D`、`font` 字符串解析、渐变/图案句柄、命令编码、兼容性告警、`measureText` 缓存。判据按宪法 VII 的原话——这些信息 JS 已经有。account 记在框架无关的 `ui/element.ts`（`getContext` 从 element 上长出来，见 §3.1），不依赖 Vue |
| VIII 变更落到文档 | 是 | 新增 `docs/canvas-compat.md`（支持范围的单一事实来源）；`docs/ui-api.md` 标签表加 `canvas` 行；`docs/web.md` 加两端差异（字体度量、`font` 子集、composite 子集、webgl 一律 null）；`docs/architecture.md` 的关键文件索引加 canvas 两侧；`docs/roadmap.md` 打勾 |

破例：只有 II 里那一处对 spec §5 的修订（新增事件号 30），理由已写在表内。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 标签清单 | `packages/fjs-runtime/src/tags.json` | 加 `"canvas"`（元素标签，不进 `component-tags.json`）。`canvas` 是真 HTML 标签名，靠 `fjs/src/bundler/vue-plugin.ts:52` 的 `webIsNativeTag` 把它排除出 native——`FJS_TAGS.has(tag)` 那一条已经覆盖，**不需要改 vue-plugin**，但要在 `packages/fjs/test/vue-plugin.test.ts` 里加一条钉住 |
| JS runtime（新目录） | `packages/fjs-runtime/src/canvas/context-registry.ts` | `registerContextType(type, factory)` + `getContext(el, type, attrs)`；`'2d'` 默认注册，未知类型 `warnOnce` + `null`。**webgl 的扩展位就是这里** |
| | `packages/fjs-runtime/src/canvas/context-2d.ts` | `CanvasRenderingContext2D`：状态机（`save`/`restore` 栈、属性去重）、所有绘制方法 → 命令编码 |
| | `packages/fjs-runtime/src/canvas/display-list.ts` | 命令的二进制编码器 + 命令号常量（Dart 侧解码器的孪生） |
| | `packages/fjs-runtime/src/canvas/font.ts` | `font` 字符串解析（`[style] [weight] <size>px [family]`），两端共用 |
| | `packages/fjs-runtime/src/canvas/path2d.ts` | `Path2D`（编程构造）、路径命令的公共编码 |
| | `packages/fjs-runtime/src/canvas/paint-style.ts` | `CanvasGradient` / `CanvasPattern` 句柄（JS 分配 id，Dart 侧按 id 建 `Shader`） |
| | `packages/fjs-runtime/src/canvas/measure.ts` | `invokeHost('fjs.canvas.measureText', fontJson, text)` + JS 侧 LRU（ECharts 会把同一批标签量成百上千次） |
| | `packages/fjs-runtime/src/canvas/image.ts` | `loadImage(src)` → 句柄 + fetch 范式的异步回派；`toDataURL()` 同 |
| | `packages/fjs-runtime/src/ui/element.ts` | `makeElement`（:231）里给 `tag === 'canvas'` 的元素挂 `getContext` / `toDataURL` / `width` / `height`；canvas 子系统的回派接进已有的 `systemHandlers` |
| | `packages/fjs-runtime/src/ui/ops.ts` | `UiOp.Canvas = 10` + `canvas(id, bytes)` 写入；`hostUiOpsVersion() < 3` 时不写并 `warnOnce` |
| | `packages/fjs-runtime/src/index.ts` | 导出 `Path2D` 等页面可能要的类型（不导出内部编码器） |
| Web 适配层 | `packages/fjs-runtime/src/web/components/canvas.ts`（新） | 真 `<canvas>`；`ResizeObserver` 维护 backing store = 逻辑尺寸 × dpr 并 `setTransform(dpr,…)`；`defineExpose({ getContext, toDataURL, width, height })`，`getContext` 走同一个注册表（`'2d'` 透传浏览器原生 context，`'webgl'` 同样 `null`） |
| | `packages/fjs-runtime/src/web/components/index.ts` | 注册 `canvas: FjsCanvas` |
| | `packages/fjs-runtime/src/web/base-css.ts` | canvas 的默认盒子样式（`display:block`，不给背景/边框） |
| C++ | `packages/flutter_fjs/native/include/fjs.h` | `FJS_EVENT_CANVAS = 30`（C++ 不解释事件号，**不必重编 native**，但表要对齐） |
| | `packages/flutter_fjs/native/tools/fjsrun.cpp` | dump switch（:34）与 skip switch（:77）各加 case 10；:173 的 `uiOpsVersion: 2` → 3 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ui_ops.dart` | `UiOpCode.canvas = 10` + 头注释里的协议表补一行 |
| | `packages/flutter_fjs/lib/src/mirror_tree.dart` | 解码分支（:176 那个 switch 旁），把字节挂到节点上并触发重绘 |
| | `packages/flutter_fjs/lib/src/canvas/canvas_ops.dart`（新） | 显示列表解码器（`display-list.ts` 的孪生） |
| | `packages/flutter_fjs/lib/src/canvas/display_list.dart`（新） | 每个 canvas 节点的命令累积、`clearRect` 全覆盖时的截断、命令预算告警 |
| | `packages/flutter_fjs/lib/src/canvas/replay.dart`（新） | 命令 → `Canvas` 调用：`Paint` 构造、`TextPainter` 缓存、渐变/图案 `Shader`、阴影、`clipPath`、composite 的 `saveLayer` |
| | `packages/flutter_fjs/lib/src/widgets/canvas.dart`（新） | `CustomPaint` + `CustomPainter`；`shouldRepaint` 按显示列表版本号 |
| | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | `_CanvasNodeAdapter`（tag `canvas`）加进 `builtInNodeAdapters`（:28） |
| | `packages/flutter_fjs/lib/src/engine.dart` | `_setupCanvasModule()`（照 `_setupAnimationFrameModule` :264 的写法）注册三个 host 名；`uiOpsVersion` 2 → 3（:166） |
| | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.canvas = 30`（:191 那张表） |
| 测试 | `packages/fjs-runtime/test/canvas-context.test.ts`（新） | 状态机、属性去重、`font` 解析、命令编码字节 |
| | `packages/fjs-runtime/test/web-canvas.test.ts`（新） | web 组件：dpr、`getContext` 注册表、webgl 返回 null |
| | `packages/flutter_fjs/test/canvas_replay_test.dart`（新） | 解码 + 回放（`goldens` 或对 `Canvas` 的调用录制），**确认不是 `No tests ran`** |
| 示例 | `examples/hello-fjs/src/pages/comp/canvas.vue`（新） | 画廊页：矩形/路径/文本/渐变/阴影/`drawImage`/裁剪 |
| | `examples/hello-fjs/src/echarts/adapter.ts`（新） | `setPlatformAPI` + `init` + touch → zrender 事件转发 |
| | `examples/hello-fjs/src/pages/example/echarts.vue`（新） | 折线 + 柱状 + 饼图 + 一次 `setOption` 更新 |
| | `examples/hello-fjs/package.json` | 加 `echarts` 依赖（spec §7.3 已定；`demo` 不加） |
| 文档 | `docs/canvas-compat.md`（新）、`docs/ui-api.md`、`docs/web.md`、`docs/architecture.md`、`docs/roadmap.md` | 见宪法自查 VIII |

路径核对：`ui/element.ts:231` 的 `makeElement`、`ops.ts` 的 `UiOp` 枚举（1-9）、
`ui_ops.dart` 的 `UiOpCode`（1-9）与 `mirror_tree.dart:176` 的 switch、
`fjsrun.cpp:34/77/173`、`engine.dart:166` 的 `uiOpsVersion = 2` 与
`engine.dart:264` 的 `_setupAnimationFrameModule`、`ffi.dart:191` 的 `FjsEvent`
（最大号 29）、`fjs.h` 的 `FJS_EVENT_MESSAGE = 29`、
`node_adapters.dart:28` 的 `builtInNodeAdapters`、
`web/components/index.ts` 的 `fjsComponents`、`vue-plugin.ts:52` 的
`webIsNativeTag` —— 均已确认存在。

## 3. 方案

### 3.1 context 从 element 层长出来，`canvas` 是元素而不是组件

页面写的是 web 的形状：`cv.value.getContext('2d')`。两端要给出同一个形状，
有三条路：

1. **（选）元素标签 + `makeElement` 给 canvas 挂 `getContext`。** Flutter 路径上
   模板 `ref` 拿到的就是 `Element`（`ui/element.ts:231` 造的那个对象），在它上面
   挂方法是**框架无关**的：裸 element API 写的页面、以后接 React 的页面，拿到的是
   同一个 API（`docs/custom-renderer.md`）。web 路径上 `ref` 拿到的是
   `FjsCanvas` 组件实例，`defineExpose` 出同名的三件套。
2. 做成 JS 组件（`components/canvas.ts`，进 `component-tags.json`）——**否掉**：
   组件名 `canvas` 要在自己的模板里渲染元素 `canvas`，是自引用；换个内部标签名
   （`canvas-surface`）就等于让 Dart 侧的标签和页面写的标签对不上，兼容表和
   `docs/ui-api.md` 都要解释这件事。而且这里本来就要下 Dart（宪法 VII 的例外），
   包一层组件并不减少 Dart 的量。
3. 提供 `createCanvasContext(idOrRef)` 这样的 fjs 专有 API——**否掉**：ECharts 这类
   库自己会调 `canvas.getContext('2d')`，专有 API 意味着每个库都要改。spec §1 的
   前提就是「只能对标不能重新设计」。

`width` / `height` 读的是**逻辑像素的当前布局尺寸**，由 Dart 在布局后经事件 30
回报（§3.6）；尺寸未知前读到 0，和 web 上还没布局的 `<canvas>` 一致。

### 3.2 显示列表：新 op 10，帧内二进制

```
op 10 CANVAS   u32 nodeId, u32 byteLen, <byteLen 字节的命令流>
```

命令流自己的编码（`display-list.ts` ↔ `canvas_ops.dart`）：

- `u8 cmd` + 定长参数。坐标、尺寸、变换矩阵用 **f32**：canvas 的坐标是逻辑像素，
  f32 的有效位远超屏幕精度，一条 `lineTo` 从 f64 的 17 字节降到 9 字节；理由写进
  文件头注释（宪法 VI）。
- **字符串按帧内表去重**：`STR_DEF u16 id, u16 len, utf8`，之后引用 `u16 id`。
  ECharts 一帧里 `fillStyle = '#5470c6'` 会出现上千次，颜色和字体串不去重的话，
  帧体积由字符串主导。
- **属性只在变化时发**：JS 侧持有当前状态与 `save`/`restore` 栈，setter 写入相同值
  不产生命令。Dart 侧持有同一台状态机，回放时按同样的规则重建 `Paint`。
- 渐变/图案是**句柄**：`createLinearGradient` 在 JS 分配 id 并发一条定义命令
  （含 color stops），之后 `fillStyle = gradient` 只发 `u32 id`。

被否掉的备选：

- **走 `setProps` 的 JSON**（不改协议）：一次 ECharts `setOption` 是几千条命令，
  JSON 化 + Dart 侧 `jsonDecode` 正是宪法 III 要躲的开销；而且 `setProps` 是
  **合并**语义，绘制命令是**流**语义，硬塞进去会让「这一帧画了什么」变成
  「props 里那个数组现在是什么」，diff 不掉。
- **每条命令一次 `invokeHost`**：同步 FFI 调用没有批处理，一帧几千次跨界。
- **在 Dart 侧跑一个 JS 的 context 对象（QuickJS host object）**：等于把状态机写进
  C++/Dart，违反宪法 VII，而且 `save/restore` 的语义要在两处各写一遍。

老宿主（`uiOpsVersion < 3`）：`ops.ts` 不写 op 10，`warnOnce` 一次；画面空白，
页面其余照常（spec §7.4）。**不做 JSON 回落**——两套编码路径的成本远大于收益。

### 3.3 保留语义：Dart 累积，全画布 clearRect 截断

canvas 是保留式的：画完的东西留在那儿，直到被清掉。这条在「JS 每帧只发新命令」
的前提下要有人记账：

- **Dart 累积**每个节点的命令，`CustomPainter` 每次 paint 全量回放；
- 一条**覆盖整块画布**的 `clearRect(0,0,w,h)`（或 `reset()`）到达时，**丢弃之前
  累积的全部命令**，从这条开始重新攒。ECharts 每帧第一件事就是这个，所以图表的
  累积量是 O(一帧)，不会涨；
- 命令数超过预算（初值 200k）时 `warnOnce` 提示页面该 `clearRect` 了 —— 静默涨
  内存是宪法 V 要禁的那种失败。

否掉的备选：**JS 每帧重传全量命令**。对 ECharts 等价，但签名板/涂鸦那种「每一笔
只加一条 path」的场景会退化成 O(n²)，正是 canvas 相对于「用 view 拼」的核心优势
所在。

**尺寸变化两端都清空**：浏览器改 backing store 尺寸时位图必然被清空，我们在
Flutter 侧也丢弃累积列表，让两端一致（宪法 I 优先于「留着更好用」）。这条写进
`docs/canvas-compat.md`。

### 3.4 `getContext` 是注册表——webgl 的扩展位

```ts
registerContextType('2d', create2dContext);           // 运行时自带
// 将来：registerContextType('webgl', createWebglContext)  ← 模块注册进来
```

`getContext(type)` 按 (element, type) 缓存，第二次调用返回**同一个对象**
（web 语义，spec §6.6 的验收点）。未注册的类型 `warnOnce` + `null`。
本期 `'webgl'` / `'webgl2'` 不注册，**两端都返回 null**——web 侧明明有 WebGL 也
要 null，否则页面在浏览器上跑通、到 App 上才发现整块空白，这是宪法 I 的
「只做一端等于没做」的镜像情形。这一条会是兼容表里最显眼的 ⚠️。

### 3.5 measureText：同步 invokeHost + JS 侧 LRU

`invokeHost('fjs.canvas.measureText', fontJson, text)` → Dart `TextPainter.layout()`
→ 返回度量的 JSON 串（`width` 必有，`actualBoundingBoxAscent/Descent` 尽量给）。
同步返回符合宪法 III。

ECharts 的布局阶段会对同一批标签反复量，所以 JS 侧加一个按 `font + text` 的 LRU
（初值 2048 条）。**缓存是必需的不是优化**：每次量都是一次 FFI + 一次 `TextPainter`
构造与 layout，量在 ECharts 的热路径上。

字体度量两端不可能逐像素相同（spec §4.1），这不进验收标准，只进兼容表。

### 3.6 图片、toDataURL、尺寸回报：一个事件号 30，载荷自带类型

三件事都是「Dart 有话对某个 canvas 说」，都走 fetch 范式（宪法 II）：

| 场景 | JS → Dart | Dart → JS（事件 30，payload JSON） |
|---|---|---|
| `loadImage(src)` | `invokeHost('fjs.canvas.loadImage', handle, src)` | `{"t":"image","h":12,"w":600,"h2":400}` 或 `{"t":"image","h":12,"err":"…"}` |
| `toDataURL()` | `invokeHost('fjs.canvas.toDataURL', reqId, nodeId, type, quality)` | `{"t":"dataurl","id":3,"data":"data:image/png;base64,…"}` |
| 尺寸 | —— | `{"t":"size","w":300,"h":200}`（布局后、变化时各一次） |

载荷里带 `t` 而不是各占一个事件号：号段是稀缺资源（`ffi.dart` 的表已到 29），而这
三件事都属于同一个子系统。`loadImage` 的图片来源沿用 `image` 标签既有的三种 src
解析（`widgets/image.dart` 那套），不另起一套。

`getImageData` / `putImageData` 不做（spec §7.1），在兼容表里是 ❌ + 一句
「要逐像素读回请用 `toDataURL` 整图导出」。

### 3.7 web 侧：真 canvas，但判断走同一层

`FjsCanvas` 渲染真 `<canvas>`，绘制透传浏览器原生 context —— 这是 web 侧「零成本
拿到全部 2D 能力」的地方，但**不能因此让两端支持范围不同**：

- `getContext` 走 §3.4 同一个注册表，`'webgl'` 一样 null；
- DPR：`ResizeObserver` 把 backing store 设成逻辑尺寸 × `devicePixelRatio` 并
  `setTransform(dpr,0,0,dpr,0,0)`，让页面坐标系在两端都是逻辑像素（spec §3.1）；
- 兼容表里 ❌ 的方法**不去 patch 浏览器 context**（包装每个方法的成本和风险都不值），
  改由兼容表 + `docs/web.md` 明确登记「web 上可能能用，App 上不行」，这一条 spec §4.4
  已经写了。

### 3.8 ECharts 适配层（示例内，spec §7.2）

```ts
echarts.setPlatformAPI({
  createCanvas: () => offscreenLike,   // 我们的 canvas-like 对象
  measureText: (text, font) => ctx.measureText(text),
  loadImage: (src, onload, onerror) => canvasLoadImage(src, onload, onerror),
});
const chart = echarts.init(canvasLike, undefined, { width, height, devicePixelRatio: 1 });
```

- **`devicePixelRatio: 1`**：Flutter 的 `Canvas` 本来就在逻辑像素上画，光栅化时
  由引擎按设备像素放大；再让 ECharts 乘一次 dpr 会画出 2 倍大的图。web 侧由
  §3.7 的 `setTransform` 吃掉 dpr，所以对 ECharts 同样报 1。
- **交互**：`@touchstart` / `@touchmove` / `@touchend` → `chart.getZr().handler.dispatch('mousedown'|'mousemove'|'mouseup', {zrX, zrY, …})`，
  坐标用触点相对 canvas 左上角的位置（`ui/touch.ts` 的载荷里有）。
- ECharts 需要多张离屏 canvas（`createCanvas`）时：本期只支持**主 canvas**，
  离屏请求返回主 canvas 的一个轻量壳并 `warnOnce`；触发它的功能（部分特效、
  `progressive` 渲染的某些路径）记进兼容表。这是示例层的限制，不是渲染器的。

## 3.9 实现期的偏差（对 §2、§3 的修订）

写的时候有五处 plan 没预料到，都在这里记账：

1. **多出四个文件**（§2 的表按「JS 七个 + Dart 四个」写的）：
   - `fjs-runtime/src/canvas/warn.ts` —— canvas 层共用的 warn-once 通道；
   - `fjs-runtime/src/canvas/surface.ts` —— 每个 canvas 节点的写入器 + 把命令
     塞进 UI 帧的 pre-flush 钩子。原本打算写进 `ui/element.ts`，但那样等于把
     canvas 的簿记塞进最热的那个文件；
   - `fjs-runtime/src/canvas/types.ts` —— **页面看到的 context 类型**。见第 3 条；
   - `flutter_fjs/lib/src/canvas/images.dart` —— 句柄 → `ui.Image` 的表。图片
     比任何一块画布活得久（两块画布可以画同一张图，换路由重建的画布不该重解码），
     所以它不能待在 `display_list.dart` 里；
   - `flutter_fjs/lib/src/canvas/host_module.dart` —— 三个 host 模块的实现。
     `engine.dart` 里只留一个 `_setupCanvasModule()` 转调，engine 不再长胖。
2. **`host.ts` 多了一个 pre-flush 钩子**（`registerPreFlush`）。绘制命令必须和
   节点 op **同一帧**过去，否则「改尺寸 + 重画」会分成两帧到达宿主，中间那帧
   用旧几何画新内容。
3. **context 的类型是自己写的，不是 DOM 的**。`canvas/types.ts` 里的
   `FjsCanvasContext2D` 就是 `docs/canvas-compat.md` 的类型化版本：❌ 的方法在
   类型上根本不存在，页面写了直接编译报错，而不是两端截图对比才发现。
   `FjsCanvasRenderingContext2D implements FjsCanvasContext2D`，两边一起改。
   连带 `vue-global.d.ts` 要加 `canvas` 的 GlobalComponents 条目（ref 的类型来自
   这里），`FjsBaseProps` 加 `ref?`。
4. **chunk 边界要重置状态基线**（§3.3 只写了字节层面的截断）。CLEAR_ALL 让宿主
   丢掉之前所有 chunk，**包括把宿主置成当前状态的那些命令**。所以 JS 侧在
   `clearAll()` 之后要把「宿主已知」的基线退回默认值，并补发当前的 transform 与
   save 层级。不这样的话：图表第一帧颜色正确，之后每一帧都是黑的——测试
   `canvas-context.test.ts` 的「re-sends the fill colour after a truncating clear」
   就是钉这个的。
5. **`@resize` 是实机跑出来的必需品**（spec §7.5 原本决定「不新增事件」）。
   排队首帧命令只解决「画了但还没尺寸」；`/comp/canvas` 在模拟器上暴露的是另一
   半——**页面要读尺寸才知道画什么**，而 `onMounted` 时 `width`/`height` 是 0。
   `@resize` 走 canvas 子系统已有的号 30（`EventType.onResize`，由
   `canvas/surface.ts` 把子系统的 size 消息转派给页面处理器），web 侧
   `FjsCanvas` 在 `ResizeObserver` 里 emit 同样的载荷。spec §7.5 已按此修订。
6. **整圈的 `arc` 在 Flutter 上什么都不画**（同样是模拟器上看出来的，单测和
   web 都不会暴露）：Skia 把首尾角相同的弧当空路径，`ctx.arc(x, y, r, 0, 2π)`
   ——每个页面画圆的写法——直接消失。宿主侧改成 `addOval`，
   `canvas_replay_test.dart` 有回归用例。
7. **触点缺相对坐标**（实机点图表点不出 tooltip 才发现）：触摸载荷只有页面坐标
   （`clientX/pageX/screenX` 是同一个数），而 canvas 的命中测试要的是相对画布
   左上角的坐标，页面这边没有 `getBoundingClientRect` 可以自己换算。所以触摸
   载荷加了节点原点 `"o":[x,y]`，`ui/touch.ts` 解成 DOM 的
   `offsetX`/`offsetY`，web 侧用 `getBoundingClientRect` 给出同样的字段。
   这是对触摸事件载荷的**追加**（老宿主没有 `o` 时 offset 退化成 client 坐标）。
8. **ECharts 比 §3.8 预想的多两件事**（实机跑出来的，不是读文档读出来的）：
   - zrender 的 `HandlerDomProxy` 一上来就往画布根上挂 DOM 监听，canvas-like
     对象必须有 `addEventListener` / `removeEventListener` 空壳，否则直接
     `TypeError`；
   - 默认 tooltip 是一个 HTML `<div>`，会被 `appendChild` 到图表根上。必须
     `tooltip.renderMode: 'richText'`（画进 canvas）。这条由适配层统一改写，不让
     每个页面自己记。

## 3.10 canvas 改成包装组件（用户决定，2026-09-05）

§3.1 当初选了「元素标签」，理由之一是「组件名和标签名会自引用」。用户提出把
canvas 做成包装组件、元素改名 `inner-canvas`——改名正好解掉那个反对理由，而
收益是 §3.1 没考虑到的一件事：**画布上方需要放东西**。

tooltip 是最直接的例子。ECharts 自带的两种都不合用：HTML 模式要 DOM（App 上
没有），`richText` 模式画进位图（字体、主题、换行都要在画布里重写一遍，而且
脱离 CSS 和 `v-if`）。有了插槽，tooltip 就是一个普通的 `view + text`，两端
一致、能用样式、能跟主题走。图例、加载遮罩、可点热区同理。

形状（和 `picker` / `textarea` 一样，一份组件两种 substrate）：

```
<canvas>  ← JS 组件（components/canvas.ts）
  └ view              定位上下文，页面的 class/style 落在它身上
      ├ inner-canvas  绝对定位铺满；Flutter 上才是 CustomPaint
      └ <slot/>       overlay：普通 fjs 节点
```

- 绘制面用 `position: absolute` 铺满而不是 flex 子节点：`align-self` 不在支持
  的 CSS 子集里（docs/css-compat.md），而 flex 子节点在交叉轴上会按内容定尺寸
  ——画布没有内容可依。
- `ref` 仍然给页面 DOM 那套（`getContext` / `toDataURL` / `width` / `height`），
  由组件转发到绘制面，所以页面代码一个字不用改。
- **dev server 要重启才生效**：标签表在 vite 插件初始化时读一次（volar.cjs 里
  记的是同一件事），跑着的 server 仍会把 `<canvas>` 当 DOM 标签编译。

## 4. 风险

1. **协议三处不同步**（最高风险）：op 10 的 `ops.ts` / `ui_ops.dart` / `fjsrun.cpp`
   三处，加上命令流自己的 `display-list.ts` / `canvas_ops.dart` 两处。前者错了表现
   是「节点错位」，后者错了表现是「画面乱但不报错」。对策：命令号常量在两侧都按同
   一顺序列出并写死数值，Dart 解码器遇到未知命令**抛异常**；`canvas_replay_test.dart`
   用一份手写字节流当固定夹具。
2. **`uiOpsVersion` 忘了加**：老宿主静默不画。对策：`ops.ts` 里那条 `warnOnce` 是
   验收项（spec §6）。
3. **`No tests ran`**：Dart 侧测试在没编 native 时会整文件跳过（AGENTS.md §3）。
   对策：tasks 里把「先 `cmake --build build-native`」写成前置步骤，验收时看用例数。
4. **性能**：ECharts 一帧几千条命令。两个已知热点——JS 侧的字符串编码（用帧内表
   去重）和 Dart 侧的 `TextPainter`（按 font+text 缓存）。要在 Android 真机上按
   `docs/performance.md` 的量法测一次，阈值在 tasks 阶段定死。
5. **两端对拍只能靠肉眼**：字体度量必然有亚像素差，做不了逐像素 golden 对比。
   对策：画廊页和 ECharts 页各截一次两端的图人工比对，差异登记进兼容表。
6. **`canvas` 是 HTML 标签名**：`vue-plugin.ts` 的顺序问题（`form` / `textarea` 踩过）
   这次由 `FJS_TAGS.has(tag)` 覆盖，但要有测试钉住，否则某天顺序一动就静默失效。

## 5. 验证路径

```bash
# 0) native（Dart 测试的前置，否则整文件静默跳过）
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j

# 1) JS 侧
cd /Volumes/zt/Documents/flutter-js
pnpm run typecheck
pnpm test                       # 含新增的 canvas-context / web-canvas 用例

# 2) Dart 侧（看用例数，不是看 "No tests ran"）
cd packages/flutter_fjs && flutter test test/canvas_replay_test.dart

# 3) 帧协议 dump（不起 Flutter，确认 op 10 能被识别）
./native/build-native/fjsrun ../../examples/hello-fjs/dist/bundle.js

# 4) 两端对拍
pnpm --filter hello-fjs run dev:web        # 浏览器：/comp/canvas 与 /example/echarts
pnpm --filter hello-fjs run run:android    # 真机：同两页，截图人工比对
```
