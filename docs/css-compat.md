# Web CSS 兼容清单

> 第二层第 3 篇。这是**支持范围的单一事实来源**：加了新样式能力，先改这张表。
>
> fjs 在 Flutter 上没有浏览器排版引擎，CSS 由自己的引擎解析
> （[`css/parser.ts`](../packages/fjs-runtime/src/css/parser.ts) +
> [`css/style.ts`](../packages/fjs-runtime/src/css/style.ts)），
> 再翻译成 Flutter 的 Widget 参数
> （[`render/style.dart`](../packages/flutter_fjs/lib/src/render/style.dart)）。
> **Web 侧是真 CSS**，所以这张表的本质是"Flutter 侧能到哪"。

图例：✅ 两端一致　⚠️ 支持但有差异　❌ 不支持（引擎会 `warnOnce` 跳过，不会静默）

## 1. 选择器

| 选择器 | 支持 | 说明 |
|---|---|---|
| `.class` | ✅ | |
| `tag`（`view` / `text` / `div`…）| ✅ | scoped 块里只匹配本组件元素 |
| `*` | ✅ | |
| 后代组合器（空格）| ✅ | |
| 子代组合器 `>` | ✅ | |
| 复合选择器 `.a.b` | ✅ | 优先级按 specificity 算 |
| `:deep(...)` / `::v-deep(...)` | ✅ | 穿透子组件边界 |
| `:global(...)` | ✅ | |
| `:active` | ⚠️ | **只能写在最后一个复合选择器上**；见下方「按压态」 |
| `#id` | ❌ | |
| 属性选择器 `[x=y]` | ❌ | |
| `:hover` | ❌ | 桌面端在 roadmap |
| `:first-child` / `:last-child` | ❌ | roadmap |
| 兄弟组合器 `+` / `~` | ❌ | |
| 伪元素 `::before` / `::after` | ❌ | |
| `@media` / `@supports` / 其他 at-rule | ❌ | roadmap（映射 Flutter 断点）|

**层叠规则**：优先级 = specificity + 源顺序，scoped 规则额外 +10
（对齐浏览器里 `[data-v]` 属性选择器的权重）。最终合并顺序：
`标签默认样式 < CSS 规则 < 内联 :style`。

**继承**：`color` / `fontSize` / `fontWeight` / `fontStyle` / `fontFamily` /
`lineHeight` / `letterSpacing` / `textAlign` / `textTransform` / `whiteSpace`
以及 CSS 自定义属性（`--x`）沿元素树向下继承，子元素自身声明优先。

## 2. 属性

CSS 文本里用 kebab-case（`font-size: 16px`），内联对象用 camelCase
（`fontSize: 16`）。数字不带单位 = 逻辑像素。

### 盒模型

| 属性 | 支持 | 说明 |
|---|---|---|
| `width` / `height` | ✅ | |
| `min-width` / `min-height` / `max-width` / `max-height` | ✅ | |
| `margin` / `padding`（含单边）| ✅ | `16` \| `'8 16'` \| `'T H B'` \| `'T R B L'` \| `'8px'`；单边覆盖简写 |
| `background-color` | ✅ | |
| `color` | ✅ | 继承 |
| `opacity` | ✅ | |
| `overflow: hidden` | ✅ | 容器上是裁剪 |
| `overflow: ellipsis` | ⚠️ | fjs 扩展，text 节点上是截断省略 |
| **百分比尺寸** | ❌ | roadmap |
| `box-sizing` | ⚠️ | 恒为 `border-box`（web 侧基础样式表钉死），不可改 |

### 边框与圆角

| 属性 | 支持 | 说明 |
|---|---|---|
| `border`（简写）| ✅ | `1px dashed #ccc` |
| `border-width` / `border-color` / `border-style` | ✅ | 覆盖简写的对应分量 |
| `border-style` 值 | ⚠️ | `solid` / `dashed` / `dotted` 真画；`double` / `groove` 等按 solid |
| `border-radius` | ✅ | `12` \| `'8px'` \| `'8px 16px'` \| `'1px 2px 3px 4px'` |
| 单边边框（`border-top` 等）| ❌ | 用 `divider` 标签或背景色代替 |

`border-color` 单独出现时按 CSS 语义算 1px 边框；`none` 和 0 宽度就是没边框
（`button` 自带的那道 hairline 也是这么关的）。

### Flex 布局

| 属性 | 支持 | 说明 |
|---|---|---|
| `flex-direction` | ✅ | `row` / `column`（默认 column，**和 CSS 的 row 不同**）|
| `flex-wrap` | ⚠️ | 映射 `Wrap`，此时 `flex-grow` 失效 |
| `justify-content` | ✅ | start / end / center / space-between / space-around / space-evenly |
| `align-items` | ⚠️ | `row` 时默认值 Flutter 是 `center`、CSS 是 `stretch` —— **在乎就显式写** |
| `flex-grow` / `flex` | ⚠️ | Flutter 上是 `Expanded`（只拿剩余空间）；web 侧被改写成 `flex: n 1 0%` 对齐 |
| `flex-shrink` | ⚠️ | 内置标签一律 `flex-shrink: 0`（对齐 Flutter 子节点不压缩）|
| `gap` / `row-gap` / `column-gap` | ✅ | |
| `align-self` / `justify-self` | ❌ | |
| `display: none` | ✅ | |
| `display: grid` / `inline-*` | ❌ | |

### 定位

| 属性 | 支持 | 说明 |
|---|---|---|
| `position: relative` | ✅ | 成为定位上下文；配 top/left 只挪画面不动布局 |
| `position: absolute` | ✅ | 脱流，按最近定位祖先摆 |
| `position: fixed` / `sticky` | ❌ | |
| `top` / `right` / `bottom` / `left` | ✅ | |
| `z-index` | ❌ | 顺序即层级 |

### 文字

| 属性 | 支持 | 说明 |
|---|---|---|
| `font-size` | ✅ | 继承 |
| `font-weight` | ✅ | 100–900 \| normal \| bold |
| `font-style` | ✅ | |
| `font-family` | ✅ | |
| `line-height` | ⚠️ | 数字 = 倍数，`24px` = 绝对值。**默认 1.4**（两端钉死同一个值，CSS 的 `normal` 和 Flutter 字体度量对不上）|
| `letter-spacing` | ✅ | |
| `text-align` | ✅ | |
| `text-decoration` | ✅ | underline / line-through / overline |
| `text-transform` | ✅ | uppercase / lowercase / capitalize |
| `white-space: nowrap` | ✅ | 单行 |
| `text-shadow` | ✅ | |
| `max-lines` | ⚠️ | fjs 扩展，配 `overflow: ellipsis` |
| `word-break` / `text-overflow` | ❌ | 用 `max-lines` + `overflow: ellipsis` |

未声明颜色的 `text` 取基础样式表 `body` 的 `14px / #333333`。

### 视觉效果

| 属性 | 支持 | 说明 |
|---|---|---|
| `box-shadow` | ✅ | 字符串或数组 |
| `background` / `background-image` | ⚠️ | 仅 `linear-gradient` / `radial-gradient`；不支持位图 url（用 `<image>` 标签）|
| `transform` | ✅ | translate / translateX / translateY / translate3d / scale / scaleX / scaleY / rotate(deg\|rad\|turn\|grad) / matrix(a,b,c,d,e,f)，从左到右复合 |
| `transition` / `animation` | ❌ | roadmap。页面转场用 `<Transition>`，见 [routing.md](routing.md) |
| `filter` / `backdrop-filter` | ❌ | |

**拖动一定用 `transform: translate(...)`**，不要用 `left/top` 或 `margin`：
前者只重绘不重排，命中测试跟着一起动。

### 颜色取值

✅ `#RGB` / `#RGBA` / `#RRGGBB` / `#RRGGBBAA` / `rgb()` / `rgba()` /
`hsl()` / `hsla()` / 命名色 / `transparent`

同一个解析器也服务 `<canvas>` 的 `fillStyle` / `strokeStyle`
（[canvas-compat.md](canvas-compat.md)）——那边解析失败会画成黑色，所以
加解析能力时两处一起看。

### CSS 变量

| | 支持 | 说明 |
|---|---|---|
| `--x` 自定义属性 | ✅ | 沿树继承 |
| `var(--x)` | ✅ | |
| `var(--x, fallback)` | ✅ | |
| 链式引用 | ✅ | |
| 循环引用 | ✅ | 安全降级，不死循环 |
| Vue `v-bind(expr)` | ✅ | 机制同 web 版 Vue：改写成 `var(--<id>-<expr>)` + `useCssVars` |

### 单位

✅ `px`、无单位（= 逻辑像素）
✅ `%`、`calc()` —— 只在 **尺寸** 上：`width` / `height` /
`min-width` / `min-height` / `max-width` / `max-height`
❌ `em`、`rem`（构建时就换算成 px 了）、`vw`、`vh`；
❌ 其他属性上的 `%`（`padding` / `margin` / `gap` / `border-radius` /
`top` 等按 CSS 也是百分比，这里读不出来，等同没写）

百分比的参照是**父盒子在这个轴上给出的空间**——和 CSS 一样是父元素的内容盒。
一条 CSS 规则同样适用：**参照无界时百分比退化成 auto**。列表里、
`scroll-view` 里纵向是无界的，所以 `height: 50%` 在那里不生效（web 上同理），
要撑高就给 `flex-grow` 或写死 px。

高度确定的普通列里 `height: 100%` 是**生效**的，尽管 Flutter 的 `Flex` 按设计
给子节点无界主轴：声明了主轴百分比的那个子节点，由父 flex 把自己的内容盒作为
上界传下去（[`render/flex.dart`](../packages/flutter_fjs/lib/src/render/flex.dart)
的 `_flexChild`），没写百分比的子节点照旧拿无界约束。绝对定位的子节点同理——
`RenderStack` 只在给了对边或显式尺寸时才给有界约束，所以 `position: absolute` +
`width/height: 100%` 的百分比在 `positionedChild` 里就地解析，参照是这个定位盒
被给到的空间（它有确定尺寸时就等于它自己，也就是遮罩类用法的那个盒子）。

`calc()` 支持 `+ - * /` 和括号，混算 px 与 %（`calc(100% - 32px)`）；
`*` / `/` 的另一侧必须是纯数字，这是 CSS 自己的规矩。
表达式在解析时就归约成「一个 px 项 + 一个 % 项」，每帧只剩一次乘加。

内部实现见
[`render/length.dart`](../packages/flutter_fjs/lib/src/render/length.dart)。
注意这几个组件的尺寸仍然只认绝对值：`<image>` 的 `widthFix` / `heightFix`、
`<swiper>` 的高度、`<picker-view>` 的高度——它们在布局前就要一个数。

## 3. fjs 独有的样式键

这两个键浏览器不认识，构建时由
[`web/css-compat.ts`](../packages/fjs-runtime/src/web/css-compat.ts) 改写成
等价 CSS（纯字符串处理，esbuild 和 Vite 插件走同一份）：

| fjs 键 | Flutter 语义 | 改写成的 CSS |
|---|---|---|
| `flex-grow: n` | `Expanded(flex: n)` | `flex: n 1 0%` |
| `direction: horizontal` | scrollable 的轴 | `overflow-x: auto; overflow-y: hidden` |
| `direction: vertical` | 同上 | `overflow-x: hidden; overflow-y: auto` |

真正的 `direction: ltr | rtl` 原样放行。

另外 `touch-action`（`auto` / `none` / `pan-x` / `pan-y` / `manipulation`）
两端同名同义：web 上是原生 CSS，Flutter 上让节点进手势竞技场，
手指移动约 8px（鼠标 1px）就抢下指针，早于滚动容器的 18px 阈值。

## 4. 按压态 `:active`

| | Flutter | Web |
|---|---|---|
| 实现 | CSS 引擎额外算一份按压样式，随 `activeStyle` 下发；节点自己就地切换，**不回 JS** | 浏览器原生 `:active` |
| 触发 | pointer down 当帧（不走手势竞技场：`onTapDown` 要等赢下竞技场，列表里是 100ms 之后）| 原生 |
| 取消 | 抬手，或指针移动超过拖拽阈值 | 原生 |
| 继承 | ⚠️ **不向子节点传递** | 会传递 |
| 位置 | ⚠️ 只能写在最后一个复合选择器上 | 任意 |

所以按压反馈优先用**自身属性**：`background-color` / `opacity` / 边框。
`.row:active .title { ... }` 会被跳过并告警。

## 5. 其他已知的两端差异

不属于属性支持范围，但会让两端表现不同，都在
[web.md](web.md#已知差异) 有完整说明：

- **根节点占满屏幕**：web 侧 `#app > *` 拿 `flex-grow: 1`，对齐 Flutter 路由给
  页面根 widget 的整屏紧约束
- **滚动条不占布局**：`scroll-view` / `list-view` 只沿自身方向滚动并隐藏滚动条
- **页面缓存**：web 默认 `<KeepAlive>`，只缓存还在栈上的页
- **下拉刷新**：web 只做了触摸端简化版，桌面浏览器拉不出来
- **swiper 翻页**：不用 CSS scroll-snap，组件自己驱动，一次手势翻一页
- **触摸事件**：web 由 pointer 事件合成（鼠标也能跑），一次 move 一根手指；
  Flutter 会把一帧内多指移动合成一条
- **`<label>` / `<form>` 不再是 HTML 兼容标签**：它们现在是 fjs 自己的标签
  （label 转发点击、form 收集子控件），不再分别映射成 `text` 和 `view`。
  `<label>` 原来自带的 `font-size: 14 / color: #666666 / margin: 4` 保留成了新
  标签的默认样式，所以只写文字的老页面外观不变；但它现在是容器，`<label>` 里
  混排元素的行为和以前的 text 节点不同
- **`<button>` 的默认描边不再由 JS 下发**：改成宿主的默认值
  （`widgets/button.dart` 的 `fjsButtonDefaultBorder` / web 的
  `.fjs-button--default`），这样 `type="primary"` 这类填充按钮才可能没有描边。
  页面写的 `border` / `border-color` / `border: none` 优先级不变。副作用：**新
  runtime 配旧 flutter_fjs 宿主**时 default 按钮会没有描边

## 6. 加一条新的 CSS 支持要改哪些地方

按顺序，每一步都不能省（宪法 I + VII）：

1. **解析**：`fjs-runtime/src/css/parser.ts`（选择器）或
   `css/style.ts`（属性归一化 / 继承规则）
2. **Flutter 渲染**：`flutter_fjs/lib/src/render/style.dart`
   （+ 需要时 `style_parse.dart` / `decoration.dart` / `flex.dart`）
3. **Web 侧**：多数属性是真 CSS 不用改；需要改写的加到
   `fjs-runtime/src/web/css-compat.ts`，需要基础样式配合的改
   `web/base-css.ts`
4. **内联样式归一化**：`web/style.ts`（数字补 `px` 的白名单）
5. **文档**：改**本文件的表格**，必要时补 `docs/ui-api.md` 的样式清单
6. **roadmap**：`docs/roadmap.md` 对应条目打勾
7. **验证**：在 `demo` 或 `examples/hello-fjs` 加一页，
   `fjs dev --web` 和 `fjs run android` 两边对拍

不支持的属性**必须 `warnOnce` 跳过**，不能静默丢弃（宪法 V）。
