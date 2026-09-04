# Tasks: 本地图片按 vite/vue 标准写法两端可用

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

本 spec 不动 op 协议 / natives 表 / 事件类型（plan §1 条款 II）。真正被两侧
共同依赖的"契约"是 **src 的形状**：本地图一律是根绝对路径 `/x`。它先定下来，
打包器和 Dart 解析才有共同的靶子。

- [x] T001 在 `packages/fjs/src/bundler/build.ts` 顶部加一段注释写明这条约定
      （本地资源的三种来源 → 一种形状 → 两种取法），并导出
      `ASSET_LOADERS`（`.png .jpg .jpeg .gif .webp .svg .woff2` → `file`）与
      `assetOutputOptions()`（`assetNames: 'assets/[name]-[hash]'`、
      `publicPath: '/'`），供 app 侧与 web 侧四处构建共用。
- [x] T002 在 `packages/flutter_fjs/lib/src/widgets/image.dart` 落下解析函数
      `fjsResolveImageSource(String src, {Uri? devUri})`（替换现在的
      `fjsImageProviderForSource`，L50），只写解析规则与注释，先不接线：
      `http(s)://` → `CachedNetworkImageProvider`；`asset://x` 与 `/x` 归一成
      根路径 `x`，`devUri != null` → `CachedNetworkImageProvider('$devUri/x')`，
      否则 `AssetImage('assets/fjs/public/x')`。

## 实现

- [x] T010 `packages/fjs/src/bundler/build.ts`：把 `ASSET_LOADERS` +
      `assetOutputOptions()` 加到单 bundle 那条 esbuild（`buildBundle` 内
      ~L223），`outfile` 换成 `outdir` + `entryNames`。跑
      `cd examples/hello-fjs && npx fjs build` 确认 `dist/bundle.js` 位置不变、
      图落在 `dist/assets/`。
- [x] T011 同文件 `buildPages()`：shared（~L389）、app entry（~L423）、每个
      page chunk（~L445）三处同样处理，外加实现时发现的第 4 处 ——
      `appModuleGraph()` 的 probe build（`write: false`，只需要 loader）。**这一步最容易静默错位**——改完必须
      `npx fjs build --pages` 比对 `dist/` 目录结构与改前一致
      （`dist/bundle.js`、`dist/shared.js`、`dist/pages/<chunk>.js`）。
- [x] T012 同文件 `buildWeb()`（~L512）：补 `assetOutputOptions()`（loader 已有），
      并把 `<root>/public/` 整目录拷进 `dist/web/`。
- [x] T013 同文件 `releaseBuild()`（~L656）：在 `ensureFlutterHost` **之前**，
      把 `<root>/public/` 与 `<outDir>/assets/` 拷进
      `<flutterDir>/assets/fjs/public/`（后者落到 `public/assets/`）。顺序写进
      注释——ensureFlutterHost 要按目录现状写 pubspec。
- [x] T014 `packages/fjs/src/commands/run.ts`：仿 `syncModuleAssets()`（L199）
      加 `publicAssetDirs(dir)`，**递归**列出 `assets/fjs/public/` 下每一级
      目录；`writeHostPubspec()`（L405）把它们拼进 `assets:`。注释写明
      Flutter 的 asset glob 不递归这件事。
- [x] T015 `packages/fjs/src/dev/server.ts` 的 `bundleServer()`（L632）：
      `/assets/<file>` 从本次 build 的 `<outDir>/assets/` 读（不是缓存的上一次），
      其余未命中的路径去 `<root>/public/` 找，content-type 复用
      `moduleContentType()`，命中不了返回 404。
- [x] T016 `packages/flutter_fjs/lib/src/fjs_view.dart`（plan 里写的是
      `fjs_app.dart`，实现时改到 FjsView：那才是每个宿主都有的挂载点，直接
      嵌一个 FjsView、不用路由的 app 也要有本地图）：新增
      `FjsAssetScope extends InheritedWidget` 把 `engine.devUri` 供下去，
      挂在已有的 `ListenableBuilder(listenable: engine)` 里面。
- [x] T017 `packages/flutter_fjs/lib/src/widgets/image.dart`：`_FjsImageState._start()`
      （L146）改成读 `FjsAssetScope.of(context)?.devUri` 并调 T002 的解析函数；
      `of(context)` 为 null 就是 release 语义（裸建 widget 的测试因此不用改）。

## 两端对齐

- [x] T020 Web 侧：`packages/fjs-runtime/src/web/components/basic.ts` 的
      `FjsImage.start()`（L243）把 `asset://x` 解析成 `/x`（根绝对），不再是
      剥前缀得到的相对路径；裸相对路径原样透传（浏览器语义）。
- [x] T021 静默失效（宪法 V）：`packages/fjs/src/dev/server.ts` 的 web 静态服务
      （L789）先查 `public/`，SPA 兜底只对**没有扩展名**的路径生效，带扩展名
      未命中就 404 —— 今天 `/comp/images/x.png` 拿到一份 index.html，浏览器只
      表现为「图裂」。
- [x] T022 静默失效（宪法 V）：`image.dart` 里解析不出的 src 用
      `fjsWarnOnce`（`widgets/control_scope.dart`）说清 node id、原始 src 与
      套用的规则，再走 `@error`：`.svg`（Flutter 侧没有解码器）、裸相对路径
      （按根路径处理并 warn）、找不到的 asset。
- [x] T023 `examples/hello-fjs/src/pages/comp/image.vue`：「本地图片」两个 Panel
      换回 `import landscape from '@/assets/test-landscape.png'` 的标准写法
      （现在是临时的 public 路径版），保留 public 根路径与缺失文件两组对照；
      清掉那段指向本 spec 的临时注释。
- [x] T024 两端对拍：同一页在 `dev:web` 与 `fjs run ios` 上各截一次图，比对
      `@load` 宽高（240x160 / 128x128）、alpha 透明是否透出背景色、
      `widthFix`/`heightFix` 的比例、缺失文件只触发一次 `@error`。

- [x] T025 （实现中新增）dev 下 `public/` 的图被 URL 缓存住：`FjsAssetScope`
      带上镜像树 `generation`，`fjsResolveImageSource` 给 dev URL 拼
      `?fjs=<generation>`，release 的 asset key 不变。

- [x] T026 （实现中新增）`fjs build --web` 的 index.html 用的是
      `<script src="./main.js">`，深层路由 `/comp/image` 下会去要
      `/comp/main.js`、被 SPA 兜底喂一份 HTML，整个应用白屏。同一类相对路径
      问题，改成 `/main.js`（`bundler/build.ts` 的 `INDEX_HTML`）。

## 测试

- [x] T030 `packages/fjs-runtime/test/web-image.test.ts`：`asset://photo.png`
      的断言从 `'photo.png'` 改成 `'/photo.png'`（L53 / L67 / L73 / L121 / L134），
      并补一条「嵌套路由下 src 仍是根路径」的用例。
- [x] T031 新增 `packages/fjs/test/assets.test.ts`：`publicAssetDirs()` 的递归
      枚举（嵌套目录、空目录、只有文件的目录），钉住 plan §4 的头号风险。
- [x] T032 同文件补构建产物断言：app 构建后图落在 `dist/assets/`、chunk 里的
      URL 是 `/assets/…`（不是 `/../assets/…`，也不是 `dist/pages/assets/`）。
- [x] T033 `packages/flutter_fjs/test/image_test.dart`：新增
      `fjsResolveImageSource` 的分支用例 —— http / 根路径+dev / 根路径+release /
      `asset://` / `.svg` / 裸相对路径 / 空 src。**先编 native**，否则
      `flutter test` 输出 `No tests ran` 而不是失败（AGENTS.md §3）。

## 文档

- [x] T040 `docs/ui-api.md`：image 的 `src` 三种写法（import 资源 / public 根
      路径 / http），`asset://` 标为旧写法（等价于根路径）。
- [x] T041 `docs/toolchain.md`：`public/` 会整目录进 App 包（含只给 web 用的
      文件）、import 的资源落在 `dist/assets/`、release 时两者都进
      `assets/fjs/public/`。
- [x] T042 `docs/web.md` 差异表：`.svg` 在 Flutter 侧不显示（走 `@error` + warn），
      web 侧原生支持。
- [x] T043 `docs/roadmap.md` 打勾。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `cd packages/flutter_fjs && flutter test`（先编 native）
- [x] T053 `cd examples/hello-fjs && npx fjs build --pages` 成功；
      `npx fjs build --pages --release` 后
      `find .fjs/flutter/assets/fjs/public -type f` 有图，
      `grep -A8 '  assets:' .fjs/flutter/pubspec.yaml` 列全了目录
- [x] T054 `npx fjs run ios` 本地图都显示；`--release` **模拟器跑不了**
      （Flutter：`Release mode is not supported by iPhone 17 Pro`，AOT 不上
      模拟器）。等价验证：`fjs build --pages --release` 同步好 assets 后，
      在 `.fjs/flutter` 里不带 `FJS_DEV` 起 host —— 这时 `devUri == null`，
      走的就是 release 的 `AssetImage` 分支
- [x] T055 `npx fjs build --web` 产物用静态服务器打开，深层路由 `/comp/image`
      下本地图仍然显示
- [x] T056 spec.md 第 6 节逐条核对
