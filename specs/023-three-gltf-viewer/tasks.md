# Tasks: three.js glTF 示例（Xbot.glb + 拖拽旋转）

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 `protocol.ts`：WebglCmd.CreateVertexArray/BindVertexArray/
      DeleteVertexArray（0x0901–0x0903）+ writer 编码方法 + TexImage2DSource
      flipY 标志位（实施中追加：TexStorage2D=0x030a、TexSubImage2DSource=0x030b
      —— three r163+ 的图片纹理上传路径，plan §3 的方案因此扩了两条命令）
- [x] T002 `context.ts`：createVertexArray/bindVertexArray/deleteVertexArray
      + pixelStorei(UNPACK_FLIP_Y_WEBGL) 客户端记录 + texSubImage2D 7 参源路由
      + texStorage2D
- [x] T003 `replay.dart`：VAO 三命令执行（FjsGlBindings + FjsAngleBindings）
      + TexImage2DSource/TexSubImage2DSource flipY 行翻转 + texStorage2D +
      pixelStorei 吞掉 0x9240（GL ES 无此 pname，喂进去会 INVALID_ENUM）
- [x] T004 getShaderPrecisionFormat：**走 plan 的兜底方案**——JS 侧按 WebGL2
      下限常量作答。实测 flutter_angle 0.4.2 的 getShaderPrecisionFormat 是
      返回全零的 stub，照实转发会让 three 选 lowp shader；不加 `fjs.webgl.*`
      查询（JS 侧根本不会发起）。

## 实现

- [x] T010 `fjs/src/bundler/build.ts` ASSET_LOADERS 加 `.glb`（esbuild 路径，
      CLI 基础能力）；`static-assets.d.ts` 声明 `*.glb`；vite 路径的
      assetsInclude 由**项目自己的 vite.config.ts** 声明（评审修正：项目级
      资产需求不进 CLI 插件的默认 config）
- [x] T011 `flutter_fjs/lib/src/widgets/image.dart`：fjsResolveImageSource
      支持 data: URL（base64 → MemoryImage）
- [x] T012 `fjs-runtime/src/index.ts` 导出 utf8Decode、base64Encode
- [x] T013 下载 Xbot.glb → `examples/hello-fjs/src/assets/`（2.9MB）
- [x] T014 `examples/hello-fjs`：three 0.170.0（固定版本）+ @types/three，
      pnpm install
- [x] T015（计划外）`flutter_fjs/lib/src/http.dart` + `engine.dart`：JS fetch
      的根相对 URL 连着 dev server 时按 devUri 解析（web 端浏览器本来就解析
      相对 URL，两端同源；GLB 资产在 App 端 fetch 时没有它就无处落）。

- [x] T016（iOS 实测修正）`context.ts` getParameter 对 flutter_angle 不支持
      或不支持得正确的 pname 本地应答：字符串键（VERSION/
      SHADING_LANGUAGE_VERSION/RENDERER/VENDOR——three 的 WebGLState 初始化时
      对 VERSION 调 `.indexOf`，拿到 null 整页崩）+ 数组键（SCISSOR_BOX/
      VIEWPORT——插件的 GetIntegerv 只回第一个分量，`Vector4.fromArray` 拿
      不到 4 元组，第二次 iOS 崩溃）+ IMPLEMENTATION_COLOR_READ_TYPE/FORMAT
      （GLES3 保证组合）。顺带修 getSupportedExtensions 的 JSON 字符串
      unpack。数组键只在构造期读一次、首帧即被 three 覆写，值无关紧要、
      形状必须对。
- [x] T017（iOS 实测修正）3D 纹理全链路：GL 常量 TEXTURE_3D/TEXTURE_2D_ARRAY
      等（原表缺失，`emptyTextures[gl.TEXTURE_3D]` 与 TEXTURE_2D_ARRAY 比较时
      undefined===undefined 误走 3D 分支）+ 协议 TexImage3D=0x030c /
      TexSubImage3D=0x030d + context/replay/Angle/FakeBindings 四处实现——
      three 的 WebGLState 渲染器初始化时为 3D/array 占位纹理调
      gl.texImage3D，第三次 iOS 崩溃（not a function）。
- [x] T018（iOS 实测修正）TextDecoder 无限递归：utf8Decode 开头的
      "有全局 TextDecoder 就用"探针会看到 polyfill 装的那个，而 polyfill 的
      decode 又调回 utf8Decode——GLTFLoader 一解码 GLB 的 JSON chunk 即爆栈
      （Maximum call stack size exceeded，第四次）。修复：utf8.ts 拆出
      utf8DecodeBytes（纯循环、无探针）导出，polyfill 只调它；渲染循环本身
      已跑通（画布出背景色），本条修完走 GLTFLoader 解析。
- [x] T019（iOS 实测修正）info log 空 ≠ null：three 的 WebGLState.onFirstUse
      对 `getProgramInfoLog(program).trim()`——DOM 规范要求 info log 恒为
      字符串（成功时是空串），而 flutter_angle 在 GLES 没写 log 时返回 Dart
      null → JS undefined，每次首次 useProgram 爆一次（第五次 iOS 崩溃，
      模型已加载、renderScene 已在跑）。getShaderInfoLog/getProgramInfoLog/
      getShaderSource 三个查询统一 `?? ''` 兜底为 DOM 字符串语义。
- [x] T020（iOS 实测修正）StrDef 的 u16 长度截断：three 的内置 PBR+蒙皮
      着色器源码超过 64 KiB，StrDef 的 u16 len 静默截断（ByteBuf.u16 无
      溢出检查），Dart 按截短长度消费 → 整条流从 shaderSource 起错位，
      中途报 unknown command 0xa7b（第六次 iOS 崩溃，此时 renderScene 已在
      每帧执行）。修复：webgl 协议新增 StrDef32=0x0002（u16 id + u32 len），
      str() 改用它；2D display list 的 StrDef 不动（共享 reader 新增
      readStrDef32，新增方法不影响 2D）。协议对齐以一次性双侧审计脚本
      核验（全部命令 schema 与 id 一致，脚本已删、结论由测试矩阵钉住）。
- [x] T021（iOS 实测修正）getActiveUniform/getActiveAttrib 忘了解包 JSON：
      Dart 端按 v1 ABI 把 {name,size,type} 以 JSON 字符串回答，JS 端直接
      返回字符串 —— three 的 parseUniform 读 `.name` 得 undefined，再读
      `.length` 崩（第七轮 iOS，uniform 遍历）。修复：unpackMaybeJson 支持
      plain object，两个查询过它。注：此为 spec 021 的潜伏 bug，此前无
      调用者；第五轮的 info-log try-catch 防御保留（诊断查询不杀渲染循环）。
- [x] T022（iOS 实测修正）vertexAttribDivisor：WebGL2 核心命令，three 的
      WebGLBindingStates 对**每个**启用的顶点属性都调（普通属性 divisor=1，
      不只 instancing），缺了就是 not a function（第八轮 iOS，首次
      draw 的 setupVertexAttributes）。协议加 0x050c，flutter_angle 有
      对应实现直接透传。
- [x] T023（方向调整，用户拍板）iOS 模拟器持续闪退（flutter_angle 的
      Metal Device fatalError 是上游硬伤，冷启动也随机触发）——新增**手写
      GLB 查看器** `src/pages/example/gltf-viewer.vue` + `src/gltf/glb.ts`/
      `mat4.ts`：JS 解析 GLB（POSITION/NORMAL/indices/baseColorFactor，忽略
      蒙皮——原始 accessor 即绑定姿态 T-pose），渲染只用三角形示例已验证的
      命令路径，不触碰 active-info/VAO/texStorage 等 iOS 雷区。three 版页面
      （three-gltf.vue）保留，web 端可用。开发中的二分调试（drawArrays
      对照、分阶段 getError、页面诊断条）定位出两个手写 bug 并修复：
      索引 buffer 误上传到 ARRAY_BUFFER target（INVALID_OPERATION）；
      readAccessor 的 DataView 建在整个文件而非 BIN chunk 上（accessor
      offset 错位 → 索引超界 → INVALID_OPERATION）。web 端验证：模型渲染
      正常、拖拽旋转正常、GL 错误全零。
- [x] T026 toDataURL 调试通道（canvas has nothing to export）确认为既有
      边界：webgl 回读仅在 node.webglChunks 非空（pending）时接管，
      steady-state 空队列落到 2D 分支报 nothing to export。作为已知限制
      记录，不在本 spec 展开。
- [x] T027（颜色修正）手写 shader 的输出 gamma：glTF 的 baseColorFactor 是
      LINEAR 颜色，three 输出时自动 linear→sRGB，手写 shader 漏了这步，
      粉红肤色显示成暗砖红。片元着色器补 `pow(c, 1/2.2)` 近似转换。
- [x] T028（Android 真机验证）手写查看器在 Android 工作：模型/颜色/拖拽
      全通。唯一差异：呈现上下颠倒——Android 的 SurfaceTexture 保持 GL
      bottom-up 语义（浏览器和 iOS 的 IOSurface 是 top-down）。修复：
      新增 host 模块 **fjs.platform**（返回 Platform.operatingSystem），
      页面按 'android' 镜像投影矩阵 Y（proj[5]/proj[13] 取反，Xbot 双面
      材质不受绕序影响）。注：viewport 负高度翻转方案已否决——Android GL
      直接拒绝负尺寸（INVALID_VALUE，见 emugl 日志 0x501），调用每帧被忽略。
      三角形页面（example-webgl.vue）同样以 uFlip uniform 修旋转方向。
      **Dart 侧改动必须重编安装 app 生效**。注意：翻转公式为
      `y'=y+h; h'=-h`（镜像绘制方向，覆盖同一表面区间）。**Dart 侧改动
      必须重新构建安装 app 才生效**——热重载 JS 不会带上它。
- [x] T023（由 spec 028 解决）draw 无可见输出：背景 clear 正常（GL 流执行、
      Texture 提交都通），mesh draw 无产物。二分中：场景加 Box（drawElements
      + VAO 基础路径，排除 GLTF/蒙皮）+ 背景改红 + 材质换 unlit；待用户
      交叉确认 /example/webgl 三角形（基础 drawArrays 管线）在 iOS 是否
      本来就显示。结果：三角形正常（基础 drawArrays 管线在 iOS 通）。
- [x] T024（iOS 实测修正）getActiveUniform 抛异常被防御吞成 null → 跨 ABI
      变 undefined → three 的 uniform 遍历读 `.name` 崩。修复：Dart catch
      改为 warn-once 打印真实异常 + 返回哑条目（空名 uniform 无 location，
      three 的 setValue 自然跳过，不再崩）；unpackMaybeJson 把 ABI 的
      undefined 归一为 null。
- [ ] T025（flutter_angle 缺陷，未修）iOS 模拟器插件
      FlutterAngleSimPlugin.createMtlTextureFromCVPixBuffer 在第二个 webgl
      canvas surface 创建时 eglQueryDisplayAttribEXT 失败 → Swift
      fatalError 崩 app。规避：冷启动直接进 three 页面（单 surface 不触发）；
      先开一个 webgl 页再切另一个必崩。记录为 flutter_angle 上游问题。

## 示例页面

- [x] T020 `src/three/native-polyfills.ts`：self/performance/TextDecoder/
      Blob/URL.createObjectURL/fetch 拦截/Request/Headers/createImageBitmap
- [x] T021 `src/pages/example/three-gltf.vue`：canvas shim + WebGLRenderer
      （context 直传）+ GLTFLoader + 手写 yaw/pitch 拖拽 + rAF 循环 + 错误展示

## 测试与对拍

- [x] T030 `test/webgl-protocol.test.ts` 补 VAO/texStorage2D/texSubImage2DSource
      /flipY/precision 用例（21 过）；
      `flutter/test/webgl_replay_test.dart` 补对应解码用例（9 过）
- [x] T031 web 浏览器对拍：模型渲染（粉红单色即 Xbot 的真实材质，此 GLB 无
      纹理）、拖拽旋转，截图验证 ✓
- [x] T032（由 spec 028 的真机验收覆盖）Flutter 端对拍：`pnpm --filter hello-fjs run dev` + fjs-go/真机。
      重点：flipY 方向（若纹理倒置则调整 replay.dart 的行翻转）。**待设备
      验证**——代码路径已由两侧协议测试钉住。

## 文档

- [x] T040 docs/canvas-compat.md webgl 行更新（VAO/texStorage 可用、
      precision 常量作答）；docs/roadmap.md 加 three.js 条目；docs/ui-api.md
      image src 表补 data: URL 行
- [x] T041 docs/toolchain.md 无资产扩展名列举处，不改

## 验收

- [x] T050 `pnpm -w run typecheck`（四包全过）
- [x] T051 `pnpm test`（fjs 94 + runtime 275 + webview 36 + webgl 21）
- [x] T052 `pnpm --filter hello-fjs run build`（Xbot.glb 进 dist/assets）+
      `build:web`（three-gltf chunk 560KB / gzip 142KB）
- [x] T053 spec.md 第 6 节逐条核对——第 4、5 条 web 已验；第 5 条 Flutter 端
      （T032）待设备

## Android 真机/模拟器轮次（T030-T032，2026-09-07 晚）

- [x] T030 Android 真机：手写查看器模型/颜色/拖拽全通；呈现上下颠倒。
- [x] T031 viewport 负高度翻转方案**否决**：Android GL（emugl/gfxstream 与
      部分驱动）拒绝负尺寸 viewport（INVALID_VALUE 0x501 每帧刷错且调用
      被忽略）。回滚 replay.dart 的该实现。
- [~] T032（已被 T039 取代）方案：新增 host 模块 **fjs.platform**（engine.dart，返回
      Platform.operatingSystem）；手写查看器与 three 版页面按 'android'
      镜像投影矩阵 Y（proj[5]/proj[13] 取反；Xbot 双面材质不受绕序影响，
      three 版翻转后禁止 updateProjectionMatrix）。三角形页面以 uFlip
      uniform 同步修复。web/iOS 不受影响。
- [x] T033 three 构造期查询命中乐观分支返回 null 的修复：MAX_* 家族在
      GL surface 就绪前被 three 读取并**永久缓存**，null 污染纹理簿记
      （"supports only null" / 20x20 "too big" / activeTexture 超界 /
      texSubImage2D 0x501）。乐观分支按 pname 补 GLES3 下限保守值；
      pixelStorei 吞 UNPACK_PREMULTIPLY_ALPHA(0x9241) 与
      UNPACK_COLORSPACE_CONVERSION(0x9243)（Android GL 报 INVALID_ENUM
      刷屏；glTF 材质非 premultiplied，吸收语义正确）。
- [x] T034（Android 真机复验）拖拽卡顿：uniform/attrib 位置缓存解决（此前
      每帧 7 次同步 ABI 往返）。"缺失部分"确认**不是 bug**：Xbot 的深棕
      关节部件在深色背景+简单光照下对比度不足，视觉上融入背景（侧视角
      可见暗色球体仍在）。修复：背景改浅色（与参考渲染一致）+ 环境光
      0.35→0.45。浅背景下模型完整可见。
- [x] T035 Android 遗留（flutter_angle 上游，已记录）：iOS 模拟器的
      Metal fatal；iOS 真机三角形空白（FlutterAngleOSPlugin 路径）。
      建议作为 flutter_angle issues 反馈。
      （spec 026 追记机制差异：flutter_angle 0.4.2 在 iOS **模拟器**与
      **真机**走完全不同的呈现机制——模拟器插件返回 `openglTexture`
      （Metal 纹理 + Dart 侧 FBO 路径，已验证可用）；真机插件只返回
      `surfacePointer`（IOSurface，Dart 侧
      `eglCreatePbufferFromClientBuffer` 的 EGL 路径），该路径失败时
      surfaceId 为空、绘制落到无附着的 FBO 0 上，静默空白。spec 026
      已把该失败显性化为 failed + 定位日志。spec 026 最终修复：真机空白
      的根因是合成侧两处时序——首帧纹理通知早于 Texture layer 挂载
      （挂载后补一次 mark），以及 eglSwapBuffers 不等 Metal 命令缓冲
      落盘（present 前显式 glFinish）。真机验证：三角形显示、匀速旋转。）
- [x] T036（Android 真机复验二）拖拽卡顿：uniform/attrib 位置改为每
      program 缓存一次（此前每帧 7 次同步 ABI 往返），真机确认流畅。
- [x] T037（Android 真机复验二）路由返回转场卡顿：转场动画期间渲染循环
      仍在发 GL 命令流，与转场争抢 raster。修复：两个查看器渲染循环改
      **按需渲染**（脏标记——仅拖拽/模型加载/开关变化后渲染一帧，静止时
      rAF 空转）。转场期间无拖拽 → 零命令 → 动画不再卡；顺带省电。
      "拖拽后部分缺失"确认为合成/呈现时序（flutter_angle 内部），页面
      无法修，作为上游限制记录。
- [x] T038（Android 模拟器复验三）three 版**完全不出图**。三个各自能独立
      让画面全黑的原因，逐层剥出来：
      1. **GL 常量表缺项**（context.ts）。`TEXTURE0` / `UNPACK_ALIGNMENT`
         / `RGBA32F` 等在表里没有，读出 `undefined`、上线编码成 0，驱动
         报 INVALID_ENUM（`activeTexture` 超界、`pixelStorei` 非法 pname、
         `texStorage2D` internalformat 0x0）。Xbot 是蒙皮网格，骨骼纹理
         正是 RGBA32F —— 缺一个常量就够让整个模型消失。修复：按
         flutter_angle 的 `shared/webgl.dart` 补齐全表（552 项逐一对过，
         顺带修 `RGBA4` 笔误 0x805F→0x8056），并给原型挂 Proxy，读到未知
         的全大写名字就 warn 一次，不再静默返回 undefined。
      2. **`getAttribLocation` 不能句柄化**（spec 021 §5.3 已改写）。它的
         返回值是驱动的 attribute 槽位下标，three 拿它索引
         `Uint8Array(MAX_VERTEX_ATTRIBS)`；句柄发号器给出 19 时
         `enabledAttributes[19]` 是 `undefined`，`undefined === 0` 为假，
         `enableVertexAttribArray` 一次都不发，draw 全读属性常量默认值 ——
         画面全黑且 `getError()` 干净。改为走真实 GL 查询；上下文尚未
         建立时（页面在首个 `@resize` 里同步 compile+link+查询，每个手写
         GL 页面都这样）host 答 `null`，由 JS 侧挑一个槽位并用
         `bindAttribLocation` + 重链把承诺变成事实。答 -1 是不行的：它会
         被编码成 `0xFFFFFFFF`，三角形页当场 INVALID_VALUE。
      3. **webgl 画布的 dpr 来源**。`el.devicePixelRatio` 在 Flutter 上恒为
         1（那是 2d 的约定），而 webgl 后端纹理是 logical×真实 dpr。页面
         照前者给 three 设 pixelRatio，viewport 落成 340×340 而纹理是
         1020×1020。改为从 `gl.canvas` 取（DOM 自己的真值来源）。
- [x] T039（Android 模拟器复验三）出图后**偏暗**：T032 的投影 Y 镜像同时
      反转了三角形绕序，`CULL_FACE` 于是剔掉了正面 —— 看到的是模型内壁，
      法线背对相机，所有用到法线的光照项塌掉而 ambient 正常（对拍链条：
      `AmbientLight` 两端一致 → `HemisphereLight` 不一致 →
      `MeshNormalMaterial` 显示 Android 侧法线 z≈-1）。`DoubleSide` 试探
      是假阴性：three 的 double-sided 分支用 `gl_FrontFacing` 翻法线，
      投影翻转后它也是反的，法线被翻两次。
      正解是**方向只在呈现层拉平**：Android 的 SurfaceProducer 已经带了
      纹理变换，`_displayOverride` 对它不再套 `Transform(1,-1,1)`（iOS 的
      CVPixelBuffer 路径仍需要）。三个页面（three 版、手写查看器、三角形）
      的投影/uFlip 补偿全部删除 —— 页面重新回到"不关心平台"。
      T032 的 `fjs.platform` 模块保留（它本身没问题），但两个查看器已不
      再使用它。
- [x] T040（iOS 模拟器复验）**先开三角形、再开 three 版就崩**。两个独立
      故障叠在一起，一个杀 JS 一个杀进程：
      1. **乐观应答把计数当状态答**（replay.dart）。上下文还没建起来时
         `getProgramParameter` 一律答 `true`，而 `ACTIVE_UNIFORMS` 问的是
         个数 —— `true` 在 JS 数值上下文里就是 1，three 于是遍历一条不存在
         的 uniform，`getActiveUniform(program, 0)` 拿到 `null`，
         `WebGLUniforms` 里 `info.name` 当场炸。改为按 pname 分流：
         DELETE/LINK/VALIDATE/COMPILE_STATUS 才答 `true`，
         ACTIVE_UNIFORMS/ACTIVE_ATTRIBUTES/ATTACHED_SHADERS 等计数答 0，
         其余答 `null`；`getActiveAttrib/Uniform` 兜一个空名条目（和
         `_deadActiveInfo` 同一个理由：three 受不了 null）。
      2. **模拟器上释放一张纹理会拆掉整个 EGL display**（上游，T035 的
         Metal fatal 的真正成因）。`FlutterAngleSimPlugin.disposeTexture()`
         的实现是 `eglMakeCurrent(nil)` + `eglTerminate(display)`，而
         `FlutterAngle.init()` 见到 display 已存在就直接 return，没人重建
         它 —— 于是下一个画布节点 `createTexture` 时
         `eglQueryDisplayAttribEXT` 失败、插件 `fatalError("Could not
         create Metal Device")` 杀进程。真机走的 `FlutterAngleOSPlugin`
         没这个问题。修复：`_freeTexture` 在 iOS 模拟器上跳过释放
         （`Platform.resolvedExecutable` 含 `/CoreSimulator/`），每个销毁
         的节点泄漏一张纹理 —— 开发用目标上泄漏比杀进程划算。
      复验：三角形 ↔ three 版来回切 16 次不崩，手写查看器与 three 版都能
      在 iOS 模拟器上出图。
- [x] T041（iOS 模拟器复验二）three 版**要么出图要么一直黑**，加载中文案
      也不出现。两个原因：
      1. **文案写在 `new WebGLRenderer()` 之后**。构造期是几百次同步 host
         查询，整段 JS 卡住，Vue 的 `setText` 要等它返回才进帧 —— 底栏一直
         停在「等待画布…」。改成页面首帧就是「模型加载中…」，画布上再叠一层
         同样的文案；模型进场景并真正 `render` 之后才换成「拖动模型旋转」。
      2. **`ACTIVE_UNIFORMS = 0` 被 three 永久缓存**。T040 把乐观计数从
         `true`（读成 1，崩在 `info.name`）改成 0，不崩了，但 three 在
         第一次 `useProgram` 时把这个 0 写进 `WebGLUniforms` 再也不问。
         模型 fetch 若赶在 ANGLE 纹理建完之前触发了第一次 `render`，之后
         所有 draw 都不上传 uniform，画面就黑到永远 —— fetch 与建纹理谁先
         谁后是竞态，所以表现为「要么成功要么一直黑」。修复：上下文暴露
         `gl.ready()`（host `fjs.webgl.contextReady`），页面在 surface 就绪
         之前不 `render`，GLB 一进来先挂 `pendingModel`，ready 之后再 add +
         画。
