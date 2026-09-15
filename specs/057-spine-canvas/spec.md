# Spec: @ufjs/spine —— spine-canvas 移植

- **ID**: 057-spine-canvas
- **状态**: done
- **日期**: 2026-09-15

## 1. 要解决什么

Spine 官方 web 运行时 `spine-canvas`（4.3）只能跑在浏览器：资源走
`XMLHttpRequest` / `new Image()`，渲染器吃 DOM 的 `CanvasRenderingContext2D`。
App 侧没有这些，fjs 页面无法播放 Spine 骨骼动画。

## 2. 不做什么（Non-goals）

- 不移植 spine-webgl / spine-widget；spine-player 只取配置与播放逻辑，DOM 控制条不做（见 §3 SpinePlayer）。
- 不 fork spine-core：按 npm 原版（锁定 4.3.13）依赖。
- 不修 runtime 的「路径点在 clip/fill 时才套变换」差异（见 §4），另开任务。

## 3. 用户可见的行为

```ts
import { AssetManager, AtlasAttachmentLoader, SkeletonBinary, Skeleton,
  AnimationState, AnimationStateData, SkeletonRenderer, Physics, SpinePlayer } from '@ufjs/spine';

// 推荐：
const player = new SpinePlayer(ctx, { skeleton: '/spine/spineboy-pro.skel', atlas: '/spine/spineboy.atlas', animation: 'walk' });
player.resize(canvas.width, canvas.height);

// 底层：

const assets = new AssetManager('/spine/');       // public/spine/
assets.loadBinary('spineboy-pro.skel');
assets.loadTextureAtlas('spineboy.atlas');
await assets.loadAll();
const renderer = new SkeletonRenderer(canvas.getContext('2d')!);
renderer.triangleRendering = true;
```

API 与官方 spine-canvas 一致（`export * from '@esotericsoftware/spine-core'` +
AssetManager / CanvasTexture / SkeletonRenderer）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 文本/二进制 | runtime `fetch`，根相对路径由 dev server / release 包应答 | 浏览器 fetch |
| 贴图 | `loadCanvasImage` 句柄 | `HTMLImageElement` |
| 渲染 | fjs 2d 显示列表 | 浏览器原生 2d |
| 小程序 | wx fetch 对根相对 GET 走 FileSystemManager 读包内文件；构建把 public 数据文件编译成 `fjs/public/<路径>.js`（base64）并登记到 `fjs/public-data.js`，真机 FileSystemManager 读不到代码包；canvas 触点 offsetX/Y 取自带的 x/y；vendor 打包把 `@ufjs/runtime` / `fjs` 映射到 wx 运行时 | |
| 已知差异 | App 的 2d 上下文按原始坐标记录路径、clip 时才套当前变换（DOM 是加点时套）。上游 drawTriangle 先建路径再 transform，App 上裁剪区错位；移植版改为 transform 后用贴图坐标建路径，两种语义结果相同 | — |

PMA 贴图：canvas 2d 按直通 alpha 合成，示例的 spineboy 贴图离线反预乘。

## 5. 契约变更（宪法 II）

- [x] 不涉及 op / natives / 事件；小程序构建产物新增 `fjs/public-data.js` 约定（`mp/build.ts` ↔ `wx/fetch.ts` `registerPublicData` 两处同步）

## 6. 验收标准

1. `pnpm --filter @ufjs/spine run typecheck`、`pnpm --filter hello-fjs run typecheck` 通过
2. hello-fjs「画布演示 → Spine 骨骼动画」在 `dev:web`、iOS 模拟器与小程序上画面一致：
   网格渲染开/关、调试线框、切换动画、jump / shoot 叠加

## 7. 待澄清

无
