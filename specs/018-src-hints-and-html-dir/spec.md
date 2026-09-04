# Spec: src 路径补全、根目录 html/、去掉模块的 public 副本

- **ID**: 018-src-hints-and-html-dir
- **状态**: done
- **日期**: 2026-09-05

## 1. 要解决什么

017 之后本地图片两端都能用了（真机也验过）。用起来还剩三件事：

**A. `src` 写什么全靠记**

`<image src>` 和 `<web-view src>` 的类型都是 `string`
（`fjs-runtime/src/vue-global.d.ts` L46 的 `FjsImageProps.src`）。编辑器不知道
项目里有哪些本地文件，`/images/photo.png` 打成 `/image/photo.png` 要等到跑起来
看到 `@error` 才发现。仓库里已经有这件事的做法 —— `writeRouteTypes` 生成
`src/fjs-routes.d.ts` + 全局 `FjsRoutes`，`router.push({ name })` 就是这么补全和
查错的 —— 只是没用到 `src` 上。

**B. 同一个 `demo.html` 在 App 包里有两份**

`@ufjs/webview` 的 prepare 钩子（`packages/fjs-webview/prepare.mjs`）为了让 vite
能按 URL 服务它，把模块自带的页面**额外**写一份到应用的
`public/fjs-modules/webview/`。钩子自己的注释写明这是唯一一次写到 `ctx.outDir`
外面。017 让 `public/` 整个进 App 包之后，同一个文件就有了两份：

```
.fjs/flutter/assets/fjs/modules/webview/demo.html          ← 模块产物
.fjs/flutter/assets/fjs/public/fjs-modules/webview/demo.html ← public 副本，多余
```

App 侧从来不读第二份（`resolveSrc` 的 `app-release` 分支返回的是
`assets/fjs/modules/webview/…`），它纯粹是搭 web 便车进来的。

**C. app 自己的 webview 页面没有合法位置**

`classifySrc`（`packages/fjs-webview/index.ts` L52）只认三种：空、`http(s)://`、
`asset://`。而 `asset://` 的语义是**模块自己 ship 的文件**——
`assetPath` 解析出来的路径直接拼到 `modules/webview/` 下。应用想放一个自己写的
本地 html 让 `<web-view>` 打开，今天没有任何写法能做到：放 `public/` 里写
`/demo.html` 会被判成 `unsupported`。

## 2. 不做什么（Non-goals）

- 不改 `<web-view>` 允许的 scheme 集合（`file:` / `data:` / `javascript:` 仍然
  拒绝，理由见 `index.ts` 顶部注释）。
- 不做本地资源的构建期存在性校验以外的东西：不做图片压缩、尺寸校验、
  未引用文件清理。
- 不动 017 定下的形状：本地文件仍然是根绝对路径，`public/` 仍然整目录同步。
- 不给 `image` 加 SVG 解码（017 已登记为已知差异）。
- 不改模块产物在 App 侧的位置（`assets/fjs/modules/<name>/`）和
  web 侧的 URL（`/fjs-modules/<name>/<file>`）—— 变的只是那份文件**从哪来**。

## 3. 用户可见的行为

### A. src 补全

```vue
<template>
  <!-- 输入 "/" 就列出项目里的图片；打错是 TS 报错，不是运行期 @error -->
  <image src="/images/test-square.png" />
  <!-- web-view 只列 .html -->
  <web-view src="/demo.html" />
  <!-- 仍然可以写任意串：http、import 来的、运行期拼的 -->
  <image :src="remote" />
  <image :src="`/images/${name}.png`" />
</template>
```

`fjs dev` / `fjs build` / vite 启动时生成 `src/fjs-assets.d.ts`（和
`fjs-routes.d.ts`、`fjs-modules.d.ts` 一样是生成物，不手写、不进版本管理的
习惯沿用现状）。

### B. 根目录 `html/`

app 自己的 webview 页面放**项目根的 `html/`**，这是唯一位置：

```
html/
  guide.html
  policy/terms.html
```

```vue
<web-view src="/html/guide.html" @load="onLoad" />
```

目录名留在 URL 里（`html/guide.html` → `/html/guide.html`），所以 `html/` 和
`public/` 永远不会撞名，也一眼看得出文件是从哪来的。

两端都能打开，`@load` / `@error` 载荷不变。模块自带的页面继续写
`asset://demo.html`，语义不变。

### C. 模块副本消失

`pnpm --filter hello-fjs run build:release` 之后：

```
.fjs/flutter/assets/fjs/modules/webview/demo.html    ← 只此一份
.fjs/flutter/assets/fjs/public/                      ← 不再有 fjs-modules/
```

应用的 `public/fjs-modules/` 不再被生成（已有的那份要删掉，并且钩子不会再写
回来）。web 上 `/fjs-modules/webview/demo.html` 这个 URL 照旧可用。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `html/` 下的文件 | 随 `public/` 同一条路进 `assets/fjs/public/`，`<web-view>` 按根路径取：dev 问 dev server，release 走 `loadFlutterAsset` | 打包器把 `html/` 拷进站点根，按同一个根路径取 |
| 模块自带的页面 | `assets/fjs/modules/<name>/`（不变） | `/fjs-modules/<name>/<file>`（URL 不变），文件由 fjs 的 vite 插件与 `fjs build --web` 从 `.fjs/modules/<name>/` 提供，不再落进应用的 `public/` |
| `src` 类型 | 同一份 `src/fjs-assets.d.ts`（生成物与平台无关） | 同左 |
| 事件载荷 | 不变 | 不变 |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

但有一张**模块自己的**双端表要同步：`<web-view>` 的 src 解析在
`packages/fjs-webview/index.ts`（`classifySrc` / `resolveSrc`）与
`packages/fjs-webview/flutter/lib/fjs_webview.dart`
（`fjsClassifyWebViewSrc` / `fjsResolveWebViewSrc`）各有一半，新增的「根路径」
分支两边必须同时加，否则表现是某一端 `unsupported` 而不是异常。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test`、`cd packages/flutter_fjs && flutter test`
   全通过（flutter test 前先编 native）。
2. `examples/hello-fjs/src/fjs-assets.d.ts` 生成出来，图片与 html 分两组，
   编辑器里输入 `/` 能列出对应那一组的路径。
3. 打错的**字面量**本地 src 在构建时 warn，指出是哪个文件哪一行、写的什么、
   最接近的候选是什么；动态拼的 src（`:src="expr"`）不参与检查也不误报。
   —— 类型负责补全、检查负责查错：`(string & {})` 让补全成立的同时也让
   `vue-tsc` 接受任何字符串，两件事在同一个 prop 类型上兼容不了
   （2026-09-05 实现时确认，plan §3 有记录）。
4. `pnpm --filter hello-fjs run build:release` 后
   `find .fjs/flutter/assets/fjs -name demo.html` 只有一条
   （`assets/fjs/modules/webview/demo.html`）。
5. `examples/hello-fjs/public/fjs-modules/` 被删掉，且跑一次 `fjs dev --web`
   与 `fjs build --web` 之后**不会重新出现**。
6. `pnpm --filter hello-fjs run dev:web` 与 `npx fjs run ios`：`comp/web-view`
   页的 `asset://demo.html` 仍然正常打开（URL `/fjs-modules/webview/demo.html`
   在 web 上仍然 200）。
7. 新增一页 `html/` 下的本地 html，`<web-view src="/html/…">` 在
   `dev:web`、`fjs build --web` 静态产物、`fjs run ios` 三处都能打开，
   `@load` 触发一次。
8. `docs/ui-api.md`（web-view 的 src 写法 + image 的补全）、
   `docs/modules.md`（第 325 行那张表与「写到 outDir 之外」那段）、
   `docs/toolchain.md`（`html/` 与 `public/` 的分工）更新。

## 7. 待澄清

已定（2026-09-05，用户拍板）：

1. **`html/` 的 URL 形状**：目录名留在路径里 —— `html/guide.html` 在页面里写
   `/html/guide.html`。不和 `public/` 共用根命名空间，因此没有撞名问题，也一眼
   看得出文件来自哪个目录。
