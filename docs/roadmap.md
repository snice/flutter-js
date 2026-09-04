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
- ✅ **宿主原生配置**：根目录 `app.config.ts` 可配置 Android/iOS 包名、
  Android permissions 和 iOS `Info.plist` 键值，managed 宿主每次同步时应用
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

## 视图容器属性补齐（已完成 2026-09）

`specs/009-scroll-swiper-props/`，对着小程序的属性表把两个容器补完：

- ✅ `scroll-view`：`scroll-x` / `scroll-y`、`scroll-top` / `scroll-left`
  （受控但不粘手）、`scroll-into-view`、`scroll-with-animation`、
  `upper-threshold` / `lower-threshold`，以及 `@scroll` /
  `@scrolltoupper` / `@scrolltolower`
- ✅ `swiper`：`current`、`circular`、`autoplay` + `interval`、`duration`、
  `vertical`、`indicator-dots`，`swiper-item` 自己撑满一页
- ✅ 两个新事件号（24 scrolltoupper / 25 scrolltolower）三处同步；滚动语义
  （载荷字段序、到边只在进入阈值区时派一次、circular 的索引取模）写在
  `fjs-runtime/src/scroll/metrics.ts`，Dart 侧 `render/scroll_metrics.dart`
  逐条镜像
- ✅ 顺手修掉两处**只在 Flutter 上哑火**的事件名：模板写 `@scrolltolower`
  给出的是全小写 prop，而事件表里只有驼峰；`@change` 写在 swiper 上会被当成
  控件的值变化。element 层现在遇到不认识的 handler 会告警而不是静静丢掉（宪法 V）

> ⚠️ **破坏性变更：`@scroll` 的载荷**。以前是一个裸的偏移量字符串，现在是
> 六字段 JSON 串
> `{"scrollTop","scrollLeft","scrollHeight","scrollWidth","deltaX","deltaY"}`
> （字段序固定、数值一位小数）。页面里 `@scroll="(v) => (top = Number(v))"`
> 这种写法要改成 `@scroll="(v) => (top = JSON.parse(v).scrollTop)"`。
> 两端同时改，web 和 Flutter 给出的字符串逐字符相同。

同组里 **region picker / editor** 顺延：`region` 要内置并维护行政区划数据集，
`editor` 是独立富文本引擎，和 picker 的列机制不是同一体量。

## image mode 与加载事件（已完成 2026-09）

`specs/010-image-mode-events/`，把内置 `image` 从「只有 `src` 和 `fit`」补到
uni-app 那张表：

- ✅ `mode` 的 14 个值两端同源（`fjs-runtime/src/image/mode.ts` ↔
  `render/image_mode.dart`）：`scaleToFill` / `aspectFit` / `aspectFill` /
  `widthFix` / `heightFix` 加九个裁剪对齐位。默认 `scaleToFill`，未知值告警降级；
  显式 `mode` 压过旧的 `fit`，只写 `fit` 的老页面行为不变
- ✅ `lazy-load`：web 用 `IntersectionObserver`，Flutter 沿
  `RenderAbstractViewport` 比对 viewport（没有引入 `visibility_detector`）。
  两端共用预加载余量 `IMAGE_LAZY_PRELOAD_PX = 240`，所以同一页在两端是在同一个
  滚动位置开始加载；普通页面、`scroll-view`、`list-view` 里都可用，宿主给不出
  viewport 时告警并立即加载
- ✅ `@load` / `@error`（事件号 26 / 27，三处同步）。载荷
  `{"width":n,"height":n}` / `{"errMsg":"image load failed"}`，字段序固定、两端
  逐字符相同，同一轮加载互斥且只派一次，换 `src` 丢弃旧结果
- ✅ Flutter 网络图改用 `cached_network_image`（内存 + 磁盘缓存），asset 仍走
  `AssetImage`，空 `src` 不发请求

实机对拍时抓到三个只有跑起来才看得见的问题：Dart 的 mode 分支漏了 `center`
（静静降级成 `scaleToFill`）；web 的 `heightFix` 因为 column flex 的 stretch 被
拉满父宽，和 Flutter 的 `高 × 比例` 对不上；两端的 lazy 预加载余量原本一个 240
一个 0，同一页在不同滚动位置开始加载。三处都补了回归用例。

## 本地图片（已完成 2026-09）

`specs/017-local-image-assets/`，让 vite/vue 的标准写法在两端都成立。之前
`import png from '@/assets/x.png'` 在 Flutter 侧**构建就失败**（app 那几条
esbuild 没配 `file` loader），而 `public/` 下的文件在 App 上**运行期静默失败**
（`public/` 从来没被同步进 Flutter host）。

- ✅ 本地文件统一成**根绝对路径**：import 的资源 → `/assets/x-<hash>.png`，
  `public/` 下的 → 原样。`asset://x` 作为旧写法等价于 `/x`
- ✅ 打包器五处 app 侧 esbuild 补 `file` loader，`outfile` 换成
  `outdir` + `entryNames`（否则 page chunk 会把图吐到 `dist/pages/assets/`）
- ✅ `public/` 与 `dist/assets/` 一起同步进 `assets/fjs/public/`，pubspec
  **递归**列出每一级目录（Flutter 的 asset glob 不递归，漏了不报错）
- ✅ Dart 侧一条规则解析根路径：连着 `fjs dev` 走 dev server，否则读 Flutter
  asset（`FjsAssetScope` 把 `devUri` 供给 widget 层）
- ✅ 三处静默失效补上告警：`fjs dev --web` 的 SPA 兜底不再对带扩展名的路径返回
  index.html；web 侧 `asset://` 剥前缀后是根路径而不是相对路径；Flutter 侧
  解析不出的 src（`.svg`、相对路径、越界路径）warn 后走 `@error`

模拟器上抓到的一个：dev 下改 `public/` 里的图，因为图片缓存按 URL 建键而 public
路径不变，页面还显示第一次拉到的那张。dev URL 现在带一个随完整 reload 自增的
`?fjs=<n>`。

## textarea（已完成 2026-09）

`specs/012-textarea/`，多行输入从「`<input multiline>` 凑合」补成对齐小程序的
`textarea`：

- ✅ `textarea` 是 **JS 组件**（`components/textarea.ts`），渲染成 `<input multiline>`，
  `tags.json` 不加条目。默认值、props 归一化、`@linechange` 的门都在组件里，两端共用
  一份；只有真正需要平台控件的四样落到共用的 `widgets/input.dart`：`auto-height` 关掉
  时的内部滚动、行数、焦点、键盘确认键
- ✅ `auto-height`：开时跟着内容长，关时到三行为止并在框里滚（Flutter `maxLines: 3` /
  web `rows="3"`，跟着字号走而不是一个像素数）；页面给了高度就填满那个盒子
- ✅ `focus` / `auto-focus` 受控焦点、`confirm-type` 的六个值、`placeholder-style`
  的四个键
- ✅ `@linechange`（事件号 28，三处同步），载荷 `{"height":n,"lineCount":n}`，
  只有行数变化才派，首帧不派。**不给 `heightRpx`**——fjs 没有 rpx 坐标系
- ✅ `@confirm` 复用事件号 4：它就是 `input` 的 `@submit` 在多行下的名字

> ⚠️ **破坏性变更：`<textarea>` 的 `maxlength` 默认值**。以前 `<textarea>` 只是
> `<input multiline>` 的 HTML 别名，不限长度；现在它是 textarea，默认 **140 字截断**
> （照小程序）。不想要上限的页面要显式写 `:maxlength="-1"`。截断是静默的，和 `input`
> 一样不给计数器 UI。

实现中发现「元素还是组件」的判定**有四处**，plan 只数到两处：构建
（`vue-plugin.ts`）、Web 构建（`vite.ts`）、运行时的 HTML 别名表（`renderer.ts`）、
Volar 插件（`volar.cjs`）。`form` 之所以从没暴露这个问题，是因为它同时还在
`tags.json` 里。组件标签现在单独一份 `component-tags.json`，四处共读，
`packages/fjs/test/vue-plugin-tags.test.ts` 盯着它——判错是静默的：页面照常渲染，
但渲出来的是原生 `<textarea>`，fjs 的 props 变成没人认识的 HTML 属性。

## web-view（已完成 2026-09）

`specs/013-web-view/`，嵌一张网页的能力，做成**模块** `@ufjs/webview`
（`packages/fjs-webview/`，形状照 `fjs-iconmind`）：

- ✅ `<web-view src @load @error @message />`：app 侧 `webview_flutter` 的
  `WebViewWidget`，web 侧 `<iframe>`；props 与三个事件载荷两端逐字符相同
- ✅ **不是内置标签**，`tags.json` 不加条目。`webview_flutter` 要 Dart SDK ^3.5，而
  `flutter_fjs` 声明 >=3.3——内置就得让所有应用跟着抬下限，做成模块只有装的人付。
  **核心的 `environment.sdk` 一个字没动**
- ✅ 事件号仍归核心发（宪法 II）：新增 `onMessage: 29`；26/27 从
  `FJS_EVENT_IMAGE_LOAD/_ERROR` 改名成 `FJS_EVENT_LOAD/_ERROR`，**值不变**，载荷形状
  由标签决定
- ✅ 它是**普通盒子**，不照小程序铺满整页；`@message` **立即派**，不照搬「攒批到后退
  时一次交付」。两条差异都写进了 `docs/ui-api.md`
- ✅ `asset://` 让模块自带的网页在 dev（dev server）/ release（Flutter asset）/ web
  （应用 `public/`）三处都能加载

实机才暴露的三个问题，都已修并补了用例：

1. **dev server 的 `/modules/` content-type 写死 application/json**，WebView 把 HTML
   当文本显示，而 `@load` 照常派——只看事件发现不了。现在按扩展名给
2. **release 下 `asset://demo.html?q=x` 无法传参**：Flutter asset 是 manifest 里的键，
   不是 URL。web-view 现在用无参数 key 查找文件，再在首次本地导航时恢复 query/fragment，
   页面与 dev/web 一样可以读取参数
3. **换 `src` 后旧 iframe 把它的 `load` 报成了新 URL 的**（web 侧，generation 挡不住，
   因为监听器是同一个闭包）

> 顺带记一条排查结论：iOS **模拟器**里网页的中文显示成豆腐块，不是编码问题（字节是
> 合法 UTF-8、响应带 charset、换 vite 服务一样），也不是没有中文字体（同一个 WebView
> 打开 m.baidu.com 正常），而是页面 font stack 以 `-apple-system` / `system-ui` 开头
> 时模拟器不再往 CJK 回退。真机不受影响。

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
