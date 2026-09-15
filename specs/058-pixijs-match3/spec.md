# Spec: hello-fjs 增加 PixiJS 示例 —— 消消乐（match-3）

- **ID**: 058-pixijs-match3
- **状态**: in-progress
- **日期**: 2026-09-15

## 1. 要解决什么

hello-fjs 的画布演示/交互游戏目前覆盖了 canvas 2d（2048、tetris、大西瓜）、
Spine（@ufjs/spine）、three.js（gltf viewer、shooter），但没有
[PixiJS](https://github.com/pixijs/pixijs) —— 生态里最常用的 2D WebGL
渲染器。参考实现
[pixi-game-match3](https://github.com/xiaozhu188/pixi-game-match3)
（pixi 7 + assetpack + pixi-spine + @pixi/ui + @pixi/sound + gsap）证明了
PixiJS 做休闲游戏的典型形态。

目标：在 hello-fjs 里加一个 PixiJS 渲染的消消乐页面，验证「第三方渲染库
+ `@ufjs/webgl` 桥」这条路在 web 和 Flutter 两端都能跑通，给后续想用
PixiJS 的业务趟清启动前提。

**为什么放进 hello-fjs 而不是像 racing 那样单独开项目**：参考仓库整体
移植（素材管线、spine、声音、UI 库）才是 racing 量级；本 spec 是自写
紧凑玩法 + 零素材（Graphics 画宝石），规模与 hello-fjs 现有游戏页
（tetris / 大西瓜）一致。大而全的移植留作后续单独 spec。

## 2. 不做什么（Non-goals）

- 不移植 pixi-game-match3 的素材、美术、spine 动画、声音和 @pixi/ui ——
  只参考它的玩法规则（交换、三消、下落补充、死局重排）。
- 不用 AssetPack / 贴图 / 图片素材：宝石用 Pixi Graphics 矢量绘制，
  绕开纹理上传路径（该路径 three.js glTF 已验证过，不是本次的验证点）。
- 不接入 Pixi EventSystem 的命中测试 —— 页面自己把 fjs 触摸事件换算成
  棋盘格子（与 spine.vue 的 handleTouch 同一模式）。
- 不支持微信小程序：页面加进 hello-fjs 的 `fjs.mp.exclude`（webgl 重页
  在 mp 上本来就是排除的，与 webgl-instanced / three-gltf / shooter 同列）。
- 不动 `@ufjs/runtime`、`@ufjs/webgl`、flutter_fjs —— 预期纯示例层改动；
  如果实现中发现桥缺方法，停下来更新本 spec 而不是顺手改包。
- 不做最高分持久化、音效、动效打磨（到达"玩法完整可玩"即可）。

## 3. 用户可见的行为

hello-fjs 首页「交互游戏」分组出现「消消乐（PixiJS）」页
（`/pages/example/game/match3`），web 和 app 同一份源码：

- 8×8 棋盘、6 种颜色的宝石（Graphics 绘制），进入页面即有初始布局且
  **无现成三消、至少有一个可行交换**。
- 点选一颗宝石（高亮），再点相邻宝石尝试交换；或直接朝一个方向拖动
  半格以上触发交换。
- 交换后无三消则回弹；有三消则消除（缩放消失动画）、上方宝石下落、
  顶部补充新的，连锁计连击，分数按 `消除数 × 连击数` 累加。
- 每次棋盘稳定后检测死局（无任何可行交换）：自动重排并提示。
- 画布外是 fjs 组件 UI：分数、连击提示、「提示」按钮（高亮一个可行
  交换）、「重开」按钮。分数不用 Pixi Text（它会拉起 document.fonts）。
- 离开页面（keep-alive 挂起）停 ticker，回来恢复；卸载时 `destroy(true)`
  释放 GL 资源。

页面骨架（与 spine.vue / three-gltf.vue 同一模式）：

```vue
<route>
{"title": "消消乐 PixiJS", "scroll": false, "group": "交互游戏",
 "desc": "pixi.js 7 跑在 canvas.getContext('webgl2') 上，图形全 Graphics"}
</route>
<script setup lang="ts">
import '@/pixi/native-shims';   // 原生宿主的 DOM/全局垫片，web 上是 no-op
import '@ufjs/webgl';           // 注册 webgl/webgl2 context 类型
import { Application } from 'pixi.js';
// @resize 里：ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
// adoptNativeWebgl2Context(ctx) 后 new Application({ view, context: ctx, ... })
</script>
```

## 4. 两端约定（宪法 I）

| | Flutter（`@ufjs/webgl` 桥 + ANGLE） | Web（浏览器原生 WebGL） |
|---|---|---|
| 渲染 | `canvas.getContext('webgl2') ?? ('webgl')`，pixi Renderer 收外部 context | 同一份取法，浏览器直通 |
| 输入 | `<canvas>` 的 fjs touch 事件 → 页面换算格子 | 同左（触摸或鼠标均可，载荷同构） |
| 事件载荷 | 全部字符串/标量（fjs 事件既有约定，未新增） | 同左 |
| 垫片 | `@/pixi/native-shims` 在原生宿主补 navigator/document/全局 addEventListener/performance + 上下文补丁；web 上全部原生存在，模块整体 no-op | no-op |

**已知差异**：
- 小程序端不做（package.json 的 `fjs.mp.exclude` 排除本页）。
- Pixi 把 context 识别为 WebGL2 依赖 `instanceof WebGL2RenderingContext`，
  原生宿主由垫片伪造原型链满足（web 上真类天然满足）——这是垫片存在的
  理由，记录在垫片模块注释里。
- 原生宿主的 stencil buffer 可用性未验证：页面不使用 Pixi mask（stencil
  路径），棋盘裁剪用图形自身尺寸表达。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及（纯示例页 + 页面级垫片；`@ufjs/webgl` 的既有命令流足够）

## 6. 验收标准

1. `pnpm --filter hello-fjs run typecheck` 通过（pixi.js 带类型）。
2. `pnpm --filter hello-fjs run dev:web` 打开 match3 页：棋盘渲染、
   交换/消除/下落/连击/死局重排可玩，浏览器 console 无错误。
3. iOS 模拟器（`pnpm --filter hello-fjs run run:ios`，已启动的
   iPhone 17 Pro）：同一页面渲染与交互正常，截图留档；无白屏/黑屏。
4. `pnpm test` 通过（运行时与 CLI 未动，作回归确认）。
5. `pnpm --filter hello-fjs run build:mp` 通过且产物不含本页
   （exclude 生效）。

## 7. 待澄清

- 无（放置位置按用户给定的判据由本 spec 第 1 节拍板：紧凑版进
  hello-fjs；如需完整移植 pixi-game-match3 再单独立项）。

## 8. 实施结果（2026-09-16）

- **Web 端：完整可玩**。棋盘渲染、交换/消除/下落/连击计分/死局重排
  全部验证通过（自动化走查 + 截图）。
- **iOS 模拟器：导航已修复、pixi 构造成功，但几何绘制仍不上屏**。
  排查中顺带修复了两个真问题（见 plan §6/§7）：
  1. `@ufjs/spine` 页 chunk 自带了一份 @ufjs/runtime 拷贝，preload 求值
     时 `installEventDispatcher()` 覆盖了全局事件派发器 → **全 app 触摸
     失效、路由无法跳转**（即用户报告的主症状）。修复：hello-fjs 的
     `fjs.shared` 加入 `@ufjs/spine`，恢复单实例。
  2. 宿主 QuickJS 无 `Intl` 全局，pixi 的 TextMetrics 模块初始化裸引用
     它 → match3 chunk eval 失败、preload 全灭。修复：垫片补 `Intl = {}`
     （pixi 回退字符串迭代器）。
  3. pixi 构造期裸引用 `WebGLRenderingContext`（ADAPTER.getWebGLRenderingContext），
     垫片补空类。
- **遗留（跟随此 spec 的后续工作）**：pixi 的几何绘制（Graphics/Sprite
  batch）在 ANGLE 桥上不可见 —— clear 色能上屏、drawElements 有到达
  native、gl.getError()=0，但片元不出现。需在 flutter_fjs/native 的 GL
  命令流层面继续排查（VAO 语义 / UNPACK_FLIPY / blend 状态 / uniform
  上传），或先以 web 端为 pixi 示例的验收平台。
