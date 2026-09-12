// `/example/async-host` 页面依赖的宿主模块片段。
//
// hello-fjs 的宿主是 managed（`.fjs/flutter/`，git 忽略），`fjs run` 每次
// 都会重新生成 `lib/main.dart`——这个片段要手工贴回 `main()` 里
// `engine.host.register('device', …)` 之后、`runApp` 之前。
// 不贴的话页面照常打开，只是所有按钮走 reject 路径（未注册也是一条演示边）。
//
// 完整通道说明见同目录 spec.md 与 docs/jsi-and-native-modules.md。

  // spec 039 demo module: a fake async key-value store for
  // /example/async-host. The value only exists after a Future, which no
  // sync handler can express — exactly what registerAsync is for. The page
  // calls invokeHostAsync('demo.asyncStore', op, ...); on web the same page
  // exercises the documented rejection path (no native host there).
  final asyncStore = <String, String>{};
  engine.host.registerAsync('demo.asyncStore', (args) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    switch (args[0] as String? ?? '') {
      case 'set':
        asyncStore[args[1] as String] = args[2] as String;
        return true;
      case 'get':
        return asyncStore[args[1] as String];
      case 'keys':
        return asyncStore.keys.toList();
      default:
        throw ArgumentError('unknown op ${args[0]} (use set / get / keys)');
    }
  });
