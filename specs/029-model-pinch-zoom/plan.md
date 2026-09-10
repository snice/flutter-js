# Plan: 模型查看器双指捏合缩放

对应 spec：`./spec.md`（待澄清三条已拍板，见其 §7）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **涉及，且两端都不用改运行时** | 能力本身两端已成立：`FjsTouchEvent.touches` 是完整接触点列表（Flutter 从 `render/touch.dart` 的线格式解码，web 由 `fjs-runtime/src/web/components/touch.ts` 从 pointer 事件合成同一个对象）；`touch-action` 两端同名同义（`docs/css-compat.md` §3 末尾）。所以**改动只在页面**，同一份 `.vue` 跑两端。唯一的两端落差是「桌面浏览器只有一个指针，捏不出来」，用页面自己的 `−`/`+` 按钮补齐（spec §7 拍板 (b)），因此**不需要在 `docs/web.md` 登记差异** |
| II 边界即契约 | **不涉及** | 三张表都不动。不新增事件类型（多指本来就在 `touches` 里）、不动 op 协议、不动 natives |
| III 同步单线程零序列化 | 不涉及 | 手势数学在 JS 侧算完，只改一个 `number`，照旧走 spec 028 的按需渲染（每次手势变化 `requestDraw()` 一次） |
| IV 外观照 WeUI | **涉及（轻）** | 新增的 `−`/`+` 用内置 `<button>`，默认外观即 WeUI；gltf-viewer 已有的 `.dbg` 按钮样式（`margin-top: 8px; align-self: flex-start`）沿用，three-gltf 照抄同一组数值，两页一致 |
| V 静默失效是 bug | **涉及** | 缩放到上下限必须**停住且看得出来**，不能悄悄不动也不能翻转穿模。按钮在到达端点时保持可点但数值被 clamp —— 这是页面行为，不是引擎告警，不需要 `warnOnce` |
| VI 注释记录权衡 | **涉及** | 两处要写明「为什么」：(1) `touch-action: none` 不是可选装饰 —— 双指张合会被外层滚动容器抢走，`drag.vue` 里已有同款注释可参照；(2) 双指抬起一根时为什么要重置基准（`lastSpread`），否则模型会跳 |
| VII JS 能包就不要下 Dart | **完全不下 Dart** | 这个能力要的信息 JS 全都有：`touches` 里两个点的坐标。手势数学、相机距离、上下限都是页面自己的事。判据（宪法 VII「这个能力要的信息 JS 已经有」）直接命中 |
| VIII 变更落到文档 | **涉及（轻）** | `docs/ui-api.md` 的「触摸事件」一节已经讲了多指与 `changedTouches`，第 156 行也已写「自己处理手势的 canvas 记得写 `touch-action: none`」——**缺的是一个双指手势的实例**。补一段捏合片段即可，不需要改支持矩阵 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | — | **不动**（多指与 `touch-action` 都是既有能力） |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | — | 不动 |
| 示例 · 共享 | `examples/hello-fjs/src/gltf/pinch.ts`（新建） | 手势状态机：跟踪两根手指的 `identifier` 与间距，给出「这次 move 相对上次的缩放倍率」；抬起一根时重置基准。与相机模型无关，两页共用 |
| 示例 · 页面 | `examples/hello-fjs/src/pages/example/gltf-viewer.vue` | `const distance` → `let`；`onTouchMove` 分流双指；`.gl` 加 `touch-action: none`；模板加 `−`/`+` 两个 `<button>` |
| 示例 · 页面 | `examples/hello-fjs/src/pages/example/three-gltf.vue` | 同上；相机走 `updateCamera()`，缩放后调它一次；这一页现在**没有任何按钮**，`−`/`+` 是新增 UI，样式照抄 gltf-viewer 的 `.dbg` |
| 文档 | `docs/ui-api.md` 「触摸事件」节（L386 起） | 补一段双指捏合的最小片段，点出 `touches.length >= 2` 与 `touch-action: none` 是一对 |
| 前置 spec | `specs/023-three-gltf-viewer/{spec.md,tasks.md}` | 转 `done`；T023 / T032 注明「由 028 解决」；T025 保留为已登记的 flutter_angle 上游遗留 |

## 3. 方案

### 3.1 手势层与相机层分开

两页的相机模型不同（gltf-viewer 手写 `lookAt`，three-gltf 用
`PerspectiveCamera` + `updateCamera()`），但**手势层完全一样**：拿两根手指的
间距比值。所以抽一个不带任何 3D 概念的小模块：

```ts
// examples/hello-fjs/src/gltf/pinch.ts —— 形状示意，不是最终代码
export function pinchRatio(e: FjsTouchEvent): number | null
```

它只回答一件事：「这次 `touchmove` 相对上次，两指间距变成了几倍」。返回
`null` 表示「这不是双指手势，按单指走」。相机怎么用这个倍率是各页自己的事。

### 3.2 上下限按初始距离取相对倍率

`[0.4×, 2.5×]`（spec §7 拍板）。写成从各页自己的初始 `distance` 推出来的
两个常量，而不是硬编码 1.28 / 8.0 —— 以后谁改了初始距离，上下限跟着走。

### 3.3 抬起一根手指时重置基准

双指变单指的那一帧，如果还拿旧的 `lastSpread` 去比，比值会突变，模型跳一下
（spec §6 验收 6 就是盯这个）。手势模块在 `touches.length` 变化时清掉基准。

### 3.4 `touch-action: none` 是必须项不是优化

两个页面现在都没有。单指旋转能用是侥幸 —— 横向拖不触发外层滚动的 18px 阈值。
双指张合必然被抢。加在 `.gl` 上（只吃画布这一块），页面其余部分照常滚动
（spec §6 验收 7 就是盯这个）。

### 3.5 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| **用 three 的 OrbitControls**（three-gltf 页） | 它要 DOM 的 pointer/wheel 事件，这个平面不派发 —— three-gltf.vue 顶部注释已经写明这一点，当初手写手势就是这个原因。而且只能救一页，手写那页还得自己写 |
| **给 fjs 新增 wheel 事件** | 为一个示例页的桌面 web 体验去动事件类型表（宪法 II 三张表同步 + Flutter 侧下 Dart），代价与收益不成比例。spec §7 拍板用按钮 |
| **桌面 web 就没有缩放，登记成已知差异** | 一行 `<button>` 就能补齐，没必要往 `docs/web.md` 的差异表里加一条永久的坑 |
| **手势代码在两页各写一份** | 15 行 × 2 不算多，但两份会分头长歪（一份修了抬指跳变、另一份没修）。抽出来的是**不含 3D 概念**的纯手势状态机，两页各自的相机代码仍然完整可读 |
| **双指同时做缩放 + 平移** | spec §2 Non-goal。平移要改轨道中心，两页的 target 语义不同（一个是常量数组、一个是 `Vector3`），先把缩放做对 |

## 4. 风险

**手势竞技场是这个 spec 唯一的真风险**。`touch-action: none` 在两端是两套
机制（web 是原生 CSS，Flutter 是进竞技场抢指针，约 8px 阈值 vs 滚动容器的
18px），**双指**这个组合在仓库里还没有先例 —— `drag.vue` 是多指但每根手指
各拖各的块，没有「两根手指一起构成一个手势」的场景。所以验收 3/4/7 必须真机
跑，不能靠 web 上过了就认为两端都过。

**验收 7 与验收 3 是一对矛盾**：画布要吃掉手势、页面又要能滚。`touch-action`
只加在 `.gl` 上而不是外层卡片，就是为了这个；真机上要专门试一次「手指从画布
上开始纵向滑」会发生什么 —— 预期是旋转模型而不是滚页面，这本来就是 023 定的
行为，本 spec 不改它。

**桌面 web 的按钮路径与捏合路径要改同一个 `distance` 并共用同一套 clamp**，
否则会出现「按钮能按到比捏合更近」这种不一致。

**iOS 真机的按需渲染**：捏合的每一帧都要 `requestDraw()`，漏了就是 spec 028
那个「画了没人看见」的坑重演（那边已修好宿主侧，但页面不请求就根本不画）。

## 5. 验证路径

```bash
# 静态
cd examples/hello-fjs && npx vue-tsc --noEmit
pnpm test

# web（触摸屏 / devtools 触摸模拟）
pnpm --filter hello-fjs run dev:web
# 两个 glTF 页：双指张合、单指旋转、页面滚动、−/+ 按钮

# 真机（两端都要，手势竞技场两套机制）
cd examples/hello-fjs && npx fjs run android --device <id>
cd examples/hello-fjs && npx fjs run ios --device <id>
```

每页都要过 spec §6 的 3-7：张开变大、捏合变小、缩放后单指旋转不跳、抬起一根
手指不跳、上下限停住、画布外页面仍可滚动。
