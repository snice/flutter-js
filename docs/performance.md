# 性能测试

## 测试方法

`examples/bench` 内置微基准，通过 fjsrun（离线，无 Flutter UI 开销）执行：

```bash
cd examples/bench
pnpm run build
../../packages/flutter_fjs/native/build-native/fjsrun --pump 2000 dist/bundle.js
```

机器基线：Apple Silicon (M 系列)，macOS 26，flutter 3.24.5，quickjs-ng 0.9.0。

## 结果（2026-08 实测）

| 基准 | 耗时 | 吞吐 |
|------|-----:|-----:|
| fib(27) 递归 | 9.8 ms | — |
| 字符串拼接 100k | 93 ms | ~1.1k ops/ms |
| JSON.stringify 5k 对象 | 10.3 ms | ~486 ops/ms |
| 数组排序 10k | 3.2 ms | ~3.1k ops/ms |
| **UI 创建 1000 节点**（encode + 原生提交） | **20.3 ms** | ~49 节点/ms |
| **UI 更新 1000 文本**（setText 批量帧） | **3.0 ms** | ~330 更新/ms |

解读：

- UI 更新路径（二进制 op encode → 单次 uiOps 调用 → Dart 镜像树 → 重建）
  在 1000 文本规模约 3ms/帧，远低于 16ms 帧预算；**帧内大批量更新是本管线
  的甜点区**（微任务聚合把 N 次操作压成 1 次原生调用）
- Vue3 层在大列表场景下，响应式 patch 与帧提交主要受变更量影响；按页拆包后，
  常规页面切换只需要加载对应 page chunk
- 建议清单页超过 ~2000 常驻节点时改用 `list-view`（ListView 懒构建）

## Worker 加速

长任务（大数组排序/解析/搜索）应放入 Worker（独立 isolate + 独立 VM），
主线程保持响应。参考 examples/hello-js 的 fib worker 演示。消息为字符串（JSON 序列化结构化数据），
序列化成本 O(数据量)——高频率小消息建议合并后发送。

## 已知热点（优化路线）

- props 目前走 JSON 编码（每节点一次 jsonDecode）；后续可改成二进制属性表
- Dart 侧 `Uint8List.fromList(ops.asTypedList(len))` 有一次拷贝，可换
  零拷贝视图
- 每次 flush 的帧是全量 op 流（含无关节点 diff 产物）；帧压缩/去重可再做
