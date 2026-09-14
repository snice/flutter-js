# 小程序编译：`fjs build --mp`

> 状态：spec 046 落地的第一版。目标形态是微信小程序 **Skyline 渲染 +
> glass-easel 组件框架**（`renderer: skyline`、`componentFramework:
> glass-easel`、`lazyCodeLoading: requiredComponents`）。

## 定位

fjs 的第三条产物路径。同一份 Vue SFC 源码：

| 路径 | 产物 | 模板去向 | 运行时 |
|---|---|---|---|
| `fjs build` | Flutter 宿主 bundle | render 函数（custom renderer） | element API + op 协议 |
| `fjs build --web` | 静态站点 | render 函数（DOM 适配层） | vue-router + DOM 组件 |
| `fjs build --mp` | **微信小程序四件套** | **WXML（编译期直译）** | `@ufjs/runtime/wx` 薄壳 |

与另外两端最大的不同：**不引入 Vue 运行时**。模板编译为 WXML 而非
render 函数，不打包 vdom；`import { ref } from 'vue'` 被别名到
`@ufjs/runtime/wx`，那只是 `@vue/reactivity`（ref/computed/watch，无
DOM、无 vdom）加一层 setup→setData 的胶水。分层思路对齐 wevu：
编译期（weapp-vite）管转换，运行期（wevu）管响应式与最小 setData。

## 用法

```bash
cd examples/hello-fjs
pnpm build:mp              # = fjs build --mp
pnpm dev:mp                # = fjs dev --mp：watch src/，增量重建 dist/mp
# 用微信开发者工具打开 dist/mp/（appid 默认 touristappid，可在
# package.json fjs.mp.appid 配置）
```

dev 模式没有 HTTP 服务：开发者工具自己监听 `dist/mp` 的文件变化并热编译，
`fjs dev --mp` 只负责 watch 源码 → 重建（全量发射，~100ms 级）。

**产物是 TypeScript 源码**（对齐官方 TS 快速启动模板）：每个 SFC 发射
为一个可读的 `.ts` 模块，`import` 已重写到发射位置，TS 编译交给开发者
工具（`useCompilerPlugins: ["typescript"]`）——fjs 不对应用代码做
esbuild 打包。跨页单实例不再靠注册表 hack：所有本地 TS/JS 依赖发射到
`fjs/shared/<源相对路径>`，微信的模块缓存保证全局单份。

`package.json` 的 `fjs.mp` 字段：

```jsonc
{
  "fjs": {
    "mp": {
      // 不进 app.json 的页面（路径或路径片段）
      "exclude": ["example/", "comp/canvas"],
      // 应用壳（每页包一层 NavBar/TabBar），默认 src/Shell.vue
      "shell": "@/Shell.vue",
      // project.config.json 的 appid 兜底（优先级低于 app.config.ts 的 wxmp.appid）
      "appid": "wx1234567890"
    }
  }
}
```

appid 的来源优先级：**app.config.ts `wxmp.appid`**（app 级配置，与 android/
ios 并列）> package.json `fjs.mp.appid` > `touristappid`。

`wxmp.setting` 写入 project.config.json 的 `setting`，与 fjs 的默认值**按键
浅合并、用户优先**：

```ts
wxmp: {
  appid: 'wx55831603b568aa90',
  renderer: 'skyline',
  setting: { minified: true, minifyWXSS: true, minifyWXML: true },
}
```

默认值里 `es6` / `enhance` 为 true（产物是 TS 源码，typescript 插件只剥类型，
`??`、`?.` 等语法要靠它们降级，否则预览/上传报 `Unexpected token ?`），
`useCompilerPlugins: ["typescript"]` 必须保留——覆盖这几项要清楚后果。

## 产物结构

```
dist/mp/
  project.config.json          miniprogramRoot + useCompilerPlugins: typescript
  miniprogram/
    app.{ts,json,wxss}         skyline + glass-easel 全局配置
    sitemap.json
    fjs/runtime.ts             vendor 包：wx 运行时 + @vue/reactivity（CJS）
    fjs/routes.ts              生成路由表（'fjs/pages' 的 wx 形态）
    fjs/shared/<rel>           发射的本地 TS 模块（theme.ts、catalog.ts…）
    fjs/modules/<module>/<tag>/ 模块包提供的组件四件套（如 iconmind）
    fjs/{fjs-modal}/           runtime 提供的组件四件套
    components/<name>/*        编译后的本地组件（Shell、Panel…）
    pages/<route>/*            **页面本体**：页面 SFC 即 page
    assets/                    静态图片（import 被改写成根绝对路径常量）
```

页面就是页面：路由 SFC 直接以 `Component()`（`isPage: true`）注册为
小程序页面（skyline 模板推荐写法），它自己的 wxml 就是
`<shell route="{{ route }}">页面元素</shell>`——shell 的包裹方式与
createFjsApp 在另外两端做的一致，`route`（path/query/meta）由编译器
注入 setup 并在 onLoad 同步 query。`virtualHost` 让组件不产生宿主
节点，flex 链与另外两端一致。emit 的 import 重写规则：
`vue`/`fjs`/`fjs/router`/`@ufjs/runtime/wx` → `fjs/runtime`；`fjs/pages`
→ `fjs/routes`；`@/x.png` 类资源 → 根绝对路径常量；其余本地模块 →
`fjs/shared/<rel>`（递归发射，源结构保持不变）；`import type` 整条擦除；
裸的 node_modules 值导入直接报错（小程序端没有 node_modules）。

## 标签映射（编译期）

| fjs 标签 | 小程序端 |
|---|---|
| view/text/image/scroll-view/swiper/swiper-item/button/input/textarea/switch/slider/form/rich-text/picker(-view/-column)/web-view | 同名直出（下面几行是直出时要补的语义/外观） |
| text | 打 `.fjs-text`；被 `align-items: center/flex-end` 的 column 父级（本 SFC 的 class）居中/尾对齐、且自身没有背景/边框/宽度的 text 再打 `.fjs-text--center/--end`（stretch + text-align）——skyline 不给交叉轴居中的 text 传宽度约束，长文本不换行 |
| button | 打 `.fjs-button` + 由静态 `type`/`plain`/`size` 推出的变体 class，数值同 base-css（重置 wx 按钮的 184px 宽、粗体、灰底）；默认 `hover-class="fjs-button--pressed"`：按住时 `box-shadow: inset 0 0 0 999px rgba(0,0,0,.1)` 整体压暗 10%（WeUI 按压模型，数值同 base-css 的 `:active::after`）。不用 `::after`：webview 内置按钮自己占用 `::after`（细边框），遮罩画不出来；内阴影两种渲染器都生效且跟随圆角。页面自带 hover-class 时不覆盖 |
| input | `secure`→`password`，`keyboard`→`type`，默认补 `maxlength="-1"`（wx 默认 140）；`multiline`（静态或 `:multiline="true"`）编译为 `textarea` |
| switch | `value`→`checked`，默认 `color="#34c759"` |
| slider | 默认 `active-color`/`block-color` #007aff、`block-size` 16，去掉 wx 左右 18px 外边距 |
| swiper | 非 swiper-item 的子元素自动包一层 swiper-item（v-for/v-if/:key 移到包装上）；swiper-item 的直接子元素打 `.fjs-fill` 撑满 |
| scroll-view | 子节点统一包进 `.fjs-scroll-inner`，本 SFC class 里的 flex 布局声明（gap/flex-direction/align-items…）内联到包装上——skyline `type="list"` 不对直接子节点做 flex；`direction: horizontal`（class/style/属性）→ `scroll-x` |
| list-view（`:items` + `#default="{ item, index }"`） | `scroll-view type="list"` + `wx:for`，行是直接子节点（skyline 按需构建，等价虚拟化，**不**包内层） |
| checkbox / radio / checkbox-group / radio-group / label | runtime 组件 `fjs-*`（wx 原生语义不同：状态在 `checked`、change 只在 group 上触发）。`value` 布尔、change 载荷 `"1"/"0"`，group 载荷同 ui-api.md；label 点整行转发给 `for` 指向或第一个控件。宿主 class 上的 flex 布局经 `layout` 属性内联到组件根节点（skyline 不支持 `inherit`） |
| progress | runtime 组件 `fjs-progress`：`value` 0-1、缺省为不定进度、`type="circular"` 转圈 |
| inner-canvas | `canvas type="2d"` |
| 页面根节点的 scroll-view | 页面在 shell 的滚动主体里（有 shell 且路由未声明 `scroll: false`）时编译为普通 view：web / Flutter 上内层滚到头会交给外层、且内层本就没有有界高度，滚动全在外层；skyline 不做滚动接力，内层必须写死高度，超出主体视口的部分永远划不到（tab 页最后一截被挡）。自己管滚动的页面声明 `scroll: false` |
| scroll-view | 追加 `type="list"`（skyline 必需，webview 兼容）与 `enable-flex`——`.fjs-box` 基线让 scroll-view 成为 flex 容器，webview 下不加这个属性会告警；而去掉 flex 的话 webview 的滚动区不计入内容（scrollHeight 等于盒子高度，滚不动） |
| stack / divider / safe-area / position | `view` + 内置 class（`fjs-stack` 等，取值同 web 的 base-css） |
| modal | `fjs-modal` 自定义组件（runtime 提供，`@modal-closed` 同名；底部 sheet，数值同 base-css） |
| **模块 widget 标签**（如 icon-mind） | **由模块包提供**：`fjs.widgets.<tag>.mp` 指向包内四件套，构建拷贝到 `fjs/modules/<包名>/<tag>/` 并写入 usingComponents。构建同样跑模块的 prepare 钩子，生成的每个 `.json` 转成 `fjs/modules/<包名>/data/<file>.js`（CommonJS，组件 `require('../data/icons.json.js')`）。编译器给 widget 补 `fjs-color`：从本 SFC 静态 class / style 推出的继承色（自身优先，再找祖先），可能是 `var(--x)` |

## 事件映射

模板 `@x` 编译为 `bindx="__fjsCall"` + `data-*` 属性，运行时
`adaptEvent(tag, event)` 把 wx 事件对象归一成 fjs 语义载荷后再调
handler（**载荷约定与另外两端一致**，如 switch `@change` 收 `"1"/"0"`、
input 收 `e.detail.value`、tap 无载荷）。内联箭头函数被提取成生成代码，
v-for 作用域变量经 `data-args` 传递。已对账的 tag×event 组合见
`fjs-runtime/src/wx/events.ts`，未列出的走 `e.detail` 透传。

## 模板能力对照

| Vue 写法 | 小程序端 |
|---|---|
| 插值、三元、算术、成员访问 | `{{ }}` 直译 |
| v-if / else-if / else | wx:if / wx:elif / wx:else |
| v-for + :key | wx:for + wx:for-item/index + wx:key；嵌套循环未命名的下标自动取 `__i1`… |
| `n in 3` / `n in rows`（数字） | 字面量展开成 `[1, 2, 3]`；脚本里初值为数字的绑定走 `fjs/fjs.wxs` 的 `list()`——Vue 从 1 数，wx:for 从 0 数 |
| v-for 内依赖 item 的函数调用（`picked.includes(item.id)`） | 生成按下标取值的 computed 表 `__dN[index]`（WXML 不能调用函数，实例级 computed 看不到循环变量） |
| v-show | `hidden` |
| :class 对象/数组/模板字符串 | 编译期内联展开（保留 v-for 作用域） |
| :style 对象/标识符 | 内联展开（数字值经 wxs `unit()` 补 px）；含展开运算符/函数调用的走 `stringifyStyle` computed，v-for 内为按下标取值的 computed 表 |
| 内联事件 handler | 提取为 setup 内生成函数，经 `__fjsCall` 分发；v-for 内经 `data-args` 传**各层下标**，handler 里从响应式列表取回原对象（按值传的是 setData 快照副本，改它不会更新） |
| `requestAnimationFrame` / `cancelAnimationFrame` | 小程序模块包装里这两个名字是 undefined 的遮蔽绑定，编译器给用到的模块补 import，运行时以 16ms 定时器实现 |
| 模板中的函数调用 `{{ f(x) }}` | 提取为 computed |
| v-model（input/textarea） | value + bindinput |
| 默认/具名 slot | slot 直译 |
| **作用域插槽** | ❌ 告警并丢弃 |
| **`let` 绑定的模板更新** | ❌ 用 ref（与 Vue 行为一致） |

## 布局基线的落地方式

`app.wxss` 承载全局布局基线（容器 = column flex + border-box，同 web 的
base-css）。两个 skyline 硬约束决定了它的形态：

1. **skyline 只支持 class 选择器**——`view {}` 这类标签选择器被静默忽略。
   基线因此写在 `.fjs-box` 上，编译器给每个容器标签（view/scroll-view/
   swiper 等，见 wxml.ts CONTAINER_TAGS）统一打这个 class。
2. **百分比高度链在 skyline 不可靠**——`page` 用 `100vh` 显式定高（官方
   skyline quickstart 同款），页面 `:host` 用 `flex: 1 1 0%` 从 page 接链。

另外组件 JSON 一律 `"styleIsolation": "apply-shared"`——否则 app.wxss 进
不了组件（默认 isolated），基线同样失效。这三个坑任何一个漏掉，症状都
是"内容全部叠在页面顶部"。

## 已知差异（对齐 css-compat.md 的风格）

- **样式**：WXSS 是真 CSS。scoped 靠「属性选择器→class」改写（skyline
  不匹配属性选择器）；`position: fixed` 受 skyline 限制。
- **无单位数字 / flex-grow**：与 web 共用 `css-compat.ts` 的长度规则（`height: 28` → `28px`，`@media` 条件同理）；`flex-grow: n` 补 `flex-basis: 0%`（Expanded 语义，百分比基数在不定高容器里回退为内容尺寸）。
- **`:active`**：改写为 `.fjs-pressed`，模板里带该 class 的元素加 `hover-class="fjs-pressed" hover-stay-time="60"`；`:hover`/`:focus` 触屏无对应，丢弃并告警。
- **`@media`**：skyline 不求值条件（所有块都生效）。编译期把块 N 的规则主体补 `.fjs-mq-N`，带主体 class 的元素 class 上加 `{{ __fjsMq[N] }}`；运行时用 App 端 CSS 引擎同一个求值器（`css/parser.ts` `mediaMatches`）按窗口尺寸填充，`wx.onWindowResize` 时重算。代价：这些规则比同名基础规则多一个 class 的优先级。横竖屏切换需要 app.json 的 `pageOrientation`（当前未设）。
- **页面路由**：页面在 `onLoad` 里挂载（此时才有 query），`route` 由 setup 最开头的 `__fjsRoute` 提供并立即设为当前路由，页面自己 `useRoute()` 读到的就是本页和本页 query；路由字面量同时作为页面初始 data，先于页面挂载的 shell 首帧即可读到。`onPageSettled` 以首帧渲染（onMounted）后一个宏任务近似——小程序没有转场结束事件。
- **touch 事件**：载荷与另外两端同形（`FjsTouchEvent`：touches / changedTouches / identifier / offsetX 等），原点取 wx 的 `currentTarget.offsetLeft/Top`；`targetTouches` 近似为 touches；`touch-action` 无效，真机上拖拽可能与外层 scroll-view 抢手势。
- **布局基线**：全局默认 flex column + border-box（对齐 Flutter/web 两
  端，因此 app.json 故意**不设** `defaultDisplayBlock`/`defaultContentBox`）。
- **public/**：`public/` 下的图片拷到小程序根目录，`/images/x.png` 这类根绝对路径两端一致。
- **safe-area**：`edges`（与 web / Flutter 同义）限定补哪几边。顶边只在盒子顶边位于状态栏下方之外时补（测量顶边，它不随自身 padding 移动）；未写 `edges` 且顶边已在状态栏下方的是嵌套，全为 0（等价 Flutter SafeArea 对 MediaQuery 的消耗）。底边补 Home 指示条，tab 页不补（原生 tabBar 已占据，沿 owner 链查路由表 `meta.tab`）；按**窗口**底边（`screenTop + windowHeight`）而非屏幕底边算——Android 微信的页面窗口止于系统导航栏上方、那一条由微信自己涂色，内容无法穿过它，也不应再补一次。**底边不测量**：webview 渲染器排版过程中报告的盒子会随自身 padding 与内容增长，测量值曾变成约 600px 的底部内边距，把 shell 的 scroll-view 挤成零高——整页无法点击、`:active` 无效。组件自身不 grow（与另外两端一致），宿主与根节点 `min-height: 0`：webview 遵循 CSS 的 flex 最小内容尺寸，高度链断开时 scroll-view 会长到整页内容高，变成整个窗口滚动。
- **页面根**：shell 模板（无 shell 时为页面模板）的根元素由编译器打 `.fjs-page-root`，撑满页面——对应 web 的 `fjs-page-host > *` 与 Flutter 根节点的 growChildren。hello-fjs 的 NavBar 自带 `safe-area edges="top"`（状态栏区域与导航栏同底色、固定在滚动区外），TabBar 自带 `edges="bottom"`，二级页的底部安全区放在 shell 滚动区内容末尾（内容可滚到指示条下；`scroll: false` 的页面仍在外面留一条）。
- **skyline 限制（已确认，未绕过）**：input 不认 `line-height`，单行输入框比 web 矮约 2px；DevTools 模拟器里 textarea 的 `placeholder-style`/`placeholder-class` 不生效；`text-transform` 不支持；四边颜色不同的 border 会让 `border-radius` 失效（fjs-progress 的圆环因此用裁剪实现）。
- **icon-mind**：skyline 没有内联 SVG，组件把与 web 替身相同的形状（描边粗细、duotone 规则一致）拼成 SVG data URI 交给 `<image>`。image 不继承 `color`、skyline 又读不到计算样式（SelectorQuery 的 computedStyle 为空，`mask-image`/`filter` 也不支持），颜色按 `color` 属性 > `fjs-color` > `#333333` 取；`var()` 由 wx 运行时解析——`:style` 绑定里出现过的 CSS 自定义属性全部登记在一张全局表（`style.ts` `resolveCssColor`，主题切换时通知重绘）。局限：继承色只看模板静态 class，经 `:class` 动态切换或跨组件继承的颜色拿不到。原生 tabBar 不支持 SVG 图标，tab 仍只有文字。
- **canvas**：只映射 `type="2d"`，还没有 fjs canvas API → wx canvas 节点的桥（页面通过模板 ref 拿不到可绘制对象）；DevTools 也不支持 skyline canvas 调试，需真机。webgl 无 skyline 支持。
- **hello-fjs 示例页的开放情况**：开放 percent-spacing、pseudo、responsive、transition、page-settled、async-host、drag、dnd、2048；排除 echarts / f2 / shooter / three-gltf / gltf-viewer / webgl / webgl-instanced（npm 渲染库或 WebGL）、motion / anime（依赖 @vueuse/motion、animejs）、theme（Flutter 管线压测：styleEngine / op sink）、gomoku / tetris（canvas 桥）。
- **fetch**：`@ufjs/runtime/wx` 安装基于 `wx.request` 的 polyfill，文本/
  JSON 响应可用；流式与 blob 不可用。
- **toast / Worker / invokeHostAsync**：`fjs` 模块在 wx 端的 `toast`
  走 `wx.showToast`；`Worker` 抛错（独立 QuickJS 实例不存在）。
- **路由**：push/replace/back 映射 `wx.navigateTo`/`redirectTo`/
  `navigateBack`；栈深受小程序 10 层限制。

## 实现索引

| 文件 | 职责 |
|---|---|
| `packages/fjs/src/mp/wxml.ts` | 模板 AST → WXML + 生成代码提取 |
| `packages/fjs/src/mp/script.ts` | compileScript 产物包装与注入 |
| `packages/fjs/src/mp/css.ts` | WXSS + scoped class 改写 |
| `packages/fjs/src/mp/project.ts` | app.json / project.config 等工程文件 |
| `packages/fjs/src/mp/build.ts` | `--mp` 编排（编译闭包、.ts 发射、模块组件） |
| `packages/fjs-runtime/src/wx/` | vue shim、instance（setData diff）、events、router、fetch |
