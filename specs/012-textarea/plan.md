# Plan: textarea 组件

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 组件契约一份：`fjs-runtime/src/components/textarea.ts`（Flutter 路径）与 `fjs-runtime/src/web/components/form.ts` 的 `FjsInput` 扩展（web 路径）。原生能力落在共用的 `flutter_fjs/lib/src/widgets/input.dart` 与 web 的 `<textarea class="fjs-input">` 上；页面源码一行不改跑两端 |
| II 边界即契约 | 是（一张） | 事件类型表：`fjs-runtime/src/ui/element.ts` 加 `onLinechange: 28`，`flutter_fjs/native/include/fjs.h` 加 `FJS_EVENT_LINE_CHANGE = 28`，`flutter_fjs/lib/src/ffi.dart` 加 `FjsEvent.lineChange`。载荷仍是字符串，**不动 op 协议、不动 natives、不开新 C ABI** |
| III 同步单线程零序列化 | 否 | 没有新增桥调用；`@linechange` 走既有的 dispatchEvent 回派，载荷是一个短 JSON 串 |
| IV 外观照 WeUI | 是 | textarea 复用 `.fjs-input` 已有的 14px / 1.4 行高 / `#999999` 占位符（两端同一组数值，`widgets/input.dart` 与 `base-css.ts` 已经对齐）。新增的只有默认三行高度，两端同一个算法 |
| V 静默失效是 bug | 是 | 未知 `confirm-type`、`placeholder-style` 里不认的键、`focus` 与 `auto-focus` 同时写、以及 Non-goals 里那批键盘 props 出现时，全部 `warnOnce` 后按文档降级 |
| VI 注释记录权衡 | 是 | `components/textarea.ts` 顶部写「为什么是 JS 组件而不是 Dart 标签」；`widgets/input.dart` 写「autoHeight 关时为什么用 maxLines: 3 / expands 而不是 SingleChildScrollView」；`@linechange` 的量法两端各写一段互相指认 |
| VII JS 能包就不要下 Dart | 是 | 标签本身包成 JS 组件，`tags.json` 不加条目。下到 Dart 的只有四样，每样都是「JS 拿不到的信息」或「平台控件行为」：内部滚动（TextField 的 maxLines/expands）、行数（布局结果）、焦点（FocusNode）、键盘确认键（TextInputAction）。理由逐条写在 §3.2 |
| VIII 变更落到文档 | 是 | `docs/ui-api.md`（新标签 + props/事件表 + `heightRpx` 的缺席）、`docs/web.md`（auto-height 两端实现、`confirm-type` 在桌面浏览器的含义、resize 手柄的差异）、`docs/roadmap.md`（登记 + `maxlength` 默认值的 breaking change 单列） |

破例：无。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | `FLUTTER_COMPONENT_TAGS` 加 `textarea`。**这条判断必须排在 `isHTMLTag` 之前**（第 126 行附近的顺序），否则真 HTML 标签 `textarea` 会被判回元素——`form` 踩过的同一个坑 |
| 类型 / IDE | `packages/fjs-runtime/src/component-tags.json`（新）、`packages/fjs-runtime/volar.cjs` | **实现中发现的第三处**（见 §3.7）：Volar 插件的 `isNativeTag` 只认 `tags.json`，而 `textarea` 是组件不在那张表里，于是 `vue-tsc` 把它当 DOM 元素、按 `TextareaHTMLAttributes` 报错。组件标签单独一份 JSON，vue-plugin 与 volar 共读 |
| JS runtime | `packages/fjs-runtime/src/components/textarea.ts`（新） | 组件本体：渲染 `<input multiline …>`，补 textarea 的默认值（`maxlength: 140`、`auto-height: false`、`confirm-type: 'return'`），把 `@linechange` 透传给页面 |
| | `packages/fjs-runtime/src/app/flutter.ts` | `app.component('textarea', FjsTextarea)`，挨着现有的 list-view / form / picker |
| | `packages/fjs-runtime/src/ui/element.ts` | `EventType` 加 `onLinechange: 28`（全小写是模板给出的规范拼写，驼峰 `onLineChange` 作别名——009 踩过的坑） |
| | `packages/fjs-runtime/src/vue-global.d.ts` | 新增 `FjsTextareaProps` 并注册 `textarea` 的 kebab / Pascal 名；`FjsInputProps` 同步加上共用的四个新 props |
| | `packages/fjs-runtime/src/vue/renderer.ts` | 删掉 HTML 别名表里的 `textarea: { tag: 'input', props: { multiline: true } }`（第 169 行）——它会抢在组件之前把标签重写掉 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/form.ts` | `FjsInput` 扩展：`autoHeight`、`focus` / `autoFocus`、`confirmType`、`placeholderStyle`、`@linechange`；多行时 Enter 不再无条件跳过 |
| | `packages/fjs-runtime/src/web/components/index.ts` | `fjsComponents` 注册 `textarea` |
| | `packages/fjs-runtime/src/web/base-css.ts` | 第 199 行 `textarea.fjs-input { resize: vertical; min-height: 72px }` 要改：`resize` 手柄 Flutter 侧没有（静默的两端差异），`min-height: 72px` 是个凭空的数字，换成 `rows` 撑出来的三行 |
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | 枚举补 `FJS_EVENT_LINE_CHANGE = 28`。C++ 不解释事件号，**不需要重编 native** |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.lineChange = 28`，注释写清固定 JSON 载荷 |
| | `packages/flutter_fjs/lib/src/widgets/input.dart` | 四件事：`autoHeight` 决定 `maxLines` / `expands`；`focus` / `autoFocus` 的受控焦点；`confirmType` → `TextInputAction` 与 `@confirm` 的派发条件；`placeholderStyle` 解析进 `hintStyle`。外加每次内容/宽度变化后量行数派 `@linechange` |
| | `packages/flutter_fjs/lib/src/render/style.dart` | 只读：`placeholder-style` 复用现成的颜色/字号/字重/行高解析，不新写解析器 |
| 示例 | `examples/hello-fjs/src/pages/comp/textarea.vue`（新） | 可操作回归页：auto-height 开关、字数上限、`@linechange` 实时行数、`confirm-type` 切换 |
| 文档 | `docs/ui-api.md` / `docs/web.md` / `docs/roadmap.md` | 见宪法自查 VIII |

## 3. 方案

### 3.1 标签：JS 组件，不是 Dart 标签

`textarea` 是 `components/textarea.ts` 里的一个 Vue 组件，渲染成
`h('input', { multiline: true, maxlength: 140, ...props })`。它自己不持有任何状态，
只做三件事：给 textarea 的默认值、把 kebab props 归一化、把事件原样转出去。

这样做的直接好处和 `form` 一样：改默认值不用重编 Flutter；`input` 和 `textarea`
共用同一个 TextField，不可能出现「两个标签的多行行为悄悄分叉」。

代价要写明白：这些新 props 落在**共用的原生 widget** 上，所以
`<input multiline auto-height>` 也会生效。文档把 `textarea` 写成它们的规范入口，
但不假装 `input` 不认——那是骗人。

### 3.2 下到 Dart 的四样，逐条说明为什么

| 能力 | 为什么 JS 包不出来 |
|---|---|
| `auto-height` 关掉时内部滚动 | 要的是 TextField 自己的滚动视口。JS 只能设 props，改不了 widget 的 `maxLines` / `expands` |
| `@linechange` 的行数 | 行数是**布局结果**：同一段文本在不同宽度、不同字号下行数不同。JS 侧没有文本度量能力，只能由 Dart 的 TextPainter / web 的 DOM 量 |
| `focus` / `auto-focus` | 焦点是平台控件状态（`FocusNode` / `HTMLElement.focus()`），JS 侧的 element 层够不着 |
| `confirm-type` | 软键盘右下角按键由 `TextInputAction` 决定，是输入法层的东西 |

`maxlength`（截断）、默认值、props 归一化、事件转发这些纯编排的活，全部留在 JS。

### 3.3 auto-height 的两种形态怎么落

| | Flutter | Web |
|---|---|---|
| `auto-height` | `maxLines: null`（今天 `input multiline` 的行为，不用改） | `rows` 不设，`height: auto`，每次输入把 `scrollHeight` 写回 `style.height` |
| 默认（false），样式没给高 | `maxLines: 3`——TextField 到三行就停，之后**内部滚动**，正是小程序的默认形态 | `rows="3"`：浏览器按当前字号算出三行高，字号变了自动跟着变 |
| 默认（false），样式给了高 | `expands: true` + `maxLines: null` + `minLines: null`，填满 decorateNode 已经画好的盒子并内部滚动 | `height` 由页面 CSS 决定，`overflow-y: auto` |

`rows="3"` 和 `maxLines: 3` 是同一件事的两种说法，都跟着字号走——这比 spec §3.4 里
写的「行盒高 × 3 + padding」更稳（不用自己算 padding），spec 那句要在实现时改成
「三行」而不是一个具体像素数。

被否掉的：**用 `SingleChildScrollView` 包住一个 `maxLines: null` 的 TextField**。
能滚，但光标移出视口时不会自动滚过去（TextField 自己的滚动视口才做这件事），
输入到底部时看不见自己在打什么字。

### 3.4 `@linechange` 怎么量，怎么保证两端行数一致

Flutter：`build` 里已经有完整的 `TextStyle`；在 `LayoutBuilder` 拿到可用宽度后，
用同一份 style 构造 `TextPainter`，`layout(maxWidth: …)` 之后取
`computeLineMetrics().length` 当行数、`height` 当内容高。文本或宽度变了才重量。

Web：`scrollHeight / lineHeight` 推行数（`lineHeight` 从 computed style 取，
`.fjs-input` 钉死了 `line-height: 1.4`，拿得到具体像素）。

两端都只在**行数变化时**派事件，首帧的初始行数不派——和 009 的到边事件同一套
「进入才派」的状态机语义。这段判定逻辑写在 JS 侧的组件里，两端共用：Dart 和 web
都把「当前行数」发出来，组件比对上一次的值决定要不要 emit 给页面。

> 这条是本 spec 唯一需要两端逐条对拍的地方。`height` 允许不同（字体度量不同），
> `lineCount` 必须相同。

### 3.5 `confirm-type` 与 `@confirm`

`return`（默认）：Flutter `TextInputAction.newline`，web 不拦 Enter——按键就是换行，
不派 `@confirm`。其余五个：Flutter 映射到对应的 `TextInputAction`，web 设
`enterkeyhint` 并在 keydown 里 `preventDefault()` 后 emit `@confirm`。

`@confirm` 复用事件号 4（`FJS_EVENT_TEXT_SUBMITTED`）。被否掉的做法是给它开一个
新事件号：它和 `input` 的 `@submit` 是同一件事（「用户按了确认键」），载荷也一样，
分成两个号只会让 `fjs.h` 多一行没有区别的枚举。

### 3.6 HTML 别名的去留

`vue/renderer.ts:169` 那条 `textarea → input multiline` 必须删。留着的话，
Flutter 路径上标签会在到达组件之前就被重写成 `input`，组件永远不会被实例化——
和 `vue-plugin.ts` 里的顺序坑是同一个问题的两个位置。

删掉之后 `<textarea>` 的含义从「input 的别名」变成「fjs 组件」。旧页面继续能用，
但 `maxlength` 默认值从不限变成 140（spec §3.2 的 breaking change）。

### 3.7 实现中补的一处：Volar 也要知道

写示例页时 `vue-tsc` 报 `'confirm-type' does not exist in type
'TextareaHTMLAttributes'`。原因和 §3.6、§2 的构建那条是同一个：**判定「这个标签是
元素还是组件」的地方有三处**，plan 只数到了两处。

| 谁 | 在哪 | 管什么 |
|---|---|---|
| Flutter 构建 | `fjs/src/bundler/vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS` | `fjs build` / `fjs dev` 出来的代码 |
| Web 构建 | `fjs/src/vite.ts` 的 `isNativeTag`（走 `webIsNativeTag`） | `dev:web` / `build:web` |
| 运行时 | `fjs-runtime/src/vue/renderer.ts` 的 HTML 别名表 | Flutter 路径上的标签重写 |
| 类型 / IDE | `fjs-runtime/volar.cjs` 的 `isNativeTag` | `vue-tsc` 和编辑器里的 props 类型 |

**是四处，不是两处。** plan 只数到了构建和运行时。类型那处是 `vue-tsc` 报错发现的；
Web 构建那处更隐蔽——typecheck 和单测全绿，`dev:web` 上页面照常渲染，但渲出来的是
一个原生 `<textarea>`，fjs 的 props 变成没人认识的 HTML 属性（`auto-height="true"`
挂在 DOM 上），事件一个都不派。是打开示例页看 `className` 少了 `fjs-input` 才发现的。
修法是把守卫下放进 `webIsNativeTag` 本身，而不是留在各个调用点。三处都只认 `tags.json`，而 JS 组件按定义就不在
`tags.json` 里——`form` 之所以没暴露这个问题，是因为它**同时**在 `tags.json` 里
（历史上它先是 Dart 标签）。

修法照 `tags.json` 的先例：新增 `src/component-tags.json`，`vue-plugin.ts`（TS）和
`volar.cjs`（CommonJS）读同一份。被否掉的是「把 `textarea` 也塞进 `tags.json`」——
那张表的含义是「Dart 和 web 都实现的内置标签」，塞进去会让 `FJS_TAGS` 说谎，
`webIsNativeTag` 等一串判断也会跟着错。

## 4. 风险

1. **「元素还是组件」的三处判定**（§3.7）。构建那处判错，页面上 `<textarea>`
   什么都不显示且**不报错**；Volar 那处判错只是类型报错，吵但不致命。宪法 VII 明文
   记过前者，实现时加了 `packages/fjs/test/vue-plugin-tags.test.ts` 盯着它。
2. **`@linechange` 两端行数不一致**。字体度量不同、web 的 `lineHeight` 取值口径不同，
   都会让同一段文本算出不同的行数。这是 spec 验收第 6 条，必须实机对拍，不能只看
   单测。风险最高的是中英混排和连续长单词（换行规则不同）。
3. **`expands: true` 的约束要求**。TextField 用 `expands` 时父级必须给有界高度，
   否则 Flutter 直接抛异常。`decorateNode` 给不给高度取决于页面样式，所以
   「样式给了高」这个判断必须看真实解析结果，不能只看 props 里有没有 `style`。
4. **`focus` 受控但不粘手**。照 `input` 的 `_lastPropValue` 那套：用户点走导致的失焦
   不能回写 prop，也不能因为 prop 还是 `true` 就把焦点抢回来——否则输入框永远关不掉
   键盘。
5. **`maxlength` 默认值的破坏性**。老页面的 `<textarea>` 会突然 140 字截断，而且是
   静默截断（和 `input` 一样不给计数器 UI）。roadmap 单列一条，写清怎么改。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
pnpm --filter hello-fjs run typecheck

# native 不需要重编（只加了事件号枚举），但 Dart 侧要全绿
cd packages/flutter_fjs && flutter test && flutter analyze

# Web：新示例页逐条走 spec §6.4
pnpm --filter hello-fjs run dev:web

# iOS 模拟器：同一页，外加软键盘右下角按键文案；Android 不测
pnpm --filter hello-fjs run run:ios
```

两端对拍的固定动作：同一段中英混排文本粘进两端的 textarea，比对
`@linechange` 的 `lineCount`；切 `auto-height` 开关，看盒子是长高还是内部滚动；
切 `confirm-type`，看 Enter 是换行还是派 `@confirm`。
