# Plan: Anime.js 示例页

对应 [spec.md](spec.md)。只动 `examples/hello-fjs`，runtime / Dart / native 不改。

## 改动

| 文件 | 改什么 |
|---|---|
| `examples/hello-fjs/package.json` | 加 `animejs@4.5.0` |
| `examples/hello-fjs/src/anime/native-polyfills.ts` | App 端装 `setImmediate` / `clearImmediate` → `requestAnimationFrame` |
| `examples/hello-fjs/src/pages/example/anime.vue` | 三块演示：stagger 网格、timeline + 播放控制、缓动对比 + 计数器 |
| `examples/hello-fjs/src/catalog.ts` | 示例分组顺序加「动画演示」 |
| `examples/hello-fjs/README.md` | 「这个示例在验证什么」加一条 |

## 关键决定

- **polyfill 放页面级模块，不进 runtime**：和 023 的 three polyfill 同一条理由——
  这是某个库的需要，不是 element API 的需要。
- **target 是 JS 对象，不是 ref 出来的节点**：App 端 ref 不是 DOM，Anime.js 的
  CSS/transform 通道走不通；两端都用对象，行为才一致。Anime.js 对非 DOM target
  走 `tweenTypes.OBJECT`，直接 `target[prop] = value`，Vue 的 reactive 把写入
  攒成一次 setProps。
- **动画在 `onPageSettled` 里起**：避免和路由转场抢帧（027）。
- **卸载时 `revert()`**：App 端没有 `visibilitychange`，页面走了引擎也不会自己停。

## 验证顺序

typecheck → build:pages / build:web → web 预览 → iOS 模拟器 → Android 模拟器。
