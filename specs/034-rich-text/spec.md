# Spec: rich-text 组件

- **ID**: 034-rich-text
- **状态**: done
- **日期**: 2026-09-11

## 1. 要解决什么

小程序页面迁过来，凡是「后端下发一段 HTML / 节点数组、前端原样展示」的地方
（商品详情、公告、协议、评论里的加粗高亮）都写成 `<rich-text :nodes="html">`。
fjs 现在没有这个标签，而且**用现有标签也拼不出来**：

- **没有行内混排**。一句话里加粗一个词，需要同一段落里多种样式的文本连续排版。
  Flutter 侧 `text` 只取 `node.text` 或**第一个子节点的纯字符串**
  （`widgets/text.dart:11`），里层 `text` 的样式整个丢掉；web 侧 `text` 是
  `display: block`（`web/base-css.ts:60`），嵌套的 `text` 会一行一个地竖着堆。
  `docs/ui-api.md` 的「已知限制」里「文本嵌套富文本：子 text 回退渲染」说的就是它。
- **没有 HTML 解析**。QuickJS 里没有 `DOMParser`，runtime 里也没有任何 HTML
  解析或实体解码（`&nbsp;` / `&amp;`）。
- `vue/renderer.ts` 的 HTML 别名表（`b` / `h1` / `p` → `text`）只作用于**模板里
  写死的标签**，而且取值不是浏览器默认值（`em` / `i` 被映射成 `fontWeight: 500`
  而不是斜体），不能拿来渲染运行时下发的内容。

参考：微信小程序 `rich-text` 组件文档
`https://developers.weixin.qq.com/miniprogram/dev/component/rich-text.html`

## 2. 不做什么（Non-goals）

- **Skyline 专属的 `mode`**（`compat` / `aggressive` / `inline-block` / `web` /
  `web-static`）不做。出现时 `warnOnce` 并按 `default` 渲染。
- **不做 WebView 渲染**，不借 `@ufjs/webview`。rich-text 的内容要和页面其余部分
  同一套字体、同一次布局、跟着页面滚动，套一个平台 WebView 做不到这三样。
- **节点内部不派任何事件**，与小程序一致（「rich-text 内部所有节点事件被屏蔽」）。
  `<a>` 没有跳转，`attrs` 里的 `onclick` 之类不在白名单里本来就会被丢。
  `rich-text` **组件自身**上的 `@tap` / `@longpress` 照常工作。
- **不支持 `id`**（小程序也不支持），`attrs.id` 丢弃不告警。
- **`ruby` / `rt` 只做退化**：注音以小字接在正文后面，不做上方对齐的注音排版。
- **`img` 只做 `src` / `width` / `height` / `alt`**。`src` 的解析沿用内置 `image`
  的规则（spec 010 / 017），不另加「只允许网络图」的限制——那是小程序的平台约束，
  不是这个组件的语义；`mode`、`lazy-load`、`@load` / `@error` 不暴露。
- **不做 `editor`**。可编辑富文本是另一个引擎，roadmap 里已顺延。
- 不改 UI op 协议、不改 natives 表、不新开事件号。

## 3. 用户可见的行为

```vue
<script setup lang="ts">
const html = `
  <h2 class="title">限时活动</h2>
  <p>满 <b style="color:#FA5151">199</b> 减 30，<i>仅限今日</i>&nbsp;&gt;</p>
  <ul><li>全场通用</li><li>不与其他优惠同享</li></ul>
  <img src="https://example.com/banner.png" width="300" height="120" />
`;

const nodes = [
  {
    name: 'div',
    attrs: { class: 'box', style: 'padding: 12px' },
    children: [
      { type: 'text', text: 'Hello&nbsp;' },
      { name: 'strong', children: [{ type: 'text', text: 'rich-text' }] },
    ],
  },
];
</script>

<template>
  <rich-text :nodes="html" @tap="onTap" />
  <rich-text :nodes="nodes" space="nbsp" />
</template>

<style scoped>
/* 页面自己的样式能命中 nodes 里的 class，和小程序一致 */
.title { color: #07c160; }
</style>
```

### 3.1 标签形态

`rich-text` 是 **JS 组件**（宪法 VII），放 `fjs-runtime/src/components/rich-text.ts`，
两端共用同一个组件（形状同 `picker`）。`tags.json` 不加条目，
`component-tags.json` 加 `rich-text`。

组件做三件纯 JS 的事，两端逐字节一致：

1. **解析**：`nodes` 是字符串时，用 runtime 自带的 HTML 解析器
   （`fjs-runtime/src/rich-text/parse.ts`，不引依赖）转成节点数组。web 侧**也用
   这一个解析器**，不用浏览器的 `DOMParser`——否则容错规则（未闭合标签、
   `<p>` 里套 `<div>`）两端会不一样。
2. **净化**：标签名大小写不敏感；不在白名单（§3.3）的节点**连同子树一起删除**，
   同一个标签名 `warnOnce` 一次；属性只留 `class` / `style` 与该标签白名单里的
   那几个；文本节点做 HTML 实体解码。
3. **渲染**：块级节点 → `view`，连续的行内节点 → **一个** `text` 根，里面每一段
   是嵌套的 `text` 片段；`img` → `image`；`hr` → `divider`；`br` → 片段里的 `\n`。
   各标签的默认样式见 §3.4。

真正需要宿主做的只有一件：**嵌套 `text` 按行内片段排版**（§3.5），这是文本布局能力，
JS 包不出来。

### 3.2 props

| prop | 类型 | 默认 | 行为 |
|---|---|---|---|
| `nodes` | `string \| RichTextNode[]` | `[]` | HTML 字符串或节点数组。结构非法的节点（缺 `name`、`type: 'text'` 缺 `text`）丢弃并 `warnOnce`，不抛异常 |
| `space` | `'ensp' \| 'emsp' \| 'nbsp'` | 不设 | 不设时连续空白按 HTML 折叠成一个空格（`pre` 内除外）；设了之后每个空格都保留，分别换成 U+2002 / U+2003 / U+00A0。未知值 `warnOnce` 后按不设处理 |
| `user-select` | boolean | `false` | 不支持：写 `true` 时 `warnOnce`，文本不可选 |
| `mode` | string | `default` | 不支持，见 Non-goals |

节点数组的形状照小程序：

```ts
type RichTextNode =
  | { type?: 'node'; name: string; attrs?: Record<string, string>; children?: RichTextNode[] }
  | { type: 'text'; text: string };
```

`nodes` 变化时整棵重建，不做节点级 diff——下发内容本来就是整段替换。

### 3.3 白名单

照小程序文档原样（`class` / `style` 全局可用）：

- 无专属属性：`a abbr address article aside b bdi bdo big blockquote br caption
  center cite code dd del dir div dl dt em fieldset font footer h1–h6 header hr i
  ins label legend li mark nav p pre q rt ruby s section small span strong sub sup
  tbody tfoot thead tr tt u ul`
- `img`：`alt src height width`
- `ol`：`start type`
- `table`：`width`；`col` / `colgroup`：`span width`；`td` / `th`：`colspan height rowspan width`

`script` / `style` / `iframe` 等不在表里的，整棵删掉。

### 3.4 默认样式

取**浏览器 UA 样式表**的值（小程序 rich-text 本来就是按 WebView 的默认样式渲染的），
写成一张表放 `rich-text/defaults.ts`，两端共用，不走 `vue/renderer.ts` 那张
HTML 别名表（后者给模板写死的标签用，取值历史原因不同，本 spec 不动它）。

| 标签 | 形态 | 默认样式 |
|---|---|---|
| `div p section article header footer nav aside address center blockquote dl dd dt fieldset legend caption` | 块 | `p` / `blockquote` / `dl`：上下 margin `1em`；`blockquote` / `dd`：左 margin `40px`；`center`：居中 |
| `h1`–`h6` | 块 | 加粗；字号 `2em / 1.5em / 1.17em / 1em / 0.83em / 0.67em`；上下 margin `0.67em / 0.83em / 1em / 1.33em / 1.67em / 2.33em` |
| `ul` / `ol` / `li` | 块 | 左 padding `40px`，上下 margin `1em`；`ul` 标记 `•`，`ol` 标记 `1.`（认 `start` 与 `type`：`1 a A i I`） |
| `pre` | 块 | 等宽字体、保留空白与换行、上下 margin `1em` |
| `b strong` | 行内 | 加粗 |
| `i em cite` | 行内 | 斜体 |
| `u ins` | 行内 | 下划线 |
| `s del` | 行内 | 删除线 |
| `code tt` | 行内 | 等宽字体 |
| `small` / `big` | 行内 | 字号 `0.83em` / `1.2em` |
| `sub` / `sup` | 行内 | 字号 `0.83em`，基线下移 / 上移（§4 已知差异） |
| `mark` | 行内 | 背景 `#FFFF00` |
| `q` | 行内 | 两侧加 `“ ”` |
| `a span abbr bdi bdo font label` | 行内 | 无（`a` 不着色——没有 `href` 的 `<a>` 在浏览器里就是普通文字） |
| `img` | 行内 | 渲染成 `image`，与文字同一行排；`width` / `height` 属性给尺寸，只给一边按图片比例（`mode: widthFix` / `heightFix`），都不给按图片原始尺寸且不超过容器宽 |
| `table` 族 | 块 | 退化成 flex 网格：`table` 纵排、`tr` 横排、`td` / `th` 按 `width` 属性定宽否则等分，`th` 加粗居中，单元格 padding `1px`；`thead` / `tbody` / `tfoot` 透明；`colspan` / `rowspan` / `col` / `colgroup` / `caption` 以外的表格布局语义 `warnOnce` 后忽略（`caption` 渲染成表格上方居中的一行） |
| `hr` | 块 | `divider`，上下 margin `0.5em` |

表里的 `em` 值**按 14px 基准折成 px 写死**（`h1` = 28px，`p` 上下 margin = 14px…），
与 `text` 的默认字号一致。CSS 引擎不支持 `em`（`docs/css-compat.md`「单位」），
所以页面给 `rich-text` 设了 `font-size` 时标题不会跟着缩放——与小程序的差异，
写进 `docs/ui-api.md`。（`/plan` 阶段修订，原文是「按组件根的 `font-size` 算」。）

`attrs.style` 以内联样式写到对应节点上，压过默认样式；`attrs.class` 走页面 CSS 引擎，
**调用方页面的 `<style scoped>` 与全局样式都能命中**（小程序「只有该组件的 wxss 对
rich-text 中的 class 生效」的同一个意思）。支持的样式属性范围就是
`docs/css-compat.md` 那张表，超出的照旧 `warnOnce`。

### 3.5 嵌套 `text` 的行内排版（全局生效）

**任何** `text` 里嵌 `text` 都按行内片段排版，不止 rich-text 内部——模板里也能写：

```vue
<text>满 <text class="red">199</text> 减 30</text>
```

- 外层 `text` 是一个段落（块），里层 `text` 是片段（行内），片段可以继续嵌套；
  每个片段用自己解算后的样式（颜色 / 字号 / 字重 / 斜体 / 装饰线 / 背景色 /
  字间距），段落级的属性（`text-align` / `line-height` / `max-lines` /
  `white-space`）只认最外层。
- 行内 `image`（§3.4 的 `img`）作为片段参与同一行排版，按基线底对齐。
- `text` 里除 `text` 以外的子节点（`image`、`view`…）一律按 **inline-block** 处理
  （Flutter `WidgetSpan`，web `display: inline-flex`），两端一致。（`/plan` 阶段补充。）
- 片段上的 margin / padding / border / 宽高**不生效**并 `warnOnce`——行内盒没有
  这些，两端也对不齐。

> ⚠️ **破坏性变更**：现有页面里 `text` 嵌 `text` 的写法，web 上会从「一段一行竖着堆」
> 变成「连成一行」，Flutter 上会从「只显示第一段」变成「全部显示」。要保持竖排的页面，
> 把外层 `text` 换成 `view`。要单列进 `docs/roadmap.md`。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 组件 | `components/rich-text.ts` 渲染 `view` / `text` / `image` / `divider` 元素 | 同一个组件，渲染 web 适配层的同名组件 |
| 解析 / 净化 / 空白 / 实体 | JS，`rich-text/parse.ts` | 同一份 JS，不用 `DOMParser` |
| 行内片段 | `text` 有 `text` 子节点时构造 `Text.rich`，每个子节点一个 `TextSpan`，样式取该节点自己解算后的样式 | `text` 里的 `text` 是 `display: inline` |
| `sub` / `sup` | `WidgetSpan` + 基线偏移 | `vertical-align: sub / super` |
| 事件载荷 | 组件根上的 `@tap` / `@longpress` 与其他元素相同；内部无事件 | 同左 |
| 已知差异 | 字体度量不同，换行位置允许不同；**段落数、列表项数、图片数必须相同** | 同左 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— 不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）—— 不涉及
- [x] `component-tags.json` 加 `rich-text`（bundler / Volar / 别名表三处判定共读，见 `tags.ts` 注释）
- [x] `vue-global.d.ts` 新增 `FjsRichTextProps` 与 `RichTextNode` 类型并导出
- [x] Flutter `widgets/text.dart` 与 web `base-css.ts` 的嵌套 `text` 语义（§3.5）

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` 通过；
   `<rich-text :nodes>` 在模板里接受 `string` 与 `RichTextNode[]`，`space` 是字面量联合。
2. `pnpm test` 通过，并新增纯 JS 测试（`rich-text/parse.test.ts` 等）覆盖：
   实体解码（`&nbsp; &lt; &amp; &#39; &#x4e2d;`）、标签名大小写不敏感、非白名单节点
   连子树删除并只告警一次、属性白名单、未闭合 / 错误嵌套的容错、空白折叠与 `pre`、
   `space` 三个值与未知值、`ol` 的 `start` / `type` 编号、非法节点数组元素被丢弃。
3. `cd packages/flutter_fjs && flutter test` 通过（`No tests ran` 视为失败），并新增
   widget 测试：`text` 带三个样式不同的 `text` 子节点时渲染成一个 `RichText`，
   三个 `TextSpan` 的粗细 / 颜色各自正确。
4. `pnpm --filter hello-fjs run dev:web` 打开「基础内容 → 富文本」示例页，逐项目视：
   标题层级、段落间距、加粗 / 斜体 / 下划线 / 删除线在**同一行内**混排、有序与无序
   列表编号、`pre` 保留空白、`img`、`space` 三档对比、页面 scoped class 命中、
   非白名单标签（`<script>`）不显示且控制台一条告警、切换 `nodes` 后整段更新。
5. iOS 模拟器上跑同一页，与第 4 条同样的对照项；截图与 web 截图并排对照，
   段落数 / 列表项数 / 图片数一致。**Android 不测**。
6. 点击 `rich-text` 组件派 `@tap`（示例页计数 +1），两端一致。
7. `docs/ui-api.md` 增 `rich-text` 行与 props / 白名单 / 默认样式说明，并更新「已知限制」
   里嵌套 `text` 那一条；`docs/css-compat.md` 或 `docs/web.md` 登记 §4 的已知差异；
   `docs/roadmap.md` 登记完成，并把「嵌套 `text` 变行内」**单列成一条 breaking change**，
   写清要保持竖排的页面怎么改。
8. `examples/hello-fjs` 现有页面里 `text` 嵌 `text` 的地方逐个检查，受破坏性变更影响的
   改成 `view`，两端外观与改动前一致。

## 7. 待澄清

- [x] 已确认：嵌套 `text` 的行内语义**全局生效**（§3.5），破坏性变更进 roadmap。
- [x] 已确认：`img` **行内**，与文字同一行排（Flutter `WidgetSpan`）。
- [x] 已确认：`table` **退化成 flex 网格**，`colspan` / `rowspan` 告警后忽略。
- [x] 已确认：`user-select` **不做**，写 `true` 时 `warnOnce`。
