# UI API 参考（v1）

fjs 用 HTML 风格的语义标签构建 UI，由 Dart 侧映射为 Flutter Widget。
标签既可用于 element API，也可用于 Vue 模板。

## 标签

| 标签 | Flutter 映射 | 说明 |
|------|--------------|------|
| `view` | Flex + 容器装饰 | 默认纵向 flex |
| `text` | Text | 文本内容通过 setText 或子文本设置 |
| `image` | Image.network / AssetImage | `src` 支持 http(s):// 与 asset 路径 |
| `button` | OutlinedButton | 文本取子 text 节点 |
| `input` | TextField | value/placeholder/secure/multiline |
| `scroll-view` | SingleChildScrollView | `direction: 'horizontal'` 可横向 |
| `list-view` | ListView.builder | 大列表；`items` + 行插槽，两端都只挂载视口附近的行 |

## 组件全集（v2 新增粗体）

| 标签 | Flutter 映射 | props / 事件 |
|------|--------------|--------------|
| view / text / image / button / input / scroll-view / list-view | 同 v1 | 见上 |
| **switch** | Switch | value, onValueChanged("1"/"0") |
| **checkbox** | Checkbox | value, onValueChanged |
| **slider** | Slider | value/min/max, onValueChanged(数值串) |
| **progress** | Linear/CircularProgressIndicator | value(0-1) 缺省 indeterminate, type: circular |
| **divider** | Divider | color/height |
| **stack** | Stack | 子节点 style.position:'absolute' + top/left/right/bottom |
| **safe-area** | SafeArea | — |
| **refresh** | RefreshIndicator | onRefresh（600ms 后自动收起） |
| **swiper** | PageView | onPageIndex→onPageChanged(索引串) |
| **modal** | BottomSheet | visible 驱动：true 打开、置回 false 关闭；原生手势关闭回派 onModalClosed；打开期间内容为快照（事件仍回派） |
| **toast** | 全局函数非组件 | `import { toast } from 'fjs'; toast('msg')` |
| 自定义标签 | engine.registerComponent 注册 | 任意 props；未注册回落 view |

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
| `onModalClosed` | FJS_EVENT_MODAL_CLOSED | — |
| `onRefresh` | FJS_EVENT_REFRESH | — |

处理器函数留在 JS 侧注册表，跨桥只发送 `onTap: true` 标记。

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
    margin: 16, padding: '8 16',        // 数字 | 'V H' | 'T R B L' | 对象 | '8px'
    backgroundColor: '#FF0000', color: '#333333',
    // 颜色也支持 #RGB/#RGBA/#RRGGBBAA、rgb()/rgba()/hsl()/hsla()、命名色
    borderRadius: 12,                   // 数字 | '8px' | '8px 16px' | '1px 2px 3px 4px'
    borderWidth: 1, borderColor: '#DDDDDD',
    border: '1px solid #ccc',           // 简写（dashed/dotted 渲染为 solid）
    opacity: 0.8,
    overflow: 'hidden',                 // 裁剪内容
    // ---- flex 布局 ----
    flexDirection: 'row',               // 'row' | 'column'（默认）
    flexWrap: 'wrap',                   // 换行（映射 Wrap；此时 flexGrow 失效）
    justifyContent: 'center',           // start/end/center/space-between/...
    alignItems: 'center',               // start/end/center/stretch
    flexGrow: 1,                        // 映射 Expanded；也支持 flex: 1 简写
    gap: 8,                             // 子项间距（rowGap/columnGap 可分别指定）
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
  docs/toolchain.md）
- `createApp` 必须从 `fjs/vue` 导入（不要从 `vue` 导 DOM 版 createApp）
- 挂载根：`flutterRoot('scroll-view')` 适合整页滚动的应用；要做「顶部导航栏
  + 中间滚动区 + 底部 tabBar」这种固定外壳，用 `flutterRoot('stack')` ——
  Stack 会把有界高度约束传给子节点，`flexGrow` 才能把中间区域撑开（挂在
  view / scroll-view 上时主轴是无界的，Expanded 失效）。示例见
  `examples/hello-fjs`

## 已知限制（v1.1）

- 没有动画、transition、PlatformView、自定义字体加载（fontFamily 仅透传
  平台已装字体）
- 无 alignSelf（Flutter Flex 无逐子对齐）、无 inset 阴影、无 dashed/
  dotted 边框、无边框分侧（border-top 等）
- 列容器默认 `align-items: stretch`：没有显式宽度的子节点会被拉满整行。
  想按内容宽度收缩，给该子节点加 `align-items: flex-start`（显式写了
  width / height 的子节点会保留自己的尺寸，不被拉伸）
- `stack` 的非定位子节点按自身尺寸排布：一个只有样式、没有内容的空
  `view` 宽度会是 0，背景该画在 stack 自己身上
- CSS 百分比尺寸（width: '50%'、borderRadius: '50%'）不支持；用像素或
  flex 权重替代
- 选择器仅基础集（类/标签/后代/子代/:deep/:global，加上末位复合选择器上的
  `:active` 按压态）；其他伪类、属性选择器、id 选择器、@media 跳过并告警
- 文本嵌套富文本：外层 text 的 setText 更新（子 text 回退渲染）
- 长列表请用 list-view（ListView）而非 scroll-view：给它 `items` 和一个
  `#default="{ item, index }"` 行插槽就会虚拟化——Flutter 侧由
  `ListView.builder` 懒构建，web 侧只挂载视口 ± `prefetchExtent` 的行，
  上下用占位块撑出完整滚动高度（滚动条、回退还原位置都照常）。
  行高必须固定：不是 64px 时用 `item-height` 告诉它，行高不一的列表两端都不支持
