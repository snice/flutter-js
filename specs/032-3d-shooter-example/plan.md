# Plan: 3D 飞机大战示例页

对应 [spec.md](spec.md)。只动 `examples/hello-fjs`，runtime / Dart / native 不改。

## 改动

| 文件 | 改什么 |
|---|---|
| `examples/hello-fjs/src/pages/example/shooter.vue` | 整个游戏：场景、模型、批量绘制、玩法、HUD |
| `examples/hello-fjs/README.md` | 「这个示例在验证什么」加一条 |

`catalog.ts` 不用改：「交互游戏」分组已存在。

## 关键决定

- **draw call 控制在 ~30 以内**：App 端每个 draw call 都是一串 uniform 上传进命令流。
  - 每架飞机的零件用 `mergeGeometries` + 顶点色合成**一个 Mesh**；
  - 子弹 / 敌弹 / 爆炸碎片各是一个 `Batch`：预分配定长顶点缓冲，每帧 CPU 侧写位置和颜色，
    `setDrawRange` + `addUpdateRange` 只上传用到的那段。没有 instancing 的替代品。
- **敌机每架一份材质**（不共享）：受击发白要改 `emissive`；参数相同，three 复用同一个 program。
- **首帧前 `renderer.compile()`**：对象池在初始化时建好（隐藏），等 `ctx.ready()` 之后统一编译
  shader，避免第一架轰炸机出场时卡一下。编译必须在 ready 之后（spec 023：ACTIVE_UNIFORMS 过早
  查询会被缓存成空表）。
- **边界从相机反推**：`Raycaster` 把 NDC 角点投到 y=0 平面，得出战机可活动范围、刷怪线、回收线，
  横屏竖屏都对。拖动增益也在这里算成「每像素多少世界单位」，手感不随手指在屏幕上的位置变化。
- **镜头抖动只在 render 前后临时加偏移**：射线求交用的一直是没抖的相机。
- **`defer-resize`**：建场景 + compile 是重活，等转场结束（027）。
- **keep-alive**：`onDeactivated` 停 rAF 并转暂停；暂停时不再 render，只在尺寸变化时补一帧。

## 验证顺序

typecheck → build:pages / build:web → web 预览 → iOS 模拟器。
