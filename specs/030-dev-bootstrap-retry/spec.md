# Spec: dev 引导要能熬过 iOS 的异步授权弹窗

- **ID**: 030-dev-bootstrap-retry
- **状态**: done
- **日期**: 2026-09-10
- **前置**: 028（加了 `NSLocalNetworkUsageDescription`，让弹窗**出现**，但没解决
  竞态 —— 见其 tasks T037）

## 1. 要解决什么

**iPhone 上全新安装的 app 连不上 dev server，而且屏幕是全黑的。**

```
flutter: [js:info] [dev] GET /manifest.json failed in 197ms:
  SocketException: Connection failed (OS Error: No route to host, errno = 65),
  address = 192.168.8.194, port = 38900
[ERROR:flutter/runtime/dart_vm_initializer.cc(40)] Unhandled Exception:
  SocketException: ...
```

两条独立的缺陷叠在一起：

1. **首次引导的 HTTP 拉取没有重试**。iOS 的网络授权弹窗是**异步**的 ——
   系统弹窗弹出来的那一刻，第一次请求**已经失败了**，用户点「允许」时
   app 早就抛完异常了。实测两种弹窗都会这样：
   - 「允许"X"查找并连接到你本地网络上的设备？」（`NSLocalNetworkUsageDescription`，028 已加）
   - 「允许"X"使用无线数据？」（无线数据 / 蜂窝，首次对外请求时弹）

   `DevClient.fetch`（`packages/flutter_fjs/lib/src/dev_client.dart:50`）
   一次失败就 rethrow。对比之下 **WebSocket 断线是有退避重连的**
   （同文件 `_retryDelays = [1, 2, 3, 5, 8]`）—— 引导这条路反而最脆。

1b. **（真机实测追加）「使用无线数据」那个弹窗，局域网请求根本不会触发它。**
   全新安装后实测：弹出来的只有「查找并连接本地网络设备」，授权之后
   **同一个进程仍然一直 `No route to host`**，退避重试 1→2→3→5→8→8… 一直
   等不到。而这台机器早先是**用 `<image>` 加载了一张公网图片**才弹出
   「允许…使用无线数据」，答完之后 dev 才连得上。
   
   结论：这个授权在没被回答之前会挡住 app 的全部网络（含局域网），但
   **只有访问公网主机的请求才会把它勾出来**。所以重试再久也没用 —— 没有
   任何东西去触发那张弹窗。dev 引导必须**主动打一发公网请求**把它勾出来。

2. **引导失败会让整个 app 打不开，而且没有任何提示**。CLI 生成的宿主
   （`packages/fjs/src/commands/run.ts` 写出的 `main.dart`）是：

   ```dart
   await engine.connectDevString(dev);   // 抛了
   runApp(_FjsHostApp(engine: engine));  // 永远不会执行
   ```

   于是连 `FjsApp` 的 `placeholder`（那个 `CircularProgressIndicator`）都
   看不到，屏幕全黑，只有控制台一条未捕获异常。**静默失效是 bug**（宪法 V）。

同一个形状还覆盖另外两种日常情况：`fjs dev` 还没起来就先开了 app；启动那一
瞬间 wifi 抖了一下。今天这两种也都是「app 全黑，重启一次才行」。

## 2. 不做什么（Non-goals）

- **不动 release 路径**。`loadReleaseAssets()` 读的是 assets，没有网络，
  不需要重试。
- **不改 `fetch` 的通用语义**。页面自己调的 `fetch()` 该失败就失败（页面要
  自己处理），加重试的只有**引导**这一段。
- **不做「探测网络可达再开始」**。那是另一个竞态，重试本身就够。
- **不碰 web**。见第 4 节。
- **不新增 iOS 权限键**。「使用无线数据」那个弹窗没有对应的 Info.plist 键，
  它是系统按首次对外请求自动弹的。

## 3. 用户可见的行为

全新装机、权限一次都没授过：

1. 打开 app → **看到占位（转圈），不是黑屏**
2. 系统弹「允许…使用无线数据 / 查找本地网络设备」
3. 点「允许」→ **几秒内自动连上**，不需要手动重启 app
   （两张弹窗都要能出现：本地网络那张由 dev server 请求触发，
   「使用无线数据」那张由启动时的一发公网探测触发）
4. 点「不允许」→ app 不崩，屏幕上有一条**能看见**的说明（不是只在控制台），
   说清楚连不上 dev server 以及去哪儿改

`fjs dev` 还没起来时同理：先开 app 会看到占位 + 重试，`fjs dev` 一起来就自动
接上。

页面代码一行不改，`app.config.ts` 也不用配。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 引导拉取退避重试；失败态在屏幕上可见 | **不存在这条路径** |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | — | — |

**web 侧没有对应实现，也不需要**：`fjs dev --web` 下页面由 vite 直接伺服，
浏览器自己就是宿主，没有 `DevClient`、没有引导拉取、也没有需要用户授权的
本地网络权限。这是 **Flutter 宿主的 dev 期实现缺陷**，不是面向用户的能力，
因此不进 `docs/css-compat.md` / `docs/web.md` 的差异表。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

`DevClient` 与生成宿主的 `main.dart` 都不跨 JSI/FFI 边界。

## 6. 验收标准

**静态**

1. `cd packages/flutter_fjs && flutter analyze` 无 issue
2. `cd packages/flutter_fjs && flutter test` 全过（需先编 native，否则
   `No tests ran` 是坑不是通过）
3. `cd packages/fjs && npx tsc --noEmit && npx vitest run` 通过
   （生成宿主模板的测试）

**iPhone 全新安装**（这是本 spec 的主场景）

4. 先在系统设置里删掉 app（连带权限），`npx fjs run ios --device <id>`：
   启动后屏幕上**能看到占位而不是全黑**
5. 系统弹出网络授权，点「允许」后**不重启 app**，几秒内日志出现
   `[dev] preloaded N page chunks`，页面正常渲染
6. 重复 4，这次点「不允许」：app 不崩，屏幕上有可见的失败说明

**dev server 未启动**

7. 先不起 `fjs dev`，直接 `flutter run` 宿主：看到占位 + 日志有重试记录；
   再起 `fjs dev`，app 自动接上，无需重启

**不回归**

8. Android 真机：`npx fjs run android --device <id>` 正常连上，行为不变
9. release 包不受影响：`fjs build --pages --release` 装机后正常（无 dev 路径）

**文档（宪法 VIII）**

10. `docs/toolchain.md` 记 dev 引导的重试行为与首次装机会弹哪些系统授权
11. `docs/fjs-go.md` 或 `docs/threading-model.md` 视落点补一句（按实现落点定）

## 7. 待澄清

三条已拍板（2026-09-10）：

- [x] **重试策略** → 沿用同文件 socket 那套 `[1, 2, 3, 5, 8]` 秒退避，之后固定
      8 秒一直重试，**不设上限**。dev 期不该自己放弃：用户可能正在起
      `fjs dev`，也可能正盯着系统授权弹窗。
- [x] **`runApp` 提前到 `connectDev` 之前** → 做。占位先上屏、连接在后台跑，
      引导失败不再让 app 全黑。改的是 CLI 生成的 `main.dart` 模板，所有项目
      下次 `fjs run` 重新生成宿主时自动拿到。
- [x] **失败态显示** → 先给一行字（「连不上 dev server <host:port>，重试中…」），
      不做重试按钮／次数面板。看得见就够了（宪法 V），做重的等有人真需要。
