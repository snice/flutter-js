// Flutter side of the fjs module "webview": the WebView behind <web-view />.
//
// fjs autolinks this — the generated host depends on this package and calls
// FjsWebview.register(engine) before runApp, because the module's
// package.json says so in its "fjs.flutter" field.
//
// Three decisions worth writing down (specs/013-web-view):
//
//  * `webview_flutter`, not `flutter_inappwebview`. The latter can intercept
//    requests, inject scripts and manage cookies — all of which this spec
//    puts out of scope. The contract here (src, three events) is small
//    enough that swapping the implementation later would not reach pages.
//  * `@error` only reports MAIN-DOCUMENT failures. A page whose tracking
//    pixel 404s has not failed to load, and reporting it would make the
//    event useless. The browser cannot report even that much (docs/web.md).
//  * `asset://` has three resolutions, not two: the dev server while
//    `fjs dev` is connected, a Flutter asset in a release build, and the
//    app's own static root on the web. The rules live once in the module's
//    index.ts; this file mirrors the two that are Dart's.
import 'package:flutter/widgets.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// The module's short name: what `/modules/<name>/…` and the asset path use.
/// Mirrors WEB_VIEW_MODULE in ../../index.ts.
const String fjsWebViewModule = 'webview';

/// Stable failure text — mirrors WEB_VIEW_ERROR in ../../index.ts. The
/// platform's own wording stays in the platform's log: an error string that
/// changes per platform is not a contract.
const String fjsWebViewErrorMessage = 'web-view load failed';

/// `@load` / `@error` / `@message` payloads. Field order is part of the
/// contract (../../index.ts writes the same three).
String fjsWebViewLoadPayload(String src) => '{"src":${_json(src)}}';

String fjsWebViewErrorPayload(String src) =>
    '{"src":${_json(src)},"errMsg":${_json(fjsWebViewErrorMessage)}}';

String fjsWebViewMessagePayload(String data) => '{"data":${_json(data)}}';

String _json(String value) {
  final out = StringBuffer('"');
  for (final rune in value.runes) {
    switch (rune) {
      case 0x22:
        out.write(r'\"');
      case 0x5C:
        out.write(r'\\');
      case 0x0A:
        out.write(r'\n');
      case 0x0D:
        out.write(r'\r');
      case 0x09:
        out.write(r'\t');
      default:
        if (rune < 0x20) {
          out.write('\\u${rune.toRadixString(16).padLeft(4, '0')}');
        } else {
          out.writeCharCode(rune);
        }
    }
  }
  out.write('"');
  return out.toString();
}

enum FjsWebViewSrcKind { empty, http, asset, unsupported }

/// What a `src` is, before anyone tries to load it. Mirrors classifySrc in
/// ../../index.ts.
FjsWebViewSrcKind fjsClassifyWebViewSrc(Object? raw) {
  final src = (raw?.toString() ?? '').trim();
  if (src.isEmpty) return FjsWebViewSrcKind.empty;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return FjsWebViewSrcKind.http;
  }
  if (src.startsWith('asset://')) return FjsWebViewSrcKind.asset;
  return FjsWebViewSrcKind.unsupported;
}

/// The path inside the module's own directory, or null when it escapes it.
String? fjsWebViewAssetPath(String raw) {
  var path = raw.substring('asset://'.length);
  while (path.startsWith('/')) {
    path = path.substring(1);
  }
  if (path.isEmpty || path.contains('..')) return null;
  return path;
}

/// Where a resolved `src` lives. A Flutter asset is a separate shape because
/// it is loaded with `loadFlutterAsset`, not as a URL.
class FjsWebViewTarget {
  const FjsWebViewTarget.url(this.url)
      : asset = null,
        droppedQuery = false;
  const FjsWebViewTarget.asset(this.asset, {this.droppedQuery = false})
      : url = null;
  const FjsWebViewTarget.none()
      : url = null,
        asset = null,
        droppedQuery = false;

  final String? url;
  final String? asset;

  /// The src had a `?…` that a bundled asset cannot carry. Dev loads the
  /// same file over HTTP and keeps it, so this difference has to be said out
  /// loud or it only shows up in a release build.
  final bool droppedQuery;

  bool get isNothing => url == null && asset == null;
}

/// Everything before `?` / `#`. A Flutter asset key is looked up in the
/// bundle manifest, so it cannot carry either — passing one through makes
/// loadFlutterAsset throw FWFURLParsingError.
String fjsWebViewStripQuery(String path) {
  final cut = path.indexOf(RegExp(r'[?#]'));
  return cut < 0 ? path : path.substring(0, cut);
}

/// Mirrors resolveSrc in ../../index.ts for the two app cases: with a dev
/// connection an `asset://` is served by `fjs dev`, otherwise it is a
/// Flutter asset the build copied in.
FjsWebViewTarget fjsResolveWebViewSrc(Object? raw, {Uri? devUri}) {
  final src = (raw?.toString() ?? '').trim();
  switch (fjsClassifyWebViewSrc(src)) {
    case FjsWebViewSrcKind.http:
      return FjsWebViewTarget.url(src);
    case FjsWebViewSrcKind.asset:
      final path = fjsWebViewAssetPath(src);
      if (path == null) return const FjsWebViewTarget.none();
      if (devUri != null) {
        final base = devUri.toString().replaceAll(RegExp(r'/+$'), '');
        return FjsWebViewTarget.url('$base/modules/$fjsWebViewModule/$path');
      }
      final key = fjsWebViewStripQuery(path);
      return FjsWebViewTarget.asset(
        'assets/fjs/modules/$fjsWebViewModule/$key',
        droppedQuery: key.length != path.length,
      );
    case FjsWebViewSrcKind.empty:
    case FjsWebViewSrcKind.unsupported:
      return const FjsWebViewTarget.none();
  }
}

/// One terminal event per load, and never the previous page's — the Dart
/// half of LoadCycle in ../../index.ts.
///
/// It is a class of its own so it can be tested without a WebViewController:
/// building one needs a platform implementation, which a widget test does
/// not have. What a test here cannot prove is that the NavigationDelegate is
/// wired to it; that is what the simulator pass is for.
class FjsWebViewLoadCycle {
  int _generation = 0;
  bool _settled = false;

  int get current => _generation;

  int begin() {
    _generation += 1;
    _settled = false;
    return _generation;
  }

  bool finish(int generation) {
    if (generation != _generation || _settled) return false;
    _settled = true;
    return true;
  }

  bool accepts(int generation) => generation == _generation;
}

/// Whether a web-view can fill the box it was given.
///
/// A web page has no intrinsic height, so an unbounded main axis has no
/// answer — and a guessed one would give every page a number nobody asked
/// for. Pure so the rule can be tested; the caller warns (constitution V).
bool fjsWebViewFitsBox(BoxConstraints constraints) =>
    constraints.hasBoundedHeight;

final Set<String> _warned = <String>{};

/// The core's fjsWarnOnce is not exported, so the module keeps its own —
/// same channel and same prefix, so a page author cannot tell them apart.
void fjsWebViewWarnOnce(String key, String message) {
  if (!_warned.add(key)) return;
  debugPrint('[fjs] $message');
}

@visibleForTesting
void resetFjsWebViewWarnings() => _warned.clear();

class FjsWebview {
  static FjsEngine? _engine;

  /// Registers <web-view /> on the engine. `registry/component.dart` calls
  /// itself the extension point for platform views, and this is one.
  static void register(FjsEngine engine) {
    _engine = engine;
    engine.components.register('web-view', _build);
  }

  static final ComponentBuilder _build = (context, node, children, dispatch) =>
      FjsWebViewWidget(
        key: ValueKey<int>(node.id),
        node: node,
        dispatch: dispatch,
        devUri: _engine?.devUri,
      );
}

class FjsWebViewWidget extends StatefulWidget {
  const FjsWebViewWidget({
    super.key,
    required this.node,
    required this.dispatch,
    this.devUri,
    @visibleForTesting this.controllerOverride,
  });

  final MirrorNode node;
  final void Function(int nodeId, int eventType, {String? text}) dispatch;
  final Uri? devUri;
  final WebViewController? controllerOverride;

  @override
  State<FjsWebViewWidget> createState() => _FjsWebViewWidgetState();
}

class _FjsWebViewWidgetState extends State<FjsWebViewWidget> {
  WebViewController? _controller;

  /// Which load the results arriving now belong to. A `src` change bumps it,
  /// so the previous page's onPageFinished, error and messages are dropped
  /// instead of being reported against the new URL — the same generation
  /// trick widgets/image.dart uses.
  final FjsWebViewLoadCycle _cycle = FjsWebViewLoadCycle();
  String _src = '';
  String _loaded = '';

  @override
  void initState() {
    super.initState();
    _src = widget.node.props['src']?.toString() ?? '';
    _configure();
  }

  @override
  void didUpdateWidget(covariant FjsWebViewWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = widget.node.props['src']?.toString() ?? '';
    if (next == _src) return;
    _src = next;
    _configure();
  }

  void _configure() {
    final kind = fjsClassifyWebViewSrc(_src);
    if (kind == FjsWebViewSrcKind.unsupported) {
      fjsWebViewWarnOnce(
        'web-view-src:$_src',
        '<web-view> will not load "$_src": only http(s):// and asset:// '
            '(a file this module ships) are supported. Other schemes behave '
            'too differently between WKWebView and the browser to promise.',
      );
    }
    final target = fjsResolveWebViewSrc(_src, devUri: widget.devUri);
    if (target.droppedQuery) {
      fjsWebViewWarnOnce(
        'web-view-asset-query:$_src',
        '<web-view src="$_src">: a release build loads this from the app '
            'bundle, and a bundled asset has no query string — the "?…" part '
            'is dropped. It still works in dev, where the same file comes '
            'from the dev server over HTTP, so test this path in a release '
            'build.',
      );
    }
    if (target.isNothing) {
      // Nothing to show: no controller, no request, no events.
      setState(() {
        _controller = null;
        _loaded = '';
      });
      return;
    }
    final generation = _cycle.begin();
    _loaded = target.url ?? 'asset://${_src.substring('asset://'.length)}';
    final controller = widget.controllerOverride ?? WebViewController();
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) => _settle(generation, error: false),
          // Only the main document. A page whose favicon 404s has loaded.
          onWebResourceError: (error) {
            if (error.isForMainFrame == false) return;
            _settle(generation, error: true);
          },
        ),
      )
      ..addJavaScriptChannel(
        // The name the loaded page calls: fjs.postMessage('…'). The web
        // stand-in cannot inject this, so a page brings a shim; see
        // public/demo.html.
        'fjs',
        onMessageReceived: (message) {
          if (!_cycle.accepts(generation) || !mounted) return;
          widget.dispatch(
            widget.node.id,
            FjsEvent.message,
            text: fjsWebViewMessagePayload(message.message),
          );
        },
      );
    if (target.asset != null) {
      controller.loadFlutterAsset(target.asset!);
    } else {
      controller.loadRequest(Uri.parse(target.url!));
    }
    setState(() => _controller = controller);
  }

  void _settle(int generation, {required bool error}) {
    if (!mounted || !_cycle.finish(generation)) return;
    widget.dispatch(
      widget.node.id,
      error ? FjsEvent.error : FjsEvent.load,
      text: error
          ? fjsWebViewErrorPayload(_loaded)
          : fjsWebViewLoadPayload(_loaded),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.shrink();
    return LayoutBuilder(
      builder: (context, constraints) {
        // A WebView has no intrinsic height, so an unbounded main axis has
        // no answer — guessing one would give every page a number nobody
        // asked for. Say so and render nothing (constitution V).
        if (!fjsWebViewFitsBox(constraints)) {
          fjsWebViewWarnOnce(
            'web-view-unbounded:${widget.node.id}',
            '<web-view> node ${widget.node.id} has no height to fill: give '
                'it a height, or a flex-grow, or put it in a box that has '
                'one. A web page has no natural height to fall back on.',
          );
          return const SizedBox.shrink();
        }
        return WebViewWidget(controller: controller);
      },
    );
  }
}
