# Plan: dev 引导要能熬过 iOS 的异步授权弹窗

对应 spec：`./spec.md`（待澄清三条已拍板，见其 §7）

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | **不涉及（有理由）** | web 侧**没有这条路径**：`fjs dev --web` 下页面由 vite 直接伺服，浏览器自己就是宿主，没有 `DevClient`、没有引导拉取、也没有 iOS 那两个系统授权。这是 **Flutter 宿主 dev 期的实现缺陷**，不是面向用户的能力，页面源码一行不改 —— 因此不进 `docs/css-compat.md` / `docs/web.md` 的差异表 |
| II 边界即契约 | **不涉及** | 三张表都不动。`DevClient` 与生成宿主的 `main.dart` 都在 Dart 侧，不跨 JSI/FFI |
| III 同步单线程零序列化 | **涉及（正面）** | 重试用 `Future.delayed` 排在 UI isolate 的事件循环上，不新开 isolate、不阻塞。`runApp` 提前之后，连接在后台跑，首帧不再等网络 —— 这正是宪法 III「JS 跑在 UI isolate 上」要求不要卡住的那条线 |
| IV 外观照 WeUI | **不涉及** | 失败态那一行字在宿主模板里（Flutter 侧的 `MaterialApp`），不是 fjs 内置组件，没有两端数值要对齐 |
| V 静默失效是 bug | **本 spec 的主条** | 今天的失败是：屏幕全黑 + 只在控制台一条未捕获异常。改完之后，(a) 引导退避重试而不是一次就死，(b) 占位先上屏，(c) 屏幕上有一行能看见的「连不上 dev server <host:port>，重试中…」 |
| VI 注释记录权衡 | **涉及** | 两处要写明「为什么」：(1) 为什么只有**引导**这段重试而页面自己的 `fetch()` 不重试（页面要自己处理失败，spec §2 Non-goal）；(2) 为什么 `runApp` 必须在 `connectDev` 之前 —— 附上今天这条真实日志与「全黑」的现象 |
| VII JS 能包就不要下 Dart | **必须落 Dart（有理由）** | 这段代码在 JS **存在之前**就要跑完 —— 它要做的就是把 JS bundle 拉下来。宿主进程的启动顺序、`dart:io` 的 socket 失败、Flutter 的 `runApp` 时机，JS 侧一个都够不着。判据不成立，只能落 Dart |
| VIII 变更落到文档 | **涉及** | `docs/toolchain.md`（dev 引导的重试行为 + 首次装机会弹哪些系统授权）。`docs/fjs-go.md` 视落点决定要不要跟一句 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| CLI / 构建 | `packages/fjs/src/commands/run.ts` `writeHostMain()`（L645 起，模板正文 L655-695） | dev 分支：`runApp` 提前，连接改成不 await 的后台任务；`placeholder` 换成带一行说明的组件（含 `FJS_DEV` 的 host:port）。**release 分支保持原样**（`await loadReleaseAssets()` 仍在 `runApp` 前 —— 它不碰网络，spec §2 Non-goal 说了不动 release） |
| CLI 测试 | `packages/fjs/test/run.test.ts` | `writeHostMain` **目前没有任何测试**。加一条：生成的 `main.dart` 里 `runApp` 出现在 `connectDevString` 之前 —— 这条顺序是本 spec 的核心，值得一个断言钉住 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/dev_client.dart` | 加一条**只给引导用**的退避重试路径（`[1,2,3,5,8]` 秒后固定 8 秒，不设上限）；`fetch()` 的语义不变。重试期间通过既有的 `onLog` 把每次尝试写出来 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/engine.dart` `connectDev()`（L609）/ `_loadFromDev()`（L730） | 引导这三处拉取改走重试版：`fetchManifest()`、`/shared.js`、`fetchBundle()`。**`chunkLoader` 的 `/pages/<chunk>.js` 不改** —— 那是路由按需拉取，不是引导，页面失败该让页面看见 |
| Dart 测试 | `packages/flutter_fjs/test/` | 退避序列可测（注入一个总是失败 N 次再成功的 fetch，断言尝试次数与最终成功）。**注意**：`flutter test` 找不到 host dylib 时输出 `No tests ran` 而不是失败（AGENTS.md §3），跑之前先编 native |
| JS runtime | — | 不动 |
| Web 适配层 | — | 不动（宪法 I 行已说明理由） |
| C++ 引擎 | — | 不动 |
| 文档 | `docs/toolchain.md` | `fjs run ios` 那节补：首次装机会弹哪两个系统授权（本地网络 / 无线数据）、引导会退避重试、点「不允许」之后去哪儿改 |

## 3. 方案

### 3.1 重试只加在「引导」这一段

判据很清楚：**引导拉取失败 = 整个 app 没东西可跑**，别的都不是。所以
`fetchManifest` / `/shared.js` / `fetchBundle` 走重试，页面自己的 `fetch()`
和路由 chunk 不走 —— 后两者失败时页面还在，该由页面处理（spec §2）。

退避沿用同文件 socket 那套 `[1, 2, 3, 5, 8]`，之后固定 8 秒，**不设上限**：
dev 期用户可能正在起 `fjs dev`，也可能正盯着系统授权弹窗，自己放弃没有意义。

### 3.1b 只重试「够不着」，不重试「服务器答了错」

（实现时发现，plan 初稿漏了这条。）`FjsHttp.fetch`
（`packages/flutter_fjs/lib/src/http.dart:109`）对非 2xx 抛
`HttpException('<code> for <url>')`，对连不上抛 `SocketException`。两者必须
区别对待：

- **`SocketException`（够不着）** → 重试。授权弹窗、server 还没起、wifi 抖，
  全是这一类。
- **`HttpException`（服务器答了）** → 立刻抛。404 不是瞬时失败，它是一个答案。

不区分就会踩坏一条既有契约：`fetchManifest` 的文档说「读不到就返回 null
（**老版本 server 没有 `/manifest.json`**，或一次瞬时失败）」。无限重试一个
404 会让这条回落永远等不到，老 server 上的 app 直接挂死。

### 3.1c 启动时主动打一发公网请求，把「使用无线数据」勾出来

（真机实测后补，plan 初稿假设「重试就够」是错的。）实测：全新安装只弹了
「查找并连接本地网络设备」，答完之后同一个进程仍然一路 `No route to host`；
而这台机器早先是用 `<image>` 加载公网图片才弹出「使用无线数据」的。

也就是说：**局域网请求不会触发那张弹窗，但那张弹窗没被回答之前所有网络都
不通**。重试等不到自己会出现的东西，必须有人去敲一下。

所以 dev 引导启动时**并行**打一发 `http://captive.apple.com/hotspot-detect.html`
（iOS 自己做 captive portal 检测用的那个端点）：

- **只在 iOS、只在 dev**（`FJS_DEV` 有值才会走到这条路径），release 一行都不跑；
- **fire-and-forget**：成败都不影响引导，只为把系统弹窗勾出来；
- 不带任何用户数据，响应几十字节。

### 3.2 `runApp` 提前，是「黑屏」那一半的修法

今天：

```dart
await engine.connectDevString(dev);   // 抛了
runApp(_FjsHostApp(engine: engine));  // 永远不会执行 → 全黑
```

改成先 `runApp`、连接在后台跑。这样：

- 首帧立刻有占位，用户看得到 app 活着；
- iOS 的授权弹窗有机会弹出来并被点到 —— **这正是竞态的解**：弹窗要求 app
  在前台且有 UI；
- 引导失败不再杀掉整个进程。

### 3.3 失败态就一行字

`placeholder` 换成「转圈 + `连不上 dev server <host:port>，重试中…`」。
不做重试按钮、不做次数面板（spec §7 拍板）：看得见就够了（宪法 V），
真有人需要再说。

### 3.4 被否掉的备选

| 备选 | 否掉的原因 |
|------|-----------|
| **再加一个 Info.plist 键** | 「允许使用无线数据」那个弹窗**没有对应的 Info.plist 键**，是系统按首次对外请求自动弹的。028 加的 `NSLocalNetworkUsageDescription` 管的是另一个弹窗，两个都加也不解决竞态 —— 竞态的根子是「弹窗是异步的，第一次请求已经失败了」 |
| **启动时先探测网络可达，再开始引导** | 探测本身就是一次对外请求，一样会撞上同一个弹窗、一样会失败。把竞态往前挪了一格而已 |
| **给 `DevClient.fetch()` 整体加重试** | 页面自己调的 `fetch()` 失败该让页面看见（`docs/ui-api.md` 的契约）。偷偷重试会把「服务器 404」变成「卡 8 秒后再 404」 |
| **`main()` 里 try/catch 包一下就完事** | 只解决「不崩」，不解决「连不上」。用户还是得手动重启 app 才能在授权之后连上 —— 而重启这一步正是今天最烦的地方 |
| **让 `connectDev` 内部吞掉异常** | 同上，且会把「配置写错了」（`FJS_DEV` 指向不存在的主机）也一起吞掉，变成永远转圈没有说明 |

## 4. 风险

**`runApp` 提前会改变启动时序，这是本 spec 最大的一处**。今天 JS bundle 在
第一帧之前就跑完了，改完之后第一帧是占位、bundle 稍后到。理论上
`FjsApp` 本来就有 `placeholder` 分支（`fjs_app.dart:27`）就是为这个准备的，
但**仓库里所有 dev 期的行为都是在「bundle 已就绪」的前提下跑出来的**，
时序一变可能有别的东西露头（例如 spec 027 的 `onPageSettled`、028 的
`Texture` layer 时机）。所以验收 8（Android 不回归）不能省。

**生成宿主是每次 `fjs run` 重写的**（`.fjs/flutter` 被 gitignore），所以模板
一改，所有项目下次跑就拿到新的 —— 好处是不用迁移，坏处是**已 eject 的宿主
不会自动拿到**（`run.ts` L563 那段注释说了 ejected host 保留自己的
`main.dart`）。这一点要写进 `docs/toolchain.md`，否则 eject 过的人会觉得
「怎么我这儿没修好」。

**`flutter test` 的 `No tests ran` 是坑不是通过**（AGENTS.md §3）：新加的
退避测试如果 native 没编，会静默跳过。验收 2 要肉眼确认用例数变了。

**iOS 那两个弹窗的触发条件不完全一样**：本地网络那个跟 `NSLocalNetworkUsage
Description` 绑定，无线数据那个是系统按首次对外请求弹的、还跟设备有没有蜂窝
有关。所以验收 4-6 要在**真正删干净的 app** 上做（删 app 会连带权限），
不能拿已经授权过的机器验 —— 028 的 T036 就是这么验漏的。

## 5. 验证路径

```bash
# 静态
cd packages/flutter_fjs/native && cmake --build build-native -j   # 否则测试静默跳过
cd packages/flutter_fjs && flutter analyze && flutter test
cd packages/fjs && npx tsc --noEmit && npx vitest run

# iPhone 全新安装（主场景）——先在系统设置里删掉 app
cd examples/hello-fjs && npx fjs run ios --device <id>
#   看：屏幕有占位不是全黑 → 系统弹授权 → 允许 → 不重启就连上

# dev server 未启动
#   先不起 fjs dev，直接跑宿主，看占位 + 重试日志；再起 fjs dev，自动接上

# 不回归
cd examples/hello-fjs && npx fjs run android --device <id>
cd examples/hello-fjs && npx fjs build --pages --release
```
