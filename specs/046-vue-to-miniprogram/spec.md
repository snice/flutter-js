# Spec: Vue → 微信小程序编译（Skyline + glass-easel）

- **ID**: 046-vue-to-miniprogram
- **状态**: done（待开发者工具目验 T053）
- **日期**: 2026-09-13

## 1. 要解决什么

仓库目前有两条产物路径：Flutter 宿主（esbuild bundle + JSI）和 Web
（vite/ESM）。第三条是**微信小程序**：同一份 Vue SFC 源码编译为小程序
四件套，渲染引擎用 **Skyline**，组件框架用 **glass-easel**。

关键决策（已与用户确认）：

- **仅做编译转化，不引入 Vue 运行时**。模板编译为 WXML 而非 render
  函数，不打包 `@vue/runtime-core` 的 vdom；响应式由一层薄运行时承担
  （`@vue/reactivity` 的 ref/computed/watch + 快照 diff → setData），
  思路对齐 wevu（vite.weapp.dev/wevu）的"编译期 weapp-vite + 运行期
  wevu"分层。
- **目标形态**对齐微信官方 skyline 模板（参考
  `~/WeChatProjects/miniprogram-1`）：`app.json` 全局
  `"renderer": "skyline"` + `"componentFramework": "glass-easel"` +
  `lazyCodeLoading: requiredComponents`，页面用 `Component()` 构造器注册。
- **MVP 验收范围**：hello-fjs 核心页（index/about/api/fetch + Shell）+
  全部 26 个 `pages/comp/` 组件页 + 若干轻示例页。重型页（echarts、
  three/webgl、gltf、2048/贪吃蛇等游戏）不进 `pages.json`。
- **代码归属**：编译器并入 `@ufjs/cli`（`fjs build --mp`），运行时薄壳
  并入 `@ufjs/runtime` 新入口 `@ufjs/runtime/wx`，不另起独立包。
- **导航形态**：`navigationStyle: "custom"`，每页照常编译 Shell
  （NavBar/TabBar 同源复用），路由映射 `wx.navigateTo` 系 API。

为什么可行：hello-fjs 的标签集本身就对标小程序组件（view/text/image/
scroll-view/swiper/switch/checkbox/radio/slider/progress/form/rich-text/
canvas/web-view 同名同义，skyline 还提供 `list-view`），事件里 93 处
`@tap` 对应 `bindtap`，touch 系列原生对应；全部模板中仅 2 处函数调用
表达式，WXML 表达式直译可行。

## 2. 不做什么（Non-goals）

- **重型 example 页**：canvas webgl / echarts / three / gltf / 游戏 /
  anime / motion 等页面不编译进包（后续 spec）。skyline 的 canvas 不
  支持 webgl，echarts/three 依赖的宿主能力在小程序上需要专门适配层。
- **react-native / 支付宝 / 抖音小程序**：只做微信。
- **HMR / dev server**：`fjs dev --mp` 后置，本 spec 只做 build。
- **字节码**：小程序侧走 es6/CommonJS 产物，不涉及 fjsc。
- **op 协议 / element API / JSI**：零改动。小程序产物不经过这三层，
  `wxml + js` 直接由微信运行。
- **pinia / store 类库**：hello-fjs 不用，不做。
- **`@vue/reactivity` 以外的响应式方案**：不自研响应式内核。

## 3. 用户可见的行为

```bash
cd examples/hello-fjs
pnpm build:mp        # = fjs build --mp
# 用微信开发者工具打开 examples/hello-fjs/dist/mp/
```

- 开发者工具中渲染引擎显示 Skyline，组件框架 glass-easel。
- 首页/组件页正常渲染：模板插值、`:class`/`:style`、v-if/v-for 联动、
  `@tap` 计数、switch/slider/input 等表单双向联动、scoped 样式生效。
- Shell（NavBar + TabBar）在每页出现，TabBar 点按切换页面
  （`wx.switchTab` 语义由自研路由映射），NavBar 返回可用。
- fetch 页通过 `wx.request` 适配层拿到数据。

## 4. 方案要点

### 4.1 编译器（`packages/fjs/src/mp/`）

- **模板 → WXML**（`wxml.ts`）：用 `@vue/compiler-core` 的 parser 拿
  AST，自写 codegen：
  - `{{expr}}` 直译；`v-if/else-if/else` → `wx:if/wx:elif/wx:else`；
    `v-for` → `wx:for` + `wx:for-item/index` + `wx:key`；`v-show` →
    `hidden`。
  - `:prop="expr"` → `prop="{{expr}}"`；`class`/`style` 的数组/对象
    语法编译期展开为字符串表达式（wxml 不支持 class 数组合并）。
  - 事件 `@x` → `bindx="handler"`；**内联箭头/语句 handler** 提取为
    编译生成的 methods（`__ev0` 等），实参经事件适配层归一。
  - 模板中不支持的表达式（函数调用）提取为实例 data 字段。
- **脚本 → Component**（`script.ts`）：`compileScript` 产物（setup 函数
  形态）包装成 `createWevuPage/createWevuComponent` 调用；`vue` import
  通过 esbuild alias 指到 `@ufjs/runtime/wx`。
- **样式 → WXSS**（`css.ts`）：compileStyle 输出 + scoped 属性选择器
  `[data-v-x]` → class 选择器改写（wxml 端给元素补挂该 class）。
- **工程文件**（`project.ts`）：app.json（pages 顺序来自 `<route>`
  frontmatter 扫描、window、skyline rendererOptions、glass-easel、
  lazyCodeLoading）、app.js/app.wxss/sitemap.json/project.config.json/
  每页 json（`navigationStyle: custom` + usingComponents）。

### 4.2 运行时薄壳（`@ufjs-runtime` 新入口 `src/wx/`）

- **vue shim**：re-export `@vue/reactivity`（ref/computed/reactive/
  watch/watchEffect/nextTick）+ defineComponent/生命周期注册函数
  （onMounted→attached+ready、onUnmounted→detached，页面级 onLoad/
  onShow/onHide）。
- **createWevuComponent/Page**：setup() 运行 → 收集暴露的绑定 →
  reactivity effect 生成数据快照 → diff → 微任务批 `setData`（只送
  变化路径）。
- **事件适配表**：wx event → fjs 语义载荷（tag × event 维度，如 switch
  `@change` → `"1"/"0"`、input/slider → `e.detail.value`），映射表记
  文档，遵守"事件载荷一律是字符串"的仓库约定。
- **router wx 实现**：push/replace/back/switchTab → wx.navigateTo/
  redirectTo/navigateBack/switchTab。
- **fjs 特有组件 mp 实现**：divider/safe-area/position/stack 编译期
  降级 view + class；modal/toast → `@ufjs/runtime/wx` 提供的自定义
  组件（wxml + js）。
- **fetch → wx.request** 适配（v1 ABI 约束不适用此端，直接给 fetch 页
  用到的 API 面）。

### 4.3 标签映射表（编译期）

| fjs 标签 | 小程序端处理 |
|---|---|
| view/text/image/scroll-view/swiper/swiper-item/button/input/textarea/switch/checkbox(-group)/radio(-group)/slider/progress/label/form/rich-text/canvas/web-view/picker(-view/-column) | 同名直出（个别属性名对账） |
| list-view | skyline `list-view` 直出 |
| stack | `view` + `position: relative` 容器 class |
| divider/safe-area/position | `view` + 内置 class（runtime wxss 提供默认样式） |
| modal/toast | `fjs-modal`/`fjs-toast` 自定义组件（runtime 提供） |
| inner-canvas | `canvas type="2d"` |

## 5. 风险

- **事件语义对账**：fjs 事件载荷与 wx event 结构差异逐 tag 核对，按
  comp/ 页面驱动，映射表沉淀进文档，漏一个表现为回调拿到 undefined。
- **skyline 差异**：不支持 webgl、部分 CSS 特性（如 `position: fixed`
  受限）；组件页以 flex 布局为主，预期影响小。
- **glass-easel 页面必须 `Component()` 构造器**，生命周期的挂接与
  `Page()` 不同，参照 miniprogram-1 模板。
- **模板表达式提取**是编译器最易错处，用单测覆盖（hello-fjs 现存模板
  仅 2 处函数调用，风险可控）。

## 6. 验收标准

1. `fjs build --mp` 在 hello-fjs 上产出完整 `dist/mp/`（app.json 含
   skyline 配置、全部编译页四件套、project.config.json）。
2. 微信开发者工具打开 `dist/mp/`：Skyline + glass-easel 生效，核心页 +
   26 个组件页可渲染、可交互（tap 计数、表单联动、v-if/v-for、路由
   跳转/返回、TabBar 切换）。
3. 编译器与运行时有 vitest 单测：WXML codegen（指令/绑定/事件/内联
   handler 提取）、快照 diff、事件适配表。
4. `pnpm run typecheck` 与 `pnpm test` 通过；既有 Flutter/Web 路径
   零改动（bundle 产物 diff 与本 spec 无关的文件为空）。
