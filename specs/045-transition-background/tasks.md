# Tasks: transition 过渡——登记既有支持并补背景色

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层

- [x] T001 确认零协议改动：op 协议 / natives / 事件三张表不动；JS 侧与
  web 适配层零改动（`transition` 键字符串透传 + 真 CSS）。

## 实现（Dart）

- [x] T010 `render/decoration.dart`：`box()` 的 decorated 分支加背景色
  动画层——实色背景 + 命中 background-color/all track（duration > 0）
  时用 `TweenAnimationBuilder<Color?>` 驱动 Container；无命中走原路径。
  delay 不生效的差异写在注释里。

## 测试

- [x] T020 背景色过渡 widget 测试：红→蓝中间帧为插值色、结束帧到位；
  无 track / duration 0 瞬时跳变；`all` 命中；gradient 跳变。
- [x] T021 width 过渡：中间帧宽度 140-160（100→200 半程）、无 track 跳变；
  `:active` transform 到达 Transform 包装层的回归用例（断言 X 轴缩放
  `storage[0]`——`getMaxScaleOnAxis` 会读到恒为 1 的 Z 轴，测 2D scale
  别用它）。

## 两端对齐

- [x] T030 `examples/hello-fjs/src/pages/example/transition.vue`：
  `:active` 缩放（transform 过渡，既有能力）+ 背景渐变按钮 + 类切换
  卡片；typecheck + build。
- [x] T031 web（内嵌浏览器，点击采样 mid rgb(19,117,110) 介于绿蓝之间、
  end #1c3d78）与 iOS 模拟器（点击后截图落在渐变中段/终态）对拍一致；
  `:active` 按压缩放在模拟器按住验证生效。

## 文档

- [x] T040 `docs/css-compat.md`：视觉效果表 `transition` ❌→⚠️（支持的
  属性集 + delay/gradient 差异）；`docs/ui-api.md` 样式清单核对；
  `@keyframes` / `animation` 保持 ❌ 并注明顺延。
- [x] T041 `docs/roadmap.md` 近期计划勾选 transition。

## 验收

- [x] T050 `pnpm run typecheck` && `pnpm test`
- [x] T051 `cd packages/flutter_fjs && flutter test`（全量）
- [x] T052 spec.md 第 6 节逐条核对。
