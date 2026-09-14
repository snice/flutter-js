# Plan: 小程序 rich-text 按渲染器分流 + JS 管线按需打包

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（Flutter / Web 不动） | Flutter（`packages/flutter_fjs/lib/src/`）与 Web（`packages/fjs-runtime/src/web/`、`packages/fjs-runtime/src/components/rich-text.ts`）**都不改**。本 spec 只改小程序端的编译与打包方式；skyline 下仍跑另两端同一份 `fjs-runtime/src/rich-text/*`。webview 下改用原生 rich-text，做不到一致的地方（默认样式来源、scoped class 命不中内部节点、白名单外标签无告警）登记到 `docs/miniprogram.md` 已知差异 |
| II 边界即契约 | 否 | 三张表（`ui/ops.ts`↔`ui_ops.dart`、`native-global.d.ts`↔`natives.cpp`、`ui/element.ts EventType`↔`fjs.h`）都不动 |
| III 同步单线程零序列化 | 否 | 不涉及 JS↔Dart 边界 |
| IV 外观照 WeUI | 否 | 不改组件默认外观；skyline 默认样式仍来自共享的 `rich-text/defaults.ts` |
| V 静默失效是 bug | 是（破例一处） | skyline 路径的 `warnRichTextOnce`、`user-select` / `mode` 告警不变。**破例**：webview 下原生 rich-text 丢弃 script / iframe 无告警——用户在 spec Q2 确认接受，理由是加告警需要在 wx 侧解析 HTML，与「webview 零管线」冲突；在 `docs/miniprogram.md` 已知差异里明写。构建侧：`wxmp.renderer` 取值不是 webview / skyline 时沿用现有配置校验，不新增静默分支 |
| VI 注释记录权衡 | 是 | `wxml.ts` 的 rich-text 改写处写：为什么按渲染器分（skyline 原生子集 vs webview HTML 排版）；`build.ts` 管线打包处写：为什么独立模块 + 组件 `require`（按需、不经 `runtime.ts` 副作用），以及 `css/parser` 会在两个包里各有一份的代价；`fjs-rich-text.js` 顶部把 `globalThis.__fjsWx` 的说明改为 `require('../rich-text')` |
| VII JS 能包就不要下 Dart | 否（不下 Dart） | 全部是 CLI 与 wx 运行时的 JS 改动 |
| VIII 变更落到文档 | 是 | `docs/miniprogram.md`：第 121 行标签映射表 rich-text 一行改为按渲染器分流；第 195 行「已知差异」rich-text 条目分 skyline / webview 两段，补 webview 的三条差异；产物结构说明（如有列 `fjs/` 目录内容处）补 `fjs/rich-text.js`。`docs/roadmap.md` 不涉及 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/mp/wxml.ts` | `TAG_REWRITE['rich-text']` 不再无条件改写：`ctx.renderer === 'skyline'` 时映射到 `fjs-rich-text`（登记 `usingComponents`，补 `scope` 属性，同现状）；webview 时保留原生 `rich-text` 标签，照常透传 `nodes` / `space` / `user-select` / `bindtap`，仍打 `fjs-rich-text-host` class（块级盒子，与另两端一致），**不**补 `scope`。落点是 `genWxml` 第 1002 行附近的标签映射与第 1163 行的 `fjs-rich-text` 分支 |
| CLI / 构建 | `packages/fjs/src/mp/build.ts` | ① 第 593 行 esbuild：入口不变，`runtime.ts` 不再含管线（由 runtime 侧删除导出实现）；② 新增一次 esbuild：条件为「任一 SFC 的 `usingComponents` 含 `fjs-rich-text`」，入口 `fjs-runtime/src/wx/rich-text.ts`，输出 `miniprogram/fjs/rich-text.js`（`format: 'cjs'`、`target: 'es2018'`、`define: MP_DEFINES`，与 runtime 一致）；③ 第 756 行 `copyRuntimeComponents` 传入「是否用到 rich-text」，未用到时跳过 `fjs-rich-text` / `fjs-rich-node`；④ 第 758–768 行 `page-styles.wxss` 仅在用到时生成 |
| CLI / 构建 | `packages/fjs/src/mp/project.ts` | `copyRuntimeComponents(runtimeDir, miniprogramDir, options?: { skip?: Set<string> })`：跳过指定组件目录；`RUNTIME_COMPONENTS` 表本身不变 |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/index.ts` | 删除 `export { buildWxRichText }`、对应 import 与 `globalThis.__fjsWx.buildWxRichText` 挂载（第 12、13、21–27 行） |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/rich-text.ts` | 不改逻辑；顶部注释补「独立打包为 `fjs/rich-text.js`，由 fjs-rich-text 组件 require，不进 runtime.ts」 |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/components/fjs-rich-text/fjs-rich-text.js` | 顶部 `const { buildWxRichText } = require('../rich-text');`；`build()` 去掉 `globalThis.__fjsWx` 查找与对应 `console.error`；注释同步 |
| Web 适配层 | — | 不改 |
| C++ 引擎 | — | 不改 |
| Dart 宿主 | — | 不改 |
| 测试 | `packages/fjs/test/mp-compiler.test.ts` | 「spec 048」describe 里的 rich-text 用例改为显式 `renderer: 'skyline'`；新增 webview 用例：输出以 `<rich-text class="fjs-rich-text-host box"` 开头、含 `nodes="{{ html }}"` / `space="nbsp"` / `bindtap`、不含 `scope=`、`usingComponents` 无 `fjs-rich-text`；`copyRuntimeComponents` 的 skip 行为单测（临时目录） |
| 文档 | `docs/miniprogram.md` | 见宪法 VIII |

## 3. 方案

### 3.1 编译期分流（wxml.ts）

`genWxml` 已经拿得到 `ctx.renderer`（第 297 行，skyline 手势处理在用），rich-text 的改写在
标签映射一步按渲染器决定。webview 下 `rich-text` 与其它原生标签走同一条透传路径，不需要新代码，
只需让它**不**进入 `TAG_REWRITE` 分支。`fjs-rich-text-host` class 改为按原始标签 `rich-text` 打，
两种渲染器都有。

`user-select` / `mode` 在 webview 下原样透传给原生（原生支持）；skyline 下仍由组件告警。

### 3.2 管线独立打包（build.ts + runtime）

「用没用 rich-text」的判定复用第 762 行已有的 `sfc.usingComponents.has('fjs-rich-text')`
（webview 下它恒为 false，所以 webview 自然不生成管线、不拷组件——分流与按需是同一个判定）。

管线模块产物为 `miniprogram/fjs/rich-text.js`，plain CJS。组件与它同在 `fjs/` 下，
`require('../rich-text')` 路径稳定，无需全局变量。`lazyCodeLoading: 'requiredComponents'`
下组件 JS 只在用到它的页面注入，模块随之按需加载。

依赖图：`wx/rich-text.ts` → `rich-text/{layout,parse,sanitize,spans,entities,warn,defaults}` +
`css/parser`（`parseInlineCss`）+ `wx/css-text`（见下）。不牵 `@vue/reactivity`。

> **实现中修订（2026-09-14）**：plan 原写「`wx/style`（`stringifyStyle`，无依赖）」不成立。
> `wx/style.ts` 有模块状态（`cssVars` 表）且加载时把 `resolveCssColor` / `onCssVarsChange`
> 挂到 `globalThis.__fjsWx`。管线模块若再打一份 `style.ts`，rich-text 页加载时会用
> **空表副本**覆盖全局上的这两个函数，icon-mind 的主题色解析静默失效。
> 改为：把 `joinStyle` / `kebab` / `UNITLESS` 这段纯拼接抽到新文件
> `packages/fjs-runtime/src/wx/css-text.ts`（`styleToCssText`，无状态、无副作用），
> `style.ts` 的 `stringifyStyle` = `styleToCssText` + `recordCssVars`，`wx/rich-text.ts` 只用
> `styleToCssText`。附带行为变化：rich-text 内容里的 `--var` 内联样式不再写进主题变量表
> （原先是无意为之，写进去反而会污染主题表）。
`css/parser` 因 `wx/instance.ts` 的 media query 仍在 `runtime.ts` 里，两个包各一份（174 行），接受。

### 3.3 被否掉的备选

| 备选 | 否掉原因 |
|---|---|
| 管线模块仍挂 `globalThis.__fjsWx`，由 app.js 或页面 import 触发 | 需要在编译产物里额外插入 import 并保证先于组件执行；有 require 这条直路时多一层隐式时序依赖 |
| 管线模块做成 `fjs/rich-text.ts`（沿用 runtime.ts 的 .ts 命名，依赖 DevTools typescript 插件） | runtime.ts 用 .ts 名是为了让编译产物的无扩展名 import 统一解析；组件是 plain JS，`require` 一个 .js 最直接，不依赖编译插件 |
| esbuild code splitting（runtime + rich-text 共享 chunk，消除 css/parser 重复） | 小程序不支持 ESM 动态 import，CJS 下 esbuild 不做 splitting；为 174 行引入手工 chunk 管理不值 |
| webview 下也跑管线，只把结果转成原生 `nodes` 喂给原生 rich-text（spec 048 Q1 的备选） | 与 spec 目标「webview 零管线」相反 |
| 改成通用的「只拷被用到的 runtime 组件」 | 超出本 spec 范围（其它组件如 `fjs-safe-area` 的引用来源不止 SFC 模板，需另行核对）；本次只对两个 rich-text 组件做 skip |

## 4. 风险

- **webview 下原生 rich-text 的盒模型**：原生 rich-text 在 webview 渲染器下默认可能是 inline；
  `fjs-rich-text-host`（flex column）要真的落在原生节点上，DevTools 里核对宽度撑满、与上下兄弟不同行。
- **scoped 样式静默不命中**（spec Q1 已接受）：hello-fjs rich-text 页「scoped class」一块在 webview
  下会显示为无高亮，目验时属预期，不是回归。
- **`require` 路径**：组件在 `fjs/fjs-rich-text/fjs-rich-text.js`，模块在 `fjs/rich-text.js`。
  DevTools「将 JS 编译成 ES5」/ 代码依赖分析若报「未找到模块」会导致 skyline 页白屏——验收第 3 条覆盖。
- **旧产物残留**：已核对 `mpBuild` 开头 `fs.rmSync(outRoot)`（build.ts 第 539 行）会清目录，
  不会残留旧的 `fjs-rich-text/`；验证命令里的 `rm -rf` 只是保险。
- **其它引用 `buildWxRichText` 的地方**：已 grep，`__fjsWx.buildWxRichText` 只有 `fjs-rich-text.js` 一处使用。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test

# skyline（hello-fjs 当前配置）
rm -rf examples/hello-fjs/dist/mp
pnpm --filter hello-fjs run build:mp
wc -l examples/hello-fjs/dist/mp/miniprogram/fjs/runtime.ts          # 约 3100–3200
grep -c layoutRichText examples/hello-fjs/dist/mp/miniprogram/fjs/runtime.ts   # 0
grep -c layoutRichText examples/hello-fjs/dist/mp/miniprogram/fjs/rich-text.js # >0
# DevTools 打开 examples/hello-fjs/dist/mp，逐块核对 comp/rich-text（spec 048 验收）

# webview（临时改 examples/hello-fjs/app.config.ts wxmp.renderer = 'webview'，验完改回）
rm -rf examples/hello-fjs/dist/mp
pnpm --filter hello-fjs run build:mp
grep -c '<rich-text' examples/hello-fjs/dist/mp/miniprogram/pages/comp-rich-text/comp-rich-text.wxml   # >0
ls examples/hello-fjs/dist/mp/miniprogram/fjs/                    # 无 fjs-rich-text / fjs-rich-node / rich-text.js
# DevTools 重开项目（需重开才重编译），核对 comp/rich-text 排版、@tap、切换内容、重新挂载

# 不用 rich-text 的项目
rm -rf demo/dist/mp
pnpm --filter demo exec fjs build --mp
ls demo/dist/mp/miniprogram/fjs/                                  # 同上，无 rich-text 产物
```
