# Tasks: Vue → 微信小程序编译

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 运行时薄壳（`@ufjs/runtime/wx`）

- [x] T010 `src/wx/vue.ts`：vue shim——re-export @vue/reactivity +
  defineComponent + 生命周期注册器（onMounted/onUnmounted/onLoad/
  onShow/onHide 等），currentInstance 上下文；`nextTick`/`watchEffect`
  本地实现（reactivity 包不含这两个导出）。
- [x] T011 `src/wx/instance.ts`：`createWevuComponent`——setup 收集绑定、
  `__fjsData` 收窄数据键、快照 diff → 微任务批 setData、生命周期映射
  （attached/ready/detached/pageLifetimes，isPage 时 onLoad/onShow/
  onReady/onHide/onUnload 挂 methods）。
- [x] T012 `src/wx/events.ts`：事件适配表 `adaptEvent(tag, event)`，
  覆盖 comp/ 页面用到的 tag × event 组合 + tag 级别名（swiper
  page-changed→change、input submit→confirm）。
- [x] T013 `src/wx/router.ts`：push/replace/back/go → wx 路由 API，
  路由表编译期注入（registerRoutes），useRoute 返回活动页 location。
- [x] T014 `src/wx/fetch.ts`：wx.request 适配 fetch API 面（模块加载即
  安装全局 polyfill）。
- [x] T015 `src/wx/components/`：fjs-modal/icon-mind 组件四件套；
  divider/safe-area/position/stack 降级样式（`src/mp/css.ts` 内置，
  取值同 web base-css）。
- [x] T016 `package.json` exports 加 `./wx`；vitest 单测 13 条：快照
  diff、事件适配、生命周期挂接、样式辅助（test/wx-instance.test.ts）。

## 编译器（`@ufjs/cli`）

- [x] T020 `src/mp/wxml.ts`：模板 AST → WXML——wx:if/elif/else 链、
  wx:for/key、v-show、slot、静态/动态 attr、:class/:style 内联展开
  （对象/数组/模板字符串，保留 v-for 作用域）、表达式函数调用提取、
  事件 + 内联 handler 提取（payload-first 签名、data-args 传作用域
  变量）、标签映射表、scope class 合并。
- [x] T021 `src/mp/script.ts`：compileScript 产物 → createWevuComponent
  调用源码；生成代码注入绕开 `let` 绑定的 accessor 形态 __returned__。
- [x] T022 `src/mp/css.ts`：wxss 生成 + `[data-v-x]`→`.data-v-x` 改写 +
  内置降级样式；skyline 不支持的 CSS 告警。
- [x] T023 `src/mp/project.ts`：app.json（pages/skyline/glass-easel/
  lazyCodeLoading/custom nav）/app.js/app.wxss/sitemap/project.config/
  页面 json 生成、runtime 组件拷贝。
- [x] T024 `src/mp/build.ts` + `cli.ts`：`fjs build --mp`——页面扫描 +
  `fjs.mp.exclude`、SFC 依赖闭包编译、**.ts 源码发射**（对齐官方 TS
  模板：不打包应用代码，import 重写到发射位置，DevTools TS 插件编译；
  vendor 仅 fjs/runtime.ts 一个 CJS 包；单实例靠微信模块缓存，早期版本的
  globalThis 注册表已删）、静态图片拷贝、工程文件落盘。
- [x] T025 vitest 单测 22 条（test/mp-compiler.test.ts）：wxml codegen
  （指令/绑定/事件/内联 handler/标签映射/表达式改写）、script 注入
  （accessor 回归）、css 改写。

## hello-fjs 接入

- [x] T030 `build:mp` script + `fjs.mp.exclude`（example/ 与 canvas、
  rich-text、picker-view、web-view、refresh、form、position 等首版
  不适配页）+ `fjs.mp.shared`（theme.ts、catalog.ts）。
- [x] T031 编译跑通核心页（Shell/index/about/api/fetch）+ 组件页；
  产物检查：wxml 指令/绑定/事件、共享 require 链、scoped wxss、
  图片资源。
- [x] T032 轻示例页纳入编译（transition/percent-spacing/pseudo 等
  跟随默认扫描；no source changes needed）。

## 文档

- [x] T040 `docs/miniprogram.md`：定位/用法/标签与事件映射表/模板能力
  对照/已知差异/实现索引。
- [x] T041 `docs/README.md`、`AGENTS.md` 仓库地图与文档地图补条目；
  `docs/roadmap.md` 中期登记第一版落地与待续项。

## 验收

- [x] T033 会话反馈①：icon-mind 从 runtime 内置 stub 改为**模块包提供**
  ——模块清单 `fjs.widgets.<tag>.mp` 声明小程序四件套（modules.ts 解析 +
  存在性校验），`fjs build --mp` 拷贝到 `fjs/modules/<包名>/<tag>/` 并写
  usingComponents；`@ufjs/iconmind` 包内新增 `mp/icon-mind/`，runtime 的
  `src/wx/components/icon-mind/` 删除（fjs-modal 是 fjs 内置标签，仍在
  runtime）。
- [x] T035 会话反馈③：**页面即页面**——去掉 wrapper 中转，路由 SFC
  直接注册为小程序页面（`isPage: true`，`createShellPage` 删除），页面
  wxml = `<shell :route>` 包裹页面自身元素，shell/页面组件合并不再需要
  components/ 里的页面副本；route location 由编译器注入 setup（onLoad
  同步 query）；instance.ts 挂载改为幂等（页面 root 既是组件又是页面）。
- [x] T034 会话反馈②：`app.config.ts` 支持 `wxmp: { appid }`（AppConfig
  + 校验 wx+16hex），mp 构建写入 project.config.json；优先级 app.config
  > package.json `fjs.mp.appid` > touristappid；config.test 加 2 条。
- [x] T050 `pnpm run typecheck` 全 workspace 通过。
- [x] T051 `pnpm test` 通过（runtime 430 + cli 122 + webgl 29 +
  webview 36；含 wx 运行时 13 + 编译器 22 条新测试）。
- [x] T052 产物结构断言：app.json 页面清单、每页四件套齐全、
  skyline/glass-easel 配置正确；全部 js 可解析（node new Function 冒烟）。
- [x] T036 开发者工具验证反馈：WXML 表达式不支持模板字符串——新增
  convertTemplateLiterals 通用于所有进入 {{}} 的表达式（:attr/插值/
  wx:if/for），含嵌套反引号与转义；v-for 作用域内的模板串保持 wxml
  原文拼接（实例级 computed 看不到 item/index），纯 setup 绑定仍提取
  computed；:key 的动态表达式维持"告警 + 省略"。编译器测试 +3。
- [x] T037 开发者工具验证反馈②：`module 'components/nav-bar/nav-bar.js'
  is not defined`——lazyCodeLoading: requiredComponents 下组件入口 js 由
  框架按 usingComponents 懒注入，组件间顶层 require 必然先于注入执行。
  发射器把 .vue import 重写为 `const X = null`（组件间零 js 引用，标签
  接线只走 usingComponents；uni-app/wevu 同款做法），资源 import 改为
  原始字面量常量；rewriteImports 导出并补 1 条回归测试。
- [x] T038 开发者工具验证反馈③：appendChild(invalid Node) 疑因 slot 直接
  作为 skyline scroll-view type=list 的子节点（list 容器要求元素子节点，
  片段型 slot 在 attachView 时产生非法节点）——编译期为 scroll-view 下的
  slot 包 `view.fjs-scroll-inner`（uni-app 同款内容包裹层）；wxss 产物
  剥离 :active/:hover 等 skyline 拒绝的伪类规则（此前只告警）。
- [x] T039 开发者工具验证反馈④：appendChild 错误在 slot 包裹后仍存在，
  转向页面根组件 virtualHost——isPage 不再 virtualHost（页面保留宿主
  节点，:host 撑满维持 flex 链；官方 skyline 页面从不 virtualHost）；
  app.json 开 mergeVirtualHostAttributes（virtualHost 组件的 class/style
  合并）；顺带修完 escapeLtInStrings——表达式字符串字面量内的 < > 转
  \u003c/\u003e（{{ '</>' }} 的 WXML 扫描器地雷，@vue/compiler 同款）。
- [x] T040 目验反馈⑤（首屏渲染通后的布局塌陷 + tabBar）：
  ① 组件 JSON 补 `"styleIsolation": "apply-shared"`——app.wxss 的布局
  基线此前进不了组件（默认 isolated），组件内部全部塌 inline（TabBar
  顶到页首、内容 0 高，参考模板的 navigation-bar 即此写法）；
  ② **决策修订（原"保留 Shell 自绘"）**：底部 tab 改用原生 tabBar——
  app.json 从 `<route>` tab 元数据生成（纯文字 list + 配色），路由对
  tab 页映射 wx.switchTab（不携带 query），`fjs.mp.excludeComponents`
  剥离自绘 TabBar（hello-fjs 剥 @/components/TabBar.vue；Flutter/Web
  照常用它，源码同源不变）。appJson/componentJson 补 2 条单测。
- [x] T041 目验反馈⑥（WebView 模式渲染通后）：① WXML 文本节点不解码
  实体、表达式字符串不处理 \\u 转义（&lt;/\\u003c 均原样渲染）——改为
  实体解码 + 含 </> 的文本包 {{ '...' }} 插值、表达式字符串原样直出、
  属性只转义引号（&& 保持原样）；② scroll-view 补 scroll-y 默认注入
  （WebView 必需，显式 scroll-x/y 时不加）——修页面无法滚动；③ 真修复
  安全区域：降级标签（safe-area/divider/stack/position）的内置 class
  只进了 wxss 没上元素——resolveTag 返回 downcastCls，genAttrs 统一组装
  class（downcast + 静态 + :class + scope）；④ 删除 app.json 的
  mergeVirtualHostAttributes（当前基础库报"无效"）。
- [x] T042 目验反馈⑦：① 同元素多事件（image @load+@error）共享
  dataset，data-fn/data-tag/data-ev 重复且 handler 全部塌到最后一个——
  重构为事件收集器：每元素一个 data-tag + 单事件直挂 data-fn、多事件
  生成按 e.type 分发的 dispatcher；运行时 fjsCall 改用 e.type 取事件名
  （data-ev 删除），events.ts 适配表键改 wx 原生 type 拼写
  （columnchange/linechange/pickstart/pickend）；② 数组 :class 分段值
  被外层再包一层 {{ }} 造成嵌套花括号（fetch.wxml Fatal: unexpected
  character）——class 组装改为分段模型（文本段内联、表达式段各自
  {{ }}），compiler 测试 +1（多事件 dispatcher）。
- [x] T043 目验反馈⑧（样式对齐 web/app）：① WXML 保留空白——文本/插值
  子节点此前逐个独立行（缩进换行在 <text> 里是真换行，<list-view> 竖排
  三行）——连续文本/插值 run 合并为一行（空白 condense：两端 trim、内部
  折叠单空格），含插值的 run 发单个拼接表达式 {{ 'a' + (x) + 'b' }}；
  ② safe-area 从 env() 降级 view 改为运行时组件 fjs-safe-area（读
  wx.getWindowInfo 的 statusBarHeight/safeArea 内联 padding——DevTools
  WebView 模拟器 env 不可靠），四件套进 runtime，DOWNCAST 表移除；
  events 适配表运行时组件集合同步。
- [x] T044 会话反馈⑨：`wxmp.renderer`（'webview' | 'skyline'，默认
  webview）——app.config 校验非法值；webview 时 app.json 不含
  renderer/rendererOptions.skyline、project.config 的 skylineRenderEnable
  为 false；'skyline' 时三者齐全。公开 d.ts 同步；config/appJson 测试 +2。
- [x] T045 `fjs dev --mp`：watch src/ + package.json/app.config.*，
  变化防抖后全量重发 dist/mp（~100ms，无 HTTP 服务——DevTools 自身监听
  产物热编译，compileHotReLoad）；recursive watch 不支持时回退逐目录
  监听；hello-fjs 加 dev:mp script；cli usage 补条目。
- [x] T046 目验反馈⑩（skyline 渲染塌陷定位）：**skyline 只支持 class
  选择器**，app.wxss 里 view{} 形式的布局基线被静默忽略 → 全部元素失去
  flex 列布局叠在顶部（WebView 正常、skyline 全塌的分叉根因）。基线改为
  .fjs-box class，编译期按 CONTAINER_TAGS 给容器标签统一打上（双渲染器
  同一来源）；page 定高改 100vh（skyline 百分比高度链不可靠，官方
  quickstart 同款），页面 :host 改 flex: 1 1 0% 从 page 接链。
- [x] T047 目验反馈⑪（skyline 仍不显示）：官方 WXSS 文档核对——①skyline
  其实支持标签选择器（遵循样式隔离，rendererOptions.skyline 可加
  tagNameStyleIsolation: legacy 对齐 webview），fjs-box 方案仍有效但
  此前"只支持 class"的表述修正；②**百分比不在 skyline <length> 支持
  列表**——清掉运行时 CSS 的 %（:host 的 width:100%/flex-basis 0%、
  fjs-scroll-inner 的 width:100%）；③:host 支持状态文档未列出——页面
  不再依赖 :host，wxml 包 view.fjs-page-host（flex-basis 0px 接链，
  APP_WXSS 提供）；④rendererOptions.skyline 对齐官方 quickstart：
  defaultDisplayBlock/defaultContentBox/tagNameStyleIsolation: legacy。
- [x] T048 目验反馈⑫：资源常量改动后 writeAssets 误用带引号的字面量当
  文件路径，产物出现名为 " 的目录且 DevTools 报 ENOENT——assets 表存
  裸路径（兼作拷贝目标），仅发射的 import 目标为带引号字面量。
- [x] T049 会话反馈⑬：skyline 下 scroll-view 无确定高度渲染为空——
  写入编译器强制检查：static style / :style 字面量 / 本 SFC 的 class
  规则（heightClasses 集）三路任一含 height 即可，缺失直接构建报错
  （含模板行列号与修复建议）。hello-fjs 补齐：index.vue（用户已加
  .page 100vh）、example/fetch .page 100vh、Shell .body height 0px +
  flex-grow（0 基数 grow，三端行为一致）。编译器测试 +2。
- [x] T050 会话反馈⑭：mp 日志接入 terminal/colors——`[fjs/mp]` 警告黄色
  （wxml/css/build 共 17 处，含多行模板串形式）、错误红色（cli 顶层
  catch、mp dev 重建失败）；TTY 检测沿用 shouldColor（FORCE_COLOR/
  NO_COLOR 尊重），非 TTY 纯文本。
- [ ] T053 用户在微信开发者工具打开 `dist/mp/` 目验：Skyline + glass
  easel 生效，核心页 + 组件页渲染/交互/路由/TabBar 正常。
