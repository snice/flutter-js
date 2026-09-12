# Plan: @media 响应式样式

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | App：CSS 引擎解析 media 条件、按窗口逻辑尺寸匹配，尺寸变化全量重算。Web：浏览器原生 `@media`，**零生产代码改动**（已核实：web 端 `<style>` 走 `injectStyle` 真 CSS，`registerStyles`/StyleEngine 在 web 构建里根本不接 CSS，不存在双份求值）。`rewriteFjsCss` 三个改写都是全文正则（`[;}]` 前瞻），media 块内部天然覆盖——只需补回归测试钉住，不实现 web 侧求值器。支持的特性集（spec §4 表）是两端的公共子集，超集特性在 App 端告警，登记 css-compat |
| II 边界即契约 | 是 | 动**事件表**一张：`fjs.h` 加 `FJS_EVENT_VIEWPORT_CHANGED = 33` ↔ `ffi.dart` 加 `viewportChanged = 33` ↔ JS 侧注册处常量（系统事件不进 `element.ts` 的 `EventType`，与 navMount=10 同类；JS 侧常量随注册代码放在 renderer.ts，同 host-async.ts 的 `EVENT_ASYNC_RESULT = 32` 写法）。op 协议、natives 表零改动——初始尺寸不走 `invokeHost`，由 Dart 在 VM 启动后主动推 |
| III 同步单线程零序列化 | 是 | viewport 事件是普通 `dispatchEvent`（同步、字符串 JSON 载荷），无新线程、无等待 |
| IV 外观照 WeUI | 否 | 不新增组件外观 |
| V 静默失效是 bug | 是 | 不支持的 media 特性 / `not` / 嵌套 at-rule：`warnOnce` 后整块跳过；`print` 等其他 media type 同样告警 |
| VI 注释记录权衡 | 是 | `style.ts` 的 `setViewport` 注释说明「为什么走 register() 同款失效路径而不是增量匹配」；`engine.dart` 注释说明「为什么推 VM 启动后一发 + 每次 rebuild 重推」；回退尺寸 390×844 的来由写在常量旁 |
| VII JS 能包就不要下 Dart | 是 | 解析、匹配、重算全在 JS（CSS 引擎本来就在 JS）；Dart 只做 JS 做不到的一件事——知道窗口多大、什么时候变了 |
| VIII 变更落到文档 | 是 | `docs/css-compat.md`（选择器表 @media 行 + 新小节 + 已知差异）、`docs/roadmap.md`（近期计划 CSS 扩展条目标注 @media 完成）、`docs/ui-api.md` 样式清单如涉及 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime · 解析 | `packages/fjs-runtime/src/css/parser.ts` | 新增 `MediaCondition` 类型与条件解析；`parseStylesheet` 遇 `@media` 递归解析块内规则集，规则挂 `media` 字段；不支持的情形 `warnOnce` 跳过 |
| JS runtime · 匹配 | `packages/fjs-runtime/src/css/style.ts` | `StyleEngine` 加 `setViewport(w, h)`、回退尺寸、`hasMedia` 门；`matchRules` 扫描时跳过不匹配的规则；视口变化走 `register()` 同款失效（bump `matchEpoch` + 清 `matchCache` + 全量 `mark` + `scheduleFlush`） |
| JS runtime · 接线 | `packages/fjs-runtime/src/vue/renderer.ts` | 模块加载时 `registerSystemHandler(33, …)`，解析 `{"width":n,"height":n}` 调 `styleEngine.setViewport`（仿 host-async.ts 的惰性注册写法） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent.viewportChanged = 33` + 注释（载荷形状） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | `updateViewport(Size)`：归一化载荷 `{"width":…,"height":…}`（一位小数），按载荷串去重；VM 未起则存 pending，VM 每次启动/重建完成后补发（dev reload 重建 VM 也覆盖） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_view.dart` | `_FjsViewState` 实现 `WidgetsBindingObserver`：`didChangeDependencies` 推 `MediaQuery.sizeOf`，`didChangeMetrics` 帧后重推；`dispose` 移除 observer |
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | `FJS_EVENT_VIEWPORT_CHANGED = 33` 枚举 + 注释（只进契约表，native 不解释载荷） |
| Web 适配层 | `packages/fjs-runtime/src/web/css-compat.test.ts` | 仅测试：media 块内的无单位长度补 px、块内 `flex-grow` 改写、`@media (min-width: 600)` 条件里的无单位值补 px（良性）、条件本身不被破坏 |
| 示例 | `examples/hello-fjs/src/pages/example/responsive.vue` | spec §3 的侧栏形态 + 一个 `orientation` 用例；路由自动扫描 |
| 文档 | `docs/css-compat.md`、`docs/roadmap.md` | 表格与小节、roadmap 勾选 |

CLI / 构建层、C++ 实现（fjs.h 只加枚举）均不动。

## 3. 方案

**数据流（App 端）**：

```
renderer.ts 模块加载（app bundle eval 时，先于任何页面样式注册）
  → invokeHost('fjs.viewport.get') 拉**初始**尺寸（同步，HostRegistry 注册，
    natives 零改动；web/fjsrun 无宿主自动跳过）
Flutter 窗口变化 (WidgetsBindingObserver.didChangeMetrics)
  → FjsView.updateViewport → engine.updateViewport(Size)
  → 载荷去重后 dispatchEvent(0, 33, '{"width":w,"height":h}')
  → renderer.ts 的 systemHandler → styleEngine.setViewport(w, h)
  → matchEpoch++ / matchCache 清 / 全量 mark → 微任务 flush 重算
  → 既有 setProps 路径下发（op 协议零改动）
```

**实现中修正（原 plan 的「VM 启动后推一发」不可行）**：`reset()` 只跑
prelude，renderer.ts 随 app bundle 之后再 eval——启动时推送落在 handler
注册之前，dev reload 重建 VM 同理。改为「JS 加载时拉初始 + Dart 推变化」
双向：拉取走既有 `invokeHost` 泛型通道（新 handler 只是 Dart HostRegistry
一行，natives 表零改动），顺带把「VM 重建后补发」的需求也消掉了——每个
新 VM eval renderer 时自己拉最新值。

**parser**：`@media` 块的 selectorText 位置拿到条件文本，`matchBrace` 取整块，
块内再跑一个「只认规则集」的循环（复用 `parseSelector` + `parseDeclarations`
的现有路径）；嵌套 `@media`/其他 at-rule → warnOnce 跳过。条件解析成
`Array<{ type: 'screen'|'all'|null, features: Array<{name, op, value|keyword}> }>`
（逗号 = 或，分支内 = 且）。`only` 前缀吞掉；`not`、未知特性、非法值 →
warnOnce 整块丢弃。`CssRule.media?: MediaCondition`，无 media 的规则不带该键
（保持既有测试的 deep-equal 形状）。

**StyleEngine**：`setViewport` 只在 `hasMedia` 为真时才失效；比较用宽高数值，
相等直接返回（桌面拖窗每帧触发，等值快速路径必须有）。匹配扫描里
`if (rule.media && !matches(rule.media, viewport)) continue`——落在每条规则
现有循环内，不新增 pass。

**回退尺寸**：StyleEngine 初始 `viewport = { width: 390, height: 844 }`。
fjsrun 永远收不到事件；App 端在页面 CSS 注册之前（VM 启动后、navMount 前）
就推了真实尺寸，正常路径用不到回退值。390×844 对齐 iPhone 主流竖屏。

**否掉的备选**：

1. **只推不拉（VM 启动后 Dart 推一发）**：原方案。实现时发现 `reset()`
   只跑 prelude，renderer.ts 随 app bundle 之后才 eval，启动推送落在
   handler 注册之前；「等首帧再推」又要找新的时机钩子。改为拉推结合
   （见上），初始尺寸由 JS 主动拉，时序不依赖任何加载顺序假设。
2. **Dart 侧求值 media、推送「哪些块命中」**：把 CSS 语义劈成两半，
   `orientation` 之类的判定要两端各写一遍；JS 引擎本来拥有整条级联。
3. **为新事件走 op 协议**：op 是 JS→Dart 方向；Dart→JS 只有 dispatchEvent
   这条通道（宪法 II 的 fetch 范式）。
4. **`not` / `only` 完整支持**：`only` 是历史包袱、吞掉零成本；`not` 牵扯
   取反分支的级联语义，按宪法 VII 的「按需补」，本期 warnOnce 跳过。
5. **视口变化走增量重算（只重算 media 命中集合变化的元素）**：命中集合变化
   的判定本身要扫一遍全部规则，省不掉扫描；`register()` 的全量失效路径
   已存在且正确，先复用，桌面拖窗的性能问题留给实测（见风险）。

## 4. 风险

- **dev reload 重建 VM 后 media 全部失效**：system handler 随旧 VM 死掉。
  已由拉推结合解决：每个新 VM eval renderer 时自己拉最新尺寸，不依赖
  Dart 补发。
- **多 FjsView / 多引擎重复推**：engine 按载荷串去重，第二次推是 no-op。
- **首帧闪烁**：页面 CSS 先算、viewport 后到，会按 390×844 先出一帧。
  缓解：推的时机在 VM 启动完成时（bundle eval 前），先于任何页面样式注册。
- **桌面拖窗的重算风暴**：每次尺寸变化全量失效；`scheduleFlush` 每微任务
  收敛一次，拖动中每帧一次全树重算。手机转屏是单发事件，真正受影响的只有
  桌面拖拽 —— 实测 hello-fjs 示例页，卡了再做「视口未变则 matchCache 保留」
  的分桶优化（不进本期）。
- **两端超集差异**：页面写了 App 不支持的特性，web 生效、App 整块不生效。
  已在 spec §4 登记为已知差异，App 端有告警兜底（宪法 V）。
- **`rewriteFjsCss` 对 media 条件的误伤**：`LENGTH_DECL` 会把
  `(min-width: 600)` 的无单位值补成 `600px`（把非法 CSS 变合法，良性），
  但要确认条件里的 `(orientation: portrait)` 等不被改——测试钉住。

## 5. 验证路径

```bash
# JS 侧
pnpm test                                        # parser / style / css-compat 用例
pnpm run typecheck

# native 引擎自测（fjs.h 加枚举后确认无回归）
cd packages/flutter_fjs/native
cmake --build build-native -j && ./build-native/fjs-test

# Dart 侧（含新增 widget 测试：两种窗口尺寸 pump，断言样式分支）
cd packages/flutter_fjs && flutter test

# 两端对拍
pnpm --filter hello-fjs run build:pages          # 或 fjs dev
fjs dev --web                                    # 浏览器拖窄/拖宽 + devtools 转屏
fjs run ios                                      # Cmd+←/→ 转屏，对比同一断点
```

对拍内容：hello-fjs「响应式布局」页，窄于 600px 只有主区，宽于 600px 出侧栏；
横竖屏切换即时生效；`@media print` 在两端控制台各告警一次（web 为浏览器
控制台，App 为 fjs 日志流）。
