// Client for `fjs dev`: fetches the bundle over HTTP and listens on a
// WebSocket for change notifications. Dev bundles are source mode (faster
// round-trip); production builds embed the bytecode artifact instead.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

class DevClient {
  DevClient(this.host, this.port, {required this.fetchUrl, this.onLog});

  final String host;
  final int port;

  /// How this client talks HTTP: the engine hands in [FjsHttp.fetch], so
  /// the bundle comes down the same client — the same connection pool and
  /// the same lifetime — as JS `fetch()` and a module's own requests.
  final Future<Uint8List> Function(Uri url) fetchUrl;
  final void Function(String message)? onLog;

  WebSocket? _ws;
  /// Called on every change push. [pages] names the page chunks that
  /// changed when the server could tell that nothing else did (a `--pages`
  /// build), and is null when the whole program has to be reloaded.
  Future<void> Function(List<String>? pages)? onReload;

  /// Called for `eval <id> <source>` pushes, which is how `fjs eval` runs
  /// an expression in this VM. The id comes back in the answer so the tool
  /// that asked can tell its own reply from another one's.
  void Function(String id, String source)? onEval;

  /// `fjs dev`'s `p` key: toggle the performance overlay. A push, not a
  /// request — nothing comes back, which is the point: the overlay's numbers
  /// have to survive on a release device where this socket does not exist.
  void Function()? onPerf;
  bool _closed = false;
  Timer? _retryTimer;
  int _retryAttempt = 0;

  Uri get _base => Uri.http('$host:$port');

  /// Where this server lives, for code that needs to build its own URLs
  /// against it (a module fetching its own dev-time file, say).
  Uri get baseUri => _base;

  Future<Uint8List> fetchBundle() => fetchForBootstrap('/bundle.js');

  /// The BOOTSTRAP fetch: keeps trying until it gets the bytes.
  ///
  /// Why only the bootstrap. Failing to fetch the manifest, the prelude or
  /// the bundle means the app has nothing to run at all — there is no page
  /// left standing to report the failure to, so giving up after one attempt
  /// just leaves a dead app. Everything else on this client
  /// ([fetch] itself: a page's own `fetch()`, and the router's
  /// `/pages/<chunk>.js`) must NOT retry: those fail with a page already on
  /// screen that is supposed to handle it, and a silent retry would turn a
  /// plain 404 into "hangs for 8 seconds, then 404".
  ///
  /// Why it matters that this never gives up: on iOS the first outbound
  /// request raises a system permission sheet ("允许…使用无线数据" and, on
  /// iOS 14+ with NSLocalNetworkUsageDescription, the local-network one).
  /// The sheet is ASYNCHRONOUS — the request that triggered it has already
  /// failed by the time the user sees it. One attempt therefore can never
  /// succeed on a fresh install, no matter how the sheet is answered. The
  /// same shape covers two everyday cases: `fjs dev` not started yet, and
  /// wifi blinking during launch.
  ///
  /// Backoff mirrors the socket's below, then holds at the last step; dev
  /// has no business timing out on its own while the user is starting a
  /// server or reading a permission sheet.
  Future<Uint8List> fetchForBootstrap(String path) async {
    for (var attempt = 0;; attempt++) {
      try {
        return await fetch(path);
      } on HttpException {
        // The server answered, and its answer was no. A 404 is not a
        // transient failure — it is how an OLDER dev server says it has no
        // /manifest.json, and fetchManifest below relies on that reaching it
        // so it can fall back to null. Retrying an answer forever would hang
        // the app on exactly the servers that fallback exists for.
        rethrow;
      } catch (e) {
        // Everything else is "could not reach the server": SocketException
        // from the permission sheet, from `fjs dev` not being up yet, from
        // wifi blinking. Those are worth waiting out.
        if (_closed) rethrow;
        final index = attempt < _retryDelays.length
            ? attempt
            : _retryDelays.length - 1;
        final wait = _retryDelays[index];
        // Loud on purpose: a bootstrap that quietly spins looks identical to
        // one that hung (constitution V).
        onLog?.call('$path failed ($e) — retrying in ${wait}s');
        await Future<void>.delayed(Duration(seconds: wait));
        if (_closed) rethrow;
      }
    }
  }

  /// GETs one path from the dev server. Split builds serve `/shared.js`
  /// (the prelude) and `/pages/<chunk>.js` next to `/bundle.js`.
  Future<Uint8List> fetch(String path) async {
    final started = DateTime.now();
    try {
      final bytes = await fetchUrl(_base.replace(path: path));
      // closed while this was in flight: whoever asked has moved on, and
      // applying a bundle after a disconnect is worse than failing
      if (_closed) throw const HttpException('dev client closed');
      final ms = DateTime.now().difference(started).inMilliseconds;
      onLog?.call('GET $path ${bytes.length} bytes in ${ms}ms');
      return bytes;
    } catch (e) {
      final ms = DateTime.now().difference(started).inMilliseconds;
      onLog?.call('GET $path failed in ${ms}ms: $e');
      rethrow;
    }
  }

  /// The dev server's manifest, or null when it cannot be read (an older
  /// server, or a transient failure — neither is worth failing a connect).
  Future<Map<String, Object?>?> fetchManifest() async {
    try {
      final bytes = await fetchForBootstrap('/manifest.json');
      final value = jsonDecode(utf8.decode(bytes));
      return value is Map<String, Object?> ? value : null;
    } catch (e) {
      onLog?.call('manifest unavailable: $e');
      return null;
    }
  }

  /// Opens the change socket. A failure here fails the connect (the caller
  /// has nothing to show yet), but a socket that drops later — `fjs dev`
  /// restarted, wifi blinked, the device slept — is retried in the
  /// background: HTTP keeps working either way, so a dead socket would
  /// otherwise leave the session looking connected while silently never
  /// reloading again.
  Future<void> listen() => _openSocket();

  Future<void> _openSocket() async {
    final ws = await WebSocket.connect(
        _base.replace(scheme: 'ws', path: '/ws').toString());
    if (_closed) {
      await ws.close();
      return;
    }
    _ws = ws;
    _retryAttempt = 0;
    ws.listen((data) {
      if (_closed) return;
      final msg = data.toString();
      if (msg.startsWith('eval ')) {
        final rest = msg.substring('eval '.length);
        final space = rest.indexOf(' ');
        if (space > 0) {
          onEval?.call(rest.substring(0, space), rest.substring(space + 1));
        }
        return;
      }
      if (msg == 'perf') {
        onPerf?.call();
        return;
      }
      if (msg == 'reload' || msg.startsWith('reload')) {
        final pages = changedPages(msg);
        onLog?.call(pages == null
            ? 'change detected — reloading'
            : 'change detected in ${pages.join(', ')} — reloading those pages');
        onReload?.call(pages);
      }
    }, onError: (Object e) {
      if (!_closed) onLog?.call('dev socket error: $e');
    }, onDone: () {
      if (_closed) return;
      onLog?.call('dev server disconnected — retrying');
      _scheduleRetry();
    });
  }

  /// Backoff between reconnect attempts, in seconds; the last value repeats.
  static const List<int> _retryDelays = [1, 2, 3, 5, 8];

  void _scheduleRetry() {
    if (_closed || _retryTimer != null) return;
    _ws = null;
    final index =
        _retryAttempt < _retryDelays.length ? _retryAttempt : _retryDelays.length - 1;
    _retryAttempt++;
    _retryTimer = Timer(Duration(seconds: _retryDelays[index]), () async {
      _retryTimer = null;
      if (_closed) return;
      try {
        await _openSocket();
      } catch (e) {
        onLog?.call('reconnect failed: $e');
        _scheduleRetry();
        return;
      }
      if (_closed) return;
      // Edits made while the socket was down are not replayed, so the
      // bundle in the VM may already be stale: reload once on reconnect.
      onLog?.call('dev server reconnected — reloading');
      await onReload?.call(null);
    });
  }

  /// Forwards one console line to the dev server, where `fjs log` is
  /// listening. Best-effort: a dropped socket must never break the app,
  /// and the reconnect loop will pick it up again.
  void sendLog(int level, String text) {
    final ws = _ws;
    if (ws == null || _closed) return;
    try {
      ws.add(jsonEncode({'fjs': 'log', 'level': level, 'text': text}));
    } catch (_) {
      // socket closing under us: the next reconnect re-establishes it
    }
  }

  /// The page chunks a `reload pages:a,b` push names, or null for the
  /// plain `reload` that means "everything".
  static List<String>? changedPages(String message) {
    const marker = 'reload pages:';
    if (!message.startsWith(marker)) return null;
    final chunks = message
        .substring(marker.length)
        .split(',')
        .where((chunk) => chunk.isNotEmpty)
        .toList();
    return chunks.isEmpty ? null : chunks;
  }

  void close() {
    _closed = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    _ws?.close();
    _ws = null;
  }
}
