# Plan: 本地图片按 vite/vue 标准写法两端可用

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **是** | Web：`fjs-runtime/src/web/components/basic.ts`（`asset://` → 根路径，不再是相对路径）+ `fjs/src/bundler/build.ts` 的 `buildWeb()`（`publicPath: '/'`、拷 `public/`）。Flutter：`flutter_fjs/lib/src/widgets/image.dart`（src → ImageProvider 的解析）+ 同一个 `build.ts` 的三条 app 路径。页面源码一行不改跑两端。 |
| II 边界即契约 | **否** | 三张表都没动：`src` 还是一个字符串 prop，事件仍是 `load` / `error`，载荷仍是字符串 JSON。变的是打包管线与 Dart 侧的 src 解析规则。 |
| III 同步单线程零序列化 | **否** | 不新增 JS↔Dart 通道。dev 模式取图走 Dart 侧已有的 `FjsHttp`（`CachedNetworkImageProvider`），与 JS 无关。 |
| IV 外观照 WeUI | **否** | 不涉及默认配色/内边距/按下态。 |
| V 静默失效是 bug | **是**，这条是本 spec 的主线 | ① `fjs dev --web` 的 SPA 兜底不再对带扩展名的路径返回 index.html —— 今天 `/comp/images/x.png` 拿到一份 HTML，浏览器只报「图裂了」，查不出原因，改成 404。② Flutter 侧解析不出的 src（相对路径、找不到的 asset）`fjsWarnOnce` 说明是哪个 node、哪个 src、按什么规则解析的，再走 `@error`。③ `.svg` 在 Flutter 上明确 warn + `@error`，不是空白。 |
| VI 注释记录权衡 | **是** | `image.dart` 的 provider 解析函数、`build.ts` 的 `assetNames`/`publicPath` 组合、`run.ts` 的 public 同步，各留一段「为什么不是另一种」的注释（见第 3 节被否方案）。 |
| VII JS 能包就不要下 Dart | **是，且必须下 Dart** | 这个能力要的信息 JS 侧**没有**：一张图最终是 `http://<dev>/assets/x.png` 还是 `AssetImage('assets/fjs/public/assets/x.png')`，取决于这个 Flutter 进程当前有没有 dev 连接（`FjsEngine.devUri`）—— 那是 Dart 侧的运行期状态，JS 侧拿不到，也不该拿到（拿到就等于把宿主形态泄进业务代码）。`fjs-webview` 的 `fjsResolveWebViewSrc(raw, {devUri})` 已经是这个形状，本 spec 照抄同一套结构。打包器那一半仍然在 JS 侧（`build.ts`），没有下沉。 |
| VIII 变更落到文档 | **是** | `docs/ui-api.md`（image 的 src 写法：import / public 根路径 / http，`asset://` 标为旧写法）、`docs/toolchain.md`（`public/` 会整目录进 App 包、`dist/assets/` 的产物位置）、`docs/web.md`（SVG 在 Flutter 侧不显示，登记差异）、`docs/roadmap.md`（勾上）。 |

破例：无。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/build.ts` | ① 抽一个 `ASSET_LOADERS`（`.png .jpg .jpeg .gif .webp .svg .woff2` → `file`）与 `assetOutputOptions()`（`assetNames: 'assets/[name]-[hash]'` + `publicPath: '/'`）。② 加到 **5 处 app 侧 esbuild**：单 bundle（`buildBundle` 内）、`buildPages` 的 shared、app entry、每个 page chunk，以及 `appModuleGraph()` 的 probe（实现时发现的第 5 处：`write: false` 不产出资源，但缺 loader 会让 split build 在第一个 png import 上直接失败）。③ 这 4 处的 `outfile:` 换成 `outdir` + `entryNames`（实测：`outfile` 下 `assetNames` 相对 outfile 所在目录，page chunk 会把图吐到 `dist/pages/assets/`，而 `assetNames: '../assets/…'` 会让 URL 变成 `/../assets/…`；`outdir: dist` + `entryNames: 'pages/<chunk>'` 才同时得到 `dist/assets/x.png` 和 `/assets/x.png`）。④ `buildWeb()`（~L512）已有 loader，补 `publicPath: '/'` + `assetNames`，并把 `public/` 拷进 `dist/web/`；顺带把 `INDEX_HTML` 的 `<script src="./main.js">` 改成 `/main.js`（实现时发现：深层路由下它会去要 `/comp/main.js`，被 SPA 兜底喂一份 HTML，整页白屏 —— 和本 spec 修的是同一类相对路径问题）。⑤ `releaseBuild()`（~L656）在 `ensureFlutterHost` **之前**把 `public/` 与 `dist/assets/` 拷进 `<flutterDir>/assets/fjs/public/`。 |
| CLI / 构建 | `packages/fjs/src/commands/run.ts` | 仿 `syncModuleAssets()`（L199）加 `publicAssetDirs()`：递归列出 `assets/fjs/public/` 下**每一级目录**写进 pubspec（Flutter 的 asset glob 不递归，只列顶层会漏掉 `public/images/`），`writeHostPubspec()`（L405）拼进 `assets:`。 |
| CLI / dev server | `packages/fjs/src/dev/server.ts` | ① `bundleServer`（L632）：`/assets/<file>` 从本次 build 的 `dist/assets/` 读，其余未命中路径去 `<root>/public/` 找，content-type 复用 `moduleContentType()`。② web 静态服务（L789）：先查 `public/`，SPA 兜底只对**没有扩展名**的路径生效。 |
| JS runtime / Web 适配层 | `packages/fjs-runtime/src/web/components/basic.ts` | `FjsImage.start()`（L243）：`asset://x` → `/x`（根绝对），裸相对路径原样透传（浏览器语义）。 |
| C++ 引擎 | — | 不涉及。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/image.dart` | `fjsImageProviderForSource(src)`（L50）改成 `fjsResolveImageSource(src, {Uri? devUri})`：`http(s)://` → `CachedNetworkImageProvider`；`asset://x` 与 `/x` 归一成根路径 x，`devUri != null` → `CachedNetworkImageProvider('$devUri/x')`，否则 `AssetImage('assets/fjs/public/x')`；`.svg` → warn + 走 error；裸相对路径 → `fjsWarnOnce` 后按根路径处理。`_FjsImageState._start()`（L146）取 devUri。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | 新增 `FjsAssetScope extends InheritedWidget`（照 `widgets/control_scope.dart` L104 的写法），把 `engine.devUri` 供下去。**放 FjsView 而不是 FjsApp**：FjsView 是每个宿主都有的挂载点，直接嵌一个 FjsView、不走路由的 app 也要有本地图。它已经是 `ListenableBuilder(listenable: engine)`，连上 dev 之后自然重建。`of(context)` 返回 null 就是 release 语义，所以 `image_test.dart` 里裸建 widget 的用例不用改。 |
| 文档 | `docs/ui-api.md` / `docs/toolchain.md` / `docs/web.md` / `docs/roadmap.md` | 见宪法自查 VIII。 |
| 示例 | `examples/hello-fjs/src/pages/comp/image.vue` + `src/assets/*.png` + `public/images/*.png` | 「本地图片」两个 Panel 换回 `import` 写法（现在是临时的 public 路径版），保留 public 根路径与缺失文件两组对照。 |
| 测试 | `packages/fjs-runtime/test/web-image.test.ts` | `asset://photo.png` 的断言从 `'photo.png'` 改成 `'/photo.png'`（L53/L67/L73/L121/L134）。 |
| 测试 | `packages/fjs/test/`（新增 `assets.test.ts`） | `publicAssetDirs()` 的递归枚举；`buildWeb`/app 构建产物里图片落在 `dist/assets/` 且 URL 是 `/assets/…`。 |
| 测试 | `packages/flutter_fjs/test/image_test.dart` | 新增 `fjsResolveImageSource` 的分支用例：http / 根路径+dev / 根路径+release / `asset://` / `.svg` / 相对路径。 |

## 3. 方案

**一句话**：打包器把所有本地图统一成**根绝对路径**，Dart 侧用一条规则把根路径翻译成「dev 时的 http URL」或「release 时的 Flutter asset key」。

三段：

1. **打包**（`build.ts`）。app 侧四条 esbuild 补上 file loader，产物统一 `dist/assets/<name>-<hash>.<ext>`，代码里拿到 `/assets/<name>-<hash>.<ext>`。`public/` 不进打包器，原样搬运。两条路最终都是「根路径」这一种形状，Dart 侧只需要一条规则。
2. **投递**。dev：`fjs dev` 把 `dist/assets/` 和 `public/` 都挂在 HTTP 根上，Flutter 与浏览器取同一份，改图即时可见。release：`public/` 与 `dist/assets/` 一起拷进 `<flutterDir>/assets/fjs/public/`，pubspec 递归列出每一级目录。
3. **解析**（`image.dart`）。`FjsAssetScope` 供 `engine.devUri`；有 dev 连接就拼 `http://<dev>/<path>`，没有就 `AssetImage('assets/fjs/public/<path>')`。

**被否掉的备选**

- *`asset://` 作为 import 产物的前缀*：Dart 侧一眼能分辨，但页面拿到的 URL 与 web 不同，破坏「同一份源码」；而且 `asset://` 不是 vite 的产物形状，用户从任何 vite 项目搬过来的写法都对不上。已按用户拍板选根路径。
- *小图内联 data: URI*：省一次请求，但 bytecode 体积随图线性上涨，且 `@load` 的宽高要额外解码路径。留给后续按阈值做，不进本 spec。
- *`public/` 只同步显式声明的目录*：包体最可控，但新增一张图要改配置，属于「静默失效」的温床（忘了配 → release 才发现图没了）。已按用户拍板选全量同步。
- *Flutter 侧接 `flutter_svg`*：多一个 pub 依赖 + 两套 ImageProvider 分支。按用户拍板，先只保证不崩并登记差异。
- *page chunk 保留 `outfile`，用 `assetNames: '../assets/…'`*：实测 URL 会变成 `/../assets/…`（publicPath 与 assetNames 是拼接关系），否掉。
- *在 JS 侧把 src 解析完再交给 Dart*：JS 拿不到「当前有没有 dev 连接」，拿到也不该有（宪法 VII 的反面：这不是组织性能力，是宿主形态）。

## 4. 风险

- **Flutter 的 asset glob 不递归**。`- assets/fjs/public/` 不会带上 `public/images/`。漏了不会报错，只会在 release 包里少几张图 —— 必须递归枚举目录，并且要有 CLI 单测钉住。
- **`outfile` → `outdir` 的改动面**。四条 app 构建路径都要改，产物路径错了表现是「页面加载不到 chunk」而不是构建失败。改完先跑 `npx fjs build --pages` 比对 `dist/` 目录结构。
- **dev 与 release 的两条取图路径只有一条会被日常跑到**。debug 下永远走 dev server，release 的 asset 分支只有 `--release` 才碰得到 —— 验证路径里必须包含 `fjs run ios --release`，否则等到发版才炸。
- **包体**。全量同步 `public/` 意味着只给 web 用的文件也进 App 包（hello-fjs 现在就有 `public/fjs-modules/webview/demo.html`）。本 spec 接受，`docs/toolchain.md` 要写明。
- **hash 命名与热重载**。import 的图改了内容 → hash 变 → src 变 → `didUpdateWidget` 走 `_reset()` 重新加载；但 dev server 的 `/assets/` 必须读**本次 build 的**产物目录，不能读上一次的缓存。
- **`public/` 的图在 dev 下会被缓存住**（实现时在模拟器上撞到的，plan 原本没预料）：路径不变 + 图片缓存按 URL 建键 = 改了图还是显示第一次拉到的那张，而且没有任何提示。`FjsAssetScope` 因此还带上镜像树的 `generation`（每次完整 dev reload 自增），dev URL 拼一个 `?fjs=<generation>`；release 的 asset key 保持干净。页面 chunk 级别的热替换不 bump generation，那种情况下 public 图仍要一次完整 reload 才更新。
- **两端对拍**：`@load` 的宽高、alpha 透明、`widthFix`/`heightFix` 的比例，都要在 web 与模拟器上各截一次图比对。

## 5. 验证路径

```bash
# 1) JS 侧
pnpm run typecheck
pnpm test

# 2) app 构建不再因为 png import 失败，且产物落位正确
cd examples/hello-fjs
npx fjs build --pages
ls dist/assets                      # 期望 test-landscape-<hash>.png
grep -o '/assets/[^"]*png' dist/pages/comp-image.js | head

# 3) release 同步进 host，pubspec 递归列出目录
npx fjs build --pages --release
find .fjs/flutter/assets/fjs/public -type f | head
grep -A8 '  assets:' .fjs/flutter/pubspec.yaml

# 4) web：dev 与静态产物两条都要看深层路由
pnpm --filter hello-fjs run dev:web       # /comp/image：import 图显示，desc = load 240 x 160
npx fjs build --web && npx serve dist/web # 同一页，同样结果（证明不是相对路径）

# 5) Flutter：debug 与 release 各跑一次
cd packages/flutter_fjs && flutter test
cd examples/hello-fjs
npx fjs run ios                           # dev 取图；改一张 png 保存，页面应换图
npx fjs run ios --release                 # asset 取图
```

每一步都对着 spec 第 6 节的验收标准逐条勾。
