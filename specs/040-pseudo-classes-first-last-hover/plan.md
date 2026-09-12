# Plan: 伪类补全 — `:first-child` / `:last-child` 与 `:hover`

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | Web 侧是真 CSS，`:first-child`/`:last-child`/`:hover` 原生支持，**零改动**（回归确认构建改写不破坏）；Flutter 侧全量实现。唯一差异（`.row:hover .title` 后代超界）登记进 `docs/css-compat.md` |
| II 边界即契约 | 涉及 | 动 UI op 协议一张表：`ops.ts`（编码）+ `ui_ops.dart`（op 码）+ `mirror_tree.dart`（解码）+ `native/tools/fjsrun.cpp`（调试 dump）。natives 表、事件类型不动 —— hover 不是事件，样式走既有 DefineStyle 样式表 |
| III 同步单线程零序列化 | 涉及 | hover 样式复用样式表 intern 机制（对象身份 → id），新增的只是一条 9 字节 op；结构伪类计算全在 JS 引擎既有 flush 流程里，无新异步 |
| IV 外观照 WeUI | 不涉及 | 不改内置组件默认样式 |
| V 静默失效是 bug | 涉及 | 其余伪类（`:nth-child`、`:not()`…）照旧 `warnOnce` 跳过并补测试；`:hover`/`:first-child` 写在不支持的位置（非最后复合）同样告警；旧宿主收不到 hover 样式时 `warnOldHostOnce` |
| VI 注释记录权衡 | 涉及 | 至少三处「为什么」：为何新增 op 12 而非扩 op 8（旧 JS runtime 配新宿主会错位解析）；为何兄弟位置要进 chainKey 且仅当存在结构伪类规则；为何 raw 文字要打来源标记 |
| VII JS 能包就不要下 Dart | 涉及 | first/last **全在 JS**（引擎计算 + 普通 style 通道，Dart 零改动）。hover 下 Dart 只因**状态触发器在宿主**（鼠标事件 JS 收不到，同 `:active` 的按下状态），样式计算、cascade、特异度全留在 JS 引擎 |
| VIII 变更落到文档 | 涉及 | `docs/css-compat.md`（§1 选择器表、§4 状态伪类小节）、`docs/roadmap.md`、`docs/ui-api.md`（核对样式章节是否需要补） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | 无 | `node-budget.ts` 的本地 CSS 解析只看声明不看选择器，无需动 |
| JS runtime（解析） | `fjs-runtime/src/css/parser.ts` | `Compound` 加 `first`/`last` 布尔位；`Selector` 加 `hover` 位。解析 `:first-child`/`:last-child`（**任意 compound 上合法**）、`:hover`（照 `:active` 只许最后一个 compound，违反告警）。每个伪类特异度 +10 |
| JS runtime（引擎） | `fjs-runtime/src/css/style.ts` | ① 第三条 cascade（hover），镜像 active 的数据结构（`hoverDecls`/`hoverComputed`/`appliedHover`/`ComputeResult.hoverStyle`）；`applyStyle` 回调加第 4 参。② 结构伪类：register 时算 `hasStructuralRules`；chainKey 的 `selfSig` 在有结构规则时追加「是否 first/last」两位；recompute 时发现位翻转则按 class 变更处理（`selfSig=undefined` + subtree markDirty）。③ 新公开方法 `noteStructureChange(parentId)`：mark 父下所有已注册子节点。④ 无父节点的根视为 first+last（对齐 web 上页面根是 `#app` 首子节点） |
| JS runtime（渲染器/协议） | `fjs-runtime/src/vue/renderer.ts`、`ui/ops.ts` | createText 打 raw 标记（ensure 加参数）；insert/remove 后调 `noteStructureChange`；`ops.ts` 加 `UiOp.SetHoverStyle = 12` 与 `setHoverStyle(id, style|null)`（`uiOpsVersion < 6` 时 `warnOldHostOnce` 并丢弃，照 op 10/11 先例），`applyStyle` 回调接 hover 并发 op 12 |
| Web 适配层 | 无 | 真 CSS 原生。补一条构建回归：css-compat 改写不碰伪类选择器 |
| C++ 引擎 | `flutter_fjs/native/tools/fjsrun.cpp` | `dump_ops` 加 case 12（id + styleId 打印）+ skip 表加一行。调试路径，非契约 |
| Dart 宿主（协议） | `flutter_fjs/lib/src/engine.dart`、`ui_ops.dart`、`mirror_tree.dart` | `uiOpsVersion` 5 → 6；`UiOpCode.hoverStyle = 12`；`MirrorNode.hoverStyle` 字段 + `hoverStyleMap` getter（镜像 activeStyle）；解码 case 12（styleId 0 清空，同 op 8 语义） |
| Dart 宿主（渲染） | `flutter_fjs/lib/src/render/style.dart`、`render/renderer.dart` | `FjsStyle.hoveredOf`（base+hover）与组合入口（pressed 时 base+hover+active，active 覆盖 hover）；`nodeHasHoverStyle`；renderer 加 `_HoverNode`（MouseRegion onEnter/onExit，**仅当节点带 hover 样式才包**），样式选择 pressed > hovered > 普通 |
| 示例 | `examples/hello-fjs/src/pages/comp/pseudo.vue`（新） | 列表 first/last（分隔线收尾）+ 增删项按钮 + hover 按钮；挂进页面路由 |
| 测试 | `fjs-runtime/test/css.test.ts`、`vue_styles.test.ts`；`flutter_fjs/test/` | 见 §5 验证路径 |
| 文档 | `docs/css-compat.md`、`docs/roadmap.md`、`docs/ui-api.md` | 表格打勾、状态伪类小节改名（按压态 → 状态伪类）补 hover 行、roadmap 移入已完成 |

## 3. 方案

### 3.1 `:first-child` / `:last-child`（全 JS，零协议改动）

**匹配**：`matchCompoundFrom` 在每个 compound 判 tag/class 后追加结构判定：
`first` = 兄弟序列（父的 childrenOf，过滤掉①未注册进 states 的锚点、②raw
文字元素）里它是第一个，`last` 同理取末位。无父节点（页面根）视为
first+last，对齐 web（页面根是 `#app` 的唯一/首子元素）。

**缓存正确性（核心难点）**：`matchRules` 按 chainKey（自身+祖先的
tag/class/scope 签名）缓存，兄弟位置不在键里 —— 两个同签名不同位置的行会
命中同一条缓存，first/last 静默判错。处理：

- chainKey 的 `selfSig` 追加两位（first/last），**仅当样式表里存在结构伪类
  规则**（register 时算一次 `hasStructuralRules`）；没有结构规则时键不变、
  位置永不计算，零成本。祖先的位置通过 chainId 传递天然包含（祖先
  selfSig 变 → 祖先 chainId 变 → 后代键跟着变）。
- 失效路径：渲染器 insert/remove 后调新方法
  `styleEngine.noteStructureChange(parentId)`，把父下所有已注册子节点 mark
  进重算。recompute 时 `buildChainKey` 发现位置位与缓存的 `selfSig` 不符，
  视同 `setClasses`：重置 selfSig、清 matched、**markDirty(id, subtree)**
  ——后代的 chainKey 内嵌祖先 chainId，必须跟着重键。

**web 对齐**：raw 文字打来源标记（`createText` → `ensure(id, 'text', undefined, true)`），
显式 `<text>` 不标。判定位置时跳过 raw 兄弟 —— 推导见 spec §4，两种
混排用例（裸文字+元素、显式 text+元素）两端结论一致。

### 3.2 `:hover`

**JS 引擎**：`matchRules` 里 active 的那条 cascade 复制成 hover（第三组
plain/hover/active 列表；一个 selector 可同时贡献多组，按各自特异度）。
`compute` 把 `hoverDecls` 走同一条 `resolveVars`/继承/内联合并管线生成
`hoverStyle`（inline 与继承在 hover 变体里同样优先，同 active 的既有注释）。
`recompute` 的去重比较扩成三份（active 的 `sameOptionalStyle` 模式）。

**协议**：hover 与 active 是两个独立状态，不能共用一个槽位（只 hover 未
active 的组合没法表达）。**新增 op 12 `SET_HOVER_STYLE(id, hoverStyleId)`**
而不是把 op 8 扩到 16 字节 —— op 8 扩宽会让「旧 JS runtime + 新宿主」错位
解析：旧 runtime 读到 `uiOpsVersion: 6` 只会认为自己的版本门全通过，仍按
12 字节编码，宿主解码就花了。新 op + 版本门（`< 6` 丢弃并告警一次）是
op 10/11 验证过的形状。样式本体走既有 DefineStyle 表，`ResetStyles` 清表
语义不变。`hoverStyleId = 0` 清空，与 op 8 的 activeId 同语义。

**Dart**：`MirrorNode.hoverStyle`（镜像 activeStyle 的 intern 读取）。渲染器
`_buildNode` 里，`FjsStyle.nodeHasHoverStyle(node)` 为真时包一层
`_HoverNode`（StatefulWidget + MouseRegion，onEnter/onExit setState），
builder 同时拿 `pressed`/`hovered` 选样式：pressed 用 base+hover+active
（active 覆盖 hover，两端约定钉进 css-compat §4），hovered 用 base+hover。
MouseRegion 在移动端只是不触发，不加平台分支。

**被否掉的备选**：

- *Dart 侧算 first/last*：兄弟账在 JS 元素树里，Dart 镜像树再记一份 +
  自己写失效，两套账必然漂移；且 CSS cascade 归 JS 引擎管是既有分工。
- *hover 走事件回 JS 重算*：每次进出都过一遍 JS，违背 `:active` 定下的
  「状态切换不回 JS」；后代超界（`.row:hover .title`）也因此顺理成章地
  不支持，与 active 同一条边界。
- *MouseRegion 无条件包所有节点*：每节点一层 widget，列表场景白白多几万
  层；只在节点真带 hover 样式时包。

## 4. 风险

- **缓存判错是静默的**（宪法 V 最担心的那种）：位置位忘了进键、或位翻转后
  没传播到后代，页面不报错只是样式错。用例必须覆盖「同签名兄弟位于不同
  位置拿到不同样式」和「插入/删除后**旧**兄弟（不只新子树）重算」。
- **位翻转在 recompute 内触发 subtree markDirty**：flush 是 while 循环 +
  新列表，已支持；但要确认 guard=100 不会在深树反复翻转下提前放弃（测试
  深度嵌套 + 批量增删）。
- **两端对拍点**：v-for 增删项后末行分隔线即时消失/恢复；裸文字+元素混排、
  显式 `<text>`+元素混排两种写法的 first/last 结论；hover 进出子树
  （MouseRegion enter 子树语义与浏览器一致）。
- **`:hover`+`:active` 同时命中**：Dart 固定 active 覆盖 hover；web 由源
  顺序决定 —— 在 css-compat §4 登记为「约定 active 优先」，页面同时定义
  两者时把 `:active` 规则写在后面以对齐。
- **旧宿主**：`uiOpsVersion < 6` 时 op 12 不发； Dart 侧未知 op 是抛
  `UiOpException` 的，版本门是唯一防线，不能漏。

## 5. 验证路径

```bash
# JS 侧
pnpm --filter @ufjs/runtime run test            # css.test.ts 新用例
pnpm run typecheck && pnpm test

# Dart 侧（先编 native，否则 flutter test 静默跳过 —— AGENTS.md §3 的坑）
cd packages/flutter_fjs/native
cmake --build build-native -j
cd .. && flutter test

# 两端对拍
pnpm --filter hello-fjs run dev:web             # first/last/hover 全成立
fjs run android                                 # first/last 成立、hover 不触发（对照）
cd packages/flutter_fjs/example && flutter run -d macos   # hover 成立
```
