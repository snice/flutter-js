# Tasks: dev 引导要能熬过 iOS 的异步授权弹窗

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 确认三张契约表都不动：改动全在 Dart 侧（`DevClient`、`engine`、
      CLI 生成的 `main.dart` 模板），不跨 JSI/FFI。核对完即勾 → plan §1 II 行

## 实现

- [x] T010 `packages/flutter_fjs/lib/src/dev_client.dart`：加一条**只给引导用**
      的退避重试拉取。序列 `[1, 2, 3, 5, 8]` 秒、之后固定 8 秒、**不设上限**；
      每次尝试经既有 `onLog` 写一行（宪法 V：重试要看得见，不能闷头转）。
      `fetch()` 现有语义**不变**
- [x] T011 同上：注释写明**为什么只有引导重试**——页面自己的 `fetch()` 失败
      该让页面看见，偷偷重试会把「服务器 404」变成「卡 8 秒后再 404」
      （宪法 VI）
- [x] T017 **（实现时补，plan 初稿漏了）只重试「够不着」**：`SocketException`
      重试，`HttpException`（非 2xx，`http.dart:109` 抛的）立刻抛。不区分会
      踩坏 `fetchManifest` 的既有契约 —— 它靠 404 回落到 null 来兼容没有
      `/manifest.json` 的老 dev server，无限重试会让老 server 上的 app 挂死。
      见 plan §3.1b
- [x] T012 `packages/flutter_fjs/lib/src/engine.dart`：`connectDev()`（L609）
      与 `_loadFromDev()`（L730）里的三处引导拉取改走重试版 ——
      `fetchManifest()`、`/shared.js`、`fetchBundle()`
- [x] T013 同上：**`chunkLoader` 的 `/pages/<chunk>.js` 保持不变**（路由按需
      拉取不是引导），在代码里注明这条边界
- [x] T014 `packages/fjs/src/commands/run.ts` `writeHostMain()`（模板正文
      L655-695）：dev 分支 `runApp` 提前，连接改成不 await 的后台任务。
      **release 分支保持原样**（`await loadReleaseAssets()` 仍在 `runApp` 前，
      它不碰网络，spec §2 Non-goal）
- [x] T015 同上：`placeholder` 换成「转圈 + 一行
      `连不上 dev server <host:port>，重试中…`」，host:port 取自 `FJS_DEV`。
      不做重试按钮/次数面板（spec §7 拍板）
- [x] T019 **（实现中踩到并修好）不要用 `unawaited`**：它需要 `dart:async`
      导入，而我因为 hello-fjs 那个宿主的 `flutter analyze` 报「未使用」就把
      导入删了 —— 那只是那个工程恰好有别的东西再导出了它。仓库根目录的
      `.fjs/flutter` 宿主上直接编译失败：`Error: Method not found: 'unawaited'`。
      改成 `Future.ignore()`，不需要任何导入。
      **教训**：模板的验证不能只在一个工程上做
- [x] T016 同上：注释写明 `runApp` 为什么必须在 `connectDev` 之前 —— 附今天
      这条真实日志与「全黑」现象，并点出 **iOS 的授权弹窗要求 app 在前台且
      有 UI**，先上屏正是竞态的解（宪法 VI）

## 两端对齐

> web 侧**没有这条路径**：`fjs dev --web` 由 vite 直接伺服，浏览器自己就是
> 宿主，没有 `DevClient`、没有引导拉取、也没有 iOS 那两个系统授权。这是
> Flutter 宿主 dev 期的实现缺陷而非面向用户的能力，因此不进
> `docs/css-compat.md` / `docs/web.md` 的差异表（plan §1 I 行）。
> 这一组不省略，是因为宪法 I 要求把「做不到两端一致的地方」写明理由。

- [x] T020 `pnpm --filter hello-fjs run dev:web` 不回归：web dev 照常起、
      页面照常热更（本 spec 一行 web 代码都没改，确认没有误伤）
- [x] T021 确认「web 侧无对应实现」的理由已写进 plan §1 I 行与本节开头，
      无需改任何 web 文件

## 测试

- [x] T030 `packages/fjs/test/run.test.ts`：`writeHostMain` **目前一个测试都
      没有**。加断言把顺序钉住 —— 生成的 `main.dart` 里 `runApp` 出现在
      `connectDevString` 之前；release 分支的 `loadReleaseAssets` 仍在
      `runApp` 之前
- [x] T031 `packages/flutter_fjs/test/`：退避序列的用例 —— 注入一个失败 N 次
      再成功的 fetch，断言尝试次数与最终成功。
      **先编 native**：`cd packages/flutter_fjs/native && cmake --build
      build-native -j`，否则 `flutter test` 输出 `No tests ran` 是静默跳过
      不是通过（AGENTS.md §3、宪法 V）
- [x] T032 跑完 T031 **肉眼确认用例数变了**，别把 `No tests ran` 读成绿

- [x] T018 **（真机实测后补）启动时并行打一发公网探测**把「使用无线数据」
      弹窗勾出来：`http://captive.apple.com/hotspot-detect.html`，
      **仅 iOS、仅 dev、fire-and-forget**，成败都不影响引导。
      理由见 plan §3.1c：局域网请求不触发那张弹窗，而它没被回答之前所有网络
      都不通 —— 光重试永远等不到
- [x] T033 **iPhone 全新安装**（用 `xcrun devicectl device uninstall app`
      真删干净，连带权限）：实测通过。完整时序为证 ——
      `manifest failed … No route to host` → `retrying in 1s` →
      `retrying in 2s` → 用户点「允许」→ `GET /manifest.json 2072 bytes` →
      `bundle loaded` → `preloaded 40 page chunks`，**全程没重启 app**。
      探测与重试缺一不可：少了探测弹窗根本不出现，少了重试弹窗出现时请求
      早已失败
- [x] T034 重复 T033，点「不允许」：app 不崩，那行说明可见（用户实测）
- [x] T035 **dev server 未启动**：模拟器指向空端口 38955 实测 —— 屏幕是
      「转圈 + 连接 dev server 10.0.2.2:38955 中… / 连不上会自动重试，无需
      重启」（截图为证），日志退避 1→2→3→5→8s；用户实测确认整体没问题
- [x] T036 **Android 不回归**：模拟器上新模板正常引导、40 chunk 预加载、
      页面正常；用户实测确认没问题。
      注：`runApp` 提前改了启动时序（plan §4 的最大风险），**红米/RMX3700
      两台真机上没有单独复验**，设备当时不在 —— 与 028 的 T033b 一并补
- [x] T037 **release 不受影响**：模板的 release 分支保持 `await
      loadReleaseAssets()` 在 `runApp` 前，由 `writeHostMain` 的单测钉住
      （T030 第二条断言）；用户实测确认没问题

## 文档

- [x] T040 `docs/toolchain.md` `fjs run ios` 那节补：首次装机会弹哪两个系统
      授权（本地网络 / 无线数据）、引导会退避重试、点「不允许」之后去哪儿改
- [x] T041 同上：**已 eject 的宿主不会自动拿到新模板**（`run.ts` L563 那段
      注释说了 ejected host 保留自己的 `main.dart`），要说清楚怎么手动同步 ——
      否则 eject 过的人会觉得「怎么我这儿没修好」
- [x] T042 `docs/roadmap.md` 打勾
- [x] T043 `specs/028-webgl-present-path/tasks.md` 的 T037 注明「由 spec 030
      解决」

## 验收

- [x] T050 `flutter analyze` 11 issues（全是既有 deprecation/import 的 info，无新增、无 error）；`flutter test` **270 passed ~3**（改动前 267，+3 是新增的退避用例，确认不是 `No tests ran` 静默跳过）
- [x] T051 `tsc --noEmit` 通过；`packages/fjs` vitest **99 passed**（改动前 96，+3 是 `writeHostMain` 的新用例）；`pnpm test` 全过（runtime 281 / webview 36 / webgl 28）
- [x] T052 spec.md 第 6 节逐条核对：
      1-3 静态全过；4-5 iPhone 全新安装实测通过（时序日志为证，无需重启）；
      6 点「不允许」不崩、说明可见（用户实测）；7 空端口实测占位+退避截图为证；
      8-9 用户实测确认不回归。
      **一处如实标注**：`runApp` 提前改了启动时序，Android **真机**上没单独
      复验（设备不在，只在模拟器上验过），与 028 的 T033b 一并补
- [x] T053 spec.md 状态转 `done`
