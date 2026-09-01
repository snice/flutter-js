# Vue 3 集成指南

fjs 通过 `@vue/runtime-core` 的 `createRenderer` 把 Vue 3 接到原生渲染：
Vue 只负责组件模型（响应式/组合式 API/模板编译产物），所有节点操作被
翻译为 fjs 的二进制 UI 帧交给 Flutter。

## 快速开始

```bash
pnpm exec fjs create my-app
cd my-app
pnpm install
pnpm run dev:web
```

`src/main.ts`：

```ts
import { createFjsApp } from 'fjs/app';
import { routes } from 'fjs/pages';
import Shell from './Shell.vue';

createFjsApp({
  routes,
  shell: Shell,
}).mount();
```

`createFjsApp` 会按 `src/pages` 生成的路由表创建 Flutter 原生页面；Web 构建时
同一入口会被 alias 到 vue-router + DOM 适配层。`ref/computed/watch` 等组合式
API 照常从 `vue` 导入。

跑到 App：

```bash
pnpm run run:android
pnpm run run:ios
```

发布构建：

```bash
pnpm run build:release
pnpm run build:apk
```

`examples/hello-fjs` 是更完整的 Vue3 组件画廊，可作为组件和路由写法参考。

## SFC 支持

`<script setup lang="ts">` + `<template>` 完整支持（见
examples/hello-fjs/src/pages/index.vue）。

### `<style>` / `<style scoped>`

style 块完整支持（v1.1 起）。构建时 fjs 的 esbuild 插件把每个 style 块
原样注入运行时样式引擎；scoped 块通过组件 `__scopeId`（`data-v-<hash>`）
与元素关联，class 属性也由渲染器接管（Vue 会把静态/动态 class 归一化成
字符串传入）。

```vue
<template>
  <div class="row">
    <span :class="['chg', changePct > 0 ? 'up' : 'down']">{{ changePct }}%</span>
  </div>
</template>

<style scoped>
.row { flex-direction: row; align-items: center; margin: 2px;
       font-size: 14px; } /* fontSize/color 会继承给子 span */
.chg { flex-grow: 1; color: #555; }
.chg.up { color: #2e7d32; }         /* 复合选择器优先级更高 */
.toolbar button { margin: 4px; }     /* 标签选择器仅匹配本组件元素 */
.wrapper :deep(.child) { color: red } /* 穿透子组件边界 */
</style>
```

**选择器范围（基础集）**：类/标签/`*`、后代（空格）与子代（`>`）组合器、
`:deep(...)` / `::v-deep(...)` / `:global(...)`，以及写在最后一个复合选择器上的
`:active`。属性选择器、其他伪类（`:hover` 等）、id 选择器、at-rule（`@media`
等）会被跳过并告警。

**`:active`（按压态）**：

```css
.row { background-color: #fff; }
.row:active { background-color: #eef4ff; }   /* 按下时 */
```

命中 `:active` 的元素会额外算出一份「按下时」的完整样式，随 `activeStyle` 一起
下发；Flutter 侧由该节点自己的按下状态就地切换，不回 JS，按下到上屏就是一帧。
按压态完全由原始指针事件驱动，不走手势识别器：`onTapDown` 要等赢下竞技场（列表
里是 100ms 之后，快速点击则根本等不到），而 `onTapCancel` 会在外层滚动容器认领
手势时就触发——鼠标的判定阈值只有 1px，手一抖按压态就没了。现在的规则和浏览器
一致：按下即亮，抬手熄灭，只有指针移动超过拖拽阈值（真的在滚动了）才提前熄灭。
web 侧就是浏览器原生的 `:active`。两点差异：`:active` 只能写在
选择器的最后一个复合选择器上（`.row:active .title` 会被跳过并告警）；按压态只作用于
命中的节点自身，其中的继承属性（如 `color`）在 Flutter 侧不会再向子节点传递
（web 会），所以按压反馈优先用 `background-color` / `opacity` / 边框这类自身属性。

**层叠与继承**：优先级 = specificity + 源顺序（scoped 规则额外 +10，
对齐真实浏览器的 `[data-v]` 属性选择器）；最终合并顺序为
标签默认样式 < 规则 < 内联 `:style`。color/fontSize/fontWeight/
fontStyle/fontFamily/lineHeight/letterSpacing/textAlign/textTransform/
whiteSpace 与 CSS 自定义属性（`--x`）沿元素树向下继承（子元素自身声明
优先）。

### CSS 变量与 `v-bind()`

`<style>` 块里可用原生 CSS 自定义属性与 `var()`（含 fallback、链式引用、
循环引用安全降级）：

```css
.page { --muted: #888888; }
.head { color: var(--muted); }          /* 沿树继承 */
.status { color: var(--missing, #aaa); } /* fallback */
```

`v-bind(expr)` 把 JS 响应式状态直接绑进 CSS（机制与 web 版 Vue 相同：
插件改写为 `var(--<id>-<expr>)`，compileScript 注入的 useCssVars 在
运行时把计算后的自定义属性挂到组件根元素，随依赖变更自动重算）：

```vue
<script setup lang="ts">
const dark = ref(false);
const mutedColor = computed(() => (dark.value ? '#999999' : '#666666'));
</script>

<template>
  <button @click="() => (dark = !dark)">theme</button>
</template>

<style scoped>
.page { --muted: v-bind(mutedColor); }
.head { color: var(--muted); }
</style>
```

`lang="scss"` 等需要预处理器的块会被跳过（告警）。

## 可用能力（已验证）

- `ref` / `computed` / `reactive`
- `v-for`（含 :key diff 增量更新）
- `v-if`（锚点实现为空文本节点，不渲染可见内容）
- 事件：`@tap` / `@text-changed` / `@submit`（或 `:on-tap="fn"`）
- 动态 style 对象（`:style="{ ... }"`）与 `class` / `:class`
- `<style>` / `<style scoped>`（见上节）
- 模板插值 `{{ }}`、TS 类型检查

## 编辑器提示（VS Code + Vue - Official）

内置标签的 props、事件、插槽都声明在
`packages/fjs-runtime/src/vue-global.d.ts`（`GlobalComponents` 增强）。
要让编辑器读到它们，项目的 `tsconfig.json` 需要两件事：

```jsonc
{
  "compilerOptions": {
    // `@/x` -> `src/x`。构建侧不用配：`fjs build` 的每条流水线和 Vite 的
    // `fjs()` 插件都内置了这个别名，这里只是让 tsc / Volar 也认得。
    "paths": { "@/*": ["./src/*"] }
  },
  "vueCompilerOptions": {
    // text / image / button / input / switch / progress 同时是原生
    // HTML/SVG 标签名。不加这个插件，Volar 会按 @vue/runtime-dom 的
    // IntrinsicElementAttributes 去解析它们，永远看不到 fjs 的类型：
    // 没有属性补全、跳不到 d.ts、事件签名还是 DOM 的。
    "plugins": ["@ufjs/runtime/volar"],
    "strictTemplates": true
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"]
}
```

并在 `src/` 下放两行把类型引进来（见
`examples/hello-fjs/src/fjs-global.d.ts`）：

```ts
/// <reference types="@ufjs/runtime/ambient" />
import '@ufjs/runtime/vue-global';
```

第一行把**所有** `fjs*` specifier 一次带进来：`fjs`、`fjs/app`、`fjs/router`、
`fjs/vue`、`fjs/web`，以及工具链生成的 `fjs/pages`、`fjs/plugins`。这些映射只有
`@ufjs/runtime` 自己能保证正确，所以它以 `src/ambient.d.ts` 的形式随包发布，
升级 runtime 就跟着更新。

因此工程侧**不需要**：

- tsconfig 的 `paths` 里那几条 `fjs*`（只留 `@/*`，那是你自己工程的别名）
- `src/fjs-pages.d.ts`
- `src/fjs-plugins.d.ts`

唯一还需要生成到工程里的是 `src/fjs-routes.d.ts`——路由**名字**是随你的
`src/pages` 变的，只能在你这边生成。

老工程迁移：删掉上面三样，加上这行 reference。留着也不报错（重复的 ambient
声明会有一个静默胜出，内容相同就没影响），只是那几份副本会随版本变旧。

`@ufjs/runtime` 要作为 devDependency 装上，`@ufjs/runtime/volar` 才解析得到。
另外两点：

- 不要写 `declare module '*.vue'` 的 shim。Vue - Official 自己会解析
  `.vue`，shim 只会把组件类型压成 `DefineComponent<{}, {}, any>`。
- 页面文件名和内置标签同名时（`pages/comp/input.vue` 里的 `<input>`），
  Vue 会把它当成**自引用**，属性提示会变空。加一行
  `defineOptions({ name: 'InputPage' })` 即可。

命令行同款检查：项目内执行 `pnpm run typecheck`。仓库示例可以执行
`pnpm --filter hello-fjs typecheck`。

## 不可用 / 注意

- `v-model`：其指令助手面向 DOM（el.addEventListener），不可用。替代：
  `:value="draft" @text-changed="t => draft = t"`
- pinia：可用，已在 QuickJS 上验证。用 `fjs add pinia` 装，它会把实例写在
  `src/plugins/pinia.ts` 的模块作用域里 —— Flutter 上每个页面是独立的 Vue app，
  实例建在函数里会让每页各拿一套 store。见 docs/toolchain.md 的「添加三方库」
- vue-router：不可用，路由走 `fjs/router`（web 构建内部才用 vue-router）
- `vue` 包被 alias 到 `@vue/runtime-core`，避免拉入 DOM 运行时

## 工作原理

1. `flutterRoot()` 创建根元素并插入宿主根容器（id 0）
2. `createRenderer(nodeOps, patchProp)` 的 nodeOps 把 Vue 的
   createElement/insert/remove/setText 映射为 op 写入帧缓冲
3. patchProp 处理事件（函数 → JS 注册表 + `onXxx: true` 标记）与样式
4. 响应式变更 → Vue patch → 微任务 flush → 一次原生调用

渲染器实现：`packages/fjs-runtime/src/vue/renderer.ts`（约 200 行，可作为
接入其它框架（React/自研）的参考模板）。
