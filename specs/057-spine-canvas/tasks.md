# Tasks: @ufjs/spine

- [x] T001 `packages/fjs-spine` 包骨架（package.json / tsconfig / workspace），依赖 spine-core 4.3.13
- [x] T002 移植 CanvasTexture / SkeletonRenderer（类型换成 fjs 2d context 与图片句柄）
- [x] T003 AssetManager：FjsDownloader 走 runtime fetch，loadTexture 走 loadCanvasImage，reuseAssets 去掉 `instanceof Image`
- [x] T004 drawTriangle 改为 transform 后建裁剪路径（App 路径变换语义差异）
- [x] T005 素材：spineboy 贴图反预乘 + pngquant，atlas 去 `pma: true`，放 `public/spine/`
- [x] T006 hello-fjs 示例页 `example/canvas/spine`
- [x] T007 web（Browser）+ iOS 模拟器验证
- [x] T008 小程序：mp build 把 public 数据文件编译成 JS 模块 + `fjs/public-data.js` 注册表（真机 readFile 读不到代码包）
- [x] T009 小程序：wx fetch 根相对 GET 查注册表 → FileSystemManager → 404
- [x] T010 小程序：vendor 打包把 `@ufjs/runtime` / `fjs` 映射到 wx 运行时
- [x] T011 小程序：vendor.js 注入 requestAnimationFrame / cancelAnimationFrame 转发（模块包装遮蔽）
- [x] T012 DevTools（automator）验证加载与渲染
- [x] T013 小程序真机验证（用户）
- [x] T014 SpinePlayer：spine-player 配置 / 方法封装在 canvas SkeletonRenderer 之上（ctx 传入，resize / handleTouch 由页面调）
- [x] T015 示例页改用 SpinePlayer（播放暂停、倍速、进度、动画列表、controlBones、debug），web / iOS 模拟器 / 小程序 DevTools 验证
- [x] T016 小程序：canvas 触点 offsetX/Y 取自带 x/y（controlBones 真机拖不动）
- [x] T017 真机复测：资源加载、拖动 root（用户）
