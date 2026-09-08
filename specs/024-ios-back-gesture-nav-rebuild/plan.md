# Plan: iOS 手势返回被 Navigator.pages 重建打断

对应 spec：`./spec.md`

待澄清两条仍空着，**不挡开工**：修复必须让「持续 rAF」和「偶尔一次 notify」都不再打断手势；导航栏返回本来就走 `fjs.nav.pop`，pages 只在栈变时更新之后行为与现在的命令 pop 一致。用户已同意进入 plan。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 否（已知差异） | 缺陷只在 Flutter 声明式 `Navigator.pages`；web 无 iOS 边缘返回，走 vue-router。spec §4 已登记 |
| II 边界即契约 | 否 | 三张表不动；仍是 `fjs.nav.*` / `navMount` / `navPop` |
| III 同步单线程零序列化 | 否 | 不把 JS/canvas 挪线程；只让路由栈刷新别跟 UI 帧绑在一起 |
| IV 外观照 WeUI | 否 | 不改组件外观 |
| V 静默失效是 bug | 是 | `nav_router_test.dart` 找不到 host dylib 时现有 early-return 会 `No tests ran`，本需求加的用例必须落在同一文件里，注释保持「没编 native 是跳过不是通过」 |
| VI 注释记录权衡 | 是 | `fjs_app.dart` 写清：为什么不能 `ListenableBuilder(engine)`、为什么复用同一份 `pages` 仍不够（见 §3） |
| VII JS 能包就不要下 Dart | 是 | 这是 Flutter `Navigator` 的宿主行为，JS 组件层够不着；不改 tetris / runtime |
| VIII 变更要落到文档 | 是 | `docs/routing.md` 的 Flutter 时序段：`pages` 只跟 `navStack`；手势返回中途不卸 JS（并顺手把仍写「`onDidRemovePage` 立刻 `navPop`」的过时句改成 spec 003 的 dispose 后回派） |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | — | 不动 |
| Web 适配层 | — | 不动 |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | 去掉对整个 `FjsEngine` 的 `ListenableBuilder`；只在 `navStack` 的 key/transition 变化时 `setState`；`build` 把同一份 `pages` 列表交给 Navigator |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` | 不必加公开 `navListenable`。`notifyListeners` 仍表示「树或栈可能变了」；在 nav 相关注释里点明 FjsApp 会自己过滤。`reset()` 清栈已走 `_scheduleUiNotify`，FjsApp 能看到空栈 |
| Dart 测试 | `packages/flutter_fjs/test/nav_router_test.dart` | UI 帧不更换 `pages` 引用；pop 动画中途 UI 帧不 `createRoute`、JS 页仍在 |
| 文档 | `docs/routing.md` | 见 VIII |

## 3. 方案

**选定：`FjsApp` 自己听 `engine`，栈没变就不动。**

`FjsView` 已经有自己的 `ListenableBuilder`，镜像树刷新不需要祖父级再建一遍 Navigator。

```
FjsEngine.notifyListeners()     // UI 帧、rAF、nav 都会走到这里
        │
        ├─ FjsView          照旧 rebuild（canvas / 文本）
        └─ FjsApp           比较 navStack 的 (key, transition, path)
                              相同 → return（不 setState）
                              不同 → snapshot + setState → 新 pages
```

实现要点：

1. `_FjsAppState` 在 `initState` / `didUpdateWidget` 订阅 `engine.addListener`。`navStack` 的 getter 每次都是新的 `unmodifiable` 视图，**不能**用列表引用比，要比 entry 的 `key` + `transition` + `path`。变化时 `List<NavEntry>.of(...)` 快照再 `setState`。
2. `build` 用快照组 `pages`，并把这份 `List<Page>` **存在 State 里**，栈没变就反复传同一个 list。Flutter 的 `oldWidget.pages != widget.pages` 是引用相等；新 list 就会 `_updatePages()`。
3. 只做第 2 步、仍然 `ListenableBuilder(engine)` **不够**。`Navigator.didUpdateWidget` 在 pages 引用不变时也会对每条 route 调 `changedExternalState()` → `_forceRebuildPage()`，iOS 的 `_CupertinoBackGestureDetector` 一样被拆掉。所以 **UI 帧上 FjsApp 不能 rebuild**，不是「rebuild 但 pages 是同一份」。
4. `FjsPerfOverlay` 挪到 listener 外面（它自己看 `engine.perfOverlay` + 定时采样），避免为了面板把 Navigator 整树刷掉。
5. spec 003 的时序不动：手势 `onRouteRemoved` 只 park；`navPop` 仍在 `onRouteTransitionComplete`。JS `fjs.nav.pop` 仍走 `_beginRoutePop` 立刻改栈——那一次 FjsApp **应当** setState，好让 Navigator 开启动画；动画期间后续 UI notify 栈已经稳定，不再 setState。

**被否：**

| 备选 | 否掉原因 |
|------|----------|
| 转场期间在 JS 里停 rAF / tetris 暂停即 `cancelAnimationFrame` | 治不了五子棋 touch、`dispatchEvent` 空转 notify、任何别的页；spec 明确非目标 |
| 给 `FjsEngine` 拆 `navListenable` / `uiListenable` | 能用，但多一个公开订阅面；FjsApp 过滤就够，宿主从不自己听 nav |
| 改回命令式 `Navigator.push/pop` | 和 JS `navStack` 对账要重写，spec 003 的 pages 生命周期会散 |
| 缓存 pages 但仍 `ListenableBuilder(engine)` | 见上：`changedExternalState` 仍每帧 `_forceRebuildPage` |
| `dispatchEvent` 无 op 就不 `notifyListeners` | 能减 FjsView 空 rebuild，但不是手势坏的充分条件，本需求不做 |

## 4. 风险

- **漏比字段**：replace 会换 key，只比 key 够用；`path` / `transition` 仍要比，避免同 key 改名却不刷新 `Page.name`。
- **engine 被替换**：`didUpdateWidget` 要卸旧听新，并立刻同步栈（热重载 / 测试里会换实例）。
- **父级 rebuild**（键盘 insets、主题）：FjsApp 仍会 `build` → Navigator `didUpdateWidget` → `changedExternalState`。这是 Flutter 声明式 Navigator 的固有点，比每帧 rAF 稀有，本需求不包一层「Navigator 永不 update」。
- **测试无 dylib**：新用例必须写在 `nav_router_test.dart` 现有 `if (lib == null) return;` 后面，不能新开一份「看起来跑了其实没断言」的文件。

## 5. 验证路径

```bash
cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart lib/src/engine.dart
cd packages/flutter_fjs && flutter test test/nav_router_test.dart
pnpm --filter @ufjs/runtime test
pnpm --filter @ufjs/runtime run typecheck
# 设备：hello-fjs iOS 模拟器
#   /example/tetris 进行中、点暂停 各滑一次返回
#   /example/gomoku、任意 /comp/* 详情 各滑一次
#   导航栏返回仍可用
```
