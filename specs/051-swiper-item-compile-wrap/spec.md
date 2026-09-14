# Spec: swiper 子节点必须是 swiper-item（编译期校验，三端统一）

- **ID**: 051-swiper-item-compile-wrap
- **状态**: done
- **日期**: 2026-09-14

## 1. 要解决什么

`swiper` 的「一页」在三端各自有一套说法，互相不一致：

| 端 | 现在怎么认页 | 代码位置 |
|---|---|---|
| 小程序 | **编译期**把非 `swiper-item` 的子元素包一层 `swiper-item`，`v-for` / `v-if` / `:key` 挪到包装上 | `packages/fjs/src/mp/wxml.ts` `wrapSwiperPages` |
| Web | **运行时**把每个子 vnode 再包一层 `<swiper-item class="fjs-swiper-item">`；页面自己写了 `swiper-item` 就变成两层 | `packages/fjs-runtime/src/web/components/swiper.ts` render |
| Flutter | 直接子节点一个一页；裸子节点不经过 `swiper-item` adapter 的 `SizedBox.expand` + `growChildren` | `flutter_fjs/lib/src/node/node_adapters.dart` |

后果：

1. 同一份 `examples/hello-fjs/src/pages/comp/swiper.vue`，第一个面板（裸 `<view v-for>`）
   和后两个面板（`<swiper-item v-for>`）在三端的 DOM / Widget 层级不一样，
   撑满规则各走各的（web `.fjs-swiper-item > *` 与 `swiper-item > *` 两套、
   小程序 `.fjs-fill`、Flutter `growChildren`）。
2. 小程序是发现「wx 只认 swiper-item」后才补的编译期包装，Flutter / Web 没跟上，
   违背宪法 I。
3. 文档自相矛盾：spec 009 Q2 说「裸子节点仍算一页」，`docs/ui-api.md` §swiper 却写
   「其它子节点照常渲染，只是不会被当成一页」。
4. 小程序现有包装跳过 `<template>`，`<template v-for><view/></template>` 里的 `view`
   不会被包，在 wx 上翻不了页。

## 2. 不做什么（Non-goals）

- 不自动包装：编译期**报错**，不替用户补 `swiper-item`（§7 Q1）。
- 不改 swiper 的 props / 事件（`current`、`circular`、`autoplay`、`@change`、
  `@page-changed` 等保持原样）。
- 不改 UI op 协议、不新增标签。
- 不处理其它小程序「父子约束」标签（`picker-view-column`、`movable-area` 等），
  以后照同一模式另开 spec。

## 3. 用户可见的行为

唯一合法写法：`swiper` 的直接子元素是 `swiper-item`。

```vue
<swiper>
  <swiper-item v-for="s in slides" :key="s">
    <view class="slide">{{ s }}</view>
  </swiper-item>
</swiper>
```

**编译期校验**（三条编译路径共用一份）：

- `swiper` 的直接子元素不是 `swiper-item` → 编译错误，带模板行列号，例如
  `SFC template error (template line 29:9): <swiper> 的直接子节点必须是 <swiper-item>，发现 <view>`。
- 放行：`swiper-item`、注释、空白文本。
- `<template>`（`v-for` / `v-if` 用的透明包裹）不算一层，**递归检查它的子元素**。
- `<slot>` 放行：内容编译期看不到，由使用方自己写 `swiper-item`，运行时兜底（§7 Q3）。
- 自定义组件作为直接子节点 → 报错（组件根是什么编译期不知道；要用组件就包进
  `swiper-item`）。
- 非空文本、插值 `{{ }}` 作为直接子节点 → 报错。

**运行时兜底**（element API、render 函数 / JSX、slot 塞进来的内容，编译期看不到）：

- 非 `swiper-item` 子节点仍当一页照常翻，`warnOnce` 提示应包 `swiper-item`（宪法 V）。
  Flutter 与 Web 用同一条告警文案。

`swiper-item` 撑满一页，它的直接子元素也撑满（`.slide` 不用写高度）。

## 4. 两端约定（宪法 I）

校验函数写一份，放在 `packages/fjs/src/` 下只依赖 `@vue/compiler-core` AST 的模块，
三条编译路径共用：

| | Flutter | Web | 小程序 |
|---|---|---|---|
| 编译入口 | `bundler/vue-plugin.ts` `compileTemplate` 的 `compilerOptions.nodeTransforms` | `vite.ts` 交给 `@vitejs/plugin-vue` 的 `compilerOptions.nodeTransforms`；`fjs dev --web` 走 vue-plugin 同上 | `mp/wxml.ts` 删掉 `wrapSwiperPages`，改为调同一校验，错误进 mp 构建的报错通道 |
| 运行时 | `_SwiperAdapter` pages = 子节点（不变）；遇到非 `swiper-item` 子节点 `warnOnce` | `FjsSwiper` 不再额外包 `fjs-swiper-item`：`swiper-item` 子节点直接当轨道格；非 `swiper-item` 的兜底包一层并 `warnOnce`；circular 克隆同理 | wx 原生 |
| 撑满规则 | `swiper-item` adapter 的 `SizedBox.expand` + `growChildren`（不变） | 只留 `swiper-item` / `swiper-item > *` 一套，`.fjs-swiper-item` 只给兜底包装用 | `.fjs-fill`（不变） |
| 事件载荷 | 不变 | 不变 | 不变 |
| 已知差异 | 无 | 无 | wx 对运行时兜底无能为力（wx 无 element API），编译期已拦住 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过，新增用例：
   - 校验单测（`packages/fjs/test/`）：裸 `view` / 自定义组件 / 插值文本 → 报错且带行列号；
     `swiper-item v-for`、`v-if…v-else` 链、`<template v-for>` 内是 `swiper-item`、
     注释与空白、`<slot>` → 通过；`<template v-for>` 内是 `view` → 报错。
   - `vue-plugin` 路径与 `vite.ts` 路径各一条：裸子节点构建失败、错误文案可读。
   - `mp-compiler.test.ts`：裸子节点报错；`swiper-item` 写法产物不回退。
   - `web-scroll-swiper.test.ts`：传 `swiper-item` 子节点时 DOM 里只有一层 `swiper-item`
     （circular 时 n+2 个）；传裸 `view` 时仍能翻页且触发一次告警。
3. `examples/hello-fjs/src/pages/comp/swiper.vue` 第一个面板改为 `swiper-item` 写法，然后：
   - `pnpm --filter hello-fjs run dev:web`：三块都能翻页、每页撑满，DevTools 里每页只有一层 `swiper-item`。
   - `fjs dev` + 模拟器：三块都能翻页、每页撑满。
   - `pnpm --filter hello-fjs run build:mp` 成功，微信开发者工具里三块都能翻页。
4. 临时把第一个面板改回裸 `view`，`dev:web` / `build` / `build:mp` 三条路径都报同一条编译错误。
5. `examples/hello-js/src/gallery.ts` 的 swiper 改成显式 `swiper-item`（示例不该触发告警）。
6. `cd packages/flutter_fjs && flutter test test/swiper_props_test.dart` 通过（输出不是 `No tests ran`）。
7. 文档（宪法 VIII）：`docs/ui-api.md` §swiper 改成「直接子节点必须是 swiper-item，编译期报错」；
   `docs/web.md` §swiper 删掉「web 侧逐个包成页」；`docs/miniprogram.md` swiper 行改为校验；
   spec 009 Q2 旁注「被 051 取代」。

## 7. 待澄清

- [x] **Q1 裸子节点 → 编译报错**：不自动包装，强制写 `swiper-item`，与小程序规范对齐；
      hello-fjs 第一块跟着改。这是面向用户的 breaking change（spec 009 Q2 的宽松规则作废）。
- [x] **Q2 运行时非 `swiper-item` 子节点 → 兜底当一页 + `warnOnce`**。
- [x] **Q3 `<swiper><slot/></swiper>` → 编译期放行**，使用方自己写 `swiper-item`，运行时按 Q2 兜底。
