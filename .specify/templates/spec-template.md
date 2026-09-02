# Spec: <标题>

- **ID**: NNN-slug
- **状态**: draft | ready | in-progress | done
- **日期**: YYYY-MM-DD

## 1. 要解决什么

用户/开发者现在遇到的具体问题。写现象，不写方案。

## 2. 不做什么（Non-goals）

明确划到范围外的东西。这一节比第 1 节更能防止范围膨胀。

## 3. 用户可见的行为

改完之后，页面代码怎么写、跑起来是什么样。给最小可运行片段：

```vue
<!-- 期望能这样写 -->
```

## 4. 两端约定（宪法 I）

| | Flutter | Web |
|---|---|---|
| 行为 | | |
| 事件载荷 | | |
| 已知差异 | | |

做不到两端一致的地方写在这里，并说明为什么。

## 5. 契约变更（宪法 II）

- [ ] UI op 协议（`ops.ts` + `ui_ops.dart`）
- [ ] natives 表（`native-global.d.ts` + `natives.cpp`）
- [ ] 事件类型（`element.ts` + `fjs.h`）
- [ ] 都不涉及

## 6. 验收标准

可执行、可判定的条目。每条要能对应一条命令或一次操作：

1. `pnpm --filter demo run typecheck` 通过
2. `pnpm test` 通过
3. `<具体页面>` 在 `fjs dev --web` 和 `fjs run android` 上表现一致
4. …

## 7. 待澄清

- [ ] 需要用户拍板的问题（没有就写"无"）
