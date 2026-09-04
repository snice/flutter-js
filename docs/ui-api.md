# UI API 参考

> 第二层第 2 篇。标签、事件、样式的**完整清单**。
> 样式的支持边界（哪些 CSS 属性/选择器能用）在
> [css-compat.md](css-compat.md)；实现原理在
> [custom-renderer.md](custom-renderer.md)。

fjs 用 HTML 风格的语义标签构建 UI，由 Dart 侧映射为 Flutter Widget，
由 [`web/components/`](../packages/fjs-runtime/src/web/components/) 映射为
浏览器上的 Vue 组件。标签既可用于 element API，也可用于 Vue 模板。

标签清单的唯一来源是
[`tags.json`](../packages/fjs-runtime/src/tags.ts)，组件 d.ts 和 Volar
数据都从它生成。

## 标签全集

| 标签 | Flutter 映射 | props / 事件 |
|------|--------------|--------------|
| `view` | Flex + 容器装饰 | 默认**纵向** flex（注意和 CSS 的 `row` 默认值不同）|
| `text` | Text | 文本由 setText 或子文本节点设置 |
| `image` | Image（`src` 是 http(s) 走 `cached_network_image`，否则走 asset）| `src`、`mode`（14 个，见下表）、`lazy-load`、`fit`（旧写法）；`@load` / `@error`。详见下表 |
| `button` | TextButton（Material 自带的 chrome 全部关掉）| 文本取子 text 节点；自带按下态；`type`(default/primary/warn) / `size`(default/mini) / `plain` / `loading` / `disabled` / `form-type`(submit/reset) |
| `input` | TextField | `value` / `placeholder` / `secure` / `multiline` / `keyboard`(text/number/decimal/tel/email) / `maxlength`(-1 不限) / `name`，`onTextChanged` / `onSubmit` / `onFocus` / `onBlur` |
| `scroll-view` | SingleChildScrollView | `scroll-x` / `scroll-y` 选轴（也可用样式键 `direction: horizontal`）、`scroll-top` / `scroll-left`、`scroll-into-view`、`scroll-with-animation`、`upper-threshold` / `lower-threshold`（默认 50）；`@scroll`（六字段 JSON 串）/ `@scrolltoupper` / `@scrolltolower`。详见下表 |
| `list-view` | ListView.builder | 大列表；`items` + 行插槽，两端都只挂载视口附近的行 |
| `switch` | Switch | `value`，`onValueChanged("1"/"0")` |
| `checkbox` | Checkbox | `value`，`onValueChanged`；`name` 是它在组/表单里的标识 |
| `radio` | 自绘圆形控件（不用 Material Radio，避免 40px 点击区）| 同 checkbox；点已选中的不会取消 |
| `radio-group` | 容器 + 控件作用域 | 组内互斥；`onValueChanged` 载荷是选中项的 `name`（无选中为空串）|
| `checkbox-group` | 容器 + 控件作用域 | `onValueChanged` 载荷是选中项 `name` 的 JSON 数组串，按文档顺序 |
| `label` | 容器 + 点击转发 | `for` 指向控件的 `id`，没有就取子树第一个控件；checkbox/radio/switch 是切换，input 是聚焦；没有子节点时渲染自己的文本 |
| `form` | **不是 Dart 标签**：两端都由 JS 组件实现（Flutter 走 `components/form.ts`，web 走 `web/components/form.ts`），渲染成一个 `view` | `@submit` 载荷是 `{name: value}` JSON 串，子树里每个带 `name` 的控件都在（未改动的也带默认值），值取控件当前态——未受控的输入框也算；`@reset` 只发事件，**值的回滚归页面**，所以进表单的字段都该绑 `:value`，没绑的页面清不掉。配 `<button form-type="submit">` / `="reset"` |
| `slider` | Slider | `value` / `min` / `max` / `name`，`onValueChanged`（两位小数的数值串）|
| `progress` | Linear/CircularProgressIndicator | `value`(0-1)，缺省为 indeterminate；`type: circular` |
| `divider` | Divider | `color` / `height` |
| `safe-area` | SafeArea | — |
| `picker-view` | 一行 `ListWheelScrollView`（每列一个）| `value` 是各列选中下标的数组（越界取末项）、`item-height`（默认 44）、`indicator-style`；滚动停下派 `@change`，载荷是下标数组的 JSON 串。只认 `picker-view-column` 子节点，其余会告警并丢弃 |
| `picker-view-column` | 一列的选项容器 | 子节点即选项 |
| `picker` | **不是 Dart 标签**：两端共用 `components/picker.ts`，渲染成 `modal` + `picker-view` + 两个 `button` | 插槽内容是页面上那一行，点它弹出；确定派 `@change`、取消/蒙层关闭派 `@cancel`；`disabled` 不弹。四种 `mode` 见下表 |
| `refresh` | RefreshIndicator | `onRefresh`（600ms 后自动收起）|
| `swiper` | PageView | `current`、`circular`、`autoplay` + `interval`、`duration`、`vertical`、`indicator-dots`；`@change`（真实索引串）。详见下表 |
| `swiper-item` | 撑满一页的容器 | 只在 `swiper` 内有意义 |
| `picker-view` | ListWheelScrollView 行 | 内嵌滚轮；`value` 是每列选中下标数组；`item-height` 默认 44；`indicator-style` 覆盖选中框；`onValueChanged` 载荷是下标数组 JSON 串 |
| `picker-view-column` | picker-view 的一列 | 只在 `picker-view` 内有滚轮语义；子节点即选项 |
| `modal` | BottomSheet | `visible` 驱动：true 打开、置回 false 关闭；原生手势关闭回派 `onModalClosed`；打开期间内容保持响应式更新（事件仍回派）|
| 自定义标签 | `engine.registerComponent` 注册的 Dart 组件（platform view 也经此接入）| 任意 props；未注册回落 `view` |

`<button>` 的默认描边、`type` 的配色、`radio` 的圆圈都是**宿主的默认值**
（`widgets/button.dart` / `widgets/radio.dart` 与 web 的 `.fjs-button--*` /
`.fjs-radio` 取同一组数值）；页面自己写的 `border` / `background-color` 照旧盖过
它们。配色跟已发布的控件走 iOS 蓝 `#007AFF`（warn 是 `#FF3B30`），按下态仍是
WeUI 的 10% 黑遮罩 —— 取舍写在 `specs/007-form-components/plan.md` §3.6。

### image

| prop | 说明 |
|---|---|
| `src` | `http(s)://` 走网络（Flutter 用 `cached_network_image`，带内存/磁盘缓存；web 就是 `<img>`，缓存交给浏览器），`asset://foo` 去掉 scheme 后按 Flutter asset / bundle 路径取，其余非空串同样按 asset 约定。空串不发请求也不派事件。换 `src` 就是新的一轮加载，旧请求的结果不会回派到新 `src` 上 |
| `mode` | 14 个值，默认 `scaleToFill`。**不认识的值会告警并降级**，不静静回落 |
| `lazy-load` | 进入可视区域附近才请求。两端用同一个预加载余量 240px（`fjs-runtime/src/image/lazy.ts`：web 传给 IntersectionObserver 当 `rootMargin`，Flutter 拿它比对 viewport），所以同一页在两端是在同一个滚动位置开始加载的。离开视口不取消已发出的请求，再进来复用结果 |
| `fit` | 旧写法，只在**没写** `mode` 时才读。两个都写以 `mode` 为准 |

| mode | 语义 | Flutter | web |
|---|---|---|---|
| `scaleToFill`（默认）| 拉伸填满，不保持比例 | `BoxFit.fill` | `object-fit: fill` |
| `aspectFit` | 保持比例完整显示，盒子留白 | `BoxFit.contain` | `contain` |
| `aspectFill` | 保持比例填满，超出裁掉 | `BoxFit.cover` | `cover` |
| `widthFix` | 宽度按样式走，高度按原图比例算 | `SizedBox(w, w / ratio)` | `height: auto` |
| `heightFix` | 高度按样式走，宽度按原图比例算 | `SizedBox(h * ratio, h)` | `width: auto` + `align-self: flex-start` |
| `top` / `bottom` / `center` / `left` / `right` | 保持比例裁剪，贴对应边 | `cover` + `Alignment` | `cover` + `object-position` |
| `top left` / `top right` / `bottom left` / `bottom right` | 同上，贴对应角 | 同上 | 同上 |

`widthFix` / `heightFix` 要拿到原图 intrinsic 尺寸才能定另一边：图还没到时先按样式
给的那一边撑出一个有限的占位盒，metadata 一到再换成真实比例，父布局不会抖。样式里
没给那一边的尺寸（`widthFix` 却没写 `width`）就退化成普通内容盒，并 `warnOnce` 说明。

| 事件 | 载荷 | 次数 |
|---|---|---|
| `@load` | `{"width":600,"height":400}`，字段顺序固定，是**原图像素**尺寸，不带单位 | 当前 `src` 成功后一次 |
| `@error` | `{"errMsg":"image load failed"}` | 当前 `src` 失败后一次 |

两个事件互斥，同一轮加载只会有一个，组件重建也不会补派；两端的载荷**逐字符相同**
（编码在 `fjs-runtime/src/image/events.ts`，Dart 侧 `widgets/image.dart` 用同一份格式）。
平台原始异常不会跨桥——`errMsg` 是固定文案，免得同一个错误在两端因为异常类名不同
给出不一样的字符串。没有监听器时图片照样加载和缓存，不会因为没人听就改变画面。

### scroll-view

| prop | 说明 |
|---|---|
| `scroll-x` / `scroll-y` | 滚动轴。两个都写会告警并按纵向处理 |
| `scroll-top` / `scroll-left` | 受控偏移，但**不粘手**：值没变就不动，用户滚到别处再来一次同样的值不会被拽回去 |
| `scroll-into-view` | 子孙节点的 `id`。匹配不到会告警，不会静静不动 |
| `scroll-with-animation` | 上面两个的移动是否带 250ms 动画 |
| `upper-threshold` / `lower-threshold` | 距顶/距底多少 px 算「到边」，默认 50 |

| 事件 | 载荷 |
|---|---|
| `@scroll` | `{"scrollTop":…,"scrollLeft":…,"scrollHeight":…,"scrollWidth":…,"deltaX":…,"deltaY":…}`，字段顺序固定、数值一位小数（两端逐字符一致，见 `fjs-runtime/src/scroll/metrics.ts`）|
| `@scrolltoupper` / `@scrolltolower` | 无载荷。**进入**阈值区才派一次，离开再回来才重派；打开时就在顶部**不算**「到顶」 |

`scroll-x` / `scroll-y` 压过样式键 `direction`——两者在不同层，写了哪个都还能用。

### swiper

| prop | 说明 |
|---|---|
| `current` | 受控页码，越界会告警并落到最后一页 |
| `circular` | 首尾相接。Flutter 用无边界 PageView 取模，web 用复制首尾页，但 `@change` 两端都报**真实索引**，页面看不到克隆页的号 |
| `autoplay` / `interval` | 自动播放及其间隔（默认 5000ms）；手指按住时暂停 |
| `duration` | 翻页动画时长（默认 500ms）|
| `vertical` | 上下翻页 |
| `indicator-dots` | 底部指示点，当前页填黑、其余 30% 黑 |

`@change` 的载荷是索引串；`animateTo` 途中经过的页不会逐个上报，只报落点。

小程序要求 `swiper` 的直接子节点只能是 `swiper-item`，fjs **不强制**：其它子节点
照常渲染，只是不会被当成一页。`swiper-item` 自己撑满一页，页面里那层
`<view class="slide">` 不用再写高度。

### picker 的四种 mode

| mode | `value` | `@change` 载荷 | 其它 props |
|---|---|---|---|
| `selector`（默认）| 下标 | 下标串，如 `"2"` | `range`、`range-key` |
| `multiSelector` | 下标数组 | 下标数组 JSON 串，如 `[1,0,3]` | `range`（二维）、`range-key`；列变化派 `@columnchange`，载荷 `{"column":0,"value":2}` |
| `time` | `"hh:mm"` | 同格式 | `start` / `end` |
| `date` | `"YYYY-MM-DD"` | 同格式 | `start` / `end` / `fields`(year/month/day) |

列的生成与值换算（日期数学、范围裁剪、对象数组按 `range-key` 摊平）都在 JS
侧（`components/picker-modes.ts`），Dart 只见字符串。`mode="region"` 未实现，
理由见 `specs/008-picker/spec.md` §2。

`toast` 不是标签，是全局函数：`import { toast } from 'fjs'; toast('msg')`。

## 组件：picker

`picker` 不是 Dart 标签，而是两端共用的 JS 组件：它用 `modal` 打开底部弹层，
用 `picker-view` / `picker-view-column` 画滚轮，取消不改页面值，确定时才派
`@change`。`disabled` 为 true 时点击插槽内容不会弹出。

| mode | `value` | `@change` 载荷 | 其它 props |
|------|---------|----------------|------------|
| `selector`（默认） | 下标数字 | 下标串，如 `"2"` | `range`、`range-key` |
| `multiSelector` | 下标数组 | 下标数组 JSON 串，如 `[1,0,3]` | `range`（二维）、`range-key`；列变化派 `@columnchange`，载荷 `{"column":0,"value":2}` |
| `time` | `"hh:mm"` | 同格式 | `start` / `end` |
| `date` | `"YYYY-MM-DD"` | 同格式 | `start` / `end` / `fields`（`year` / `month` / `day`）|

`picker-view` 自己也可直接用在页面里：`value` 越界时落到该列最后一项，滚动停下
后才派一次 `@change` / `@value-changed`，载荷始终是字符串形式的 JSON 下标数组。
`picker-view` 只渲染 `picker-view-column` 子节点；其它子节点会被丢弃并告警一次，
避免静默失效。

## 设计参考

内置组件的默认外观（配色、圆角、按下态等）以微信 WeUI 为参照，Flutter 与
Web 两端取同一组数值。新增或改默认样式时先看：

- [WeUI 组件列表](https://wechat.design/tool/weui-mobile#weui%E7%BB%84%E4%BB%B6%E5%88%97%E8%A1%A8)
- [WeUI 源码](https://github.com/Tencent/weui)
- [微信小程序组件文档](https://developers.weixin.qq.com/miniprogram/dev/component/)

例如 `button` 按下立刻叠一层 10% 黑（`--weui-BTN-ACTIVE-MASK`，手指落下
当帧就画，不点按无反馈），白底变灰、填充色变深；页面自己写的 `:active`
会盖过它。

## 事件（props 形式）

| prop | 事件 | 载荷 |
|------|------|------|
| `onTap` / `onClick` | FJS_EVENT_TAP | — |
| `onLongPress` | FJS_EVENT_LONG_PRESS | — |
| `onTextChanged` | FJS_EVENT_TEXT_CHANGED | utf8 文本 |
| `onSubmit` | FJS_EVENT_TEXT_SUBMITTED | utf8 文本 |
| `onValueChanged` | FJS_EVENT_VALUE_CHANGED | "1"/"0" 或数值串 |
| `onPageChanged` | FJS_EVENT_PAGE_CHANGED | 索引串 |
| `onLoad` / `onError`（在 `image` 上）| FJS_EVENT_IMAGE_LOAD / FJS_EVENT_IMAGE_ERROR | `{"width":n,"height":n}` / `{"errMsg":"…"}` JSON 串 |
| `onModalClosed` | FJS_EVENT_MODAL_CLOSED | — |
| `onRefresh` | FJS_EVENT_REFRESH | — |
| `onFocus` / `onBlur` | FJS_EVENT_FOCUS / FJS_EVENT_BLUR | 输入框当前文本 |
| `onSubmit` / `onReset`（在 `form` 上）| — | 不过桥：`form` 是 JS 组件，事件在 JS 侧就地 emit（号段 22/23 仍登记在契约表里备用）|
| `onTouchstart` / `onTouchmove` / `onTouchend` / `onTouchcancel` | FJS_EVENT_TOUCH_* | TouchEvent 对象，见下 |

处理器函数留在 JS 侧注册表，跨桥只发送 `onTap: true` 标记。

## 触摸事件（对齐 DOM）

任何标签都可以监听 `touchstart` / `touchmove` / `touchend` / `touchcancel`，
拿到的事件对象和浏览器里的同名事件同形：

```vue
<view
  class="block"
  @touchstart="onStart"
  @touchmove="onMove"
  @touchend="onEnd"
  @touchcancel="onEnd"
/>
```

```ts
import type { FjsTouchEvent } from 'fjs';

function onMove(e: FjsTouchEvent) {
  const t = e.changedTouches[0];
  t.identifier;                  // 这根手指的 id，按下到抬起不变
  t.clientX; t.clientY;          // 逻辑像素；page/screen/x/y 同值
  e.touches;                     // 屏幕上所有按下的手指
  e.targetTouches;               // 其中按在这个节点上的
  e.changedTouches;              // 本次事件涉及的
  e.timeStamp;                   // 毫秒
  e.target.id;                   // 节点的 id 属性（target === currentTarget）
}
```

一次多指、`changedTouches` 只带变化的那几根、`touchend` 时手指已从
`touches` 里移除只留在 `changedTouches` —— 都和 DOM 一致。

与浏览器的差别（都是有意为之）：

- 没有深层 target：`target` 就是挂监听的那个节点，`currentTarget` 是同一个
  对象。没有 DOM 那种事件委托。
- 事件由内向外派发到路径上每个监听节点（相当于冒泡），但
  `stopPropagation()` 在 Flutter 上是空实现；`preventDefault()` 同理——原生
  默认行为要用 `touch-action` 关，那条两端都生效。
- App 上一根手指按在哪个节点，后续的 move/end 就一直归它，等价于 web 的
  pointer capture；web 侧实现也真的调了 `setPointerCapture`。
- Web 侧用的是 pointer 事件而不是 DOM touch 事件，所以桌面浏览器里鼠标也能
  跑同一套代码（和 Flutter 的 Listener 收鼠标一样）。

### touch-action：谁拿走这次手势

和 CSS 同名同义：默认 `auto` 时，外层滚动容器可以把手势抢走（抢走的那一刻
派发 `touchcancel`，和浏览器一样）。要让节点自己吃掉手势就声明：

```css
.block { touch-action: none; }   /* 全都归自己：拖拽块必写 */
.row   { touch-action: pan-y; }  /* 竖向留给外层滚动，横向归自己 */
```

Web 上这就是原生 CSS；Flutter 上它让节点进手势竞技场，在手指移动约 8px
（鼠标 1px）时抢下指针——早于滚动容器的 18px 阈值，所以滚动不会启动。
支持的值：`auto`（默认）、`none`、`pan-x`、`pan-y`、`manipulation`（同 auto）。

### 跟手不掉帧

- 一帧内到达的多个 move 会合并成一次派发（一帧一次跨桥），start/end/cancel
  之前会先把待发的 move 冲掉，顺序不会乱。
- 拖动请改 `transform: translate(...)` 而不是 left/top 或 margin：前者只重绘，
  不触发布局，命中测试也跟着一起动。
- 跨桥的 payload 是压缩过的 JSON：单指时只有一条
  `{"ts":…,"touches":[[id,x,y]]}`，另外两个列表相同就不发。

例子见 `demo/src/pages/drag.vue`（块拖拽、多指）和 `demo/src/pages/dnd.vue`
（网格 + 竖列表拖拽排序）。

## 样式（style 属性 / class / `<style scoped>`）

样式值支持三种来源（优先级从低到高）：HTML 标签默认样式（h1-h6、tr、
a 等）、class 匹配到的 CSS 规则、内联 style。CSS 文本里的值用 kebab-case
（`font-size: 16px`），内联对象用 camelCase（`fontSize: 16`）；数字不带
单位表示逻辑像素。

```ts
{ style: {
    // ---- 盒模型 ----
    width: 200, height: 48,
    minWidth: 0, minHeight: 0, maxWidth: 300, maxHeight: 120,
    margin: 16, padding: '8 16',        // 数字 | 'V H' | 'T H B' | 'T R B L' | 对象 | '8px'
    marginTop: 12, paddingLeft: 10,     // 单边写法；与简写同时出现时单边覆盖那一边
    backgroundColor: '#FF0000', color: '#333333',
    // 颜色也支持 #RGB/#RGBA/#RRGGBBAA、rgb()/rgba()/hsl()/hsla()、命名色
    borderRadius: 12,                   // 数字 | '8px' | '8px 16px' | '1px 2px 3px 4px'
    borderWidth: 1, borderColor: '#DDDDDD',
    border: '1px dashed #ccc',          // 简写：solid / dashed / dotted
    borderStyle: 'dashed',              // 单写；double/groove 等按 solid 画
    // borderWidth / borderColor / borderStyle 覆盖简写的对应分量；'none' 和 0
    // 宽度就是没有边框——button 自带的那道 hairline 也是这么关掉 / 换色的
    opacity: 0.8,
    overflow: 'hidden',                 // 裁剪内容
    // ---- flex 布局 ----
    flexDirection: 'row',               // 'row' | 'column'（默认）
    flexWrap: 'wrap',                   // 换行（映射 Wrap；此时 flexGrow 失效）
    justifyContent: 'center',           // start/end/center/space-between/...
    alignItems: 'center',               // start/end/center/stretch
    flexGrow: 1,                        // 映射 Expanded；也支持 flex: 1 简写
    gap: 8,                             // 子项间距（rowGap/columnGap 可分别指定）
    // ---- 定位 ----
    position: 'relative',               // 本盒子成为定位上下文；配 top/left 只挪画面，不动布局
    position: 'absolute',               // 脱离文档流，按最近的定位祖先摆
    top: 0, right: -4, bottom: 0, left: 0,
    // ---- 文字（color/fontSize 等沿树继承，同 CSS）----
    fontSize: 16, fontWeight: 600,      // 100-900 | 'normal' | 'bold'
    fontStyle: 'italic', fontFamily: 'Roboto',
    lineHeight: 1.5,                    // 数字=倍数；'24px'=绝对值
    letterSpacing: 0.5,
    textAlign: 'center',
    textDecoration: 'underline',        // underline | line-through | overline
    textTransform: 'uppercase',         // uppercase | lowercase | capitalize
    whiteSpace: 'nowrap',               // 单行截断
    maxLines: 2, overflow: 'ellipsis',
    // ---- 变换 / 手势 ----
    transform: 'translate(12px, -4px) scale(1.06) rotate(5deg)',
    // translate / translateX / translateY / translate3d / scale / scaleX /
    // scaleY / rotate(deg|rad|turn|grad) / matrix(a,b,c,d,e,f)，从左到右复合。
    // 只重绘不重排，命中测试跟着动——拖动就用它
    touchAction: 'none',                // auto | none | pan-x | pan-y
    // ---- 视觉效果 ----
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',   // 字符串或数组
    textShadow: '0 1px 2px #000000',
    background: 'linear-gradient(180deg, #4facfe 0%, #00f2fe 100%)',
    // 也支持 background-image / radial-gradient / to bottom 等方向
} }
```

也可把样式键直接放在 props 顶层（两种写法都支持）。`overflow: 'ellipsis'`
与 `overflow: 'hidden'` 共用 `overflow` 键：text 节点上是截断省略，容器上
是裁剪。

Vue SFC 的 `<style>` / `<style scoped>` 编译后由运行时样式引擎解析并按
class 匹配（选择器范围与层叠规则见 docs/vue3.md）。CSS 自定义属性
（`--x` + `var()`，含 fallback/链式/循环安全）与 Vue 的 `v-bind()`
CSS 绑定（响应式值注入）均受支持：变量在 JS 侧解析完成后才跨桥，
`--x` 定义本身不会出现在原生样式里。

## element API（无框架）

```ts
import { h, createRoot, setText, setProps } from 'fjs';

const root = createRoot('view');               // 挂到宿主根容器（id 0）
const label = h('text', { style: { fontSize: 20 } }, 'hi');
root.appendChild(label);

let n = 0;
root.appendChild(h('button', {
  onTap: () => setText(label, `taps: ${++n}`),
}, '+1'));
```

所有操作自动按微任务聚合为一次二进制帧提交。

## Vue 3 用法

```ts
import { createApp, flutterRoot } from 'fjs/vue';
createApp(App).mount(flutterRoot('scroll-view'));
```

- 模板标签即上表标签；`@tap`/`:on-tap` 两种事件写法等价（kebab 会自动
  camelCase 化）
- `v-for`/`v-if`/`computed`/`ref` 全部可用；`v-model` 不可用（见
  [vue3.md](vue3.md#不可用--注意)）
- `createApp` 必须从 `fjs/vue` 导入（不要从 `vue` 导 DOM 版 createApp）
- 挂载根：`flutterRoot('scroll-view')` 适合整页滚动的应用；要做「顶部导航栏
  + 中间滚动区 + 底部 tabBar」这种固定外壳直接写就行：根节点
  （`flutterRoot()`，默认 `view`）的子节点默认按 `flex-grow: 1` 撑满整页——
  和 web 基础样式表里的 `fjs-page-entry > * { flex: 1 1 0% }` 是同一条规则，
  中间那块的 `flexGrow` 才有东西可分。示例见 `examples/hello-fjs`

## 已知限制

样式属性和选择器的**完整支持矩阵**在 [css-compat.md](css-compat.md)，
这里只列会让人写错代码的几条。

- **没有属性级过渡**：`transition` / `animation` 不支持，`transform` 有但是
  立刻生效的。**页面转场是另一回事，那个支持**，见
  [routing.md](routing.md#转场动画)
- **没有自定义字体加载**：`fontFamily` 只透传平台已装的字体。要用自带字体，
  在宿主 Flutter 工程里打包字体资源再按名引用
- 无 `align-self`（Flutter 的 Flex 没有逐子对齐）、无 inset 阴影、
  无边框分侧（`border-top` 等）
- dashed / dotted 有，但 CSS 没规定虚线的疏密，各浏览器自己定：这里按
  「线段和间隔都是边框宽度的 3 倍、点是 1 倍宽 2 倍间隔」画，和 Chrome 接近
  而非逐像素一致
- **列容器默认 `align-items: stretch`**：没有显式宽度的子节点会被拉满整行
  （横向容器默认是 `center`）。想让子节点按内容宽度收缩，**给容器**写
  `align-items: flex-start` —— 没有 `align-self`，收缩不了单个子节点。
  显式写了 width / height 的子节点会保留自己的尺寸，不被拉伸
- **定位就是 CSS 那一套**：任何盒子写了 `position: relative` 就是定位上下文，
  它的 `position: absolute` 子节点按 top/right/bottom/left 摆在它上面，其余
  子节点照常走 flex。（早期版本的 `stack` 标签已删除，用 `view` +
  `position: relative` 代替）
- 和 CSS 一样，没有定位祖先时 `position: absolute` 不生效（这边是留在流里，
  不像 CSS 那样退到视口）——所以父级要显式写 `position: relative`
- 定位子节点可以露到盒子外面（`top: -4px` 的角标），和 web 一样不裁剪；要裁
  就给父级加 `overflow: hidden`
- **emoji 系的码位在 Flutter 上可能渲染成方框**。中文、`◎ ✓ ✚ △ ›` 这类
  普通符号都正常（走系统字体的回退），但 Unicode 里可以按 emoji 呈现的码位
  （`✉ ★ ☎` 以及真 emoji）会被交给系统 emoji 字体，某些 Flutter / iOS 组合
  取不到它，就是一个方框——同一份代码在 web 上由浏览器自己的回退链兜住，所以
  只有 app 端出问题。写 `font-family: Apple Color Emoji` 也救不回来（那个字体
  同样解析不到）。**图标用 iconfont 或图片**，别用 emoji 字符；一定要 emoji
  就在宿主 Flutter 工程里打包一个 emoji 字体资源，再用 `font-family` 指名。
  （别指望 `fontFamilyFallback`：Flutter 里一旦给了回退列表，它会**取代**
  平台默认字体，中文会先崩）
- CSS 百分比尺寸（`width: '50%'`、`borderRadius: '50%'`）不支持；用像素或
  flex 权重替代
- 选择器仅基础集（类/标签/后代/子代/`:deep`/`:global`，加上末位复合选择器上的
  `:active` 按压态）；其他伪类、属性选择器、id 选择器、@media 跳过并**告警**
  （不会静默丢弃）
- 文本嵌套富文本：外层 text 的 setText 更新（子 text 回退渲染）
- 长列表请用 list-view（ListView）而非 scroll-view——**这不是微调**：
  `scroll-view` 会 build/layout/paint 它的每一个孩子，1000 行切主题实测
  最慢帧 166 ms 对 29 ms（[performance.md](performance.md#两个开关两条独立的账)）。
  debug 构建下孩子超过 200 个会打印一次提醒。给它 `items` 和一个
  `#default="{ item, index }"` 行插槽就会虚拟化——Flutter 侧由
  `ListView.builder` 懒构建，web 侧只挂载视口 ± `prefetchExtent` 的行，
  上下用占位块撑出完整滚动高度（滚动条、回退还原位置都照常）。
  行高必须固定：不是 64px 时用 `item-height` 告诉它，行高不一的列表两端都不支持

## 相关

- [Web CSS 兼容清单](css-compat.md) —— 属性 / 选择器支持矩阵
- [自定义渲染器](custom-renderer.md) —— 这些标签在 JS 侧是怎么变成 op 帧的
- [Vue 3 集成](vue3.md) —— SFC、scoped style
- [Web 平台](web.md) —— 同一份代码在浏览器上的差异
