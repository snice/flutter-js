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

- ✅ 组件扩展：switch/checkbox/slider/progress/divider/safe-area/
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

## v1.2（已完成 2026-08）

- ✅ **列表性能**：list-view 走 `ListView.builder`；行用稳定 key +
  `findChildIndexCallback`，滚动时复用已有 render box；JS 侧只物化可视窗口
  （`preloadExtent` 首屏批量、`prefetchExtent` 触底续接），按需绑定
- ✅ **按压态 `:active`**：CSS 引擎为命中 `:active` 的节点额外算一份按压样式，
  随 `activeStyle` 一起下发；Flutter 侧由节点自己的按下状态就地切换（不回 JS，
  滑动取消按压），web 侧直接是浏览器原生的 `:active`
- ✅ Web 适配层对齐：默认行高/默认色、内置组件默认外观、scroll-view 方向与
  鼠标拖拽、swiper 一次一页（见 docs/web.md「已知差异」）

## 工具链分发（已完成 2026-08）

- ✅ **fjsc 预编译产物分发**：`@ufjs/fjsc-<平台>` 五个平台包作为 `@ufjs/cli` 的
  optionalDependencies 按 `os`/`cpu` 自动装，用户不需要 CMake / NDK。
  交叉编译走 `.github/workflows/fjsc-release.yml`，发布流程见
  [publishing.md](publishing.md)

## CLI v1.3（已完成 2026-08）

命令从 `create / dev / run / build` 扩到十二个，覆盖「建页面 → 看路由 → 查环境 →
看体积 → 管原生宿主 → 上设备调试」这条链：

- ✅ **生成器**：`fjs create page|component`（别名 `fjs g`），支持嵌套与动态段
  `user/[id]`、`<route>` 块参数、`--dry-run` / `--force`；生成后用构建期同一个
  扫描器回读并打印真实路由和 `router.push` 调用
- ✅ **路由类型**：构建 / dev / Vite 插件 / 生成器都会写 `src/fjs-routes.d.ts`，
  `push({ name })` 有补全和拼写检查（空注册表时退回 `string`，老项目零影响）
- ✅ `fjs routes`（路由表 + 重名重路径告警）、`fjs doctor`（11 项体检，慢探测
  异步化并带转圈）、`fjs devices`、`fjs clean`（只删自己生成的，且只在项目内）
- ✅ `fjs build --analyze`：每个产物的 js / gzip / 字节码尺寸 + 包占比
- ✅ `fjs build` / `fjs dev` 首帧节点数静态预警：页面超过 `fjs.performance.nodeBudget`
  时提示改用 `list-view`、窗口化或降低默认首屏节点数
- ✅ **宿主归属**：`package.json` 的 `fjs.flutterDir` 配置项，
  `fjs host status|create|open|eject|sync|id`。eject 后 fjs 不再改写
  `lib/main.dart` / `pubspec.yaml` / Gradle 补丁
- ✅ `fjs icon`：一张方图重生成两端图标，缩放外调 sips / ImageMagick，零图像依赖
- ✅ **dev server 快捷键**：`r` 重建并推 reload、`l` 就地开关日志流、`d` 看连接
  数、`c` 重出地址与二维码、`--web` 下 `o` 开浏览器、`?` 列表、`q` 退出；只在
  交互式终端启用（被 `fjs run` 拉起时自动关闭）
- ✅ `fjs log` / `fjs eval`：经 dev server 转发到设备 VM，返回值走日志通道，
  不需要"能返回值的 eval"原生接口；App 与浏览器构建行为一致
- ✅ 路由修正：动态页的 name/chunk 由文件路径推导（`user/[id]` → `user-id`，
  `[...all]` → `all`），web 端 catch-all 翻译成 vue-router 语法后两端
  `params.pathMatch` 同为字符串

## 表单组件（已完成 2026-09）

对着 hello uni-app「内置组件 → 表单组件」这一组补齐，spec 在
`specs/007-form-components/`：

- ✅ `radio` / `radio-group` / `checkbox-group`：组只管互斥与收集，
  载荷两端逐字节相同（选中项的 `name` / `name` 的 JSON 数组串）
- ✅ `label`：`for` 或子树第一个控件，切换或聚焦
- ✅ `form`：`@submit` 收集子树里带 `name` 的控件当前态（未改动的也带默认值），
  `@reset` 只发事件；配 `<button form-type="submit|reset">`
- ✅ `button` 的 `type` / `size` / `plain` / `loading` / 显式 `disabled`
- ✅ `input` 的 `@focus` / `@blur` / `maxlength`，以及补上 Flutter 侧缺的
  `keyboard` → `keyboardType`
- ✅ 四个新事件号（20 focus / 21 blur / 22 formSubmit / 23 formReset）三处同步
- ✅ `picker` / `picker-view` / `picker-view-column`：滚轮下到 Flutter
  `ListWheelScrollView` 与 web `scroll-snap`，弹层和 selector / multiSelector /
  time / date 四种 mode 留在同一份 JS 组件里；spec 在 `specs/008-picker/`

同组里 **region picker / editor** 顺延：`region` 要内置并维护行政区划数据集，
`editor` 是独立富文本引擎，和 picker 的列机制不是同一体量。

## 近期计划

- **HMR**：dev 模式按模块替换而不是重建 VM（需在 bundle 中保留模块边界）。
  `--pages` 已经能按页推送变更的 chunk，还差模块级边界
- **结构化对象跨越 JSI**：HostObject 句柄（JS_GetOpaque 持 C++ 指针），
  避免对象以字符串形式跨越 invokeHost
- **异步宿主调用**：Promise 化的 invokeHostAsync（当前全同步）
- **伪类补全**：`:first-child` / `:last-child`；`:hover` 桌面端
  （`:active` 已完成，见 [css-compat.md](css-compat.md#4-按压态-active)）
- **CSS 扩展**：@media（映射 Flutter 断点）、百分比尺寸、transition 动画。
  当前支持范围见 [css-compat.md](css-compat.md)，加一条要改的 7 个地方也在那里
  （dashed / dotted 边框自绘已完成，见 `render/dashed_border.dart`）
- **`fjs splash` 启动图**：不是"换几张图"那么简单——Android 12+ 走
  `windowSplashScreenAnimatedIcon` 主题属性，更早版本走 `launch_background.xml`
  的 layer-list，iOS 是 `LaunchScreen.storyboard` 里的 imageset，三套机制三种
  改法且都要改 XML。`fjs icon` 那套外调缩放可以直接复用
- **`fjs upgrade`**：把 `@ufjs/cli`、`@ufjs/runtime`、pubspec 里的 `flutter_fjs`
  一起升到咬合的版本。三者版本必须匹配，手动升是踩坑重灾区
  （`fjs doctor` 目前只能发现不匹配，不能修）
- **`fjs preview`**：静态服务 `dist/web`，对齐 `vite preview`，验证 release
  web 产物
- **`fjs build --ipa` / `--aab`**：目前只有 `--apk`

## 中期

- **React 接入**：`fjs/react` 自定义 reconciler，协议与 Vue 渲染器共享。
  接入步骤和前置重构（把影子树簿记 + StyleEngine 提到共享模块）已经写在
  [custom-renderer.md](custom-renderer.md#接一个新框架以-react-为例)
- **字节码加密/签名**：防篡改与资产保护
- **启动耗时报告**：目前 [performance.md](performance.md) 只有运行期基准，
  冷启动（读字节码 → prelude eval → 首帧）还没有数字
- **`fjs native add|list|remove <capability>`**：`fjs native add camera` 往宿主
  pubspec 加插件、注册 `engine.registerComponent`、写好 d.ts。依赖三方原生模块
  包管理先成型。命名上和已经落地的 `fjs add <npm 包>` 分开：前者动宿主
  （pubspec、Dart、权限清单），需要 list/remove/sync 对着可 eject 的宿主收敛；
  后者只动 JS 侧。JS 库用 `requires` 声明它需要哪个 capability，两边由此咬合
- **`fjs lint`**：扫 `.vue` 里用到但 CSS 引擎还不支持的属性（transition、
  @media、百分比尺寸等），提前报出来而不是运行时静默失效
- **`fjs types`**：把 `tags.json` → 组件 d.ts / Volar 数据的生成暴露成命令

## 远期

- Windows / Linux 桌面端（CMake 已预留，MSVC 适配 QuickJS 需少量补丁）
- Flutter Web 目标的 JS 直通实现（无引擎，直接用浏览器 JS，同 API）
- 调试器协议：Chrome DevTools 接 QuickJS debugger（`fjs log` / `fjs eval` 已经
  把 dev socket 变成双向通道，断点和堆栈是它的超集）
- 三方原生模块包管理（npm 包声明 native/ 目录，构建期合并）
