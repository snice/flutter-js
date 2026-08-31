// End-to-end test of the router wire protocol: JS asks for a native route
// (fjs.nav.push), FjsApp turns that into a Flutter page, and popping the
// page — by the platform's back gesture or by JS — reports back as a
// navPop event. The JS side here is hand-written against the raw op
// protocol so the test exercises the Dart half without pulling in a built
// fjs-runtime bundle.
import 'dart:convert';
import 'dart:async';
import 'dart:ffi' as ffi;
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

/// Tiny op-frame writer + a stand-in for fjs/router's flutter driver.
const _jsProgram = r'''
var buf = [];
function u32(v) { buf.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
function u16(v) { buf.push(v & 255, (v >> 8) & 255); }
function str(s) { for (var i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
function flush() { __fjs.fns.uiOps(new Uint8Array(buf)); buf = []; }

var nextId = 1;
function mountPage(navKey, label) {
  var root = nextId++;
  buf.push(1); u32(root); u16(4); str('view');
  buf.push(3); u32(0); u32(root); u32(0);
  var props = JSON.stringify({ __navKey: navKey });
  buf.push(6); u32(root); u32(props.length); str(props);
  var text = nextId++;
  buf.push(1); u32(text); u16(4); str('text');
  buf.push(5); u32(text); u32(label.length); str(label);
  buf.push(3); u32(root); u32(text); u32(0);
  flush();
  return root;
}
function removeRoot(id) { buf.push(2); u32(id); flush(); }

globalThis.roots = {};
globalThis.events = [];
globalThis.__fjsDispatchEvent = function (id, type, payload) {
  events.push(type + ':' + id);
  if (type === 10) {
    roots[id] = mountPage(id, 'page-' + id);
  } else if (type === 11) {
    if (roots[id]) { removeRoot(roots[id]); delete roots[id]; }
  }
};
globalThis.push = function (key, chunk) {
  __fjs.fns.invokeHost('fjs.nav.push', key, '/p' + key, 'Page ' + key, chunk || '');
};
globalThis.popTop = function () { __fjs.fns.invokeHost('fjs.nav.pop'); };
globalThis.eventLog = function () { return events.join(','); };
roots[0] = mountPage(0, 'home');
''';

const _listProgram = r'''
var buf = [];
function u32(v) { buf.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); }
function u16(v) { buf.push(v & 255, (v >> 8) & 255); }
function str(s) { for (var i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
function props(o) { return JSON.stringify(o); }
function flush() { __fjs.fns.uiOps(new Uint8Array(buf)); buf = []; }
var id = 1;
function create(tag) { var n = id++; buf.push(1); u32(n); u16(tag.length); str(tag); return n; }
function insert(parent, child, index) { buf.push(3); u32(parent); u32(child); u32(index); }
function setText(node, text) { buf.push(5); u32(node); u32(text.length); str(text); }
function setProps(node, value) { var json = props(value); buf.push(6); u32(node); u32(json.length); str(json); }

var root = create('view');
insert(0, root, 0);
setProps(root, { __navKey: 0 });
var list = create('list-view');
setProps(list, { onScroll: true, style: { height: 80 } });
insert(root, list, 0);
for (var i = 0; i < 60; i++) {
  var text = create('text');
  setText(text, 'row-' + i);
  setProps(text, { style: { height: 24 } });
  insert(list, text, i);
}
globalThis.scrollPayloads = [];
globalThis.__fjsDispatchEvent = function (nodeId, eventType, payload) {
  if (eventType === 12) scrollPayloads.push(payload);
};
globalThis.dumpScroll = function () { console.log(scrollPayloads.join(',')); };
flush();
''';

/// The engine resolves symbols out of the process, so the test binary has to
/// dlopen the dev build first. Built by:
///   cmake -B packages/flutter_fjs/native/build-native -S packages/flutter_fjs/native
///   cmake --build packages/flutter_fjs/native/build-native
String? _libPath() {
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File(
      '${dir.path}/packages/flutter_fjs/native/build-native/libfjs.dylib',
    );
    if (candidate.existsSync()) return candidate.path;
    final local = File('${dir.path}/native/build-native/libfjs.dylib');
    if (local.existsSync()) return local.path;
    dir = dir.parent;
  }
  return null;
}

void main() {
  final lib = _libPath();
  if (lib == null || !Platform.isMacOS) {
    // no dev dylib (or not macOS): nothing to load the VM from
    return;
  }
  ffi.DynamicLibrary.open(lib);

  late FjsEngine engine;

  setUp(() {
    engine = FjsEngine();
    engine.runSource(_jsProgram, filename: 'nav-test.js');
  });

  tearDown(() => engine.dispose());

  Future<void> pumpApp(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await tester.pumpAndSettle();
  }

  testWidgets('base page renders, push adds a native route', (tester) async {
    await pumpApp(tester);
    expect(find.text('home'), findsOneWidget);

    engine.runSource('push(1)');
    await tester.pumpAndSettle();

    expect(engine.navStack.map((e) => e.path), ['/p1']);
    expect(find.text('page-1'), findsOneWidget);
  });

  testWidgets('popping the route unmounts the JS page', (tester) async {
    await pumpApp(tester);
    engine.runSource('push(1)');
    await tester.pumpAndSettle();

    engine.runSource('popTop()');
    await tester.pumpAndSettle();

    expect(engine.navStack, isEmpty);
    expect(find.text('page-1'), findsNothing);
    expect(find.text('home'), findsOneWidget);
  });

  testWidgets('the platform back button pops and tells JS', (tester) async {
    await pumpApp(tester);
    engine.runSource('push(1)');
    await tester.pumpAndSettle();

    // what an iOS back-swipe / Android back button ends up doing
    final navigator = tester.state<NavigatorState>(find.byType(Navigator).last);
    navigator.pop();
    await tester.pumpAndSettle();

    expect(engine.navStack, isEmpty);
    expect(find.text('page-1'), findsNothing);
    // JS was told the route is gone (11 = FjsEvent.navPop)
    final events = <String>[];
    engine.onLog = (_, message) => events.add(message);
    engine.runSource('console.log(eventLog())');
    expect(events.single, contains('11:1'));
  });

  testWidgets('a page chunk is fetched once and cached', (tester) async {
    final requested = <String>[];
    engine.chunkLoader = (chunk) async {
      requested.add(chunk);
      return Uint8List.fromList(
        utf8.encode('globalThis.chunks = (globalThis.chunks || 0) + 1;'),
      );
    };
    await pumpApp(tester);

    engine.runSource('push(1, "detail")');
    await tester.pumpAndSettle();
    engine.runSource('popTop()');
    await tester.pumpAndSettle();
    engine.runSource('push(2, "detail")');
    await tester.pumpAndSettle();

    // second push of the same chunk finds it already in the VM
    expect(requested, ['detail']);
    expect(find.text('page-2'), findsOneWidget);
  });

  testWidgets('concurrent pushes share the same chunk load', (tester) async {
    final requested = <String>[];
    final gate = Completer<Uint8List>();
    engine.chunkLoader = (chunk) async {
      requested.add(chunk);
      return gate.future;
    };
    await pumpApp(tester);

    engine.runSource('push(1, "detail"); push(2, "detail");');
    await tester.pump();

    expect(engine.navStack.map((e) => e.path), ['/p1', '/p2']);
    expect(requested, ['detail']);

    gate.complete(
      Uint8List.fromList(
        utf8.encode('globalThis.chunks = (globalThis.chunks || 0) + 1;'),
      ),
    );
    await tester.pumpAndSettle();

    expect(engine.navStack.map((e) => e.path), ['/p1', '/p2']);
    expect(find.text('page-2'), findsOneWidget);
  });

  testWidgets('list-view builds lazily and emits scroll offsets',
      (tester) async {
    engine.dispose();
    engine = FjsEngine();
    engine.runSource(_listProgram, filename: 'list-test.js');

    await tester.pumpWidget(MaterialApp(home: FjsApp(engine: engine)));
    await tester.pumpAndSettle();

    expect(find.text('row-0'), findsOneWidget);
    expect(find.text('row-59'), findsNothing);

    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();

    final logs = <String>[];
    engine.onLog = (_, message) => logs.add(message);
    engine.runSource('dumpScroll()');
    expect(logs.single, isNotEmpty);
  });
}
