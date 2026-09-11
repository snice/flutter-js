# Tasks: rich-text 减少节点数

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

op 协议 / natives / 事件类型三张表都不动（plan §1 II）。这一组定下 `richSpans` 的形状，并在改实现之前把「改动前」的数字和截图留下来——之后就测不到了（plan §3.4）。

- [x] T001 从 `main` 建分支 `035-rich-text-node-reduction`
- [x] T002 新建 `packages/fjs-runtime/src/rich-text/spans.ts`，只写 `RichSpan` 类型（`string | { t: string; s: Record<string, unknown> }`）与形状校验函数 `isRichSpans(value)`，两端的形状约定以它为准
- [x] T003 在 `examples/hello-fjs/src/pages/comp/rich-text.vue` 加「长文」Panel（30 段混排 + 10 项列表 + 5×3 表 + 3 图，生成规则与 plan §2 budget 测试同一份）和「重新挂载」按钮：`nowMs()` 量翻转到 `flushNow()` 的 JS 耗时，显示在页面上并 `console.log`
- [x] T004 把 scratchpad 的测量脚本整理成 `packages/fjs-runtime/test/rich-text-node-budget.test.ts`，先只打印节点构成、不设断言，在 main 现状上跑一次，把四份内容的节点数与帧字节记在本条后面 —— main（5d307bb）现状：basic 42（view 6 · 段落 4 · 片段 8 · 叶子 24，2809 B）· lists 67（view 27 · 段落 20 · 叶子 20，5320 B）· table 41（view 18 · 段落 11 · 片段 1 · 叶子 11，3147 B）· article 486（view 78 · 段落 69 · 片段 90 · 叶子 246 · image 3，34564 B）
- [x] T005 改动前截图：Browser pane 起 `hello-fjs-web`、iOS 模拟器各截富文本页全部 Panel，存 scratchpad，文件名记在本条后面 —— web 截图无法存文件，改为量 DOM：每个 Panel 卡片的宽高、元素数、innerText 存 `scratchpad/web-before.json`（改动后同法再量，逐项比对）；iOS 模拟器（iPhone 17 Pro）逐屏截图的观察记在 `scratchpad/sim-before.md`；模拟器面板 nodes 914、ui 最坏 263.3ms、长文挂载 72.0 / 76.4ms
- [x] T006 改动前真机基线：`pnpm --filter hello-fjs exec fjs run ios --device eee48bc13d09c44b90fb7d0a7642fbc0ba994861`；工具连接发 `{"fjs":"tool"}` / `{"fjs":"perf"}`；进页 → 滚到底 → 点「重新挂载」5 次，从日志流取挂载耗时（min / max）；请用户读面板 `nodes` 与 `ui` 最坏值。数字记在本条后面 —— 基线（改动前，dev 构建）：iOS 真机 eee48bc 长文挂载 1172ms（用户读数）/ 860.0 / 446.5ms，min 446.5ms；Android 真机 241.8 / 244.0 / 254.8 / 262.8 / 270.1ms，min 241.8ms（用户读数 240–280）。面板读数：模拟器 nodes 914 · ui 最坏 263.3ms（真机同一棵树，nodes 相同）；**iOS 真机的 ui 最坏值没取到**，复测以挂载耗时为准、面板值能取就补

## 实现

### JS：结构折叠

- [x] T010 在 `packages/fjs-runtime/src/components/rich-text.ts` 的 `renderElement` 里：`children` 恰好一个字符串时走元素文本（元素 `h(target, data, str)`，组件 `{ default: () => str }`），注释写省掉的是哪个节点
- [x] T011 在 `packages/fjs-runtime/src/rich-text/layout.ts` 给匿名段落打 `meta.anonymous` 标记；`layoutBlock` 默认分支在「结果恰好一个匿名段落、块无布局类样式」时返回合并后的段落（带走块的 style / class / margin 元数据），注释写三个合并条件（plan §3.2）
- [x] T012 在 `layout.ts` 的 `layoutBlock` 默认分支：无样式无 class 的块只有一个子块时直接返回子块
- [x] T013 在 `layout.ts` 的 `layoutListItem`：内容只有一个 `text` 时去掉内容 `view`，把 `flexGrow: 1, flexShrink: 1, minWidth: 0` 合进它
- [x] T014 在 `layout.ts` 的 `layoutCell`：单元格结果恰好一个匿名段落时合并成一个 `text`，保留 `padding` 与 flex / 宽度样式，`flexShrink: 1` / `minWidth: 0` 显式写上（plan §4 风险 1）

### JS：段落单节点

- [x] T015 在 `packages/fjs-runtime/src/rich-text/spans.ts` 实现 `flattenSpans(children)`：样式栈合并（后写覆盖、`textDecoration` 并集）、相邻同样式合并、空段丢弃、遇带 `class` 的片段或图片返回 `null`，顶部注释写为什么这两种要兜底
- [x] T016 在 `layout.ts` 的 `buildParagraph` 结尾接上 `flattenSpans`：`null` → 保持嵌套结构；只剩一个无样式字符串 → `children: [str]`；否则 → `props.richSpans`

### Dart：读 richSpans

- [x] T017 确认 `packages/flutter_fjs/lib/src/render/style_parse.dart` 的 `textDecoration` 是否支持空格分隔多值，结论记在本条后面（plan §4 风险 3） —— 结论：已支持。`_parseTextDecorationUncached`（style_parse.dart:280）按空白拆分并 `TextDecoration.combine`，`fjsSpanStyle` 直接用 `style.textDecoration`，不改通用解析
- [x] T018 在 `packages/flutter_fjs/lib/src/widgets/text.dart` 新增 `fjsSpanStyle`：只填 map 里出现的字段，行高按该段字号换算，多值装饰线 `TextDecoration.combine`；注释写为什么不能复用 `fjsTextStyle`
- [x] T019 在 `text.dart` 的 `buildText` 开头读 `node.props['richSpans']`：是 `List` 就建 `Text.rich`，每段一个 `TextSpan`；`verticalAlign: sub/super` 抽出现有平移逻辑为 `_shifted` 复用；段落级属性只取根；形状不对、与子节点或 `node.text` 并存时 debug 告警一次，以 `richSpans` 为准 —— 补充（plan 未预料，已写进 plan §2）：`render/renderer.dart` 的 `isHidden` 会把带 `richSpans`、无文本无子节点的 `text` 当空锚点隐藏，整段不显示；条件加「且无 `richSpans`」。由 T035 的 Dart 用例发现

## 两端对齐

- [x] T020 在 `packages/fjs-runtime/src/web/components/basic.ts` 把 `FjsText` 从 `container('text')` 换成独立组件：`richSpans` 是数组时渲染 `<span style>`（`normalizeStyleValues`），从透传 attrs 去掉 `richSpans`；否则与原 container 行为一致（`hostAttrs`、按压绑定）；形状不对走 `warnControlOnce`；注释写为什么不再是通用 container
- [x] T021 web 预览逐段对照：Browser pane 起 `hello-fjs-web`，富文本页每个 Panel 截图与 T005 对照（段落数、行数、列表标记、表格行列、间距、上下标），控制台无新增告警 —— 结果：12 个 Panel 卡片宽高与 innerText 与 `web-before.json` 逐项相同（212 · 67.6 · 258.4 · 283.9 · 118.4 · 261.2 · 255.7 · 79.6 · 132.8 · 168.6 · 51.6 · 长文 1902.5）；页面 DOM 元素 450 → 353（长文卡片 242 → 183，列表 46 → 38，表格 29 → 18）；无 `richspans` DOM 属性，`text > span` 103 个；控制台无 error（仅改动前就有的 Vue 内置标签名 warn）
- [x] T022 iOS 模拟器逐段对照：`pnpm --filter hello-fjs run run:ios`，同一份对照项，截图与 T005 对照；表格与列表的列宽重点看（plan §4 风险 1） —— 结果（带 renderer.dart 修复重建后）：5 屏与 `sim-before.md` 逐项一致——标题 / 混排行 / br；节点数组折行位置；space 四档；列表标记、三层缩进、C./D.、罗马数字右对齐；表格标题行、定宽列、合计行粗体；行内小图同行、大图宽度；pre 缩进、H₂O 下标、mc² 上标（仍为正文色）、blockquote、hr；scoped class 绿色粗体；非白名单无残留；模板嵌套 text
- [x] T023 真机复测：同 T006 的命令与操作序列，挂载耗时（min）与面板 `nodes` / `ui` 最坏值都要低于 T006，数字记在本条后面 —— **结果（dev 构建）**：长文挂载 iOS 真机 eee48bc 76.8 / 82.0 / 89.8 / 93.3ms（用户读数「90ms 左右」），Android 真机 41.3 / 42.2 / 44.1 / 45.7 / 47.0 / 47.8ms（用户读数「47ms 左右」）；改动前 iOS min 446.5ms（1172 / 860 / 446.5）、Android min 241.8ms。**口径说明**：复测时临时在示例页计时前调 `gc()` 并拆 render / bridge（**仅诊断用，已撤回**：`gc()` 是调试工具，页面不允许调用；示例页最终只保留 render / bridge 拆分）（改动后 iOS 计时前 GC 31.5–52.2ms、Android 35–49ms），改动前窗口可能含 GC；把 GC 加回去 iOS 约 108–145ms、Android 约 80–95ms，仍远低于改动前。同引擎排除 GC 的对照见 QuickJS A/B：21.0 → 6.9ms。面板 nodes：模拟器整页 914 → 393（真机同一棵树）；**iOS 真机面板 ui 最坏值前后都没取到**

## 测试

- [x] T030 `packages/fjs-runtime/test/rich-text-node-budget.test.ts` 加断言：示例「HTML 字符串」≤ 8、「列表」≤ 40、「表格」≤ 24、模拟长文 ≤ 120；兜底用例（`<span class>`、`<img>`）仍是嵌套节点且文字正确。预算若需调整，原因写在本条后面（plan §4 风险 6） —— 预算未调整。实测（含 flutterRoot 容器节点）：basic 6 · lists 39 · table 18 · article 91；帧字节 1017 · 3786 · 1815 · 15288
- [x] T031 新建 `packages/fjs-runtime/test/rich-text-spans.test.ts`：嵌套样式合并、装饰线并集、上下标段、相邻同样式合并、空段丢弃、class / 图片返回 `null`、`isRichSpans` 形状校验
- [x] T032 更新 `packages/fjs-runtime/test/rich-text-layout.test.ts` 的结构类断言（块与段落合并、`richSpans`、列表项无内容 view、单元格合并、无样式外壳块展开）；文字、样式值、顺序、margin 折叠结果的期望不改
- [x] T033 更新 `packages/fjs-runtime/test/rich-text-component.test.ts`：片段从 `text > text` 变 `text > span`；新增「单字符串不生成文本子节点」「`richSpans` 不出现在 DOM 属性上」 —— 另：`@tap` 用例一度偶发失败（连跑 5 次挂 3 次），当时误判为「happy-dom 里 span 的 click 不冒泡」；实际原因是 Vue 事件 invoker 的时间戳检查——挂载同一毫秒内点击，根上的监听把事件当作更早的而丢掉。改为挂载后等 5ms 再点 span，注释已写明；真浏览器（示例页「切换 nodes / @tap」）点 span 计数 +1 已核实
- [x] T034 跑 `packages/fjs-runtime/test/vue_styles.test.ts`，确认 rich-text scoped 用例在兜底路径下不改即通过
- [x] T035 在 `packages/flutter_fjs/test/rich_text_test.dart` 的 `_W` 补 `setProps`，加用例：带 `richSpans` 的 `text` 是一个 `RichText`、各段粗细 / 颜色正确、未写字段继承段落样式、`sub` / `super` 为平移 `WidgetSpan`、多值装饰线、形状不对不崩 —— 4 条 richSpans 用例；首跑 4 条全挂，定位到 renderer.dart `isHidden`（见 T019 补充），修后 9 条全过
- [x] T036 跑 `cd packages/flutter_fjs && flutter test`，确认 `rich_text_test.dart` 真的跑了（`No tests ran` 视为失败） —— native 重编后全量 `flutter test`：279 passed · 3 skipped · All tests passed（rich_text_test.dart 9 条在内）

## 文档

- [x] T040 更新 `docs/ui-api.md` 的 `### rich-text` 小节：加「节点构成」（一段一个节点、兜底条件、正文里的 class 会让那一段多出节点、长文建议 `list-view` / 分页），`richSpans` 只点一句是内部 prop，不进标签表
- [x] T041 更新 `docs/performance.md`：新增「rich-text 的节点数」一节，写改动前后四份内容的节点数与帧字节（T004 / T030），以及真机挂载耗时与面板数字（T006 / T023） —— 已写：节点数表、QuickJS 分阶段 A/B、示例页计时里 GC 的陷阱、真机前后数字
- [x] T042 更新 `docs/roadmap.md`：在 rich-text 条目下记一行节点优化（spec 035）

## 验收

- [x] T050 `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` —— 两处均 exit 0
- [x] T051 `pnpm test` —— exit 0：fjs 99 · fjs-webview 36 · fjs-runtime 353（41 files）· fjs-webgl 29，全部 passed
- [x] T052 `cd packages/flutter_fjs && flutter test` —— native 重编后 279 passed · 3 skipped（resolved_style_test.dart 既有跳过）· All tests passed
- [x] T053 `pnpm --filter hello-fjs run build:pages` 与 `build:web` —— 两者 exit 0（bundle.js 1471ms；vite built in 431ms）
- [x] T054 spec.md 第 6 节逐条核对（1–7），结果写在本条后面，spec 状态改为 `done` —— 核对：
  1. ✅ 两处 typecheck exit 0（T050）
  2. ✅ `pnpm test` 全过；034 的 parse 用例未改，layout / component 只改结构断言，文字 / 样式值 / 顺序 / margin 期望保持（T032–T034）
  3. ✅ `rich-text-node-budget.test.ts`：6 / 39 / 18 / 91，均在 8 / 40 / 24 / 120 内，兜底用例在（T030）
  4. ✅ `flutter test` 279 passed（T052）
  5. ✅ 外观不变：web 12 个 Panel 宽高与文字逐项相同（T021）；iOS 模拟器 5 屏逐项一致（T022）
  6. ⚠️ 部分满足：真机挂载耗时明显低于改动前（T023，口径差异已写明）；nodes 以模拟器面板为准 914 → 393；**真机面板 ui 最坏值没有取到**，这一项未能验证
  7. ✅ `docs/ui-api.md` 节点构成、`docs/performance.md` rich-text 节点数一节（另更新 `docs/roadmap.md`）
  另：实现中补改 `render/renderer.dart` 的 `isHidden`（plan §2 已登记）

## 追加：示例里不许调 gc()（用户要求，2026-09-11）

`gc()` 只能用于调试，示例 / 业务代码不允许调用。验收阶段为排除 GC 在示例页加过的 `gc()` 撤回，并把仓库里历史压测代码的调用一并去掉。

- [x] T070 `examples/hello-fjs/src/pages/comp/rich-text.vue`：「重新挂载」计时去掉 `gc()`，只保留 render / bridge 拆分，注释说明窗口可能含 GC、看 min
- [x] T071 `examples/hello-fjs/src/pages/example/theme.vue`：去掉计时前 `gc()` 与 heap 读数，注释指向性能面板 `heap` 行
- [x] T072 `examples/hello-js/src/theme-bench.ts`：去掉计时前 `gc()`、heap / gc 读数与日志里的 `gcMs` / `objects`；「堆压载」开关保留
- [x] T073 `examples/bench/src/style.ts`：去掉 `collectFirst` 选项与 `theme-switch-vars-gc-first` 用例
- [x] T074 `packages/fjs-runtime/src/host.ts` 的 `gc()` 注释写明仅限调试；`docs/performance.md` 四处（读堆看面板、gc 仅调试、2×2 表的口径说明、方法论）
- [x] T075 `pnpm run typecheck`、`pnpm --filter hello-fjs run typecheck`、`pnpm --filter fjs-bench run build`、`pnpm test` —— 全部 exit 0：typecheck 两处通过；fjs-bench build 通过；`pnpm test` fjs 99 · fjs-webview 36 · fjs-runtime 353 · fjs-webgl 29；修掉的偶发 `@tap` 用例单独连跑 10 次全过
