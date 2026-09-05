# Plan: ECharts 速度表与 F2 示例

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 两页都只写 fjs `<canvas>`；ECharts 复用现有 adapter；F2 自写 adapter，两端同一份 `createElement` 树。不用 `@antv/f-vue`。 |
| II 边界即契约 | 否 | 不改 op / natives / 事件。 |
| III 同步单线程零序列化 | 否 | 绘制仍走 019 的 canvas 显示列表。 |
| IV 外观照 WeUI | 弱 | 图表色用官方示例色；页面外壳继续 Panel。gauge 字号按手机画布收。 |
| V 静默失效是 bug | 是 | F2 若要离屏 canvas / DOM，适配层 `warnOnce`，不给假对象装成功。 |
| VI 注释记录权衡 | 是 | adapter 头注释写清为什么不用 `@antv/f-vue`、pixelRatio 谁乘、触摸怎么转。 |
| VII JS 能包就不要下 Dart | 是 | 全部 JS 示例 + 现有 canvas。 |
| VIII 变更落到文档 | 是 | `docs/canvas-compat.md` 加 F2 小节。roadmap 补一句示例。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 示例 | `examples/hello-fjs/src/pages/example/echarts.vue` | 加 gauge-stage 速度表 |
| 示例 | `examples/hello-fjs/src/f2/adapter.ts` | **新建** F2 适配层 |
| 示例 | `examples/hello-fjs/src/pages/example/f2.vue` | **新建** F2 示例页 |
| 示例 | `examples/hello-fjs/package.json` | 加 `@antv/f2` |
| 文档 | `docs/canvas-compat.md` | §11 旁登记 F2 |
| 文档 | `docs/roadmap.md` | canvas 节补 F2 示例 |
| CLI / runtime / Dart / C++ | — | 不动 |

## 3. 方案

**ECharts 速度表**：第三块 Panel，option 抄官方
`public/examples/ts/gauge-stage.ts`（分段色 `[0.3,#67e0e3] / [0.7,#37a2da] / [1,#fd666d]`，
指针 `color: 'auto'`，detail `{value} km/h`），`setInterval` 2s 改 value，
`onBeforeUnmount` 清掉。字号/线宽按 240px 高缩放。走现成 `createChart`。

**F2**：`@antv/f2` 的 `Canvas` 只要标准 2D context（小程序教程原话）。适配层：

1. `ctx = canvas.getContext('2d')`，`new Canvas({ context: ctx, width, height, pixelRatio: canvas.devicePixelRatio || 1, children })`。
2. 图表树用 `createElement(Chart, …)`，hello-fjs 不配 JSX。
3. 触摸：F2 / f-engine 通常听 `context.canvas` 上的 pointer/touch。fjs 的
   `ctx.canvas` 已指向元素，但没有 DOM 监听；适配层给一个可订阅的壳，
   `@touch*` 转成它要的事件（和 ECharts 的 `handleTouch` 同形）。
4. pixelRatio 交给 F2 自己乘——和 ECharts adapter 同一条契约（web 上
   zrender/F2 都会 `setTransform` 冲掉预置 dpr）。

**否掉**：`@antv/f-vue`（DOM canvas）；在 echarts.vue 里混放 F2（两个库的
adapter / 触摸转发缠在一起，目录也对不上「再添加个示例」）。

## 4. 风险

- F2 初始化若读 `window` / `document.createElement` / `getBoundingClientRect`，
  App 上会炸。适配层按需补最小空壳，补不了的 `warnOnce`。
- F2 Tooltip 若走 HTML 而不是 canvas 图形，App 上出不来——实现期先核对，
  默认用 F2 自带的 canvas Tooltip；不行就插槽 tooltip（echarts 饼图那条）。
- gauge `valueAnimation` 依赖 ECharts 动画；019 已把 `echarts.env.node`
  在 init 后翻掉，动画应在。若 App 上指针跳变不过渡，记进兼容表，不为此改引擎。

## 5. 验证路径

```bash
pnpm --filter hello-fjs run typecheck
pnpm --filter @ufjs/runtime test
# web: pnpm --filter hello-fjs run dev:web → /example/echarts、/example/f2
# App: 现有 fjs go / 模拟器热更新同一份 bundle
```
