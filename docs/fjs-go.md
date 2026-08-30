# fjs go

`fjs go` 是 flutter-js 的调试客户端，类似 Expo Go：手机或模拟器上装一次，以后
连接任意 `fjs dev` 项目，不需要每次改 JS/Vue 都重新编译原生 App。

## 推荐流程

1. 创建并启动一个 fjs 项目：

```bash
pnpm exec fjs create my-app
cd my-app
pnpm install
pnpm run dev:pages
```

2. 安装 fjs go。

Android 测试包在新建并发布 GitHub Release 时自动生成。`fjs-go Android APK`
workflow 会把 `fjs-go-debug-arm64.apk` 和 `fjs-go-release-arm64.apk` 上传到该
Release 附件。两个包都是 `arm64-v8a`，并统一使用仓库内的 fjs-go 测试证书签名。

也可以本地构建运行：

```bash
cd examples/fjs-go
flutter run
```

3. 在 fjs go 里连接 dev server。

- 真机：优先扫终端里的二维码，或点“附近的 dev 服务器”
- Android 模拟器：`10.0.2.2:38900`
- iOS 模拟器 / macOS：`127.0.0.1:38900`
- 真机手输：电脑和手机在同一局域网，填 `192.168.x.x:38900`

## GitHub Actions APK

仓库提供 workflow：

```text
.github/workflows/fjs-go-android-apk.yml
```

触发方式：

- 新建并发布 GitHub Release

构建内容：

- `flutter pub get`
- `flutter analyze`
- `flutter test`
- `flutter build apk --debug --target-platform android-arm64`
- `flutter build apk --release --target-platform android-arm64`
- 上传 `fjs-go-debug-arm64.apk` 到当前 GitHub Release
- 上传 `fjs-go-release-arm64.apk` 到当前 GitHub Release

这是测试包，适合内部安装和调试 `fjs dev`。

## 连接方式

fjs go 支持三种入口：

- **扫一扫**：扫 `fjs dev` 输出的二维码
- **附近的 dev 服务器**：读取局域网 UDP 发现结果
- **手输地址**：直接输入 `host:port` 或完整 URL

地址栏也接受：

```text
http://192.168.1.20:38900/bundle.js
```

## 注意事项

- iOS 第一次连接局域网会弹“本地网络”权限；拒绝后需要到系统设置里重新打开
- 广播发现受网络环境影响，跨网段、访客网络、AP 隔离都可能发现不到
- 工程如果依赖自定义 Dart host module，需要在 fjs go 里补对应注册逻辑

## 相关

- [工具链](toolchain.md)
- [路由](routing.md)
- [分包与 release assets](code-splitting.md)
