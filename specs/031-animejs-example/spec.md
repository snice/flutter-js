# Spec: Anime.js 示例页

- **ID**: 031-animejs-example
- **状态**: done
- **日期**: 2026-09-11

## 1. 要解决什么

hello-fjs 里的动效目前只有两种写法：`transition` 插值一条 transform（2048）、
手势当帧改 transform（块拖拽）。时间轴、stagger、弹簧、播放控制这类「编排式」
动效没有示例，开发者不知道现成的 JS 动画库能不能在 App 端跑。

[Anime.js](https://animejs.com)（v4）是这类库里最常用的一个。它在浏览器里驱动
DOM，但也支持「任意 JS 对象」做 target——这正好是 fjs 两端都能给的形状。

## 2. 不做什么（Non-goals）

- 不在 runtime 里装 `setImmediate` 等全局，不改 op / natives / 事件契约。
- 不抽 `@ufjs/anime` 适配包；接法放在示例里（同 019 / 020 的做法）。
- 不演示 Anime.js 的 DOM 专属模块：`svg`、`text`（splitText）、`draggable`、
  `layout`、`scope` 的媒体查询、`waapi`、`onScroll`。它们要真 DOM，App 端没有。
- web 端不走 DOM target：两端同一份源码，都动 JS 对象（宪法 I）。

## 3. 用户可见的行为

新页 `examples/hello-fjs/src/pages/example/anime.vue`，`<route>` 进示例页新分组
「动画演示」。

```ts
import '@/anime/native-polyfills'; // 必须在 animejs 之前
import { animate, createTimeline, stagger } from 'animejs';

const dots = reactive(Array.from({ length: 25 }, () => ({ x: 0, y: 0, scale: 1 })));
animate(dots, { scale: [1, 0.3], delay: stagger(40, { grid: [5, 5], from: 'center' }) });
```

模板里 `:style="{ transform: \`translate(${d.x}px, ${d.y}px) scale(${d.scale})\` }"`。

至少三块：

1. **stagger 网格**：5×5 圆点从中心波纹缩放 + 旋转，循环播放。
2. **时间轴 + 播放控制**：几个方块依次入场的 timeline，按钮 播放/暂停/反向/重播，
   slider 拖动 `seek`，显示当前进度。
3. **缓动对比**：同一段位移分别用 `linear`、`outExpo`、`inOutBack`、
   `outElastic`、`createSpring()` 跑，一眼看出差异；再加一个数字计数器
   （`utils.round` 修饰器）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| target | 响应式 JS 对象，Vue 把值绑到 `:style` | 同 |
| 帧驱动 | Anime.js 判定非浏览器 → 默认主循环用 `setImmediate`；示例的 polyfill 把它映射到 runtime 的 `requestAnimationFrame`（宿主 vsync） | 浏览器原生 `requestAnimationFrame`，polyfill 不安装 |
| 已知差异 | 页面隐藏时 App 端不会自动暂停（`visibilitychange` 只在浏览器挂）；页面卸载时示例自己 `revert()` | |

为什么 `setImmediate` 不能照 Node 语义实现成「尽快」：App 端 JS 跑在 UI 线程上，
忙循环会把整条线程占满；映射到 vsync 才是动画该有的节奏。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm --filter hello-fjs run build:pages` 与 `build:web` 通过。
3. `/example/anime` 出现在示例页「动画演示」分组。
4. web（`pnpm dev:web`）、iOS 模拟器、Android 模拟器上三块动画都在动，
   播放控制与 seek 生效，控制台无报错。
5. 离开页面后动画停下（不再有 rAF 请求 / 不报错）。

## 7. 待澄清

无。新增依赖 `animejs@4.5.0`（MIT，零依赖），理由即第 1 节。
