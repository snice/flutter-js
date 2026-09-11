# Plan: rich-text 减少节点数

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | **结构折叠**只改两端共用的 `fjs-runtime/src/rich-text/layout.ts` 与 `components/rich-text.ts`，产物仍是 `view` / `text` / `image` / `divider`，靠的都是两端既有能力（`text` 读元素文本、画盒子装饰、当 flex 子节点）。**段落单节点**是 `text` 的新内部 prop `richSpans`，两端各实现一次：Flutter `flutter_fjs/lib/src/widgets/text.dart`（`buildText` 读它建 `Text.rich`），Web `fjs-runtime/src/web/components/basic.ts`（`FjsText` 从 `container('text')` 换成读它渲染 `<span>` 的组件）。页面源码一行不改 |
| II 边界即契约 | 否 | 三张表都不动。`richSpans` 走现有 `setProps`：`ui/element.ts:328` 对任意值原样 `recordField` + JSON 过桥，Dart 侧落进 `MirrorNode.props`（`Map<String, Object?>`），不是新 op、不是新 native、不是新事件号 |
| III 同步单线程零序列化 | 是 | 不引入桥；`richSpans` 和其它 prop 一样随同一帧的 `SetProps` 过去。节点少了，帧反而更小（长文 34.6 KB 起）。Vue 的 `patchProp` 按引用比较，`layout` 是 `computed`，重渲染不会重发 |
| IV 外观照 WeUI | 否 | 外观不变是验收项（spec §6.5）。没有新增默认值 |
| V 静默失效是 bug | 是 | `richSpans` 形状不对：两端都 `warnOnce` 并按空段落渲染（Flutter `text.dart` 的 debug 告警，web `basic.ts` 的 `warnControlOnce` 同一通道）。同一个 `text` 既有 `richSpans` 又有子节点：`richSpans` 胜出，两端都告警一次（rich-text 不会产出，只可能是手写） |
| VI 注释记录权衡 | 是 | 要写下的：`layout.ts`——为什么段落要拍平成数据、兜底的两个条件（class、图片）为什么不能拍平、装饰线为什么要合并、块为什么能与唯一段落合并而表格行 / 列表行不能；`components/rich-text.ts`——单字符串走元素文本（省掉文本子节点）；`text.dart`——片段样式为什么不能用 `fjsTextStyle`（它会钉死 14px / #333333，把继承断掉），为什么 `richSpans` 优先于子节点；`basic.ts`——`FjsText` 为什么不再是通用 container |
| VII JS 能包就不要下 Dart | 是 | 结构折叠全在 JS。下到 Dart 的只有「读一份片段描述建 `TextSpan`」：spec 034 已经为行内排版下到了 `text.dart`，这次是把**同一个能力**的输入从「子 `MirrorNode`」换成「一个 prop」，理由是有实测的性能依据（宪法 VII 的第三种）——长文 486 个节点里 246 个是裸文本叶子、90 个是片段，真机上 JS 对象数主导 GC（`docs/performance.md`「真机上是 GC 在主导」：6 万活对象、全堆标记）。拍平、样式合并、兜底判断都留在 JS |
| VIII 变更落到文档 | 是 | `docs/ui-api.md` 的 rich-text 小节（`### rich-text`，第 286 行起）加「节点构成」：一段一个节点、兜底条件、长文建议用 `list-view` / 分页；`richSpans` 只在这里点一句是内部 prop，**不进标签表**（spec §7 Q3）。`docs/performance.md` 加一节「rich-text 的节点数」：改动前后四份内容的节点数与帧字节、真机面板数字。`docs/roadmap.md` 在 rich-text 条目下记一行 |

破例：无。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/rich-text/layout.ts` | ① `buildParagraph` 结尾加「拍平」：段落里没有带 `class` 的行内元素、没有图片时，把片段树拍成 `Array<string \| {t, s}>`，相邻同样式段合并、空段丢弃；只剩一个无样式字符串 → `children: [str]`；否则 → `props.richSpans`。有 `class` 或图片 → 保持 034 的嵌套结构（兜底）。② `layoutBlock` 默认分支：块的布局结果**恰好是一个匿名段落**时，返回该段落，把块的 `style` / `class` / margin 元数据挂上去；**无样式无 class 的块只有一个子块**时直接返回子块。③ `layoutListItem`：内容只有一个 `text` 时省掉内容 `view`，把 `flexGrow: 1, flexShrink: 1, minWidth: 0` 合进它。④ `layoutCell`：同 ②，单元格与唯一段落合并。匿名段落用 `meta` 里的 `anonymous` 标记识别 |
| | `packages/fjs-runtime/src/rich-text/spans.ts`（新） | 拍平的纯函数：`flattenSpans(children)` → `RichSpan[] \| null`（null 表示要兜底）；样式合并规则（后写的覆盖、`textDecoration` 取并集）；`RichSpan` 类型。单测直接测它 |
| | `packages/fjs-runtime/src/components/rich-text.ts` | `renderElement`：`children` 恰好是一个字符串 → `h(target, data, str)`（元素）/ `h(target, data, { default: () => str })`（web 组件），不再建文本子节点；`props.richSpans` 原样放进 data |
| Web 适配层 | `packages/fjs-runtime/src/web/components/basic.ts` | `FjsText` 改成独立组件：`richSpans` 是数组时渲染 `h('text', attrs, spans.map(s => typeof s === 'string' ? s : h('span', { style: normalizeStyleValues(s.s) }, s.t)))`，并从透传 attrs 里去掉 `richSpans`（否则会被写成 DOM 属性 `[object Object]`）；不是数组时行为与原 `container('text')` 完全一致（按压绑定、`hostAttrs`） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/text.dart` | `buildText` 开头：`node.props['richSpans']` 是 `List` → `Text.rich(TextSpan(style: fjsTextStyle(style), children: [...]))`；每段 `TextSpan(text: t, style: fjsSpanStyle(FjsStyle({'style': s}), parent))`；`verticalAlign: sub/super` 复用现有平移 `WidgetSpan` 逻辑（抽成 `_shifted`）。新增 `fjsSpanStyle`：只填 map 里有的字段，其余为 null（继承），`lineHeight` 按该段自己的字号换算。形状不对 / 与子节点并存 → debug 告警一次 |
| | `packages/flutter_fjs/lib/src/render/renderer.dart` | **实现时补上（plan 未预料）**：`FjsNodeRenderer.isHidden` 把「没有 `node.text`、没有子节点的 `text`」当成 Vue 的空锚点藏掉（第 89 行），而带 `richSpans` 的段落恰好长这样——不改的话整段在 Flutter 上不显示。条件加上「且没有 `richSpans` prop」。由 `rich_text_test.dart` 的 richSpans 用例发现 |
| 测试 | `packages/fjs-runtime/test/rich-text-node-budget.test.ts`（新） | 由 scratchpad 里的测量脚本整理而来：Flutter 渲染路径挂载 spec §1 的四份内容，解码 op 帧统计节点，断言预算（8 / 40 / 24 / 120）；兜底路径（`<span class>`、`<img>`）仍是嵌套节点且文字正确 |
| | `packages/fjs-runtime/test/rich-text-spans.test.ts`（新） | `flattenSpans`：嵌套样式合并、装饰线并集、上下标、相邻同样式合并、空段丢弃、遇 class / 图片返回 null |
| | `packages/fjs-runtime/test/rich-text-layout.test.ts` | 结构类断言按新结构更新（块与段落合并、`richSpans`、li 无内容 view、单元格合并）；**文字、样式值、顺序、margin 折叠结果的期望不变** |
| | `packages/fjs-runtime/test/rich-text-component.test.ts` | web DOM：片段从 `text > text` 变 `text > span`；新增「单字符串不生成文本子节点」「`richSpans` 不出现在 DOM 属性上」 |
| | `packages/fjs-runtime/test/vue_styles.test.ts` | 不改：它用 `<span class="hl">`，走兜底路径，断言仍成立（实现时跑一遍确认） |
| | `packages/flutter_fjs/test/rich_text_test.dart` | 加用例：带 `richSpans` 的 `text` → 一个 `RichText`，段的粗细 / 颜色 / 未写字段继承段落样式；`sub` / `super` 是平移 `WidgetSpan`；形状不对不崩。`_W` 补 `setProps` |
| 示例 | `examples/hello-fjs/src/pages/comp/rich-text.vue` | 新增「长文」Panel：内容与 budget 测试里的模拟长文同一份生成规则；一个「重新挂载」按钮（`v-if` 翻转），用 `nowMs()` 量从翻转到 `flushNow()` 返回的 JS 耗时，显示在页面上并 `console.log`——真机上能直接读、也能从 dev 日志流里取 |
| 文档 | `docs/ui-api.md` / `docs/performance.md` / `docs/roadmap.md` | 见宪法自查 VIII |
| C++ 引擎 / CLI | — | 不涉及 |

## 3. 方案

### 3.1 节点从哪里省（长文 486 → 约 90）

| 来源 | 现在 | 之后 | 手段 |
|---|---:|---:|---|
| 30 个混排 `<p>` | 30 × 12 = 360 | 30 | 块与段落合并 + `richSpans` |
| 10 个 `<li>` | 10 × 5 + 1 = 51 | 10 × 3 + 1 = 31 | 标记用元素文本、去内容 view、段落元素文本 |
| 5 × 3 表格 | 1 + 5 + 15 × 3 = 51 | 1 + 5 + 15 = 21 | 单元格与段落合并、元素文本 |
| 3 个图片段落 | 3 × 3 = 9 | 3 × 2 = 6 | 块与段落合并；段落含图片走兜底 |
| 根 + `h2` | 1 + 3 | 1 + 1 | 同上 |

### 3.2 结构折叠

**单字符串走元素文本**放在组件里而不是 layout 里：layout 的产物形状不变
（`children: ['x']`），只是渲染时少建一个节点，layout 的大部分单测不用改。
Flutter 上 Vue 走 `setElementText` → `node.text`，`buildText` 本来就先读它；
web 上 `FjsText` 把字符串放进同一个 `<text>` 元素。内容从字符串变成数组时 Vue
自己会先清元素文本再挂子节点，两端都已支持。

**块与唯一段落合并**的条件，缺一不可：

1. 块走 `layoutBlock` 的默认分支（不是列表、表格、`hr`）；
2. 布局出来的 `children` 恰好一个，且是**匿名段落**（`meta.anonymous`，不是另一个块合并来的
   `text`——那种嵌套块保留外层，免得两个块的 margin 叠到一个盒子上改变折叠结果）；
3. 块自己没有 `display` / `flexDirection` 类布局样式（`attrs.style` 里写了就不合并）。

合并后段落拿走块的 `style`（默认样式 + `style` 属性）、`class`、margin 元数据，
兄弟 margin 折叠照旧在它身上做。`text` 是盒子：margin / padding / 背景 / 圆角由
`decorateNode`（Flutter）与普通 CSS（web）画，位置与原来的「view 套 text」一致；
在列布局里默认 `align-items: stretch`，宽度也一致。

**无样式无 class 的块只有一个子块时直接返回子块**：`<div><p>x</p></div>` 这类编辑器
常见的外壳。

被否掉的：**把列表项的标记拼进段落开头**（一个 `text` 装下整个 `li`）。hanging indent
做不出来——第二行会顶到标记下面，与浏览器不同，列表项多行时一眼可见。

被否掉的：**去掉 rich-text 的根 `view`**。根上要挂页面的 `class` / `style` / `@tap`，内容又常常
不止一个块；只有一段时省一个节点，不值得多一条分支。

### 3.3 段落单节点：`richSpans`

```ts
type RichSpan = string | { t: string; s: Record<string, unknown> };
```

**拍平**（`rich-text/spans.ts`）：深度优先走段落的片段树，维护一个「当前样式」栈；
遇到字符串输出一段，样式是栈上从外到内的合并：

- 普通字段后写覆盖（`<b style="font-weight:normal">` 里是 normal）；
- `textDecoration` 取并集去重（`<u>a<s>b</s></u>` 的 b 是 `underline line-through`），
  这是浏览器装饰线传播的效果；Flutter 的 `TextDecoration.combine` 与 web 的
  `text-decoration: underline line-through` 都认这个写法（`style_parse.dart:288` 附近
  的解析要确认支持空格分隔多值，不支持就补——见风险 3）；
- 相邻两段样式 JSON 相同就并成一段；空字符串丢弃。

**遇到带 `class` 的片段或图片返回 null**，段落走 034 的嵌套写法。class 的样式要页面的
CSS 引擎按作用域解算，拍平后的纯数据没有元素可匹配；图片要自己的节点收
`@load` / `@error`、按 `mode` 布局。两者在编辑器产出的正文里都不常见（正文用内联
`style`），兜底不影响长文的主路径。

**Flutter**：`buildText` 先看 `props['richSpans']`：

```dart
final spans = node.props['richSpans'];
if (spans is List) {
  return Text.rich(
    TextSpan(style: fjsTextStyle(style), children: [for (final s in spans) _richSpan(s, style)]),
    textAlign: ..., maxLines: ..., overflow: ...,
  );
}
```

段样式用新的 `fjsSpanStyle`，**不能**用 `fjsTextStyle`：后者给没写的颜色 / 字号填
`#333333` / 14px，会把段落的 `color`（页面 class 设在 rich-text 上、样式引擎折进段落
自己的样式里）在每一段上盖回灰色。`fjsSpanStyle` 只填 map 里出现的字段。

**Web**：`<text>` 里放 `<span style>`。继承是 CSS 自己的；`vertical-align` /
`background-color` / `text-decoration` 原生生效。`base-css.ts` 的 `text text` 规则不
碰 `span`，不需要改。

被否掉的：**`richSpans` 里带样式 id，样式表单独下发**（像 op 协议的样式驻留）。
一段段落里通常就两三种样式，内联的 JSON 比多一张表简单；真要压帧字节，是 op 层的事。

被否掉的：**保留片段节点，只把裸文本叶子换成元素文本**。长文只能到约 300（spec §7 Q1 已否）。

被否掉的：**让样式引擎也给拍平后的段解算 class**（伪造一个不挂载的元素去匹配）。
要么在引擎里加一条不走元素树的匹配路径，要么每段真建一个元素再丢掉——前者动了
样式引擎的核心假设，后者省下的节点又花回 JS 对象上，而真机上的瓶颈正是 JS 对象数。

### 3.4 真机测量

dev server 的 WebSocket 接受工具消息（`packages/fjs/src/dev/server.ts:399`）：先发
`{"fjs":"tool"}` 登记，再发 `{"fjs":"perf"}` 切换连着的 app 上的性能面板
（第 424 行，就是为「`fjs run` 起的 dev server 没有 TTY」准备的），日志以
`{"fjs":"log"}` 推回工具连接。于是：

1. 用 `fjs run ios --device eee48bc13d09c44b90fb7d0a7642fbc0ba994861` 起真机（dev 模式）；
2. 脚本连 dev server，发 `perf` 打开面板，读日志流里示例页「长文」段打出的 JS 挂载耗时；
3. 面板上的 `nodes` 与 `ui` 最坏值是 Dart 侧画在屏幕上的，**需要用户在手机上读数或截图**
   （物理机截图工具 `idevicescreenshot` 本机没装）。

顺序：**先加「长文」段并在 main 现状上测一次基线**，再改实现，再测一次。基线不先测，
改完就没有「改动前」了。

## 4. 风险

1. **外观回归**：块与段落合并后，`text` 的默认 `flex-shrink: 0`（web `base-css.ts` 的 `text` 规则）
   与 `view` 的不同——在横排容器里（表格行、列表行）合并出来的 `text` 必须显式带
   `flexShrink: 1` / `minWidth: 0`，否则长单元格会顶出行宽。两端截图对照必须覆盖表格与列表。
2. **兜底路径被误触**：`<a class="link">` 这类编辑器常带的 class 会让整段退回嵌套节点。
   budget 测试的长文不含 class，示例页「scoped class」段专门走兜底——两条路都有覆盖；
   文档里写明「正文里的 class 会让那一段多出节点」。
3. **装饰线多值**：`underline line-through` 在 Dart 的解析里是否支持要先确认
   （`render/style_parse.dart` 的 `textDecoration`）。不支持就在 `fjsSpanStyle` 里按空格拆开
   `TextDecoration.combine`，不改通用解析。
4. **`richSpans` 与元素文本并存**：不会由 rich-text 产出，但 Vue 在 `nodes` 切换时可能先设
   prop 后清文本。`buildText` 以 `richSpans` 优先、忽略 `node.text`，web 的 `FjsText` 同样
   只渲染 spans——两端顺序无关。
5. **真机数字的可比性**：debug 构建 Dart 侧偏慢，但 JS 侧不受影响（`docs/performance.md`
   「真机复核」）；GC 让单次耗时抖动 5 倍，所以挂载耗时要**重复 5 次取最小值**，面板读最坏值
   也要前后在同样的操作序列下读（进页 → 滚到底 → 点「重新挂载」3 次）。
6. **节点预算卡得过紧**：列表 ≤ 40 按估算是 38。实现后若因合理的结构差一两个，调预算要在
   tasks 里写明原因，不能悄悄放宽。

## 5. 验证路径

```bash
# 0. 基线（main 现状 + 示例页新加的「长文」段）
pnpm --filter hello-fjs exec fjs run ios --device eee48bc13d09c44b90fb7d0a7642fbc0ba994861
#    工具连接发 {"fjs":"tool"} / {"fjs":"perf"}，记录日志里的挂载耗时（5 次取 min）
#    用户读面板 nodes 与 ui 最坏值

# 1. 实现后
pnpm test                                   # node-budget / spans / layout / component / vue_styles
pnpm run typecheck
pnpm --filter hello-fjs run typecheck
cd packages/flutter_fjs && flutter test     # rich_text_test.dart；"No tests ran" 视为失败
pnpm --filter hello-fjs run build:pages
pnpm --filter hello-fjs run build:web

# 2. 外观不变：web（Browser pane，launch.json 的 hello-fjs-web）与 iOS 模拟器，
#    富文本页逐段截图，与改动前的截图对照

# 3. 真机复测：同 0 的步骤与操作序列，两项数字都要低于基线
```
