# Plan: 表单组件补齐（radio / radio-group / checkbox-group / label / form）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **是** | 5 个新标签 + button/input 的新 props 逐个两端都做。Flutter：`lib/src/widgets/{radio,group,label,form,control_scope}.dart` 新增，`button.dart` / `input.dart` / `checkbox.dart` / `switch.dart` / `slider.dart` 改；Web：`src/web/components/{form.ts,basic.ts,scope.ts}` + `base-css.ts`。两端事件载荷逐字节相同（§3 的载荷表）。没有「只做一端」的项。 |
| II 边界即契约 | **是（事件类型表）** | 新增 20 `onFocus` / 21 `onBlur` / 22 `onFormSubmit` / 23 `onFormReset`，三处同步：`fjs-runtime/src/ui/element.ts` 的 `EventType`、`flutter_fjs/lib/src/ffi.dart` 的 `FjsEvent`、`native/include/fjs.h` 的枚举注释。op 协议、natives 表不动。载荷仍是标量字符串（对象走 JSON 串，同 touch）。 |
| III 同步单线程零序列化 | 否 | 不新增跨线程/异步通道。组与表单的收集全在 Dart 侧同步完成，一次 `dispatch` 出去。 |
| IV 外观照 WeUI | **是（按下态）** | 按下态继续用 WeUI 的 10% 黑遮罩模型（`.fjs-button:active::after` + `button.dart` 的 press mask），新增的 radio / button 变体沿用。**配色按 spec Q1=A 取现有 iOS 色**（`#007AFF` / `#FF3B30`），这是对宪法 IV 的一次显式偏离，理由写在 §3.6。 |
| V 静默失效是 bug | **是** | 三处会静默错的地方要显式警告：① `label` 找不到目标控件 → `warnOnce`；② `radio` / `checkbox` 在组里没写 `name` → `warnOnce`；③ `form` 子树里两个控件同名 → `warnOnce`（后者覆盖前者）。Web 与 Dart 两端都要有。 |
| VI 注释记录权衡 | **是** | 至少四处要留「为什么」：作用域注册而不是遍历镜像树（§3.2）、form 的值从控件当前态读而不是 props（§3.4）、`label`/`form` 从 HTML 兼容表里移走的后果（§3.5）、配色偏离宪法 IV（§3.6）。 |
| VII JS 能包就不要下 Dart | **是（事后）** | 最初把 `form` 放在 Dart，栽在手势竞技场上（§3.8）。改成 `components/form.ts` 后设备上一次通过——这条宪法就是从这次教训里补的。`radio` / 两个 group / `label` 留在 Dart：它们要么自绘控件、要么依赖手势竞技场的裁决，属于「真需要原生」的一侧。 |
| VIII 变更落到文档 | **是** | `docs/ui-api.md`（标签表 + 事件表 + 新 props）、`docs/css-compat.md`（`<label>` / `<form>` 不再映射成 `text` / `view`）、`docs/web.md`（loading 转圈的两端差异）、`docs/roadmap.md`（打勾）。 |

**破例一条**：宪法 IV 说配色照 WeUI，本 spec 的新组件跟现有 iOS 配色走
（用户已拍板 Q1=A）。理由：checkbox `#007AFF` / switch `#34C759` 已经发布，
新组件若用 WeUI 绿会和它们并排出现在同一个表单里。按下态、内边距、圆角这些
仍照 WeUI。整体换色单开 spec。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/tags.json` | +`radio` `radio-group` `checkbox-group` `label` `form` |
| | `packages/fjs-runtime/src/ui/element.ts` | `EventType` +`onFocus:20` `onBlur:21` `onFormSubmit:22` `onFormReset:23` |
| | `packages/fjs-runtime/src/vue/renderer.ts` | ① `H` 表里 `form` / `label` 改成**映射到自己**（`form: {tag:'form'}`、`label: {tag:'label', style:…}`），而不是删除 —— 见 §3.5 的实施修正；② `onSubmit` 按 tag 分流（`form` → 22，`input` → 4），`onReset` → 23 |
| | `packages/fjs-runtime/src/vue-global.d.ts` | 新增 `FjsRadioProps` / `FjsGroupProps` / `FjsLabelProps` / `FjsFormProps`，扩 `FjsButtonProps`（type/size/plain/loading/formType）与 `FjsInputProps`（maxlength/onFocus/onBlur），并在 `FjsGlobalComponents` + `declare module 'vue'` 两处各登记 kebab / Pascal 两个名字 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/scope.ts`（新） | 控件作用域：`provide/inject` 的 registry，含 `parent` 链 |
| | `packages/fjs-runtime/src/web/components/form.ts` | `FjsRadio`（新）、`FjsRadioGroup`（新）、`FjsCheckboxGroup`（新）、`FjsForm`（新）、`FjsLabel`（新）；`FjsInput` 加 `maxlength` / `focus` / `blur`；`FjsCheckbox` / `FjsSwitch` / `FjsSlider` 注册进作用域 |
| | `packages/fjs-runtime/src/web/components/basic.ts` | `FjsButton` 加 `type` / `size` / `plain` / `loading` / `disabled` / `formType` |
| | `packages/fjs-runtime/src/web/components/index.ts` | 注册表 +5 |
| | `packages/fjs-runtime/src/web/base-css.ts` | `.fjs-radio`、`.fjs-button--primary/warn/plain/mini/loading`、`label` / `form` 的默认盒模型 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/control_scope.dart`（新） | `FjsControlHandle`（nodeId/name/kind/getValue/toggle/focus）+ `FjsControlScope` InheritedWidget + 向父作用域转发注册 |
| | `packages/flutter_fjs/lib/src/widgets/radio.dart`（新） | 自绘圆形控件（不用 Material `Radio`） |
| | `packages/flutter_fjs/lib/src/widgets/group.dart`（新） | `radio-group` 互斥 + `checkbox-group` 多选，派发 `valueChanged` |
| | `packages/flutter_fjs/lib/src/widgets/label.dart`（新） | 命中转发：`for` → id 匹配，否则子树第一个控件 |
| | `packages/flutter_fjs/lib/src/widgets/form.dart`（新） | 收集 + 派发 22 / 23 |
| | `packages/flutter_fjs/lib/src/widgets/button.dart` | type/size/plain/loading/disabled/form-type；disabled 从「没挂 onTap」改成显式 prop |
| | `packages/flutter_fjs/lib/src/widgets/input.dart` | `FocusNode` → 20/21，`LengthLimitingTextInputFormatter` → maxlength，`keyboardType` ← `keyboard`（补两端不同源），注册进作用域 |
| | `packages/flutter_fjs/lib/src/widgets/{checkbox,switch,slider}.dart` | 注册进作用域（`name` + 当前值 + toggle 回调） |
| | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | `builtInNodeAdapters` +5 个 adapter |
| | `packages/flutter_fjs/lib/src/ffi.dart` | `FjsEvent` +4 个常量 |
| C++ 引擎 | `packages/flutter_fjs/native/include/fjs.h` | 只补枚举注释（C++ 不解释事件号，不必重编；`natives.cpp` 里没有 `FJS_EVENT_*` 引用） |
| 示例 | `examples/hello-fjs/src/pages/comp/radio.vue`（新）、`form.vue`（新） | 验收用画廊页，`<route>` 的 group 为 `表单组件` |
| 测试 | `packages/fjs-runtime/test/web-form.test.ts`（新） | 组载荷编码、label 转发、form 收集、maxlength 截断 |
| | `packages/flutter_fjs/test/form_controls_test.dart`（新） | 同上四项的 Dart 侧对拍 |
| 文档 | `docs/ui-api.md` / `docs/css-compat.md` / `docs/web.md` / `docs/roadmap.md` | 见 §1 VII |

## 3. 方案

### 3.1 顺序

契约先行，自底向上，每步都能单独跑通：

1. 事件号三处同步（element.ts / ffi.dart / fjs.h）+ tags.json + d.ts
2. 作用域机制（Dart `control_scope.dart` / Web `scope.ts`）—— 后面四个标签都建在它上面
3. `radio` + 两个 group
4. `label`
5. `form` + button 的 `form-type`
6. button 变体、input 的 focus/blur/maxlength/keyboard
7. 示例页 + 单测 + 文档

### 3.2 组 / 表单 / label 共用一套「控件作用域」

每个控件（input / checkbox / radio / switch / slider）挂载时，把一个句柄注册进
**最近的祖先作用域**；作用域自己再把注册向上转发给它的父作用域。
`radio-group` / `checkbox-group` / `label` / `form` 各建一个作用域，
于是四个能力共用同一条注册链：

```
form scope            ← 收集所有句柄的 name/value，submit 时序列化
  └ label scope       ← 只关心「子树里第一个控件」，转发点击
      └ radio-group   ← 互斥：某个 radio 变 true，其余置 false
          └ radio     ← 注册句柄 {nodeId, name, kind, getValue, toggle, focus}
```

- Flutter：`FjsControlScope` 是 InheritedWidget，控件在 `initState` 里
  `dependOnInheritedWidgetOfExactType` 拿到并注册，`dispose` 里注销。
- Web：同一形状的对象用 `provide` / `inject` 传，`onMounted` / `onUnmounted`
  注册与注销。

**被否掉的备选 A：Dart 侧遍历镜像树**（spec §4 最初的写法）。
`MirrorTree` 没有公开的 parent 访问器（`_parentOf` 是私有的），要用得先扩
mirror_tree 的 API；而且遍历拿到的是 props 里的值，读不到未受控 input 的
当前文本（那份在 `TextEditingController` 里）。作用域注册两个问题都没有。

**被否掉的备选 B：只在 Vue 层用 provide/inject 实现**。Vue 渲染器确实留了
`childrenOf` / `parentOf` 映射，够用；但按
[custom-renderer.md](../../docs/custom-renderer.md) 的约定，能力不能只在框架
适配层存在 —— 直接调 element API 的 `examples/hello-js` 也要能用
`radio-group`。

### 3.3 事件载荷（两端逐字节相同）

| 节点 | 事件 | 载荷 |
|---|---|---|
| `radio-group` | 5 valueChanged | 选中项的 `name`，如 `"b"`；无选中为 `""` |
| `checkbox-group` | 5 valueChanged | 选中项 `name` 的 JSON 数组串，按**文档顺序**，如 `["a","c"]` |
| `form` | 22 formSubmit | `{name: value}` JSON 串。input → 字符串；checkbox/switch/radio → `true`/`false`；slider → 数值；group → 字符串或数组。子树里每个带 `name` 的控件都出现（spec Q3） |
| `form` | 23 formReset | 无 |
| `input` | 20/21 focus/blur | 当前文本 |

顺序稳定靠的是注册顺序即挂载顺序 —— Flutter 的 `initState` 与 Vue 的
`onMounted` 都是先子后父、同级按文档顺序，两端一致。这一条要写进注释，
它是「两端 JSON 逐字节相同」的唯一依据。

### 3.4 form 的值从控件当前态读，不从 props 读

fjs 的 input 允许不受控（没有 `value` prop 时，文本只在
`TextEditingController` / DOM 里）。所以句柄暴露的是 `getValue()` 回调，
由控件自己回答，而不是 form 去读 `node.props`。

### 3.5 `label` / `form` 从 HTML 兼容表里移走

`vue/renderer.ts` 的 `H` 表现在把 `<form>` 当 `view`、`<label>` 当带默认样式的
`text`。它们成为真标签后这两条要删，副作用：

- `<label>文字</label>` 之前是一个 text 节点，之后是容器。**label adapter 必须
  在没有子节点时渲染自己的 `node.text`**（照 `button.dart` 的写法），否则文字
  会静默消失 —— 这正是宪法 V 说的那类 bug。
- 之前 `<label>` 自带 `fontSize:14 / color:#666 / margin:4`。新标签保留这组
  默认值（两端同一组数值），已有页面外观不变。

仓库内 `demo/` 与 `examples/` 没有任何 `<label>` / `<form>` 用法（已 grep 确认），
影响面只在外部使用者，登记进 `docs/css-compat.md`。

**实施修正（T006）**：原计划把这两条从 `H` 表里删掉。实际做法是**保留条目、
把 `tag` 指向新标签自己**（`label: { tag: 'label', style: {...} }`）。理由：`H`
表的 `style` 是经由样式引擎（`styleEngine.ensure`）下发的，两端都吃这份默认值；
删掉条目等于让 Flutter 侧失去 label 的默认字号/颜色，还要另找地方补一遍。
保留后「默认样式不变、行为升级成真标签」一次达成，Web 侧的
`label { ... }` 规则取同一组数值。

**Web 侧 label 不用原生 `<label>`**：原生 `<label for>` 只对真正的表单元素
生效，fjs 的 checkbox / radio / switch 在 DOM 里是 `div`，会出现「input 走原生、
其余走 JS」的两套路径，且原生 label 包住 input 时点击会触发两次。
统一渲染成普通容器 + JS 转发，两端同一套逻辑。

### 3.6 button 变体的取值

跟现有 iOS 配色（spec Q1=A），一组数值写两处（`button.dart` 常量与
`base-css.ts` 的 `.fjs-button--*`）：

| 变体 | 背景 | 文字 | 边框 |
|---|---|---|---|
| default | 透明 | `#007AFF` | `1px rgba(0,0,0,0.16)`（现状不变）|
| primary | `#007AFF` | `#FFFFFF` | 无 |
| warn | `#FF3B30` | `#FFFFFF` | 无 |
| primary/warn + plain | 透明 | 同色 | `1px` 同色 |
| mini | — | 12px 字，`6px 12px` padding | — |
| disabled | — | 整体 `opacity: 0.5`，不派发 tap、不出按下态 | — |
| loading | — | 文字前 14px 转圈 + 8px 间距，不派发 tap | — |

按下态仍是 WeUI 的 10% 黑遮罩，填充色变深、白底变灰 —— 现有实现已覆盖，
新变体不另写。

**实施修正（T015）：默认描边从 JS 的 HTML 兼容表挪到 Dart 侧默认值。**
`vue/renderer.ts` 的 `H` 表现在给每个 `<button>` 注入
`border: 1px solid rgba(0,0,0,0.16)`。填充变体（primary / warn）不该有这道
描边，而注入下来的 border 到了 Dart 侧已经是「计算后的样式」，分不清是默认值
还是页面自己写的，压不掉。

改法：`H` 表不再注入 border，改成 Dart 侧的 `fjsButtonDefaultBorder`
常量 —— 与已经这么做的 `fjsButtonDefaultPadding` / `fjsButtonDefaultBorderRadius`
同一套路，只在 `type=default` 且页面没写 border 时才画。页面写的
`border: none` / `border-color: …` 仍然照旧生效。

代价：**新 runtime + 旧 flutter_fjs 宿主**的组合下，default 按钮会没有描边
（旧宿主不认识这个新默认值）。两者在一个项目里由 CLI 一起钉版本，且本仓库
两边同时构建，接受这个代价；代码注释里记这条。

**否掉的备选**：把变体样式做成样式引擎的默认值（JS 一处定义、两端共用）。
需要给 CSS 引擎加 `setDefaults(id, defaults)` —— `ensure()` 只在建节点时写一次，
之后改不了。为一个按钮变体扩 CSS 引擎的公开面，代价大于收益；仓库里
checkbox / switch / input 的默认外观本来就是「Dart 常量 + base-css 手工对齐」
这一套，button 跟着走。

### 3.7 实施修正：布尔 prop 的「无值属性」语义（模拟器上抓到）

`<button type="primary" plain>` 这种**无值属性**，Vue 在 web 侧会按组件声明的
`Boolean` 类型转成 `true`，而 Flutter 路径上它原样过桥，到镜像树里是 `""`。
原来各处写的 `props['x'] == true` 于是在 web 上成立、在 App 上静默失效 ——
模拟器上表现为 plain 按钮画成了填充色。

改法：`mirror_tree.dart` 加 `fjsBool(Object?)`，按 HTML 布尔属性的语义判断
（存在即真，`"false"` / `"0"` / `0` / `null` 为假），`disabled` / `loading` /
`plain` / `secure` / `multiline` 全部改走它。这条对已有标签也是修 bug：
`<input secure>` 之前同样不生效。

### 3.8 实施修正：`form` 改在 JS 侧实现(用户拍板)

模拟器上 `<button form-type="submit">` 点了没反应,而 44 个 widget 测试全过。
排查确认:props 到位、按下态会亮(说明指针命中了这个节点),但
`TextButton.onPressed` 从不触发——设备上赢下手势竞技场的是渲染器给「监听 tap
的节点」加的那层 GestureDetector(`render/gesture.dart`),不是 Material 按钮
自己。`@tap` 按钮一直正常,正是因为它两条路都挂着;只有 `form-type` 的按钮没
有外层那条。

改法(用户提议):**`form` 不再是 Dart 标签,改成 Vue 组件包一层 `view`**,
照 `list-view` 那套——从 Flutter 路径的原生标签集里排除,两端各有实现:

- `packages/fjs-runtime/src/components/form.ts`(Flutter 路径,新)
- `packages/fjs-runtime/src/web/components/form.ts`(web,不变)

这样 `form-type` 按钮由 form 组件给它 `setProps({ onTap })`,退化成一个普通
的 tap 节点,走的正是设备上唯一验证过好使的那条路。

字段发现不能靠 slot vnode 或 provide/inject:Flutter 路径上控件是**元素**不是
组件,而且可以嵌在任意层页面组件里(demo 的字段就装在 `<Panel>` 里)。所以
`ui/element.ts` 记一份 `name` / `form-type` / 当前值(prop 写入 + 事件回派两处
都经过它),form 组件按渲染器维护的影子树 (`childrenOf`) 深度优先遍历自己的
子树来收集。记在 element 层而不是 Vue 层,是因为那是框架无关的一层——raw
element API 的页面同样受用。

删掉的:`widgets/form.dart`、form 的 node adapter、`button.dart` 里的
`fjsFormFor` / `fjsButtonFormAction`、事件号 22/23 的 Dart 常量用法
(号段保留在契约表里,web 侧仍在用)。

**另一处坑**(同一次修正):`isNativeTag` 里 `!FLUTTER_COMPONENT_TAGS.has(tag)`
必须放在最前面。`form` 同时是 HTML 标签,原来的顺序会被后面的 `isHTMLTag(tag)`
把它又判回元素——`list-view` 没这问题只是因为它不是 HTML 标签名。

## 4. 风险

1. **事件号 20-23 与 native 的默契**。C++ 只透传整数，不重编也能跑；但
   `fjs.h` 的枚举是这条边界唯一的文档，漏改会让下一个人以为 20 起是空的。
   任务清单里把它单列一条。
2. **两端 JSON 键序**。`form` 的载荷是对象串，键序不同会让「两端逐字节相同」
   这条验收变成人肉比对。靠 §3.3 的挂载顺序保证，单测要对拍完整字符串。
3. **`label` 的文字消失**（§3.5）。属于静默失效，Dart 侧和 Web 侧各加一条
   单测：`<label>文字</label>` 无子节点时文字仍在。
4. **disabled 语义变更**。button 现在靠「没挂 onTap」判 enabled；加了显式
   `disabled` 后两条规则并存，要确认「挂了 onTap + disabled」不派发、
   「没挂 onTap」仍然是静态按钮外观（不是变淡）。
5. **`checkbox` 的 `name` 是新增可选 prop**，不能影响现有独立用法
   （`examples/hello-fjs/src/pages/comp/checkbox.vue` 一行不改就要通过）。
6. **无值布尔属性**（§3.7）：web 侧 Vue 转布尔、Flutter 侧原样是 `""`。新加
   的 prop 一律走 `fjsBool`。
7. **iOS 上的 `FocusNode`**：input 的 blur 在键盘收起、路由切换、页面销毁
   三种路径下都要只派发一次。模拟器上逐条走。

## 5. 验证路径

```bash
# JS 侧
pnpm run typecheck
pnpm test
pnpm --filter hello-fjs run typecheck

# Dart 侧（先编 native，否则 flutter test 会静默 "No tests ran"）
cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd packages/flutter_fjs && flutter test

# 两端对拍：Web
pnpm --filter hello-fjs run dev:web
# 打开 /comp/radio 与 /comp/form

# 两端对拍：iOS 模拟器（不测 Android）
pnpm --filter hello-fjs run run:ios
```

对拍清单：单选互斥、多选载荷 JSON、点 label 文字能切换 / 聚焦、form 提交的
JSON 键值与键序、button 六种形态的配色与按下态、input 聚焦 / 失焦 / 截断 /
数字键盘。
