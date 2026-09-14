# Plan: 小程序端开放 rich-text / picker-view / form / position 四个组件页

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（第三端追平） | Flutter（`packages/flutter_fjs/lib/src/`）与 Web（`packages/fjs-runtime/src/web/`）**都不改**——契约已在两端成立。本 spec 只改小程序端：`packages/fjs/src/mp/*`、`packages/fjs-runtime/src/wx/*`。rich-text 在 mp 上跑的是另两端**同一份** `fjs-runtime/src/rich-text/*` 管线，不另写解析/排版。做不到一致的（inline 图片旁的文字换行、skyline 的 `vertical-align` / `mask-image`）登记到 `docs/miniprogram.md` 已知差异 |
| II 边界即契约 | 否 | 三张表（`ui/ops.ts`↔`ui_ops.dart`、`native-global.d.ts`↔`natives.cpp`、`ui/element.ts EventType`↔`fjs.h`）都不动。mp 事件载荷对齐的是 `docs/ui-api.md` 里的页面级契约，改在 `wx/events.ts`（其注释约定与 `web/events` 同账） |
| III 同步单线程零序列化 | 否 | 不涉及 JS↔Dart。form / picker 载荷的 `JSON.stringify` 是契约本身要求的字符串，不是桥 |
| IV 外观照 WeUI | 是 | picker-view 行高 44、5 行、选中框 1px `#e5e5ea`，取值照 `web/base-css.ts`（spec 008 的 WeUI 扁平滚轮）；rich-text 默认样式来自共享的 `rich-text/defaults.ts`，不另定数值 |
| V 静默失效是 bug | 是 | rich-text 白名单 / `space` / `user-select` / `mode` 告警沿用管线里的 `warnRichTextOnce`（控制台可见）；编译器遇到 `:class` 对象里仍不认识的写法继续告警；picker-view 的 `item-height` 为非静态且无法推出时告警；skyline 不支持的样式在 docs 登记 |
| VI 注释记录权衡 | 是 | 在 `fjs-rich-text` / `fjs-rich-node` 顶部写：为什么不用原生 rich-text（skyline 子集排版）、为什么递归组件只包块级 view（实例数）、inline 图片为什么拆成 flex-wrap 行；`events.ts` 写 JSON 串的来由；`assetUrl` 缓存命中为何也要加引号 |
| VII JS 能包就不要下 Dart | 是（且不下 Dart） | 全部是 JS：rich-text 本就是 JS 组件；mp 端复用管线 + wx 自定义组件画出，form / picker-view 用原生 wx 控件 + 事件适配 |
| VIII 变更落到文档 | 是 | `docs/miniprogram.md`：标签映射表（rich-text → `fjs-rich-text`，picker-view 默认高度/行高，form 载荷，checkbox/radio 进 form）、事件映射说明、已知差异、hello-fjs 开放页列表；`docs/roadmap.md` 小程序待续项里勾掉这四页；`specs/046-.../tasks.md` 不改（历史记录） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/mp/build.ts` | `Emitter.assetUrl()` 缓存命中分支返回 `JSON.stringify(existing)`（白屏根因） |
| CLI / 构建 | `packages/fjs/src/mp/wxml.ts` | ① `inlineClassObject`：`{ focused }` 简写（`key === value` 的标识符）展开；② `TAG_REWRITE` 加 `'rich-text': 'fjs-rich-text'`，`RUNTIME_COMPONENT_TAGS` 加入，给它补 `scope` 属性（`ctx.scopeId`，让内部节点带页面 scoped class）；`:nodes` / `space` 原样透传；③ picker-view：打 `fjs-picker-view` class，静态 `item-height` 换算成 `style="height: 5×h px"` 并传 `indicator-style`；`picker-view-column` 的直接子元素打 `fjs-picker-item`（静态 item-height 非 44 时补内联 `height`） |
| CLI / 构建 | `packages/fjs/src/mp/project.ts` | `RUNTIME_COMPONENTS` 加 `fjs-rich-text`、`fjs-rich-node` |
| CLI / 构建 | `packages/fjs/src/mp/project.ts` | `APP_WXSS` 内置 class：`fjs-picker-view`（height 220px、`align-self: stretch`）、`fjs-picker-item`（height 44px、居中、16px `#333333`）、`fjs-rich-inline`（flex row wrap，交叉轴末端对齐） |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/events.ts` | `picker-view:change`、`picker:change`（数组 → JSON 串，否则 `String`）、`picker:columnchange`（`{"column","value"}` JSON 串）、`form:submit`（`JSON.stringify(detail.value)`） |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/fjs-bridge.ts` | 导出 `flushNow()`（wx 无同步帧可交，no-op，注释说明） |
| JS runtime（wx） | 新增 `packages/fjs-runtime/src/wx/rich-text.ts` | `buildWxRichText(nodes, space)`：`parseHtml` → `sanitizeNodes` → `layoutRichText`，再把 `RenderElement` 树转成 wxml 可直接画的数据：块 `{k:'view', c, s, n:[…]}`、段落 `{k:'text', c, s, r:[{t, c, s}]}`（`richSpans` 与带 class 的嵌套 text 都拍平成一层 runs，class 合并、style 用 `mergeSpanStyle` 合并后经 `stringifyStyle` 转内联串）、含图片的段落 `{k:'inline', n:[text|image]}`、`{k:'image', src, mode, s}`、`{k:'divider', s}`；在 `wx/index.ts` 里挂到 `globalThis.__fjsWx`（同 `resolveCssColor` 的做法，plain JS 组件无法 import TS runtime） |
| JS runtime（wx） | 新增 `packages/fjs-runtime/src/wx/components/fjs-rich-text/`（四件套） | properties `nodes`(String/Array)、`space`、`scope`、`layout`；observer 调 `__fjsWx.buildWxRichText` 后 setData；模板 `<fjs-rich-node list="{{tree}}" scope="{{scope}}"/>`；`virtualHost`，tap 冒泡给页面 `bindtap` |
| JS runtime（wx） | 新增 `packages/fjs-runtime/src/wx/components/fjs-rich-node/`（四件套） | 渲染一层 `list`：text/inline/image/divider 直接画；`view` 画 `<view class style><fjs-rich-node list="{{item.n}}"/></view>`（自引用 usingComponents，只在块级嵌套处实例化）；`virtualHost` + `styleIsolation: apply-shared` |
| JS runtime（wx） | `packages/fjs-runtime/src/wx/components/fjs-checkbox`、`fjs-radio`、`fjs-checkbox-group`、`fjs-radio-group` 的 `.js` | 加 `behaviors: ['wx://form-field']`；toggle / select 时 `setData({ value })` 让表单读到当前态；组内成员不作为独立字段（见风险 R3），group 的 `value` = 选中名字数组 / 选中名字 |
| Web 适配层 | — | 不改 |
| C++ 引擎 | — | 不改 |
| Dart 宿主 | — | 不改 |
| 示例 | `examples/hello-fjs/package.json` | `fjs.mp.exclude` 删 `comp/rich-text`、`comp/picker-view`、`comp/form`、`comp/position` |
| 测试 | `packages/fjs/test/mp-compiler.test.ts` | `:class` 简写；同一资源两处 import 都带引号；`rich-text` → `fjs-rich-text` + `scope`；picker-view class / item-height |
| 测试 | 新增 `packages/fjs-runtime/test/wx-events.test.ts`、`wx-rich-text.test.ts` | adaptEvent 四种载荷；`buildWxRichText` 对 spec 页面样例（段落 runs 在一个 text 里、ol 编号、table 行、img 段落走 inline、script 删除） |
| 文档 | `docs/miniprogram.md`、`docs/roadmap.md` | 见 VIII |

## 3. 方案

### 3.1 编译/运行时小修（picker-view、form、position、白屏）

逐条对应 spec 第 1 节根因，均为局部修改：`assetUrl` 引号、`:class` 简写、`flushNow`、
`events.ts` 载荷、picker-view 默认尺寸 class。position 无代码改动，只删 exclude。

picker-view 行高：原生 `picker-view-column` 以**子节点实际高度**为行高，所以行高落在
子元素的 class 上（`fjs-picker-item`），而不是 picker-view 的属性。skyline 只认 class
选择器（不认 `picker-view-column > *`），所以由编译器给直接子元素打 class，不写后代选择器。

**实现中发现（plan 未预料，2026-09-14 补）**：skyline 的 picker-view 会丢掉创建时的
`value`（行还没量出高度，各列停在第 0 行），列的选项被整体替换时（联动的市列）又丢一次；
但事后把**相同下标**再交一次就生效，且不派 change。直接先给 `[]` 再给真值会让滚轮归零并派
`change [0,0]`，把页面值冲掉。做法：
- 编译器给每个带 `:value` 的 picker-view 生成 `__fjsPvN = __fjsPickerSync(() => [value, 各列 v-for 列表])`，
  模板绑定 `value="{{ __fjs.pickerValue(v, __fjsPvN) }}"`（fjs.wxs 每次重算产出数组副本）；
- 运行时 `pickerSync`（`wx/vue.ts`）在「首帧已渲染」与「携带 deps 变化的 setData 已渲染」后把 tick +1。
  「已渲染」取 setData 回调（新增内部 hook `rendered`，`instance.ts` 在 mounted 后补一次空 setData）；
  0ms 定时器在冷启动时太早，滚轮落到第 0 行并派 `change [0,0]`（DevTools 实测 1/4 复现，改回调后 3/3 冷启动正常）。
- 局限：v-for 里的 picker-view 只能拿到首帧那次重交（deps 含循环变量时不监听）。

### 3.2 rich-text：wx 自定义组件复用 JS 管线（spec Q1）

```
<rich-text :nodes> ─编译→ <fjs-rich-text nodes space scope class bindtap>
                              │ observer: __fjsWx.buildWxRichText(nodes, space)
                              │   = parse → sanitize → layoutRichText (两端同一份)
                              │     → wx 渲染数据（块 / 段落 runs / inline 行 / 图 / hr）
                              ▼
                        <fjs-rich-node list>  —— 递归只发生在块级 view 嵌套处
                              view → <view><fjs-rich-node list=子块/></view>
                              text → <text c s><text wx:for=runs c s>{{t}}</text></text>
                              inline → <view.fjs-rich-inline> text 段 + image </view>
```

- **段落一层 runs**：skyline 的嵌套 `text` 就是行内排版（hello-fjs「模板里嵌套 text」已在
  mp 验证），所以 `richSpans` 直接成 runs；带 class 的行内元素（不能拍平进 richSpans 的那种）
  在 wx 端也拍成 run，class 叠加、父 style 经 `mergeSpanStyle` 下传——wxml 不能递归
  template，拍平避免在 text 里再嵌组件（组件节点会打断行内排版）。
- **scoped class**：页面 wxss 的 scoped 形式是 `.hl.data-v-xxx`，编译器把页面 scopeId 作为
  `scope` 传入，组件给每个带 class 的内部节点追加它；`styleIsolation: apply-shared` 让页面样式进组件。
- **实现中修正（plan 未预料）**：DevTools 实测 skyline 下页面 wxss **进不了**自定义组件模板
  （`apply-shared` / `shared` 都只带 app.wxss，组件模板顶层也不行），所以 `scope` class 本身不够。
  改为编译期把「用到 `<rich-text>` 的 SFC」的 wxss 汇总写到 `fjs/fjs-rich-node/page-styles.wxss`，
  `fjs-rich-node.wxss` `@import` 它（runtime 自带空文件）。scoped 规则带 data-v class 只命中来源页；
  非 scoped 的页面样式会作用到所有页的 rich-text 内部节点（登记为已知差异）。
- **实现中修正**：skyline 嵌套 text 不支持 `vertical-align`（sub/sup 不抬升）与 `position/top`，登记差异；
  图片旁的文字段首尾空格被 skyline 吞掉，转换时换成 NBSP。
- **tap**：内部节点不绑事件，tap 冒泡到宿主，页面 `bindtap` 生效（与「内部节点不派事件」一致）。

**否掉的备选**

1. *原生 `rich-text` 直出*（现状）：skyline 的原生 rich-text 行内元素各占一行、无 ol 编号、
   表格挤成一行、img width 与 `pre` 空白失效（spec 第 1 节截图结论），且白名单与告警与两端不一致。
2. *把管线结果转成原生 nodes 数组喂原生 `rich-text`*：节点最少，但排版仍由 skyline 原生
   rich-text 做，上面的问题照旧；告警与白名单虽能统一，外观对不齐。
3. *每个 RenderElement 一个组件实例*（完全递归）：实现最简单，长文页（30 段 + 列表 + 表格）
   会有上百个组件实例，首帧与内存都差；改为只在块级 view 嵌套时实例化。
4. *编译期展开固定深度模板*：nodes 是运行时数据（HTML 字符串），编译期不知道深度；列表可任意嵌套。
5. *在组件里 `require('../runtime')` 取管线*：runtime.ts 由 DevTools 的 TS 插件编译，
   plain JS 组件 require 它的相对路径随 dist 布局而变；沿用已有的 `globalThis.__fjsWx` 发布方式。

### 3.3 form 收集 fjs-checkbox / radio（spec Q2）

原生 `form` 只收原生控件和挂了 `wx://form-field` behavior 的自定义组件（读其 `name` / `value`
属性）。给四个 fjs 选择控件挂上该 behavior，交互时把当前态写回 `value` 属性。

**否掉的备选**：*自写 `fjs-form` 组件用 relations 收集*——原生 `input` / `switch` / `slider`
不是自定义组件，relations 够不着，等于放弃原生 form 的收集能力再重造一遍。

## 4. 风险

- **R1 skyline 嵌套 text 的 run 样式支持面**：`vertical-align: sub/super`、`background-color`
  （mark）、`text-decoration` 在 skyline 嵌套 text 上可能不全生效 → 逐项在 DevTools 对照 web，
  不支持的写进已知差异（不静默）。
- **R2 自引用组件 + virtualHost 在 glass-easel/skyline 下的布局**：若 virtualHost 不生效，
  `fjs-rich-node` 宿主会插进 flex 链（块被拉伸 / margin 折叠错位）→ 截图确认；兜底是宿主打
  `.fjs-box` 基线 + `display: contents` 不可用时改为 view 子节点列表直接由父组件画一层。
- **R3 组内 checkbox 的 form-field**：成员 checkbox 带 `name`（组内标识）会被原生 form 当成独立
  字段，违反契约（组替成员汇报）。做法：成员 attached 时发现有 group 关系，就不把状态写进
  form-field 读取的属性（清空其表单 `name` 的方式需实测 glass-easel 行为）；实测不行则在 form
  `submit` 适配处无法区分——届时回到用户确认是否登记为差异。
- **R4 form 载荷键序**：契约是文档序；原生 `detail.value` 的键序依注册顺序，需要和 web 同页对拍。
- **R5 长文首帧**：rich-text 长文段落数 ~50，组件实例限定在块级嵌套处；DevTools 看「重新挂载」无明显卡顿即可，
  真机数值不在本 spec 验收范围。
- **R6 `fjs dev --mp`** 若开着会用旧编译器覆盖 dist：验证前确认没在跑。

## 5. 验证路径

```bash
# 单测
pnpm --filter @ufjs/cli test
pnpm --filter @ufjs/runtime test

# 构建 CLI（mp 编译器走 dist/cli.js）+ 小程序产物
pnpm --filter @ufjs/cli build
pnpm --filter hello-fjs build:mp        # 不应再有 form.vue :class 告警

# DevTools 重开（改了 dist 不会自动重编译），逐页截图对照 web 的 localhost:5173/#/comp/<x>
/Applications/wechatwebdevtools.app/Contents/MacOS/cli close --project examples/hello-fjs/dist/mp
/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project examples/hello-fjs/dist/mp --auto-port 9420
# 顺序：position → picker-view（滚动 + 联动）→ form（输入/开关/提交/重置/聚焦）→ rich-text（逐块 + @tap + 切换 + 重新挂载）
# 最后 Q2 临时页（不提交进仓库）：form 内 checkbox / checkbox-group / radio-group，对拍 web 载荷
```
