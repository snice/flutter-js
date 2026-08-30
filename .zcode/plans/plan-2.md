Vue 渲染优化：共享运行时预加载 + 帧快照直出
背景（已探明的事实）
白屏根因：模式切换走 engine.reset()（销毁 VM + 清空镜像树）→ 重新 eval 全量 bundle（774KB，含 vue 运行时）→ 重新挂载。清树到新帧到达之间就是白屏。
native 层已支持同一 VM 多次 eval 且全局持久（vm.cpp:138-223），但 Dart/构建侧都假设"一个 bundle = 一次 eval"。
镜像树可确定性重放：节点 id 按 creation order 从 1 分配，同 bundle 同输入 → 新 app 的帧 id 与快照帧 id 一致，新帧可以无缝续写快照树。
Part 1 — vue-shared.js 共享运行时（方向 1）
构建侧（packages/fjs/src/build.ts + vue-plugin.ts）

新增共享入口 packages/fjs/src/vue-shared-entry.ts：

ts
import * as vue from 'vue';
import * as fjs from 'fjs';
import * as fjsVue from 'fjs/vue';
globalThis.__FJS_SHARED = { vue, fjs, 'fjs/vue': fjsVue };
fjs build --shared-runtime：仅构建共享块（IIFE，out: vue-shared.js；--bytecode 时经 fjsc 出 vue-shared.fjsbundle）。产物对每个 vue app 通用，只构建一次。
fjs build --shared（app 模式）：vue-plugin 新增 stub 插件，把 vue/fjs/fjs/vue（及 @vue/* 兜底）resolve 为 module.exports = globalThis.__FJS_SHARED['<name>'] 的虚拟 CJS 模块，产物不再含 vue/fjs-runtime（~770KB → 预计 <80KB）。
dev/默认路径保持单 bundle 不变（--shared 不开时行为完全不变）。
宿主侧（embedded-basic/main.dart + pubspec.yaml） 5. assets 增加 vue-shared.fjsbundle。 6. _load(vue3/vue3+bc)：reset 后先 runBundle(vue-shared) 再 runBundle(app)；用 _sharedLoaded 标记保证每个 VM 只加载一次。 7. 提前加载：启动时（初始 hello 模式加载完成后）就预 eval 共享块（它只定义全局、无 UI 无定时器，与 hello 共存无害）→ 点 vue3 时只剩几十 KB 的 app 字节码要跑。

Part 2 — 首页直出：帧快照重放（方向 2，Lynx 思路的落地版）
Lynx 的"直出"= UI 线程立即渲染预编译模板，JS 线程后台接管。这里用等价机制：

记录：engine.dart 的 _onUiOpsTrampoline 顺带把每帧追加到 _frameLog（reset() 时清空）；暴露 takeFrameLog(): Uint8Array（拼接后返回）。
宿主缓存：embedded-basic 维护 Map<_Mode, Uint8Array>；_load(mode) 时若该模式有快照： reset() → tree.clear() → 逐帧 applyFrame() 重放（同步、不经过 JS，立即恢复上次完整 UI，白屏归零）→ 再后台预加载共享块 + eval app。新 app 的帧 id 与快照一致，直接在恢复的树上做 keyed patch，无缝接管；首帧到达后更新该模式缓存。
mirror_tree_test.dart 加重放单测（录制帧 → clear → 重放 → 树一致性断言）。
不做的事（明确边界）
冷启动直出（Lynx 式构建期模板编译 + 原生 inflate）不做：工作量大数倍，且当前痛点是切换白屏，重放已覆盖。
持久 VM + 应用热切换（不做 per-VM reset）不做：模块级单例（styleEngine/nextId/eventHandlers）和旧 app 定时器会跨应用泄漏，收益（省 ~50ms runtime eval）不抵风险；重放方案下 runtime eval 反正发生在恢复后的 UI 后面，用户不可见。
验证
单测：fjs-runtime vitest、flutter_jsc flutter test（含新重放测试）、tsc。
macOS 实测：模式来回切换逐帧截图确认无白屏；[load] 日志对比切换耗时；vue3/vue3+bc/hello 三方互切 + dark 切换 + input/switch 状态重置回归。
涉及文件
packages/fjs/src/{build.ts, cli.ts, vue-plugin.ts, vue-shared-entry.ts(新)}
packages/flutter_jsc/lib/src/{engine.dart, mirror_tree.dart(小改), test/mirror_tree_test.dart}
examples/embedded-basic/{lib/main.dart, pubspec.yaml, assets/vue-shared.fjsbundle(新)}
examples/vue3-dashboard/{package.json scripts}