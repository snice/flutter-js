# Tasks: 小程序端开放 rich-text / picker-view / form / position 四个组件页

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张跨端契约表不动（`ui/ops.ts`、`native-global.d.ts`、`ui/element.ts EventType`）；
  mp 端对齐的页面级载荷契约以 `docs/ui-api.md` 为准：picker-view / picker multiSelector `@change` 下标数组 JSON 串、
  `@columnchange` `{"column","value"}` JSON 串、form `@submit` `{name: value}` JSON 串

## 实现

- [x] T010 `Emitter.assetUrl()` 缓存命中也返回带引号的字面量（`packages/fjs/src/mp/build.ts`）
- [x] T011 `:class` 对象简写 `{ focused }` 展开（`packages/fjs/src/mp/wxml.ts` `inlineClassObject`）
- [x] T012 wx `fjs` 模块导出 no-op `flushNow`（`packages/fjs-runtime/src/wx/fjs-bridge.ts`）
- [x] T013 事件载荷：picker-view change、picker change/columnchange、form submit 改 JSON 串（`packages/fjs-runtime/src/wx/events.ts`）
- [x] T014 picker-view 默认尺寸：编译器给 picker-view 打 `fjs-picker-view`、列的直接子元素打 `fjs-picker-item`，
  静态 `item-height` 换算内联高度，`indicator-style` 默认选中框（`packages/fjs/src/mp/wxml.ts`、`packages/fjs/src/mp/project.ts` `APP_WXSS`）
- [x] T014b picker-view 初始值 / 联动列在 skyline 被丢：`pickerSync` + `rendered` hook + wxs `pickerValue`
  （`packages/fjs-runtime/src/wx/vue.ts`、`instance.ts`，`packages/fjs/src/mp/wxml.ts`、`script.ts`、`project.ts` `FJS_WXS`；plan §3.1 补记）
- [x] T015 `buildWxRichText(nodes, space)`：共享管线 → wx 渲染数据，挂 `globalThis.__fjsWx`（新增 `packages/fjs-runtime/src/wx/rich-text.ts`，`packages/fjs-runtime/src/wx/index.ts`）
- [x] T016 runtime 组件 `fjs-rich-text` / `fjs-rich-node` 四件套（新增 `packages/fjs-runtime/src/wx/components/fjs-rich-text/`、`fjs-rich-node/`）
- [x] T017 编译器 `rich-text` → `fjs-rich-text` + `scope`，登记运行时组件（`packages/fjs/src/mp/wxml.ts`、`packages/fjs/src/mp/project.ts` `RUNTIME_COMPONENTS`、`APP_WXSS` `fjs-rich-text-host`；`build.ts` 汇总 `page-styles.wxss`，见 plan §3.2 实现中修正）
- [x] T018 fjs-checkbox / radio / checkbox-group / radio-group 挂 `wx://form-field`，交互写回 `value`，组内成员不单独进载荷（`packages/fjs-runtime/src/wx/components/fjs-*/*.js`）
- [x] T019 hello-fjs `fjs.mp.exclude` 删四项（`examples/hello-fjs/package.json`）

## 两端对齐

- [x] T020 Web / Flutter 侧对应实现：无需改动（契约已在两端成立，本 spec 是小程序端追平）；
  不能对齐的 skyline 限制登记到 `docs/miniprogram.md`
- [x] T021 DevTools（skyline）逐页与 web `localhost:5173/#/comp/<x>` 对拍：position → picker-view → form → rich-text；
  再用临时页对拍 Q2 的 checkbox/radio 表单载荷（不提交）

## 测试

- [x] T030 编译器单测：`:class` 简写、资源二次 import 带引号、rich-text 映射 + scope、picker-view class（`packages/fjs/test/mp-compiler.test.ts`）
- [x] T031 wx 事件单测：四种载荷（新增 `packages/fjs-runtime/test/wx-events.test.ts`）
- [x] T032 `buildWxRichText` 单测：段落 runs、ol 编号、table 行、img 段落 inline、script 删除、scope class（新增 `packages/fjs-runtime/test/wx-rich-text.test.ts`）

## 文档

- [x] T040 更新 `docs/miniprogram.md`：标签映射表、事件映射、已知差异、hello-fjs 开放页
- [x] T041 `docs/roadmap.md` 小程序待续项打勾

## 验收

- [x] T050 `pnpm --filter @ufjs/runtime typecheck`（或仓库根 typecheck）、`pnpm --filter hello-fjs build:mp` 无新告警
- [x] T051 `pnpm --filter @ufjs/cli test`、`pnpm --filter @ufjs/runtime test`
- [x] T052 spec.md 第 6 节逐条核对

## 验收后反馈

- [x] T060 form 页「不可用」「提交中」按钮与 web 不一致：wx 自带禁用灰底、primary loading 绿底且图标叠在文字上方。
  编译器加 `.fjs-button--disabled` / `--loading` 状态类、自绘 14px 转圈、不再透传 `loading`；flex 改 row
  （`packages/fjs/src/mp/wxml.ts`、`project.ts` `APP_WXSS`、`test/mp-compiler.test.ts`、`docs/miniprogram.md`）
- [x] T061 转圈不转：skyline 不执行 app.wxss 里的 `@keyframes`（DevTools 连续截图对比像素，4 帧相同）。
  spinner 样式移到 `css.ts` `FJS_CLASS_CSS`，随用到它的 SFC wxss 输出（4 帧互不相同）
