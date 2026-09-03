# Spec: 路由切换后的 heap 滞留

- **ID**: 003-route-heap-retention
- **状态**: in-progress
- **日期**: 2026-09-03

## 1. 要解决什么

`examples/hello-fjs` 在 iOS 模拟器里由 `FjsApp` 加载后，反复进入二级路由再返回，或在几个页面之间来回切换，调试浮层里的 QuickJS heap / JS object 数持续增长，长时间不下降，偶尔才回收。用户看到的是：页面已经返回，但 JS 侧对象还像仍被引用一样越积越多，难以判断是正常 GC 延迟还是路由卸载泄漏。

这次要把路由生命周期收紧：非 tab 页面从 Flutter Navigator 出栈后，Vue app、element 树、事件处理器、样式引擎索引和宿主镜像树都必须释放到可回收状态；主动 GC 后 heap/object 数应回到稳定基线。

## 2. 不做什么（Non-goals）

- 不改变 tab 页保活语义。`meta.tab` 页面在 tab 间切换时会 park，这是 mini program 式 tabBar 的设计；离开 tab 组时才销毁。
- 不调整 QuickJS 自动 GC 阈值，也不做定时 GC。自动回收慢不等于泄漏；本规格只修真实引用滞留，避免 GC 落在路由 push/转场帧里造成抖动。
- 不新增 UI 标签、样式能力或事件类型。
- 不改变页面写法，不要求 `examples/hello-fjs` 为了释放内存手写清理代码。

## 3. 用户可见的行为

页面代码写法不变：

```vue
<script setup lang="ts">
import { useRouter } from 'fjs/router';

const router = useRouter();
</script>

<template>
  <view @tap="() => router.push('/comp/button')">
    <text>open</text>
  </view>
</template>
```

在 `examples/hello-fjs` 里：

- tab 间切换时，最多保留已访问的 tab 页及其状态，heap 可以高于冷启动基线；这是设计行为。
- 从 tab 页进入详情页再返回时，详情页对应的节点和 JS 对象不应随着次数线性增长。
- 调试浮层的 `nodes` 在返回后回到当前 tab 页需要的数量；调用 `gc()` 后 heap/object 数应在小范围内波动，而不是每轮持续上台阶。浮层的 heap 是不触发 GC 的采样，可能包含已经不可达但尚未被 QuickJS 扫掉的对象。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | Navigator route 移除后发送 `navPop`，JS router 卸载 Vue app 并删除该页 root 子树 | vue-router + KeepAlive 只缓存仍在历史栈里的页，pop 掉的页销毁 |
| 事件载荷 | 不新增事件；沿用 `navPop` 无载荷 | 不新增事件 |
| 已知差异 | tab 页由 JS router park，隐藏但不销毁 | tab 页由 Web app 的 KeepAlive include/tabs 保活 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `pnpm --filter @ufjs/runtime test` 通过，并包含路由 push/back 后 element/event/style 引用释放的回归测试。
2. `cd packages/flutter_fjs && flutter test` 通过，并覆盖 Dart 镜像树删除子树后内部索引不保留已删节点。
3. `cd packages/fjs-runtime && pnpm run typecheck` 通过。
4. `examples/hello-fjs` 在 iOS 模拟器里重复执行「从 tab 页进入同一个详情页 → 返回」至少 20 次，`nodes` 不随轮次增长；主动调用 `gc()` 后 heap/object 数回到稳定区间。
5. tab 页切换的保活行为保持不变：切回已访问 tab 时状态仍保留；离开 tab 组后 parked tab 被销毁。
6. `docs/web.md` / `docs/vue3.md` 中关于路由生命周期和 tab 保活的说明与实现一致。

## 7. 待澄清

无
