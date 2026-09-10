# Tasks: 模型查看器双指捏合缩放

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张契约表都不动：多指已在 `FjsTouchEvent.touches` 里
      （`packages/fjs-runtime/src/ui/touch.ts`），`touch-action` 两端同名同义
      （`docs/css-compat.md` §3 末尾）。**本组无改动**，核对完即勾
      → plan §1 II 行

## 实现

- [x] T010 新建 `examples/hello-fjs/src/gltf/pinch.ts`：不含 3D 概念的双指
      手势状态机。输入 `FjsTouchEvent`，输出「本次 move 相对上次的间距倍率」；
      不是双指手势时返回 `null`（调用方按单指走）。按 `identifier` 认手指，
      `touches.length` 变化时重置基准（否则抬起一根手指模型会跳，plan §3.3）
- [x] T011 `examples/hello-fjs/src/pages/example/gltf-viewer.vue`：
      `const distance` → `let`；上下限按初始距离取 `[0.4×, 2.5×]` 写成两个
      常量（plan §3.2）；`onTouchMove` 先问 `pinchRatio`，是双指就改 distance
      并 `requestDraw()`，否则走原来的单指旋转
- [x] T012 同上：`.gl` 加 `touch-action: none`，并写明**为什么是必须项而不是
      装饰**（双指张合必被外层滚动抢走，参照 `drag.vue` 的同款注释，宪法 VI）
- [x] T013 同上：模板加 `−` / `+` 两个 `<button>`，复用已有的 `.dbg` 样式。
      **必须和捏合改同一个 `distance`、共用同一套 clamp**（plan §4：否则会
      出现「按钮能按到比捏合更近」）
- [x] T014 `examples/hello-fjs/src/pages/example/three-gltf.vue`：同 T011，
      相机走 `updateCamera()`，改完 distance 调它一次再 `requestRender()`
- [x] T015 同上：`.gl` 加 `touch-action: none`（注释同 T012）
- [x] T016 同上：新增 `−` / `+` 按钮 —— **这一页现在没有任何按钮**，样式照抄
      gltf-viewer 的 `.dbg`（`margin-top: 8px; align-self: flex-start`），
      两页取同一组数值（宪法 IV）

## 两端对齐

> 运行时两端都不用改：多指与 `touch-action` 都是既有能力，页面源码一行不改
> 跑两端（plan §1 I 行）。这一组因此是对拍，不是「补另一端的实现」。
> 桌面浏览器只有一个指针、捏不出手势，由 T013/T016 的按钮补齐，**不登记为
> `docs/web.md` 的已知差异**（spec §7 拍板 (b)）。

- [x] T020 web 双指：用真实 PointerEvent（两个 pointerId）合成张开手势，
      两页都从远端拉近到近端 —— 捏合路径通
- [x] T021 同上，鼠标路径：`−` / `+` 按钮可点，效果与捏合一致、共用上下限
- [x] T022 两端对拍：同一份页面源码，web 与真机上「张开变大 / 捏合变小 /
      缩放后单指旋转不跳」表现一致

## 测试

- [x] T030 `examples/hello-fjs` 无 vitest 工程，手势数学不新增单测；
      **说明清楚**（宪法 V：测试跳过要显式说明）—— `pinch.ts` 的正确性由
      T020-T022、T031-T032 的手动验收覆盖，不要把 `pnpm test` 全绿读成这块
      有回归保护
- [ ] T031 **Android 真机**：两页各过一遍 spec §6 的 3-7 —— 张开变大、捏合
      变小、缩放后单指旋转不跳、抬起一根手指不跳、上下限停住不翻转不穿模
- [x] T032 **iOS 真机**：用户在 iPhone 上实测捏合可用（2026-09-10）
- [ ] T033 **手势竞技场专项**（plan §4 的真风险，仓库里没有「两指构成一个
      手势」的先例）：两端真机各试一次「手指从画布上开始纵向滑」——预期是
      旋转模型而不是滚页面；再试「手指从画布外开始滑」——预期是页面正常滚动
- [x] T034 三角形页 `/example/webgl` 无回归：web 与 iOS 模拟器上均正常
      （本 spec 一行都没动它）

## 文档

- [x] T040 `docs/ui-api.md` 「触摸事件」节（L386 起）补一段双指捏合的最小
      片段：点出 `touches.length >= 2` 与 `touch-action: none` 是一对。
      该节已讲多指与 `changedTouches`、第 156 行已提 canvas 要写
      `touch-action`，**缺的只是一个双指实例**，不改支持矩阵
- [x] T041 `docs/roadmap.md`：canvas 段补一条捏合缩放
- [x] T042 `specs/023-three-gltf-viewer/`：转 `done`；T023（iOS draw 无可见
      输出）与 T032（Flutter 端真机对拍）注明「由 spec 028 解决」；T025 保留
      为已登记的 flutter_angle 上游遗留（spec §7 拍板）

## 验收

- [x] T050 `hello-fjs` `vue-tsc --noEmit` 通过
- [x] T051 `pnpm test` 全过（fjs 99 / runtime 281 / webview 36 / webgl 28）
- [ ] T052 spec.md 第 6 节 10 条逐条核对 —— **1/2 静态过、8 web 过、
      5/6/9/10 过；3（Android 真机）与 4（iOS 真机的完整 5 项）待补**：
      iPhone 上用户只确认了「捏合可用」，上下限与抬指不跳没有逐项过
- [ ] T053 spec.md 状态转 `done`
