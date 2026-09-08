# Spec: fjs-slide 手势返回时上一页要视差跟随

- **ID**: 025-fjs-slide-previous-parallax
- **状态**: done
- **日期**: 2026-09-08

## 1. 要解决什么

`examples/hello-fjs` 写了 `transition: 'fjs-slide'`（文档定义为「iOS 式整页右滑，离开页视差跟随」）。iOS 上边缘滑动可以带走当前页，但**底下那一页原地不动**，没有跟着往右移回来。看起来只是当前页被拖走，不像 UIKit / 微信那种两页一起动。

Web 已经是对的：离开页 `translateX(-30%)`，返回时底下那页从 -30% 跟回来（`packages/fjs-runtime/src/web/base-css.ts`）。Flutter 侧 `fjs-slide` 走自定义 `_FjsCupertinoPageRoute`，只混了 `CupertinoRouteTransitionMixin`，没有像官方 `CupertinoPageRoute` 那样提供 `delegatedTransition`。底下的基页是 `MaterialPageRoute`，`canTransitionTo` 看不到这份委托，就不播 `secondaryAnimation`——所以只有顶页在滑。

`nav_router_test.dart` 里 `fjs-slide uses Flutter iOS defaults` 明确没断言离开页位移，并把原因记成 Flutter 3.38 的 MaterialApp `home` 行为；真正缺的是我们自己这条 Cupertino route 的委托转场。

## 2. 不做什么（Non-goals）

- 不改应用 API：仍然是 `createFjsApp({ transition: 'fjs-slide' })`。
- 不改 `fjs-fade` / `fjs-zoom` / `fjs-slide-up`（那些本来就规定底下页不跟滑）。
- 不改默认 `fjs-page`（空字符串、平台自带转场）。
- 不把 JS / canvas 挪线程，不回退 spec 024 的「UI 帧不重建 pages」。
- 不改 op 协议、natives、事件类型。

## 3. 用户可见的行为

写法不变：

```ts
createFjsApp({
  routes,
  shell: Shell,
  transition: 'fjs-slide',
}).mount();
```

在 Flutter（iOS / Android）上 `router.push` 一个二级页，以及从该页边缘滑动或点返回：

- 当前页整页右滑出 / 从右侧滑入（现有行为保留）。
- **同时**底下那一页沿水平方向视差移动：被盖住时略向左（大约页面宽度的 1/3，与 web 的 `-30%`、Cupertino `_kMiddleLeftTween` 一致），返回时跟手移回原位。
- 手势取消时两页都弹回手势开始前的位置。

Web 行为不变。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | `fjs-slide` 顶页 + 底页都走 Cupertino 水平视差；手势期间线性跟手 | `.fjs-slide-leave-to { translateX(-30%) }`，pop 时对调 |
| 事件载荷 | 不新增 | 不新增 |
| 已知差异 | 时长 500ms（Cupertino 默认）；web 具名转场是 280ms。这是现有差异，本需求不统一时长 | 无手势，CSS transition |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `cd packages/flutter_fjs && dart analyze lib/src/fjs_app.dart` 无 error。
2. `cd packages/flutter_fjs && flutter test test/nav_router_test.dart` 通过，并且 `fjs-slide` 用例在 push 中途断言**离开页**（基页 `home`）的中心点相对 push 前向左移，进入页仍从右侧进来；pop 中途基页向右跟回。删除「不断言离开页视差」的注释。
3. `pnpm --filter @ufjs/runtime test` 里现有 `web-transition.test.ts` 的 `fjs-slide` 用例仍通过（web 不改代码）。
4. `examples/hello-fjs`（`transition: 'fjs-slide'`）在 iOS 模拟器从「示例」进入任意二级页再边缘返回：两页一起动，底页不是钉死的。
5. `docs/routing.md` 的 `fjs-slide` 行（离开页视差跟随）与实现一致；若需点明 Flutter 侧靠 Cupertino `delegatedTransition` 驱动底页，补一句。

## 7. 待澄清

无
