# Roadmap

## v1 已交付

- QuickJS-ng 0.9.0 源码嵌入（Android CMake / iOS & macOS CocoaPods）
- JSI 式直调：宿主函数收发原生 JSValue，无序列化
- 源码 + QuickJS 字节码双模式（fjsc 编译器 + engine id 校验）
- element API（h/create/…）+ 每微任务批量 UI 帧协议
- Vue 3 SFC 支持（script setup + template 编译、响应式、v-for/v-if）
- fjs CLI：create / dev / run / build / --bytecode / --pages / --release
- fjsrun 离线运行器（不需要 Flutter 即可验证 bundle）
- Dart 宿主模块（invokeHost 同步调用）

## 第二期（已完成 2026-08）

- ✅ 组件扩展：switch/checkbox/slider/progress/divider/stack/safe-area/
  refresh/swiper/modal + toast 全局函数
- ✅ Dart 组件注册表：engine.registerComponent（JS 零改动；platform-view 经此接入）
- ✅ Vue 标准 HTML 标签自动映射（div/span/h1-h6/img/button/input... +
  默认样式 + @click/@input 事件适配）
- ✅ Worker 真·后台线程（Dart isolate + 独立 QuickJS runtime，Web Worker 风格 API）
- ✅ 复杂 Vue3 能力（大列表 v-for + computed + 嵌套组件 + Worker 排序）与
  性能基准（examples/bench + docs/performance.md）
- ✅ `fjs create` 默认 Vue3+Vite 模板，`fjs run android|ios` 自动创建 Flutter 宿主
- ✅ `fjs build --pages --release` 生成 `.fjsbundle` 并同步到 Flutter assets，
  `--apk` 可继续打 Android APK

## v1.1（已完成 2026-08）

- ✅ `<style>` / `<style scoped>`：JS 侧 CSS 引擎（基础选择器集、级联、
  继承、:deep/:global），class/`:class` 全链路打通
- ✅ 样式对齐常用 web：flexGrow→Expanded、gap、min/max 尺寸、display:none、
  overflow:hidden、boxShadow、linear/radial-gradient、opacity、border/
  borderRadius 简写、rgb()/rgba()/hsl()/命名色、px 单位、完整文字样式族
  （fontStyle/lineHeight/letterSpacing/textDecoration/textTransform/
  textShadow/fontFamily/whiteSpace）

## 近期计划

- **HMR**：dev 模式按模块替换而不是重建 VM（需在 bundle 中保留模块边界）
- **结构化对象跨越 JSI**：HostObject 句柄（JS_GetOpaque 持 C++ 指针），
  避免对象以字符串形式跨越 invokeHost
- **异步宿主调用**：Promise 化的 invokeHostAsync（当前全同步）
- **列表性能**：list-view 走 ListView.builder + item 复用 + 按需绑定
- **伪类与状态样式**：`:active` 映射按压态（button 优先）、`:first-child/
  :last-child`；`:hover` 桌面端
- **CSS 扩展**：@media（映射 Flutter 断点）、dashed 边框自绘、百分比尺寸、
  transition 动画

## 中期

- **Worker 线程**：QuickJS 多 context + 消息传递（postMessage 语义），
  长任务移出 UI 线程
- **React 接入**：fjs/react 自定义 reconciler（协议与 Vue 渲染器共享）
- **fjsc 预编译产物分发**：npm 包附带常见平台二进制，免去本机构建
- **字节码加密/签名**：防篡改与资产保护
- **性能基线**：批量帧 vs 逐节点提交的基准测试；启动耗时报告

## 远期

- Windows / Linux 桌面端（CMake 已预留，MSVC 适配 QuickJS 需少量补丁）
- Flutter Web 目标的 JS 直通实现（无引擎，直接用浏览器 JS，同 API）
- 调试器协议：Chrome DevTools 接 QuickJS debugger
- 三方原生模块包管理（npm 包声明 native/ 目录，构建期合并）
