# Plan: web-view 模块

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 一个包里两侧：`packages/fjs-webview/flutter/lib/fjs_webview.dart`（app）与 `packages/fjs-webview/components/WebViewWeb.vue`（web）。props 与事件载荷由模块的 `index.ts` 共用一份定义，页面源码一行不改跑两端。抹不平的两处（脚本注入、iframe 的 error）在 spec §4 已登记 |
| II 边界即契约 | 是（一张） | 事件类型表：`fjs-runtime/src/ui/element.ts` 加 `onMessage: 29`，`flutter_fjs/native/include/fjs.h` 加 `FJS_EVENT_MESSAGE = 29` 并把 26/27 改名 `FJS_EVENT_LOAD` / `FJS_EVENT_ERROR`（值不变），`flutter_fjs/lib/src/ffi.dart` 同步。**号由核心发**：模块只使用，不自己造——否则两个模块撞号谁也发现不了 |
| III 同步单线程零序列化 | 是（要说清楚） | WebView 自带另一套渲染与 JS 引擎，那是它的本质，不是 fjs 引入的桥。fjs 这侧没有新增异步等待：`@message` 走既有 dispatchEvent，和触摸事件同一条路。**网页里拿不到 fjs 的 natives**，两个 JS 世界只由 `@message` 的字符串相连，写进 `docs/ui-api.md` |
| IV 外观照 WeUI | 否 | 内容全部由网页自己画。fjs 只保证盒子：无边框、无默认背景，两端一致 |
| V 静默失效是 bug | 是 | 非法 scheme `warnOnce` 后不加载；没有尺寸时 `warnOnce` 并渲染零高盒子；`asset://` 指向不存在的文件时，app 侧 dev 能拿到 404 → 派 `@error`，web 侧拿不到（iframe 限制，已登记）。web 收到形状不对的 postMessage 直接忽略，**不告警**——那是页面里别人的消息，不是错误 |
| VI 注释记录权衡 | 是 | `fjs_webview.dart` 写「为什么 webview_flutter 而不是 flutter_inappwebview」「为什么 `@error` 只认主文档」「asset:// 的三条解析路径」；`WebViewWeb.vue` 写「为什么 error 不可靠」「为什么按 source + `__fjs` 双重过滤」 |
| VII JS 能包就不要下 Dart | 是 | 包不了：`web-view` 要的是一个**平台渲染引擎**（WKWebView / iframe），JS 侧既没有这个能力，也没有可替代的信息。这正是 VII 里「需要平台控件」那一条。`registry/component.dart` 的注释本来就写着「这是 platform view 的扩展点」。落 Dart 的只有 widget；scheme 校验、载荷编码、终态互斥留在模块的 JS 侧共用 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`、`docs/web.md`、`docs/modules.md`（模块带静态资源）、`docs/roadmap.md` |

破例：无。核心的 `environment.sdk` 不动，这正是做成模块的收益（§3.1）。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 核心 JS runtime | `packages/fjs-runtime/src/ui/element.ts` | `EventType` 加 `onMessage: 29`（模块用得上，号仍归核心）|
| 核心 C++ | `packages/flutter_fjs/native/include/fjs.h` | 加 `FJS_EVENT_MESSAGE = 29`；26/27 改名 `FJS_EVENT_LOAD` / `FJS_EVENT_ERROR`（值不变，注释写清载荷随标签而定）。C++ 不解释事件号，**不需重编 native** |
| 核心 Dart | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.message = 29`；`imageLoad`/`imageError` 改名 `load`/`error` |
| | `packages/flutter_fjs/lib/src/widgets/image.dart` | 跟着改名的唯一调用点 |
| 模块（新） | `packages/fjs-webview/package.json` | 清单：`fjs.module`、`fjs.widgets['web-view']`（web 替身 + props）、`fjs.flutter`（包名 `fjs_webview` / import / `FjsWebview.register(engine)`）、`fjs.prepare` |
| | `packages/fjs-webview/index.ts` | 共用语义：三种载荷编码（字段序固定）、`src` 的 scheme 校验与告警、终态互斥状态机、`asset://` 解析 |
| | `packages/fjs-webview/components/WebViewWeb.vue` | web 侧：`<iframe>`、`src` 生命周期、`load`/`error` 转发、`window` 的 `message` 监听（`event.source === iframe.contentWindow` 且形如 `{__fjs: string}`）|
| | `packages/fjs-webview/public/demo.html` | 模块自带的示例网页：带 shim、一个按钮 `fjs.postMessage(...)`、显示自己拿到的 URL 参数 |
| | `packages/fjs-webview/prepare.mjs` | 把 `public/` 复制进 `.fjs/modules/webview/`；`platform === 'web'` 时另外复制进应用的 `public/fjs-modules/webview/`（§3.3）|
| | `packages/fjs-webview/flutter/pubspec.yaml` | `fjs_webview`，依赖 `flutter_fjs` + `webview_flutter: ^4.10.0`，`sdk: ^3.5.0`（照 `fjs_iconmind` 的写法）|
| | `packages/fjs-webview/flutter/lib/fjs_webview.dart` | `FjsWebview.register(engine)` → `engine.components.register('web-view', …)`；`WebViewController` + `WebViewWidget`、`NavigationDelegate`、`JavaScriptChannel('fjs')`、`asset://` 的两条路径 |
| | `packages/fjs-webview/flutter/test/` | Dart 侧用例 |
| 示例 | `examples/hello-fjs/package.json` | 加依赖 `@ufjs/webview: workspace:*` |
| | `examples/hello-fjs/src/pages/comp/web-view.vue`（新） | 「一半原生一半网页」的布局、切 `src`（外部 URL ↔ `asset://demo.html`）、双向消息 |
| 文档 | `docs/ui-api.md` / `docs/web.md` / `docs/modules.md` / `docs/roadmap.md` | 见宪法自查 VIII |

路径核对：`packages/fjs-iconmind/{package.json,index.ts,prepare.mjs,components/,flutter/}`
都在；`fjs dev` 的 `/modules/<name>/<path>` 在 `packages/fjs/src/dev/server.ts:671`；
release 的资产复制在 `packages/fjs/src/commands/run.ts:190` 与
`packages/fjs/src/bundler/build.ts:665`；模块 widget 的注册点是
`packages/flutter_fjs/lib/src/registry/component.dart:27`，它的注释本来就写着这是
platform view 的扩展点。

## 3. 方案

### 3.1 为什么模块比内置标签好（不只是「够用」）

`flutter pub add --dry-run webview_flutter` 解出 `webview_flutter 4.10.0` +
`webview_flutter_android 4.3.2` + `webview_flutter_wkwebview 3.22.0` +
`webview_flutter_platform_interface 2.13.0`。三件事查证过：

1. **Dart SDK**：4.9.0 与 4.10.0 都要求 `sdk: ^3.5.0`。`flutter_fjs` 现在声明
   `>=3.3.0 <4.0.0`——做成内置标签就得把核心抬到 3.5，**所有不用 web-view 的应用一起
   受限**。做成模块，这条约束只落在 `fjs_webview/pubspec.yaml`（`fjs_iconmind` 已经是
   `sdk: ^3.5.4`，有先例），装的人才付。
2. **iOS 最低版本**：`webview_flutter_wkwebview 3.22.0` 的 podspec 是
   `ios.deployment_target = '12.0'`，示例工程本来就是 12.0，不用抬。
3. **包体**：iOS 用系统 WKWebView、Android 用系统 WebView，插件只是薄封装。

被否掉的：**`flutter_inappwebview`**——功能多得多（拦截、注入、cookie），但那些全在
spec §2 的 Non-goals 里；契约稳定后换实现不影响页面。

### 3.2 事件号：26/27 改名不改值，只新增 29

模板里 `@load` 给出的 prop 就是 `onLoad`，`element.ts` 已经把它映到 26。要让 web-view
用另一个号，就得让页面写 `@webviewload` 之类——为了枚举好看让页面写起来别扭，方向反了。

所以值不动、含义放宽，`ffi.dart` 的 `imageLoad`/`imageError` 跟着改名，调用点只有
`widgets/image.dart` 一处。`@message` 是新语义，新登记 29。

**模块不自己造号**：号段是三张表的事（宪法 II）。模块能拿到 `dispatch(nodeId, type)`，
爱发什么号都行，正因如此更要写死一条规矩——否则两个模块撞号，谁也发现不了。

### 3.3 `asset://`：一条 src，三处解析

模块带 `public/`，prepare 钩子把它摊进 `.fjs/modules/webview/`（这是现成机制，
`docs/modules.md` 已有）。页面永远只写 `asset://demo.html`：

| 场景 | 解析成 | 谁提供 |
|---|---|---|
| app dev | `http://<devHost>/modules/webview/demo.html` | `fjs dev` 已有的 `/modules/` 路由（server.ts:671）|
| app release | `assets/fjs/modules/webview/demo.html` | `WebViewController.loadFlutterAsset` |
| web | `/fjs-modules/webview/demo.html` | vite 的静态服务 |

Dart 侧怎么知道自己是 dev 还是 release：`flutter_fjs` 的引擎本来就带着 dev server 地址
（`FJS_DEV` dart-define），有就是 dev。

**web 那一栏需要一个额外动作**：vite 不服务 `.fjs/`，所以 prepare 在
`platform === 'web'` 时把 `public/` 另外复制一份进应用的 `public/fjs-modules/webview/`。
这是 prepare 钩子第一次写到 `outDir` 之外，属于**有意的例外**，要在
`docs/modules.md` 写清楚：静态网页资源和「生成的数据」不同，它必须被 HTTP 服务到，而
应用的 `public/` 是 web 上唯一不用改 vite 配置就能做到这点的地方。

**实现中发现的一处**：`fjs dev` 的 `/modules/` 路由把 content-type 写死成
`application/json`（`packages/fjs/src/dev/server.ts:707`）——它是为 iconmind 的
`icons.json` 写的，那时唯一的消费者就是 JSON。喂给 WKWebView 一个
`application/json` 的 HTML，它老老实实把源码当文本显示（黑底白字的一屏 `<!doctype
html>`）。**`@load` 照常派、URL 也对**，所以只看事件是发现不了的，得看屏幕。修法是按
扩展名给 content-type。

被否掉的：
- **让 web 组件 `import('fjs/data/demo.html?url')`**——能用，但把「哪个文件是页面」写死
  在了组件里，模块带第二个页面就得改代码；
- **给 vite 插件加一条 `.fjs/modules` 的静态路由**——只解决 dev，`vite build` 之后那些
  文件仍然不在产物里。

### 3.4 消息通道：两端形状不同，契约相同

| | Flutter | Web |
|---|---|---|
| 网页调什么 | `fjs.postMessage(str)` | 同左（网页自带 shim）|
| 宿主怎么收 | `JavaScriptChannel(name: 'fjs')` | `window` 的 `message` |
| 怎么过滤 | 不需要，这个 channel 只属于这个 webview | **双重过滤**：`event.source === iframe.contentWindow` 且形如 `{__fjs: string}` |
| 派给页面 | `{"data":"…"}` | 逐字符相同 |

被否掉的：**用 `srcdoc` 或同源代理来实现 web 侧注入**。前者只能加载自己拼的 HTML，不是
「嵌一张外部网页」；后者要求应用自己架反向代理，把渲染器的能力变成运维问题。

### 3.5 布局与生命周期

`web-view` 是普通节点，`decorateNode` 已经把盒子画好，widget 只负责填满给到的约束：

| 约束 | 行为 |
|---|---|
| 有界 | 填满，正常渲染 |
| 主轴无界（在 scroll-view 里且没写高度）| **零高 + `warnOnce`**。WebView 没有 intrinsic height，猜一个只会得到所有人都意外的数字 |
| 空 `src` | 空盒子，不建控件、不发请求 |

`WebViewController` 随 State 创建、dispose 释放；`src` 变化调 `loadRequest` 并 bump 一个
generation，旧页面回来的 `onPageFinished` 与 channel 消息按 generation 丢弃（照
`widgets/image.dart` 的 `_generation`）。

### 3.7 release 才暴露的两处（实现中发现）

**一、`loadFlutterAsset` 不接查询串。** `asset://demo.html?q=hello` 在 dev 是一个
HTTP URL，查询串天然合法；到了 release，同一个字符串被拿去 bundle manifest 里查
**键**，于是 `FWFURLParsingError: Failed to find asset with filepath
…/demo.html?q=hello`——文件在，键不在。修法是 asset 键截断 `?` / `#`，并且**丢了
查询串要 `warnOnce`**：dev 留着、release 丢掉，不说出来就是一个只在真机 release 才
现形的差异。两端各补了用例。

**二、iOS 模拟器上 CJK 变豆腐块，和编码无关。** 三步排除：

1. 服务端字节是合法 UTF-8（`e6 a8 a1` = 模），响应与磁盘文件逐字节相同，
   `content-type: text/html; charset=utf-8`；
2. 同一份文件换 vite 服务，模拟器里**一样**是豆腐块——排除 fjs dev server；
3. 同一个 WebView 里打开 m.baidu.com，中文**正常**——排除「模拟器没有中文字体」。

真正的原因是页面的 font stack 以 `-apple-system` / `system-ui` 开头：模拟器的
web content 进程把它解析成一张没有 CJK 回退的字体，后面即使显式写了
`"PingFang SC"`、末尾还有 `sans-serif` 也不再回退。把这一行换成不以
`-apple-system` 开头的 stack，中文立刻正常。这是**页面作者会踩的坑**，不是 fjs 的
bug，但示例页得写对，并且值得记进文档。

## 4. 风险

1. **iOS 平台视图与 fjs 手势的关系**。WKWebView 是平台视图，放进 fjs 的
   `GestureDetector` 体系后滚动手势归谁，是 iOS 上才暴露的问题——`form` 就是这么栽过一次
   （specs/007 §3.8）。widget 测试证明不了，**必须在模拟器上真滚一次**。
2. **`@error` 在 web 上基本不来**（spec §4 已登记）。文档没写清就会有人拿它做失败重试，
   然后在浏览器上永远等不到。要给替代方案：让网页自己发 `ready`。
3. **prepare 写到 `outDir` 之外**（§3.3）。写错路径就是往用户的 `public/` 里拉屎，
   目录名要固定 `fjs-modules/<name>/`，且只在 web 平台做。
4. **零高盒子的告警会不会误伤**：`flex-grow: 1` 的父容器首帧可能给不出高度，判定要放在
   拿到真实约束之后，`warnOnce` 的 key 带 node id。
5. **模块的 Dart 测试没人跑**。`fjs_iconmind` 的 `flutter/` 下没有 test 目录，CI 也只跑
   `packages/flutter_fjs`。新模块要自带 `flutter/test/` 并在验收里显式跑一次，否则等于没测。
6. **两个 JS 世界互不相通**容易被误解——文档要明说，否则会有人在网页里
   `import { toast } from 'fjs'` 然后来问为什么白屏。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test                      # 含模块自己的 vitest
pnpm --filter hello-fjs run typecheck

cd packages/fjs-webview/flutter && flutter pub get && flutter test && flutter analyze
cd packages/flutter_fjs && flutter test          # 26/27 改名不能碰坏 image

# Web：新示例页逐条走 spec §6.5 与 §6.7
pnpm --filter hello-fjs run dev:web

# iOS 模拟器：同一页，重点「网页能滚」「asset:// 能加载」「消息能回来」；Android 不测
pnpm --filter hello-fjs run run:ios

# release 产物核对（不跑真机）
pnpm --filter hello-fjs run build:pages && ls examples/hello-fjs/.fjs/flutter/assets/fjs/modules/webview/
```

两端对拍：同一个 `src` 看 `@load` 载荷是否逐字符相同；网页里点按钮，看 `@message` 的
`{"data":…}` 是否一致；换 `src` 后旧页面再发消息确认不回派；web-view 与原生内容并排，
确认没有铺满整页。
