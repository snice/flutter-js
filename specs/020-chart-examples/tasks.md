# Tasks: ECharts 速度表与 F2 示例

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## ECharts 速度表

- [x] T001 在 `examples/hello-fjs/src/pages/example/echarts.vue` 加「阶段速度表」Panel：官方 gauge-stage option（分段色轴 + 指针 + km/h），字号按 240px 画布收一档，2s 更新 value，卸载时清 interval。

## F2 适配与示例

- [x] T010 `examples/hello-fjs` 加 `@antv/f2` 依赖（`demo` 不加）。
- [x] T011 写 `examples/hello-fjs/src/f2/adapter.ts`：`createChart(canvas, children)`，把 context / 尺寸 / pixelRatio 交给 `new Canvas`；触摸转发。头注释写清为什么不用 `@antv/f-vue`。
- [x] T011b Flutter esbuild 补回 `mainFields: ['module','main']`（`platform:neutral` 默认不读它们，`@antv/f2` 没有根目录 `index.js` 会 `Could not resolve`）。`packages/fjs` + 回归测试。
- [x] T012 写 `examples/hello-fjs/src/pages/example/f2.vue`：折线、柱状、饼图三块，`<route>` group 为「画布演示」。
- [x] T013 F2 Tooltip / Legend 走 canvas 图形，不依赖 DOM。

## 文档

- [x] T020 `docs/canvas-compat.md` 登记 F2 接法与「不要用 `@antv/f-vue`」。
- [x] T021 `docs/roadmap.md` canvas 节补 F2 示例一句。

## 验收

- [x] T030 `pnpm --filter hello-fjs run typecheck`
- [ ] T031 `pnpm --filter @ufjs/runtime test` 不回退
- [ ] T032 spec.md 第 6 节逐条核对，spec 状态改为 done
