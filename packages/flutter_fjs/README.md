# flutter_fjs

JS/TS runtime for Flutter. Embeds [QuickJS-ng](https://github.com/quickjs-ng/quickjs)
in native code, calls between JS and C++ directly (JSI-style, no method channel),
runs source or precompiled QuickJS bytecode bundles, and renders HTML-like JS
tags as real Flutter widgets.

This is the Flutter half of [flutter-js](https://github.com/snice/flutter-js).
The JS half lives on npm as [`@ufjs/cli`](https://www.npmjs.com/package/@ufjs/cli)
(build toolchain) and [`@ufjs/runtime`](https://www.npmjs.com/package/@ufjs/runtime)
(element API, Vue 3 custom renderer).

## Prebuilt natives

The engine ships compiled, so consumer builds need no NDK, no CMake and no
native compile step:

| Platform | Artifact |
| --- | --- |
| Android | `android/src/main/jniLibs/{armeabi-v7a,arm64-v8a,x86_64}/libfjs.so` |
| iOS / macOS | `ios/fjs.xcframework`, `macos/fjs.xcframework` (device, simulator, macOS) |

Minimums: Android API 21, iOS 12.0, macOS 10.14.

## Usage

```yaml
dependencies:
  flutter_fjs: ^0.1.0
```

```dart
import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final engine = FjsEngine();
  await engine.loadAsset('assets/fjs/bundle.js');
  runApp(MaterialApp(home: FjsView(engine: engine)));
}
```

In practice you scaffold the whole thing with the CLI, which generates the
Flutter host for you:

```bash
npx @ufjs/cli create my-app
cd my-app && npm run run:android
```

## Rebuilding the natives

The C++/QuickJS-ng sources are not part of the published package — nothing in a
consumer build compiles them. They live in `native/` in the
[repository](https://github.com/snice/flutter-js), together with the scripts
that regenerate the binaries above:

```bash
cd packages/flutter_fjs
tool/build-android.sh   # needs ANDROID_NDK_HOME
tool/build-apple.sh     # macOS + Xcode
```

## License

MIT. Bundles QuickJS-ng (MIT) — see [NOTICE](NOTICE) and
`native/quickjs/LICENSE`.
