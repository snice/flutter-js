# Spec: 3D 飞机大战示例页

- **ID**: 032-3d-shooter-example
- **状态**: done
- **日期**: 2026-09-11

## 1. 要解决什么

hello-fjs 里的 three.js 用法目前只有「按需渲染」一种：两个 glTF 查看器模型加载完
画一帧，拖动时再画。**持续 60fps 刷新、每帧几十个物体在动**的 three.js 场景没有
示例，开发者不知道游戏类的实时 3D 画面在 App 端能不能跑。

「交互游戏」分组里已有 2048（transform）、俄罗斯方块（canvas 2d），缺一个 WebGL 的。

## 2. 不做什么（Non-goals）

- 不改 runtime / `@ufjs/webgl` / Dart / native，不改 op / natives / 事件契约。
- **不用 `InstancedMesh`**：`@ufjs/webgl` 的 context 没有 `drawElementsInstanced` /
  `drawArraysInstanced`，补它是另一个 spec。本页用「一个动态 BufferGeometry 装一批
  小物体」代替，一批一次 draw call。
- 不加音效、不做持久化最高分、不做键盘操作（fjs 没有键盘事件）。
- 不引入模型文件，飞机全用 three 自带几何体拼。
- 不新增依赖（`three@0.170.0` 已在）。

## 3. 用户可见的行为

新页 `examples/hello-fjs/src/pages/example/shooter.vue`，进「示例 → 交互游戏」分组：

```vue
<route>
{"title": "3D 飞机大战", "scroll": false, "group": "交互游戏", "desc": "..."}
</route>
<canvas defer-resize ref="cv" class="gl" @resize="onResize" @touchmove="onTouchMove" />
```

- 斜俯视的 3D 场景：地面网格和浮石往后退，营造前飞感；雾把远处淡出。
- 按住画布拖动，战机跟着手指的**相对位移**走（不跳到手指下，不挡视线），侧移时有滚转。
- 自动开火；吃绿色道具火力升级（1→4 级弹幕），粉色道具回血。被击中降一级火力、短暂无敌闪烁。
- 敌机三种：侦察机（快、蛇形、成群 V 字编队）、战斗机（追踪横移、瞄准射击）、
  轰炸机（约半分钟一架，悬停在上半屏扫射扇形弹 / 环形弹，血厚，必掉道具）。
- 击毁有碎片爆炸、镜头抖动；受伤背景闪红。难度随时间上升。
- 顶部 HUD：得分 / 生命 / 火力 / 暂停。开始、暂停、结束各有遮罩和按钮。
- 离开页面（keep-alive 失活）自动暂停并停掉 rAF。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 渲染 | three `WebGLRenderer` 跑在 `getContext('webgl2' ?? 'webgl')` 上，命令流经 ANGLE 执行 | 浏览器原生 context |
| DOM 缺口 | `@/three/native-polyfills`（spec 023）补 `self` 等；`asDomCanvas` 字面量垫 renderer 要的 canvas 成员 | polyfill 不安装 |
| 输入 | `@touchstart/move/end` 的 `offsetX/offsetY` | 同（web 侧由 pointer 事件合成，鼠标拖动也行） |
| 已知差异 | 无新增 | |

## 5. 契约变更（宪法 II）

- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过。
2. `pnpm --filter hello-fjs run build:pages` 与 `build:web` 通过。
3. `/example/shooter` 出现在示例页「交互游戏」分组。
4. web（`pnpm dev:web`）：开始游戏后场景持续在动、拖动战机、击毁敌机加分、控制台无报错。
5. App 端（模拟器）：同上，画面持续刷新，无 polyfill / GL 报错。
6. 翻到别的页面再回来：处于暂停状态，点继续可接着玩。

## 7. 待澄清

无。
