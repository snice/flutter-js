# flutter-js 文档

这组文档按使用路径组织。第一次接入时建议先看工具链，再看 Vue、路由和 Web。

## 从创建到发布

1. [工具链与创建/运行/测试/编译](toolchain.md)
2. [fjs go 调试客户端](fjs-go.md)
3. [Vue 3 集成](vue3.md)
4. [路由](routing.md)
5. [Web 平台](web.md)
6. [分包与 release assets](code-splitting.md)
7. [发布 npm 与 pub.dev](publishing.md)

## 深入实现

- [架构与线程模型](architecture.md)
- [JSI 机制与原生模块指南](jsi-and-native-modules.md)
- [UI API 参考](ui-api.md)（默认外观参照 [WeUI](https://wechat.design/tool/weui-mobile#weui%E7%BB%84%E4%BB%B6%E5%88%97%E8%A1%A8)）
- [性能测试](performance.md)
- [Roadmap](roadmap.md)

## 主流程命令

创建新项目（仓库内开发时工作区已 link 好，`pnpm exec fjs` 即可）：

```bash
pnpm exec fjs create my-app
cd my-app
pnpm install
pnpm run dev:pages

安装 fjs go 后扫码或选择附近服务器连接。
pnpm run dev:web
pnpm run run:android
pnpm run run:ios
pnpm run typecheck
pnpm run build:release
pnpm run build:apk
```

`build:release` 会把 `.fjsbundle` 同步到 `.fjs/flutter/assets/fjs`；`build:apk`
会在同步完成后继续执行 `flutter build apk`。

仓库内置 `demo` 已使用 workspace 依赖，可直接用于当前源码的回归验证：

```bash
pnpm --filter demo run typecheck
pnpm --filter demo run build:release
pnpm --filter demo run build:apk -- --debug
```
