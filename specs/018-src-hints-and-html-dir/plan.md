# Plan: src 路径补全、根目录 html/、去掉模块的 public 副本

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **是** | `html/` 下的 html 两端都能开：Flutter 走 `packages/fjs-webview/flutter/lib/fjs_webview.dart` 的 `fjsClassifyWebViewSrc` / `fjsResolveWebViewSrc` 新增根路径分支；Web 走 `packages/fjs-webview/index.ts` 的 `classifySrc` / `resolveSrc` 同一个分支。文件投递两端各一条：Flutter 靠 017 已有的 `syncPublicAssets`（`fjs/src/bundler/build.ts`）把 `html/` 一起同步，Web 靠 `fjs/src/vite.ts` + `buildWeb()` 把 `html/` 放到站点根。`src` 的类型是生成物，与平台无关。 |
| II 边界即契约 | **否**（三张表都没动） | 但**模块自己**那张双端表动了：`<web-view>` 的 src 解析在 `fjs-webview/index.ts` 与 `fjs-webview/flutter/lib/fjs_webview.dart` 各一半，新增的根路径分支必须同时加 —— 漏一边的表现是某一端判成 `unsupported`、只 warn 不抛，不是异常。`fjs-webview/test/src-resolve.test.ts` 与 Dart 侧的对应用例一起改。 |
| III 同步单线程零序列化 | **否** | 不新增任何 JS↔Dart 通道。 |
| IV 外观照 WeUI | **否** | 不涉及默认外观。 |
| V 静默失效是 bug | **是** | ① 补全本身就是把「运行期 `@error`」提前成编译期错误。② `html/` 与 `public/` 各自映射到自己的前缀（spec §7 已定），不共用根命名空间，所以没有"后拷贝的悄悄覆盖先拷贝的"这种事。③ 模块副本去掉后，`/fjs-modules/<name>/<file>` 这个 URL 必须继续 200；dev 中间件与构建期拷贝任一处漏掉，表现是 web-view 白屏而不是报错，所以两处都要有用例。 |
| VI 注释记录权衡 | **是** | `assets.ts` 顶部写清「为什么是生成的全局接口而不是运行期校验」；`vite.ts` 的中间件与 `buildWeb()` 的拷贝各写一句「模块产物的唯一一份在 `.fjs/modules/`，这里只是让它在 web 上有个 URL」；`prepare.mjs` 删掉的那段要在 `docs/modules.md` 留下「曾经写到 outDir 之外，现在不写了」的说明。 |
| VII JS 能包就不要下 Dart | **是，Dart 侧只加一个分支** | 补全、`html/` 的投递、模块副本的去除**全部**在 JS/CLI 侧完成，一行 Dart 都不需要。唯一下到 Dart 的是 `<web-view>` 的根路径解析——和 017 的理由一样：「有没有 dev 连接」是 Dart 侧运行期状态（`FjsEngine.devUri`），而且 Flutter 的 `loadFlutterAsset` 要的是 asset **key** 不是 URL，这个形状 JS 侧表达不了。它落在模块的 `fjs_webview.dart` 里，不进 `flutter_fjs` 核心。 |
| VIII 变更落到文档 | **是** | `docs/ui-api.md`（image 的 src 补全、web-view 的 src 三种写法）、`docs/modules.md`（L325 那张投递表 + L328「唯一一次写到 outDir 之外」那段作废）、`docs/toolchain.md`（`html/` 与 `public/` 的分工、新增的生成文件）、`docs/roadmap.md` 打勾。 |

破例：无。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime（类型） | `packages/fjs-runtime/src/vue-global.d.ts` | `FjsImageProps.src` 从 `string` 改成 `FjsImageSrc`。新建 `packages/fjs-runtime/src/assets.d.ts`（或并入 vue-global）声明空的 `interface FjsImageAssets {}` / `interface FjsHtmlAssets {}` 与 `FjsImageSrc` / `FjsHtmlSrc`，照 `src/router/types.ts` L63-84 的 `FjsRoutes` 写法：`keyof X extends never ? string : Extract<keyof X, string> \| (string & {})` —— 没生成过表的项目退回纯 string，生成了就既补全又不挡 http / 模板串。 |
| CLI / 生成 | `packages/fjs/src/project/assets.ts`（新建） | 扫 `<root>/public/` 与 `<root>/html/`，按扩展名分成图片（png/jpg/jpeg/gif/webp/svg）与 html 两类，产出 `ASSET_TYPES_FILE = src/fjs-assets.d.ts` 与 `assetTypesSource()` / `writeAssetTypes()`。整体照 `fjs/src/project/pages.ts` L186-215 的 `ROUTE_TYPES_FILE` / `routeTypesSource` / `writeRouteTypes` 抄，包括「内容没变就不写，因为 vite 在 watch 这个目录」那条。 |
| CLI / 调用点 | `packages/fjs/src/bundler/build.ts`、`packages/fjs/src/vite.ts`、`packages/fjs/src/dev/server.ts` | `writeAssetTypes(root)` 跟在现有 `writeRouteTypes(root)` 后面，一共四处：`buildBundle()` 开头、`vite.ts` 的 `config()`、`dev/server.ts` L346 的首次生成与 L477 的 watch 回调。dev server 的 `generated` 集合（L452-456）要加上 `fjs-assets.d.ts`，否则写它自己触发下一轮 rebuild，无限循环。 |
| CLI / html 投递（web） | `packages/fjs/src/bundler/build.ts` `buildWeb()` | 017 加的 `copyPublicDir(root, webOut)` 旁边再拷一次 `<root>/html/` → `<webOut>/html/`。同一处把 `.fjs/modules/<name>/` 拷成 `<webOut>/fjs-modules/<name>/`（顶掉 prepare 钩子原来写进 app `public/` 的那份）。 |
| CLI / html 投递（vite） | `packages/fjs/src/vite.ts` | 现在这个插件只有 `config` / `resolveId` / `load` / `transform` / `handleHotUpdate`（`VitePlugin` 接口在 L52-63 手写）。要加两个成员：`configureServer` 挂中间件，把 `/html/*` 指到 `<root>/html/`、`/fjs-modules/<name>/*` 指到 `moduleDataDir(root, name)`；`writeBundle`（或 `closeBundle`）把这两棵树拷进 vite 的 outDir。`VitePlugin` 接口要跟着补声明。 |
| CLI / html 投递（app） | `packages/fjs/src/bundler/build.ts` `syncPublicAssets()`、`packages/fjs/src/dev/server.ts` `bundleServer()` | release：`html/` 拷到 `<assets>/fjs/public/html/`，pubspec 的递归枚举（017 的 `publicAssetDirs`）自动带上，不用改。dev：`bundleServer` 里 017 加的 `sendLocalFile(..., path.join(root,'public'), url.slice(1))` 之后再加一路 `<root>/html/`（URL 带 `html/` 前缀，所以直接从 root 起算即可）。 |
| 模块 | `packages/fjs-webview/prepare.mjs` | 删掉 `ctx.platform === 'web'` 那一段（写到 app `public/fjs-modules/` 的副本），钩子只保留 `ctx.write` 到 `.fjs/modules/webview/`。顶部注释改写：唯一一份在哪、web 侧由谁给 URL。 |
| 模块 / Web 侧 | `packages/fjs-webview/index.ts` | `SrcKind` 加 `'local'`；`classifySrc` 认 `/` 开头；`resolveSrc` 三个 target 各加分支：web 原样 URL、app-dev 拼 `http://<devHost>/<path>`、app-release 返回 `{kind:'flutter-asset', asset:'assets/fjs/public/<path>'}`。`unsupportedSrcMessage` 的文案要提到 `html/`。`WEB_ASSET_BASE` 不动。 |
| 模块 / Flutter 侧 | `packages/fjs-webview/flutter/lib/fjs_webview.dart` | `FjsWebViewSrcKind` 加 `local`，`fjsClassifyWebViewSrc` / `fjsResolveWebViewSrc` 镜像上面三个分支（L81-166）。`asset://` 的老分支一个字不动。 |
| 模块 / 组件 props | `packages/fjs-webview/components/WebViewWeb.vue` L27 | `defineProps<{ src?: string }>()` → `src?: FjsHtmlSrc`。`<web-view>` 的类型就是这个组件的 props（`fjs/src/project/modules.ts` L601-613 的 `FjsWidgetProps`），所以改这一处两端的标签都跟着变。 |
| 示例 | `examples/hello-fjs/` | 删 `public/fjs-modules/`；加 `html/local.html`；`src/pages/comp/web-view.vue` 加一个「app 自己的本地页面」Panel。 |
| C++ 引擎 | — | 不涉及。 |
| Dart 宿主（flutter_fjs） | — | 不涉及（改动只在 webview 模块的 Dart 包里）。 |
| 文档 | `docs/ui-api.md` / `docs/modules.md` / `docs/toolchain.md` / `docs/roadmap.md` | 见宪法自查 VIII。 |

## 3. 方案

**一句话**：本地文件按**目录**决定用途和前缀（`public/` → `/…`，`html/` → `/html/…`），
用途决定类型（图片进 `FjsImageAssets`，html 进 `FjsHtmlAssets`），模块产物则永远
只有 `.fjs/modules/<name>/` 一份，两个 web 入口各自负责给它一个 URL。

三段：

1. **补全**。`writeAssetTypes` 生成 `src/fjs-assets.d.ts`，augment 两个空的全局
   接口；`src` 的类型是 `Extract<keyof X, string> | (string & {})`。`(string & {})`
   这一半是关键：它让联合类型在补全列表里显示已知路径，同时不拒绝任何其他串
   （http、`import` 来的 hash 名、模板拼的），这正是 `RoutePathRaw` 已经在用的
   写法。
2. **`html/`**。三个投递路径复用 017 已经铺好的：Flutter 侧进
   `assets/fjs/public/html/`，dev server 与 web 站点根各挂一份。`<web-view>`
   两端各加一个根路径分支。
3. **去重**。prepare 钩子不再往应用目录里写第二份；vite 中间件（dev）与
   `buildWeb()` 拷贝（build）接手，`/fjs-modules/<name>/<file>` 的 URL 契约不变，
   所以 `resolveSrc` 的 web 分支和已经发布过的写法都不用动。

**被否掉的备选**

- *`html/` 映射到根（`/guide.html`）*：写法更短，但和 `public/` 共用根命名空间，
  同名文件会撞，撞了必须构建报错才不算静默失效——多一条规则换两个字符，不值。
  已按用户拍板选 `/html/…`。
- ~~*不生成类型，改成构建期校验本地 src 是否存在*~~ —— **实现时发现这两件事
  不是二选一，是缺一不可**。`(string & {})` 让编辑器把已知路径列进补全，代价
  是它接受任何字符串，所以打错一个字母 `vue-tsc` **不报错**（实测：
  `/images/test-squre.png` 通过）。去掉 `(string & {})` 能查错，但会连带打死
  017 的 import 写法（`import png from '…'` 的类型是 `string`，赋不进严格
  联合）、http URL 和模板串拼的 src，要给 png 模块声明加 branded type 才能
  救回来 —— 把 017 刚铺好的路又刨一遍。结论：类型负责补全，另加一条构建期
  检查负责查错，只看模板里的**字面量** src，动态拼的不碰，所以不会误报。
- *一份不分类的资源清单*：实现少一半，但 `<image>` 上会补出 `.html`，
  `<web-view>` 上会补出 `.png`，等于把两个标签的约束丢了。已按用户拍板分类。
- *继续让 prepare 写 app 的 `public/`，只在同步进 Flutter 时排除 `fjs-modules/`*：
  改动最小，但两份文件还在（web 产物里依旧重复），而且"钩子写到 outDir 之外"
  这个特例会一直留着。已按用户拍板从源头去掉。
- *把模块产物做成 vite 的第二个 `publicDir`*：vite 只支持一个 `publicDir`，
  改它会顶掉应用自己的，只能走中间件 + 构建期拷贝。

## 4. 风险

- **生成文件参与 watch 循环**。`dev/server.ts` 的 `generated` 集合漏掉
  `fjs-assets.d.ts` 的话，写它 → 触发 watch → 再写，reload 打转。加进去，并且
  `writeAssetTypes` 沿用「内容没变就不写」。
- **中间件与构建期拷贝是两条独立的路**。`vite dev` 走中间件，`vite build` 与
  `fjs build --web` 走拷贝；只补一条的表现是「dev 好用，发出去白屏」（或反过来），
  而且是 web-view 内部白屏，外面看不出错。两条都要有用例。
- **`(string & {})` 的补全行为依赖 TS 版本与编辑器**。类型上一定是对的（不会误报），
  但"输入 `/` 弹出列表"这件事要在 Volar 里实测一次，不能只看 `vue-tsc` 通过。
- **补全不等于查错**（实现时确认，见上）。`vue-tsc` 对写错的本地 src 一声不吭，
  所以查错必须由构建期那条检查来做。它只看字面量，因此**动态拼的 src 一个都
  查不到** —— 这是自觉的取舍，不是遗漏：宁可漏报也不误报。
- **删 `public/fjs-modules/` 要连着钩子一起改**。只删目录不改钩子，下一次
  `fjs dev --web` 又会长回来。
- **`html/` 里的子目录**。`html/policy/terms.html` 要能用，说明拷贝和扫描都得
  递归，pubspec 那边靠 017 的 `publicAssetDirs` 递归枚举兜住。

## 5. 验证路径

```bash
# 1) 生成物与补全
pnpm run typecheck
cat examples/hello-fjs/src/fjs-assets.d.ts     # 图片与 html 分两组
# 手动：把 comp/image.vue 里的 src 打错一个字母
pnpm --filter hello-fjs run typecheck          # 期望报错

# 2) 去重
pnpm --filter hello-fjs run build:release
find examples/hello-fjs/.fjs/flutter/assets/fjs -name demo.html   # 期望只有 1 条
ls examples/hello-fjs/public                                       # 期望没有 fjs-modules

# 3) 三条 web 路径都要试（dev 中间件 / vite build / fjs build --web）
pnpm --filter hello-fjs run dev:web            # /comp/web-view 两个 Panel 都能开
pnpm --filter hello-fjs run build:web && node <静态服务器> dist/web
npx fjs build --web && node <静态服务器> dist/web

# 4) App 两端
pnpm test
cd packages/flutter_fjs && flutter test        # 先编 native
cd examples/hello-fjs && npx fjs run ios       # asset:// 与 /html/… 都要开
```
