# Spec: dev 模式模块级 HMR

- **ID**: 037-dev-module-hmr
- **状态**: done
- **日期**: 2026-09-11

## 1. 要解决什么

`fjs dev` 的热更新今天只有 page chunk 一个粒度（spec 依赖 `__FJS_PAGES`
注册表在重 eval 后被覆盖，router 收到事件 13 后整页 unmount/remount）。
任何落到 page chunk 之外的改动都是**整个 QuickJS VM 销毁重建**
（`engine.dart` `_loadFromDev` → `reset()` → 重新 eval 全部）：

- 改一个被 ≥2 个页面引用的共享组件（`appModuleGraph` 把它归入 shared），
  或改 shell / entry —— 页面栈清空、回到首页、所有页面的输入内容、
  滚动位置、Worker、全局 JS 状态全部丢失；
- dev server 的指纹按构建产物算（`changeMessage()`：bundle / shared /
  page:chunk），不知道动了哪个模块，所以保守地推全量 `reload`；
- esbuild 以 `format: 'iife'` 出单闭包，产物里没有模块边界，
  runtime 里也没有 module registry 可以挂新代码——想热替换也没地方挂。

表现就是：改页面内代码体验尚可，改共享代码 = app 重启。
roadmap「近期计划」第一条，`docs/threading-model.md` 也把「模块级 HMR」
登记为热重载的目标形态。

## 2. 不做什么（Non-goals）

- **组件级状态保留**（Vue SFC 风格的 rerender 单组件、保留 setup 状态）。
  最小重挂边界是**页面**，页面状态随重挂丢失——与现有 `reload pages:`
  行为一致。页面栈位置、其它页面、全局状态保留。
- **release / 字节码路径**：fjsc、`.fjsbundle`、release 资产同步一概不动。
  HMR 只存在于 dev source 模式；字节码模式本来就没有模块边界，也不需要。
- **vite 路径**（`examples/hello-fjs` 的 `dev:web`）不动，它已经是
  @vitejs/plugin-vue 原生 HMR。
- **CSS 独立通道**：`<style>` 内联在模块 JS 里（`__fjsRegisterStyles`），
  模块热替换通道建立后 CSS 随模块走，不另开协议。
- **非 split 的 dev 构建**（无 `--pages` 或无 `src/pages`）维持全量 reload，
  不为它保留模块边界。
- 不新增 C ABI / 事件号：模块热替换复用既有 eval 入口
  （`fjs_vm_eval_source`）与 runtime 内部事件 13 的模式。

## 3. 用户可见的行为

开发者在 `fjs dev`（Flutter 宿主或 fjs-go 连接）下编辑源码：

1. **改某个页面独占的模块**（页面 .vue 及其私有子组件）——行为与今天
   的 `reload pages:` 相同：只有该页重挂，其它一切不动。
2. **改被多个页面引用的共享 app 组件 / 工具模块**——不再重建 VM。
   dev server 找出变更模块及依赖它的模块闭包，设备端在**同一个 VM 里**
   重 eval 这些模块，然后重挂引用它们的已挂载页面。页面栈位置、
   其它页面状态、全局 JS 状态保留。
3. **改 shell / entry / 路由结构 / app.config.ts**——仍然全量 reload
   （VM 重建）。这是兜底语义，任何算不出安全热替换的变更都落在这里。
4. 热替换失败（模块 eval 抛错、fetch 失败）→ 回落全量 reload，
   并在 dev 日志里说明原因，不静默白屏。
5. dev server 终端打印这次变更热替换了什么（模块 → 受影响页面），
   与现有 `reloaded page …` 日志风格一致。

```ts
// src/utils/format.ts —— 被三个页面 import
// 改它：VM 不重建，引用它的三个已挂载页面重挂，其余不动
```

## 4. 两端约定（宪法 I）

dev 推送协议是 CLI（`dev/server.ts`）与两端客户端的契约：

| | App（`dev_client.dart` + `engine.dart`，fjs-go 同路径） | Web（`fjs dev --web` 的 RELOAD_SNIPPET） |
|---|---|---|
| 行为 | 收到模块级消息后在同一 VM 重 eval 受影响模块，重挂受影响页面；失败回落全量 reload | 收到任意变更消息执行 `location.reload()`（浏览器整页刷新本来就快，模块级替换无收益） |
| 消息 | 同一套 WS 文本协议：新增模块级消息；`reload` / `reload pages:` 语义不变 | 同一套协议，仅按消息类型选择 reload 粒度 |
| 已知差异 | 真正的模块级热替换 | web 侧执行上退化为整页 reload，登记进 `docs/web.md`「已知差异」 |

差异理由：web 端没有 QuickJS VM 重建的成本，`location.reload()` 的
开销与热替换同量级；vite 路径（用户自建 vite 工程的 web dev）则已有
组件级 HMR。协议本身两端同源，只是执行策略不同。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）——不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）——不涉及
- [ ] 事件类型（`element.ts` + `fjs.h`）——预计不涉及（复用 runtime
      内部事件 13 的派发模式；若 plan 阶段发现需要新事件号再回来改这里）
- [x] 第四张契约：dev WS 文本协议（`dev/server.ts` ↔ `dev_client.dart`
      ↔ RELOAD_SNIPPET）扩展，三处同步，语义见第 4 节

## 6. 验收标准

1. 单元测试：模块级指纹与受影响闭包计算（esbuild metafile inputs →
   变更模块 → 依赖模块集合），覆盖「页面独占 / 共享 / entry 直达 /
   未知文件」四类输入；`pnpm test` 全绿。
2. `pnpm run typecheck` 全 workspace 通过。
3. `fjs dev` + hello-fjs（或 demo）：改一个页面 .vue，设备端日志无
   `bundle loaded` / VM 重建迹象，仅该页重挂，其它页面状态保留
   （手动验证，与现有 `reload pages:` 行为对齐）。
4. 同一会话改一个被 ≥2 页引用的共享组件：VM 不重建（页面栈不动、
   全局状态保留——可用一个示例页上的全局计数器/Worker 验证），
   引用它的已挂载页面重挂并显示新样式/逻辑。
5. 改 shell / entry / `app.config.ts`：回落全量 reload，行为与今天一致。
6. 热替换期间模块 eval 抛错：日志给出原因，设备回落全量 reload，
   不出现白屏或僵尸状态。
7. 回归：release 链路不受影响——`fjs build`（含 `--bytecode`）产物在
   `fjsrun` 与真机 release 下行为不变（现有测试 + 一次 `fjsrun` 冒烟）。
8. 回归：`fjs dev --web` 行为不变（变更 → 整页 reload）。

## 7. 待澄清

已拍板（2026-09-11，用户未答、按推荐项执行）：

- [x] 页面级重挂丢页面状态**可接受**——与现有 `reload pages:` 一致；
      组件级状态保留是另一个量级的工程，不在本 spec。
- [x] dev **维持现有 split 条件**（`--pages` 且有 `src/pages`），非 split
      保持全量 reload，不为无页面项目引入三文件形态。
