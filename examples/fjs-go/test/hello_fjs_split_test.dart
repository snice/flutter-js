// Runs the real hello-fjs split build the way fjs go runs it: the shared
// chunk as a prelude, the app entry on top, page chunks fetched on demand —
// and asserts that a `router.push` from JS becomes an actual Flutter route.
//
// Needs the example built (`pnpm --filter hello-fjs build:pages`) and the
// dev dylib (`cmake --build packages/flutter_fjs/native/build-native`);
// skips itself otherwise.
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

Directory? _repoRoot() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    if (Directory('${dir.path}/packages/flutter_fjs').existsSync()) return dir;
    dir = dir.parent;
  }
  return null;
}

String? _skipReason(Directory? root) {
  if (!Platform.isMacOS) return 'requires macOS dylib loading';
  if (root == null) return 'repository root not found';
  final lib = File(
      '${root.path}/packages/flutter_fjs/native/build-native/libfjs.dylib');
  final dist = Directory('${root.path}/examples/hello-fjs/dist');
  final shared = File('${dist.path}/shared.js');
  final bundle = File('${dist.path}/bundle.js');
  if (!lib.existsSync()) {
    return 'missing libfjs.dylib; run cmake --build packages/flutter_fjs/native/build-native';
  }
  if (!shared.existsSync() || !bundle.existsSync()) {
    return 'missing hello-fjs split build; run pnpm --filter hello-fjs build:pages';
  }
  return null;
}

/// esbuild writes non-ASCII as \uXXXX, so editing a built chunk means
/// editing it in that form.
String jsLiteral(String text) => text.runes
    .map((r) => r < 0x80
        ? String.fromCharCode(r)
        : '\\u${r.toRadixString(16).toUpperCase().padLeft(4, '0')}')
    .join();

void main() {
  final root = _repoRoot();
  final skipReason = _skipReason(root);
  if (skipReason != null) {
    test('hello-fjs split prerequisites', () {}, skip: skipReason);
    return;
  }

  final lib = File(
      '${root!.path}/packages/flutter_fjs/native/build-native/libfjs.dylib');
  final dist = Directory('${root.path}/examples/hello-fjs/dist');
  final shared = File('${dist.path}/shared.js');
  final bundle = File('${dist.path}/bundle.js');
  ffi.DynamicLibrary.open(lib.path);

  late FjsEngine engine;
  late Map<String, int> chunkLoads;

  setUp(() {
    engine = FjsEngine();
    chunkLoads = {};
    engine.chunkLoader = (chunk) async {
      chunkLoads[chunk] = (chunkLoads[chunk] ?? 0) + 1;
      final file = File('${dist.path}/pages/$chunk.js');
      return file.existsSync() ? file.readAsBytesSync() : null;
    };
    // exactly what connectDev does for a `fjs dev --pages` server
    engine.addPrelude(shared.readAsBytesSync());
    engine.runSource(bundle.readAsStringSync(), filename: 'bundle.js');
  });

  tearDown(() => engine.dispose());

  /// The JS side flushes UI ops from a microtask and loads chunks through
  /// Dart futures, so a few rounds of "drain JS jobs, then pump Flutter".
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 8; i++) {
      engine.pump();
      await tester.pump(const Duration(milliseconds: 16));
    }
    await tester.pumpAndSettle();
  }

  testWidgets('the shell and the first route mount', (tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await settle(tester);

    expect(find.text('内置组件'), findsWidgets); // nav bar title + tab label
    expect(find.text('视图容器'), findsOneWidget); // the open accordion group
    expect(find.text('<swiper>'), findsOneWidget);
    expect(engine.navStack, isEmpty); // the tab page is the base page
    expect(chunkLoads['index'], 1);
  });

  testWidgets('tapping a row pushes a native route and caches its chunk',
      (tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await settle(tester);

    await tester.tap(find.text('<swiper>'));
    await settle(tester);

    expect(engine.navStack.map((e) => e.path), ['/comp/swiper']);
    expect(engine.navStack.single.chunk, 'comp-swiper');
    // content that only exists in the page chunk
    expect(find.text('轮播第 1 屏'), findsWidgets);
    // a pushed page is not a tab page: back button, no tab bar
    expect(find.text('轮播'), findsWidgets);

    final navigator = tester.state<NavigatorState>(find.byType(Navigator).last);
    navigator.pop();
    await settle(tester);

    expect(engine.navStack, isEmpty);
    expect(find.text('轮播第 1 屏'), findsNothing);
    expect(find.text('视图容器'), findsOneWidget);

    await tester.tap(find.text('<swiper>'));
    await settle(tester);

    expect(engine.navStack.map((e) => e.path), ['/comp/swiper']);
    expect(find.text('轮播第 1 屏'), findsWidgets);
    expect(chunkLoads['comp-swiper'], 1);
  });

  testWidgets('a rebuilt page chunk swaps in without restarting the app',
      (tester) async {
    // What `fjs dev` does when an edit only touched one page: the host
    // evaluates the new chunk and fires devPageReload, and the router
    // remounts just that page — the route stays, the rest of the app is
    // untouched.
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await settle(tester);
    await tester.tap(find.text('<swiper>'));
    await settle(tester);
    expect(find.text('轮播第 1 屏'), findsWidgets);

    final chunk = File('${dist.path}/pages/comp-swiper.js');
    final edited = chunk
        .readAsStringSync()
        .replaceAll(jsLiteral('轮播第 1 屏'), jsLiteral('改过的第 1 屏'));
    expect(edited, isNot(chunk.readAsStringSync()), reason: 'nothing to swap');
    engine.runSource(edited, filename: 'comp-swiper.js');
    engine.dispatchEvent(0, FjsEvent.devPageReload, text: 'comp-swiper');
    await settle(tester);

    expect(find.text('改过的第 1 屏'), findsWidgets);
    expect(find.text('轮播第 1 屏'), findsNothing);
    // still the pushed route, not back at the tab page
    expect(engine.navStack.map((e) => e.path), ['/comp/swiper']);
    expect(chunkLoads['comp-swiper'], 1, reason: 'the host, not the router, refetches');
  });

  testWidgets('a page chunk that is not on screen leaves the screen alone',
      (tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await settle(tester);
    expect(find.text('<swiper>'), findsOneWidget);

    // the dev server is now serving an edited comp-swiper
    final serve = engine.chunkLoader!;
    engine.chunkLoader = (chunk) async {
      final bytes = await serve(chunk);
      if (chunk != 'comp-swiper' || bytes == null) return bytes;
      return Uint8List.fromList(utf8.encode(utf8
          .decode(bytes)
          .replaceAll(jsLiteral('轮播第 1 屏'), jsLiteral('改过的第 1 屏'))));
    };
    engine.dispatchEvent(0, FjsEvent.devPageReload, text: 'comp-swiper');
    await settle(tester);

    // nothing on screen came from that chunk, so nothing was remounted
    expect(find.text('视图容器'), findsOneWidget);
    expect(engine.navStack, isEmpty);

    // and the edit is there the first time the page is opened
    await tester.tap(find.text('<swiper>'));
    await settle(tester);
    expect(find.text('改过的第 1 屏'), findsWidgets);
  });

  testWidgets('app-only pages are available to fjs go split builds',
      (tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await settle(tester);

    await tester.ensureVisible(find.text('交互反馈'));
    await settle(tester);
    await tester.tap(find.text('交互反馈'));
    await settle(tester);
    await tester.ensureVisible(find.text('<refresh>'));
    await settle(tester);
    await tester.tap(find.text('<refresh>'));
    await settle(tester);

    expect(engine.navStack.map((e) => e.path), ['/comp/refresh']);
    expect(engine.navStack.single.chunk, 'comp-refresh');
    expect(find.text('下拉刷新'), findsWidgets);
    expect(find.textContaining('已刷新 0 次'), findsOneWidget);
    expect(chunkLoads['comp-refresh'], 1);
  });
}
