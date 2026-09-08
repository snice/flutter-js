# Plan: fjs-slide 手势返回时上一页要视差跟随

对应 spec：`./spec.md`

待澄清无未答项。

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 是（Flutter 补齐） | Web 已有 `-30%` 离开视差，不改 CSS。Flutter 给 `_FjsCupertinoPageRoute` 补官方同款 `delegatedTransition`，底页才能跟 |
| II 边界即契约 | 否 | 三张表不动 |
| III 同步单线程零序列化 | 否 | 只动 Navigator route 转场 |
| IV 外观照 WeUI | 否 | 转场不是组件外观 |
| V 静默失效是 bug | 是 | 现有测试把「底页不移」写成框架行为，等于把缺陷测成通过。改成断言位移；dylib 缺失仍走同一文件的 early-return |
| VI 注释记录权衡 | 是 | 写明为什么必须抄 `CupertinoPageRoute.delegatedTransition`，mixin 本身没有 |
| VII JS 能包就不要下 Dart | 是 | 这是 Flutter `PageRoute` 的委托转场，JS 组件层够不着 |
| VIII 变更要落到文档 | 是 | `docs/routing.md` 的 `fjs-slide` 补一句 Flutter 底页靠 `delegatedTransition` |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | — | 不动 |
| JS runtime | — | 不动 |
| Web 适配层 | `packages/fjs-runtime/src/web/base-css.ts` | 不改（已是 `-30%`） |
| C++ 引擎 | — | 不动 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/fjs_app.dart` | `_FjsCupertinoPageRoute` 覆盖 `delegatedTransition` |
| Dart 测试 | `packages/flutter_fjs/test/nav_router_test.dart` | push/pop 中途断言基页 `home` 水平位移 |
| 文档 | `docs/routing.md` | `fjs-slide` 行补 Flutter 委托转场 |

## 3. 方案

**选定：与 `CupertinoPageRoute` / `_PageBasedCupertinoPageRoute` 同一句。**

```dart
@override
DelegatedTransitionBuilder? get delegatedTransition =>
    CupertinoPageTransition.delegatedTransition;
```

放在 `_FjsCupertinoPageRoute` 上。`ModalRoute.didChangeNext` 看见它且与自身不同，就把 `receivedTransition` 交给底下的 `MaterialPageRoute`；Material 的 `canTransitionTo` 认 `nextRoute.delegatedTransition != null`，于是底页用 Cupertino 的 `_kMiddleLeftTween` 做 secondary 滑动。手势期间 `linearTransition` 仍由顶页 mixin 处理，底页委托动画跟 `secondaryAnimation`。

注释写清：mixin **不**提供这个 getter，只写在 `CupertinoPageRoute` 实体类上，所以我们这条自定义 route 漏了就会只有顶页在动。

**被否：**

| 备选 | 否掉原因 |
|------|----------|
| 基页也改成 `FjsTransitionPage(cupertinoRoute: true)` | 基页 `transition: ''` 是平台默认；tab replace 仍走 Material。只为视差改基页类型，会牵动默认 `fjs-page` |
| 自己写一套 SlideTransition 包底页 | 手势曲线 / 1/3 位移要重刻 `_kMiddleLeftTween`，和框架升级脱节 |
| 改 `CupertinoPageTransitionsBuilder` 当 route 而不是 mixin | `fjs-slide` 已经靠 mixin 拿到返回手势；缺的只是委托给**上一页** |

## 4. 风险

- **测到外层 MaterialApp 的 home**：`find.text('home')` 必须是内层 Navigator 基页。现有用例已经在 `FjsApp` 里 mount `home`；断言用 `getCenter` 相对 push 前的 `homeX`，不要拿屏幕中线当基准。
- **Android 主题**：`pumpApp(platform: iOS)` 才走 Cupertino 手势；视差断言同样在 iOS 主题下做。具名 `fjs-slide` 在 Android 上也是这条 Cupertino route，委托转场与平台无关，但 widget 测试沿用现有 iOS theme 即可。
- **spec 024**：只加 getter，不让 FjsApp 在 UI 帧上 rebuild pages。

## 5. 验证路径

```bash
cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart
cd packages/flutter_fjs && flutter test test/nav_router_test.dart
pnpm --filter @ufjs/runtime test -- web-transition.test.ts
# 设备：hello-fjs iOS 模拟器，示例 → 任意二级页，边缘返回看底页是否跟手
```
