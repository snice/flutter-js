## 0.1.0

- First release.
- QuickJS-ng embedded via Dart FFI, JSI-style direct JS↔C++ calls.
- Source bundles and precompiled QuickJS bytecode bundles.
- HTML-like JS tags rendered as Flutter widgets; Vue 3 custom renderer support
  through the `@ufjs/runtime` npm package.
- Ships prebuilt natives: `libfjs.so` for `armeabi-v7a`, `arm64-v8a`, `x86_64`,
  and `fjs.xcframework` for iOS device, iOS simulator, and macOS — no NDK,
  CMake, or native compile step in consumer builds.
