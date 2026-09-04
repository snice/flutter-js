# Tasks: web-view 模块

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/ui/element.ts` 的 `EventType` 加 `onMessage: 29`。**号归核心发，模块只使用**（plan §3.2）。
- [x] T002 在 `packages/flutter_fjs/native/include/fjs.h` 加 `FJS_EVENT_MESSAGE = 29`，并把 `FJS_EVENT_IMAGE_LOAD` / `_IMAGE_ERROR` 改名成 `FJS_EVENT_LOAD` / `FJS_EVENT_ERROR`（**值不变**），注释写清载荷形状由标签决定。C++ 不解释事件号，不需重编 native。
- [x] T003 在 `packages/flutter_fjs/lib/src/ffi.dart` 加 `FjsEvent.message = 29`，把 `imageLoad` / `imageError` 改名成 `load` / `error`，注释同上。
- [x] T004 改 `packages/flutter_fjs/lib/src/widgets/image.dart` 跟上改名（唯一调用点），跑一次 `cd packages/flutter_fjs && flutter test` 确认 image 那组用例仍全绿——**这一步单独绿了再往下**。

## 实现

### 模块骨架

- [x] T010（顺带：`pnpm-workspace.yaml` 的包列表是写死的，新模块要加一行，否则 pnpm 根本看不见它）新建 `packages/fjs-webview/package.json`：`@ufjs/webview`，照 `packages/fjs-iconmind/package.json` 的形状写 `fjs.module` / `fjs.widgets['web-view']`（web 替身 + props）/ `fjs.flutter`（`fjs_webview`、import、`FjsWebview.register(engine)`）/ `fjs.prepare`，peerDependencies 对齐 iconmind。
- [x] T011 新建 `packages/fjs-webview/index.ts`：共用语义——三种载荷编码（`{"src":…}` / `{"src":…,"errMsg":…}` / `{"data":…}`，字段顺序固定）、`src` 的 scheme 校验与告警文案、「同一 src 只派一个终态」的状态机、`asset://` 解析（三种场景见 plan §3.3）。不依赖 Vue / DOM。
- [x] T012 在 `packages/fjs-webview/` 加 vitest 配置与 `test` 脚本，确认 `pnpm test` 能带上这个包（plan §4 风险 5：模块的测试没人跑就等于没测）。

### web 侧

- [x] T013 新建 `packages/fjs-webview/components/WebViewWeb.vue`：`<iframe class="fjs-web-view">`，`src` 生命周期（换 src bump generation）、`load` / `error` 转发、无边框默认盒模型。
- [x] T014 在 `WebViewWeb.vue` 接入 `window` 的 `message` 监听：**双重过滤** `event.source === iframe.contentWindow` 且形如 `{__fjs: string}`；形状不对的直接忽略且**不告警**（那是页面里别人的消息）。注释写清 web 的 `error` 为什么不可靠（plan §3.4 / spec §4）。

### app 侧

- [x] T015（顺带：加了 `dependency_overrides: flutter_fjs: {path: ../../flutter_fjs}`——模块用到的 `FjsEvent.message` / `.load` 在 checkout 里而不在已发布的 0.1.1 里，不覆盖的话模块自己的 `flutter test` 根本编不过。pub 对使用者会忽略这段，只在本包是根时生效）新建 `packages/fjs-webview/flutter/pubspec.yaml`：`fjs_webview`，依赖 `flutter_fjs` + `webview_flutter: ^4.10.0`，`sdk: ^3.5.0`，`publish_to: none`——照 `fjs_iconmind/flutter/pubspec.yaml`。跑 `flutter pub get` 确认解析结果与 plan §3.1 一致。
- [x] T016 新建 `packages/fjs-webview/flutter/lib/fjs_webview.dart`：`FjsWebview.register(engine)` → `engine.components.register('web-view', …)`；`WebViewController` + `WebViewWidget`，随 State 创建、dispose 释放，`src` 变化 `loadRequest` 并 bump generation（照 `widgets/image.dart` 的 `_generation`）。
- [x] T017 在 `fjs_webview.dart` 接 `NavigationDelegate`：`onPageFinished` → `FjsEvent.load`，`onWebResourceError`（**只认主文档**）→ `FjsEvent.error`；终态互斥、按 generation 丢弃旧页面的回调。
- [x] T018 在 `fjs_webview.dart` 接 `JavaScriptChannel(name: 'fjs')`，收到的字符串编成 `{"data":…}` 派 `FjsEvent.message`；注释写清网页侧 `fjs.postMessage` 的契约。
- [x] T019 在 `fjs_webview.dart` 实现 `asset://` 的两条路径：dev 走 `http://<devHost>/modules/webview/<path>`（引擎带着 `FJS_DEV`，有就是 dev），release 走 `loadFlutterAsset('assets/fjs/modules/webview/<path>')`。
- [x] T020 在 `fjs_webview.dart` 实现布局三态：有界填满、主轴无界时**零高 + `warnOnce`**（判定放在拿到真实约束之后，key 带 node id）、空 `src` 不建控件不发请求（plan §3.5、§4 风险 4）。

### 静态资源

- [x] T021 新建 `packages/fjs-webview/public/demo.html`：自带 shim、一个按钮调 `fjs.postMessage(...)`、显示自己拿到的 URL 参数与 `window.fjs` 是否存在。
- [x] T022 新建 `packages/fjs-webview/prepare.mjs`：把 `public/` 摊进 `.fjs/modules/webview/`；`platform === 'web'` 时**另外**复制进应用的 `public/fjs-modules/webview/`。目录名写死，只在 web 平台做（plan §4 风险 3）。

## 两端对齐

- [x] T023 在 `examples/hello-fjs/package.json` 加 `@ufjs/webview: workspace:*`，确认 autolink 生效（`fjs modules` 能看到、`src/fjs-modules.d.ts` 里有 `web-view` 的类型）。
- [x] T024 两端对拍：同一个 `src` 的 `@load` 载荷逐字符相同；网页里点按钮后 `@message` 的 `{"data":…}` 一致；换 `src` 后旧页面的消息不回派；`asset://demo.html` 在 web 与 app dev 上都能加载。

## 测试

- [x] T030 新增 `packages/fjs-webview/test/payloads.test.ts`：三种载荷的字段顺序与编码、终态互斥、`src` 切换丢弃旧结果。
- [x] T031 新增 `packages/fjs-webview/test/src-resolve.test.ts`：合法/非法 scheme 的判定与 `warnOnce`、`asset://` 在 app-dev / app-release / web 三种场景下解析成的 URL。
- [x] T032（**抓到一个真 bug**：换 `src` 后旧 iframe 还活着并把它的 `load` 报成了新 URL 的——generation 门挡不住，因为监听器是同一个闭包。加了 `event.target === frame.value` 这道判定）新增 `packages/fjs-webview/test/web-view-web.test.ts`：iframe 的 `src` 生命周期、`load` / `error` 转发、message 的双重过滤（source 不对、形状不对都不派）。
- [x] T033（构造 `WebViewController` 需要平台实现，widget 测试里没有，所以把「一次加载只报一个终态」和「盒子要有界」抽成了 `FjsWebViewLoadCycle` / `fjsWebViewFitsBox` 两个可单测的东西；**没被单测覆盖的是「NavigationDelegate 确实接到了这个 cycle 上」，那条只能靠模拟器**）新增 `packages/fjs-webview/flutter/test/web_view_test.dart`：`src` 变化重新加载、`@load` / `@error` 单次派发、channel 消息变成 `{"data":…}`、空 `src` 不建控件、没有尺寸时的 `warnOnce`。
- [x] T034 新增 `examples/hello-fjs/src/pages/comp/web-view.vue`：一半原生一半网页的布局、切 `src`（外部 URL ↔ `asset://demo.html`）、双向消息、显示最近一次 `@load` / `@message` 载荷。
- [x] T035 Web 验证：`pnpm --filter hello-fjs run dev:web`，逐条走 spec §6.5 与 §6.7。
- [x] T038（并加了 `packages/fjs/test/module-content-type.test.ts` 盯着它） 改 `packages/fjs/src/dev/server.ts` 的 `/modules/` 路由：按扩展名给 content-type，别再写死 `application/json`（plan §3.3 实现中发现：WKWebView 拿到 `application/json` 的 HTML 会把源码当文本显示，而 `@load` 照常派，只看事件发现不了）。
- [x] T039 修 `asset://` 在 release 下的查询串（plan §3.7）：Flutter asset 是 manifest 里的**键**，`demo.html?q=hello` 不是任何文件，`loadFlutterAsset` 抛 `FWFURLParsingError`；dev 是 HTTP URL 所以不受影响。两端截断 `?`/`#` 并 `warnOnce`，各补用例。
- [x] T036 iOS 模拟器验证（网页正常显示、**能在自己盒子里滚**、`asset://` 走 dev server、`@message` 双向通、外部网页正常；另见 plan §3.7 的两处 release/模拟器发现）：`pnpm --filter hello-fjs run run:ios`，同一份对照项，**重点是网页能不能滚**（plan §4 风险 1：平台视图与 fjs 手势竞技场，widget 测试证明不了）。**Android 不测**。
- [x] T037（`build:release` 后 `.fjs/flutter/assets/fjs/modules/webview/demo.html` 与 `Release-iphoneos/App.framework/flutter_assets/assets/fjs/modules/webview/demo.html` 都在） release 产物核对：`pnpm --filter hello-fjs run build:pages` 后确认 `.fjs/flutter/assets/fjs/modules/webview/demo.html` 存在（只验产物，不跑真机 release）。

## 文档

- [x] T040 更新 `docs/ui-api.md`：`web-view` 的 props / 事件表、它是模块（要先装）、布局不铺满整页的差异、`@message` 立即派与小程序的差异、网页侧 shim、**两个 JS 世界互不相通**、链接里中文要 encodeURIComponent 的提醒。
- [x] T041 更新 `docs/web.md`：iframe 的 `error` 不可靠（给出「让网页自己发 ready」的替代方案）、跨源注入不了脚本、双重过滤的理由。
- [x] T042 更新 `docs/modules.md`：模块带静态网页资源这条路子（`public/` → `.fjs/modules/<name>/` → dev server / Flutter asset / 应用 `public/`），并写明「写到 outDir 之外」是有意的例外及其理由。
- [x] T043 更新 `docs/roadmap.md`：登记完成，写清 `webview_flutter` 只落模块、核心的 Dart SDK 下限没动，以及 26/27 改名不改值这件事。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm --filter hello-fjs run typecheck`
- [x] T052 `pnpm test`（必须包含 `packages/fjs-webview` 的用例）
- [x] T053 `cd packages/fjs-webview/flutter && flutter test && flutter analyze`（`No tests ran` 视为失败）
- [x] T054 `cd packages/flutter_fjs && flutter test`（26/27 改名不能碰坏 image）
- [x] T055 spec.md 第 6 节逐条核对，记录两端对拍结果、release 产物核对结果与任何已登记差异

## 验收记录

对着 spec.md 第 6 节逐条：

1. **typecheck** 五个包全 Done；`web-view` 的 `src` 与三个事件在 hello-fjs 模板里有
   类型（走模块生成的 `src/fjs-modules.d.ts`）。
2. **`pnpm test`** 3 + 30 + 7 个文件，30 + 230 + 66 条全过。模块自己的三组用例
   （载荷与 cycle、src 解析、web 组件）都在 `pnpm test` 里跑——`pnpm-workspace.yaml`
   的包列表是写死的，新模块要加一行才看得见。
3. **`cd packages/fjs-webview/flutter && flutter test`** 16 passed，`flutter analyze`
   无问题。
4. **`cd packages/flutter_fjs && flutter test`** 218 passed / 3 skipped——26/27 改名
   没碰坏 image。analyze 的 2 条是既有 info。
5. **Web 操作验收**：`asset://demo.html?q=hello` 解析成
   `/fjs-modules/webview/demo.html?q=hello` 并加载；`@load` 报同一个 URL；网页里点两次
   按钮收到 `hello #1 (hello)` / `hello #2 (hello)`，加上自动的 `ready`；换成外部 URL
   后 `@load` 报新的 src，旧页面的消息不再回派。
6. **iOS 验收**：`asset://` 走 dev server 加载；网页**在自己的盒子里滚动**（plan §4
   风险 1，widget 测试证明不了的那条）；`fjs.postMessage` 经 JavaScriptChannel 回到
   `@message`，载荷与 web 相同；外部网页（m.baidu.com）正常显示且中文正常。
   **Android 未测**。
7. **布局**：两端都确认 web-view 只占自己的盒子，上面的按钮行和下面的说明文字都还在。
8. **release 产物**：`build:release` 后 `.fjs/flutter/assets/fjs/modules/webview/demo.html`
   在；用户在 `Release-iphoneos/App.framework/flutter_assets/` 下也确认了同一个文件。
9-10. 文档四处已更新（ui-api / web / modules / roadmap）。

**实机才暴露的三个问题**（都已修 + 补用例）：dev server 的 `/modules/` content-type
写死 `application/json`（WebView 把 HTML 当文本显示，`@load` 照常派）；release 下
`asset://` 带查询串会抛 `FWFURLParsingError`（asset 是 manifest 的键不是 URL）；
web 侧换 `src` 后旧 iframe 把 `load` 报成了新 URL 的。

**已登记差异**：web 的 `@error` 基本不来（iframe 限制，替代方案是让网页自己发
`ready`）；web 注入不了脚本，网页要自带 shim；release 下 `asset://` 不能带查询串。

**一条排查结论（不是 bug）**：iOS 模拟器里网页中文显示成豆腐块，与编码、与 dev server
都无关——同一份字节换 vite 服务一样，同一个 WebView 打开 m.baidu.com 中文正常；原因是
页面 font stack 以 `-apple-system` / `system-ui` 开头时模拟器不往 CJK 回退。真机不受
影响，示例页已换掉那一行。
