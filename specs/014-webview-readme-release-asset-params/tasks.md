# Tasks: web-view 文档与 release asset 参数

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改 `packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/native-global.d.ts`、`packages/flutter_fjs/native/src/natives.cpp`、`packages/fjs-runtime/src/ui/element.ts` 或 `packages/flutter_fjs/native/include/fjs.h`。

## 实现

- [x] T010 在 `packages/fjs-webview/index.ts` 把 release asset 的文件 key 与 query/fragment 后缀拆成可复用、可测试的解析结果，并保留 web/app-dev 的完整 URL。
- [x] T011 在 `packages/fjs-webview/flutter/lib/fjs_webview.dart` 为带参数的 release `asset://` 初始导航增加一次性 URL 重写，确保页面首次执行脚本时能读取 `location.search` / `location.hash`，并保持相对资源路径。
- [x] T012 保持 `packages/fjs-webview/components/WebViewWeb.vue` 的 query/fragment 透传和事件代际隔离，跟进公共解析返回值变化。
- [x] T013 在 `examples/hello-fjs/src/pages/comp/web-view.vue` 保留一个带 query 与 fragment 的 `asset://` 示例，便于三端验收。

## 两端对齐

- [x] T020 对拍 `packages/fjs-webview/index.ts` 与 `packages/fjs-webview/flutter/lib/fjs_webview.dart` 的 asset key、页面参数后缀和 `@load.src` 语义。
- [ ] T021 确认 `packages/fjs-webview/public/demo.html` 在 web、app dev、app release 的页面初始脚本中显示同一组参数。

## 测试

- [x] T030 扩展 `packages/fjs-webview/test/src-resolve.test.ts`，覆盖 release key 与参数后缀拆分、编码参数、fragment 和无参数路径。
- [x] T031 扩展 `packages/fjs-webview/flutter/test/web_view_test.dart`，覆盖 release 初始导航 URL 重写、一次性 redirect、参数原文和相对资源基准。
- [x] T032 为 Flutter 侧 URL 重写抽出纯 Dart 辅助逻辑或可观察的 delegate 行为，避免测试依赖真实平台 WebView。

## 文档

- [x] T040 新增 `packages/fjs-webview/README.md`，说明安装、免 import/autolink、props/事件、两端实现、asset 页面、消息 shim、布局和 release 参数。
- [x] T041 更新 `docs/ui-api.md` 的 `asset://` 说明，删除“release 参数会丢弃”的过时表述，写清文件 key 与页面 URL 参数的区别。
- [x] T042 如实现细节影响平台差异说明，更新 `docs/web.md` 或 `docs/modules.md`，保持文档与实际加载路径一致。

## 验收

- [x] T050 `pnpm --filter @ufjs/webview run typecheck`
- [x] T051 `pnpm test`
- [ ] T052 `cd packages/fjs-webview/flutter && flutter test`（被本机 Flutter SDK lockfile 权限阻塞）
- [ ] T053 `cd packages/fjs-webview/flutter && flutter analyze`（被本机 Flutter SDK lockfile 权限阻塞；直接 `dart analyze` 已通过）
- [x] T054 `pnpm --filter hello-fjs run typecheck`
- [ ] T055 按 `spec.md` 第 6 节逐条核对 README、web/app-dev 行为、release asset 加载、参数读取、消息回传和无回归范围。
