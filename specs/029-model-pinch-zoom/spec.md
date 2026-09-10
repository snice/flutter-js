# Spec: 模型查看器双指捏合缩放

- **ID**: 029-model-pinch-zoom
- **状态**: in-progress（web 与 iPhone 已验；Android 真机待补，见 tasks T031/T033）
- **日期**: 2026-09-10
- **前置**: 023（两个 glTF 查看器与单指拖拽旋转）、028（呈现路径收口，
  按需渲染的画布才真正能出图）

## 1. 要解决什么

两个 glTF 查看器现在只能**单指拖拽旋转**，模型的远近是写死的：

```ts
// examples/hello-fjs/src/pages/example/gltf-viewer.vue:95
const distance = 3.2;
// examples/hello-fjs/src/pages/example/three-gltf.vue:53
const distance = 3.4;
```

想看清手部、脚部这些细节没有办法 —— 任何一个真实的 3D 查看器都能双指捏合
拉近拉远，这两个页面不能。

顺带暴露的一条：两个页面的 `<canvas>` 都**没有声明 `touch-action`**。单指
旋转能用是因为外层滚动容器的 18px 阈值恰好没被触发（横向拖不引起纵向滚动），
但双指张合是最容易被外层滚动抢走的手势 —— 参照 `drag.vue` 里那条注释：
「这一条是关键：这个节点自己吃掉手势，外层滚动不再跟它抢」。

## 2. 不做什么（Non-goals）

- **不做双指平移（pan）**。捏合改变的只有相机距离，轨道中心保持不动。
- **不做旋转手势（两指转动 → roll）**。
- **不动 `/example/webgl` 三角形页**：它是 GL 指令的最小验证页，加交互会
  模糊它的用途。
- **不新增事件类型**。`FjsTouchEvent.touches` 已经是完整的接触点列表，
  两端同源（`packages/fjs-runtime/src/ui/touch.ts`），这是纯页面侧的事
  （宪法 VII）。
- **不引入 three 的 OrbitControls**。它要的 DOM pointer/wheel 事件这个平面
  不派发（three-gltf.vue 顶部注释已写明），继续手写手势数学。

## 3. 用户可见的行为

两个查看器页，双指放在画布上：

- **张开** → 模型变大（相机拉近）
- **捏合** → 模型变小（相机拉远）
- 单指拖拽旋转**不受影响**；一根手指抬起后剩下的那根不应让模型"跳"一下
- 缩放有上下限，捏到底/张到头就停住，不会翻转或穿进模型内部

页面代码的形状（两页同构，各自的相机模型不同但手势层一样）：

```vue
<canvas
  defer-resize
  ref="cv"
  class="gl"
  @touchstart="onTouchStart"
  @touchmove="onTouchMove"
  @touchend="onTouchEnd"
  @touchcancel="onTouchEnd"
/>
```

```css
.gl {
  width: 340px;
  height: 340px;
  /* 双指张合最容易被外层滚动抢走，这个节点自己吃掉手势 */
  touch-action: none;
}
```

```ts
function onTouchMove(e: FjsTouchEvent) {
  if (e.touches.length >= 2) {
    const d = spread(e.touches[0], e.touches[1]);
    distance = clamp(distance * (lastSpread / d), MIN, MAX);  // 现在是 const
    lastSpread = d;
    requestDraw();
    return;
  }
  // …单指旋转，原样
}
```

`requestDraw()` / `requestRender()` 的按需渲染语义不变（spec 028）：捏合的
每一帧都显式请求一次绘制。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 双指捏合改变相机距离 | 同左（**触摸屏**上同左，鼠标见下） |
| 事件载荷 | `FjsTouchEvent.touches`：`FjsTouch[]`，每项含 `identifier` / `clientX/Y` / `offsetX/Y`，逻辑像素 | 同一个对象，由 web 适配层从 pointer 事件合成（`web/components/touch.ts`） |
| `touch-action: none` | 节点进手势竞技场，手指移动约 8px 抢下指针，早于滚动容器的 18px 阈值 | 原生 CSS |
| 已知差异 | — | **桌面浏览器用鼠标无法捏合**：只有一个指针，合不出第二个 touch。见待澄清 1 |

`touch-action` 与多指 `touches` 都是既有能力，两端同名同义
（`docs/css-compat.md` §3 末尾、`packages/fjs-runtime/src/ui/touch.ts`），
本 spec 不新增任何两端契约。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过
2. `pnpm test` 通过
3. **Android 真机**：两个查看器页各做一次 —— 双指张开模型变大、捏合变小；
   单指拖拽旋转仍然正常；捏到上下限停住不翻转
4. **iOS 真机**：同 3
5. **两页在缩放后再单指旋转**，模型不跳变、不闪回原距离
6. **一根手指抬起**（双指 → 单指）后模型不跳变
7. **画布外的页面仍可正常上下滚动**（`touch-action: none` 只吃画布这块，
   不能把整页滚动废掉）
8. **web 触摸屏**（浏览器 devtools 的触摸模拟或真触屏设备）：3 的表现一致
9. 三角形页 `/example/webgl` 无回归（本 spec 不动它）
10. `docs/ui-api.md` 或 `docs/canvas-compat.md` 记下「多指手势 + `touch-action`
    是画布做交互的标准组合」这条用法

## 7. 待澄清

三条已拍板（2026-09-10）：

- [x] **桌面浏览器（鼠标）** → 选 **(b)**：页面自己加一对 `−` / `+` 按钮做
      缩放。两端都有、鼠标也能点，不用在 `docs/web.md` 登记差异，也不用为
      一个示例页去新增 wheel 事件。按钮与捏合改的是同一个 `distance`，共用
      同一套上下限。
- [x] **缩放范围** → 按初始距离取相对倍率 `[0.4×, 2.5×]`
      （gltf-viewer `[1.28, 8.0]`，three-gltf `[1.36, 8.5]`）。先按这组落地，
      真机上手感不对再调 —— 调的是两个常量，不影响任何结构。
- [x] **023 一并收口** → 是。023 的 T023（iOS draw 无可见输出）与 T032
      （Flutter 端真机对拍）已被 028 解决，本 spec 落地后把 023 转 `done`，
      T023/T032 注明「由 028 解决」，剩下的 T025 是 flutter_angle 的上游缺陷，
      在 023 里保留为已登记的上游遗留。
