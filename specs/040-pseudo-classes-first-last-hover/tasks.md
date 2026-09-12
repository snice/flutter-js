# Tasks: 伪类补全 — `:first-child` / `:last-child` 与 `:hover`

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `packages/fjs-runtime/src/ui/ops.ts`：加 `UiOp.SetHoverStyle = 12` 与
  `setHoverStyle(id, style | null)`，`uiOpsVersion < 6` 时 `warnOldHostOnce('hover style')`
  并丢弃（照 op 10 canvas 的门写法）；样式本体复用 `styleId()` intern。
- [x] T002 `packages/flutter_fjs/lib/src/engine.dart`：`uiOpsVersion` 5 → 6，
  注释记录为何 op 12 独立而非扩 op 8（旧 runtime 错位解析）。
- [x] T003 `packages/flutter_fjs/lib/src/ui_ops.dart`：`UiOpCode.hoverStyle = 12`
  与文件头 op 表注释同步。
- [x] T004 `packages/flutter_fjs/lib/src/mirror_tree.dart`：`MirrorNode.hoverStyle`
  字段 + `hoverStyleMap` getter（镜像 `activeStyle` 的 intern/legacy 双路径），
  解码 case 12（styleId 0 清空，未定义 id 保持现状并 assert）。
- [x] T005 `packages/flutter_fjs/native/tools/fjsrun.cpp`：`dump_ops` 加 case 12
  与 skip 表一行（case 8 旁边照抄）。

## 实现（JS 引擎）

- [x] T010 `packages/fjs-runtime/src/css/parser.ts`：`Compound.first`/`.last`、
  `Selector.hover`；`:first-child`/`:last-child` 任意 compound 上解析，
  `:hover` 照 `:active` 只许最后 compound（违反告警跳过）；每个伪类特异度 +10；
  其余伪类保持 `/[([:]/` 告警路径。
- [x] T011 `packages/fjs-runtime/src/css/style.ts`：hover cascade ——
  `MatchResult.hoverDecls`、`ElementState.hoverComputed/hoverKeys/appliedHover/
  appliedHoverKeys`、`ComputeResult.hoverStyle/hoverKeys`、`applyStyle` 第 4 参、
  `recompute` 三份去重比较（`sameOptionalStyle` 模式），hover 变体走
  `resolveVars` + 继承 + inline 同一管线。
- [x] T012 `packages/fjs-runtime/src/css/style.ts`：结构伪类 ——
  register 时算 `hasStructuralRules`；`selfSig` 追加 first/last 两位（仅当
  有结构规则）；`matchCompoundFrom` 加结构判定（过滤未注册锚点与 raw 文字
  兄弟，无父视为 first+last）；`recompute`/`buildChainKey` 发现位翻转 →
  重置 selfSig + `markDirty(id, true)`；公开 `noteStructureChange(parentId)`。
- [x] T013 `packages/fjs-runtime/src/css/style.ts`：`ensure` 加 raw 文字标记参数，
  `packages/fjs-runtime/src/vue/renderer.ts` 的 `createText` 传入；renderer 的
  `insert`/`remove` 调 `noteStructureChange(parent.id)`；`applyStyle` 回调
  （renderer.ts:29）接 hover 并调 `ops.setHoverStyle`。

## 实现（Dart 渲染）

- [x] T020 `packages/flutter_fjs/lib/src/render/style.dart`：
  `FjsStyle.hoveredOf`、`nodeHasHoverStyle`、组合入口（pressed = base+hover+active）。
- [x] T021 `packages/flutter_fjs/lib/src/render/renderer.dart`：
  `_HoverNode`（MouseRegion onEnter/onExit，仅 `nodeHasHoverStyle` 时包），
  样式选择 pressed > hovered > 普通；注释记录为何不无条件包、为何 active 覆盖 hover。

## 两端对齐

- [x] T022 Web 侧确认零改动：css-compat 改写不碰伪类选择器（构建产物抽查
  `.item:last-child` / `.btn:hover` 原样保留），登记进测试。
- [x] T023 `examples/hello-fjs/src/pages/comp/pseudo.vue`（新页面 + 路由）：
  v-for 列表 `:last-child` 去分隔线、`:first-child` 顶格、增删项按钮、
  裸文字+元素 与 显式 `<text>`+元素 两种混排、hover 按钮。
- [x] T024 两端对拍（web 已实测通过；iOS 模拟器截图对拍修出两处——demo 页border-bottom 换成缝隙分隔线 + 首末行圆角，Dart 侧 Wrap 子节点主轴 shrink-to-fit 修复（_wrapChild + pseudo_layout_test）；android / macOS 复验待做，host 需重新构建）：`fjs dev --web`（first/last/hover 全成立）、
  `fjs run android`（first/last 成立、增删即时、hover 不触发）、
  macOS（hover 成立、进出子树语义同浏览器）。

## 测试

- [x] T030 `packages/fjs-runtime/test/css.test.ts`：first/last 匹配（含 raw
  兄弟跳过、显式 text 照算、锚点排除、任意 compound 位置、`:active` 叠加、
  特异度）、兄弟插入/删除后旧兄弟与后代重算、hover cascade 与三态去重、
  其余伪类告警、`:hover` 非 subject 告警。
- [x] T031 `packages/fjs-runtime/test/`：ops 编码用例 —— op 12 字节序、
  `uiOpsVersion < 6` 不发、`ResetStyles` 后 hover 条目重定义。
- [x] T032 `packages/flutter_fjs/test/`：op 12 解码（MirrorNode.hoverStyle 赋值/
  清空）+ hover widget 测试（MouseRegion 进出切换样式、pressed 覆盖），
  先编 native。
- [x] T033 vue_styles.test.ts 回归：现有页面级样式用例不回归。

## 文档

- [x] T040 `docs/css-compat.md`：§1 选择器表三行 ❌→✅/⚠️、§4 改「状态伪类」
  补 `:hover` 行（含 active 覆盖约定、后代超界差异、移动端不触发）、
  §6 流程核对。
- [x] T041 `docs/ui-api.md` 样式章节核对补记；`docs/roadmap.md` 近期计划
  伪类条目移入已完成（标注 spec 040）。

## 验收

- [x] T050 `pnpm run typecheck`（@ufjs/cli 的 dev-units.test.ts 有一个 main 上就存在的存量 TS 错误——Buffer 泛型漂移，与本 spec 无关，stash 验证过）
- [x] T051 `pnpm test`
- [x] T052 `cd packages/flutter_fjs && flutter test`（先编 native，警惕
  `No tests ran`）
- [ ] T053 spec.md 第 6 节逐条核对（android/macOS 实机对拍后改 done）
