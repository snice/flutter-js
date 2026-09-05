# Spec: ECharts 速度表与 F2 示例

- **ID**: 020-chart-examples
- **状态**: in-progress
- **日期**: 2026-09-05

## 1. 要解决什么

019 把 `<canvas>` 和 ECharts 接上了，hello-fjs 里只有柱状+折线、饼图两种
series。页面要证明的下一件事是：

- **同一套适配层能跑 gauge**——官方「阶段速度仪表盘」
  （[gauge-stage](https://echarts.apache.org/examples/zh/editor.html?c=gauge-stage)）
  带指针、分段色轴、数值动画，和 cartesian / pie 不是同一条绘制路径；
- **换一个只认 `CanvasRenderingContext2D` 的库也能画**——F2
  （[示例](https://f2.antv.antgroup.com/examples)）是移动端图表的另一条主流，
  接上它才能说明 canvas 对标的是 2D 上下文，不是 ECharts 一家。

## 2. 不做什么（Non-goals）

- 不抽 `@ufjs/echarts` / `@ufjs/f2` npm 包。适配层继续放在 hello-fjs 示例里
  （019 §7.2 同一条：形状稳定后再考虑）。
- 不给 `demo` 加业务依赖。
- 不引入 `@antv/f-vue`、不给 hello-fjs 配 JSX/Babel。官方 Vue 教程那条路要
  DOM `<canvas>` + React JSX transform，两端都走不通；用 `@antv/f2` 的
  `createElement` + `new Canvas({ context })`（小程序 / Node 同一条）。
- 不实现 F2 示例站上的全部图，只挑三种基础几何：折线、柱状、饼图。
- 不改 UI op / natives / 事件契约。
- 不新做 WebGL、离屏 canvas。

## 3. 用户可见的行为

### 3.1 ECharts 速度表

`examples/hello-fjs/src/pages/example/echarts.vue` 在饼图旁加一块
「阶段速度表」，option 对齐官方 gauge-stage（分段色轴 + 指针 + `{value} km/h`），
数值按官方节奏约 2s 更新一次。两端同一份 option，走现有 `createChart`。

字号/线宽按 240px 高的手机画布收一档（官方示例按桌面大画布写的 20px 字），
色停和交互语义不变。

### 3.2 F2 示例页

新页 `examples/hello-fjs/src/pages/example/f2.vue`，`<route>` 进「画布演示」：

```vue
<canvas ref="bar" class="chart" @resize="mountBar"
  @touchstart="onTouch('bar', 'start', $event)"
  @touchmove="onTouch('bar', 'move', $event)"
  @touchend="onTouch('bar', 'end', $event)" />
```

适配层 `examples/hello-fjs/src/f2/adapter.ts` 把 fjs canvas 的 `getContext('2d')`
交给 `new Canvas({ context, width, height, pixelRatio })`。页面用
`createElement` 拼 Chart，不写 JSX。

至少三块：折线、柱状、饼图。触摸能出 F2 自带的 canvas tooltip（F2 的 Tooltip
画进位图，不依赖 DOM）。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 画布 | 现有 `<canvas>` / `inner-canvas` | 同 |
| ECharts gauge | 现有 adapter + richText tooltip 规范化 | 同 |
| F2 | `createElement` + `new Canvas({ context })`，pixelRatio 取 `canvas.devicePixelRatio`（App=1，web=浏览器） | 同 |
| 触摸 | `@touch*` → 适配层转成 F2 / zrender 要的指针事件 | 同 |
| 已知差异 | 字体度量亚像素差（019 已登记）；gauge 数值动画两端帧率可以不同 | |

`@antv/f-vue` 禁用：它自己挂 DOM canvas，web 能跑、App 空白。

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm --filter @ufjs/runtime test` 既有用例不回退（本 spec 不改 runtime）。
3. `/example/echarts` 在 web 与 App 上除原有两块外能看到速度表，指针和分段色轴在，数值会变。
4. `/example/f2` 出现在示例「画布演示」分组，折线 / 柱状 / 饼图两端都能画出来，点/滑能出 tooltip。
5. `docs/canvas-compat.md` 在 ECharts 节旁登记 F2 接法（和「不要用 `@antv/f-vue`」）。

## 7. 待澄清

无。F2 三种几何按官方「基础折线 / 基础柱状 / 基础饼图」各取一张，与 echarts
页的覆盖面对齐。
