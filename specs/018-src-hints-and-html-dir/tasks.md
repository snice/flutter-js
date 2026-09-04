# Tasks: src 路径补全、根目录 html/、去掉模块的 public 副本

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

三张核心表（op 协议 / natives / 事件类型）都没动（plan §1 条款 II）。这一组要先
定的是两件**两侧都依赖**的事：`src` 的类型形状，和 `<web-view>` 那张模块自己的
双端 src 解析表。

- [x] T001 在 `packages/fjs-runtime/src/vue-global.d.ts`（或同目录新建
      `assets.d.ts` 并从 `index.ts` 带出）声明空的
      `interface FjsImageAssets {}` / `interface FjsHtmlAssets {}` 与
      `FjsImageSrc` / `FjsHtmlSrc`，照 `src/router/types.ts` L63-84 的
      `FjsRoutes` / `RoutePathRaw` 写法：`keyof X extends never ? string :
      Extract<keyof X, string> | (string & {})`。注释写明为什么留 `(string & {})`
      这一半（http、import 来的 hash 名、模板拼的串都不能挡）。
- [x] T002 `packages/fjs/src/project/assets.ts`（新建）：定义
      `ASSET_TYPES_FILE = src/fjs-assets.d.ts`、`scanLocalAssets(root)`
      （递归扫 `public/` 与 `html/`，按扩展名分图片 / html 两类，前缀分别是
      `/` 和 `/html/`）与 `assetTypesSource()`。整体照
      `fjs/src/project/pages.ts` L186-215 抄，**先不接调用点**。顶部注释写清
      「为什么是生成的全局接口，而不是构建期存在性校验」（plan §3 被否方案）。
- [x] T003 `packages/fjs-webview/index.ts`：`SrcKind` 加 `'local'`，
      `classifySrc` 认 `/` 开头的根路径，`resolveSrc` 三个 target 各加分支
      （web 原样 URL / app-dev 拼 `http://<devHost>/<path>` / app-release 返回
      `{kind:'flutter-asset', asset:'assets/fjs/public/<path>'}`）。
      `unsupportedSrcMessage` 的文案提到 `html/`。`asset://` 的老分支与
      `WEB_ASSET_BASE` 一个字不动。

## 实现

- [x] T010 `writeAssetTypes(root)` 接到四个调用点，全部跟在现有
      `writeRouteTypes(root)` 后面：`fjs/src/bundler/build.ts` 的
      `buildBundle()` 开头、`fjs/src/vite.ts` 的 `config()`、
      `fjs/src/dev/server.ts` L346 的首次生成、同文件 L477 的 watch 回调。
- [x] T011 `packages/fjs/src/dev/server.ts` 的 `generated` 集合（L452-456）
      加上 `path.basename(ASSET_TYPES_FILE)`。**漏了就是 reload 打转**：写生成
      文件 → 触发 watch → 再写（plan §4 头一条）。
- [x] T012 `packages/fjs-runtime/src/vue-global.d.ts`：`FjsImageProps.src`
      从 `string` 改成 `FjsImageSrc`。
- [x] T013 `packages/fjs-webview/components/WebViewWeb.vue` L27：
      `defineProps<{ src?: string }>()` → `src?: FjsHtmlSrc`。`<web-view>` 的
      标签类型就是这个组件的 props（`fjs/src/project/modules.ts` L601-613 的
      `FjsWidgetProps`），所以改这一处两端的标签都跟着变。
- [x] T014 `packages/fjs/src/bundler/build.ts` 的 `syncPublicAssets()`：
      把 `<root>/html/` 拷进 `<assets>/fjs/public/html/`。pubspec 的递归枚举
      （017 的 `publicAssetDirs`）自动带上，不用改它。
- [x] T015 `packages/fjs/src/dev/server.ts` 的 `bundleServer()`：在 017 加的
      `public/` 兜底之后再加一路 `<root>/html/`（URL 自带 `html/` 前缀，从 root
      起算即可）。
- [x] T016 `packages/fjs/src/bundler/build.ts` 的 `buildWeb()`：在
      `copyPublicDir(root, webOut)` 旁边拷 `<root>/html/` → `<webOut>/html/`，
      并把每个 `.fjs/modules/<name>/` 拷成 `<webOut>/fjs-modules/<name>/`
      （顶掉 prepare 钩子原来写进 app `public/` 的那份）。
- [x] T017 `packages/fjs/src/vite.ts`：给手写的 `VitePlugin` 接口（L52-63）补
      `configureServer` 与 `writeBundle` 两个成员并实现 —— dev 用中间件把
      `/html/*` 指到 `<root>/html/`、`/fjs-modules/<name>/*` 指到
      `moduleDataDir(root, name)`；build 时把这两棵树拷进 vite 的 outDir。
      注释写明为什么不用 `publicDir`（vite 只支持一个，会顶掉应用自己的）。
- [x] T018 `packages/fjs-webview/prepare.mjs`：删掉 `ctx.platform === 'web'`
      那一段（写进 app `public/fjs-modules/` 的副本），只保留 `ctx.write` 到
      `.fjs/modules/webview/`。顶部注释改写：唯一一份在哪、web 侧由谁给 URL。
- [x] T019 删 `examples/hello-fjs/public/fjs-modules/`。**必须在 T018 之后**：
      先删后改，下一次 `fjs dev --web` 就长回来了（plan §4）。

- [x] T019b （实现中新增）`packages/fjs/src/bundler/asset-check.ts`（新建）：
      扫每个页面 SFC 模板里 `<image src="…">` / `<web-view src="…">` 的
      **字面量**本地 src，文件不存在就 warn（哪个文件、写的什么、最接近的
      候选）。挂到 `buildBundle()` 里 `firstFrameNodeWarnings` 同一处，走
      同一条 warnings 通道。动态 `:src` 不碰 —— 宁可漏报不误报。

## 两端对齐

- [x] T020 Flutter 侧：`packages/fjs-webview/flutter/lib/fjs_webview.dart`
      L81-166，`FjsWebViewSrcKind` 加 `local`，`fjsClassifyWebViewSrc` /
      `fjsResolveWebViewSrc` 逐条镜像 T003 的三个分支。漏这一步的表现是
      web 能开、App 上判成 `unsupported` 只 warn 不抛（宪法 I + V）。
- [x] T021 `examples/hello-fjs/html/local.html`（新建，含一个子目录页面
      `html/policy/terms.html` 验证递归）+ `src/pages/comp/web-view.vue` 加一个
      「app 自己的本地页面」Panel，与现有的 `asset://demo.html` Panel 并排。
- [x] T022 两端对拍：`comp/web-view` 页的两个 Panel（模块自带的
      `asset://demo.html`、app 自己的 `/html/local.html`）在 `dev:web` 与
      `fjs run ios` 上都能打开，`@load` 各触发一次。
- [x] T023 三条 web 路径分别验一次（plan §4 第二条风险：只补一条会「dev 好用、
      发出去白屏」，而且白屏在 iframe 里，外面看不出错）：`vite dev` 走中间件、
      `vite build` 走 `writeBundle`、`fjs build --web` 走 `buildWeb()` 拷贝。

- [x] T023b （实现中新增）vite 中间件对自己那两个前缀下的未命中要 404，
      不能 `next()` 交给 vite 的 SPA 兜底 —— 实测 `/html/nope.html` 原本返回
      200 + index.html，在 `<web-view>` 里就是「app 把自己渲染进了一个盒子」，
      什么都不说（宪法 V，和 017 修 dev server 的是同一类）。

## 测试

- [x] T024b 给 T019b 的检查补用例：字面量命中/未命中、动态 src 不参与、
      `<image>` 与 `<web-view>` 各自只查自己那一类。
- [x] T024 `packages/fjs/test/assets.test.ts`（017 建的文件，续写）：
      `scanLocalAssets` 的分类与前缀（`public/x.png` → `/x.png`、
      `html/a/b.html` → `/html/a/b.html`）、递归子目录、空目录、
      `assetTypesSource` 的输出形状。
- [x] T025 `packages/fjs-webview/test/src-resolve.test.ts`：根路径在三个
      target 下的解析（web / app-dev / app-release），以及带 `?#` 的
      key/suffix 拆分对根路径同样成立。
- [x] T026 Dart 侧 `packages/fjs-webview/flutter/test/` 的对应用例：同样六个
      分支，钉住两端逐字符一致。**先编 native**，否则 `flutter test` 输出
      `No tests ran` 而不是失败（AGENTS.md §3）。
- [x] T026b （实现中发现的存量问题）`packages/fjs-webview/flutter/test/web_view_test.dart`
      **一直编译不过**（`EagerGestureRecognizer isn't a type` —— 少 import
      `package:flutter/gestures.dart`），`flutter test` 把它报成一条失败的
      "loading …"，所以这个文件从来没真跑过。补上 import 后又露出第二个：
      `_FakeNavigationDelegate` 一个 setter 都没重写，而
      `PlatformNavigationDelegate` 的默认实现全是 `UnimplementedError`，
      widget 根本建不起来。两处都补了，24 条全过。

- [x] T027 `packages/fjs/test/` 补一条：`fjs build --web` 的产物里
      `fjs-modules/webview/demo.html` 存在，而应用的 `public/` 里不存在
      —— 这是去重之后 URL 契约仍然成立的证据。

## 文档

- [x] T040 `docs/ui-api.md`：image 的「src 的三种写法」补上补全说明；
      web-view 的 src 加第三种（`/html/…`，app 自己的页面），L164 那张表更新。
- [x] T041 `docs/modules.md`：L325 的投递表改掉，L328「唯一一次写到 outDir
      之外」那段作废并说明现在由谁给 URL。
- [x] T042 `docs/toolchain.md`：`html/` 与 `public/` 的分工、新增的生成文件
      `src/fjs-assets.d.ts`。
- [x] T043 `docs/roadmap.md` 打勾。

- [x] T043b （实现中新增）`.gitignore` 与 `examples/hello-fjs/.gitignore` 加上
      `src/fjs-assets.d.ts` —— 其余三个生成的 d.ts 都在忽略列表里，漏了它就会
      被当成源码提交。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `cd packages/flutter_fjs && flutter test`（先编 native）
- [x] T053 `cat examples/hello-fjs/src/fjs-assets.d.ts` 图片与 html 分两组；
      故意把 `comp/image.vue` 的 src 打错一个字母，`npx fjs build --pages`
      **warn 出来**并给出最接近的候选（typecheck 不报错是预期行为，见
      spec §6 第 3 条）；改回来后 warn 消失
- [x] T054 `pnpm --filter hello-fjs run build:release` 后
      `find .fjs/flutter/assets/fjs -name demo.html` 只有一条；
      `ls examples/hello-fjs/public` 没有 `fjs-modules`，且跑过
      `fjs dev --web` 与 `fjs build --web` 之后仍然没有
- [x] T055 用 TypeScript 的 language service 直接问同形状联合在字符串字面量
      位置给什么候选（这是 Volar 底下的同一套机制），返回两条已知路径 ——
      带 `(string & {})` 也照样补全。**编辑器里的弹窗本身没法在这里驱动**，
      要在编辑器里最终确认一次；同形状的 `RoutePathRaw` 已经在用了。
- [x] T056 `npx fjs run ios`：`asset://demo.html` 与 `/html/local.html` 都能开
- [x] T057 spec.md 第 6 节逐条核对
