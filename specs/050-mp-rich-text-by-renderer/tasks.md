# Tasks: 小程序 rich-text 按渲染器分流 + JS 管线按需打包

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本 spec 不动三张契约表（`ui/ops.ts`↔`ui_ops.dart`、`native-global.d.ts`↔`natives.cpp`、`ui/element.ts EventType`↔`fjs.h`），无需改动，勾掉即可

## 实现

- [x] T010 `rich-text` 只在 skyline 下改写为 `fjs-rich-text`（登记 usingComponents、补 `scope`）；webview 下保留原生 `rich-text` 并透传属性与 `bindtap`；两种渲染器都打 `fjs-rich-text-host` class；在改写处写明按渲染器分流的理由 — `packages/fjs/src/mp/wxml.ts`
- [x] T011 给 `copyRuntimeComponents` 加 `skip` 选项，跳过指定组件目录 — `packages/fjs/src/mp/project.ts`
- [x] T012 构建时按「任一 SFC 用到 `fjs-rich-text`」判定：用到则另跑 esbuild 产出 `miniprogram/fjs/rich-text.js`（入口 `fjs-runtime/src/wx/rich-text.ts`，cjs / es2018 / `MP_DEFINES`）并生成 `page-styles.wxss`；未用到则跳过两个 rich-text 组件与 `page-styles.wxss`；注释写明独立模块 + require 的理由及 `css/parser` 重复的代价 — `packages/fjs/src/mp/build.ts`
- [x] T012a 把 `stringifyStyle` 的纯拼接抽到 `styleToCssText`，`style.ts` 复用它；`wx/rich-text.ts` 改用 `styleToCssText`，不再 import `./style`（避免管线模块带一份有状态的 style.ts 覆盖 `__fjsWx`，见 plan 3.2 修订） — `packages/fjs-runtime/src/wx/css-text.ts`（新增）、`packages/fjs-runtime/src/wx/style.ts`、`packages/fjs-runtime/src/wx/rich-text.ts`
- [x] T013 删除 `buildWxRichText` 的导出、import 与 `globalThis.__fjsWx` 挂载 — `packages/fjs-runtime/src/wx/index.ts`
- [x] T014 顶部注释补「独立打包为 `fjs/rich-text.js`，由 fjs-rich-text 组件 require」 — `packages/fjs-runtime/src/wx/rich-text.ts`
- [x] T015 改为 `require('../rich-text')` 取 `buildWxRichText`，去掉 `__fjsWx` 查找与对应 `console.error`，同步顶部注释 — `packages/fjs-runtime/src/wx/components/fjs-rich-text/fjs-rich-text.js`

## 两端对齐

- [x] T020 核对 Flutter（`packages/flutter_fjs/lib/src/`）与 Web（`packages/fjs-runtime/src/web/`、`packages/fjs-runtime/src/components/rich-text.ts`）无需改动：`git diff --stat` 不含这些路径
- [x] T021 小程序 skyline 与 web（`localhost:5173/#/comp/rich-text`）对照 `comp/rich-text`，结果与 spec 048 验收一致（不得回归）；webview 下与 web 对照，差异只限 spec 第 4 节列出的三条

## 测试

- [x] T030 原 spec 048 rich-text 编译用例显式传 `renderer: 'skyline'`，断言不变 — `packages/fjs/test/mp-compiler.test.ts`
- [x] T031 新增 webview 用例：输出为 `<rich-text class="fjs-rich-text-host …"`，含 `nodes` / `space` / `bindtap`，不含 `scope=`，`usingComponents` 无 `fjs-rich-text` — `packages/fjs/test/mp-compiler.test.ts`
- [x] T032 新增 `copyRuntimeComponents` skip 用例（临时目录，断言被跳过的组件目录不存在、其余存在） — `packages/fjs/test/mp-compiler.test.ts`

## 文档

- [x] T040 标签映射表 rich-text 一行改为按渲染器分流（skyline：`fjs-rich-text` + `fjs/rich-text.js` 按需；webview：原生 rich-text）— `docs/miniprogram.md`
- [x] T041 「已知差异」rich-text 条目拆为 skyline / webview 两段，webview 补：默认样式来自原生、scoped class 命不中内部节点、白名单外标签静默丢弃无告警 — `docs/miniprogram.md`
- [x] T042 `docs/roadmap.md` 小程序小节 spec 048 条目下补一行 spec 050（原判断「无对应条目」有误）

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 spec 第 6 节 2：hello-fjs（skyline）`build:mp` 后 `runtime.ts` 无 `layoutRichText`、`fjs/rich-text.js` 含 `layoutRichText`、行数较 4215 少约 1000
- [x] T053 spec 第 6 节 3：用户在微信开发者工具（skyline）目验 `comp/rich-text`，spec 048 rich-text 各项仍成立
- [x] T054 spec 第 6 节 4：hello-fjs 临时切 `renderer: 'webview'` 构建，产物 wxml 为原生 `<rich-text`、无两个组件目录与管线模块；用户 DevTools 目验排版 / @tap / 切换内容 / 重新挂载；验完把 `examples/hello-fjs/app.config.ts` 改回 skyline
- [x] T055 spec 第 6 节 5：~~`demo`~~ demo 的 mp 构建本就因 `pinia` 裸 import 中途退出（与本 spec 无关），改为 hello-fjs 临时把 `comp/rich-text` 加入 `fjs.mp.exclude` 后 skyline 构建：无 `fjs/rich-text.js`、无两个 rich-text 组件目录；验完还原 `package.json`
- [x] T056 spec 第 6 节 6：`docs/miniprogram.md` 已更新（T040、T041）
