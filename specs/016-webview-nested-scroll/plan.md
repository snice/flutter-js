# Plan: web-view 嵌套 Flutter 滚动

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Flutter 侧在 `packages/fjs-webview/flutter/lib/fjs_webview.dart` 为平台 WebView 配置手势接收；Web 侧 `components/WebViewWeb.vue` 不需要改，继续使用浏览器 iframe 自己的滚动机制。两端的页面 API 与事件契约不变，平台差异登记在文档中 |
| II 边界即契约 | 否 | 不修改 UI op、natives 表、事件类型或 FFI；手势集合只在 Flutter 模块内部传给 `webview_flutter` |
| III 同步单线程零序列化 | 否 | 不新增 JS/Dart 通信或异步桥，只改变平台 Widget 的手势识别配置 |
| IV 外观照 WeUI | 否 | 不涉及外观、尺寸默认值或控件样式 |
| V 静默失效是 bug | 是 | 通过 fake `WebViewPlatform` 检查手势集合确实传到平台视图，而不是只增加一个未使用的常量；真实嵌套滚动列入 iOS/可用设备操作验收 |
| VI 注释记录权衡 | 是 | 在 Flutter 实现处说明为什么使用 `EagerGestureRecognizer`，以及为什么只在 WebView 命中区域接管手势，不做滚动到边后的父级穿透 |
| VII JS 能包就不要下 Dart | 是 | 这是平台 WebView 与 Flutter 手势竞技场之间的配置问题。JS 组件无法访问 `webview_flutter` 的 `gestureRecognizers`，也不能改变原生平台视图的触摸分发，因此必须落在 Dart widget 层 |
| VIII 变更落到文档 | 是 | 更新 `docs/ui-api.md` 和 `packages/fjs-webview/README.md`，说明 Flutter `scroll-view` 嵌套规则与当前不做边界滚动传递；示例页增加真实嵌套场景 |

破例：无。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| Flutter 模块 | `packages/fjs-webview/flutter/lib/fjs_webview.dart` | 引入 Flutter 手势类型；定义模块内部复用的 `EagerGestureRecognizer` 集合；将集合传给 `WebViewWidget(gestureRecognizers: ...)`。保持 controller、导航回调、消息 channel 和布局逻辑不变 |
| Flutter 模块测试 | `packages/fjs-webview/flutter/test/web_view_test.dart` | 使用 fake `WebViewPlatform` 捕获 `PlatformWebViewWidgetCreationParams`，断言 WebView widget 创建时包含 eager 手势识别器；保留现有空 src、scheme、payload 与布局测试 |
| 示例 | `examples/hello-fjs/src/pages/comp/web-view.vue` | 把一个有明确高度的 WebView 放入 `scroll-view`，保留 WebView 上下的 Flutter 文本，便于验证内滚动、外滚动和消息回传 |
| 文档 | `packages/fjs-webview/README.md`, `docs/ui-api.md` | 记录 WebView 放入 Flutter `scroll-view` 时网页区域由 WebView 自己滚动、区域外由父滚动容器滚动；说明滚动到网页边缘时不自动把剩余拖拽转交给父容器 |

以下层不涉及：`packages/fjs-runtime/src/`、`packages/flutter_fjs/lib/src/widgets/scroll_view.dart`、
`packages/fjs-runtime/src/web/`、`packages/flutter_fjs/native/` 和 UI op/事件契约文件。

## 3. 方案

### 3.1 选定做法

`webview_flutter` 的 `WebViewWidget` 默认 `gestureRecognizers` 为空。该模式下平台 WebView
只接收没有被其它 Flutter recognizer 抢走的指针，而外层 `SingleChildScrollView` 会竞争垂直
拖拽，导致落在 WebView 内容上的拖动不能稳定进入网页滚动。

为 `WebViewWidget` 传入只包含 `EagerGestureRecognizer` 的集合。Flutter 的平台视图文档约定：
平台视图会接收由这些 recognizer 识别的指针，因此触点落在 WebView 矩形内时，WebView 可以
独占该触摸序列并处理网页内部滚动；触点落在 WebView 外时，平台视图不参与命中，外层
`scroll-view` 仍照常滚动。点击、链接、输入和 JavaScript channel 都继续由 WebView 自己处理。

手势集合放在模块内部，不增加页面 prop。这样所有使用 `<web-view>` 的页面自动得到一致行为，
也避免让页面作者理解 `webview_flutter` 的 Flutter 细节。

### 3.2 边界行为

- WebView 必须已经有有界高度；现有零高告警规则不变。
- WebView 内部滚动优先级高于父 `scroll-view`，包括网页内容在顶部或底部的情况。
- 本次不实现“网页滚到边后把剩余拖拽交给父级”的 nested-scroll handoff；这需要平台控制器
  回报网页滚动边界并参与 Flutter 手势状态机，属于另一项平台行为。
- Web 侧不增加人为 pointer 拦截；iframe 的原生滚动与现有浏览器行为保持不变。

### 3.3 被否掉的备选

1. **只给 WebView 添加 `VerticalDragGestureRecognizer`**：它仍然需要等待/竞争垂直拖拽，且会
   把 WebView 的滚动方向和平台视图的内部手势耦合起来；`webview_flutter` 已提供适用于平台
   视图嵌套滚动的 eager recognizer 机制，直接声明所有 WebView 内部指针归属更稳定。
2. **修改核心 `FjsScrollView` 的手势竞技场**：会影响所有 `scroll-view`、输入框、swiper 和
   其它平台组件，修复范围远超 WebView，并且无法知道某个命中的子节点是否能处理网页滚动。
3. **新增 `nested-scroll` / `gesture` 页面 prop**：当前所有 WebView 都需要这个修复，增加开关
   只会让同一模块出现两种默认行为，也没有解决现有页面的回归问题。
4. **在 WebView 外包一层 Flutter `GestureDetector` 或 `AbsorbPointer`**：会继续拦截或延迟
   平台视图的指针，可能修好父滚动却破坏网页点击、输入和 channel，不满足 WebView 的基本用途。
5. **滚动到边时手工同步父 controller**：当前模块拿不到 WebView 的可靠滚动边界，也无法跨
   iOS/Android 保证同一手势序列的时序；这次先保持明确且可验证的区域归属。

## 4. 风险

1. `EagerGestureRecognizer` 会让 WebView 矩形内的手势全部由平台视图消费，因此网页到边后父
   `scroll-view` 不会自动接管；这是明确的本次边界，需要文档和测试页避免误解。
2. 不同 `webview_flutter` 平台实现对 gesture set 的落地细节可能不同。fake widget 测试只能
   证明参数传递，必须在 iOS 模拟器或可用设备上实际拖动网页内容，并从兄弟节点拖动父列表。
3. WebView 若没有高度，在父 `scroll-view` 中仍是零高；测试页必须给固定 `height`，不能把布局
   问题误判为手势修复失败。
4. 平台视图创建参数属于插件 API，依赖版本升级可能改变类型签名；测试应使用当前 lockfile
   中的 `webview_flutter` / `webview_flutter_platform_interface` API，不新增依赖。

## 5. 验证路径

```bash
pnpm --filter @ufjs/webview run typecheck
pnpm test
pnpm --filter hello-fjs run typecheck

cd packages/fjs-webview/flutter
flutter test
flutter analyze

# Web 侧回归：iframe 行为没有改动
cd /Volumes/zt/Documents/flutter-js
pnpm --filter hello-fjs run dev:web

# Flutter 侧真实验证：同一页检查网页内滚动、兄弟节点触发父滚动、按钮消息回传
pnpm --filter hello-fjs run run:ios
```

固定操作：打开 `web-view` 示例页；在网页内容区域上下拖动，确认网页内部内容偏移；切换到
网页上方/下方的 Flutter 内容拖动，确认外层 `scroll-view` 偏移；点击网页按钮确认
`@message` 仍收到 `{"data":"..."}`；切换 `src` 后确认既有 load/message 代际隔离不回归。
