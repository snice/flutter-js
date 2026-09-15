# Plan: hello-fjs 增加 LeaferJS 示例 —— 消消乐（三端含小程序）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | 一份页面源码；平台差异只在 `@/leafer/platform` 里「有没有真 wx」一处分支 |
| II 边界即契约 | 不涉及 | |
| III 同步单线程 | 不涉及 | |
| IV WeUI | 不涉及 | 画布外沿用 pixi 版的样式 |
| V 静默失效 | 涉及 | 启动异常落页面遮罩；离屏画布桩只吞「不会被本页用到」的调用，注释列明 |
| VI 注释记录权衡 | 涉及 | 适配模块顶部记录为何选 miniapp 包、为何关局部重绘、为何不用交互 |
| VII JS 能包 | 满足 | 零 Dart |
| VIII 文档 | 部分 | hello-fjs README 补一行 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 依赖 | `examples/hello-fjs/package.json` | `@leafer-ui/miniapp@2.2.10`（理由：三端共用的 2d 场景图，spec §1）|
| 适配 | `examples/hello-fjs/src/leafer/platform.ts` | 新建：无 wx 时 `useCanvas('miniapp', fakeHost)`；`Platform.requestRender` 改 rAF；`mountLeafer(cv, w, h)` |
| 页面 | `examples/hello-fjs/src/pages/example/game/match3-leafer.vue` | 新建：复刻 match3.vue 的玩法/状态机/HUD，渲染换 Leafer |
| 文档 | `examples/hello-fjs/README.md` | 示例说明 |

## 3. 方案

- **view 对象**：传给 `new Leafer({ view })` 的是普通对象
  `{ width, height, getContext: () => ctx }`：LeaferCanvas 的 `initView`
  看到 `getContext` 就直接取 context；它会往 `view.width/height` 写位图尺寸，
  fjs canvas 这两个只读，所以不能直接传 fjs 的 canvas api（ECharts 同理）。
- **pixelRatio**：`config.pixelRatio = cv.devicePixelRatio`；Leafer 每次
  `setTransform(world × pixelRatio)` 是绝对变换，会冲掉宿主预置的 dpr，
  所以必须把真实位图比例交给它（F2 同理）。
- **fakeHost**：`createOffscreenCanvas` → `{ width, height, getContext: () => stubCtx }`，
  stubCtx 是一个所有方法 no-op 的 Proxy；`getWindowInfo` → `{ pixelRatio: 1 }`；
  `onWindowResize/offWindowResize` no-op。本页不走 Text/图片/临时画布路径，桩不会被真用到。
- **局部重绘关闭**：`usePartRender: false`。
- **尺寸变化**：`LeaferCanvasBase.resize` 在已有尺寸时会 `getSameCanvas` 拷贝旧图
  （离屏路径），所以尺寸变化时销毁重建 Leafer 而不是 resize。
- **小程序**：vendor 打包里 `wx` 是真全局，Leafer 包导入时自己 `useCanvas`；
  适配层检测到已有 `Platform.origin` 就不再装 fakeHost。

## 4. 风险

- wx 的 2d context 被 fjs 包成普通对象（`forwardContext`），Leafer 的
  `canvasPatch(context.__proto__)` 会看 `roundRect`：wx 原生有，转发对象上也有，不会去改 `Object.prototype`；App 端的 context 是类实例，补到类原型上，无害。
- 开发者工具要求「将 JS 编译成 ES5」—— fjs mp 构建 vendor 是 esbuild es2018，
  若 DevTools 报语法问题再处理。

## 5. 验证路径

```bash
pnpm --filter hello-fjs run typecheck
pnpm --filter hello-fjs run dev:web
pnpm --filter hello-fjs run build:mp
pnpm test
```
