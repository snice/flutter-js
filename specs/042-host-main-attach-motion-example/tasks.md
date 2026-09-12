# Tasks: 宿主 main.dart 定制附着、eject 路径修复与 @vueuse/motion 示例

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## CLI（宿主生成）

- [x] T001 `project/modules.ts`：`autolinkDart` 改造/新增 `autolinkDartModule(entries)`
  产出 `fjs_autolink.dart` 文件内容（generated 头 + import + `fjsRegisterModules`）。
- [x] T002 `commands/run.ts`：`writeHostAttach(libDir, root)`（`src/main.dart`
  原样复制为 `fjs_attach.dart`，缺省写空实现；最终按约定函数方案）。
- [x] T003 `commands/run.ts`：`writeHostMain` 静态化（调 `fjsRegisterModules` +
  attach 标记区间，无内联 register）。
- [x] T004 `commands/run.ts`：`ensureFlutterHost` 增加 `forceMain`；managed 分支
  main.dart 缺失才整体写（旧版模板自动重写 + 一行日志），已有则只替换标记区间；
  managed 与 ejected 都写 `fjs_autolink.dart`；ejected 分支幂等补丁 main.dart
  （补 import + 调用 + 标记区间，移除旧内联 register）。
- [x] T005 `commands/host.ts`：`reportAutolink` ejected 分支文案改为"已写入
  fjs_autolink.dart"；`sync --force` 传 `forceMain`。
- [x] T006 `commands/host.ts`：`repointRelativePaths(text, oldDir, newDir)` 纯函数，
  eject rename 后调用，重写 pubspec 相对 `path:` 行。

## runtime（style shim）

- [x] T010 `css/style.ts`：`StyleEngine.inlineRecord(id)` 与
  `mutateInline(id, key, value)`（key 透传、null/'' 删、复用归一化 + markDirty）。
- [x] T011 `ui/element.ts`：模块级 `setElementStyleBridge()`；`makeElement` 惰性
  定义 `style`（索引读写 / setProperty / getPropertyValue / removeProperty；
  无 bridge 时本地记录 + warnOnce）。
- [x] T012 `vue/renderer.ts`：初始化时注入 bridge 接 styleEngine。

## 示例

- [x] T020 `examples/hello-fjs/package.json` 补回 `@vueuse/motion`，`pnpm install`。
- [x] T021 `examples/hello-fjs/src/pages/example/motion.vue`（group「动画演示」）：
  variants 入场 + stagger、弹簧对比、循环动效三块，两端同源。
- [x] T022 验证 vue-tsc 识别 v-motion 类型，不行则在项目 d.ts 补指令声明。

## 测试

- [x] T030 `packages/fjs/test/run.test.ts`：autolink 模块内容、静态 main 模板、
  managed 缺失才写 / 旧版重写、ejected 幂等补丁、`repointRelativePaths`
  （两层→一层、./ 前缀、目录内路径不变）。
- [x] T031 `packages/fjs-runtime/test/element-style-shim.test.ts`：写/读/
  setProperty/removeProperty、与 `:style` 绑定互不覆盖、无 bridge 兜底。

## 文档

- [x] T040 `docs/toolchain.md`：宿主三文件所有权表、`src/main.dart` 约定、
  eject 路径修复说明。
- [x] T041 `docs/web.md`（或 css-compat.md）：style shim 已知差异
  （读不到级联值、drag/visibility 不可用）。

## 验收

- [x] T050 `pnpm --filter @ufjs/cli test` && `pnpm --filter @ufjs/runtime test` 通过
- [x] T051 `pnpm --filter hello-fjs run typecheck` 通过
- [x] T052 `pnpm --filter hello-fjs run build` 两连跑：手改 main.dart 存活
- [x] T053 motion 页 web 端目验（dev:web）；App 端与 eject 流程按 spec §6 核对

## 修复（合并后实测发现）

- [x] T060 撤掉 `window` 垫片（src/motion/native-polyfills.ts）：假 `window`
  让 Anime.js 的 `typeof window` 环境判定走浏览器分支，模块求值时引用裸
  `document` 直接 ReferenceError，整页白屏。motion 的帧循环（framesync）
  在无 `window` 时回落到宿主自带的 16.7ms `setTimeout`，不碰全局；
  模拟器实测 Anime.js 与 motion 两页均正常（fjs run ios，nav 日志无错误）。
