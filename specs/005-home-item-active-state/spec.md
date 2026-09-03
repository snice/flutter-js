# Spec: 首页条目按压态

- **ID**: 005-home-item-active-state
- **状态**: done
- **日期**: 2026-09-03

## 1. 要解决什么

`examples/hello-fjs/src/pages/index.vue` 和 `examples/hello-fjs/src/pages/example.vue` 的列表条目可以点击进入二级页面，但按下时没有视觉反馈。

## 2. 不做什么（Non-goals）

- 不调整页面结构和路由。
- 不新增 JS 状态或事件处理。
- 不改变其他示例页样式。

## 3. 用户可见的行为

点击首页和示例页的列表 item 时，条目会出现轻微灰色按压态，松开后恢复。

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | 使用运行时已支持的 `:active` 下发 activeStyle | 浏览器原生 `:active` |
| 事件载荷 | 不涉及 | 不涉及 |
| 已知差异 | 无 | 无 |

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [x] 都不涉及

## 6. 验收标准

1. `examples/hello-fjs/src/pages/index.vue` 的 `.item` 有 `:active` 按压态。
2. `examples/hello-fjs/src/pages/example.vue` 的 `.item` 有 `:active` 按压态。
3. `pnpm --filter hello-fjs run typecheck` 通过。

## 7. 待澄清

- [x] 无
