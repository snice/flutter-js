# @ufjs/spine

[spine-canvas](https://github.com/EsotericSoftware/spine-runtimes/tree/4.3/spine-ts/spine-canvas)
4.3 移植到 fjs 的 `<canvas>`：同一份页面代码在 App（Flutter）、web 与微信小程序上播放 Spine 骨骼动画。

## SpinePlayer（推荐）

[spine-player](https://github.com/EsotericSoftware/spine-runtimes/tree/4.3/spine-ts/spine-player)
的配置和方法，封装在上面的 canvas 渲染器之上：给 2d context，不给 DOM 父节点。
帧循环、按动画包围盒自动算视口、切动画时视口平滑过渡、controlBones 拖拽都由它负责。

```vue
<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { SpinePlayer } from '@ufjs/spine';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';

const cv = ref<FjsCanvasApi>();
let player: SpinePlayer | null = null;

function onResize() {
  const canvas = cv.value!;
  player ??= new SpinePlayer(canvas.getContext('2d')!, {
    skeleton: '/spine/spineboy-pro.skel', // public/spine/
    atlas: '/spine/spineboy.atlas',
    animation: 'walk',
    controlBones: ['root'],
    success: (p) => console.log(p.getAnimationNames()),
  });
  player.resize(canvas.width, canvas.height); // 逻辑像素
}
function onTouch(type: 'start' | 'move' | 'end', e: FjsTouchEvent) {
  const t = e.touches[0] ?? e.changedTouches[0];
  if (t) player?.handleTouch(type, t.offsetX, t.offsetY);
}
onUnmounted(() => player?.dispose());
</script>

<template>
  <canvas ref="cv" style="width: 100%; height: 300px" @resize="onResize"
    @touchstart="(e) => onTouch('start', e)" @touchmove="(e) => onTouch('move', e)"
    @touchend="(e) => onTouch('end', e)" />
</template>
```

与官方 spine-player 的差异：

| | 官方 | @ufjs/spine |
|---|---|---|
| 构造 | `new SpinePlayer(parent, config)` | `new SpinePlayer(ctx2d, config)` |
| 尺寸 | 读 DOM | `player.resize(width, height)`，页面在 `@resize` 里调 |
| 控制条 / 弹窗 / 全屏 / loading 动画 | 内置 HTML | 不提供，页面用组件搭；辅助方法 `getAnimationNames` / `getSkinNames` / `setSkins` / `getProgress` / `seek` |
| 触摸 | 监听 canvas | 页面转发 `handleTouch(type, offsetX, offsetY)` |
| `backgroundColor` 默认 | 黑色 | 透明（露出页面 CSS 背景） |
| `debug` | 8 项 | `bones` / `regions` / `meshes` / `bounds` |
| 新增 | — | `triangleRendering`（默认 true） |
| 出错 | 抛异常 + HTML 错误框 | 画在画布上 + `config.error` |
| keep-alive | — | `onDeactivated` → `stopRendering()`，`onActivated` → `startRendering()` |

`player.config` 按引用持有，改 `debug` / `viewport.debugRender` 等字段下一帧生效。

## 底层 API

和官方 spine-canvas 一致，需要自己管资源、帧循环和坐标：

```ts
import * as spine from '@ufjs/spine';

const assets = new spine.AssetManager('/spine/');
assets.loadBinary('spineboy-pro.skel');
assets.loadTextureAtlas('spineboy.atlas');
await assets.loadAll();

const atlas = assets.require('spineboy.atlas') as spine.TextureAtlas;
const data = new spine.SkeletonBinary(new spine.AtlasAttachmentLoader(atlas))
  .readSkeletonData(assets.require('spineboy-pro.skel') as Uint8Array);
const skeleton = new spine.Skeleton(data);
const renderer = new spine.SkeletonRenderer(canvas.getContext('2d')!);
renderer.triangleRendering = true; // 画 mesh 附件
```

完整示例：`examples/hello-fjs/src/pages/example/canvas/spine.vue`。

## 与官方 spine-canvas 的差异

- `@esotericsoftware/spine-core` 原样依赖（锁定 4.3.13）；只移植了 spine-canvas 碰 DOM 的三个文件，SpinePlayer 基于它们重写（不依赖 spine-webgl）。
- `AssetManager`：文本/二进制走 `@ufjs/runtime` 的 `fetch`，贴图走 `loadCanvasImage`。
- `SkeletonRenderer.drawTriangle`：裁剪路径改在 `transform()` 之后用贴图坐标建，
  App 端的 2d 上下文在 clip 时才套变换，按上游顺序会裁错位置。结果与上游相同。
- canvas 2d 按直通 alpha 合成：PMA 贴图（`pma: true`）边缘会发黑，请导出非预乘贴图。
- 小程序：资源放 `public/`，`fjs build --mp` 会把 `.atlas` / `.skel` 编译成 JS 模块进包（真机读不到代码包里的文件），wx 的 fetch 从中读回。
- 网格渲染每个三角形约 10 条绘制命令，mesh 很多的骨骼在 App 上成本高。

## License

Spine Runtimes License，见 [LICENSE](LICENSE)。使用者须持有 Spine Editor 授权。
