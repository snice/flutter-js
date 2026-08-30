# flutter-js Roadmap 第二期实施计划

基于现有代码（widgets.dart 渲染层、vue/renderer.ts、fjs-runtime、engine.dart）扩展五条线。

## M1 组件扩展（表单组 + 布局组 + 交互组）

**Dart 渲染层**（`packages/flutter_jsc/lib/src/widgets.dart`）新增标签映射：

| 标签 | Flutter 映射 | props |
|------|-------------|-------|
| `switch` | Switch | value, onValueChanged(text 载荷 "1"/"0") |
| `checkbox` | Checkbox | value, onValueChanged |
| `slider` | Slider | value, min, max, onValueChanged(数值字符串) |
| `progress` | Linear/CircularProgressIndicator | value(0-1)，无 value 则 indeterminate |
| `divider` | Divider | — |
| `stack` | Stack | 子节点 style.position:absolute + top/left/right/bottom → Positioned |
| `safe-area` | SafeArea | — |
| `refresh` | RefreshIndicator | onRefresh(异步：JS 回 Promise? v1 用 onRefresh 事件 + 完成 JS 手动) v1 简化为触发事件即收起 |
| `swiper` | PageView | 子页面；onPageChanged |
| `modal` | showModalBottomSheet/Dialog 通道 | visible prop 驱动，普通 Widget 树内实现（覆盖层） |
| `toast` | Overlay + Timer | `__fjs.toast(msg)` 原生函数 → Dart onToast 回调显示 SnackBar 式浮层 |
| `platform-view` | 预留：tag 进入 Dart 注册表（用户可用 registerComponent + AndroidView/UiKitView 自己接入平台视图），文档给完整示例 | viewType |

交互组新原生通道：natives.cpp 增加 `__fjs.fns.toast(msg)`，走 on_log 类似的新回调 `on_toast` 到 Dart Overlay 显示。

**fjs-runtime**：element API 补类型定义与便捷构造（`h('switch', {value:true, ...})`）；新 toast 封装 `import { toast } from 'fjs'`。

## M2 Dart 组件注册表（Dart 映射组件）

- `packages/flutter_jsc/lib/src/component_registry.dart`：`engine.registerComponent(String tag, ComponentBuilder builder)`，builder 签名 `(MirrorNode node, List<Widget> children) -> Widget`
- widgets.dart 渲染顺序：内建标签 → 注册表 → 未知标签 fallback `view`（并在 debugPrint 提示未注册）
- JS/Vue 零改动：`create('my-chart', props)` 与 `<my-chart :style/>` 直接生效
- embedded-basic 增加 Dart 注册组件演示（如 `dart-clock` 用注册组件渲染模拟钟表，props 双向：JS 设时区/标题）
- docs/jsi-and-native-modules.md 增加"用 Dart 注册自定义组件"章节 + platform-view 接入示例

## M3 Vue 标准 HTML 标签自动映射

`packages/fjs-runtime/src/vue/renderer.ts`：

- `HTML_ALIASES`：div/section/main/ul/ol/li/nav/header/footer/view容器→view；span/p/label/b/strong/em/i/h1-h6/a/small→text；img→image；button→button；input（text/password）→input；textarea→input multiline；select → v1 用 input+按钮组合或映射 slider/switch（文档注明）；table/tr/td→view row 嵌套；br→text '\n'
- 内建默认样式表：h1-h6/fontWeight+size、p/label margin、a 蓝色下划线样式建议（通过 patchProp 阶段注入默认 style，用户 style 覆盖）
- 事件适配：@click→onTap；@input→onTextChanged；@change→onValueChanged；@submit 保留
- scoped CSS 仍不支持（文档注明），样式走 :style
- vue3-app 示例改写一部分用标准 HTML 标签验证；新增离线 fjsrun 断言（产物含 view/text 映射标签）

## M4 Worker（真·后台线程）

**原生层**：fjs.h 新增 worker 句柄 API（runtime 级隔离，无需改 C 核心——直接复用 fjs_vm_* 在另一个线程创建独立 VM；QuickJS 多 runtime 天然线程安全）。
**Dart 层**（`packages/flutter_jsc/lib/src/worker.dart`）：
- `Worker(code)`：`Isolate.spawn` 后台 isolate → 内部 `FlutterJsc` 独立实例（无 UI 帧接收，onUiOps 忽略）→ eval code
- 主→worker：SendPort → worker isolate 内调用 `engine.dispatchEvent` 同机制的新入口 `engine.deliverMessage(text)`（复用 fjs_vm_dispatch_event 的通道，全局函数 `__fjsWorkerMessage(text)`）
- worker→main：worker VM 的 `postMessage(text)` → 新 native 回调 on_worker_message → 主 isolate 派发到 `worker.onmessage`
- `worker.terminate()`：isolate kill + vm destroy
**fjs-runtime**：Web Worker 兼容子集封装（`new Worker(code)`, onmessage, postMessage, terminate），主线程对象在 fjs-runtime，worker 内部的 `postMessage/onmessage` 由 host.ts 注入
**示例**：examples/hello-js 增加 worker demo（fib(40) 后台计算，UI 不卡帧——用主线程 setInterval 渲染计数证明流畅）
**限制文档**：消息 v1 仅字符串/JSON；无共享内存；每 worker 独立 npm 打包入口（esbuild 多入口）

## M5 复杂 Vue3 演示 + 性能测试

**examples/vue3-dashboard**（行情仪表盘）：
- 500+ 条行情项 v-for（:key diff）、computed 排序/过滤、3 层嵌套子组件（QuoteRow/Board/FilterBar）、setInterval 模拟推送（每 250ms 随机更新 50 条）、swiper 页签切换板块
- 内置基准面板：挂载耗时、每次 patch 耗时（nowMs 打点）、帧字节数统计，页面上直接展示
- 场景开关：100/500/1000 条规模切换

**性能基准**（examples/bench + docs/performance.md）：
- `fjsrun --bench` 或 bench 示例脚本输出 JSON 结果：JS 引擎裸性能（fib、字符串拼接、JSON 序列化）、UI 帧吞吐（每帧节点数 × 帧率）、Vue3 挂载 1000 节点耗时、批量更新耗时
- macOS/Android/iOS 各跑一轮，结果与测试方法记录 docs/performance.md
- Worker 加速验证：dashboard 的排序计算移入 Worker 前后主线程帧耗时对比

## 里程碑与验证

- M1→M5 顺序实施，每个 M 完成即 commit
- 验证手段：Dart 单测（组件注册表、HTML 映射）、fjsrun 离线协议断言、macOS 桌面真跑截图、Android/iOS 模拟器抽查（M5 收尾统一跑一轮）
- 新增/修改文件：widgets.dart、natives.cpp/fjs.h（toast 回调）、component_registry.dart（新）、worker.dart（新）、vue/renderer.ts、fjs-runtime、examples/{hello-js,vue3-dashboard,bench}、docs/{ui-api,vue3,jsi-and-native-modules,performance}.md、README 矩阵更新

平台视图（video/map 等）：通过 M2 注册表机制提供接入能力 + 文档示例，不内置具体平台视图实现（属业务接入范畴）。