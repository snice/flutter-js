# Spec: canvas WebGL 上下文

- **ID**: 021-webgl
- **状态**: in-progress
- **日期**: 2026-09-06
- **依赖**: 019-canvas(canvas 组件、context 注册表、事件 30、op 10)

## 1. 要解决什么

019 落地了 `getContext('2d')`,但 WebGL 一类场景——自写 shader 的 2.5D 效果、
简单 3D、以及跑在 GL 上的图表/特效库——仍然没有出路:`getContext('webgl')`
两端都返回 `null`。`context-registry.ts` 的接缝就是为此留的。

本 spec 补上 `'webgl'`(WebGL 1.0 核心子集),延续 019 定下的两件事:

- **API 对标 web,不重新设计**。页面写 `canvas.getContext('webgl')`,拿到
  `WebGLRenderingContext` 形状的对象;web 上就是浏览器原生的那个。
- **两端同源(宪法 I)**。同一份源码在 web 与 App 上画出同一画面;
  Flutter 侧不做的 API,web 侧也不放行(除非明确登记 ⚠️/❌)。

### 1.1 Flutter 侧承载:为什么是 flutter_angle

WebGL 需要真 GPU 上下文,而 2D 走的 `CustomPaint`/Skia 回放对 GL 无能为力。
逐平台写原生(EGL/GLES + Apple 端 ANGLE vendor)成本最高。选型结论:

**用 [`flutter_angle`](https://pub.dev/packages/flutter_angle)(ANGLE 的 Dart
FFI 绑定)**。理由:

- ANGLE 正是 Chrome 跑 WebGL 的转译层(GL ES → Metal/Vulkan/D3D),行为与
  浏览器 WebGL 同源;
- 一套 Dart API 覆盖 Android/iOS/macOS/Windows/Linux,不需要逐平台原生代码;
- 它的 `RenderingContext` 本身就是 WebGL 形状的 Dart API
  (`gl.createBuffer()`、`gl.bufferData`…),回放层几乎 1:1 调用;
- 活跃维护(相对 flutter_gl:3 年未更新、0.0.x、unverified uploader),
  六平台覆盖比 flutter_gl(缺 Linux)更全。

**依赖隔离与回退路径**:flutter_angle 的使用收在 Dart 侧
`canvas/webgl_replay.dart` 单文件内;协议(op 11)与 JS 侧不感知它的存在。
若该库停更或行为不符,回退方案是原生的 C++ EGL 路径(Android EGL + Apple
ANGLE vendor),JS 侧与协议层零改动。

排除的替代方案:

- **flutter_scene / flutter_gpu**:flutter_scene 是 flutter_gpu 之上的高层
  glTF 场景渲染器,flutter_gpu 是实验性自有 API(IESL shader、不支持 web)。
  两者都执行不了任意 WebGL 程序,统一它们等于放弃 WebGL 兼容、改推自有
  3D API(Flutter 用 flutter_scene + web 用 three.js 两套实现),不是本 spec
  的目标。
- **flutter_gl**:停更 3 年,Android 还要拷 threeegl.aar,不作为第一选择。

## 2. 不做什么(Non-goals)

- **不做 WebGL 2.0**。`'webgl2'` 维持 warn-once + null(协议编号空间按 GL
  指令家族分段,VAO/instancing/多种新格式留空位,后续 spec 补)。
- **不做扩展**。`getExtension()` 返回 `null` + warn-once(OES_* / ANGLE_* 全部);
  `getSupportedExtensions()` 返回 `[]`。
- **不做像素级读回**。`readPixels` ❌(大块像素过 v1 ABI,同 019 对
  `getImageData` 的裁决);整图导出走 `toDataURL`(异步,见 §3.4)。
- **不做压缩纹理**(`compressedTexImage2D`/`compressedTexSubImage2D`)、
  `OES_vertex_array_object` 类扩展、`getTranslatedShaderSource`。
- **不做 OffscreenCanvas / Worker**。
- **不承诺 three.js**:同步查询密集、扩展依赖多的库不在本期兼容承诺内,
  进 `docs/canvas-compat.md` 的 ⚠️ 区登记。
- 不改 `invokeHost` 的 v1 ABI(查询返回标量/JSON 字符串,宪法 II)。

## 3. 用户可见的行为

### 3.1 上下文与标签

不新增标签。`canvas` 包装组件、`inner-canvas` 元素、`@resize` 事件、
`toDataURL` 全部沿用 019 的形态;`getContext('webgl')` 从「warn + null」变成
「返回上下文对象」。**一张画布只能有一种 context 类型**(DOM 语义:先到先得,
之后请求其它类型 warn-once + null)。

```vue
<script setup lang="ts">
import { ref } from 'vue';
const cv = ref();
function onResize() {
  const gl = cv.value.getContext('webgl');
  if (!gl) return;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  // ... 编译 program、画三角形,rAF 循环重画
}
</script>
<template>
  <canvas ref="cv" class="cv" @resize="onResize" />
</template>
```

### 3.2 坐标系与 DPR(webgl 与 2d 的刻意差异)

2d 上下文的契约是「逻辑像素,宿主管 dpr」。WebGL 没有全局变换可以用来藏
dpr,`viewport` 本身就以像素为单位,所以 **webgl 上下文完全遵循 web 语义**:

- `gl.canvas.width / height` = 位图像素(逻辑尺寸 × dpr),与 web 浏览器一致;
- 页面自己处理 dpr(通常就是用 `gl.canvas.width` 做 viewport)——写法正确的
  WebGL 页面零改动跨两端;
- Flutter 侧 FBO 按 dpr 建纹理,页面坐标不变、清晰度跟随设备;
- webgl 上下文上的 `devicePixelRatio` 报真实 dpr(与 web 相同),与 2d 的
  「恒为 1」不同——这是刻意的,登记在 canvas-compat。

### 3.3 绘制何时上屏

与 2d 相同的即时语义:GL 调用按帧聚合成二进制 chunk,同帧随 op 帧过去。
不同点:**GL 指令流是「执行」而不是「重放」**——2d 显示列表被宿主保留、
按版本重画;WebGL 的 FBO 本身就是状态,chunk 到达即执行进 FBO,
然后 `updateTexture` 上屏,宿主不留存指令。上下文丢失(`isContextLost`)
本期不模拟,恒为 `false`。

### 3.4 同步查询与异步回读

- **同步查询**走 `invokeHost('fjs.webgl.*')`(JSI 直达,Dart 内经
  flutter_angle 应答):`getUniformLocation`(返回 number 句柄)、
  `getAttribLocation`(返回驱动真实下标,见 §5.3)、
  `getError`、`getShaderParameter` / `getProgramParameter`
  (bool/number)、`getShaderInfoLog` / `getProgramInfoLog`(string)、
  `getParameter`(number 或 JSON 数组字符串)、`getUniform` / `getActiveAttrib`
  / `getActiveUniform` / `getBufferParameter` / `getVertexAttrib`、
  `isBuffer` / `isTexture` / `isProgram` / `isShader` / `isFramebuffer` /
  `isRenderbuffer`、`checkFramebufferStatus`、`getContextAttributes`。
  **语义承诺**:查询只保证覆盖「资源创建/编译/链接」这类即时状态;未 flush
  的绘制命令的结果不承诺可查(spec 与 canvas-compat 写明)。
- **`toDataURL`**:沿用 019 的入口(`el.toDataURL` → Promise)、请求 id +
  事件 30 `{t:'dataurl'}` 回报;Dart 侧分支:节点是 webgl 显示时从 FBO
  `readPixels` → `ImageDescriptor.raw` 编 PNG → base64。web 侧原生。

### 3.5 兼容列表(新增到 docs/canvas-compat.md 的 webgl 一节)

| 组 | ✅ 本期实现 |
|---|---|
| 资源 | `createBuffer/Texture/Program/Shader/Framebuffer/Renderbuffer` + 对应 `delete*` |
| 状态 | `bindBuffer/Texture/Framebuffer/Renderbuffer`、`enable/disable`、`blendFunc(Separate)`、`blendColor`、`blendEquation(Separate)`、`clearColor/Depth/Stencil`、`colorMask`、`cullFace`、`depthFunc/Mask/Range`、`frontFace`、`lineWidth`、`pixelStorei`、`polygonOffset`、`sampleCoverage`、`scissor`、`stencilFunc(Separate)`、`stencilMask(Separate)`、`stencilOp(Separate)`、`hint`、`viewport` |
| Buffer | `bufferData`(data/size 两形)、`bufferSubData` |
| Texture | `texImage2D`(像素/`FjsCanvasImage` 两种源)、`texSubImage2D`、`texParameteri/f`、`generateMipmap`、`activeTexture` |
| Program | `shaderSource`、`compileShader`、`attachShader`、`detachShader`、`linkProgram`、`useProgram`、`validateProgram`、`bindAttribLocation` |
| Vertex | `vertexAttribPointer`、`enable/disableVertexAttribArray`、`vertexAttrib{1..4}f` 及 `fv` |
| Uniform | `uniform{1..4}{i,f}` 及 `v` 形、`uniformMatrix{2,3,4}fv` |
| Draw | `drawArrays`、`drawElements`、`clear`、`finish`、`flush` |
| FBO | `framebufferTexture2D`、`framebufferRenderbuffer`、`renderbufferStorage` |
| 查询 | §3.4 所列,全部同步 |
| ❌ | `readPixels`、`getExtension`、WebGL2 全部、`compressedTexImage2D`、`commit`/`loseContext` |

## 4. 两端约定(宪法 I)

| | Flutter | Web |
|---|---|---|
| 标签 | 同一 `canvas` / `inner-canvas`,widget 按「节点是否启用 webgl」在 CustomPaint 与 `Texture` 之间切换 | 同一包装组件,真 `<canvas>` |
| 上下文 | JS 侧 `WebGLRenderingContext` 实现,命令编码 op 11,Dart 经 flutter_angle 执行 | 浏览器原生 context 直通 |
| 坐标系 | 位图像素(逻辑 × dpr),与 web 完全一致 | 同左 |
| 同步查询 | `invokeHost('fjs.webgl.*')` → flutter_angle | 浏览器原生 |
| `toDataURL` | FBO readPixels → PNG,事件 30 异步 | 原生 |

**已知差异(登记)**:
1. `getParameter` 浮点精度、shader 编译器行为随 ANGLE/浏览器后端不同,
   与 2d 的「字体度量不可能逐像素相同」同理,不做像素级一致验收。
2. 老宿主(`uiOpsVersion < 5`):webgl 上下文在 JS 侧创建即告警一次并返回
   `null`,不做 JSON 回落(与 2d 对 op 3 的降级策略一致,宪法 V)。

## 5. 契约变更(宪法 II)

- [x] **UI op 协议**三处同步(`ops.ts` / `ui_ops.dart` / `fjsrun.cpp`):
      新增 `UiOp.Webgl = 11`(`u32 id, u32 byteLen, <GL 指令流>`),
      `uiOpsVersion` 4 → 5。
- [x] **host 模块**:新增 `fjs.webgl.*` 同步查询注册(Dart
      `registry/host.dart` 路径不变);`native-global.d.ts` 不涉及
      (invokeHost 形状未变)。
- [x] **事件**:复用事件 30,新增 payload 类型 `{t:'readback'}`?——不新增,
      `toDataURL` 沿用 `{t:'dataurl'}`,载荷形状不变。
- [ ] **事件类型**:不新增。
- [x] **新依赖**:`flutter_angle`(pub)。理由:§1.1;隔离在单文件,
      回退路径已写明(宪法:依赖进 spec)。

## 6. 验收标准

1. `pnpm run typecheck`、`pnpm test` 通过;GL 指令编码器有单测(与
   `canvas/display-list` 的既有测试同级),`pnpm test` 里可见。
2. `flutter_fjs` 侧有 chunk 解码测试(不依赖真 GL 的部分:命令分派、
   字符串表、资源 id 表);`flutter test` 不是 `No tests ran`。
3. `examples/hello-fjs` 新增 webgl 示例页(清屏 → 彩色三角形 → rAF 动画),
   同一页面在 `dev:web` 与 Android 上呈现一致。
4. 同一画布先 `getContext('webgl')` 再 `getContext('2d')` 两端都返回 `null`
   且恰好一条 `[fjs]` 告警(先 2d 后 webgl 同理)。
5. `docs/canvas-compat.md` 增加 webgl 一节(§3.5 表 + 差异 1/2),
   `docs/ui-api.md` 与 `docs/roadmap.md` 对应条目更新。
6. 老 host(手动把 `__fjsHost.uiOpsVersion` 降到 4)下 `getContext('webgl')`
   返回 `null` + 一条告警,页面其余部分照常。
7. `fjsrun dist/bundle.js` 的帧 dump 能打印 op 11(`webgl #id %u bytes`)。

## 7. 待澄清

无(范围判断按会话内推荐项:WebGL 1.0 先行、协议预留 2.0、flutter_angle
承载 Flutter 侧)。

**实现期修订(2026-09-06,web 联调时拍板)**:

1. **`'webgl2'` 两端同时注册,复用同一条指令流**。原 spec 说 webgl2 保持
   null,但 web 联调发现:新的 Chromium(含本项目调试用的 IAB webview)
   已经**不再提供 WebGL1,只提供 WebGL2**——只注册 `'webgl'` 意味着 web 侧
   没有可用的 answer,连验收都做不了。而 flutter_angle 的 ANGLE 后端本就是
   GLES3(其自带示例跑 `#version 300 es`),Flutter 侧注册 webgl2 零成本。
   于是 `'webgl'`/`'webgl2'` 共用同一工厂、同一协议;webgl2 专属 API
   (VAO/instancing 等)web 上原生可用、App 上 warn-once,按 canvas-compat
   的 ⚠️ 惯例登记。页面写法采用 three.js 同款回落链:
   `getContext('webgl2') ?? getContext('webgl')`。
2. **flutter_angle 0.1.0 的三个适配点**(iOS 模拟器联调发现):
   `bufferData` 只吃它自家的 NativeArray(传 TypedData 抛
   NoSuchMethodError),像素类上传统一走 `_native()` 包装;`bufferData`
   的 size 形态把 size 当指针地址传给 GL(会读野内存),改为上传零填充;
   `AngleOptions.width/height` 必须传**逻辑尺寸**(插件在
   `activateTexture` 里自己乘 dpr,传设备像素会双重缩放、三角形缩在角
   落)。
3. **同步查询的三段式应答**(iOS 联调拍板):`getUniformLocation` 不依赖
   GL,同步分配不透明句柄并记录 (programId, name),真实 location 在携带
   句柄的命令执行时反查——否则任何页面的
   `getUniformLocation → uniform → draw` 标准流在首帧就断;状态查询在
   上下文未就绪时乐观应答(COMPILE/LINK_STATUS true、getError 0),就绪后
   先执行积压 chunk 再读真值;JS 侧查询前 `flushNow()` 立即推送指令流。

   **`getAttribLocation` 不能句柄化**(023 Android 联调修正):它的返回值
   在 DOM 里就是驱动的 attribute 槽位下标,库会拿它当自己数组的索引 ——
   three 的 `enabledAttributes` 是 `Uint8Array(MAX_VERTEX_ATTRIBS)`,句柄
   发号器给出 19 时 `enabledAttributes[19]` 是 `undefined`,
   `undefined === 0` 为假,于是 `enableVertexAttribArray` 一次都不发,
   draw 全部读属性常量默认值:画面全黑且 `getError()` 干净。它改走和其他
   状态查询一样的路径(先 drain 再问 GL);上下文尚未建立时答 -1 并打日志,
   而不是编一个看似合法的下标。
4. **web 侧画布尺寸改由包装盒裁决**(连带修复一个 019 遗留的 web 布局
   bug)。原来 surface 拿自己 DOM rect 量尺寸,而裸 canvas 的位图固有比例
   (默认 2:1)会污染 rect——元素按比例撑大、溢出包装盒 63px(裁剪 demo
   的条纹画到了卡片外面),且自我稳定在错误值。现在 sync() 量
   `parentElement`(包装盒,页面样式落点)并把 canvas 元素钉在盒子上,
   与 Flutter「盒子尺寸即画布尺寸」完全一致。连带效应:挂载时不再预取
   `'2d'` 上下文(那会把画布永久锁成 2d,webgl 拿不到 context),dpr
   预置变换改到页面首次 `getContext('2d')` 时施加。

已随方案一起确认的执行约束:

1. **flutter_angle 接入先验证再依赖**:实现 Step 4 前先在其 example 级别
   验证 Texture 集成与 resize 重建纹理的行为(它是 unverified uploader 的小包,
   这是唯一实质风险,spec 里以「先跑通 example」作为 tasks 的前置项)。
2. **minSdk**:flutter_angle 的 ANGLE 版要求 Android minSdk 28(低于回退
   OpenGL 直连)。demo/examples 当前 minSdk 若低于 28,按 ANGLE 优先、
   回退可用的方式配置,不强制抬 minSdk。
