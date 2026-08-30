// flutter_jsc — JS/TS runtime for Flutter.
//
// See docs/architecture.md for the layering. Entry points:
//   * FjsEngine         — the JS engine host (runSource / runBundle / dev)
//   * FjsView           — widget that renders the JS UI tree
//   * FjsApp            — Navigator driven by the JS router (native routes)
//   * HostRegistry      — Dart-side host modules callable from JS
library flutter_jsc;

export 'src/bytes.dart' show FjsByteData;
export 'src/engine.dart' show FjsEngine, FjsException, NavEntry;
// event ids for FjsEngine.dispatchEvent (hosts that inject events by hand)
export 'src/ffi.dart' show FjsEvent;
export 'src/fjs_app.dart' show FjsApp;
export 'src/fjs_view.dart' show FjsView;
export 'src/ui_ops.dart' show UiOpCode;
export 'src/registry/host.dart' show HostRegistry, HostResult;
export 'src/registry/component.dart' show ComponentRegistry, ComponentBuilder;
export 'src/worker.dart' show FjsWorker;
