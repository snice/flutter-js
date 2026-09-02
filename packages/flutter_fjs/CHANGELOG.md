## Unreleased

- `MirrorNode` is exported from `package:flutter_fjs/flutter_fjs.dart`. Writing a
  `ComponentBuilder` — the Flutter widget behind a JS tag — means reading the
  node it is handed, so the type is now part of the public surface. This is what
  an fjs module's widget extension is built on.
- `FjsEngine.devUri` / `devFetch(path)` expose the connected `fjs dev` server,
  and `fetch(url)` / `fetchString(url)` make one-off requests over the same
  HttpClient that backs JS `fetch()`. A module that ships a build-time file (an
  icon set, a language pack) can now read it from the dev server in dev and from
  its asset in release without an `FJS_DEV` dart-define or an HttpClient of its
  own. One engine now means one `HttpClient`: the dev-server connection shares
  it too, instead of opening a second one to the same host.

## 0.1.1

- Android natives are now 16 KB page aligned, as required by Android 15+ devices
  with 16 KB memory pages. `tool/build-android.sh` refuses NDKs older than r28,
  which is where that alignment became the default.

## 0.1.0

- First release.
- QuickJS-ng embedded via Dart FFI, JSI-style direct JS↔C++ calls.
- Source bundles and precompiled QuickJS bytecode bundles.
- HTML-like JS tags rendered as Flutter widgets; Vue 3 custom renderer support
  through the `@ufjs/runtime` npm package.
- Ships prebuilt natives: `libfjs.so` for `armeabi-v7a`, `arm64-v8a`, `x86_64`,
  and `fjs.xcframework` for iOS device, iOS simulator, and macOS — no NDK,
  CMake, or native compile step in consumer builds.
