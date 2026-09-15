# Tasks: 054 scroll-into-view 可重复触发 + 分组吸顶跳转测试

## T0 web 端

- [x] T001 `fjs-runtime/src/web/components/basic.ts`：`applyProps()` 空值重置
      `lastRequestedView`，注释记录 mp 惯用法依据
- [x] T002 `fjs-runtime/test/web-scroll-swiper.test.ts`：空值重置后同一 id
      可再次滚达的用例

## T1 Dart 端

- [x] T010 `flutter_fjs/lib/src/widgets/scroll_view.dart`：`_applyProps()`
      空值重置 `_lastRequestedView`
- [x] T011 `flutter_fjs/test/scroll_view_props_test.dart`：拖回顶部后
      置空 + 同 id 重触发的用例

## T2 示例页

- [x] T020 `sticky.vue`：groups 加 id、组头 `.cap` 绑 id、scroll-view 绑
      `:scroll-into-view` + `scroll-with-animation`、A/B/C/D mini 按钮行、
      `jump()`（置空 → nextTick → 设值）
- [x] T021 `docs/ui-api.md`：`scroll-into-view` 行补置空重置语义

## T3 回归

- [x] T030 `pnpm run typecheck` + `pnpm test`
- [x] T031 `flutter test`（全量 346 过，~3 skip）
- [x] T032 `pnpm --filter hello-fjs run build` + `build:mp`
- [x] T033 web 浏览器目验：四按钮跳转、重复点击仍生效、D→A 落组起点
      （修订 §8 后复验）
- [x] T034 iOS 模拟器目验：同上（用户验证通过）

## T4 修订（§8：sticky 目标落组起点）

- [x] T040 `fjs-runtime/src/web/components/basic.ts`：sticky 目标改测
      sticky-section 盒子
- [x] T041 `fjs-runtime/test/web-scroll-swiper.test.ts`：sticky 目标落
      组起点用例（桩上区分 section 布局位 / header 绘制位）
- [x] T042 `flutter_fjs/lib/src/widgets/scroll_view.dart`：镜像树判定 +
      sliver 几何累加布局起点（`_sliverLayoutStart`）
- [x] T043 `flutter_fjs/test/sticky_test.dart`：埋到 B 组深处跳回 A 落 0
      的用例
- [x] T044 `docs/ui-api.md`：scroll-into-view 行补 sticky 落点语义
