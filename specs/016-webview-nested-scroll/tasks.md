# Tasks: web-view 嵌套 Flutter 滚动

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [ ] T001 确认本需求不修改 `packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/native-global.d.ts`、`packages/flutter_fjs/native/src/natives.cpp`、`packages/fjs-runtime/src/ui/element.ts` 或 `packages/flutter_fjs/native/include/fjs.h`。

## 实现

- [ ] T010 在 `packages/fjs-webview/flutter/lib/fjs_webview.dart` 引入 Flutter 手势类型，并定义模块内部复用的 `EagerGestureRecognizer` 集合。
- [ ] T011 将该手势集合传给 `WebViewWidget(gestureRecognizers: ...)`，保留现有 WebView controller、导航回调、JavaScript channel、src 代际和布局逻辑。
- [ ] T012 在实现旁补充注释，说明 WebView 内外手势归属，以及本次不实现滚动到边后的父级滚动接管。

## 两端对齐

- [ ] T020 确认 `packages/fjs-webview/components/WebViewWeb.vue` 不需要增加 pointer 拦截，保持 iframe 的原生滚动和现有消息/加载生命周期。
- [ ] T021 更新 `examples/hello-fjs/src/pages/comp/web-view.vue`，增加有明确高度的 `<web-view>` 嵌套在 `<scroll-view scroll-y>` 中的验证布局，并保留 WebView 上下的 Flutter 内容。
- [ ] T022 对拍 Flutter 与 Web 的页面契约：两端均保持 `src`、`@load`、`@error`、`@message` 行为不变，且消息载荷仍为字符串 JSON。

## 测试

- [ ] T030 在 `packages/fjs-webview/flutter/test/web_view_test.dart` 增加 fake `WebViewPlatform`，捕获 `PlatformWebViewWidgetCreationParams` 的 gesture set。
- [ ] T031 增加测试断言：WebView widget 的 gesture set 包含 `EagerGestureRecognizer`，且现有空 src、非法 scheme、payload、布局和生命周期测试继续通过。
- [ ] T032 运行 Flutter 模块测试与静态分析，确认当前 `webview_flutter` lockfile API 下测试可编译、可执行。
- [ ] T033 在 Flutter 验证页中实际拖动 WebView 内容，确认网页内部滚动；从 WebView 外兄弟节点拖动，确认外层 `scroll-view` 滚动；点击网页按钮确认 `@message` 仍回传。

## 文档

- [ ] T040 更新 `packages/fjs-webview/README.md`，说明放入 Flutter `scroll-view` 时 WebView 内部滚动、外部区域父容器滚动，以及不提供滚动边界 handoff。
- [ ] T041 更新 `docs/ui-api.md` 的 `web-view` 说明，登记 Flutter 平台视图的嵌套滚动规则和 Web 侧沿用浏览器原生行为。

## 验收

- [ ] T050 `pnpm --filter @ufjs/webview run typecheck`
- [ ] T051 `pnpm test`
- [ ] T052 `pnpm --filter hello-fjs run typecheck`
- [ ] T053 `cd packages/fjs-webview/flutter && flutter test`
- [ ] T054 `cd packages/fjs-webview/flutter && flutter analyze`
- [ ] T055 `pnpm --filter hello-fjs run dev:web`，确认 Web iframe 回归：加载、消息、src 切换和浏览器滚动行为正常。
- [ ] T056 `pnpm --filter hello-fjs run run:ios`，按 spec 第 6 节逐条核对嵌套滚动、兄弟节点滚动、消息回传和无协议变更。
- [ ] T057 更新 `spec.md` 状态和验收记录，并逐条核对 spec 第 6 节。
