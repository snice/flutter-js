# Spec: 小程序端开放 rich-text / picker-view / form / position 四个组件页

- **ID**: 048-mp-rich-text-picker-view-form
- **状态**: done
- **日期**: 2026-09-14

## 1. 要解决什么

`examples/hello-fjs/package.json` 的 `fjs.mp.exclude` 里排除了 `comp/rich-text`、
`comp/picker-view`、`comp/form`、`comp/position`（spec 046 T030 标为「首版不适配」）。
这四个都是小程序原生就有、或纯 CSS 就能表达的能力，不应被排除。去掉 exclude
后 `fjs build --mp` 能编译通过，但在微信开发者工具（skyline）里逐页看，现状是：

| 页 | 现象（DevTools skyline 实测） | 根因 |
|---|---|---|
| position | **正常**，与 web 一致 | 无（纯 CSS，首版排除是保守） |
| picker-view | 两个滚轮高度为 0，只剩一条横线 | 原生 `picker-view` 无默认高度；fjs 两端默认 5 行 × 44px，mp 没补 |
| picker-view | `@change` 页面 `JSON.parse(v)` 会抛 | `events.ts` 把 `detail.value`（数组）原样给出；契约是**下标数组 JSON 串** |
| form | `@submit` 与 `@reset` 同一元素，`@submit` 载荷形状不对 | 载荷应是 `{name: value}` 的 **JSON 串**，现在给的是对象 |
| form | 输入框聚焦时底线不变蓝 | 编译器不认 `:class="{ focused }"` 简写，告警并丢弃 |
| rich-text | 页面白屏，`module ... is not defined` | 同一资源第二次 import 时 `assetUrl()` 返回未加引号的路径（`const x = /assets/a.png;`，语法错误）；image 页先 import 过同一张图才触发 |
| rich-text | 「重新挂载」点了会抛 | wx 的 `fjs` 模块没有导出 `flushNow` |
| rich-text | 修掉白屏后：行内元素（b/i/u/mark/code…）每个独占一行；`ol` 无编号；表格挤成一行；`img` 的 width 不生效；`pre` 空白被折叠；上下标变成独立一行 | 走的是**原生** `rich-text`：skyline 的 rich-text 只是有限子集，也没有 fjs 的默认样式 / 列表编号 / 表格退化 / 白名单告警 |

另外顺带发现（不在四页里，但同一个缺口）：`picker` 的 `multiSelector` 在 mp 上
`@change` 同样给数组、`@columnchange` 给对象，契约都是 JSON 串，页面的
`JSON.parse` 会抛。

## 2. 不做什么（Non-goals）

- **不**开放 exclude 里的其它页：canvas、web-view、refresh 以及 `example/*`
  （canvas 桥、webview 插件、下拉刷新各自另开 spec）。
- **不**改 Flutter / Web 两端的任何行为与契约；本 spec 只让小程序端追平已有契约。
- **不**做 rich-text 的 `user-select` / `mode`（两端本就不支持）。
- **不**做 `label for="<input id>"` 点击聚焦输入框（mp 的 fjs-label 目前只转发给
  checkbox / radio；另两端行为另行核对后再说）。
- **不**追 skyline 渲染器本身的限制（如 `mask-image` 不支持 → picker-view 上下渐隐
  可能画不出来，登记为已知差异）。

## 3. 用户可见的行为

页面源码**一行不改**，只把四项从 `fjs.mp.exclude` 删掉：

```jsonc
"fjs": { "mp": { "exclude": [ /* 不再有 comp/rich-text、comp/picker-view、comp/form、comp/position */ ] } }
```

- **position**：保持现状（已一致）。
- **picker-view**：默认高度 5 × `item-height`（默认 44px），行高 44、居中、中间一条
  选中框（上下 1px `#e5e5ea`），数值同 `web/base-css.ts`；`@change` 载荷
  `"[6,8]"` 这样的 JSON 串。`item-height` / `indicator-style` 映射到原生对应能力。
- **form**：`@submit` 载荷是 `{name: value}` JSON 串（switch 为布尔、input 为文本，
  与 `components/form.ts` 的 `typedValue` 一致），`@reset` 无载荷；
  `:class="{ focused }"` 简写正常展开。
- **rich-text**：渲染结果与 web 一致——同一段里的加粗 / 变色 / 上下标在同一行，
  列表有 `•◦■` 与 `C. D.`、`i. ii.` 编号，表格是 flex 网格，img 按 width/height，
  `pre` 保留空白，非白名单标签连同子树删除并告警，页面 scoped class 能命中内部节点，
  `@tap` 生效，切换 `nodes` 整段更新。
- **picker multiSelector**：`@change` / `@columnchange` 载荷与另两端一致（JSON 串）。

## 4. 端间约定（宪法 I）

本 spec 是第三端（小程序）追平既有契约，Flutter / Web 不动：

| | Flutter / Web（现状，契约来源） | 小程序（本 spec 之后） |
|---|---|---|
| rich-text | `components/rich-text.ts` 走 `rich-text/*` 管线（parse → sanitize → layout → spans），渲染成 view/text/image/divider | **同一条管线**在 wx 运行时跑，产出的 `RenderElement` 树由 runtime 组件用 view / 嵌套 text / image 画出（见待澄清 Q1） |
| picker-view `@change` | 下标数组 JSON 串 | 同 |
| picker-view 外观 | 5 行 × 44px，选中框细线，上下渐隐 | 高度/行高/选中框同；渐隐视 skyline 支持情况，不支持则登记差异 |
| form `@submit` | `{name: value}` JSON 串，文档序 | 同（取原生 form 的 `detail.value` 序列化） |
| picker multiSelector | `@change` 下标数组 JSON 串；`@columnchange` `{"column":0,"value":2}` | 同 |
| 已知差异 | — | 写进 `docs/miniprogram.md`「已知差异」 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（只动 `packages/fjs/src/mp/*` 与 `packages/fjs-runtime/src/wx/*`）

## 6. 验收标准

1. `examples/hello-fjs/package.json` 的 `fjs.mp.exclude` 不含这四项；
   `pnpm --filter hello-fjs build:mp` 通过，且不再有 `form.vue: unsupported :class object entries` 告警。
2. `pnpm --filter @ufjs/cli test`（mp-compiler 单测）通过，新增用例覆盖：
   `:class` 对象简写、同一资源被两个模块 import 时两处都是带引号的字面量。
3. `pnpm --filter @ufjs/runtime test` 通过，新增用例覆盖 `adaptEvent`：
   picker-view change、form submit、picker multiSelector change/columnchange 的载荷为 JSON 串。
4. 微信开发者工具（skyline）逐页与 web（`localhost:5173/#/comp/<x>`）对照截图：
   - `comp/position`：两处定位与 web 一致；
   - `comp/picker-view`：两个滚轮 220px 高、可滚，滚动后 Panel 描述文字随之变化，联动列换省后市列更新；
   - `comp/form`：填昵称、开开关、点「提交」→ 提交面板描述显示 JSON 串；点「重置」→ 字段清空；聚焦昵称输入框底线变蓝；
   - `comp/rich-text`：第 3 节列出的各块与 web 截图一致，控制台有 script/iframe 告警各一次、无报错；点富文本 @tap 计数 +1；「切换内容」「重新挂载」可用。
5. （Q2）form 内放 `checkbox`（带 name）、`checkbox-group` + 两个 checkbox、`radio-group` + radio 的临时页，
   在 DevTools 里切换后提交，载荷分别为布尔、名字数组、选中名字，组内成员不单独出现——与 web 同一临时页的载荷逐字一致。
6. `docs/miniprogram.md` 标签映射表 / 已知差异 / hello-fjs 开放情况同步更新。

## 7. 待澄清

> 2026-09-14 用户答复「是」：Q1 取建议方案（runtime 组件复用 JS 管线），Q2 一并做。

- [x] **Q1 rich-text 在 mp 上的实现方式**。原生 skyline `rich-text` 效果很差（见第 1 节）。建议：
  新增 runtime 组件 `fjs-rich-text`，在 wx 运行时复用 `rich-text/*` 同一条管线，
  用 view + 嵌套 text + image 递归模板画出——与另两端「同一份 JS」一致，代价是节点数多于原生、
  长文首帧稍慢。备选：继续用原生 `rich-text`，只把 fjs 管线的结果转成原生 nodes 数组喂进去
  （节点少，但 skyline 原生 rich-text 行内 / 表格 / 图片的排版问题绕不开）。
- [x] **Q2 form 收集 fjs-checkbox / fjs-radio（及 group）**。mp 上它们是自定义组件，原生 `form`
  收不到值。form 页本身没用到。是否一并给这几个组件加 `wx://form-field` 让它们进入提交载荷？
