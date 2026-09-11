# Spec: rich-text 减少节点数

- **ID**: 035-rich-text-node-reduction
- **状态**: done
- **日期**: 2026-09-11

## 1. 要解决什么

spec 034 的 rich-text 在 iOS 真机 `eee48bc13d09c44b90fb7d0a7642fbc0ba994861`
（iOS 15.8.8，A9 / A10 这一代的老机器）上打开示例页会**卡 UI**；web 与模拟器上看不出来。

原因是它产出的节点太多。走 Flutter 渲染路径挂载、按 op 帧统计（2026-09-11 实测，
`fjs-runtime` 里挂 `FjsRichText` 解码 `Create` / `Insert` / `SetText`）：

| 内容 | 节点总数 | view | 段落 text | 片段 text | 裸文本叶子 | 帧字节 |
|---|---:|---:|---:|---:|---:|---:|
| 示例页「HTML 字符串」（1 标题 + 3 段） | 42 | 6 | 4 | 8 | 24 | 2.8 KB |
| 示例页「列表」（8 项） | 67 | 27 | 20 | 0 | 20 | 5.3 KB |
| 示例页「表格」（4 行 × 3 列） | 41 | 18 | 11 | 1 | 11 | 3.1 KB |
| 模拟长文（30 段混排 + 10 项列表 + 5×3 表 + 3 图） | **486** | 78 | 69 | 90 | **246** | 34.6 KB |

同一次测量里 JS 侧的解析 + 布局只要 0.44 ms（长文），**成本几乎全在节点数上**：
Flutter 侧每个节点是一个镜像节点 + 一次样式引擎解算 + op 编码，块级节点还有自己的
`_FjsNodeView` / `ListenableBuilder` / 装饰 / 手势包装。一篇普通商品详情单个 rich-text
就逼近 spec 006 的首帧预算（500）。

节点多在三处（`rich-text/layout.ts` 的现状）：

1. **裸文本叶子占一半**。`<b>加粗</b>` 生成「片段 `text` + 文本子节点」两个节点；段落里片段
   之间的每一截纯文字也各是一个节点。`<p>第 1 段：这是一段<b>加粗</b>与<span style>红字</span>混排的说明文字，<i>斜体</i>收尾。</p>`
   是 **12 个节点**：p 的 `view` + 段落 `text` + 3 个片段 + 7 个裸文本。
2. **块外面总有一层 `view`**。`<p>` / `<h3>` / `<td>` 里只有一段文字时，仍是
   「块 `view` + 匿名段落 `text`」两个节点。
3. **列表项 5 个节点起步**：行 `view` + 标记 `text` + 标记文字 + 内容 `view` + 段落。

## 2. 不做什么（Non-goals）

- **不改外观**。解析、白名单、默认样式、空白处理、列表编号、表格退化的结果一个像素都不变；
  web 与 iOS 上改动前后截图一致是验收项。
- **不做虚拟化 / 分页 / 延迟挂载**。上千段的长文该用 `list-view` 或分页，那是页面的事；
  `onPageSettled` 推迟重活也是页面的事。
- 不改 op 协议、natives 表、事件号；不新开 C ABI。
- 不优化图片解码（示例页里的本地大图另算）。
- 不动 `text` 嵌套 `text` 的既有语义（spec 034 §3.5）：模板里手写的嵌套 `text` 照旧是片段。
- web 侧 DOM 节点数会跟着下降，但 web 不是这次的目标，不单独设指标。

## 3. 用户可见的行为

页面写法**一行不变**，外观不变，节点数下降：

```vue
<rich-text :nodes="html" />
```

### 3.1 结构折叠（纯 JS，`rich-text/layout.ts` 与 `components/rich-text.ts`）

1. **单字符串走元素文本**：一个 `text`（段落或片段）的内容只有一个字符串时，用
   `h('text', data, '字符串')`，Vue 走 `setElementText`，不再单建文本子节点。
   Flutter 的 `text` 本来就优先读 `node.text`（`widgets/text.dart`），web 的 `text`
   组件把字符串放进同一个元素。
2. **块与唯一段落合并**：一个块（`p` / `h1`–`h6` / `div` / `blockquote` / `td` / `th` /
   `li` 的内容区…）里布局出来**只有一个匿名段落、没有别的块**时，不生成块 `view`，
   块的默认样式、`style` 属性、`class` 直接挂到段落 `text` 上。`text` 本身就是盒子
   （margin / padding / 背景都由 `decorateNode` 画），外观不变。需要横排的块（表格行、
   列表项的行）不合并。
3. **列表项去掉内容 `view`**：内容只有一个段落时，段落直接做行里的第二个子节点
   （`flex-grow: 1`）。

### 3.2 段落单节点（`text` 的内部 prop）

段落里的行内片段不再是嵌套的 `text` 节点，而是段落 `text` 上的**一个 prop**，
描述「按顺序的若干段文字 + 每段自己的样式」，宿主直接排版：

```ts
// components/rich-text.ts 写到段落 text 上；页面不写、文档不公开（§7 Q3）
richSpans: Array<string | { t: string; s: Record<string, unknown> }>
```

- **JS 侧拍平**：`<b>加粗<i>斜体</i></b>` 拍平成两段，第二段的样式是
  `{fontWeight: 'bold', fontStyle: 'italic'}`。每段只带**自己**的样式（默认样式 + `style`
  属性叠加后的结果），不带从段落继承的东西——继承由宿主做：Flutter 是 `TextSpan` 的样式
  继承，web 是 CSS 继承。`text-decoration` 在嵌套时合并（`<u>a<s>b</s></u>` 的 b 是
  `underline line-through`），与浏览器装饰线的传播一致。
- **Flutter**：`widgets/text.dart` 看到 `richSpans` 就直接建 `Text.rich`，每段一个
  `TextSpan`（`vertical-align: sub/super` 照 spec 034 做成平移的 `WidgetSpan`），
  不读子节点。
- **Web**：`text` 组件看到 `richSpans` 就在 `<text>` 里渲染 `<span style>`，
  样式值走 `normalizeStyleValues`（数字补 px）。
- **兜底**：段落里只要出现**带 `class` 的行内元素**或**图片**，这个段落退回 spec 034 的嵌套
  节点写法（同时享受 §3.1 的折叠）。原因：`class` 要页面 CSS 引擎解算，拍平后的纯数据里
  没有它；图片要自己的节点收加载事件、做 `WidgetSpan`。
- 段落只有一段且没有自身样式时，直接是元素文本（§3.1 第 1 条），不写 `richSpans`。
- `richSpans` 形状不对（不是数组、段不是字符串也不是 `{t, s}`）两端都 `warnOnce` 并按空段落渲染。

估算长文 486 → 约 90 个节点：30 段各 1 个、10 个列表项各 3 个（行 + 标记 + 段落）、
表格 1 + 5 行 + 15 个单元格段落、3 个图片段落各 2 个、根与标题与 `ul` 各 1。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 结构折叠 | 同一份 `layout.ts` 产物，元素少了；`text` 读元素文本、画盒子装饰都是既有能力 | 同左，`text` 组件既有能力 |
| 段落单节点 | `text.dart` 读 `richSpans` 建 `Text.rich`；上下标平移 `WidgetSpan` | `text` 组件读 `richSpans` 渲染 `<span style>` |
| 兜底 | 含 `class` 片段或图片的段落走嵌套 `text` 节点（spec 034） | 同左 |
| 事件载荷 | 不变：组件根上的 `@tap` / `@longpress` | 同左 |
| 已知差异 | 无新增 | 无新增 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— 不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）—— 不涉及
- [x] `text` 标签新增**内部** prop `richSpans`：走现有 `setProps`（JSON），不是新 op；
      Flutter `widgets/text.dart` 与 web `web/components/basic.ts` 的 `text` 同时实现。
      不进 `docs/ui-api.md` 标签表，只在 rich-text 小节里说明节点构成时提到（§7 Q3）

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm test` 通过；spec 034 的 `rich-text-parse` / `rich-text-layout` / `rich-text-component` /
   `vue_styles` 用例不改期望（布局结构类断言按新结构更新，但**渲染出的文字、样式、顺序不变**）。
3. 新增 `packages/fjs-runtime/test/rich-text-node-budget.test.ts`：走 Flutter 渲染路径挂载
   §1 表里的四份内容，按 op 帧统计节点数，断言不超过预算，防止以后回退：

   | 内容 | 改动前 | 预算 |
   |---|---:|---:|
   | 示例「HTML 字符串」 | 42 | ≤ 8 |
   | 示例「列表」 | 67 | ≤ 40 |
   | 示例「表格」 | 41 | ≤ 24 |
   | 模拟长文 | 486 | ≤ 120 |

   同一文件断言兜底路径：含 `class` 片段、含图片的段落仍渲染成嵌套节点，且文字与样式正确。
   另加 `richSpans` 的拍平用例（嵌套样式合并、装饰线合并、上下标、空段丢弃）。
4. `cd packages/flutter_fjs && flutter test` 通过（`No tests ran` 视为失败）。
5. 外观不变：`pnpm --filter hello-fjs run dev:web` 与 iOS 模拟器上，富文本示例页每一段在改动前后
   截图对照一致（段落数、行数、列表标记、表格行列、间距）。
6. **真机**：`fjs run ios --device eee48bc13d09c44b90fb7d0a7642fbc0ba994861`，打开 `fjs dev` 的
   性能面板（`p`），分别在改动前、改动后打开富文本示例页（含新增的「长文」段，§7 Q2），记录
   `nodes` 与 `ui` 最坏值；改动后两项都必须低于改动前，数字写进 tasks.md 的验收条目。
7. 文档：`docs/ui-api.md` 的 rich-text 小节写明节点构成与长文建议（超长内容用 `list-view` /
   分页）；`docs/performance.md` 记一条 rich-text 节点数的前后对比。

## 7. 待澄清

- [x] 已确认 Q1：**结构折叠 + 段落单节点**（§3.1 + §3.2），长文目标约 90，预算 ≤ 120。
      只做折叠（约 300，−38%）被否：裸文本节点仍占大头。
- [x] 已确认 Q2：**富文本示例页加一段「长文」**（30 段混排 + 列表 + 表格 + 图片），真机前后对比用整页。
- [x] 已确认 Q3：`richSpans` **只给 rich-text 内部用**，不进 `ui-api.md` 标签表，形状可随时改；两端照样都实现。
