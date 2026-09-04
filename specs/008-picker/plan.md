# Plan: 选择器 picker / picker-view / picker-view-column

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **是** | 滚轮两端各一份实现：Flutter `lib/src/widgets/picker_view.dart`（新）+ `node/node_adapters.dart` 注册；Web `src/web/components/picker-view.ts`（新）+ `web/components/index.ts` + `base-css.ts`。`picker` 只有一份（JS 组件），天然同源。事件载荷都是字符串，逐字节相同。 |
| II 边界即契约 | **否** | 不动 op 协议、natives 表、事件类型：`picker-view` 复用 `valueChanged`(5)，载荷是下标数组的 JSON 串（与 checkbox-group 同形）；`picker` 的事件在 JS 侧就地 emit，不过桥。跨桥载荷仍只有标量（spec Q3：对象数组在 JS 摊平）。 |
| III 同步单线程零序列化 | 否 | 不新增异步/跨线程通道。 |
| IV 外观照 WeUI | **是** | 滚轮取 WeUI 的扁平几何（spec Q2）：行高 44、居中一条选中横线、上下蒙层渐隐，两端同一组数值。Flutter 用 `ListWheelScrollView` 但 `diameterRatio` 调大到接近平面，不用 Cupertino 的 3D 卷曲。这一条不破例。 |
| V 静默失效是 bug | **是** | 三处 `warnOnce`：① `picker-view` 里非 `picker-view-column` 的子节点（不渲染，必须出声）；② `picker` 的 `mode` 不认识；③ `date` / `time` 的 `value` 不合格式或落在 `start`/`end` 之外（钳制到边界并告警）。两端都要有。 |
| VI 注释记录权衡 | **是** | 至少四处留「为什么」：modal 从快照改成活内容的做法与代价（§3.2）、滚轮为什么必须下 Dart（§3.3）、`diameterRatio` 为什么调大（§3.4）、change 的派发时机两端为何不同实现却同语义（§3.5）。 |
| VII JS 能包就不要下 Dart | **是（本 spec 的分界线）** | **下 Dart 的只有滚轮**：惯性、吸附、行的 3D 排布与 iOS 触感来自 `ListWheelScrollView`，JS 侧用 `scroll-view` + touch 手写既没有吸附也没有触感——属于条款里「需要平台控件 / Flutter 渲染能力」的一侧。**`picker` 全在 JS**（`fjs-runtime/src/components/picker.ts`）：弹层开合、四种 mode 的列生成与值换算、确定/取消，都是纯编排，按条款不下 Dart，也因此不新增任何 Dart 标签。 |
| VIII 变更落到文档 | **是** | `docs/ui-api.md`（标签表 +2、picker 的 mode 表、modal 那行的「快照」说明要改掉）、`docs/web.md`（触感差异）、`docs/roadmap.md`（打勾 + region/editor 顺延）。 |

无破例项。

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/tags.json` | +`picker-view` `picker-view-column`（`picker` **不进**：它是组件不是标签）|
| | `packages/fjs-runtime/src/components/picker.ts`（新）| `picker` 组件：mode 分派、列生成、值换算、弹层编排 |
| | `packages/fjs-runtime/src/components/picker-modes.ts`（新）| 纯函数：`range`/`range-key` 摊平、time/date 的列生成与范围裁剪、下标 ↔ 值。**不依赖 Vue**，好测 |
| | `packages/fjs-runtime/src/app/flutter.ts` | `app.component('picker', FjsPicker)`（照 `list-view` / `form`）|
| | `packages/fjs-runtime/src/vue-global.d.ts` | `FjsPickerProps` / `FjsPickerViewProps` / `FjsPickerViewColumnProps`，两处注册 kebab + Pascal |
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | `FLUTTER_COMPONENT_TAGS` +`picker`（注意排除判断必须在 `isHTMLTag` 之前——已是现状，不要改回去）|
| Web 适配层 | `packages/fjs-runtime/src/web/components/picker-view.ts`（新）| scroll-snap 列 + 选中框 + `scrollend` 防抖 |
| | `packages/fjs-runtime/src/web/components/index.ts` | 注册表 +2（`picker` 由 `app.component` 走，web 侧同样注册）|
| | `packages/fjs-runtime/src/web/base-css.ts` | `picker-view` / `picker-view-column` / 选中框 / 蒙层的几何，与 Dart 同一组数值 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/widgets/picker_view.dart`（新）| `ListWheelScrollView` 每列一个，`FixedExtentScrollController` 与 `value` 对齐，静止后派发 |
| | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | +2 个 adapter（`picker-view` / `picker-view-column`）|
| | `packages/flutter_fjs/lib/src/widgets/modal.dart` | **打开期间内容保持活的**（spec Q1=A），见 §3.2 |
| 示例 | `examples/hello-fjs/src/pages/comp/picker.vue`（新）、`picker-view.vue`（新）| 四种 mode / 内嵌滚轮 + 联动列，`<route>` group 为 `表单组件` |
| 测试 | `packages/fjs-runtime/test/picker-modes.test.ts`（新）| 纯函数层：日期数学、范围裁剪、`fields` 粒度、`range-key`、越界取末项 |
| | `packages/fjs-runtime/test/picker.test.ts`（新）| 组件层：点插槽弹层、确定/取消、`columnchange` 载荷、`disabled` 不弹 |
| | `packages/flutter_fjs/test/picker_view_test.dart`（新）| 列渲染、`value` 驱动、静止后只派一次、非 column 子节点 warnOnce |
| | `packages/flutter_fjs/test/modal_live_test.dart`（新）| **先写**：锁住现有 modal 行为，再改快照（§3.2）|
| 文档 | `docs/ui-api.md` / `docs/web.md` / `docs/roadmap.md` | 见 §1 VIII |

## 3. 方案

### 3.1 顺序

1. **先把 modal 的行为用测试锁住**，再改成活内容（§3.2）——这是本 spec 唯一
   动到既有能力的地方，先立测试网
2. 纯函数层 `picker-modes.ts` + 它的单测（不碰渲染，最快拿到正确性）
3. `picker-view` / `picker-view-column`：Dart 侧 → web 侧 → 两端几何对齐
4. `picker` 组件（建在 1-3 之上）
5. 示例页 + 两端对拍 + 文档

### 3.2 modal 从「快照」改成「活内容」

现状：`_show()` 把 `widget.children`（打开那一刻已经建好的 widget 列表）塞进
`showModalBottomSheet` 的 builder。sheet 是一条独立路由，只建一次，所以之后
FjsModal 再怎么 rebuild，sheet 里都还是那批旧 widget。

改法：sheet 里不再放「建好的 widget」，而是放一棵**活的子树**——

```
showModalBottomSheet(builder: (ctx) => ListenableBuilder(
  listenable: tree.listenableFor(node.id),      // 子节点增删会 ping 它
  builder: (_, __) => FjsNodeRenderer(
    tree: tree, ids: node.children, dispatch: dispatch),
));
```

`FjsNodeRenderer`（`render/renderer.dart:37`）本来就是按 id 列表挂载、每个节点
各自监听自己的信号，所以孙子节点的变化不需要 modal 操心；modal 只需要在**自己
的子节点列表变了**的时候重建，那正是 `tree.listenableFor(node.id)` 的语义
（`mirror_tree.dart` 的 `markDirty` 会连父节点一起标脏）。

代价与防护：`FjsModal` 要多拿 `tree` 与 `registry` 两个参数（adapter 里都有）。
sheet 内容从此每帧可能重建，先补 `modal_live_test.dart` 锁住四条现有行为
（visible 开/关、原生手势关闭派 `onModalClosed`、内容可滚动、关闭后不再派事件），
再加一条新行为（打开期间改子节点，sheet 里跟着变）。

**被否掉的**：给 modal 加个 `live` 开关、老行为保持默认。多一个开关就多一种
组合要测，而「打开期间内容不更新」本来就是 bug 不是特性——文档里写的是
「v1 限制」。

### 3.3 滚轮为什么下 Dart

`ListWheelScrollView` + `FixedExtentScrollController` 一次给到：整项吸附
（`itemExtent`）、抛掷惯性、滚动静止回调、以及 iOS 上系统自带的触感。用
`scroll-view` + touch 事件在 JS 侧手写，要自己算速度衰减、自己做吸附动画、
触感根本拿不到——这正是宪法 VII 里「需要平台控件」的那一类。web 侧对称地用
`scroll-snap-type: y mandatory`，由浏览器给吸附。

### 3.4 两端的几何（WeUI 扁平，spec Q2）

| | 值 |
|---|---|
| 行高 `item-height` | 44（`itemExtent` / `scroll-snap` 步长）|
| 可见行数 | 5（容器高 220）|
| 选中框 | 居中 44px，上下各一条 1px `#E5E5EA` |
| 上下蒙层 | 白→透明渐隐，各 88px |
| Flutter 特有 | `diameterRatio: 100`（数值越大越接近平面）、`perspective` 取最小值——不要 Cupertino 的卷曲 |

### 3.5 change 的时机：语义同、实现不同

- Flutter：`FixedExtentScrollController` 的 `onSelectedItemChanged` 只在停到某
  一项时回调，直接用。
- Web：优先 `scrollend` 事件；老 Safari 没有，用 150ms 防抖兜底。两端都是
  「停下才派一次」，`docs/web.md` 里登记这条实现差异。

### 3.6 `picker` 组件（全 JS）

```
picker（JS 组件）
├─ 插槽内容 —— 页面自己那一行，包一层 view 收 @tap
└─ modal（visible 由组件自己的 ref 驱动）
   ├─ 取消 / 确定 两个 button
   └─ picker-view（列由 mode 算出来）
```

- `selector`：`range` 摊平成一列。
- `multiSelector`：`range` 是二维；某列停下时先派 `@columnchange`，页面据此
  改 `range`（联动），组件重算其余列——**这条依赖 §3.2 的活内容**。
- `time` / `date`：`picker-modes.ts` 按 `start`/`end`/`fields` 生成列并裁剪；
  换列（比如把年从 2024 改到 2025）要重算天数（闰年/月末）。
- 取消或蒙层关闭 → `@cancel`，不动值；确定 → `@change`。

**被否掉的备选**：`picker` 做成 Dart 标签，弹层与滚轮一起在 Dart 里画。省掉
「活内容」这件事，但违反宪法 VII（编排能在 JS 做），而且四种 mode 的日期数学
要用 Dart 再写一遍、两端各写一次样式——007 的教训就是这么来的。

## 4. 风险

1. **modal 改动的回归面**：所有用 `<modal>` 的页面都受影响。缓解：先测后改
   （§3.2），并在 hello-fjs 的 `comp/modal.vue` 上人工回归一次。
2. **`value` 与滚轮控制器的双向同步**：外部改 `value` 要动画滚过去，用户滚动
   又要回派——处理不好会自激。约定：只有当目标下标与控制器当前项不同才
   `animateToItem`，且回派事件时不写回自己的 `value`。
3. **两端 change 次数不一致**：web 的防抖兜底可能在快速连滚时多派一次。对拍
   时专门数一次事件条数。
4. **日期边界**：闰年 2 月、`start`/`end` 同月、`fields=month` 时日列不出现。
   纯函数层单测覆盖，不靠人肉。
5. **列数变化**（联动把三列变两列）：Dart 侧控制器要跟着增删，不能复用旧的。
6. **`picker-view` 的高度**：没写高度时给默认 220，否则 `ListWheelScrollView`
   在无界约束下会抛异常——`scroll-view` 里嵌套时最容易踩到。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
pnpm --filter hello-fjs run typecheck

cd packages/flutter_fjs/native && cmake -B build-native -DFJS_BUILD_TESTS=ON && cmake --build build-native -j
cd packages/flutter_fjs && flutter test

# 两端对拍
pnpm --filter hello-fjs run dev:web     # /comp/picker 与 /comp/picker-view
pnpm --filter hello-fjs run run:ios     # 同上；Android 不测
```

对拍清单：吸附到整项、change 只在停下派一次且载荷一致、日期范围裁剪、联动列
改第一列后第二列跟着换、取消不改值、`disabled` 不弹、既有 `comp/modal.vue`
行为不变。
