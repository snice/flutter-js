# Spec: scroll-into-view 可重复触发 + 分组吸顶跳转测试

- **ID**: 054-scroll-into-view-retrigger
- **状态**: ready
- **日期**: 2026-09-15

## 1. 要解决什么

`examples/hello-fjs/src/pages/comp/sticky.vue` 的分组吸顶只有被动滚动 +
事件面板，没有"点了直接跳到 A/B/C/D 组"的入口，无法验证
scroll-view 的 `scroll-into-view` 与 sticky-section 组合在三端的表现。

更重要的是验证时暴露的一个真实缺陷：`scroll-into-view` 在 web
（`fjs-runtime/src/web/components/basic.ts`）与 Flutter
（`flutter_fjs/lib/src/widgets/scroll_view.dart`）两端都是
**值变化才触发**，且把值置空 `''` **不会**重置记忆值。后果：跳到 B 组、
手动滚走后再点"B"，两端毫无反应（且无告警）。微信小程序的惯用法是
先置空再在 nextTick 设回同一 id 来重触发，skyline 对此成立；本仓库两端
不成立 —— 同一份页面源码在 mp 上能重跳、在 Flutter/Web 上是死的，
违反宪法 I（两端同源）。

## 2. 不做什么（Non-goals）

- 不改 scroll-into-view 的定位语义（仍是"测到目标在本滚动容器内的自然
  偏移再位移"，不引入 Scrollable.ensureVisible 式对齐规则）。
- 不给 scroll-view 增加命令式 API（`scrollIntoView()` 方法调用）——
  受控 prop 是既有契约，够用。
- 不做动画时长/曲线配置（沿用 scroll-with-animation 的 250ms）。
- 不动 sticky-header / sticky-section 本身。

## 3. 用户可见的行为

```vue
<scroll-view type="custom" class="group-scroll" scroll-y
             :scroll-into-view="target" scroll-with-animation>
  <sticky-section v-for="g in groups" :key="g.name">
    <sticky-header>
      <view class="cap" :id="g.id">
        <text class="cap-t">{{ g.name }}</text>
      </view>
    </sticky-header>
    <!-- …rows… -->
  </sticky-section>
</scroll-view>

<view class="row">
  <button v-for="g in groups" :key="g.id" class="mini" size="mini"
          @tap="jump(g.id)">跳到 {{ g.id }}</button>
</view>
```

```ts
// 微信惯用法：先清空再设值。运行时补齐"空值重置记忆"后，
// 同一 id 连续两次请求（中间隔着手动滚动）也能重新生效，三端一致。
async function jump(id: string) {
  target.value = '';
  await nextTick();
  target.value = id;
}
```

- 点击按钮，滚动容器平滑滚到对应组头（组头恰好吸顶）。
- **同一按钮重复点击**（中间手动滚走）每次都生效。

## 4. 两端约定（宪法 I；mp 为第三份核对）

| | Flutter | Web | mp (skyline / webview) |
|---|---|---|---|
| 触发条件 | 值变化，或先置空 `''` 再设值（置空重置记忆） | 同左 | 原生：值变化即触发；置空惯用法成立 |
| 目标 | 任意子孙节点的 `id` prop | 同左 | 子元素 `id`（放在 sticky-header 内层普通 view 上，避开 virtualHost 属性归属问题） |
| 匹配不到 | warnOnce，不滚动 | 同左 | 原生行为 |
| 动画 | `scroll-with-animation` → 250ms easeOut | smooth | 原生 |

## 5. 契约变更（宪法 II）

- [x] 都不涉及 —— 不动 op 协议、natives 表、事件类型。改动仅在
  prop 触发判定（两端各自一行级别）+ 示例页。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过。
2. `packages/flutter_fjs/test/scroll_view_props_test.dart` 新增一条：
   scroll-into-view 到达目标 → 手动拖回顶部 → prop 置空再设同一 id →
   仍滚回目标（旧实现该用例红）。
3. `packages/fjs-runtime/test/web-scroll-swiper.test.ts` 新增 web 等价用例。
4. `sticky.vue` 新增 A/B/C/D 跳转按钮（含重复点击场景）：
   - `pnpm --filter hello-fjs run build`（web）与 `build:mp`（小程序产物）通过；
   - web 浏览器目验：四个按钮跳转正确、重复点击同一按钮仍生效、
     组头恰好吸顶；
   - iOS 模拟器目验同上（Flutter 端）。
5. 文档落地（宪法 VIII）：`docs/ui-api.md` scroll-view 表
   `scroll-into-view` 行补"置空重置，可重复请求同一 id"。

## 7. 待澄清

- 无。

## 8. 修订（web/Dart 目验发现第二处缺陷）

置空重触发落地后做三端目验：跳 D 再跳 A，skyline 落在组 A 起点
（组头贴顶、A 组完整可见），web 却落在 A 组快滚完的过渡区——
A、B 两条组头叠在一起。根因：`scroll-into-view` 测量的是目标
**当前绘制位置**，而 sticky 头一旦吸顶/被组推出，绘制位置 ≠ 组的
布局起点；skyline 原生按布局位置算所以正确。修复：

- web（`basic.ts` `scrollIntoViewById`）：目标在 `sticky-header`
  内时改测所在 `<sticky-section>` 的盒子（普通流内盒子，绘制位置
  恒等于布局位置）；裸 header 无 section，退回原测量。
- Dart（`scroll_view.dart` `_scrollIntoView`）：镜像树判定目标在
  sticky-header 子树内后，从渲染树找第一个 sliver 祖先，用
  `childScrollOffset`（组内）+ `scrollOffsetOf`（viewport 层）累加
  布局起点——这些几何对已滚过的 sliver 依然有效，绘制位置无效。
  判定不走渲染树是因为 PinnedHeaderSliver 的渲染类是私有的，
  没有可命名的公开父类；`getOffsetToReveal` 是绘制语义，实测
  不能用。
- `docs/ui-api.md` scroll-into-view 行补「sticky 目标落组起点」。
