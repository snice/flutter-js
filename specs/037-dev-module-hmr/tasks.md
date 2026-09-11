# Tasks: dev 模块级 HMR

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 运行时 unit 注册表：新建 `packages/fjs-runtime/src/dev-units.ts`
      （`__fjsDefineUnit` / `__fjsRequireUnit` / `globalThis.__FJS_MODULES`；
      缺 unit `warnOnce` + throw），从 `fjs` 主入口导出，vitest 覆盖
      单实例语义、缺 unit 抛错
- [x] T002 dev WS 协议扩展（三处同步，plan §2 第四张契约）：
      `packages/fjs/src/dev/server.ts` 的 `changeMessage()` 产出
      `reload units:<ids> pages:<chunks>`；`packages/flutter_fjs/lib/src/dev_client.dart`
      解析该消息（解析不出 → 全量 reload 回调 + 日志）；确认
      `RELOAD_SNIPPET` 把新消息落进 `location.reload()` 分支

## 实现

- [x] T010 probe 依赖图：`packages/fjs/src/bundler/build.ts` 的
      `appModuleGraph` 扩展出模块级边（metafile output imports）与
      transitive importers 计算，检测循环依赖（命中环 → 标记不可热替换
      + 告警）
- [x] T011 unit 构建：`build.ts` dev split 分支新增——每 registry 模块一个
      `dist/modules/<相对路径>.js`、拓扑序拼接的 `dist/modules.js`、每
      page chunk 与 bundle 的 `/pages/<c>.deps.json`；shared.js（dev）改为
      头部 `import 'fjs/dev-units'` 且不含 app 模块；release/bytecode
      分支零改动
- [x] T012 unit 桩：`packages/fjs/src/bundler/vue-plugin.ts`
      `sharedStubPlugin` 把 registry 集合内的 app 模块 resolve 成
      `module.exports = __fjsRequireUnit("<id>")`（bare/`__FJS_SHARED` 桩不变）
- [x] T013 dev server：unit 指纹改为输入闭包哈希、只重建输入变化的 unit；
      `changeMessage()` 按 plan §3.2 判定（entry 可达 → 全量兜底；纯
      page chunk → 既有 `reload pages:`）；静态服务 `/modules/<id>.js` 与
      `/pages/<c>.deps.json`；manifest 增补 units/deps 表
- [x] T014 Dart bootstrap 与懒加载：`packages/flutter_fjs/lib/src/engine.dart`
      split dev 分支在 shared.js 后 eval `modules.js` 再 bundle；page chunk
      懒加载（`chunkLoader` 路径与预载）先按 deps.json 补齐未加载 unit
- [x] T015 Dart 热替换：`engine.dart` 新增 `_hotSwapUnits(dev, units, pages)`
      （按序 fetch + eval、跳过未加载、对每个受影响 chunk 派事件 13、
      失败日志 + 回落 `_loadFromDev`），接上 `dev_client.dart` 的新回调

## 两端对齐

- [x] T020 web 端确认：`fjs dev --web` 收到 `reload units:…` 执行整页
      reload，行为与改动前一致；差异话术落 `docs/web.md`（与 T042 合并提交）
- [x] T021 两端对拍：同一处共享组件修改，`fjs dev --web` 整页刷新、
      App 端热替换（VM 不重建、页面栈保留），页面渲染结果一致
      —— 已验（2026-09-12）：同一处 Panel.vue 修改，web（内置浏览器）收到
      push 后 `location.reload()`，刷新世代标记清失、页面渲染正常；
      App（iPhone 17 Pro 模拟器）unit 热替换、页面栈保留、`__hmrProbe`=42 存活

## 测试

- [x] T030 vitest：依赖图与 `changeMessage()` 判定——页面独占 / 共享 /
      entry 可达 / 循环依赖 / 未知文件五类输入
- [x] T031 vitest：unit 构建产物形态——`dist/modules.js` 拓扑序、
      `modules/<id>.js` 可独立求值、deps.json 闭包正确（用 fixture 工程）
- [x] T032 回归：`pnpm test` 现有用例全绿（pages/tags/vue-plugin 等
      不受 unit 化影响）

## 文档

- [x] T040 `docs/toolchain.md`：`fjs dev` 热更新行为（三级：unit 热替换 /
      page 热替换 / 全量 reload）与新产物文件
- [x] T041 `docs/threading-model.md` 热重载行改为已达成；`docs/code-splitting.md`
      补 dev unit 形态一节
- [x] T042 `docs/web.md` 已知差异登记 web 端执行退化；`docs/roadmap.md`
      近期计划 HMR 条目移入已完成并附 spec 链接

## 验收

- [x] T050 `pnpm run typecheck` 全 workspace
- [x] T051 `pnpm test`
- [x] T052 release 回归冒烟：`fjs build --pages --bytecode` 产物
      `fjsrun dist/bundle.js` 正常（plan §5）
- [x] T053 设备验证 spec 第 6 节 3–6 条（2026-09-12，iPhone 17 Pro 模拟器，
      hello-fjs）——四场景全过：
      ① 页面独占 `src/pages/comp/swiper.vue` → `pushed "reload pages:comp-swiper"`
        → `[dev] reloaded page comp-swiper`，无 bundle loaded（VM 不重建）；
      ② 共享组件 Panel.vue（模板）→ `pushed "reload units:src/components/Panel.vue
        pages:<36 页>"` → `[dev] hot-swapped … — remounted …`：仍在轮播详情页
        （栈保留）、`fjs eval` 读回 `__hmrProbe`=42（VM 存活）、页面重挂可见
        （swiper autoplay 状态随重挂复位）；改 entry 可达的 Shell.vue →
        `pushed "reload"` → bundle loaded、marker 变 undefined（VM 重建）；
      ③ 构建期语法错误 → server `build failed` 不推送，设备保持原状不白屏；
        同批混合改动（page+unit）→ `reload` 兜底；
      ④ 运行期工厂抛错（模块级 `<script>` throw）→ server 推 units →
        `[js:warn] [dev] unit swap failed (FjsException: … hmr-fallback-probe)`
        → 回落 bundle loaded；还原后热替换恢复正常。
- [x] T054 spec.md 第 6 节逐条核对并把结果记在本条
      —— 1 单元测试：`packages/fjs/test/dev-units.test.ts`（changeMessage 五类
      输入 + unit 产物形态）与 `packages/fjs-runtime/test/dev-units.test.ts`
      （注册表语义），`pnpm test` 532 项全绿；2 typecheck 全 workspace 通过；
      3–4 端到端：hello-fjs `fjs dev --pages` 实测 —— 改共享组件
      `Panel.vue` 推 `reload units:src/components/Panel.vue pages:<36 页>`，
      改 entry 可达的 `Shell.vue` 推 `reload`，SFC 块外注释不改变产物故不推送
      （指纹去重按设计工作）；5 同 4（entry 可达 → 全量兜底）已验；
      6 eval 抛错回落路径由 `_hotSwapUnits` 的 catch 覆盖（与
      `_hotSwapPages` 同构），真机复验随 T053；7 `fjs build`、
      `fjs build --bytecode` 冒烟通过，单 bundle `fjsrun` 正常渲染 UI 帧
      （split 产物不经 fjsrun 为存量行为）；8 `fjs dev --web` 冒烟：变更
      推 `reload`，RELOAD_SNIPPET 整页刷新，行为与改动前一致。3–6 的
      真机观察已在 T053 完成（见上）。
