// The JS engine host: owns the native VM, wires callbacks, drives the
// event loop, applies UI frames to the mirror tree and exposes hot reload.
import 'dart:async';
import 'dart:convert';
import 'dart:ffi' as ffi;

import 'package:ffi/ffi.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import 'dev_client.dart';
import 'ffi.dart';
import 'http.dart';
import 'mirror_tree.dart';
import 'registry/component.dart';
import 'registry/host.dart';
import 'worker.dart';
import 'bytes.dart';

/// One native route the JS router asked for.
class NavEntry {
  const NavEntry({
    required this.key,
    required this.path,
    required this.title,
    required this.chunk,
  });

  /// Route key allocated by the JS router; also the id the mount/pop events
  /// are addressed to.
  final int key;
  final String path;
  final String title;

  /// Page chunk to evaluate before the page can mount ('' when the page is
  /// already in the bundle).
  final String chunk;
}

class FjsException implements Exception {
  FjsException(this.message);
  final String message;
  @override
  String toString() => 'FjsException: $message';
}

/// One [FjsEngine] instance == one QuickJS VM on the UI isolate.
class FjsEngine extends ChangeNotifier {
  FjsEngine() {
    _bind();
    _createVm();
    _setupWorkerModules();
    _setupNavModules();
    _setupAnimationFrameModule();
    _http.register(host);
  }

  /// Backs the runtime's fetch() — see http.dart for the wire protocol.
  late final FjsHttp _http = FjsHttp(dispatchEvent: (id, type, {String? text}) {
    if (_disposed || _vm == null) return;
    dispatchEvent(id, type, text: text);
  });

  final Map<int, FjsWorker> _workers = {};

  /// Internal host modules backing the fjs-runtime `Worker` class.
  /// JS: invokeHost('js.worker.create', code) -> id; post/terminate by id.
  /// Worker->main messages re-enter JS as dispatchEvent(id, 9, text).
  void _setupWorkerModules() {
    host
      ..register('js.worker.create', (args) {
        final id = FjsWorker.nextId;
        final code = args.isNotEmpty ? args.first.toString() : '';
        final worker = FjsWorker.startWithId(id, code, onMessage: (msg) {
          dispatchEvent(id, FjsEvent.workerMessage, text: msg);
        }, onError: (err) {
          onLog?.call(3, '[worker] $err');
        });
        _workers[id] = worker;
        return id;
      })
      ..register('js.worker.post', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        final msg = args.length > 1 ? args[1]?.toString() ?? '' : '';
        _workers[id]?.postMessage(msg);
        return null;
      })
      ..register('js.worker.terminate', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        _workers.remove(id)?.terminate();
        return null;
      });
  }

  final FjsBindings bind = FjsBindings.instance();
  final MirrorTree tree = MirrorTree();
  final HostRegistry host = HostRegistry();
  final ComponentRegistry components = ComponentRegistry();

  FJSVMHandle? _vm;
  ffi.Pointer<ffi.NativeFunction<OnLogC>>? _onLogPtr;
  ffi.Pointer<ffi.NativeFunction<OnUiOpsC>>? _onUiOpsPtr;
  ffi.Pointer<ffi.NativeFunction<InvokeHostC>>? _invokeHostPtr;
  ffi.Pointer<ffi.NativeFunction<OnToastC>>? _onToastPtr;
  Timer? _pumpTimer;
  DevClient? _dev;
  bool _disposed = false;
  bool _uiNotifyQueued = false;
  int _vmGeneration = 0;

  /// Console output from JS (log/info/warn/error), for host surfacing.
  void Function(int level, String message)? onLog;

  /// JS `__fjs.toast(msg)` lands here. FjsView installs a default overlay
  /// handler; replace to customize routing.
  void Function(String message)? onToast;

  void _createVm() {
    HostBridge.install(host);
    // callback trampolines are created once; reset() only recycles the VM
    _onLogPtr ??= ffi.Pointer.fromFunction(_onLogTrampoline);
    _onUiOpsPtr ??= ffi.Pointer.fromFunction(_onUiOpsTrampoline);
    _invokeHostPtr ??= HostBridge(host).pointer;
    _onToastPtr ??= ffi.Pointer.fromFunction(_onToastTrampoline);
    final vm = bind.vmCreate();
    if (vm == ffi.nullptr) {
      throw FjsException('failed to create fjs VM');
    }
    _vm = vm;
    _vmGeneration++;
    bind.setCallbacks(vm, _onLogPtr!, _onUiOpsPtr!, _invokeHostPtr!);
    bind.setToast(vm, _onToastPtr!);
  }

  /// Destroys the current VM and clears the mirror tree (hot reload path).
  /// Registered [preludes] are re-evaluated into the fresh VM.
  void reset() {
    _http.cancelAll();
    final vm = _vm;
    if (vm != null) bind.vmDestroy(vm);
    _vm = null;
    _frameLog.clear();
    _navStack.clear();
    // a fresh VM has no chunks in it, whatever the previous one evaluated
    _loadedChunks.clear();
    _loadingChunks.clear();
    tree.clear();
    _createVm();
    _runPreludes();
    _scheduleUiNotify();
  }

  // ---- navigation ---------------------------------------------------------
  //
  // The JS router (fjs/router) asks for a native route instead of drawing
  // its own page stack, so the platform's back gesture and page transition
  // apply to real Flutter routes. Wire protocol, JS -> here:
  //
  //   fjs.nav.push(key, path, title, chunk)     new route on top
  //   fjs.nav.replace(key, path, title, chunk)  swap the top route
  //   fjs.nav.load(key, path, chunk)            no route: just load a chunk
  //   fjs.nav.pop()                             pop the top route
  //
  // and back the other way as dispatchEvent(key, FjsEvent.navMount / navPop)
  // once the page's chunk is in the VM / once its route is gone. [FjsApp]
  // turns [navStack] into Navigator pages and reports removals here.

  final List<NavEntry> _navStack = [];
  final Set<String> _loadedChunks = {};
  final Map<String, Future<void>> _loadingChunks = {};

  /// Routes the JS router asked for, bottom first. The base page (key 0) is
  /// not in here — it is the host's own first page.
  List<NavEntry> get navStack => List.unmodifiable(_navStack);

  /// Loads the page chunk named [chunk] (`fjs build --pages` emits one per
  /// route). Hosts wire this to assets or to the dev server; returning null
  /// means "no such chunk", which is reported to JS as a mount with no page.
  Future<Uint8List?> Function(String chunk)? chunkLoader;

  void _setupNavModules() {
    host
      ..register('fjs.nav.push', (args) {
        _pushRoute(_navArgs(args), replaceTop: false);
        return null;
      })
      ..register('fjs.nav.replace', (args) {
        _pushRoute(_navArgs(args), replaceTop: true);
        return null;
      })
      ..register('fjs.nav.load', (args) {
        // key, path, chunk — the base page, which has no Navigator route
        final key = args.isNotEmpty ? (args.first as num).toInt() : 0;
        final chunk = args.length > 2 ? args[2]?.toString() ?? '' : '';
        unawaited(_mountWhenReady(key, chunk));
        return null;
      })
      ..register('fjs.nav.pop', (args) {
        if (_navStack.isEmpty) return false;
        _navStack.removeLast();
        notifyListeners();
        return true;
      });
  }

  void _setupAnimationFrameModule() {
    host.register('js.raf.request', (args) {
      final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
      if (id < 0) return null;
      final generation = _vmGeneration;
      SchedulerBinding.instance.scheduleFrameCallback((stamp) {
        if (_disposed || _vm == null || generation != _vmGeneration) return;
        final ms = stamp.inMicroseconds / 1000;
        dispatchEvent(id, FjsEvent.animationFrame, text: '$ms');
      });
      SchedulerBinding.instance.ensureVisualUpdate();
      return null;
    });
  }

  static NavEntry _navArgs(List<Object?> args) => NavEntry(
        key: args.isNotEmpty ? (args.first as num).toInt() : 0,
        path: args.length > 1 ? args[1]?.toString() ?? '' : '',
        title: args.length > 2 ? args[2]?.toString() ?? '' : '',
        chunk: args.length > 3 ? args[3]?.toString() ?? '' : '',
      );

  void _pushRoute(NavEntry entry, {required bool replaceTop}) {
    if (replaceTop && _navStack.isNotEmpty) _navStack.removeLast();
    _navStack.add(entry);
    // Paint the route (and its transition) now; the page's content follows
    // as soon as its chunk is in the VM.
    notifyListeners();
    unawaited(_mountPushedRoute(entry.key, entry.chunk));
  }

  Future<void> _mountPushedRoute(int key, String chunk) async {
    // Let Navigator paint/start its platform transition before JS mounts the
    // page. If the chunk is already cached, mounting synchronously here would
    // block the route switch on the UI isolate.
    await SchedulerBinding.instance.endOfFrame;
    if (_disposed || _vm == null) return;
    await _mountWhenReady(key, chunk);
  }

  Future<void> _mountWhenReady(int key, String chunk) async {
    final started = DateTime.now();
    try {
      await _ensureChunk(chunk);
    } catch (e) {
      onLog?.call(3, '[nav] loading chunk "$chunk" failed: $e');
    }
    if (_disposed || _vm == null) return;
    dispatchEvent(key, FjsEvent.navMount);
    final ms = DateTime.now().difference(started).inMilliseconds;
    onLog?.call(
      1,
      '[nav] mounted key=$key chunk=${chunk.isEmpty ? '(inline)' : chunk} in ${ms}ms',
    );
  }

  Future<void> _ensureChunk(String chunk) {
    if (chunk.isEmpty || _loadedChunks.contains(chunk))
      return Future<void>.value();
    return _loadingChunks[chunk] ??= _loadChunk(chunk).whenComplete(() {
      _loadingChunks.remove(chunk);
    });
  }

  Future<void> _loadChunk(String chunk) async {
    final loader = chunkLoader;
    if (loader == null) {
      throw FjsException('no chunkLoader: cannot load page chunk "$chunk"');
    }
    final started = DateTime.now();
    final bytes = await loader(chunk);
    if (bytes == null) throw FjsException('page chunk "$chunk" not found');
    if (_disposed || _vm == null) return;
    final fetchedAt = DateTime.now();
    _eval(bytes);
    _loadedChunks.add(chunk);
    final evaluatedAt = DateTime.now();
    onLog?.call(
      1,
      '[nav] chunk $chunk ${bytes.length} bytes: fetch ${fetchedAt.difference(started).inMilliseconds}ms, eval ${evaluatedAt.difference(fetchedAt).inMilliseconds}ms',
    );
  }

  /// Called by [FjsApp] when the Navigator drops a route — a back gesture,
  /// the system back button, or a pop this engine asked for. Tells JS to
  /// unmount that page.
  void onRouteRemoved(int key) {
    final index = _navStack.indexWhere((e) => e.key == key);
    if (index >= 0) _navStack.removeAt(index);
    // The Navigator reports removals from inside its own build, and telling
    // JS re-enters the VM, which emits a UI frame and notifies listeners —
    // that would be a setState during build. A microtask runs after the
    // frame, which is soon enough for an already-removed route.
    scheduleMicrotask(() {
      if (_disposed || _vm == null) return;
      dispatchEvent(key, FjsEvent.navPop);
      notifyListeners();
    });
  }

  // ---- code splitting (preludes) -----------------------------------------

  final List<Uint8List> _preludes = [];

  /// Shared chunks every app program depends on, in evaluation order.
  List<Uint8List> get preludes => List.unmodifiable(_preludes);

  /// Registers a split-off chunk that app bundles need in scope before they
  /// run — e.g. the shared vue/fjs runtime built with
  /// A shared prelude from `fjs build --pages`, which installs
  /// `globalThis.__FJS_SHARED` before the app/page chunks run.
  ///
  /// The chunk is evaluated into the current VM immediately and re-evaluated
  /// into every VM [reset] creates, so hosts register it once (at startup, to
  /// take the asset read off the switch path) instead of re-sequencing
  /// `runBundle(shared)` before each `runBundle(app)`. Order of registration
  /// is the order of evaluation.
  ///
  /// A prelude lives in the VM alongside whatever app runs next, so keep it
  /// to code that only defines globals: no UI, no timers, no mount.
  void addPrelude(Uint8List bundle) {
    _preludes.add(bundle);
    if (_vm != null) _eval(bundle);
  }

  /// Drops all registered preludes. Takes effect in the next VM ([reset]);
  /// the running VM keeps what it already evaluated.
  void clearPreludes() {
    _preludes.clear();
  }

  void _runPreludes() {
    for (final chunk in _preludes) {
      _eval(chunk);
    }
  }

  /// Runs a chunk in either wire format (bytecode bundle or utf8 source).
  void _eval(Uint8List chunk) {
    final bytes = fjsMaybeGunzip(chunk);
    if (_looksLikeFjsBundle(bytes)) {
      runBundle(bytes);
    } else {
      runSource(utf8.decode(bytes), filename: 'prelude.js');
    }
  }

  // ---- program loading ---------------------------------------------------

  /// Runs utf8 JS source (dev bundles / embedded strings).
  void runSource(String source, {String filename = 'main.js'}) {
    final vm = _requireVm();
    final code = Uint8List.fromList(utf8.encode(source));
    final codePtr = malloc<ffi.Uint8>(code.length);
    codePtr.asTypedList(code.length).setAll(0, code);
    final namePtr = toCString(filename);
    try {
      final rc = bind.evalSource(vm, codePtr, code.length, namePtr);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      malloc.free(codePtr);
      malloc.free(namePtr);
    }
    _scheduleUiNotify();
  }

  /// Runs a .fjsbundle (production artifact: header + QuickJS bytecode).
  /// Bytecode is version-locked to the embedded engine; mismatches throw.
  void runBundle(Uint8List bytes) {
    final vm = _requireVm();
    final data = fjsMaybeGunzip(bytes);
    final dataPtr = malloc<ffi.Uint8>(data.length);
    dataPtr.asTypedList(data.length).setAll(0, data);
    try {
      final rc = bind.evalBundle(vm, dataPtr, data.length);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      malloc.free(dataPtr);
    }
    notifyListeners();
  }

  // ---- event loop --------------------------------------------------------

  /// Drives JS timers + promise jobs. Called automatically on a frame-ish
  /// cadence once [startEventLoop] is on.
  void pump() {
    final vm = _vm;
    if (vm == null) return;
    bind.pump(vm, bind.now(vm));
  }

  /// Starts the periodic pump (16ms ≈ one frame).
  void startEventLoop() {
    _pumpTimer ??= Timer.periodic(const Duration(milliseconds: 16), (_) {
      if (!_disposed) pump();
    });
  }

  void stopEventLoop() {
    _pumpTimer?.cancel();
    _pumpTimer = null;
  }

  /// Sends a UI event to the JS runtime (called by the widget layer).
  void dispatchEvent(int nodeId, int eventType, {String? text}) {
    final vm = _requireVm();
    ffi.Pointer<ffi.Uint8> textPtr = ffi.nullptr;
    var textLen = 0;
    if (text != null) {
      final units = utf8.encode(text);
      textPtr = malloc<ffi.Uint8>(units.length);
      textPtr.asTypedList(units.length).setAll(0, units);
      textLen = units.length;
    }
    try {
      final rc = bind.dispatchEvent(vm, nodeId, eventType, textPtr, textLen);
      if (rc != 0) throw FjsException(_lastError());
    } finally {
      if (textPtr != ffi.nullptr) malloc.free(textPtr);
    }
    _scheduleUiNotify();
  }

  // ---- dev server --------------------------------------------------------

  /// Connects to `fjs dev` (HTTP + WebSocket). Every reload disposes the
  /// VM, rebuilds and re-evaluates the newest bundle.
  ///
  /// A `fjs dev --pages` server serves a split build: the shared prelude
  /// (vue + fjs + the app shell) plus one chunk per route. That is picked
  /// up from the manifest — the prelude is registered as a prelude, and
  /// page chunks are fetched on demand as the router asks for them, so a
  /// route change never re-downloads the runtime.
  Future<void> connectDev(String host, int port) async {
    stopEventLoop();
    _dev?.close();
    final dev = DevClient(
      host,
      port,
      onLog: (m) => onLog?.call(1, '[dev] $m'),
    );
    _dev = dev;
    await Future<void>.delayed(Duration.zero); // allow UI to paint "connecting"
    final manifest = await dev.fetchManifest();
    final split = manifest?['split'] == true;
    if (split) {
      chunkLoader = (chunk) => dev.fetch('/pages/$chunk.js');
    }
    await _loadFromDev(dev, split);
    dev.onReload = (pages) async {
      try {
        // an edit confined to page chunks never needs the VM restarted
        if (pages != null && await _hotSwapPages(dev, pages)) return;
        await _loadFromDev(dev, split);
        if (split) unawaited(_preloadDevChunks(manifest));
      } catch (e) {
        onLog?.call(3, '[dev] reload failed: $e');
      }
    };
    dev.onEval = (id, source) {
      try {
        runSource(source, filename: 'fjs-eval.js');
      } catch (e) {
        // a syntax error never reaches the wrapper's own catch, so the
        // answer has to be sent from here or `fjs eval` just times out
        dev.sendLog(3, '\u0000fjs-eval:$id:err:$e');
      }
    };
    await dev.listen();
    startEventLoop();
    if (split) unawaited(_preloadDevChunks(manifest));
    notifyListeners();
  }

  Future<void> _preloadDevChunks(Map<String, Object?>? manifest) async {
    final rawRoutes = manifest?['routes'];
    if (rawRoutes is! List) return;
    final chunks = <String>{
      for (final route in rawRoutes)
        if (route is Map && route['chunk'] is String) route['chunk'] as String,
    }
        .where((chunk) => chunk.isNotEmpty && !_loadedChunks.contains(chunk))
        .toList();
    if (chunks.isEmpty) return;
    await Future<void>.delayed(const Duration(milliseconds: 250));
    onLog?.call(1, '[dev] preloading ${chunks.length} page chunks');
    var loaded = 0;
    for (final chunk in chunks) {
      if (_disposed || _vm == null || _dev == null) return;
      if (_loadedChunks.contains(chunk)) continue;
      try {
        await _ensureChunk(chunk);
        loaded++;
      } catch (e) {
        onLog?.call(2, '[dev] preload $chunk failed: $e');
      }
      await Future<void>.delayed(const Duration(milliseconds: 16));
    }
    onLog?.call(1, '[dev] preloaded $loaded page chunks');
  }

  /// Applies an edit that only touched page chunks, without restarting the
  /// VM: re-evaluate each changed chunk and let the JS router remount the
  /// pages that came from it. Everything else — the other pages on the
  /// stack, their state, the shell — stays as it is, which is the whole
  /// point: editing one page should refresh that page.
  ///
  /// A chunk this VM never loaded is left alone; it is not in the registry,
  /// so the next time that page is opened it is fetched fresh anyway.
  ///
  /// Returns false when the swap is not possible (not a split build, or a
  /// fetch failed), and the caller falls back to a full reload.
  Future<bool> _hotSwapPages(DevClient dev, List<String> chunks) async {
    if (chunkLoader == null || _vm == null) return false;
    final swapped = <String>[];
    try {
      for (final chunk in chunks) {
        if (!_loadedChunks.contains(chunk)) continue;
        final bytes = await dev.fetch('/pages/$chunk.js');
        if (_disposed || _vm == null) return true;
        _eval(bytes);
        swapped.add(chunk);
      }
    } catch (e) {
      onLog?.call(2, '[dev] page swap failed ($e) — reloading everything');
      return false;
    }
    for (final chunk in swapped) {
      dispatchEvent(0, FjsEvent.devPageReload, text: chunk);
    }
    onLog?.call(
      1,
      swapped.isEmpty
          ? '[dev] ${chunks.join(', ')} changed, not loaded here — nothing to reload'
          : '[dev] reloaded page ${swapped.join(', ')}',
    );
    notifyListeners();
    return true;
  }

  /// One dev load: fresh VM, then the shared prelude (split builds only),
  /// then the app bundle. Fetched before [reset] so a failed fetch leaves
  /// the previous screen up instead of blanking it.
  Future<void> _loadFromDev(DevClient dev, bool split) async {
    final shared = split ? await dev.fetch('/shared.js') : null;
    final bundle = await dev.fetchBundle();
    if (shared != null) {
      // the shell lives in the prelude, so a reload has to replace it too
      clearPreludes();
      reset();
      addPrelude(shared);
    } else {
      reset();
    }
    _runProgram(bundle);
    onLog?.call(1, '[dev] bundle loaded (${bundle.length} bytes)');
  }

  /// True while a `fjs dev` connection is live.
  bool get isDevConnected => _dev != null;

  /// Re-fetches the bundle from the connected dev server and applies it —
  /// the manual twin of the WebSocket reload push (dev-menu "reload").
  Future<void> reloadDev() async {
    final dev = _dev;
    if (dev == null) throw FjsException('not connected to a dev server');
    await _loadFromDev(dev, chunkLoader != null);
  }

  /// Closes the dev connection and stops the event loop. The mirror tree
  /// keeps its last frame; call [reset] to clear the screen too.
  void disconnectDev() {
    _dev?.close();
    _dev = null;
    stopEventLoop();
    notifyListeners();
  }

  void _runProgram(Uint8List bundle) {
    final bytes = fjsMaybeGunzip(bundle);
    if (_looksLikeFjsBundle(bytes)) {
      runBundle(bytes);
    } else {
      runSource(utf8.decode(bytes), filename: 'dev-bundle.js');
    }
  }

  static bool _looksLikeFjsBundle(Uint8List b) =>
      b.length > 8 &&
      b[0] == 0x46 &&
      b[1] == 0x4A &&
      b[2] == 0x53 &&
      b[3] == 0x42;

  // ---- native trampolines -------------------------------------------------

  static void _onLogTrampoline(int level, ffi.Pointer<ffi.Uint8> msg, int len) {
    final engine = _current;
    if (engine == null) return;
    final message = utf8.decode(msg.asTypedList(len), allowMalformed: true);
    engine._log(level, message);
  }

  /// Every console line the VM produces goes here: to the host app through
  /// [onLog], and — while `fjs dev` is connected — up the dev socket, which
  /// is what `fjs log` and `fjs eval` read.
  void _log(int level, String message) {
    onLog?.call(level, message);
    _dev?.sendLog(level, message);
  }

  static void _onToastTrampoline(ffi.Pointer<ffi.Uint8> msg, int len) {
    final engine = _current;
    if (engine == null) return;
    final message = utf8.decode(msg.asTypedList(len), allowMalformed: true);
    engine.onToast?.call(message);
  }

  static void _onUiOpsTrampoline(ffi.Pointer<ffi.Uint8> ops, int len) {
    final engine = _current;
    if (engine == null) return;
    final frame = Uint8List.fromList(ops.asTypedList(len));
    try {
      engine.tree.applyFrame(frame);
    } catch (e) {
      // a malformed frame must not break the JS callback chain
      debugPrint('[fjs] frame apply failed: $e');
      return;
    }
    if (engine.recordFrames) engine._frameLog.add(frame);
    // A single JS event can drain several microtask UI frames. Coalesce them
    // into one Flutter rebuild after the native dispatch returns.
    engine._scheduleUiNotify();
  }

  void _scheduleUiNotify() {
    if (_uiNotifyQueued || _disposed) return;
    _uiNotifyQueued = true;
    scheduleMicrotask(() {
      _uiNotifyQueued = false;
      if (!_disposed) notifyListeners();
    });
  }

  // ---- frame recording (UI snapshot restore) -------------------------------

  /// While true, every applied UI op frame is kept in [takeFrameLog]'s log.
  /// Hosts snapshot a session's frames and replay them into a fresh tree to
  /// restore the last UI instantly (direct-render) while the VM cold-boots.
  bool recordFrames = false;

  final List<Uint8List> _frameLog = [];

  /// Returns and clears the recorded frames since recording started.
  List<Uint8List> takeFrameLog() {
    final log = List<Uint8List>.of(_frameLog);
    _frameLog.clear();
    return log;
  }

  /// Direct-render path: synchronously replays pre-recorded op frames (from
  /// [takeFrameLog]) into the mirror tree and notifies listeners. Hosts call
  /// this right after [reset] so the previous screen paints instantly while
  /// the new VM boots behind it.
  void replayFrames(List<Uint8List> frames) {
    for (final frame in frames) {
      tree.applyFrame(frame);
    }
    notifyListeners();
  }

  // ---- internals -----------------------------------------------------------

  static FjsEngine? _current;

  void _bind() {
    _current = this;
  }

  FJSVMHandle _requireVm() {
    final vm = _vm;
    if (vm == null) throw FjsException('VM is not running');
    return vm;
  }

  String _lastError() {
    final vm = _vm;
    if (vm == null) return 'unknown error';
    final p = bind.lastError(vm);
    return p == ffi.nullptr ? 'unknown error' : cString(p);
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    stopEventLoop();
    _http.close();
    _dev?.close();
    final vm = _vm;
    if (vm != null) bind.vmDestroy(vm);
    _vm = null;
    super.dispose();
  }
}
