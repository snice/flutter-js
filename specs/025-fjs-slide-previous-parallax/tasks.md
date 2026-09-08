# Tasks: fjs-slide 手势返回时上一页要视差跟随

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认本需求不修改 UI op / natives / 事件类型契约：`packages/fjs-runtime/src/ui/ops.ts`、`packages/flutter_fjs/lib/src/ui_ops.dart`、`packages/fjs-runtime/src/ui/element.ts`、`packages/flutter_fjs/native/include/fjs.h`

## 实现

- [x] T010 `_FjsCupertinoPageRoute` 覆盖 `delegatedTransition`，返回 `CupertinoPageTransition.delegatedTransition`。注释写明 mixin 不提供该 getter、漏了则 Material 基页 `canTransitionTo` 为 false：`packages/flutter_fjs/lib/src/fjs_app.dart`

## 两端对齐

- [x] T020 核对 Web 的 `fjs-slide` 离开/返回位移无需改动：`packages/fjs-runtime/src/web/base-css.ts`（`.fjs-slide-leave-to` / `data-nav="pop"`）
- [x] T021 对拍：Flutter 底页委托转场 ≈ web `-30%`；时长差异（500ms vs 280ms）保持现有、不在本需求统一

## 测试

- [x] T030 改 `fjs-slide uses Flutter iOS defaults`：push 中途断言 `home` 中心相对 push 前向左移，`page-1` 仍在右侧；删掉「不断言离开页视差」注释：`packages/flutter_fjs/test/nav_router_test.dart`
- [x] T031 同一用例 pop 中途断言 `home` 相对被盖住时的位置向右跟回：`packages/flutter_fjs/test/nav_router_test.dart`
- [x] T032 新断言写在现有 `if (lib == null) return;` 之后，不新开测试文件：`packages/flutter_fjs/test/nav_router_test.dart`

## 文档

- [x] T040 `docs/routing.md` 的 `fjs-slide` 说明补一句：Flutter 底页靠 Cupertino `delegatedTransition`
- [x] T041 核对 `docs/roadmap.md`：宿主 bugfix，若无需公开完成项则在本文件记「不改 roadmap」

不改 `docs/roadmap.md`：没有新的面向用户能力或发布项。

## 验收

- [x] T050 `cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart` — 无 error（既有 `onPop` deprecated info）
- [x] T051 `cd packages/flutter_fjs && flutter test test/nav_router_test.dart` — 14 passed
- [x] T052 `pnpm --filter @ufjs/runtime exec vitest run test/web-transition.test.ts` — 10 passed
- [x] T053 spec.md 第 6 节逐条核对：1–3、5 已在本会话验证。第 4 条 iOS 模拟器手势跟手本会话未上设备
