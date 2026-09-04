# Spec: 本地图片按 vite/vue 标准写法两端可用

- **ID**: 017-local-image-assets
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

`<image src>` 现在只有网络图（`http(s)://`）是两端都能跑的。页面想放一张随
仓库走的本地图，用 vite + vue 的标准写法，两端都不成立：

**写法 A — import 静态资源**（vite 的主路径）

```ts
import logo from '@/assets/logo.png';
```

- Web（`vite dev` / `vite build`）：正常。
- Flutter（`fjs build` / `fjs run`）：**构建直接失败**
  ```
  src/pages/comp/image.vue:4:27: ERROR: No loader is configured for ".png" files:
  src/assets/test-landscape.png
  ```
  `bundler/build.ts` 只有 `buildWeb()` 那一路配了
  `loader: { '.png': 'file', ... }`，flutter 的 single / pages / shared 三个
  esbuild 配置都没有。

**写法 B — public/ 下的文件用根绝对路径**

```vue
<image src="/images/logo.png" />
```

- Web：正常（vite 把 `public/` 映射到站点根）。
- Flutter：**运行期静默失败**。`widgets/image.dart` 的
  `fjsImageProviderForSource()` 把非 http 的 src 交给 `AssetImage(src)`，而
  `public/` 从来没有被同步进 Flutter host（`commands/run.ts` 的
  `syncModuleAssets()` 只搬模块产物，pubspec 里也只列了 `assets/fjs/`）。
  实测 iOS 模拟器上四张本地图全部只触发 `@error`，日志里只有一行
  `<image> node 189 could not resolve intrinsic dimensions for
  /images/test-portrait.png`。

现存的 `asset://` 前缀是第三种写法，两端都认，但它也不对：web 侧
`basic.ts` 只是把 `asset://` 剥掉，剩下的是**相对路径**，在 `/comp/image`
这种嵌套路由下会去请求 `/comp/images/x.png`，被 dev server 的 SPA 兜底
返回 index.html，于是图片同样加载失败。它既不是 vite 的标准写法，也没真的
work。

## 2. 不做什么（Non-goals）

- 不做图片压缩、尺寸变体、`srcset`、雪碧图。
- 不做运行期从任意本地文件系统路径（`file://`、相册路径）读图。
- 不动 `mode` / `lazy-load` / `@load` / `@error` 的语义 —— 那是 010 的范围，
  本 spec 只解决「src 指向仓库里的一张图时，两端都能显示」。
- 不引入新的 C ABI 或新的 op（见第 5 节）。
- 不为 Flutter 侧做图片的 HTTP 缓存策略调整（沿用 010 的
  `CachedNetworkImageProvider`）。

## 3. 用户可见的行为

改完之后，下面这页两端表现一致（这就是 `examples/hello-fjs`
`src/pages/comp/image.vue` 里新增的两个 Panel）：

```vue
<script setup lang="ts">
// A. import：打包器负责 URL
import landscape from '@/assets/test-landscape.png';
</script>

<template>
  <!-- A -->
  <image :src="landscape" mode="aspectFit" @load="onLoad" @error="onError" />
  <!-- B：public/ 下的文件，根绝对路径 -->
  <image src="/images/test-square.png" class="thumb round" />
  <!-- C：不存在的本地文件 —— 只触发 @error，不崩 -->
  <image src="/images/does-not-exist.png" @error="onError" />
</template>
```

- A、B 在 `pnpm --filter hello-fjs run dev:web`、`fjs run ios`、
  `fjs run android` 上都能看到图，`@load` 载荷里的宽高等于 PNG 的真实像素
  （240x160 / 128x128）。
- C 两端都只触发一次 `@error`，载荷仍是 `{"errMsg":"image load failed"}`。
- 带 alpha 的 PNG 在两端都要真透明（背景色透出来），不是黑边或白底。
- `fjs run ios` 的 debug 模式下改一张图 → 保存 → 页面刷新后是新图
  （dev server 已经在 watch，图片走同一条 dev 通道）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| import 的资源 | esbuild 三条 flutter 路径都加 `.png/.jpg/.jpeg/.gif/.webp/.svg/.woff2` 的 `file` loader；产物落到 `dist/assets/`，release 时随 `assets/fjs/` 一起进 host，src 是一个约定前缀的路径 | vite / esbuild 原生行为，src 是站点内的 URL |
| public/ 根路径 | `public/` 整目录同步进 Flutter host，`AssetImage` 用得上的 key | vite 把 `public/` 映射到站点根 |
| dev 模式取图 | 从 `FJS_DEV` 的 dev server 用 http 取（图片和 JS 同一个来源，改图即时可见） | dev server 直接服务 |
| release 模式取图 | Flutter asset（`rootBundle`） | 静态站点里的文件 |
| 事件载荷 | `{"width":W,"height":H}` / `{"errMsg":"image load failed"}` | 同左（字符串，不变） |
| 已知差异 | SVG：Flutter 侧没有 SVG 解码器，`.svg` 只保证能打包和拿到 URL，显示与否登记在 `docs/web.md` 的差异表 | 浏览器原生支持 |

`asset://` 前缀作为已发布过的写法保留并修好（等价于写法 B 的根路径），
在 `docs/ui-api.md` 里标记为旧写法。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及 —— src 还是一个字符串 prop，变的只是**打包管线**和
      **Dart 侧 src → ImageProvider 的解析规则**

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm test` 通过。
2. `cd examples/hello-fjs && npx fjs build --pages` 成功（今天会因为
   png import 直接报 "No loader is configured for .png"）。
3. `cd packages/flutter_fjs && flutter test` 通过，且新增用例覆盖
   src → provider 的解析分支（dev http / release asset / 相对路径 / 缺失）。
4. `pnpm --filter hello-fjs run dev:web`，`/comp/image` 页「本地图片 import」
   Panel 显示渐变网格图，desc 是 `load 240 x 160`；缺失那个 Panel 是
   `error {"errMsg":"image load failed"}`。
5. `cd examples/hello-fjs && npx fjs run ios`，同一页同一 Panel 的截图与第 4 条
   一致（今天是四张图全 error）。
6. release 的 asset 分支同样显示。`npx fjs run ios --release` 在模拟器上跑不了
   （Flutter 不支持模拟器 AOT），等价做法：`fjs build --pages --release` 之后
   在 `.fjs/flutter` 里不带 `FJS_DEV` 起 host，`devUri == null` 走的就是
   `AssetImage`。
7. `npx fjs build --web` 产物用静态服务器打开，`/comp/image` 深层路由下本地图
   仍然能显示（证明不是相对路径）。
8. `docs/ui-api.md`（image 的 src 写法）与 `docs/web.md`（SVG 差异）更新。

## 7. 待澄清

已定（2026-09-04，用户拍板）：

1. **import 资源的 src 形状**：根路径 `/assets/<name>-<hash>.png`。Dart 侧
   一条统一规则解析根路径 —— dev 时拼成 `http://<FJS_DEV>/assets/...`，
   release 时映射到 `assets/fjs/public/assets/...`。import 与 public/ 两种
   写法走同一条解析路径，页面代码与 web 完全一致。
2. **public/ 同步**：全量同步整个 `public/` 进 host assets 并写进 pubspec，
   先不做排除列表。体量问题等真的痛了再加配置。
3. **SVG**：Flutter 侧先只保证「能打包、不崩、失败走 @error」，把差异登记进
   `docs/web.md`，不引入 `flutter_svg`。
