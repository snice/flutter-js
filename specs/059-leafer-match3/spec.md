# Spec: hello-fjs 增加 LeaferJS 示例 —— 消消乐（三端含小程序）

- **ID**: 059-leafer-match3
- **状态**: in-progress
- **日期**: 2026-09-16

## 1. 要解决什么

spec 058 用 PixiJS 做了消消乐，但它吃 WebGL 桥，小程序端被排除
（`fjs.mp.exclude`），iOS 上几何也还没上屏。用户要用
[LeaferJS](https://www.leaferjs.com/ui/guide/install/ui/miniapp/start.html)
复刻同一个玩法，并且**三端（Flutter App / Web / 微信小程序）都能跑**。

Leafer 是 canvas 2d 的场景图引擎，官方的 `@leafer-ui/miniapp` 包只假设
一个 `wx` 形状的宿主对象 + 一张 2d canvas，不假设 DOM —— 这正好对上 fjs
`<canvas>` 的 2d 契约（docs/canvas-compat.md），三端可以共用这一个包。

## 2. 不做什么（Non-goals）

- 不改棋盘规则：复用 `@/match3/model`（spec 058 的纯函数模型）。
- 不用 Leafer 的交互系统（`receiveEvent` / 命中测试）：它的命中走
  `isPointInPath`，fjs App 端 ❌（canvas-compat §5）。页面自己用
  `touch.offsetX/Y` 算格子，与 pixi 版一致。
- 不用 Leafer 的 Text、图片、阴影、分组透明度、mask —— 这些路径要离屏
  canvas（`getSameCanvas`）或 `measureText` 走 `Platform.canvas`，fjs App
  端没有 OffscreenCanvas。分数等 UI 用画布外的 fjs 组件。
- 不引 `@leafer-in/animate`：tween 用页面内 rAF 小工具。
- 不改 `@ufjs/runtime` / `@ufjs/cli` / flutter_fjs；若发现缺口，停下来更新
  本 spec。
- 不处理 pixi 版遗留（058 的 iOS 上屏问题）。

## 3. 用户可见的行为

hello-fjs「交互游戏」分组出现「消消乐 LeaferJS」（`/pages/example/game/leafer-match3`），
三端同一份源码：

- 8×8、6 色宝石（Leafer 矢量图形：圆/菱形/星/圆角方/三角/六边形 + 高光）。
- 点选相邻交换或拖动过半格交换；无效回弹；消除缩小动画、下落补充、连击计分；
  死局自动重排；「提示」「重开」按钮；分数/最高/连击在画布外。
- keep-alive 离开时停止动画循环，回来恢复；卸载 `leafer.destroy()`。

```ts
import { mountLeafer } from '@/leafer/platform';
// @resize 里：
leafer = mountLeafer(cv, cv.width, cv.height); // 返回 Leafer 实例
leafer.add(new Rect({ ... }));
```

## 4. 三端约定（宪法 I）

| | Flutter App | Web | 小程序 |
|---|---|---|---|
| Leafer 平台 | `useCanvas('miniapp', fakeHost)`：离屏画布给无操作桩，pixelRatio 1 | 同 App 的 fakeHost | Leafer 包自动 `useCanvas('miniapp', wx)`（真 wx）|
| 渲染面 | fjs canvas `getContext('2d')`（显示列表） | 浏览器原生 2d | wx `type="2d"` 节点 context |
| pixelRatio | `canvas.devicePixelRatio`（=1） | `canvas.devicePixelRatio`（浏览器 dpr）| `canvas.devicePixelRatio`（wx 位图比例）|
| 帧调度 | `Platform.requestRender` → 全局 `requestAnimationFrame` | 同左 | 同左（wx 运行时 rAF）|
| 输入 | `<canvas>` touch 事件 `offsetX/Y` | 同左 | 同左 |

**已知差异**：Leafer 默认局部重绘（脏矩形 clip + clearRect），在 App 端
会让显示列表每帧累积（canvas-compat §10）；三端统一 `usePartRender: false`
走整块清屏。

## 5. 契约变更（宪法 II）

- [x] 都不涉及（示例页 + 示例层平台适配）

## 6. 验收标准

1. `pnpm --filter hello-fjs exec vue-tsc --noEmit` 对新增文件无报错。
2. `pnpm --filter hello-fjs run dev:web`：页面渲染、交换/消除/下落/连击/重开可玩，console 无错。
3. iOS 模拟器（`fjs run ios` 或 dev + fjs-go）：同页渲染和交互正常，截图。
4. `pnpm --filter hello-fjs run build:mp` 通过，产物包含 leafer-match3 页；
   微信开发者工具中渲染可玩（需用户侧或 DevTools 验证）。
5. `pnpm test` 回归通过。

## 7. 待澄清

- 无。
