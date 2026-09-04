# Tasks: Flutter 宿主应用配置

对应 plan：`./plan.md`。按顺序做，做完一条勾一条。

## 契约层（先做，后面都依赖它）

- [x] T001 定义 `app.config.ts` 的 Android/iOS 配置类型和加载入口

## 实现

- [x] T010 在 managed Flutter host 中同步 Android applicationId 和 permissions
- [x] T011 在 managed Flutter host 中同步 iOS bundle identifier 和 Info.plist
- [x] T012 保持 `fjs host eject` 后不覆盖原生工程配置
- [x] T013 为 `fjs create` 的 Vue/TS 模板生成 `app.config.ts`

## 两端对齐

- [x] T020 记录该能力属于 Flutter 原生工程配置，Web 无对应实现
- [x] T021 确认不涉及 UI op、JSI/FFI 或事件契约

## 测试

- [x] T030 添加配置加载和字段校验测试
- [x] T031 添加 Android manifest、iOS plist 幂等 patch 测试

## 文档

- [x] T040 更新 `docs/toolchain.md`
- [x] T041 更新模板 README 的配置说明

## 验收

- [x] T050 `pnpm --filter @ufjs/cli run typecheck`
- [x] T051 `pnpm --filter @ufjs/cli test`
- [x] T052 `pnpm test`
- [x] T053 spec.md 第 6 节逐条核对
