// dart:ffi bindings for the fjs native core (native/include/fjs.h).
//
// The VM runs on the UI isolate thread; all callbacks are synchronous
// NativeCallable.isolateLocal (see docs/architecture.md — threading v1).
import 'dart:convert';
import 'dart:ffi' as ffi;
import 'dart:io' show Platform;

import 'package:ffi/ffi.dart';

/// FJSValue — mirrors native/include/fjs.h (flat struct, 32 bytes):
/// tag@0 i@4 d@8 s@16 len@24 pad@28.
final class FJSValue extends ffi.Struct {
  @ffi.Int32()
  external int tag;

  @ffi.Int32()
  external int i;

  @ffi.Double()
  external double d;

  external ffi.Pointer<ffi.Uint8> s;

  @ffi.Int32()
  external int len;

  @ffi.Int32()
  external int pad;
}

const int fjsTNull = 0;
const int fjsTBool = 1;
const int fjsTInt32 = 2;
const int fjsTFloat64 = 3;
const int fjsTString = 4;

typedef FJSVMHandle = ffi.Pointer<ffi.Void>;

typedef _VmCreateC = FJSVMHandle Function();
typedef _VmCreateD = FJSVMHandle Function();

typedef _VmDestroyC = ffi.Void Function(FJSVMHandle);
typedef _VmDestroyD = void Function(FJSVMHandle);

typedef _SetCallbacksC = ffi.Void Function(
    FJSVMHandle,
    ffi.Pointer<ffi.NativeFunction<OnLogC>>,
    ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>,
    ffi.Pointer<ffi.NativeFunction<InvokeHostC>>);
typedef _SetCallbacksD = void Function(
    FJSVMHandle,
    ffi.Pointer<ffi.NativeFunction<OnLogC>>,
    ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>,
    ffi.Pointer<ffi.NativeFunction<InvokeHostC>>);

typedef OnLogC = ffi.Void Function(
    ffi.Int32, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef InvokeHostC = ffi.Int32 Function(ffi.Pointer<ffi.Uint8>, ffi.Int32,
    ffi.Pointer<FJSValue>, ffi.Pointer<FJSValue>);
typedef OnUiOpsC = ffi.Void Function(ffi.Pointer<ffi.Uint8>, ffi.Int32);

typedef OnToastC = ffi.Void Function(ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _SetToastC = ffi.Void Function(
    FJSVMHandle, ffi.Pointer<ffi.NativeFunction<OnToastC>>);
typedef _SetToastD = void Function(
    FJSVMHandle, ffi.Pointer<ffi.NativeFunction<OnToastC>>);

typedef _EvalSourceC = ffi.Int32 Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, ffi.Int32, ffi.Pointer<ffi.Uint8>);
typedef _EvalSourceD = int Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, int, ffi.Pointer<ffi.Uint8>);

typedef _EvalBundleC = ffi.Int32 Function(
    FJSVMHandle, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _EvalBundleD = int Function(FJSVMHandle, ffi.Pointer<ffi.Uint8>, int);

typedef _PumpC = ffi.Int32 Function(FJSVMHandle, ffi.Int64);
typedef _PumpD = int Function(FJSVMHandle, int);

typedef _NowC = ffi.Int64 Function(FJSVMHandle);
typedef _NowD = int Function(FJSVMHandle);

typedef _DispatchEventC = ffi.Int32 Function(
    FJSVMHandle, ffi.Int32, ffi.Int32, ffi.Pointer<ffi.Uint8>, ffi.Int32);
typedef _DispatchEventD = int Function(
    FJSVMHandle, int, int, ffi.Pointer<ffi.Uint8>, int);

typedef _LastErrorC = ffi.Pointer<ffi.Uint8> Function(FJSVMHandle);
typedef _LastErrorD = ffi.Pointer<ffi.Uint8> Function(FJSVMHandle);

typedef _EngineIdC = ffi.Pointer<ffi.Uint8> Function();

/// Native entry points of libfjs, resolved once.
class FjsBindings {
  FjsBindings._(this.lib)
      : vmCreate = lib.lookupFunction<_VmCreateC, _VmCreateD>('fjs_vm_create'),
        vmDestroy =
            lib.lookupFunction<_VmDestroyC, _VmDestroyD>('fjs_vm_destroy'),
        setCallbacks = lib.lookupFunction<_SetCallbacksC, _SetCallbacksD>(
            'fjs_set_callbacks'),
        setToast = lib
            .lookupFunction<_SetToastC, _SetToastD>('fjs_set_toast_callback'),
        evalSource = lib
            .lookupFunction<_EvalSourceC, _EvalSourceD>('fjs_vm_eval_source'),
        evalBundle = lib
            .lookupFunction<_EvalBundleC, _EvalBundleD>('fjs_vm_eval_bundle'),
        pump = lib.lookupFunction<_PumpC, _PumpD>('fjs_vm_pump'),
        now = lib.lookupFunction<_NowC, _NowD>('fjs_vm_now'),
        dispatchEvent = lib.lookupFunction<_DispatchEventC, _DispatchEventD>(
            'fjs_vm_dispatch_event'),
        lastError =
            lib.lookupFunction<_LastErrorC, _LastErrorD>('fjs_last_error'),
        engineId = lib.lookupFunction<_EngineIdC, _EngineIdC>('fjs_engine_id');

  static FjsBindings? _instance;

  /// Android loads the CMake-built shared object; iOS/macOS statically link
  /// the pod into the app binary.
  static FjsBindings instance() {
    final cached = _instance;
    if (cached != null) return cached;
    final ffi.DynamicLibrary lib;
    if (Platform.isAndroid) {
      lib = ffi.DynamicLibrary.open('libfjs.so');
    } else {
      lib = ffi.DynamicLibrary.process();
    }
    _instance = FjsBindings._(lib);
    return _instance!;
  }

  final ffi.DynamicLibrary lib;
  final _VmCreateD vmCreate;
  final _VmDestroyD vmDestroy;
  final _SetCallbacksD setCallbacks;
  final _SetToastD setToast;
  final _EvalSourceD evalSource;
  final _EvalBundleD evalBundle;
  final _PumpD pump;
  final _NowD now;
  final _DispatchEventD dispatchEvent;
  final _LastErrorD lastError;
  final ffi.Pointer<ffi.Uint8> Function() engineId;

  String get engineIdString => cString(engineId());
}

/// Reads a NUL-terminated utf8 C string.
String cString(ffi.Pointer<ffi.Uint8> p, [int? length]) {
  if (p == ffi.nullptr) return '';
  if (length != null) return utf8.decode(p.asTypedList(length));
  // NUL-terminated: find terminator length first
  var n = 0;
  while (p[n] != 0) {
    n++;
  }
  return utf8.decode(p.asTypedList(n));
}

/// Allocates a NUL-terminated utf8 copy of [s].
ffi.Pointer<ffi.Uint8> toCString(String s) {
  final units = utf8.encode(s);
  final p = malloc<ffi.Uint8>(units.length + 1);
  p.asTypedList(units.length + 1)
    ..setRange(0, units.length, units)
    ..[units.length] = 0;
  return p;
}

/// Event types (mirrors fjs.h).
abstract final class FjsEvent {
  static const tap = 1;
  static const longPress = 2;
  static const textChanged = 3;
  static const textSubmitted = 4;
  static const valueChanged = 5; // payload "1"/"0" or numeric string
  static const pageChanged = 6; // payload index string
  static const modalClosed = 7;
  static const refresh = 8;
  static const workerMessage = 9; // nodeId = worker id
  // navigator callbacks (nodeId = the route key the JS router allocated)
  static const navMount = 10; // page chunk is in the VM — mount the page
  static const navPop = 11; // the route is gone — unmount and drop the root
  static const scroll = 12; // payload: scroll offset in logical pixels
  // dev only: one page chunk was rebuilt and re-evaluated — remount the
  // pages it owns (payload: the chunk name)
  static const devPageReload = 13;
}
