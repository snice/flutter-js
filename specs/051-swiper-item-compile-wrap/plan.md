# Plan: swiper 子节点必须是 swiper-item（编译期校验，三端统一）

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是 | 编译期校验一份（`packages/fjs/src/template/swiper-children.ts`），Flutter 路径 `bundler/vue-plugin.ts`、Web 路径 `vite.ts`、小程序 `mp/wxml.ts` 都调它。运行时兜底：Flutter `node/node_adapters.dart` `_SwiperNodeAdapter`，Web `web/components/swiper.ts`，告警文案相同 |
| II 边界即契约 | 否 | 三张表都不动 |
| III 同步单线程零序列化 | 否 | 纯编译期 + 渲染期判断 |
| IV 外观照 WeUI | 否 | 撑满规则不变 |
| V 静默失效是 bug | 是 | 编译期裸子节点硬报错（带行列号）；运行时兜底 `warnOnce` |
| VI 注释记录权衡 | 是 | 校验模块顶部写「为什么报错而不自动包」「为什么 template 递归、slot 放行」；swiper.ts / adapter 写兜底理由 |
| VII JS 能包就不要下 Dart | 是（小） | Flutter 侧只在已有 adapter 里加一次 `fjsWarnOnce`。放 JS 元素层不行：Vue 的 v-if/fragment 锚点在 `element.insert` 看来就是 `view`，会误报；Dart 侧 `childNodes` 已经滤掉了 `isHidden` 节点，是唯一分得清「真子节点」的地方。行为本身（裸节点当一页）不变，无需新 widget |
| VIII 变更落到文档 | 是 | `docs/ui-api.md` §swiper、`docs/web.md` §swiper、`docs/miniprogram.md` swiper 行；spec 009 Q2 加旁注 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/template/swiper-children.ts`（新） | `swiperChildViolations(el)` 纯函数 + `swiperChildrenTransform: NodeTransform`（`context.onError`） |
| CLI / 构建 | `packages/fjs/src/bundler/vue-plugin.ts` | `compileTemplate` 的 `compilerOptions.nodeTransforms` 加上 transform |
| CLI / 构建 | `packages/fjs/src/vite.ts` | 给 `@vitejs/plugin-vue` 的 `compilerOptions.nodeTransforms` 追加（保留用户已有的） |
| CLI / 构建 | `packages/fjs/src/mp/wxml.ts` | 删 `wrapSwiperPages` / `PAGE_LEVEL_DIRS`；遇 swiper 调纯函数，违规 `throw`（与 scroll-view 缺高度同一条硬错误通道） |
| CLI / 构建 | `packages/fjs/src/mp/project.ts` | 246 行注释措辞 |
| Web 适配层 | `packages/fjs-runtime/src/web/components/swiper.ts` | `swiper-item` 子 vnode 直接 `cloneVNode(+class fjs-swiper-item)` 当轨道格；其余兜底包一层 + `warnControlOnce`；circular 克隆用 `cloneVNode` 带独立 key |
| Web 适配层 | `packages/fjs-runtime/src/web/base-css.ts` | 更新 `swiper-item` / `.fjs-swiper-item` 那两段注释（规则不变：class 选择器压过类型选择器） |
| Dart 宿主 | `packages/flutter_fjs/lib/src/node/node_adapters.dart` | `_SwiperNodeAdapter.build` 对非 `swiper-item` 的 childNodes `fjsWarnOnce`；`_SwiperItemNodeAdapter` 注释去掉「spec 009 Q2」 |
| 示例 | `examples/hello-fjs/src/pages/comp/swiper.vue`、`examples/hello-js/src/gallery.ts` | 改显式 `swiper-item` |
| 测试 | `packages/fjs/test/swiper-children.test.ts`（新）、`mp-compiler.test.ts`、`packages/fjs-runtime/test/web-scroll-swiper.test.ts`、`packages/flutter_fjs/test/swiper_props_test.dart` | 见 tasks |
| 文档 | `docs/ui-api.md`、`docs/web.md`、`docs/miniprogram.md`、`specs/009-scroll-swiper-props/spec.md` | 见 VIII |

C++ 引擎、JS runtime 的 ui 层不动。

## 3. 方案

**一个纯函数，两种接法。** `swiperChildViolations(el: ElementNode)` 走 `@vue/compiler-core` 的
parse AST（`baseParse` 与 `compileTemplate` 的 parse 阶段是同一种节点）：

- 放行 `swiper-item`（含 `SwiperItem`）、`COMMENT`、纯空白 `TEXT`、`slot`；
- `template` 递归它的 children；
- 其余（元素、组件、非空文本、插值）记一条 `{ what, loc }`。

Vue 的 `nodeTransforms` 在**进入**节点时调用，此时子节点还没被 `transformIf/For` 改写，
看到的就是源码结构；`<swiper v-if>` 也一样（transformIf 先把它放进分支，再遍历分支里的
swiper 元素）。报错走 `context.onError`，`compileTemplate` 收进 `tpl.errors`，
vue-plugin.ts 现有的 `SFC template error (template line …)` 格式化直接可用；
`@vitejs/plugin-vue` 把 template errors 转成带位置的 Rollup 错误。

**备选（否掉）**

1. *三端都自动包装（沿用 mp 的 `wrapSwiperPages`）*：用户选了 Q1=报错。另外自动包装要挪
   `v-for` / `v-if` / `:key`，在 compileTemplate 的 transform 阶段改 AST 容易和
   `transformIf` 的相邻分支合并打架（包装节点替换后 `v-else` 找前兄弟）。
2. *只在 runtime 校验*：编译期拦不住小程序（wx 上直接翻不了），也看不到行号。
3. *Flutter 侧告警放 JS `element.insert`*：锚点也是 `view`，误报，见 §1 VII。
4. *正则扫模板源码*：`<template v-for>` 嵌套、注释、字符串里的 `<swiper` 都会判错。

## 4. 风险

- `vite.ts` 里 `template?.compilerOptions?.nodeTransforms` 用户若自己配了，必须拼接不能覆盖。
- web 兜底用 `cloneVNode` 时 `ref` 会被带上（`mergeRef` 默认 false 时保留原 ref），克隆页不能
  也挂同一 ref —— 克隆时显式 `ref: null`? `cloneVNode` 的 extraProps 里给 `ref` 会合并；
  处理：克隆页用 `cloneVNode(page, { key })` 后手动置 `clone.ref = null`。
- circular 以前把同一个 vnode 对象挂进两个包装里，改 `cloneVNode` 后 key 必须互不相同，
  否则 Vue 在同级 keyed diff 里会复用错节点。
- hello-fjs 以外的外部项目会在升级后编译失败——这是有意的 breaking change，文档写明。

## 5. 验证路径

```bash
pnpm run typecheck
pnpm test
cd packages/flutter_fjs && flutter test test/swiper_props_test.dart
pnpm --filter hello-fjs run build           # Flutter 路径能过
pnpm --filter hello-fjs run build:pages     # web 路径能过
pnpm --filter hello-fjs run build:mp        # 小程序能过
# 临时把 swiper.vue 第一块改回裸 view，三条 build 都报同一条错，再改回
pnpm --filter hello-fjs run dev:web         # 浏览器目验三块翻页 + 单层 swiper-item
```
