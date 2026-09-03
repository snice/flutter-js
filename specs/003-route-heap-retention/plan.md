# Plan: 路由切换后的 heap 滞留

对应 spec：`./spec.md`

## 1. 宪法自查

| 条款 | 是否涉及 | 怎么满足 |
|------|---------|---------|
| I 两端同源 | 涉及 | Flutter 侧保持 Navigator 出栈即销毁；Web 侧已有 KeepAlive include/tabs 语义，只补文档核对，不改页面写法。 |
| II 边界即契约 | 不涉及 | 不新增/修改 UI op、natives 表、事件类型。 |
| III 同步单线程零序列化 | 涉及 | 清理仍发生在现有 Vue unmount / `navPop` 同步链路内，不新增异步桥或 JSON 桥。 |
| IV 外观照 WeUI | 不涉及 | 不改默认外观。 |
| V 静默失效是 bug | 涉及 | 加 JS/Dart 回归测试，证明 pop/unmount 后内部索引不继续持有已删除页面。 |
| VI 注释记录权衡 | 涉及 | 对 subtree 清理与 cache 裁剪保留简短“为什么”，说明 handler closure 和 cache 长寿命风险。 |
| VII 变更落到文档 | 涉及 | 更新 `docs/web.md` / `docs/vue3.md` 的路由生命周期说明；如实现只改内部释放，不改 API，则不碰 `docs/ui-api.md`。 |

## 2. 涉及的层

| 层 | 文件 | 改什么 |
|----|------|--------|
| JS runtime | `packages/fjs-runtime/src/ui/element.ts` | 保留按节点删除事件 handler 的 helper；移除临时全局诊断或改为测试专用暴露。 |
| JS runtime | `packages/fjs-runtime/src/vue/renderer.ts` | Vue remove 时递归忘记整棵子树的 renderer/style/handler 状态。 |
| JS runtime | `packages/fjs-runtime/src/css/style.ts` | `forget(id)` 同步裁剪该元素的 match/chain cache，避免页面卸载后 cache 只增不减。 |
| JS tests | `packages/fjs-runtime/test/vue_unmount_handlers.test.ts` | 覆盖子树卸载后 descendant handlers 不再响应。 |
| JS tests | `packages/fjs-runtime/test/zz_leak_probe.test.ts` | 改成稳定回归测试：重复 route replace 后只剩当前页可达，并断言 style engine 追踪数量回落。 |
| Dart 宿主 | `packages/flutter_fjs/lib/src/mirror_tree.dart` | 如测试发现索引滞留，再补 `_styles` / `_signals` / `_parentOf` 清理；当前源码已递归删节点。 |
| Dart tests | `packages/flutter_fjs/test/mirror_tree_test.dart` | 补删除带子节点和 interned style 的子树后 `nodeCount/rootChildren` 回落的断言。 |
| 文档 | `docs/web.md`, `docs/vue3.md` | 明确 tab 保活和普通 route pop 销毁的内存语义。 |

## 3. 方案

选定方案：沿现有生命周期释放真实引用。Vue renderer 在 `remove` 时知道被删除的 root，但 Vue 不会逐个通知 descendants，所以 renderer 自己走 `childrenOf` 删除整棵子树的 `elementsById`、`parentOf`、`childrenOf`、`htmlDefaults`、`:active` 状态、style engine state 和 event handlers。style engine 的 `forget` 除了删除 element state，还删除该 state 挂过的 `chainKey` / `matchCache` 项，减少反复进出页面后全局 cache 的长期增长。

被否掉的备选：

- 每次路由 pop 后主动调用 `gc()`：只能改变回收时机，不能释放仍被引用的对象，也会把 GC 成本挪到返回动作上。
- 路由 pop 后重建整个 VM：能清空 heap，但会丢掉 tab 保活、全局状态和 dev 分包缓存，代价太大。
- 给 tab 切换也强制 unmount：会破坏当前文档承诺的 tabBar 状态保留。

## 4. 风险

- `styleEngine` cache 删除过猛可能让仍存活的同签名元素少一次 cache hit；语义安全，但要用现有 CSS/Vue 测试兜住。
- `removeChild` 的无框架 element API 不知道 descendants；本轮主修 Vue/router 路径，如后续发现手写 element API 也泄漏，需要给 element 层补独立树索引。
- QuickJS 自动 GC 仍可能延迟，验收必须看主动 GC 后的稳定区间，而不是每一秒采样都下降。

## 5. 验证路径

```bash
pnpm --filter @ufjs/runtime test
cd packages/fjs-runtime && pnpm run typecheck
cd packages/flutter_fjs && flutter test
```

人工验证：在正在运行的 `examples/hello-fjs` iOS 模拟器里重复「tab 页 → 详情页 → 返回」至少 20 次，观察 `nodes` 不随轮次增长；必要时通过 `fjs eval` 调 `gc()` 读主动回收后的 heap/object 数。
