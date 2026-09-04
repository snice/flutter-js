# Spec: 选择器 picker / picker-view / picker-view-column

- **ID**: 008-picker
- **状态**: done
- **日期**: 2026-09-04

## 1. 要解决什么

hello uni-app「表单组件」这一组做完 007 之后还差三个，其中 picker 系列是
**业务写不出来的那一类**：

| uni-app | fjs 现状 |
|---|---|
| `picker` | 没有 |
| `picker-view` / `picker-view-column` | 没有 |
| `editor` | 没有（不在本 spec） |

具体问题：

1. **没有滚轮，业务造不出来**。「从底部弹起、一列或多列、手指一甩带惯性和
   吸附」这套是原生控件的活：Flutter 有 `ListWheelScrollView`，浏览器有
   scroll-snap，但用 fjs 现有的 `scroll-view` + touch 事件手写一个，既做不出
   吸附与磁吸感，也没有 iOS 的触感反馈。这是 007 之后表单页最大的缺口——
   选省份、选时间、选规格，现在只能退化成一长串 radio。
2. **时间/日期没有专用形态**。小程序的 `mode="time" / "date"` 自带列的生成与
   范围裁剪（`start` / `end` / `fields`），页面自己拼要写一堆日期数学。
3. **`modal` 打开期间内容是快照**（[ui-api.md:40](../../docs/ui-api.md)），
   多列联动的选择器（选了「省」要换「市」那一列）在现有弹层里做不了 —— 见
   §7 Q1。

## 2. 不做什么（Non-goals）

- **`mode="region"`（省市区）**：要内置一份行政区划数据集，还要跟着变更维护，
  体量和更新节奏都和「一个组件」不是一回事。等 picker 的列机制稳定后单开。
- **`editor`**：富文本引擎，与本组无关，顺延。
- **`custom-item` / `level` / `header-text`**：分别依赖 region、region、
  Android 专有，随 region 一起顺延。
- **`indicator-class` / `mask-class` / `mask-style`**：小程序的 WebView 专有
  样式钩子。fjs 用 `indicator-style` 一个属性覆盖选中框，蒙层样式不开放。
- **`pickstart` / `pickend`**：滚动开始/结束事件，小程序自己都说会重复触发。
  v1 不做，需要时再补。
- **`immediate-change`**：v1 固定为「滚动停下才派 change」，与两端的默认一致。
- **Android 验证**：只在 Web 与 iOS 模拟器上验收（沿用 007 的约定）。

## 3. 用户可见的行为

### 3.1 picker-view / picker-view-column（页面内嵌的滚轮）

```vue
<picker-view class="wheel" :value="[0, 2]" @change="onChange">
  <picker-view-column>
    <view v-for="y in years" :key="y" class="item">{{ y }}年</view>
  </picker-view-column>
  <picker-view-column>
    <view v-for="m in months" :key="m" class="item">{{ m }}月</view>
  </picker-view-column>
</picker-view>
```

- `value` 是每列选中项的下标数组；越界取最后一项（与小程序一致）。
- `@change` 载荷是下标数组的 JSON 串，如 `[0,2]`，滚动停下才派发。
- `indicator-style` 覆盖中间选中框（支持 `height` / `border` /
  `background-color`）。
- 只认 `picker-view-column` 子节点，其它节点不渲染 —— 与小程序一致，且**要
  warnOnce**，不能悄悄丢（宪法 V）。

### 3.2 picker（从底部弹起的选择器）

```vue
<picker mode="selector" :range="fruits" :value="index" @change="onPick">
  <view class="cell">当前选择：{{ fruits[index] }}</view>
</picker>

<picker mode="date" :value="date" start="2020-01-01" end="2030-12-31"
        fields="day" @change="onDate" @cancel="onCancel">
  <view class="cell">{{ date }}</view>
</picker>
```

- 插槽内容就是页面上那一行；点它弹出选择器。
- 确定 → `@change`，取消/蒙层关闭 → `@cancel`。
- `disabled` 时点了不弹。
- 四种 `mode`，载荷都是字符串（跨桥的硬约束）：

| mode | `value` | `@change` 载荷 | 其它 props |
|---|---|---|---|
| `selector`（默认）| 下标数字 | 下标串，如 `"2"` | `range`、`range-key` |
| `multiSelector` | 下标数组 | 下标数组 JSON 串，如 `[1,0,3]` | `range`（二维）、`range-key`；列变化派 `@columnchange`，载荷 `{"column":0,"value":2}` |
| `time` | `"hh:mm"` | 同格式 | `start` / `end` |
| `date` | `"YYYY-MM-DD"` | 同格式 | `start` / `end` / `fields`(year/month/day) |

### 3.3 分工：滚轮下 Dart，编排留 JS（宪法 VII）

- **Dart / web 各自实现**的只有滚轮本身：`picker-view` +
  `picker-view-column`。Flutter 用 `ListWheelScrollView`（惯性、吸附、
  iOS 触感），web 用 scroll-snap 列。这是「真需要原生」的那一侧。
- **`picker` 是 JS 组件**（`fjs-runtime/src/components/picker.ts`，两端共用）：
  弹层的开合、四种 mode 的列生成与值换算（日期数学、时间范围裁剪、下标 ↔
  标签）、确定/取消按钮，全在 JS。它渲染的是 `modal` + `picker-view` +
  两个 `button`，不新增任何 Dart 标签。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| `picker-view` | 一行 `ListWheelScrollView`，每列一个 | flex 行，每列一个 scroll-snap 容器 |
| `picker-view-column` | 列内子节点即选项，行高取 `item-height`（默认 44） | 同样的行高与选中框几何 |
| 选中框 | 居中一条 44px 高的横条，上下蒙层渐隐 | 同一组数值，CSS 画 |
| `@change` 时机 | 滚动静止后 | `scrollend`（或 150ms 防抖兜底） |
| `picker` | 同一个 JS 组件，无 Dart 实现 | 同左 |
| 事件载荷 | 全字符串：下标串 / 下标数组 JSON 串 / `"YYYY-MM-DD"` / `"hh:mm"` | 同左，逐字节相同 |
| 已知差异 | iOS 滚轮自带触感反馈（系统行为，关不掉）| 无触感。两端都取 WeUI 的扁平几何（Q2），所以只差这一条，登记进 `docs/web.md` |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议 —— **不涉及**。
- [ ] natives 表 —— **不涉及**。
- [ ] 事件类型 —— **不涉及**：`picker-view` 的 `@change` 复用
      `valueChanged`(5)（载荷是 JSON 数组串，与 checkbox-group 同形）；
      `picker` 是 JS 组件，它的 `@change` / `@cancel` / `@columnchange` 在 JS
      侧就地 emit，不过桥。

其它同步点：`tags.json`（+`picker-view` / `picker-view-column`）、
`vue-global.d.ts`、`vue-plugin.ts` 的 `FLUTTER_COMPONENT_TAGS`（+`picker`）、
`app/flutter.ts` 的组件注册、`web/components/index.ts`、`base-css.ts`、
`node_adapters.dart`。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过；新增用例覆盖：四种 mode 的列生成与值换算（含日期范围
   裁剪、`fields` 粒度）、`range-key`、越界 `value` 取末项、多列联动的
   `columnchange` 载荷。
3. `cd packages/flutter_fjs && flutter test` 通过（先编 native；`No tests ran`
   视为失败）。本 spec 新增 `picker_view_test.dart`：列渲染、`value` 驱动、
   停止滚动后派发一次、非 column 子节点 warnOnce。
4. `pnpm --filter hello-fjs run typecheck` 通过。
5. hello-fjs 新增 `src/pages/comp/picker.vue`（四种 mode）与
   `src/pages/comp/picker-view.vue`（内嵌滚轮 + 联动列），`<route>` 的 group
   为 `表单组件`。
6. 两端对拍：Web（`dev:web`）与 iOS 模拟器（`run:ios`）逐条走——滚轮吸附到
   整项、`@change` 只在停下后派一次且两端载荷一致、日期范围外的项不可选、
   多列联动改第一列后第二列跟着换、取消不改值。**Android 不测**。
7. 文档：`docs/ui-api.md`（标签表 + picker 的 mode 表）、`docs/web.md`
   （触感差异）、`docs/roadmap.md` 打勾并注明 region / editor 顺延。

## 7. 待澄清

三条已由用户拍板（2026-09-04），按推荐项定稿：

- [x] **Q1 弹层 → A**：先修 `modal`，让打开期间的内容保持活的，`picker` 复用
      它。理由：这是所有弹层的公共能力，不只 picker 需要；B 会为了绕开它把
      编排下到 Dart，正好违反刚立的宪法 VII。**代价要认**：动
      `widgets/modal.dart` 的快照逻辑可能牵出弹层回归，plan 里要把这块单列
      一步，先补住现有 modal 的行为测试再改。
- [x] **Q2 滚轮外观 → WeUI 扁平**：不用 Cupertino 的 3D 卷曲。Flutter 仍用
      `ListWheelScrollView`，但把 `diameterRatio` 调大到接近平面，两端才画得
      出同一组几何（行高 44、选中框一条横线、上下蒙层渐隐）。宪法 IV 在这里
      不破例。
- [x] **Q3 `range` 的对象数组不跨桥**：`picker` 在 JS 侧按 `range-key` 把它
      摊平成字符串列表再交给 `picker-view`，Dart 只见字符串。跨桥载荷仍然只有
      标量（宪法 II）。
