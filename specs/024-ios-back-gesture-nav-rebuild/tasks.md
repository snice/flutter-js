# Tasks: iOS 手势返回被 Navigator.pages 重建打断

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改 UI op / natives / 事件类型契约：`packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/ui/element.ts`、`packages/flutter_fjs/native/include/fjs.h`

## 实现

- [x] T010 去掉 `FjsApp` 对整个 `FjsEngine` 的 `ListenableBuilder`：`initState` / `didUpdateWidget` / `dispose` 订阅引擎；只在 `navStack` 的 key + transition + path 变化时快照并 `setState`。注释写明为什么 UI 帧上连 rebuild 都不能有（`changedExternalState` → `_forceRebuildPage`）：`packages/flutter_fjs/lib/src/fjs_app.dart`
- [x] T011 `build` 把 `List<Page>` 存在 State 里，栈未变则把同一 list 交给 `Navigator`；`FjsPerfOverlay` 放在 listener 过滤之外：`packages/flutter_fjs/lib/src/fjs_app.dart`
- [x] T012 在 nav 模块注释里写明 `notifyListeners` 仍是树和栈的总信号、`FjsApp` 自己过滤；不新增公开 `navListenable`：`packages/flutter_fjs/lib/src/engine.dart`

## 两端对齐

- [x] T020 核对 Web 侧无需改动：iOS 边缘返回不存在，`router.back` / 浏览器后退仍走 vue-router。读 `packages/fjs-runtime/src/router/web.ts`、`packages/fjs-runtime/src/app/web.ts` 确认 pop 语义未被本需求牵动
- [x] T021 对拍：Flutter 手势/命令 pop 仍是 dispose 后 `navPop`（spec 003）；Web 仍是 vue-router 出栈。差异写进 `docs/routing.md`，不登记到 css-compat（不是样式差异）

## 测试

- [x] T030 二级页 push 之后，只触发 UI 帧（`runSource` 改已有节点文本 / `notifyListeners`）再 `pump`：`Navigator.pages` 引用不变，`ModalRoute` 是同一实例：`packages/flutter_fjs/test/nav_router_test.dart`
- [x] T031 命令 pop 动画中途再打一次 UI 帧：离开页文本仍在、未再 `createRoute`、现有「转场结束才 `navPop` / `[nav] unmounted`」断言不回退：`packages/flutter_fjs/test/nav_router_test.dart`
- [x] T032 新用例写在现有 `if (lib == null) return;` 之后，不新开测试文件：`packages/flutter_fjs/test/nav_router_test.dart`

## 文档

- [x] T040 更新 Flutter 路由时序：`pages` 只跟 `navStack`；手势返回中途不卸 JS；把「`onDidRemovePage` 立刻 `navPop`」改成 dispose 后再回派：`docs/routing.md`
- [x] T041 核对 `docs/roadmap.md`：本需求是宿主 bugfix，若无需公开完成项则在本文件记「不改 roadmap」

不改 `docs/roadmap.md`：这是 Navigator 宿主的 bugfix，没有新的面向用户能力或发布项。

## 验收

- [x] T050 `cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart lib/src/engine.dart`（无 error；既有 `NavigatorPopHandler.onPop` deprecated info 未动）
- [x] T051 `cd packages/flutter_fjs && flutter test test/nav_router_test.dart` — 14 passed
- [x] T052 `pnpm --filter @ufjs/runtime test` — 35 files / 275 tests passed
- [x] T053 `pnpm --filter @ufjs/runtime run typecheck` — passed
- [x] T054 spec.md 第 6 节逐条核对：1–3、6 已在本会话验证。第 4、5 条（iOS 模拟器上 tetris / gomoku / 普通详情手势返回）本会话未上模拟器，需在设备上确认
