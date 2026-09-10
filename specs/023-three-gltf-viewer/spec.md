# Spec: three.js glTF 示例（Xbot.glb + 拖拽旋转）

- **ID**: 023-three-gltf-viewer
- **状态**: done（Flutter 端真机对拍由 spec 028 完成；T025 是 flutter_angle 的上游缺陷，保留登记）
- **日期**: 2026-09-07

## 1. 要解决什么

hello-fjs 已有手写 WebGL 三角形示例（spec 021/022），但没有 3D 模型加载的
示范。用户要求：给 hello-fjs 加一个 **three.js** 示例，加载
`threejs.org/examples/models/gltf/Xbot.glb`，手势可以拖动旋转模型。

three.js（r170 核对）依赖一批本 runtime 没有的宿主 API：VAO 命令、
`getShaderPrecisionFormat`、`TextDecoder`、`Blob`/`URL.createObjectURL`、
`createImageBitmap`、`performance`。spec 021 曾写明"不承诺 three.js"——本
spec 把承诺收回来：three.js 核心渲染路径 + GLTFLoader 内嵌纹理路径必须
双端可用。

## 2. 不做什么（Non-goals）

- 不承诺 three.js 的 **WebGLRenderer 之外**的能力：后处理（EffectComposer）、
  浮点渲染目标、WebXR、Draco/KTX2 压缩纹理（需 getExtension 扩展，恒 null）。
- 不做 OrbitControls（依赖 DOM pointer/wheel；页面手写 yaw/pitch 拖拽）。
- 不做骨骼动画播放（Xbot 以绑定姿态静置渲染）。
- 不给 GL context 建通用客户端状态机（webgl 模块"无状态机"设计不变；
  flipY 是唯一破例，见 plan §3）。

## 3. 用户可见的行为

```vue
<!-- examples/hello-fjs/src/pages/example/three-gltf.vue，同源跑两端 -->
<canvas ref="cv" @resize="onResize"
        @touchstart="onTouch" @touchmove="onTouch" @touchend="onTouch" />
```

页面 import three + GLTFLoader + 一份 native polyfill 模块，加载仓库内
`src/assets/Xbot.glb`，`renderer.setAnimationLoop` 渲染；单指拖动改变
yaw/pitch。web 端用浏览器原生 WebGL2，Flutter 端经 ANGLE 执行同一份代码。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | GL 调用编码为 op 11 指令流，flutter_angle/ANGLE 执行 | 浏览器原生 context |
| 事件载荷 | touch 事件标准载荷（字符串 JSON），拖拽逻辑共用 | 同左 |
| 已知差异 | 内嵌纹理经 `data:` URL → 宿主解码 → 图片句柄上传 | 浏览器原生 createImageBitmap |

polyfill 模块只在 `typeof __fjs !== 'undefined'` 时安装，web 端零介入。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）—— op 11 指令流内部不涉及，
      但 webgl 子协议（`fjs-webgl/src/protocol.ts` + `replay.dart`）新增
      CreateVertexArray/BindVertexArray/DeleteVertexArray 三条命令，同步改。
- [x] natives 表 —— 不涉及（同步查询走已有 `fjs.webgl.*` host 模块注册表，
      新增 `getShaderPrecisionFormat` 一个方法名）。
- [ ] 事件类型 —— 不涉及。

## 6. 验收标准

1. `pnpm run typecheck` 通过。
2. `pnpm test` 通过（含新增 VAO 协议编码测试）。
3. `pnpm --filter hello-fjs run build` 字节码构建通过（three 进入 bundle）。
4. `pnpm --filter hello-fjs run dev:web`：浏览器打开 /example/three-gltf，
   Xbot 显示、纹理方向正确、单指/鼠标拖拽旋转。
5. Flutter 端 `fjs dev` + fjs-go：同样表现（纹理方向为实测点，见 plan §4）。

## 7. 待澄清

- 无（方案选型已由用户拍板：真引入 three.js；模型放仓库 assets）。
