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
| view/text/image/scroll-view/swiper/swiper-item/button/input/textarea/switch/checkbox(-group)/radio(-group)/slider/progress/label/form/rich-text/picker(-view/-column)/web-view | 同名直出 |
| list-view | skyline `list-view` 直出 |
| inner-canvas | `canvas type="2d"` |
| scroll-view | 追加 `type="list"`（skyline 必需，webview 兼容） |
| stack / divider / safe-area / position | `view` + 内置 class（`fjs-stack` 等，取值同 web 的 base-css） |
| modal | `fjs-modal` 自定义组件（runtime 提供，`@modal-closed` 同名） |
| **模块 widget 标签**（如 icon-mind） | **由模块包提供**：`fjs.widgets.<tag>.mp` 指向包内四件套，构建拷贝到 `fjs/modules/<包名>/<tag>/` 并写入 usingComponents。icon-mind 在 skyline 下首版渲染占位空盒（无 inline SVG），真实绘制待后续 spec |

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
| v-for + :key | wx:for + wx:for-item/index + wx:key |
| v-show | `hidden` |
| :class 对象/数组/模板字符串 | 编译期内联展开（保留 v-for 作用域） |
| :style 对象/标识符 | 内联展开或 `stringifyStyle` computed |
| 内联事件 handler | 提取为 setup 内生成函数，经 `__fjsCall` 分发 |
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
  不匹配属性选择器）；`:active`/`:hover` 不支持（skyline，按 web 语义
  需要按压反馈时用 `hover-class`，当前仅告警）；`position: fixed` 受
  skyline 限制。
- **布局基线**：全局默认 flex column + border-box（对齐 Flutter/web 两
  端，因此 app.json 故意**不设** `defaultDisplayBlock`/`defaultContentBox`）。
- **canvas**：只映射 `type="2d"`；webgl 无 skyline 支持（相应页面在
  exclude 清单里）。
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
