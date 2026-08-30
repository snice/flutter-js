// Client for `fjs dev`: fetches the bundle over HTTP and listens on a
// WebSocket for change notifications. Dev bundles are source mode (faster
// round-trip); production builds embed the bytecode artifact instead.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

class DevClient {
  DevClient(this.host, this.port, {this.onLog});

  final String host;
  final int port;
  final void Function(String message)? onLog;

  WebSocket? _ws;
  final HttpClient _http = HttpClient()
    ..idleTimeout = const Duration(seconds: 30);
  /// Called on every change push. [pages] names the page chunks that
  /// changed when the server could tell that nothing else did (a `--pages`
  /// build), and is null when the whole program has to be reloaded.
  Future<void> Function(List<String>? pages)? onReload;
  bool _closed = false;
  Timer? _retryTimer;
  int _retryAttempt = 0;

  Uri get _base => Uri.http('$host:$port');

  Future<Uint8List> fetchBundle() => fetch('/bundle.js');

  /// GETs one path from the dev server. Split builds serve `/shared.js`
  /// (the prelude) and `/pages/<chunk>.js` next to `/bundle.js`.
  Future<Uint8List> fetch(String path) async {
    final started = DateTime.now();
    try {
      final req = await _http.getUrl(_base.replace(path: path));
      final res = await req.close();
      if (res.statusCode != 200) {
        throw HttpException('dev server returned ${res.statusCode} for $path');
      }
      final builder = BytesBuilder(copy: true);
      await for (final chunk in res) {
        builder.add(chunk);
      }
      final bytes = builder.takeBytes();
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
      final bytes = await fetch('/manifest.json');
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
    _http.close(force: true);
  }
}
