# Web 平台

`fjs build --web` 把同一份 Vue 应用编译成浏览器能跑的静态站点：真 Vue
runtime-dom + vue-router，内置标签由一层 DOM 适配层实现。**页面源码一行不用改。**

```bash
pnpm run dev:web
pnpm run build:web
```

`fjs create` 生成的默认模板用 Vite 跑 Web 开发和构建，输出到 `dist/`。仓库里的
`examples/hello-fjs` 使用的是 CLI 内置 Web 模式，脚本为 `fjs dev --web` 和
`fjs build --web`，输出到 `dist/web/`。

两种方式都会走同一套 fjs Web alias：`fjs/app`、`fjs/router`、`fjs/web` 和
`fjs/pages`。产物是普通静态文件，可以交给任意静态托管。

## 它是怎么成立的

| 层 | Flutter | Web |
|---|---|---|
| 渲染器 | fjs 自定义 renderer → op 帧 → Widget | Vue runtime-dom |
| `<view>` `<swiper>` … | Dart 侧 widget 映射 | `fjs/web` 里的 Vue 组件 |
| `<style scoped>` | fjs 样式引擎（自己做 cascade / 继承） | 真 CSS（`compileStyle` 注入 `<style>`） |
| 路由 | 原生 Navigator | vue-router（hash 模式） |
| `toast()` | 原生浮层 | DOM 浮层 |
| `new Worker(code)` | Dart isolate + 独立 QuickJS | 真 Web Worker（Blob URL） |

内置标签在 web 上是**组件**（`fjs-runtime/src/web/components/`：`basic` 基础容器、
`form` 表单控件、`swiper`、`overlay` 下拉刷新与弹窗，`gestures` 是它们共用的点击 /
长按 / 拖拽），在 Flutter 上
是**元素**。SFC 编译时给 `@vue/compiler-dom` 传不同的 `isNativeTag` 来切换——
`text`、`image`、`switch` 这些本来是 HTML/SVG 原生标签，不显式声明就会被编译成
真元素，永远走不到适配层。

### 事件契约

原生侧所有事件的载荷都是**字符串**（JSI 边界只过标量），web 组件原样照搬，所以
同一个 handler 两边都对：

```vue
<switch :value="wifi" @change="(v: string) => (wifi = v === '1')" />
<slider :value="n" @change="(v: string) => (n = Number(v))" />   <!-- 两位小数 -->
<swiper @page-changed="(i: string) => (index = Number(i))" />
<input :value="name" @input="(t: string) => (name = t)" />
```

### 样式

`:style="{ fontSize: 16 }"` 在 Flutter 上是 16 像素，在 CSS 里是非法值。适配层
统一把数字按长度属性补 `px`（`opacity` / `flexGrow` / `lineHeight` 等无单位属性
除外），所以内联样式也不用分平台写。

基础样式表（`fjs-runtime/src/web/base-css.ts`）把容器都做成 `box-sizing:
border-box` 的列 flexbox，`stack` 用 CSS grid 让子节点重叠——对齐 Flutter 的
「padding 在盒内、margin 在盒外」和 `Stack` 语义。另外几条也是为了让两边量出来
一样：

- **根节点占满屏幕**：`#app > *` 拿 `flex-grow: 1`，对齐 Flutter 路由给页面根
  widget 的整屏紧约束——否则内容不满一屏时，底部 tabBar 会跟在内容后面而不是贴
  底。
- **默认行高 1.4**：CSS 的 `normal` 和 Flutter 的字体度量是两个数（同一页里中英
  文还各算各的），两边都钉死同一个倍数（`widgets/text.dart` 与 `text` 规则），
  行高不写就一致。
- **子节点不收缩，`flex-grow` = `Expanded`**：Flutter 的 Column/Row 子节点保持
  自然尺寸、超出就溢出，CSS flex 却会把它们压扁——一屏装不下的页面因此把每行的
  padding 和行盒挤没了，底部 tabBar 也跟着被压扁、切 tab 时抖动。所以内置标签
  一律 `flex-shrink: 0`；而 `flex-grow: n` 在 Dart 侧就是 `Expanded`（只拿剩余
  空间），web 侧由 `injectStyle()` / 内联样式归一化改写成 `flex: n 1 0%`，语义
  对齐。写了 `flex-basis` 的话以它为准。
- **滚动条不占布局**：Flutter 的滚动条是浮层，web 上一条随页面长度出现／消失的
  滚动条会让每次切 tab 都横向抖一下，所以 `scroll-view` / `list-view` 只沿自己
  的方向滚动，并隐藏滚动条。

### 内置组件的默认外观

`button` / `input` / `switch` / `checkbox` / `slider` / `progress` / `divider`
在 Dart 侧是 Material widget，默认外观（配色、内边距、边框、字号、点击区）本来
跟 CSS 基础样式表对不上。现在以基础样式表（`base-css.ts`）为准，Dart 侧把这些
默认值对齐过去，例如按钮默认 `10px 16px` 内边距、`1px rgba(0,0,0,0.16)` 边框、
`#007aff` 文字、14px/400 字重（Material 的 48dp 点击区和 64dp 最小宽度也去掉），
`switch` 用 iOS 绿 + 白滑块，`checkbox` 用 `#007aff` + 2px 灰描边。页面自己写的
样式照常覆盖默认值——`border-color` 单独出现时按 CSS 语义算 1px 边框。

`input` 的边框、圆角、内边距一律由页面样式决定（Material 自带的
`OutlineInputBorder` 会和页面画的框叠成两层，已关掉），placeholder 两边都钉成
`#999999`。

`button` 自带按下态：`.fjs-button:active` 叠一层 10% 黑（WeUI 的
`--weui-BTN-ACTIVE-MASK`——白底按钮变灰、填充按钮变深）。Flutter 侧用 pointer
down 立刻叠这层（和 CSS `:active` 同一套，不走 Material 的 tap 竞技场——
`onTapDown` 要等 `kPressTimeout`，点按会来不及画），并关掉水波纹。Material
默认用前景色着色，填充按钮按下反而变亮，方向是反的。新增或改默认样式时以
[WeUI 组件列表](https://wechat.design/tool/weui-mobile#weui%E7%BB%84%E4%BB%B6%E5%88%97%E8%A1%A8)
和 [WeUI 源码](https://github.com/Tencent/weui) 为准，详见 [UI API 参考](ui-api.md)。

Material 还会在控件外围预留点击区（checkbox 40dp、switch / slider 48dp），一列
设置项会因此被撑开好几十像素，CSS 只按控件本身算高度——所以这些默认值也一并去
掉了（checkbox 固定 20px，switch / slider 用 `shrinkWrap`）。`disabled` 的
switch 按 `.fjs-switch.disabled` 走 50% 透明度。

未声明颜色的 `text` 用基础样式表 `body` 的 `14px / #333333`（Flutter 默认会走
主题的 `DefaultTextStyle`，颜色对不上）。

### scroll-view 的 direction

`direction: horizontal` 是 scroll-view 自己的样式键（决定 Flutter 那个
scrollable 的轴），而 CSS 里同名属性是 `ltr / rtl`——浏览器会把
`direction: horizontal` 当非法值丢掉，横向 scroll-view 于是根本滚不动。
`injectStyle()` 把它改写成它实际代表的那对 `overflow`（内联 `:style` 里的同名键
在样式归一化时同样处理），真正的 `direction: ltr | rtl` 原样放行。

滚动容器也支持鼠标拖拽：渲染器给每个 Flutter scrollable 换了接受鼠标拖拽的
ScrollBehavior，而浏览器只认滚轮和手指。拖动超过 4px 才算拖（否则点一下还是
点击），拖完那一下 click 会被吞掉——拖拽在两个平台上都不是点击。

### swiper

`swiper` 的每一页是它的**真实子节点**：`<swiper><view v-for=.../></swiper>` 交给
插槽的是一个 Fragment，web 侧要先摊平再逐个包成页（Flutter 那边看不到这层——JS
渲染器在发 op 之前就把 Fragment 摊掉了，`buildKids()` 拿到的已经是真实子节点）。
每页由 `.fjs-swiper-item > *` 撑满，对齐 PageView 给每页的紧约束。

翻页由组件自己驱动，不交给 CSS scroll-snap：一次快速滑动或一次长拖会跨过好几个
snap 点，而 PageView 一个手势只翻一页。所以轨道是 `overflow: hidden`（`scrollLeft`
照样能设）+ `touch-action: pan-y`，滚轮和手指都无法在背后偷偷平移它：

- 拖拽（鼠标和手指同一套 pointer 逻辑）最多拖到相邻那一页，松手按 PageView 的
  五分之一页阈值决定翻不翻，再平滑落位；
- 触控板／横向滚轮一次手势只翻一页，其后的惯性事件在 400ms 内被忽略；
- 纵向滚轮原样放行，页面照常滚动；
- 首尾会夹住，窗口尺寸变化后仍停在当前页（`ResizeObserver` 重新对齐）。

翻页后回派 `@page-changed`，载荷与 Flutter 一致。

## 已知差异

- **`flex-direction: row` 的交叉轴默认值**：Flutter 是 `center`，CSS 是
  `stretch`。在乎的地方显式写 `align-items`。
- **页面状态**：web 默认 `<KeepAlive>`，按历史栈条目各挂一份外壳（各自的
  `<scroll-view>`）。新 `push` 从 `(0, 0)` 起，返回还原离开时那一页。**只缓存
  还在栈上的页**：pop 掉的那一页连同它的状态一起销毁，和 Flutter 出栈即 dispose
  一致——再 `push` 同一个路径拿到的是一个全新组件，不会看到上次留下的计数。完全
  不缓存（连返回也重挂）传 `keepAlive: false`。
- **`refresh` 下拉刷新**：web 只做了触摸端的简化版；纯桌面浏览器上拉不出来。
  这类页面可以用 `<route>` 的 `"platforms": ["app"]` 只在 App 端提供。
- **`platforms` 门控**：web 构建的路由表里不会出现 App 专属页面，页面代码也不会
  进产物。
- **触摸事件**：web 侧由 pointer 事件合成（所以鼠标也能跑同一份拖拽代码），
  一次 `pointermove` 只带一根手指，而 Flutter 会把一帧内多根手指的移动合成
  一条事件。`preventDefault()` / `stopPropagation()` 在 web 上是真的转发给
  原生事件，Flutter 上是空实现——两端都生效的是 `touch-action`。
- **页面组件要有单一根节点**：页面转场用 `<Transition>` 包着，多根节点会退化。

## 选项

```ts
createFjsApp({
  routes,
  shell: Shell,
  history: 'hash',      // 默认；'history' 需要服务端回退到 index.html
  keepAlive: true,      // true / false / 数字（最多缓存几页）
  transition: 'fjs-page', // 或 false 关掉页面转场
  el: '#app',
});
```

`history` / `keepAlive` / `transition` / `el` 只在 web 生效，Flutter 侧忽略；
`rootTag` 只在 Flutter 生效。两边共用一份 options 是刻意的——`main.ts` 不用分叉。

## 相关

- [路由](routing.md)
- [UI 标签参考](ui-api.md)
