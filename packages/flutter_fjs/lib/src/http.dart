// FjsHttp — the Dart half of the runtime's fetch().
//
// QuickJS has no sockets, so fetch() in JS hands the request to Dart and
// waits for a response event, over the two channels everything else uses:
//
//   JS                       Dart                            JS
//   fetch(url)  -> invokeHost('fjs.http.request', id, json)
//               <- dispatchEvent(id, 14, responseJson)  -> promise settles
//   controller.abort() -> invokeHost('fjs.http.abort', id)
//
// invokeHost is synchronous (it is the JSI host-function path), so the
// handler only *starts* the request and returns immediately — the engine's
// UI thread is never blocked on the network.
//
// Bodies cross as base64 in both directions: the v1 host ABI carries
// strings, and base64 keeps binary payloads (images, protobufs, gzip that
// the client already inflated) intact rather than mangling them through a
// utf8 round trip.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'ffi.dart';
import 'registry/host.dart';

/// Owns the HttpClient and the in-flight requests for one engine.
class FjsHttp {
  FjsHttp({required this.dispatchEvent, HttpClient? client})
      : _client = client ?? HttpClient();

  /// Delivers the response back into the VM (the engine's dispatchEvent).
  final void Function(int requestId, int eventType, {String? text})
      dispatchEvent;

  final HttpClient _client;
  final Map<int, HttpClientRequest> _inFlight = {};
  final Set<int> _aborted = {};
  bool _closed = false;

  /// Installs `fjs.http.request` / `fjs.http.abort` on [host].
  void register(HostRegistry host) {
    host
      ..register('fjs.http.request', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        final json = args.length > 1 ? args[1]?.toString() ?? '{}' : '{}';
        // fire and forget: the promise settles on the response event
        unawaited(_run(id, json));
        return null;
      })
      ..register('fjs.http.abort', (args) {
        final id = args.isNotEmpty ? (args.first as num).toInt() : -1;
        _aborted.add(id);
        _inFlight.remove(id)?.abort();
        return null;
      });
  }

  Future<void> _run(int id, String requestJson) async {
    try {
      final spec = jsonDecode(requestJson) as Map<String, Object?>;
      final url = Uri.parse(spec['url']?.toString() ?? '');
      final method = (spec['method']?.toString() ?? 'GET').toUpperCase();
      final timeoutMs = (spec['timeoutMs'] as num?)?.toInt();

      var future = _send(id, url, method, spec);
      if (timeoutMs != null && timeoutMs > 0) {
        future = future.timeout(
          Duration(milliseconds: timeoutMs),
          onTimeout: () {
            _inFlight.remove(id)?.abort();
            throw TimeoutException('request timed out after ${timeoutMs}ms');
          },
        );
      }
      final payload = await future;
      _deliver(id, payload);
    } catch (e) {
      _deliver(id, {'ok': false, 'error': _message(e)});
    } finally {
      _inFlight.remove(id);
      _aborted.remove(id);
    }
  }

  Future<Map<String, Object?>> _send(
    int id,
    Uri url,
    String method,
    Map<String, Object?> spec,
  ) async {
    final request = await _client.openUrl(method, url);
    if (_aborted.contains(id) || _closed) {
      request.abort();
      throw const _Aborted();
    }
    _inFlight[id] = request;

    request.followRedirects = spec['followRedirects'] != false;
    final headers = spec['headers'];
    if (headers is Map) {
      headers.forEach((name, value) {
        // set(), not add(): JS already joined repeated names, and this must
        // replace the defaults HttpClient fills in (content-type, accept).
        request.headers.set(name.toString(), value.toString());
      });
    }
    final bodyBase64 = spec['bodyBase64']?.toString();
    if (bodyBase64 != null && bodyBase64.isNotEmpty) {
      request.add(base64Decode(bodyBase64));
    }

    final response = await request.close();
    final bytes = await _readBody(response);

    final outHeaders = <String, String>{};
    response.headers.forEach((name, values) {
      outHeaders[name] = values.join(', ');
    });

    return {
      'ok': true,
      'status': response.statusCode,
      'statusText': response.reasonPhrase,
      // after redirects this is where the body actually came from
      'url': (response.redirects.isNotEmpty
              ? response.redirects.last.location
              : url)
          .toString(),
      'redirected': response.redirects.isNotEmpty,
      'headers': outHeaders,
      'bodyBase64': bytes.isEmpty ? null : base64Encode(bytes),
    };
  }

  /// One pre-sized buffer instead of the intermediate copies `expand()`
  /// would make on a large body.
  Future<Uint8List> _readBody(HttpClientResponse response) async {
    final chunks = <List<int>>[];
    var total = 0;
    await for (final chunk in response) {
      chunks.add(chunk);
      total += chunk.length;
    }
    final out = Uint8List(total);
    var offset = 0;
    for (final chunk in chunks) {
      out.setRange(offset, offset + chunk.length, chunk);
      offset += chunk.length;
    }
    return out;
  }

  void _deliver(int id, Map<String, Object?> payload) {
    // an aborted request already rejected its promise in JS
    if (_closed || _aborted.remove(id)) return;
    dispatchEvent(id, FjsEvent.httpResponse, text: jsonEncode(payload));
  }

  String _message(Object e) {
    if (e is _Aborted) return 'request aborted';
    if (e is SocketException) {
      return 'network error: ${e.message}${e.osError != null ? ' (${e.osError!.message})' : ''}';
    }
    if (e is HttpException) return 'http error: ${e.message}';
    if (e is TimeoutException) return e.message ?? 'request timed out';
    if (e is FormatException) return 'bad request or URL: ${e.message}';
    return e.toString();
  }

  /// Drops every in-flight request. Used on VM reset (hot reload): the
  /// promises waiting on them died with the old VM, and their ids mean
  /// nothing to the new one.
  void cancelAll() {
    for (final entry in _inFlight.entries) {
      _aborted.add(entry.key);
      entry.value.abort();
    }
    _inFlight.clear();
  }

  /// Aborts everything in flight and closes the client.
  void close() {
    if (_closed) return;
    _closed = true;
    cancelAll();
    _aborted.clear();
    _client.close(force: true);
  }
}

class _Aborted implements Exception {
  const _Aborted();
}
