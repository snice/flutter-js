# Spec: 表单组件补齐（radio / radio-group / checkbox-group / label / form）

- **ID**: 007-form-components
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

按 hello uni-app「内置组件 → 表单组件」这一组（12 个）盘点，fjs 现状是：

| uni-app | fjs |
|---|---|
| button / input / textarea / checkbox / slider / switch | 有，但属性不全 |
| radio、radio-group、checkbox-group、label、form、picker、picker-view、editor | 没有 |

由此产生的具体问题：

1. **单选写不出来**。没有 `radio`，页面要用 checkbox 手写互斥逻辑，
   每个列表都重写一遍。
2. **多选值要业务自己收**。`checkbox` 是独立布尔控件，没有 group，
   「选中了哪几项」得在页面里维护数组。
3. **点文字不能选中控件**。没有 `label`，20px 的方框是唯一命中区，
   移动端点不准 —— WeUI/小程序的表单行整行可点是默认体验。
4. **表单没有提交语义**。没有 `form`，提交时要手写「把散落的 ref 拼成一个
   对象」，字段一多就容易漏。
5. **button 只有一种长相**。没有 `type` / `size` / `plain` / `loading`，
   主按钮、警告按钮、加载中按钮都要页面自己写样式，且两端各写一遍。
6. **input 缺聚焦语义**。没有 `focus` / `blur` 事件和 `maxlength`，
   做不了「聚焦时高亮、失焦时校验、超长截断」这类最常见的表单交互。
   另外 `keyboard` prop 目前只有 Web 实现，Flutter 侧
   [input.dart](../../packages/flutter_fjs/lib/src/widgets/input.dart) 没接
   `keyboardType` —— 这是一处已存在的两端不同源。

picker / picker-view / editor 不在本 spec，见下一节。

## 2. 不做什么（Non-goals）

- **picker / picker-view / editor**：picker 要落原生滚轮、editor 是富文本引擎，
  各自体量都够单开一个 spec。本组做完再排。
- **表单校验**：`form` 只负责收集与提交/重置，不做 required / pattern / 错误提示。
  校验是业务或上层组件库的事。
- **`hover-class`**：fjs 的按下态走 CSS `:active`（两端都实现了，见
  [base-css.ts:126](../../packages/fjs-runtime/src/web/base-css.ts:126)），
  不引入小程序那套 hover-class / hover-start-time。
- **`open-type`**（微信登录、客服、分享）：微信生态专有，不适用。
- **Android 验证**：本 spec 只在 Web 与 iOS 模拟器上验收（用户明确要求）。
  Android 代码路径与 iOS 共用 Dart 侧实现，不单独跑。

## 3. 用户可见的行为

### 3.1 radio / radio-group

```vue
<radio-group @change="(v: string) => (picked = v)">
  <label class="row" v-for="opt in opts" :key="opt.id">
    <radio :name="opt.id" :value="picked === opt.id" />
    <text>{{ opt.text }}</text>
  </label>
</radio-group>
```

- `radio` 自己是一个圆形控件：`value` 是它的选中态，`name` 是它在组里的标识。
- `radio-group` 保证互斥：组内任一 radio 被点，其余自动取消，
  组节点派发 `@change`，载荷是被选中那个 radio 的 `name`。
- 组外的裸 `radio` 也能用，行为退化成「点了就选中」，由页面自己控 `value`。

### 3.2 checkbox-group

```vue
<checkbox-group @change="(v: string) => (picked = JSON.parse(v))">
  <label v-for="opt in opts" :key="opt.id">
    <checkbox :name="opt.id" :value="picked.includes(opt.id)" />
    <text>{{ opt.text }}</text>
  </label>
</checkbox-group>
```

- 组节点派发 `@change`，载荷是当前选中项 `name` 的 JSON 数组字符串
  （事件载荷必须是字符串，见宪法 II；touch 事件也是这么过的）。
- `checkbox` 现有的独立用法（`value` 布尔 + `@change` 收 `"1"/"0"`）不变，
  已有页面 [checkbox.vue](../../examples/hello-fjs/src/pages/comp/checkbox.vue)
  一行不改。

### 3.3 label

```vue
<label class="row" for="nickname">
  <text class="k">昵称</text>
  <input id="nickname" class="v" placeholder="请输入" />
</label>
```

- 点 label 区域内任意位置 → 把点击转给目标控件：
  - 有 `for` → 找 `id` 等于它的那个控件；
  - 没有 `for` → 找 label 子树里第一个可聚焦/可切换的控件
    （input / checkbox / radio / switch）。
- 对 checkbox / radio / switch 是「切换」，对 input 是「聚焦」。

### 3.4 form

```vue
<form @submit="onSubmit" @reset="onReset">
  <input name="nickname" />
  <switch name="agree" :value="agree" />
  <button form-type="submit">提交</button>
  <button form-type="reset">重置</button>
</form>
```

- `@submit` 载荷是 `{name: value}` 的 JSON 字符串，收集 form 子树里所有带
  `name` 的控件：input / switch / checkbox / radio / slider /
  checkbox-group / radio-group。
- `@reset` 只派发事件，值的回滚由页面做（fjs 的控件是受控的，值在 JS 侧）。
- `button` 新增 `form-type="submit" | "reset"`，点它就触发最近祖先 form。

### 3.5 button 的 type / size / plain / loading / disabled

```vue
<button type="primary">主要操作</button>
<button type="warn" plain>删除</button>
<button type="primary" loading>提交中</button>
<button type="default" disabled>不可用</button>
<button size="mini">小按钮</button>
```

- `type`: `default`（默认）/ `primary` / `warn`；`plain` 是描边版。
- `size`: `default` / `mini`。
- `loading`: 文字前显示转圈，且此时不派发 `@tap`。
- `disabled`: 变淡且不派发 `@tap`、不出按下态。
  现在的 disabled 是「不挂 onTap 就不可点」的隐式实现
  （[button.dart:25](../../packages/flutter_fjs/lib/src/widgets/button.dart:25)），
  改成显式 prop。

### 3.6 input 的 focus / blur / maxlength / keyboard

```vue
<input
  v-model="text"
  :maxlength="10"
  keyboard="number"
  @focus="focused = true"
  @blur="onBlur"
/>
```

- `@focus` / `@blur` 两端都派发，载荷是当前文本。
- `maxlength` 超长直接截断（-1 表示不限），两端同一行为。
- `keyboard`（`text` / `number` / `decimal` / `tel` / `email`）补上 Flutter 侧的
  `keyboardType`，消掉 §1.6 那处两端不同源。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| radio | 自绘圆形控件（不用 Material Radio，避免 40px 点击区） | `<view>` + `.fjs-radio` CSS，与 `.fjs-checkbox` 同源 |
| radio-group / checkbox-group | Dart 侧遍历镜像树子孙节点收集 `name` 与选中态，组节点派发 | Vue 组件 provide/inject，组节点派发 |
| label | 命中后按 `for` / 子树顺序找目标节点，转发切换或聚焦 | 原生 `<label>` 行为不用（fjs 控件不是原生 input），同样走查找+转发 |
| form | Dart 侧遍历子树收集带 `name` 的控件当前值 | Vue 侧同样遍历（组件注册表 + provide） |
| button type/size/plain/loading | 颜色/尺寸常量写在 `widgets/button.dart` | 同一组数值写在 `base-css.ts` 的 `.fjs-button--*` |
| input focus/blur/maxlength | `FocusNode` + `LengthLimitingTextInputFormatter` | `focus`/`blur` 事件 + `maxlength` 属性 |
| 事件载荷 | 全部字符串：group `@change` = `name` 或 JSON 数组串；form `@submit` = JSON 对象串；input `@focus`/`@blur` = 当前文本 | 同左，逐字节相同 |
| 已知差异 | `loading` 的转圈用 Material 的 `CircularProgressIndicator` | 用 CSS 动画；两端视觉近似但不是像素级一致，登记进 `docs/web.md` |

**为什么组逻辑放在两端原生实现，而不是 Vue 层**：JS 侧的 element 是
write-through 的，不保留 props / children（`ui/element.ts`），
Vue 的 provide/inject 只在 Vue 里成立。按
[custom-renderer.md](../../docs/custom-renderer.md) 的约定，
能力不能只在框架适配层存在 —— 直接调 element API 的页面
（`examples/hello-js`）也要能用 `radio-group`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— **不涉及**，没有新 opcode。
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）—— **不涉及**。
- [x] **事件类型**（`ui/element.ts` `EventType` + `lib/src/ffi.dart` `FjsEvent`
      + `native/include/fjs.h` 注释）：新增四个事件号

| 号 | 名字 | 载荷 |
|---|---|---|
| 20 | `onFocus` | 当前文本 |
| 21 | `onBlur` | 当前文本 |
| 22 | `onFormSubmit`（模板里写 `@submit`）| `{name: value}` JSON 串 |
| 23 | `onFormReset`（模板里写 `@reset`）| — |

19 是 `animationFrame`，20 起是空的。事件号只在 JS/Dart 两侧当整数用，
C++ 不解释它们，所以不需要重编 native（`natives.cpp` 里没有 `FJS_EVENT_*`
的引用；`fjs.h` 只是文档）。

组的 `@change` 复用已有的 `valueChanged`(5)。`form` 的 `@submit` 不复用
`textSubmitted`(4)，因为那条已经是「输入框回车」的语义，同一个号两种载荷形状
会让 Dart 侧的分发要看 tag 才能解释载荷。

其它同步点：`tags.json`（+5 个标签）、`vue-global.d.ts`（组件 d.ts）、
`vue/renderer.ts` 的 `HTML_EVENT_ALIASES`（`onSubmit` 在 form 上要落到 22）、
`web/components/index.ts` 注册表、`node_adapters.dart` 的
`builtInNodeAdapters` 列表。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过；新增单测覆盖：group 的互斥/多选载荷编码、label 的目标
   查找、form 的收集、input 的 maxlength 截断。
3. `cd packages/flutter_fjs && flutter test` 通过（先 `cmake --build
   build-native`，看到 `No tests ran` 视为失败）。
4. `pnpm --filter hello-fjs run typecheck` 通过。
5. hello-fjs 新增两个页面：`src/pages/comp/radio.vue`（radio / radio-group /
   checkbox-group / label）与 `src/pages/comp/form.vue`（form + button 变体），
   `<route>` 的 `group` 都是 `表单组件`，首页手风琴里能看到。
6. 同一份源码在两端表现一致，逐条对照：
   - Web：`pnpm --filter hello-fjs run dev:web`，浏览器打开两个新页面；
   - iOS：`pnpm --filter hello-fjs run run:ios`（iOS 模拟器）。
   - 对照项：单选互斥、多选载荷、点 label 文字能切换/聚焦、form 提交出来的
     JSON 键值一致、button 五种形态的配色与按下态、input 聚焦/失焦/截断。
   - **Android 不测**。
7. 文档更新：`docs/ui-api.md`（标签表 + 事件表）、`docs/web.md`（loading
   转圈的两端差异）、`docs/roadmap.md`（打勾）。

## 7. 待澄清

三条已由用户拍板（2026-09-04），按推荐项定稿：

- [x] **Q1 主色 → A**：跟现有 iOS 色。radio 选中态 `#007AFF`，button
      `type=primary` 用 `#007AFF`、`type=warn` 用 `#FF3B30`。不动已发布的
      checkbox / slider / switch 配色 —— 换成 WeUI 绿是一次面向用户的外观
      breaking change，不在本 spec 里做。按下态仍照 WeUI 的 10% 黑遮罩模型
      （宪法 IV 的按下态部分继续生效）。
- [x] **Q2 标识属性名 → `name`**：`value` 恒为控件自身的值（radio/checkbox
      是布尔选中态），`name` 是它在组/表单里的标识。不引入 uni-app 的
      `checked`，避免与现有 checkbox 的布尔 `value` 冲突。
- [x] **Q3 form 收集范围 → 带上默认值**：`@submit` 的 JSON 里，子树中每个带
      `name` 的控件都出现，没被改过的取当前 props 值（input 空串、switch/
      checkbox `false`、slider 取 `min`）。对象形状稳定，与小程序一致。
