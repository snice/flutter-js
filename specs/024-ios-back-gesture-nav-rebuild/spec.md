# Spec: iOS 手势返回被 Navigator.pages 重建打断

- **ID**: 024-ios-back-gesture-nav-rebuild
- **状态**: done
- **日期**: 2026-09-08

## 1. 要解决什么

在 iOS（模拟器/真机）从二级页边缘右滑返回时，转场会卡住或错乱，而不是跟手滑出并完成。`examples/hello-fjs` 的俄罗斯方块页（`tetris.vue`）最明显，录屏里能看到三种连着出现的异常：

1. **半屏卡住**：列表页和方块页对半切开，手势已经松开，页面还不归位、也不出栈。
2. **左侧白边**：方块页几乎全屏，但左边留一条缝，像交互式 pop 开始了又没跟完。
3. **转场中变成占位页**：滑到一半时方块页变成白底 + `CircularProgressIndicator`（`fjs go` / `fjs run` 给 `FjsApp` 的 `placeholder`），底层列表从左边露出来。说明这一刻该路由的 JS root 已经不在镜像树里，或 Navigator 为同一 `navKey` 新建了一条空 route。

点导航栏返回、以及没有持续 JS 帧循环的普通详情页，问题轻得多或没有。用户在方块页点「暂停」后再滑，现象依旧——所以不是「重力 rAF 画布太重所以掉帧」这么简单，而是**返回手势进行时路由栈被重新 diff 了**。

触发条件是：JS 还在往引擎派事件（方块页即使暂停，`tick()` 仍每帧 `requestAnimationFrame`；且 `FjsEngine.dispatchEvent` 无论有没有 UI op 都会 `_scheduleUiNotify()`）。`FjsApp` 把整个 `FjsEngine` 当 `ListenableBuilder` 的 listenable，于是每次 notify 都新建一份 `Navigator.pages`。Flutter 对 `pages` 用的是列表**引用**比较，引用一变就跑 `_updatePages()`，并且 `didUpdateWidget` 会对每条 route 调 `changedExternalState()` → `_forceRebuildPage()`。iOS 的交互式 pop 正好活在这条 route 的 overlay 上：pages 被反复 diff 时，正在 pop 的条目会变成 phantom，同一 page key 会被 `createRoute` 再造一条；手势识别器被整页强制重建后指针丢失，转场就卡住、弹不回去、或露出 placeholder。

这不是 tetris 这一页的写法问题，是 `FjsApp` 把「镜像树刷新」和「原生路由栈刷新」绑在了同一个 notify 上。Canvas / rAF 只是把这个绑得最紧的那类页面。

## 2. 不做什么（Non-goals）

- 不把 QuickJS / canvas  replay 搬到非 UI isolate（宪法 III：JS 就在 UI 线程；那是另一项性能工作）。
- 不改 op 协议、natives 表、事件类型。
- 不改 web 路由（web 没有 iOS 边缘返回；浏览器后退仍走 vue-router）。
- 不把俄罗斯方块改成「暂停即停 rAF」当作本需求的修复（那最多是 demo 卫生，治不了别的持续派事件的页）。
- 不回退 spec 003 的「退出动画播完再 `navPop`」语义：手势返回过程中 JS 页必须还在，不能先卸成 placeholder。

## 3. 用户可见的行为

应用代码、页面写法不变。`router.push` 出去的二级页，在 iOS 上边缘右滑应当：

- 跟手平移，松手后要么弹回当前页，要么滑出并回到上一页。
- 转场过程中始终显示**正在离开的那一页的真实内容**，不能闪成白屏 / loading。
- 动画结束后上一页可点、这一页的 JS 已卸载（和现在点导航栏返回、Android 系统返回一样）。

```vue
<!-- 任何二级页，包括带 canvas + rAF 的 -->
<script setup lang="ts">
import { useRouter } from 'fjs/router';
const router = useRouter();
</script>
<template>
  <view @tap="() => router.push('/example/tetris')">打开</view>
</template>
```

`examples/hello-fjs` 的 `/example/tetris`（游戏进行中或已点暂停）、`/example/gomoku`、普通组件详情页，三种入口的 iOS 手势返回都应满足上面三条。导航栏返回、Android 返回键 / 预测性返回保持现有行为。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 二级页是真正的 `Navigator` 路由；iOS 边缘滑动是平台交互式 pop，进行期间 `pages` 列表不得因 JS UI 帧被重建 | 无边缘返回手势；后退是浏览器历史 / vue-router |
| 事件载荷 | 不新增；`navPop` 仍在 route dispose 之后（spec 003） | 不新增 |
| 已知差异 | 本缺陷只存在于 Flutter 的声明式 `Navigator.pages`；web 不实现 iOS 手势 | 转场仍是 CSS，与本次无关 |

镜像树刷新继续只驱动 `FjsView`（它已经有自己的 `ListenableBuilder`）。`FjsApp` 只应在 `navStack` 真正变化时重建 `pages`。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart lib/src/engine.dart` 无 error。
2. `cd packages/flutter_fjs && flutter test test/nav_router_test.dart` 通过，并覆盖：
   - 二级页已 push 之后，模拟「只有 UI 帧、navStack 不变」的 `notifyListeners`，Navigator 的 `pages` 引用保持不变（或等价：不会对正在 pop 的 route 再 `createRoute`）。
   - 手势/命令 pop 过程中 JS 页仍在（现有「转场结束才 `navPop`」断言不回退）。
   - 点返回 / `fjs.nav.pop` / 系统 pop 最终仍卸载对应 key。
3. `pnpm --filter @ufjs/runtime test` 与 `pnpm --filter @ufjs/runtime run typecheck` 通过（本需求不改 JS 契约，作回归）。
4. `examples/hello-fjs` 在 iOS 模拟器：进入俄罗斯方块（不暂停、点暂停各一次），从左缘滑回「示例」列表——跟手、松手完成或取消，过程中不出现白屏 loading，回到列表后可再进入。
5. 同一模拟器上，从任意普通详情页（无 rAF）手势返回仍正常；导航栏返回仍正常。
6. `docs/routing.md` 写明：宿主 `Navigator.pages` 只跟 `navStack` 走，不跟镜像树刷新走；以及手势返回中途为什么不能卸 JS。

## 7. 待澄清

- [ ] 点导航栏返回（不是边缘滑动）在方块页上是否也有卡顿/白屏？若按钮完全正常、只有手势坏，本 spec 的因果已经够用，不必再扩范围。
- [ ] 五子棋（canvas、无帧循环）手势返回是否也有？用来确认「只要有一次 notify 就会打断」还是「必须持续 rAF」。不挡开工：修复应对两种都成立。
