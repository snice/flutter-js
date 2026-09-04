# Spec: textarea 组件

- **ID**: 012-textarea
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

现在页面要写多行输入只有两条路，两条都不对：

- `<input multiline>`：`input` 的 Dart 实现 `maxLines: null`（`widgets/input.dart:113`），
  盒子会跟着内容一直长高，没有「固定高度、内部滚动」这一档；`maxlength` 默认 -1
  不限；没有 `focus` / `auto-focus`，页面无法主动让它拿焦点；多行时按 Enter 是换行，
  于是 `@submit` 在 web 侧被显式跳过（`web/components/form.ts:72`），Flutter 侧则
  由系统键盘决定，两端行为对不上；
- `<textarea>`：现在只是 HTML 兼容别名，`vue/renderer.ts:169` 把它重写成
  `input` + `multiline: true`，除此之外没有任何 textarea 语义。

小程序页面迁过来时最常撞的三件事：默认 140 字上限、`auto-height`、以及靠
`bindlinechange` 做「随字数长高但封顶」的输入框——这三样目前一个都没有。

参考：微信小程序 `textarea` 组件文档
`https://developers.weixin.qq.com/miniprogram/dev/component/textarea.html`

## 2. 不做什么（Non-goals）

- **键盘与原生 webview 细节不做**：`cursor-spacing`、`adjust-position`、
  `hold-keyboard`、`show-confirm-bar`、`fixed`、`adjust-keyboard-to`、
  `disable-default-padding`。Flutter 侧没有对应能力，web 侧更无从谈起，做了只能是
  空实现——按宪法 V，空实现比不做更坏。这些 props 出现时统一 `warnOnce` 说明未支持。
- **光标与选区不做**：`cursor`、`selection-start`、`selection-end`。留到需要时另开
  spec，届时要一并解决「受控但不粘手」。
- 不做 Skyline 专属的 `bind:selectionchange` 与三个 IME 合成事件。
- 不改 `input` 现有的 props 与事件载荷形状；`input` 与 `textarea` 共用同一个原生
  widget，但 `input` 的对外契约一行不变。
- 不引入富文本、不做字数计数器 UI（小程序也没有，那是页面自己画的）。
- 不改 UI op 协议，不新开 C ABI。

## 3. 用户可见的行为

```vue
<script setup lang="ts">
import { ref } from 'vue';

const text = ref('');
const lines = ref(1);

function onLineChange(payload: string) {
  const { lineCount } = JSON.parse(payload) as {
    height: number;
    lineCount: number;
  };
  lines.value = lineCount;
}
</script>

<template>
  <textarea
    v-model="text"
    placeholder="说点什么"
    placeholder-style="color: #c0c0c0"
    :maxlength="200"
    auto-height
    confirm-type="send"
    @input="(v: string) => (text = v)"
    @linechange="onLineChange"
    @confirm="(v: string) => send(v)"
  />
  <text>{{ text.length }}/200，共 {{ lines }} 行</text>
</template>
```

### 3.1 标签形态

`textarea` 是 **JS 组件**（宪法 VII），放 `fjs-runtime/src/components/textarea.ts`，
渲染成一个 `<input multiline …>`；web 侧另有实现但契约相同。它不是新的 Dart 标签，
`tags.json` 不加条目——多行输入需要的原生能力全部补在现有 `input` 上。

`vue/renderer.ts` 的 HTML 别名表里那条 `textarea → input multiline` 由这个组件取代。
`<textarea>` 在模板里从此是 fjs 组件：旧页面写的 `<textarea>` 继续能用，并自动获得
下面这些 props；但 `maxlength` 的默认值从「不限」变成 **140**（见 3.2 的破坏性说明）。

### 3.2 props

| prop | 类型 | 默认 | 行为 |
|---|---|---|---|
| `value` | string | `''` | 受控值。和 `input` 一样「受控但不粘手」：prop 没变就不覆盖用户正在输入的内容 |
| `placeholder` | string | `''` | 空内容时的占位符 |
| `placeholder-style` | string | — | 只认 `color` / `font-size` / `font-weight` / `line-height` 四个键，其余键 `warnOnce` 后忽略 |
| `disabled` | boolean | `false` | 不可编辑，也不派事件 |
| `maxlength` | number | **`140`** | 超长直接截断；`-1` 不限。**与 `input` 的默认值（-1）不同**，这是照小程序取的 |
| `auto-height` | boolean | `false` | `true` 时高度跟着内容长，`style.height` 被忽略；`false` 时盒子高度由样式决定，内容超出**在内部滚动**（今天 `input multiline` 是撑破盒子） |
| `focus` | boolean | `false` | 受控焦点：`false → true` 抢焦点，`true → false` 失焦。用户点走造成的失焦不会回写这个 prop |
| `auto-focus` | boolean | `false` | 首帧后抢一次焦点。和 `focus` 同时写以 `focus` 为准并 `warnOnce` |
| `confirm-type` | string | `return` | 键盘右下角按键：`send` / `search` / `next` / `go` / `done` / `return`。`return` 时按键就是换行，**不派** `@confirm`；其余五个按下时派 `@confirm` 且不插入换行。未知值 `warnOnce` 后按 `return` |
| `name` | string | — | 表单字段名，`<form>` 的 `@submit` 用它当键 |

`maxlength` 默认值的变化是**破坏性的**：今天写 `<textarea>` 不带 `maxlength` 的页面
不限长度，改完之后 140 字截断。要不限得显式写 `:maxlength="-1"`。这条要单独写进
`docs/roadmap.md`。

### 3.3 事件

载荷沿用 `input` 的裸字符串，只有 `@linechange` 是 JSON 串——它没有单一自然值。

| 事件 | 载荷 | 何时派 |
|---|---|---|
| `@input` / `@text-changed` | 当前文本 | 每次输入。和 `input` 逐字节相同 |
| `@focus` / `@blur` | 当前文本 | 拿到/失去焦点，一次转换一条 |
| `@confirm` | 当前文本 | `confirm-type != return` 时按下键盘确认键 |
| `@linechange` | `{"height":68,"lineCount":3}`，字段顺序固定，`height` 是内容行盒总高（逻辑像素，一位小数） | 行数变化时派一次；**只有变化才派**，同一行数内继续输入不重复派；首帧的初始行数不派 |

`@linechange` 不给 `heightRpx`：rpx 是小程序的设计宽度单位，fjs 没有这个坐标系，
给一个假的换算比给不出更糟（宪法 V）。这条差异写进 `docs/ui-api.md`。

`@confirm` 复用现有的 `FJS_EVENT_TEXT_SUBMITTED`（4），不新开事件号——它就是
`input` 的 `@submit` 在多行下的名字。`@linechange` 需要行数，那是布局结果，JS 拿不到，
所以新登记事件号 **28**。

### 3.4 auto-height 的两种形态

| | `auto-height`（true） | 默认（false） |
|---|---|---|
| 高度 | 内容有几行就多高，忽略 `style.height` | 由 `style.height` 决定，没写就是**三行**的高度 |
| 超出时 | 不会超出——盒子跟着长 | 内部滚动，外层布局不动 |
| `@linechange` | 照派 | 照派（行数变了，只是盒子不变） |

「三行」这个默认高度不写成一个像素数，两端各自用「三行」这个说法表达
（Flutter 的 `maxLines: 3`、web 的 `rows="3"`），于是字号一变高度自动跟着变，
也不用各自去算 padding。—— 这一句在 `/plan` 阶段按实现方式改过，原文写的是
「行盒高 × 3 + 上下 padding」。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 标签 | `components/textarea.ts` 渲染 `<input multiline>`，落到现有 `widgets/input.dart` 的 TextField | 同一个组件契约，web 侧渲染 `<textarea class="fjs-input">` |
| `auto-height` true | `maxLines: null`（今天的行为） | `height: auto` + 每次输入把 `scrollHeight` 写回高度 |
| `auto-height` false | `expands: true` + 外层限高，TextField 内部滚动 | `overflow-y: auto`，浏览器原生滚动 |
| `focus` / `auto-focus` | `FocusNode.requestFocus()` / `unfocus()` | `el.focus()` / `el.blur()` |
| `confirm-type` | `TextInputAction`（send/search/next/go/done），`return` 时 `TextInputAction.newline` | `enterkeyhint` + keydown 里拦 Enter |
| `placeholder-style` | 解析成 `hintStyle` 的四个字段 | 内联 CSS 变量喂给 `::placeholder` |
| `@linechange` | TextPainter 量出的行数与高度 | `scrollHeight / lineHeight` 推出的行数 |
| 事件载荷 | 裸文本串；`@linechange` 是 `{"height":n,"lineCount":n}` | 与 Flutter 逐字符相同 |
| 已知差异 | iOS 键盘的「完成」栏由系统决定，`confirm-type` 只改右下角按键 | 浏览器不提供软键盘，`confirm-type` 只影响移动端 `enterkeyhint`，桌面上按 Enter 的行为由 `confirm-type` 决定 |

`height` 的数值两端不可能逐位相同（字体度量不同），但**行数必须相同**，且同一段
文本在同一宽度下两端的行数一致。这是 `@linechange` 的可验证部分。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— 不涉及
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— 不涉及
- [x] 事件类型（`element.ts` + `fjs.h`）：新增 `onLinechange: 28` /
      `FJS_EVENT_LINE_CHANGE = 28`，载荷仍是字符串
- [x] `FjsEvent.lineChange` Dart 常量
- [x] `vue-global.d.ts` 的 `FjsTextareaProps` 与模板事件类型；`tags.json` **不加**
      `textarea`（它是 JS 组件）
- [x] `fjs/src/bundler/vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS` 加 `textarea`（实际是**四处**判定，见 plan §3.7），
      且必须排在 `isHTMLTag` 之前判——`textarea` 是真 HTML 标签，顺序错了会被判回
      元素（宪法 VII 里 `form` 踩过的同一个坑）

## 6. 验收标准

1. `pnpm run typecheck` 与 `pnpm --filter hello-fjs run typecheck` 通过，且
   `textarea` 的 `auto-height` / `maxlength` / `confirm-type` / `@linechange`
   在 `hello-fjs` 模板里有类型。
2. `pnpm test` 通过，并新增纯 JS 测试：`maxlength` 默认 140 与 `-1` 不限、
   `confirm-type` 的合法值与未知值告警、`focus` 与 `auto-focus` 同时写时的告警、
   `@linechange` 的 JSON 字段顺序与「只有变化才派」。
3. `cd packages/flutter_fjs && flutter test` 通过（`No tests ran` 视为失败），
   并覆盖：`auto-height` 关时 TextField 内部滚动而不是撑破盒子、开时跟着长高、
   `focus` prop 的受控语义、`confirm-type` 到 `TextInputAction` 的映射、
   `@confirm` 在 `return` 下不派、`@linechange` 行数变化才派一次。
4. `pnpm --filter hello-fjs run dev:web` 上操作新的示例页：默认 140 字截断、
   `auto-height` 开关时高度行为符合 3.4 的表、`@linechange` 的 `lineCount` 与肉眼
   数到的行数一致、`confirm-type="send"` 时 Enter 派 `@confirm` 而不换行。
5. iOS 模拟器上跑同一页：同样的对照项，外加软键盘右下角按键文案随
   `confirm-type` 变化；`@linechange` 的 `lineCount` 与 web 相同。**Android 不测**。
6. 同一段文本在两端同一宽度下 `@linechange` 的 `lineCount` 相同（`height` 允许不同）。
7. 旧写法 `<textarea>` 不带任何 props 仍能输入、仍能进 `<form>` 的 `@submit`。
8. `docs/ui-api.md` 增 `textarea` 标签与 props/事件表，并写明 `@linechange` 不给
   `heightRpx`、`maxlength` 默认值与 `input` 不同。
9. `docs/web.md` 记两端的 auto-height 实现差异与 `confirm-type` 在桌面浏览器上的含义。
10. `docs/roadmap.md` 登记完成，并把 `<textarea>` 的 `maxlength` 默认值变化**单列成
    一条 breaking change**，写清页面要怎么改。

## 7. 待澄清

- [x] 已确认：事件载荷沿用裸字符串，只有 `@linechange` 用 JSON 串。
- [x] 已确认：`textarea` 是 JS 组件包 `input`，不新增 Dart 标签。
- [x] 已确认：只做核心组，光标/选区与键盘细节都不做。
