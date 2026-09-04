# Tasks: textarea 组件

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 在 `packages/fjs-runtime/src/ui/element.ts` 的 `EventType` 加 `onLinechange: 28`，驼峰 `onLineChange` 作别名并登记进 `CANONICAL_EVENT_PROP`（模板给出的是全小写拼写，009 在这里哑过火）。
- [x] T002 在 `packages/flutter_fjs/lib/src/ffi.dart` 加 `FjsEvent.lineChange = 28`，注释写清载荷是 `{"height":n,"lineCount":n}`。
- [x] T003 在 `packages/flutter_fjs/native/include/fjs.h` 的枚举加 `FJS_EVENT_LINE_CHANGE = 28`（C++ 不解释事件号，不需重编 native）。
- [x] T004 在 `packages/fjs-runtime/src/vue-global.d.ts` 新增 `FjsTextareaProps`（value / placeholder / placeholderStyle / disabled / maxlength / autoHeight / focus / autoFocus / confirmType / name / 五个事件），并在两处注册 `textarea` 的 kebab 与 Pascal 名；同步给 `FjsInputProps` 补上共用的四个新 props。
- [x] T005 在 `packages/fjs/src/bundler/vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS` 加 `textarea`，确认这条判断排在 `isHTMLTag` 之前（第 126 行附近）。**判错会静默渲染成空白**（plan §4 风险 1）。

## 实现

### 共用语义（先钉死，两端照它写）

- [x] T010 新增 `packages/fjs-runtime/src/textarea/lines.ts`：`lineChangePayload(height, lineCount)`（两字段、顺序固定、height 一位小数）与 `lineState()`（只有行数变化才派、首帧不派）。不依赖 Vue / DOM。
- [x] T011 新增 `packages/fjs-runtime/test/textarea-lines.test.ts`：载荷字段与顺序、首帧不派、同一行数内重复上报不派、行数来回变化各派一次。

### JS 组件

- [x] T012 新增 `packages/fjs-runtime/src/components/textarea.ts`：渲染 `<input multiline>`，给 textarea 的默认值（`maxlength: 140`、`autoHeight: false`、`confirmType: 'return'`），props 归一化，事件透传；`@linechange` 走 T010 的状态机。顶部注释写清「为什么是 JS 组件而不是 Dart 标签」（宪法 VI/VII）。
- [x] T013 在 `packages/fjs-runtime/src/app/flutter.ts` 注册 `app.component('textarea', FjsTextarea)`，挨着现有的 list-view / form / picker。
- [x] T014 删掉 `packages/fjs-runtime/src/vue/renderer.ts` 第 169 行的 HTML 别名 `textarea: { tag: 'input', props: { multiline: true } }`——留着它组件永远不会被实例化（plan §3.6）。
- [x] T015 在 T012 里实现未知 `confirm-type`、`placeholder-style` 不认的键、`focus` 与 `auto-focus` 同时写、以及 Non-goals 那批键盘 props 的 `warnOnce` 降级（宪法 V）。

### Dart（共用 widget）

- [x] T016 改 `packages/flutter_fjs/lib/src/widgets/input.dart` 的 `maxLines`：`autoHeight` 开时 `null`；关且样式没给高时 `3`；关且样式给了高时 `expands: true` + `maxLines/minLines: null`。**`expands` 要求父级有界高度，判断要看解析后的 `style.height` 而不是 props 里有没有 `style`**（plan §4 风险 3）。
- [x] T017 在 `input.dart` 实现 `focus` / `autoFocus`：照 `_lastPropValue` 那套「受控但不粘手」，用户点走造成的失焦不回写、也不因为 prop 还是 true 就把焦点抢回来（plan §4 风险 4）。
- [x] T018 在 `input.dart` 实现 `confirmType` → `TextInputAction` 的映射，`return` 时用 `TextInputAction.newline` 且**不派** `@confirm`；`@confirm` 复用 `FjsEvent.textSubmitted`(4)。
- [x] T019 在 `input.dart` 实现 `placeholderStyle`：只认 color / font-size / font-weight / line-height 四个键，解析复用 `render/style.dart` 现成的那几个，不新写解析器。
- [x] T020 在 `input.dart` 用 `LayoutBuilder` + `TextPainter` 量行数与内容高，文本或宽度变了才重量，派 `FjsEvent.lineChange`；注释指回 `textarea/lines.ts`。

## 两端对齐

- [x] T021 在 `packages/fjs-runtime/src/web/components/form.ts` 的 `FjsInput` 实现同一组能力：`autoHeight`（`rows` 不设 + `scrollHeight` 回写 / `rows="3"` / CSS 高度 + `overflow-y: auto`）、`focus` / `autoFocus`、`confirmType`（`enterkeyhint` + keydown 拦 Enter 后 emit `@confirm`）、`placeholderStyle`（内联 CSS 变量喂 `::placeholder`）、`@linechange`（`scrollHeight / lineHeight`）。
- [x] T022 在 `packages/fjs-runtime/src/web/components/index.ts` 的 `fjsComponents` 注册 `textarea`。
- [x] T023 改 `packages/fjs-runtime/src/web/base-css.ts` 第 199 行：去掉 `resize: vertical`（Flutter 没有拖拽手柄，留着是静默的两端差异）与凭空的 `min-height: 72px`，改成靠 `rows` 撑出三行。
- [x] T024（同一句 98 字符英文、同一个 `.area` 宽度：web 3 行 / 内容高 59px，iOS 3 行 / 内容高 60px —— `lineCount` 相同，`height` 差 1px 属允许范围；`auto-height` 开关、`confirm-type` 的换行与 `@confirm`、`maxlength` 140、`@submit` 载荷 `{"memo":"…"}` 两端逐字符相同）两端对拍：同一段中英混排文本（含连续长单词）在同一宽度下 `@linechange` 的 `lineCount` 逐条相同；`auto-height` 开关的高度行为；`confirm-type` 下 Enter 是换行还是派 `@confirm`；`maxlength` 截断位置。**`height` 允许不同，`lineCount` 不允许**（plan §4 风险 2）。

## 测试

- [x] T030 新增 `packages/fjs-runtime/test/textarea-component.test.ts`：`maxlength` 默认 140 与 `-1` 不限、未知 `confirm-type` 告警、`focus` 与 `auto-focus` 同时写告警、键盘 props 的 `warnOnce`、props 到 `input` 元素的归一化。
- [x] T031 扩 `packages/fjs-runtime/test/` 的 web 组件测试：`autoHeight` 两种形态设到 DOM 上的属性、`confirmType` 的 `enterkeyhint` 与 Enter 拦截、`placeholderStyle` 的四个键与不认的键、`@linechange` 只在行数变化时 emit。
- [x] T032 新增 `packages/flutter_fjs/test/textarea_test.dart`：`autoHeight` 关时是 `maxLines: 3` 而不是撑破盒子、开时跟着长高、样式给高时走 `expands`、`focus` 的受控语义、`confirmType` 到 `TextInputAction` 的映射、`return` 下不派 `@confirm`。
- [x] T033 在 `textarea_test.dart` 覆盖 `@linechange`：行数变化才派一次、首帧不派、宽度变化导致换行时重派。
- [x] T034 加一条编译期断言：`textarea` 在 Flutter 路径上走组件分支而不是元素分支（`packages/fjs/test/` 里对 `vue-plugin` 的现有测试旁边）。**这条判错是静默的**（plan §4 风险 1）。
- [x] T038 新增 `packages/fjs-runtime/src/component-tags.json` 并让 `packages/fjs/src/bundler/vue-plugin.ts` 与 `packages/fjs-runtime/volar.cjs` 共读；把守卫下放进 `webIsNativeTag` 并让 `packages/fjs/src/vite.ts` 走 `isNativeTagFor`（plan §3.7 —— 判定「元素还是组件」的地方**有四处**，plan 只数到两处：Volar 那处是 `vue-tsc` 报错发现的，Web 构建那处是打开示例页看到渲出了原生 `<textarea>` 才发现的，测试全绿）。
- [x] T035 新增 `examples/hello-fjs/src/pages/comp/textarea.vue`：auto-height 开关、字数上限、`@linechange` 实时行数、`confirm-type` 切换、`focus` 按钮。
- [x] T036（**抓到两处只有跑起来才看得见的问题**：判定「元素还是组件」的地方有四处，plan 只数到两处——Web 构建那处让页面渲出了原生 `<textarea>`，typecheck 与单测全绿；auto-height 关掉后，之前长高时写的内联 height 没还给 CSS，盒子停在长高后的尺寸）Web 验证：`pnpm --filter hello-fjs run dev:web`，逐条走 spec §6 的第 4 条与第 7 条（旧写法 `<textarea>` 仍能用、仍能进 `<form>` 的 `@submit`）。
- [x] T037（`confirm-type=return` 时软键盘右下角是换行键 ↵ 且回车真的插入换行、不派 `@confirm`；改成 `send` 后回车派 `@confirm` 且不换行。**软键盘上的「发送」文案没能截到**——模拟器接的是 Mac 硬件键盘，软键盘只在个别时刻弹出；`TextInputAction` 的五个映射由 `textarea_test.dart` 覆盖。**Android 未测**）iOS 模拟器验证：`pnpm --filter hello-fjs run run:ios`，同一份对照项，外加软键盘右下角按键文案随 `confirm-type` 变化。**Android 不测**。

## 文档

- [x] T040 更新 `docs/ui-api.md`：加 `textarea` 标签与 props / 事件表，写明 `@linechange` 不给 `heightRpx`、`maxlength` 默认值与 `input` 不同、以及这些 props 在 `input` 上同样生效但 `textarea` 是规范入口。
- [x] T041 更新 `docs/web.md`：auto-height 两端实现差异、`confirm-type` 在桌面浏览器上的含义、`resize` 手柄的取舍。
- [x] T042 更新 `docs/roadmap.md`：这一组打勾，并把 `<textarea>` 的 `maxlength` 默认值从「不限」变成 140 **单列成一条 breaking change**，写清页面要怎么改（`:maxlength="-1"`）。

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm --filter hello-fjs run typecheck`
- [x] T052 `pnpm test`
- [x] T053 `cd packages/flutter_fjs && flutter test`（`No tests ran` 视为失败）后 `flutter analyze`
- [x] T054 spec.md 第 6 节逐条核对，记录两端对拍结果与任何已登记差异

## 验收记录

对着 spec.md 第 6 节逐条：

1. **typecheck**（`pnpm run typecheck` + `pnpm --filter hello-fjs run typecheck`）通过；
   `auto-height` / `maxlength` / `confirm-type` / `@linechange` 在 hello-fjs 模板里有
   类型——这一条一开始是**红的**，Volar 插件把 `<textarea>` 当 DOM 元素，见 T038。
2. **`pnpm test`** 30 + 6 个文件，230 + 62 条全过。含 `textarea-lines.test.ts`（载荷与
   门）、`textarea-component.test.ts`（默认值、四类告警、事件编排）、
   `web-textarea.test.ts`（rows / enterkeyhint / Enter / 焦点 / placeholder 变量 /
   auto-height 还原）、`vue-plugin-tags.test.ts`（标签判定）。
3. **`flutter test`** 218 passed / 3 skipped / 0 failed；`textarea_test.dart` 16 条覆盖
   三种高度形态、六个 confirm-type、受控焦点、`@linechange` 的首帧不派与宽度变化重测、
   `placeholder-style` 四个键、`maxlength` 截断。`flutter analyze` 2 条既有 info，与本
   spec 无关。
4. **示例页** `comp/textarea.vue`：auto-height 开关、字数上限、`@linechange` 实时行数、
   六个 confirm-type、受控焦点按钮、表单里的 `@submit` 载荷。
5. **Web 操作验收**：默认 140；auto-height 开时 36→94px 跟着长、关时回到样式的 90px 并
   在框里滚；`@linechange` 报 4 行 / 78px 与肉眼一致；`confirm-type=send` 时回车派
   `@confirm` 且 `preventDefault`，`return` 时不派也不拦。
6. **iOS 操作验收**：同一句话在同一宽度下 web 3 行 / 59px、iOS 3 行 / 60px——
   `lineCount` 相同；`@submit` 两端都是 `{"memo":"…"}`；`confirm-type` 的换行/确认行为
   一致。软键盘「发送」文案没截到（模拟器接硬件键盘），映射由 Dart 用例覆盖。
   **Android 未测**。
7. **旧写法**：不带任何 props 的 `<textarea>` 仍能输入，仍能被 `<form>` 的 `@submit`
   按 `name` 收上去（两端都验过）。
8-10. 文档三处已更新，`maxlength` 默认值的破坏性变更在 `docs/roadmap.md` 单列。

**已登记差异**：`height` 两端可差一两像素（字体度量）；`confirm-type` 在桌面浏览器上
只影响 `enterkeyhint`（没有软键盘），但回车行为一致；`<textarea>` 的 resize 手柄两端
都关掉了。
