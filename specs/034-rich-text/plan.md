# Plan: rich-text 组件

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | **组件一份**：`fjs-runtime/src/components/rich-text.ts`，Flutter 在 `app/flutter.ts` 注册、web 在 `web/components/index.ts` 的 `fjsComponents` 注册，内部标签用 `resolveDynamicComponent` 取（`picker.ts` 同款），所以同一个文件在 Flutter 上渲染元素、在 web 上渲染适配层组件。解析 / 净化 / 默认样式 / 空白处理在 `fjs-runtime/src/rich-text/`，两端同一份。**宿主改动两端各一处**：嵌套 `text` 的行内排版——Flutter `flutter_fjs/lib/src/widgets/text.dart`（+ `mirror_tree.dart` 失效传播、`render/style.dart` 两个 getter），web `fjs-runtime/src/web/base-css.ts`。页面源码一行不改跑两端 |
| II 边界即契约 | 否 | 三张表都不动：没有新 op（样式与文本走现有 `setProps` / `setText`）、没有新 native、没有新事件号。唯一的「契约」是 `component-tags.json` 加一行（bundler / Volar / 别名表三处共读，`tags.ts` 注释已写明） |
| III 同步单线程零序列化 | 否 | 解析在 JS 里同步完成，产物是普通元素树，走现有 UI 帧；没有桥调用 |
| IV 外观照 WeUI | 部分 | WeUI 没有富文本组件，默认样式照**浏览器 UA 样式表**（小程序 rich-text 本身就是这个外观）。基础字号 / 颜色 / 行高沿用 `text` 已与 WeUI 对齐的 `14px / #333333 / 1.4`，两端同一张表 `rich-text/defaults.ts` |
| V 静默失效是 bug | 是 | `warnOnce` 的地方：非白名单标签（每个标签名一次）、非法节点结构、未知 `space`、`user-select: true`、`mode` 非 `default`、表格的 `colspan` / `rowspan`、`attrs.style` 里 CSS 引擎不认的属性（现有通道）。嵌套 `text` 片段上的盒模型属性（margin / padding / border / 宽高）在两端都**被强制无效**：Flutter 侧在 `text.dart` 里 debug `warnOnce`，web 侧 base-css 用 `!important` 归零（否则 web 生效、App 不生效，是一处静默分叉） |
| VI 注释记录权衡 | 是 | 要写下的：`rich-text/parse.ts` 顶部——为什么自写解析器不用 `DOMParser`；`components/rich-text.ts`——为什么是组件、scopeId 为什么手动挂到 vnode 上（§3.6）；`rich-text/layout.ts`——margin 折叠为什么只在默认值之间做；`text.dart`——为什么 `TextSpan` 从子 `MirrorNode` 直接取样式而不是用子 widget、行内 `image` 为什么是 `WidgetSpan` + `PlaceholderAlignment.baseline`；`mirror_tree.dart`——失效为什么沿 `text` 祖先链上传；`base-css.ts`——`text text` 那几条为什么要 `!important` |
| VII JS 能包就不要下 Dart | 是 | `rich-text` 本身包成 JS 组件，`tags.json` 不加。**下到 Dart 的只有「多个样式不同的片段在一个段落里连续排版、同一行里混排图片」**：这是 Flutter 的文本布局能力（`Text.rich` / `TextSpan` / `WidgetSpan`），JS 侧只能给出元素树，拼不出行内流——属于宪法 VII「需要 Flutter 的渲染/布局能力」。解析、白名单、默认样式、列表编号、表格退化、空白与实体、margin 折叠、scopeId 全部留在 JS |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`：标签表加 `rich-text` 行 + 小节（props / 白名单 / 默认样式 / 与小程序的差异），`text` 行写明嵌套片段语义，「已知限制」删掉「文本嵌套富文本」那条。`docs/css-compat.md`：文字表加 `vertical-align`（仅 `sub` / `super`，仅片段）与 `font-family: monospace` 的映射，新增「嵌套 text 片段」小段（哪些属性在片段上无效）。`docs/web.md`：「已知差异」加 margin 不折叠（两端一致但与浏览器不同）。`docs/roadmap.md`：登记完成 + 嵌套 `text` 行内化单列 breaking change |

破例：无。

**对 spec 的两处修订**（实现前改 spec，别让文档与实现分叉）：

1. spec §3.4 末句「`em` 按组件根的 `font-size` 算」做不到：CSS 引擎不支持 `em`
   （`docs/css-compat.md`「单位」：构建时就换算成 px），运行时下发的 `attrs.style`
   里也没有换算器。改为：**默认样式表里的 em 值按 14px 基准折成 px 写死**
   （`h1` = 28px，`p` 上下 margin = 14px…），页面给 `rich-text` 设了 `font-size`
   时标题不跟着缩放——登记为与小程序的差异。
2. spec §3.5 补一条：`text` 里除 `text` / `image` 以外的子节点按 **inline-block**
   处理（Flutter `WidgetSpan`，web `display: inline-flex`），不再是今天的「被丢掉 /
   竖着堆」。rich-text 自己不会产出这种组合，这条是给模板写法兜底，保证两端一致。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| 标签清单 | `packages/fjs-runtime/src/component-tags.json` | 加 `"rich-text"`。bundler（`packages/fjs/src/bundler/vue-plugin.ts:39`）与 Volar（`packages/fjs-runtime/volar.cjs:29`）都从这里读，**不用改那两个文件**；`rich-text` 不是 HTML 标签名，也没有 `isHTMLTag` 顺序问题 |
| JS runtime（新目录） | `packages/fjs-runtime/src/rich-text/parse.ts` | HTML 字符串 → `RichTextNode[]`：分词（标签 / 属性 / 文本 / 注释 / `<!DOCTYPE>`）、void 元素（`br img hr col`）、自闭合、未闭合自动补、`</p>` 等误闭合的容错规则（按 HTML 规范「隐式结束 p」的简化版）。不依赖 DOM |
| | `packages/fjs-runtime/src/rich-text/entities.ts` | 实体解码：数字实体（十进制 / 十六进制）+ 常用命名实体表（`nbsp lt gt amp quot apos ensp emsp thinsp copy reg trade hellip mdash ndash lsquo rsquo ldquo rdquo middot times divide yen`），未知实体原样保留 |
| | `packages/fjs-runtime/src/rich-text/sanitize.ts` | 节点数组校验与净化：名字小写化、白名单（spec §3.3）、非白名单连子树删并 `warnOnce`、属性白名单、非法结构丢弃 |
| | `packages/fjs-runtime/src/rich-text/defaults.ts` | 每个标签的「块 / 行内」与默认样式（px 写死，见修订 1）、列表标记、`q` 的引号 |
| | `packages/fjs-runtime/src/rich-text/layout.ts` | 净化后的树 → 「渲染描述」（与 Vue 无关的纯数据）：块里连续行内节点收成匿名段落、块之间只含空白的行内串丢掉、空白折叠与 `pre`、`space`、`br` → `\n`、`ol` / `ul` 编号、表格退化、兄弟块之间默认 margin 折叠。纯函数，单测直接测它 |
| | `packages/fjs-runtime/src/components/rich-text.ts` | 组件本体：`nodes` / `space` / `user-select` / `mode` props；`computed` 出渲染描述；render 用 `resolveDynamicComponent('view' / 'text' / 'image' / 'divider')` 生成 vnode；给每个 vnode 挂调用方的 scopeId（§3.6）；根节点透传 `attrs`（class / style / `@tap` / `@longpress`） |
| | `packages/fjs-runtime/src/app/flutter.ts` | `app.component('rich-text', FjsRichText)`，挨着 `picker` |
| | `packages/fjs-runtime/src/vue-global.d.ts` | 新增 `RichTextNode` 与 `FjsRichTextProps`，注册 `rich-text` / `RichText` 两个名字（照 `textarea` 在第 124 / 362 / 422 / 482 行那四处） |
| | `packages/fjs-runtime/src/index.ts` | 导出 `RichTextNode` 类型，页面拼节点数组时有类型可用 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/index.ts` | `fjsComponents` 加 `'rich-text': FjsRichText`（与 Flutter 同一个组件） |
| | `packages/fjs-runtime/src/web/base-css.ts` | 在第 60 行 `text {}` 规则后加：`text text { display: inline !important; margin/padding/border: 0 !important; width/height: auto !important }`；`text > :not(text) { display: inline-flex; vertical-align: baseline }`（含 `img.fjs-image`，覆盖它的 `display: block`）；`vertical-align` 由页面样式直接生效 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/text.dart` | 抽出 `fjsTextStyle(FjsStyle)`；`buildText` 保留单段快速路径（`node.text` 或唯一的纯文本子节点 → `Text`），否则走 `Text.rich`：递归子 `MirrorNode`，`text` → `TextSpan(text / children, style: 该节点自己的 FjsStyle)`，其余 → `WidgetSpan(child: context.buildNode(...))`；`vertical-align: sub/super` 的片段 → `WidgetSpan` 包一个上下平移的 `Text`；段落级属性（`textAlign` / `maxLines` / `overflow` / `whiteSpace`）只取根；片段上的盒模型属性 debug `warnOnce` |
| | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | `_TextNodeAdapter.build` 把 `context.childNodes` 与 `context.buildNode` 交给 `buildText`（第 66 行，签名变了） |
| | `packages/flutter_fjs/lib/src/widgets/label.dart` | 第 82 行调用 `buildText(widget.node, widget.style, const [])` 跟着改签名 |
| | `packages/flutter_fjs/lib/src/mirror_tree.dart` | 新增 `_markParent`：父节点是 `text` 时继续往上标脏，直到遇到非 `text` 祖先——深层片段更新时段落根得重建，否则 App 上改了文字不刷新。**实现中发现**：`insert` / `remove` / `removeChild` 三个 op 不经过 `_touch`，是直接 `_dirty.add(parent)`，所以上溯要放进一个公共函数，四处都改用它，不能只改 `_touch` |
| | `packages/flutter_fjs/lib/src/render/style.dart` | 加 `verticalAlign` getter（第 160 行附近）；`fontFamily` getter 把通用族名 `monospace` 映射成平台等宽字体（iOS / macOS `Menlo`、Windows `Courier New`、其余（Android / Linux 由系统字体配置解析）`monospace`） |
| 测试 | `packages/fjs-runtime/test/rich-text-parse.test.ts` | 解析 / 实体 / 净化（spec §6.2 的清单） |
| | `packages/fjs-runtime/test/rich-text-layout.test.ts` | 块 / 行内分组、空白、`space`、`pre`、列表编号、表格退化、margin 折叠 |
| | `packages/fjs-runtime/test/rich-text-component.test.ts` | happy-dom 挂 `fjsComponents` 版本：DOM 结构、scoped class 命中（`data-v-xxx` 属性在内部节点上）、`nodes` 切换后整段更新、根上 `@tap` |
| | `packages/fjs-runtime/test/vue_styles.test.ts` | 追加：Flutter 渲染路径下 rich-text 内部元素拿到调用方 scope（`styleEngine.addScope`） |
| | `packages/flutter_fjs/test/rich_text_test.dart` | 嵌套 `text` → 一个 `RichText`、三个 `TextSpan` 样式各自正确；行内 `image` 是 `WidgetSpan`；单段快速路径仍是 `Text`；深层片段 `setText` 后段落刷新（经 `mirror_tree` 帧） |
| 示例 | `examples/hello-fjs/src/pages/comp/rich-text.vue` | `<route>{"title": "富文本", "tag": "rich-text", "group": "基础内容"}`；分组：HTML 字符串、节点数组、`space` 三档、列表与表格、行内图片、scoped class、非白名单告警、切换内容、`@tap` 计数、模板里的嵌套 `text` |
| | `examples/hello-fjs/README.md` | 组件列表登记 |
| 文档 | `docs/ui-api.md` / `docs/css-compat.md` / `docs/web.md` / `docs/roadmap.md` | 见宪法自查 VIII |
| C++ 引擎 | — | 不涉及，不需要重编 native |

## 3. 方案

### 3.1 管线：解析 → 净化 → 布局描述 → vnode

```
nodes (string | array)
  └─ parse.ts        string 才走；产物就是小程序的节点数组形状
  └─ sanitize.ts     名字小写、白名单、属性白名单、实体解码
  └─ layout.ts       → RenderBlock[]（纯数据：kind / style / class / children）
  └─ rich-text.ts    RenderBlock → h(view | text | image | divider)
```

`layout.ts` 的产物与 Vue 无关、与平台无关，是本 spec 的**对拍点**：两端的差别只剩
「同一棵元素树在两个宿主上怎么排版」，而那一层已经有 `text` / `view` 的既有契约。
`nodes` 是 `computed` 的输入，变化时整段重算；不做节点级 diff（spec §3.2）。

被否掉的：**web 侧直接 `innerHTML` + 浏览器 `DOMParser`**。最省事，但（a）容错规则、
白名单、默认样式在两端各有一份，迟早分叉；（b）`innerHTML` 的内容逃出了 Vue 的
scoped 样式与 fjs 的 CSS 兼容层（页面 class 在 web 生效、App 不生效）；（c）净化
要靠自己再遍历一遍 DOM，等于把解析器写了两次。

被否掉的：**新增 Dart 标签 `rich-text`，把节点 JSON 整个交给 Dart 渲染**。
违反宪法 VII：白名单、默认样式、列表编号、表格都是纯编排；而且 `class` 的匹配在
JS 的 CSS 引擎里，Dart 侧拿到 JSON 也解不了页面样式，只能再把样式算好塞进 JSON
——那就是今天的元素树换了个不走 op 协议的形状。

### 3.2 块与行内：匿名段落

照 CSS 的匿名块盒：一个块节点的子节点里，**连续的行内节点**（文本、`b` / `span` /
`img` / `br`…）收成一个 `text` 段落，块节点照常是 `view`。

```
<div>满 <b>199</b> 减 30<p>第二段</p>尾巴</div>
→ view
    text  ← 匿名段落
      "满 " · text(b, bold){"199"} · " 减 30"
    view(p)
      text{"第二段"}
    text  ← 匿名段落
      "尾巴"
```

段落里的片段就是嵌套的 `text` 元素，样式挂在片段元素上；原始文本是 Vue 的文本节点
（Flutter 上也是 `text` 节点，`vue/renderer.ts:212`）。行内节点里又出现块节点
（`<b>x<p>y</p></b>`）时，按浏览器的做法把行内节点**拆开**成两段，块夹在中间。

只含空白的行内串，出现在两个块之间或块的首尾时丢掉（浏览器同样不为它生成行盒）。

### 3.3 空白、`pre`、`space`、`br`

全部在 `layout.ts` 里做成最终字符，宿主不参与：

- 默认：`[ \t\n\r\f]+` 折成一个空格；段落首尾空格去掉。web 的 `text` 是
  `white-space: pre-line`（`base-css.ts:64`），会再折一次空格但保留 `\n`——与 JS
  的结果一致；Flutter 不折叠，所以**必须**由 JS 先折好。
- `pre` 内：空格换成 U+00A0（两端都不会折叠它），`\t` 换成 4 个 U+00A0，`\n` 保留。
  这样不需要 CSS 引擎支持 `white-space: pre`。
- `space="nbsp|ensp|emsp"`：折叠之前，把每个空格换成 U+00A0 / U+2002 / U+2003。
- `br` → 片段里的 `\n`（`pre-line` 与 Flutter 都认）。

### 3.4 列表、表格、`hr`、`q`、`sub` / `sup`

- **列表**：`li` 渲染成横排 `view`：左侧标记 `text`（固定宽 `40px` 减去间距、右对齐，
  放在 `ul` / `ol` 本应给出的 `padding-left` 里），右侧 `view`（`flex-grow: 1`）装内容。
  `ul` 标记 `•`（嵌套第二层 `◦`、第三层起 `■`。**iOS 验证时修正**：原定的 `▪` U+25AA
  是 emoji 码位，模拟器上画成了方框，换成非 emoji 的 U+25A0）；`ol` 按 `start` 起算，`type` 为
  `1 a A i I`，罗马数字在 JS 里算。标记是普通文字，两端一致。
- **表格**：`table` 纵排 `view`；`thead` / `tbody` / `tfoot` 不生成节点，子行直接挂到
  `table`；`tr` 横排 `view`；`td` / `th` 有 `width` 属性 → 定宽，否则 `flex-grow: 1`
  + `flex-basis: 0`；`th` 加粗居中。`colspan` / `rowspan` 属性 `warnOnce` 后忽略；
  `col` / `colgroup` 丢弃不告警（它只影响列宽，这里没有列的概念）；`caption` 是表格
  上方居中的一段。
- **`hr`** → `divider`，上下 margin 7px。
- **`q`** → 片段首尾加 `“` `”`。
- **`sub` / `sup`**：字号 `0.83 × 14 ≈ 11.6px`，样式里写 `vertical-align: sub|super`。
  web 由浏览器处理；Flutter 在 `text.dart` 里把这种片段做成 `WidgetSpan`，内容是
  一个 `Text`，`Transform.translate` 上移 / 下移 `0.3em`。Flutter 的 `TextSpan`
  没有基线偏移，这是唯一的办法；代价是它不能在片段内部换行（上下标很短，可接受）。

### 3.5 margin 折叠

`view` 是 flex 容器，兄弟之间的上下 margin **不折叠**（两端都是），`<p>a</p><p>b</p>`
会隔出 `2em` 而不是浏览器的 `1em`。在 `layout.ts` 里对**默认样式给的** margin 做
兄弟折叠：相邻两个块，前一个的 `marginBottom` 与后一个的 `marginTop` 取大者，另一个
置 0。页面 class / `attrs.style` 给的 margin 在 JS 里看不到解算结果，不折叠——登记为
与浏览器的差异（两端一致）。首个块的 `marginTop` 与末个块的 `marginBottom` 保留。

被否掉的：**所有块只给 `marginBottom`**。第一段上方的空白与浏览器不同，标题
（上下 margin 不对称）会跑位。

### 3.6 scoped class 怎么命中

页面 `<style scoped>` 的规则带 `[data-v-xxx]`，只匹配带这个 scope 的元素。Vue 只给
「组件自己 render 出来的元素」挂**组件自己的** `__scopeId`；`rich-text` 组件没有
`<style scoped>`，它 render 出的内部节点于是一个 scope 都没有，页面的 `.title` 命不中。
（根节点例外：Vue 的 `setScopeId` 会把父组件 vnode 的 scopeId 挂到子组件的根元素上，
`@vue/runtime-core` 3.5.42 `runtime-core.cjs.js:5789`。）

做法：组件 `setup` 里取 `getCurrentInstance()!.vnode.scopeId`（调用方页面的 scope），
render 时给每个生成的 vnode 赋 `vnode.scopeId = pageScope`。`mountElement` 读的就是
这个字段：Flutter 渲染器落到 `styleEngine.addScope`（`vue/renderer.ts:303`），
web 的 runtime-dom 落成 `data-v-xxx` 属性；web 上的内部节点是适配层组件，组件
vnode 的 scopeId 又会被上面那条规则挂到它的根元素上。两端同一行代码。

被否掉的：**把 `class` 改写成全局规则 / 要求页面写 `:deep()`**。和小程序
「页面 wxss 对 rich-text 的 class 生效」不一致，迁移过来的页面要逐个改样式。

### 3.7 Flutter：嵌套 `text` → `Text.rich`

`buildText(node, style, childNodes, buildNode)`：

1. **快速路径**（覆盖今天几乎所有 `text`）：`node.text != null`，或只有一个子节点、
   它是 `text` 且自己没有子节点、样式与父相同 → 维持现在的 `Text(...)`，
   不引入 `RichText` 的额外成本。
2. 否则 `Text.rich(TextSpan(style: 根样式, children: spans))`，`spans` 递归子
   `MirrorNode` 生成：
   - `text` 且有 `node.text` → `TextSpan(text:, style: fjsTextStyle(FjsStyle.of(kid)))`
   - `text` 且有子节点 → `TextSpan(style:, children: 递归)`
   - `verticalAlign` 是 `sub` / `super` → `WidgetSpan`（§3.4）
   - 其他标签（`image`、`view`…）→ `WidgetSpan(alignment: PlaceholderAlignment.baseline,
     baseline: TextBaseline.alphabetic, child: buildNode(kid))`
   - 隐藏节点（`FjsNodeRenderer.isHidden`）跳过，与块级子节点的处理一致
3. `textAlign` / `maxLines` / `overflow` / `white-space: nowrap` 只取根。片段的
   `height`（行高倍数）照样写进各自的 `TextStyle`：CSS 里行高是继承的，
   JS 的样式引擎已经把继承值折进了每个片段自己的样式（`css/style.ts` 的
   `INHERITABLE`），这样大字号片段撑高行盒的方式与 web 接近。

**为什么直接读子 `MirrorNode` 而不是用子 widget**：`TextSpan` 不是 widget，子节点的
`_FjsNodeView` 塞不进段落；而且每个片段一个 `ListenableBuilder` 在段落里没有意义
——段落是一次排版。代价是片段的更新必须让段落根重建，这就是 `mirror_tree.dart`
那一处改动：`_touch` 在父节点是 `text` 时继续上溯（§2），深度只到段落根，
不影响块级节点的 O(1) 失效。

被否掉的：**新开一个只给 rich-text 用的内部 Dart 标签**（spec Q1 的另一个选项，用户已选全局）。

### 3.8 Web：`text text` 就是 inline

web 的 `text` 是适配层组件渲染的自定义元素 `<text>`，嵌套本来就生成嵌套的 DOM；
只差 `display`。`text text { display: inline !important }` 之后浏览器自然完成行内排版，
`vertical-align` / `background-color` 原生生效。`!important` 的理由写在 VI：
片段上的盒模型属性在 Flutter 上不可能生效，web 不能比它多。

`text > :not(text)` 给 `inline-flex`：`img.fjs-image` 的 `display: block`
（`base-css.ts:93`）会把段落截断，`view` 同理。**实现中修正**：`text > :not(text)`
的优先级只有 (0,0,2)，压不过 `.fjs-image` 的 (0,1,0)——web 预览里行内小图独占了一行。
补一个 `text > .fjs-image`（0,1,1）。没有用 `!important`，因为页面给图片写的
`display: none` 在 Flutter 上会隐藏，web 不能反过来盖掉它。

### 3.9 `monospace`

`pre` / `code` / `tt` 的默认 `fontFamily: 'monospace'`。web 原生认；Flutter
`fontFamily: 'monospace'` 在 iOS 上解析不到任何字体、静默退回系统字体（和
`docs/ui-api.md` 里 emoji 字体那条同类问题），所以在 `style.dart` 的 getter 里映射成
平台字体名。只映射 `monospace` 这一个通用族名，`serif` / `sans-serif` 不在本 spec 内。

## 4. 风险

1. **破坏性变更的波及面**：嵌套 `text` 变行内。已查 `fjs-runtime/src/components/` 与
   `web/components/` 没有 `text` 套 `text`（`picker.ts:150` 的 `text` 在 `view` /
   `button` 里）；`examples/hello-fjs` 与 `demo` 的模板要在实现时用脚本逐文件再扫
   一遍（`grep -P` 在 macOS 上不可靠），命中的逐个判断改不改 `view`。
2. **深层片段更新不刷新（只在 App 上）**：`mirror_tree` 上溯漏了哪个 op（`setText` /
   `setProps` / `setStyle` / 插入 / 删除都经 `_touch`，要逐个确认），表现就是 web 对、
   App 不动。`rich_text_test.dart` 必须覆盖「改深层片段的文字 / 颜色」两种。
3. **`WidgetSpan` 里的 `image` 尺寸**：只给 `width` 不给 `height` 时要 `widthFix`，
   它在布局前要一个绝对宽（`docs/css-compat.md`「单位」末段）。`img` 的 `width`
   属性是纯数字，JS 侧转成 px 写进样式；百分比宽告警后按原图尺寸。
4. **scopeId 手动赋值依赖 Vue 内部字段**：`vnode.scopeId` 是公开 vnode 形状的一部分，
   但「子组件根元素继承父 vnode 的 scopeId」是 `setScopeId` 的实现细节。Vue 升级时
   `rich-text-component.test.ts` 那条 scoped 用例是报警器。
5. **两端要对拍的**：同一段内容在 web 与 iOS 上段落数、列表项数、图片数、表格行列数一致；
   标题 / 段落间距目视一致；`sub` / `sup` 的偏移方向一致。换行位置允许不同（字体度量）。
6. **性能**：`nodes` 是字符串时每次变化都全量解析。小程序文档本身也说字符串形式性能
   较差；一次几 KB 的 HTML 解析在 JS 里是亚毫秒级，不做缓存。长文（上百段）的元素数
   会顶到 `scroll-view` 的 200 子节点提醒——那条提醒照常出现，不压掉。

## 5. 验证路径

```bash
pnpm install
pnpm test                                   # rich-text-parse / -layout / -component + vue_styles
pnpm run typecheck
pnpm --filter hello-fjs run typecheck
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd packages/flutter_fjs && flutter test     # rich_text_test.dart；"No tests ran" 视为失败
pnpm --filter hello-fjs run build:pages
pnpm --filter hello-fjs run build:web
# web：Browser pane 起 launch.json 的 hello-fjs-web，打开「基础内容 → 富文本」，
#      逐项对照 spec §6.4，截图；控制台只应有 <script> 那一条白名单告警
pnpm --filter hello-fjs run run:ios         # iOS 模拟器同一页，逐项对照并截图，与 web 并排比较
```
