# Tasks: hello-fjs 增加 PixiJS 示例 —— 消消乐（match-3）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- 无（op 协议 / natives 表 / 事件类型均不动，见 spec 第 5 节）。

## 实现

- [x] T010 `examples/hello-fjs/package.json`：加依赖 `pixi.js@^7.4.3`，
      `fjs.mp.exclude` 加 `example/game/match3`；`pnpm install`
- [x] T011 新建 `examples/hello-fjs/src/pixi/native-shims.ts`：
      条件垫片（navigator / document / globalThis.add(remove)EventListener /
      performance）+ `adoptNativeWebgl2Context(ctx)`；web 上整体 no-op；
      顶部注释记录 plan §3.1 的六条事实来源
- [x] T012 新建 `examples/hello-fjs/src/match3/model.ts`：纯函数棋盘模型
      （初始布局、三消检测、交换、下落/补充步骤、死局检测、重排、
      findMove 提示），显式 rng，不依赖 pixi/Vue
- [x] T013 新建 `examples/hello-fjs/src/pages/example/game/match3.vue`：
      Application 生命周期（webgl2→webgl fallback、bufferRatio、
      asDomCanvas）、触摸 → 格子（tap 选中和拖动换向）、tween 工具、
      状态机 + 连击计分、死局自动重排、keep-alive 停/启 ticker、
      画布外 fjs UI（分数/连击/提示/重开）
- [x] T014 `examples/hello-fjs/README.md` 示例清单补一行

## 两端对齐

- [x] T020 Web 走查：`pnpm --filter hello-fjs run dev:web` 打开 match3 页，
      交换/消除/下落/连击/死局重排可玩，console 无错
- [ ] T021 iOS 模拟器：`pnpm --filter hello-fjs run run:ios`，
      同一页面行为与 web 一致，截图留档（无白屏/黑屏）

## 测试

- [ ] T030 `pnpm --filter hello-fjs run typecheck` 通过
- [x] T031 `pnpm test` 通过（746 全绿，CLI +4）
- [x] T032 `pnpm --filter hello-fjs run build:mp` 通过且产物不含 match3 页（47 页，game 组 5 页无 match3）

## 验收

- [ ] T050 spec.md 第 6 节逐条核对，把真实输出记回本文件
- [ ] T051 spec.md「状态」改 `done`
