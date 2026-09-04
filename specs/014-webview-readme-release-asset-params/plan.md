# Plan: web-view 文档与 release asset 参数

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | Web 侧保持 `WebViewWeb.vue` 的完整 query/fragment URL；Flutter 侧在 release asset 的首次导航决策阶段恢复同样的 URL 参数语义，README 说明两端行为 |
| II 边界即契约 | 否 | 不改 UI op、natives 表、事件号或 FFI；只改模块内部 Dart/TS 辅助逻辑 |
| III 同步单线程零序列化 | 是 | 只使用 WebView 已有导航回调和本地 asset 加载，不新增 JS↔Dart 数据桥；参数只作为 URL 字符串处理 |
| IV 外观照 WeUI | 否 | 不涉及内置组件外观 |
| V 静默失效是 bug | 是 | 无法恢复的 asset 路径继续告警/不加载；release 参数恢复失败不能静默丢失，测试会覆盖 redirect 与最终 load |
| VI 注释记录权衡 | 是 | 在 release asset 的导航重写处记录 Flutter asset key 与页面 URL 分离的原因，以及为什么必须在页面脚本前完成 |
| VII JS 能包就不要下 Dart | 否 | 问题是 Flutter WebView 平台 API 对 asset key 与 URL 参数的差异，必须在 Dart 原生控件层处理；不是可由 JS 组件解决的组织逻辑 |
| VIII 变更落到文档 | 是 | 新增 `packages/fjs-webview/README.md`；必要时同步 `docs/ui-api.md` 的 release asset 参数说明，避免文档继续声称参数会被丢弃 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime / 模块公共逻辑 | `packages/fjs-webview/index.ts` | 将 asset 的文件 key 与页面 URL 后缀分开表达；为 app release 提供保留 query/fragment 的目标信息与测试辅助函数 |
| Dart 宿主模块 | `packages/fjs-webview/flutter/lib/fjs_webview.dart` | release `asset://` 仍用无参数 key 加载真实文件，并通过首次导航请求重写到带 query/fragment 的同一文件 URL；确保初始页面脚本即可读取参数，终态事件仍只派一次 |
| Web 适配模块 | `packages/fjs-webview/components/WebViewWeb.vue` | 核对并保持现有 query/fragment 透传；如公共解析逻辑调整，跟随新返回结构 |
| JS 测试 | `packages/fjs-webview/test/src-resolve.test.ts`、`packages/fjs-webview/test/web-view-web.test.ts` | 覆盖 release 目标拆分、web URL 保留参数和 src 生命周期不回归 |
| Dart 测试 | `packages/fjs-webview/flutter/test/web_view_test.dart` | 覆盖 asset key、导航 URL 重写、参数编码、无参数路径和相对资源基准 |
| 文档 | `packages/fjs-webview/README.md`、`docs/ui-api.md` | 补模块使用说明，修正 release `asset://` 参数行为说明 |
| 示例 | `examples/hello-fjs/src/pages/comp/web-view.vue` | 保留/补充带 query 与 fragment 的 asset 示例，便于 dev/web/release 对照 |

## 3. 方案

### 3.1 选定做法

把 `asset://` 拆成两部分：

- **asset key**：去掉 query 与 fragment，只用于 `loadFlutterAsset` 查找
  `assets/fjs/modules/webview/<path>`；
- **document suffix**：保留原始 query 与 fragment，用于页面真正导航到同一个本地文件时
  的 URL。

Flutter release 仍先调用 `loadFlutterAsset(assetKey)`，这样继续复用
`webview_flutter` 对 Android/iOS asset 路径和相对资源访问的处理。对这次本地导航，在
`NavigationDelegate.onNavigationRequest` 收到平台解析出的真实文件 URL 时，构造同路径的
带 query/fragment URL，调用 `loadRequest` 并阻止无参数的首次导航。这样页面业务脚本第一
次执行时就能看到正确的 `location.search` / `location.hash`，同时不需要猜测不同平台的
asset 绝对路径，也不破坏相对资源的基准目录。

为防止再次触发 redirect，按当前 load generation 记录一次性 redirect 状态，并只对
release asset 的初始无参数导航生效。没有参数时继续走原有 `loadFlutterAsset` 快路径。

公共 TS/Dart 解析函数都返回“文件 key + 页面后缀”的可验证形状；事件 payload 仍使用
用户传入的完整 `src`，不把内部 file URL 泄露成新的模块契约。

### 3.2 被否掉的备选

1. **直接把带 query 的字符串传给 `loadFlutterAsset`**：Flutter asset 查找按 manifest
   key 进行，`demo.html?q=x` 不是文件键，会抛 `FWFURLParsingError`。
2. **截断 query/fragment 并继续加载**：能规避异常但会静默丢参数，正是当前用户问题，
   且与 web/dev 不一致。
3. **加载 asset 内容后用 `loadHtmlString`**：虽然能插入参数，但需要为 Android/iOS
   猜测或重建本地资源 base URL；容易破坏 HTML 内相对资源加载，且会把大 HTML 读入 Dart
   再复制一次。
4. **页面加载完成后 `runJavaScript` 设置 `history`**：业务脚本已经执行，无法保证页面
   首次读取 `location.search` 时拿到参数；也可能造成额外 history/navigation 事件。
5. **只在 README 中规定页面自行读取宿主注入变量**：无法兼容现有按
   `location.search` 取参的 HTML，也没有解决 release 中 asset key 找不到的问题。

## 4. 风险

- 不同平台对 `loadFlutterAsset` 初始导航是否触发 `onNavigationRequest` 的时机可能有差异，
  必须通过 iOS/Android 可用的 integration 验证确认；若平台不回调初始本地导航，需要在
  同一模块内提供不依赖首次回调的等价早期重写路径，不能退回“加载后再注入”。
- redirect 不能再次被识别成新的初始页面，否则会循环导航或重复 `@load`；generation 与
  一次性标记需要单测。
- query/fragment 含引号、空格、Unicode 或 percent-encoding 时只能按 URL 原文拼接/解析，
  不能通过 `queryParameters` 重新编码后改变页面看到的内容。
- `@load.src` 是模块既有事件契约，必须继续是用户传入的 `asset://...`，不能因为内部
  使用 file URL 而改变两端对拍结果。
- README 与 `docs/ui-api.md` 若仍写“release 会丢参数”，会再次误导使用者，因此文档
  验收与代码验收绑定。

## 5. 验证路径

```bash
pnpm --filter @ufjs/webview run typecheck
pnpm test
cd packages/fjs-webview/flutter && flutter test
cd packages/fjs-webview/flutter && flutter analyze
cd /Volumes/zt/Documents/flutter-js
pnpm --filter hello-fjs run typecheck
pnpm --filter hello-fjs run dev:web
# 浏览器中确认 asset://demo.html?q=hello#top 能显示参数、@load/@message 正常
# 再用可用的 Flutter iOS/Android release 验证环境确认同一页面不报 asset 缺失
```
