# Tasks: swiper 子节点必须是 swiper-item

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 无（不涉及 op / natives / 事件）

## 实现

- [x] T010 新建 `packages/fjs/src/template/swiper-children.ts`：`swiperChildViolations` + `swiperChildrenTransform`
- [x] T011 `bundler/vue-plugin.ts` 接入 `nodeTransforms`
- [x] T012 `vite.ts` 接入 `nodeTransforms`（拼接用户已有的）
- [x] T013 `mp/wxml.ts` 删 `wrapSwiperPages`，改为校验并 throw；`mp/project.ts` 注释

## 两端对齐

- [x] T020 Web `web/components/swiper.ts`：swiper-item 直接当轨道格，裸节点兜底 + warn；`base-css.ts` 注释
- [x] T021 Flutter `node_adapters.dart` `_SwiperNodeAdapter` 非 swiper-item 子节点 `fjsWarnOnce`
- [x] T022 `examples/hello-fjs/.../swiper.vue` 第一块、`examples/hello-js/src/gallery.ts` 改显式 swiper-item

## 测试

- [x] T030 `packages/fjs/test/swiper-children.test.ts`：纯函数用例 + compileTemplate 接入用例
- [x] T031 `mp-compiler.test.ts`：裸子节点 throw；swiper-item / template v-for 通过
- [x] T032 `web-scroll-swiper.test.ts`：单层 swiper-item（circular n+2）；裸节点能翻且告警
- [x] T033 `swiper_props_test.dart`：裸子节点告警

## 文档

- [x] T040 `docs/ui-api.md` §swiper、`docs/web.md` §swiper、`docs/miniprogram.md` swiper 行
- [x] T041 `specs/009-scroll-swiper-props/spec.md` Q2 旁注被 051 取代

## 验收

- [x] T050 `pnpm run typecheck`
- [x] T051 `pnpm test`
- [x] T052 `flutter test test/swiper_props_test.dart`
- [x] T053 hello-fjs `build` / `build:pages` / `build:mp` 通过；改回裸 view 三条都报错
- [x] T054 web 浏览器目验三块翻页、单层 swiper-item
- [x] T055 spec.md 第 6 节逐条核对（模拟器、微信开发者工具由用户目验通过）
