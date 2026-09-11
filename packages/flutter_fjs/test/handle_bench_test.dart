// Spec 038 性能对照：旧通道（base64+JSON 双向）vs 句柄通道，同一批字节。
// 只比通道本身的编码/解码成本，不含网络。dart test/handle_bench_test.dart
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io';
import 'dart:typed_data';

import 'package:ffi/ffi.dart' show malloc;
import 'package:flutter_fjs/src/ffi.dart';
import 'package:flutter_test/flutter_test.dart';

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
    // no dev dylib: nothing to load the VM from (same gate as http_engine_test)
    return;
  }
  ffi.DynamicLibrary.open(lib);
  final bind = FjsBindings.instance();
  final vm = bind.vmCreate();

  int benchOldEncode(Uint8List bytes) {
    final sw = Stopwatch()..start();
    final b64 = base64Encode(bytes);
    final json = jsonEncode({'bodyBase64': b64});
    // JS 侧对称：jsonDecode + base64Decode
    final Map<String, dynamic> back = jsonDecode(json) as Map<String, dynamic>;
    final out = base64Decode(back['bodyBase64'] as String);
    sw.stop();
    if (out.length != bytes.length) throw StateError('len');
    return sw.elapsedMicroseconds;
  }

  test('channel benchmark', () {
    addTearDown(() => bind.vmDestroy(vm));
    for (final kb in [1024, 5120]) {
      final bytes = Uint8List(kb * 1024);
      for (var i = 0; i < bytes.length; i++) {
        bytes[i] = i % 256;
      }
      // warmup
      benchOldEncode(bytes);
      var oldUs = 0;
      for (var i = 0; i < 5; i++) {
        oldUs += benchOldEncode(bytes);
      }
      oldUs ~/= 5;

      var newUs = 0;
      for (var i = 0; i < 5; i++) {
        final sw = Stopwatch()..start();
        final p = malloc<ffi.Uint8>(bytes.length);
        p.asTypedList(bytes.length).setAll(0, bytes);
        final id = bind.putHandleBytes(vm, p, bytes.length);
        malloc.free(p);
        final out = bind.readHandleBytes(vm, id);
        bind.releaseHandle(vm, id);
        sw.stop();
        if (out!.length != bytes.length) throw StateError('len2');
        newUs += sw.elapsedMicroseconds;
      }
      newUs ~/= 5;
      // ignore: avoid_print
      print('BENCH ${kb}KB old(base64+json)=$oldUsµs new(handle)=$newUsµs');
    }
  });
}
