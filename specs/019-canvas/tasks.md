# Tasks: canvas 组件与 2D 上下文

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/tags.json` 加 `"canvas"`（元素标签；**不进** `src/component-tags.json`）。
- [x] T002 在 `packages/fjs-runtime/src/ui/ops.ts` 的 `UiOp` 枚举加 `Canvas = 10`，并加 `canvas(id, bytes)` 写入方法（`u32 id, u32 byteLen, bytes`）；`hostUiOpsVersion() < 3` 时不写入并 `warnOnce` 一次「宿主太旧，canvas 不绘制」。
- [x] T003 在 `packages/flutter_fjs/lib/src/ui_ops.dart` 加 `UiOpCode.canvas = 10`，并在文件头的协议表补一行 `op 10 CANVAS`。
- [x] T004 在 `packages/flutter_fjs/lib/src/mirror_tree.dart` 的 op switch（约 :176）加 `UiOpCode.canvas` 解码分支：读出 nodeId 与字节，交给节点的显示列表并触发重绘。
- [x] T005 在 `packages/flutter_fjs/native/tools/fjsrun.cpp` 的 dump switch（:34）与 skip switch（:77）各加 `case 10`，并把 :173 的 `uiOpsVersion: 2` 改成 3。
- [x] T006 把 `packages/flutter_fjs/lib/src/engine.dart:166` 的 `static const int uiOpsVersion = 2` 改成 3。
- [x] T007 在 `packages/flutter_fjs/native/include/fjs.h` 加 `FJS_EVENT_CANVAS = 30`，注释写明载荷是带 `t` 字段的 JSON（image / dataurl / size 三种）。
- [x] T008 在 `packages/flutter_fjs/lib/src/ffi.dart:191` 的 `FjsEvent` 加 `canvas = 30`，注释与 T007 一致。
- [x] T009 在 `packages/fjs-runtime/src/canvas/display-list.ts` 与 `packages/flutter_fjs/lib/src/canvas/canvas_ops.dart` 各定义一份命令号常量表（同顺序、同数值），文件头互相指认为孪生；Dart 侧遇未知命令抛 `UiOpException`，不跳过。

## 实现

- [x] T010 写 `packages/fjs-runtime/src/canvas/display-list.ts`：命令流编码器（`u8 cmd` + f32 参数、`STR_DEF` 帧内字符串表去重、句柄 id）。文件头注释记录三处权衡：为什么是新 op 而不是 `setProps` JSON、为什么坐标用 f32、为什么字符串按帧去重。
- [x] T011 写 `packages/fjs-runtime/src/canvas/font.ts`：解析 `[style] [weight] <size>px [family]`，不认识的形状 `warnOnce` 并按默认字体处理。
- [x] T012 写 `packages/fjs-runtime/src/canvas/path2d.ts`：`Path2D`（编程构造，不接受 SVG 串）与路径命令的公共编码。
- [x] T013 写 `packages/fjs-runtime/src/canvas/paint-style.ts`：`CanvasGradient` / `CanvasPattern` 句柄，`addColorStop` 收集、定义命令一次性发出。
- [x] T014 写 `packages/fjs-runtime/src/canvas/context-2d.ts`：完整 2D 状态机（`save`/`restore` 栈、属性写入去重）与 spec §3.3 表里的全部方法；未实现的方法是 `warnOnce` 后的空实现，不静默。
- [x] T015 写 `packages/fjs-runtime/src/canvas/measure.ts`：`invokeHost('fjs.canvas.measureText', fontJson, text)` + 按 `font + text` 的 LRU（2048 条），注释说明缓存是必需项（每次量 = 一次 FFI + 一次 TextPainter layout，在 ECharts 热路径上）。
- [x] T016 写 `packages/fjs-runtime/src/canvas/image.ts`：`loadImage(src)` 句柄 + fetch 范式的异步回派；`toDataURL(type, quality)` 同；src 解析复用 `image` 标签既有的三种写法。
- [x] T017 写 `packages/fjs-runtime/src/canvas/context-registry.ts`：`registerContextType(type, factory)` 与按 (element, type) 缓存的 `getContext`；默认注册 `'2d'`；未注册类型 `warnOnce` + 返回 `null`。注释写明这是 webgl 的扩展位。
- [x] T018 在 `packages/fjs-runtime/src/ui/element.ts` 的 `makeElement`（:231）给 `tag === 'canvas'` 的元素挂 `getContext` / `toDataURL` / `width` / `height`；canvas 子系统的事件 30 回派接进已有的 `systemHandlers`，按载荷的 `t` 分发到 image / dataurl / size 三条路。
- [x] T019 在 `packages/fjs-runtime/src/index.ts` 导出页面用得到的类型（`Path2D`、context 类型、`registerContextType`），不导出内部编码器。
- [x] T020 写 `packages/flutter_fjs/lib/src/canvas/canvas_ops.dart`：命令流解码器（`display-list.ts` 的孪生）。
- [x] T021 写 `packages/flutter_fjs/lib/src/canvas/display_list.dart`：每节点命令累积、全画布 `clearRect` / `reset` 时截断、超 200k 命令 `warnOnce`、版本号（供 `shouldRepaint`）；注释记录「Dart 累积而不是 JS 每帧全量重传」的理由。
- [x] T022 写 `packages/flutter_fjs/lib/src/canvas/replay.dart`：命令 → `Canvas` 调用（`Paint` 构造、`TextPainter` 按 font+text 缓存、渐变/图案 `Shader`、`clipPath`、阴影用 `MaskFilter.blur` 近似、非 `source-over` 的 composite 走 `saveLayer`）；近似与子集处的取舍写进注释。
- [x] T023 写 `packages/flutter_fjs/lib/src/widgets/canvas.dart`：`CustomPaint` + `CustomPainter`，`shouldRepaint` 比显示列表版本号；布局尺寸确定/变化时经事件 30 回报 `{"t":"size"}`，并按 plan §3.3 清空累积列表。
- [x] T024 在 `packages/flutter_fjs/lib/src/node/node_adapters.dart` 加 `_CanvasNodeAdapter`（tag `canvas`）并注册进 `builtInNodeAdapters`（:28）。
- [x] T025 在 `packages/flutter_fjs/lib/src/engine.dart` 加 `_setupCanvasModule()`（照 `_setupAnimationFrameModule` :264 的写法），注册 `fjs.canvas.measureText`（同步返回度量 JSON）、`fjs.canvas.loadImage`、`fjs.canvas.toDataURL`（后两者用事件 30 回派）。
- [x] T026 让首帧命令在 JS 侧排队、Dart 侧尺寸确定后再回放（spec §7.5：对页面不可见，不新增页面事件）。

## 两端对齐

- [x] T030 写 `packages/fjs-runtime/src/web/components/canvas.ts`：真 `<canvas>`；`ResizeObserver` 维护 backing store = 逻辑尺寸 × dpr 并 `setTransform(dpr,0,0,dpr,0,0)`；`defineExpose({ getContext, toDataURL, width, height })`。
- [x] T031 让 web 的 `getContext` 走 T017 同一个注册表：`'2d'` 透传浏览器原生 context，`'webgl'` / `'webgl2'` 同样 `warnOnce` + `null`（否则 web 能跑、App 空白）。
- [x] T032 在 `packages/fjs-runtime/src/web/components/index.ts` 的 `fjsComponents` 注册 `canvas: FjsCanvas`。
- [x] T033 在 `packages/fjs-runtime/src/web/base-css.ts` 给 canvas 默认盒子样式（`display:block`，无背景无边框），与 Flutter 侧一致。
- [x] T034 让 web 侧在 backing store 尺寸变化时清空画面，与 Flutter 侧的「尺寸变化清空累积列表」对齐（plan §3.3）。
- [x] T035 两端对拍 `/comp/canvas`（web 5178 + iOS 模拟器）：七块逐块比对一致。对拍中查出并修掉三个真 bug：整圈 `arc` 在 Skia 上是空路径、`transparent` 解析失败回落成黑色、canvas 在 `onMounted` 时尺寸为 0（新增 `@resize`）。差异（阴影模糊近似、字体度量亚像素差）已登记进 `docs/canvas-compat.md`。

## 实现期追加（plan §3.9）

- [x] T027 写 `packages/fjs-runtime/src/canvas/warn.ts`（canvas 层共用的 warn-once）与 `packages/fjs-runtime/src/canvas/surface.ts`（每节点写入器 + pre-flush 钩子），并在 `packages/fjs-runtime/src/host.ts` 加 `registerPreFlush`，让绘制命令与节点 op 同帧过去。
- [x] T028 写 `packages/fjs-runtime/src/canvas/types.ts`（`FjsCanvasContext2D` / `FjsCanvasApi`：兼容清单的类型化版本），让 `FjsCanvasRenderingContext2D` implements 它，并在 `packages/fjs-runtime/src/vue-global.d.ts` 注册 `canvas` 组件类型、给 `FjsBaseProps` 加 `ref?`。
- [x] T029 在 chunk 边界（CLEAR_ALL）重置 JS 侧的「宿主已知状态」基线，并补发当前 transform 与 save 层级；`packages/fjs-runtime/src/canvas/context-2d.ts`。
- [x] T02A 写 `packages/flutter_fjs/lib/src/canvas/images.dart`（句柄 → ui.Image，跨画布共享、VM reset 时清空）与 `packages/flutter_fjs/lib/src/canvas/host_module.dart`（三个 host 模块），`engine.dart` 只留 `_setupCanvasModule()` 转调。
- [x] T02B 适配层补 ECharts 实跑才暴露的两件事：canvas-like 对象加 `addEventListener`/`removeEventListener` 空壳；`tooltip.renderMode: 'richText'` 由适配层统一改写。`examples/hello-fjs/src/echarts/adapter.ts`。

- [x] T02C 新增 `@resize`（两端同载荷 `{"width":n,"height":n}`，复用事件号 30）：`ui/element.ts` 的 `EventType.onResize` + `nodeHandler()`、`canvas/surface.ts` 转派、`web/components/canvas.ts` emit、`vue-global.d.ts` 的 `FjsCanvasProps`；两个示例页改成在 `@resize` 里首绘。spec §7.5 与 plan §3.9 已记修订。
- [x] T02D 修复整圈 `arc`/`ellipse` 在 Flutter 上画不出来（Skia 视首尾同角的弧为空路径）：`canvas/replay.dart` 走 `addOval`，`canvas_replay_test.dart` 加回归用例。

- [x] T02E 触点补 `offsetX` / `offsetY`（相对监听元素左上角）：Dart 侧在 payload 里加节点原点 `"o":[x,y]`（`render/touch.dart`，原点在活的指针回调里取，销毁期用缓存），JS 侧 `ui/touch.ts` 解码成 offset，web 侧 `web/components/touch.ts` 用 `getBoundingClientRect`；两端各加用例。canvas 的命中测试没有它无法工作。

## 包装组件重构（用户决定，plan §3.10）

- [x] T02K 修 web 侧包装组件用 `h('view')` 渲染出裸 DOM 元素的问题：容器也做成参数（Flutter 传标签 `'view'`，web 传 `FjsView` 组件），否则 web 上整条 fjs 适配层（触摸、样式归一化）都被跳过；插槽改成函数形式，消除 Vue 警告。
- [x] T02L 绘制面暴露 `devicePixelRatio`（web 是浏览器比例，Flutter 恒为 1），适配层交给 ECharts 自己乘：zrender 会 `setTransform` 冲掉 web 侧预置的 dpr 缩放，不交出去图就只画在左上角四分之一。
- [x] T02M 适配层合成 zrender 的 `click`（手指位移 ≤8px 时）：zrender 的 click 来自它自己的 DOM proxy，我们绕开了那层，不合成就永远触发不了 series 的 click。

- [x] T02F 元素标签改名 `canvas` → `inner-canvas`（`tags.json`、`ui/element.ts` 的挂载判断、Dart `_CanvasNodeAdapter.tag`），`canvas` 进 `component-tags.json`。
- [x] T02G 写 `packages/fjs-runtime/src/components/canvas.ts`：两端共用的包装组件，渲染 `view`（定位上下文）+ 绘制面 + 默认插槽（overlay）；转发 `getContext` / `toDataURL` / `width` / `height` / `@resize`。Flutter 侧在 `app/flutter.ts` 注册，web 侧在 `web/components/index.ts` 注册（绘制面改名 `FjsCanvasSurface`，以 `inner-canvas` 注册）。
- [x] T02H 类型与样式：`vue-global.d.ts` 加 `inner-canvas` 与 overlay 插槽说明；`web/base-css.ts` 加 `.fjs-canvas-box`。
- [x] T02I 测试：`test/canvas-component.test.ts`（盒子结构、插槽顺序、API 转发、`@resize` 转发、页面样式与定位上下文并存）；`vue-plugin-tags.test.ts` 钉住 `canvas` 是组件、`inner-canvas` 是元素。
- [x] T02J 示例：`examples/hello-fjs/src/pages/example/echarts.vue` 关掉 ECharts 自带 tooltip，改用插槽里的 `view/text` 画 tooltip（位置取触点的 `offsetX/offsetY`）。
- [x] T02N 插槽 tooltip 的普通 `<text>` 也走 `drawableText`（`setText` 与 `fillText` 同一套）：ECharts 未命名 series 的 `\0` 在 App 上不再画成方块。饼图 series 补 `name: '来源'`。

## 测试

- [x] T040 写 `packages/fjs-runtime/test/canvas-context.test.ts`：状态机与 `save`/`restore` 栈、属性写入去重、`font` 解析、命令编码字节（对一份手写期望字节流）。
- [x] T041 写 `packages/fjs-runtime/test/web-canvas.test.ts`：dpr 下的 backing store 与 `setTransform`、`getContext` 二次调用返回同一对象、`getContext('webgl')` 返回 null 且只告警一次。
- [x] T042 在 `packages/fjs/test/vue-plugin.test.ts` 加断言钉住 `canvas` 在两个路径上都是组件/元素的正确一侧（`form`/`textarea` 踩过的顺序问题）。
- [x] T043 先 `cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j`（不编 native 的话 Dart 测试整文件静默跳过）。
- [x] T044 写 `packages/flutter_fjs/test/canvas_replay_test.dart`：用手写字节流当固定夹具，断言解码 + 回放的 `Canvas` 调用序列、全画布 `clearRect` 截断、未知命令抛异常；**确认输出是用例数而不是 `No tests ran`**。
- [ ] T045 在 Android 真机上按 `docs/performance.md` 的量法测一次 ECharts 页 `setOption` 的帧耗时，把阈值写回 spec §6.7。**未做**：本机没有 Android 设备，iOS 模拟器的帧耗时不能代表真机。

## 文档

- [x] T050 新建 `docs/canvas-compat.md`：照 `docs/css-compat.md` 的 ✅/⚠️/❌ 形状，覆盖 spec §3.3 的全部分组；❌ 一栏显式登记 `getImageData` / `putImageData`、`filter`、`getContext('webgl')`、`OffscreenCanvas`、`ImageBitmap`、`toBlob`；⚠️ 登记字体度量差、`font` 解析子集、composite 子集、尺寸变化清空、离屏 canvas 限制。
- [x] T051 在 `docs/ui-api.md` 的标签全集表加 `canvas` 行，并补一节说明 `getContext` / 逻辑像素坐标系 / `toDataURL`。
- [x] T052 在 `docs/web.md` 的「已知差异」登记：web 侧是浏览器原生 context，兼容表里 ❌ 的方法在 web 上可能"能用"，以 `docs/canvas-compat.md` 为准。
- [x] T053 在 `docs/architecture.md` 的关键文件索引加 `fjs-runtime/src/canvas/` 与 `flutter_fjs/lib/src/canvas/`。
- [x] T054 `docs/roadmap.md` 打勾。

## 示例

- [x] T060 写 `examples/hello-fjs/src/pages/comp/canvas.vue`（带 `<route>` 块，`group` 归到组件画廊）：矩形/路径/文本/渐变/阴影/`drawImage`/裁剪各一块。
- [x] T061 在 `examples/hello-fjs/package.json` 加 `echarts` 依赖并 `pnpm install`（`demo` 不加，保持零业务依赖）。
- [x] T062 写 `examples/hello-fjs/src/echarts/adapter.ts`：`setPlatformAPI({createCanvas, measureText, loadImage})`、`init(..., { devicePixelRatio: 1 })`、touch → `getZr().handler.dispatch` 的转发；离屏 canvas 请求回落主 canvas 并 `warnOnce`。
- [x] T063 写 `examples/hello-fjs/src/pages/example/echarts.vue`：折线 + 柱状 + 饼图，加一个按钮触发 `setOption` 更新，并在两端验证 tooltip 交互。

## 验收

- [x] T070 `pnpm run typecheck`
- [x] T071 `pnpm test`
- [x] T072 `pnpm --filter hello-fjs run typecheck`
- [x] T073 `cd packages/flutter_fjs && flutter test`（234 个用例通过，不是 `No tests ran`）与 `flutter analyze`
- [x] T074 `fjsrun` 跑一份手写的 op 10 帧：输出 `canvas #1 32 bytes`，不报 unknown op
- [x] T075 web（干净的 dev server）核对 `/comp/canvas`（7 块全部绘制）与 `/example/echarts`（柱状+折线+饼图、插槽 tooltip「二 销量：200」、`setOption` 切 Q1/Q2）
- [x] T076 真机核对：**用 iOS 模拟器代替 Android**（本机没有 Android 设备/模拟器）。两页与 web 截图逐块比对一致，tooltip 与 `setOption` 均正常。
- [x] T077 逐条核对 spec.md 第 6 节（含 §6.6 的 `getContext('webgl')` 恰好一条告警、`getContext('2d')` 二次返回同一对象），更新 spec.md 状态为 done
