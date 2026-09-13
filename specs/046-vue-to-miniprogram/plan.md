# Plan: Vue → 微信小程序编译

对应 spec：`./spec.md`。改动集中在 `@ufjs/cli`（编译器）与
`@ufjs/runtime`（wx 薄壳），外加 hello-fjs 接入与文档。

## 层次与顺序

### 1. 运行时薄壳（先做，编译产物依赖它）

`packages/fjs-runtime/src/wx/`（新目录）+ `package.json` exports 加
`./wx`。

- `vue.ts`：vue shim。re-export `@vue/reactivity` 的
  ref/shallowRef/computed/reactive/watch/watchEffect/nextTick/unref/
  isRef/toRefs；defineComponent（原样透传对象）；生命周期注册器
  onMounted/onUnmounted/onLoad/onShow/onHide——靠当前实例上下文
  （全局 currentInstance 栈）收集回调数组。
- `instance.ts`：`createWevuComponent(options)`：
  - 把 `setup(ctx)` 在 attached 前运行一次（页面在 onLoad，组件在
    attached），返回值收集 refs/computed/函数。
  - 模板数据 = 暴露的 ref/computed 解包值；effect 触发 → 微任务批
    → 快照 diff（递归比较）→ `this.setData(patch)`。
  - methods：组件配置里的 methods 与编译器生成的 `__ev*` 都挂到
    Component methods；事件 handler 收到的 wx 事件先过
    `adaptEvent(tag, event)` 再调用。
  - 生命周期映射：attached→（页面 onLoad 语义）+ onMounted 队列；
    ready→onMounted 兜底；detached→onUnmounted；pageLifetimes show/
    hide→onShow/onHide。
- `events.ts`：`adaptEvent(tag, eventName, e)` 映射表（§4.1 spec）。
- `router.ts`：`fjs/router` 的 wx 实现——pages 表（编译期注入）、
  push→navigateTo、replace→redirectTo、back→navigateBack、
  switchTab 语义（hello-fjs TabBar 用）。
- `fetch.ts`：wx.request 适配 fetch 页用到的 API 面（json 文本请求）。
- `components/`：`fjs-modal`、`fjs-toast` 的小程序自定义组件
  （wxml/wxss/js/json 四件套，构建时拷贝到产物 `fjs/` 目录）。

### 2. 编译器（`packages/fjs/src/mp/`）

- `wxml.ts`：`genWxml(templateAst, scopeId)` → `{ wxml, inlineMethods,
  dataExtras }`。核心：
  - 指令转换（wx:if/wx:elif/wx:else/wx:for/wx:key/v-show/插槽 slot）。
  - 绑定转换：静态 attr 直出；`:x` → `x="{{expr}}"`；class/style
    数组/对象语法展开；表达式扫描发现函数调用 → 提取 dataExtras。
  - 事件：修饰符（.stop→catchtap，其余忽略并 warn）；内联函数体 →
    `__ev<N>` 方法名 + inlineMethods 返回方法源码。
  - fjs 标签映射（spec §4.3 表），modal/toast → `fjs-modal`/`fjs-toast`。
- `script.ts`：`genScript(descriptor)` —— compileScript 得到的 setup
  内容 + 组件名 + props/emits → `createWevuPage({...})` /
  `createWevuComponent({...})` 调用源码。
- `css.ts`：compileStyle 输出 → wxss；`[data-v-x]` → `.data-v-x`
  改写；fjs 扩展键 warn。
- `project.ts`：app.json / app.js / app.wxss / sitemap.json /
  project.config.json / 每页 `.json` 生成。
- `build.ts`：`fjs build --mp` 主流程：
  1. 扫描 `src/pages/**/*.vue`（复用 CLI 现有 pages 扫描 + `<route>`
     frontmatter 解析）+ 排除清单（`fjs.mp.exclude` / 默认排除重型页）。
  2. 递归编译页面与本地组件依赖（import 的 .vue → usingComponents）。
  3. esbuild 打每页/每组件的 js（alias `vue`→`@ufjs/runtime/wx`，
     external `@ufjs/runtime`，CommonJS，es2018，关闭 minify 便于
     排查；小程序 `lazyCodeLoading` 下每页独立）。
  4. 拷贝 runtime wx 组件四件套 + 写工程文件。
- `cli.ts`：build 子命令接 `--mp` flag。

### 3. hello-fjs 接入

- `package.json`：`build:mp` script；`fjs.mp.exclude` 列重型页。
- Shell/TabBar 的路由调用在小程序端可用（router shim 同名 API）。
- 需要小修的页面逐个过（预期：事件参数类型、web 特有 API 用法）。

### 4. 文档

- `docs/miniprogram.md`（新）：定位、用法、标签/事件映射表、已知差异
  （风格照 css-compat.md）。
- `docs/README.md` / `AGENTS.md` 仓库地图补条目；roadmap 打勾。

## 测试策略

- `packages/fjs/test/mp-wxml.spec.ts`：模板 codegen 快照与断言。
- `packages/fjs/test/mp-script-css.spec.ts`：setup 包装、wxss 改写。
- `packages/fjs-runtime/test/wx-*.spec.ts`：快照 diff、事件适配、
  生命周期挂接（mock wx/Component 宿主）。
- 端到端：`fjs build --mp` 产物结构断言（app.json 页面清单、四件套
  齐全）；真机/开发者工具目验由用户执行。

## 依赖

- 新增依赖：无（`@vue/compiler-core`/`compiler-sfc`/`@vue/reactivity`
  已在 workspace 中存在）。
