// The dev socket is the whole of hot reload in `fjs go`: if it dies quietly
// — `fjs dev` restarted, wifi blinked, the device slept — HTTP keeps working
// and the session looks connected while never reloading again. These cover
// the push and the reconnect that follows a drop.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_fjs/src/dev_client.dart';
import 'package:flutter_test/flutter_test.dart';

/// A minimal stand-in for `fjs dev`: /ws upgrades, everything else 404s.
class FakeDevServer {
  FakeDevServer._(this._server);

  final HttpServer _server;
  final List<WebSocket> sockets = [];
  /// Everything the client sent us — `fjs log` reads these off the server.
  final List<String> received = [];

  static Future<FakeDevServer> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final fake = FakeDevServer._(server);
    server.listen((req) async {
      if (req.uri.path == '/ws' && WebSocketTransformer.isUpgradeRequest(req)) {
        final ws = await WebSocketTransformer.upgrade(req);
        fake.sockets.add(ws);
        ws.listen((data) => fake.received.add(data.toString()));
        return;
      }
      req.response.statusCode = HttpStatus.notFound;
      await req.response.close();
    });
    return fake;
  }

  int get port => _server.port;

  void push(String message) {
    for (final ws in sockets) {
      ws.add(message);
    }
  }

  /// Drops every live socket, the way a `fjs dev` restart does.
  Future<void> dropSockets() async {
    final live = [...sockets];
    sockets.clear();
    for (final ws in live) {
      await ws.close();
    }
  }

  Future<void> stop() => _server.close(force: true);
}

/// Polls until [ready], so the test does not hard-code socket timing.
Future<void> waitFor(bool Function() ready, {Duration timeout = const Duration(seconds: 10)}) async {
  final deadline = DateTime.now().add(timeout);
  while (!ready()) {
    if (DateTime.now().isAfter(deadline)) return;
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
}

void main() {
  late FakeDevServer server;
  late DevClient client;
  late List<String> logs;
  var reloads = 0;
  List<String>? lastPages;

  setUp(() async {
    HttpOverrides.global = null; // flutter_test's fake HttpClient breaks sockets
    server = await FakeDevServer.start();
    logs = [];
    reloads = 0;
    lastPages = null;
    client = DevClient('127.0.0.1', server.port, onLog: logs.add)
      ..onReload = (pages) async {
        reloads++;
        lastPages = pages;
      };
  });

  tearDown(() async {
    client.close();
    await server.stop();
  });

  test('a reload push reaches onReload', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    server.push('reload');
    await waitFor(() => reloads > 0);
    expect(reloads, 1);
    expect(lastPages, isNull, reason: 'a bare reload means "everything"');
  });

  test('a page-scoped push names the chunks that changed', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    server.push('reload pages:about,comp-swiper');
    await waitFor(() => reloads > 0);
    expect(lastPages, ['about', 'comp-swiper']);
  });

  test('changedPages parses the wire forms', () {
    expect(DevClient.changedPages('reload'), isNull);
    expect(DevClient.changedPages('reload pages:'), isNull);
    expect(DevClient.changedPages('reload pages:index'), ['index']);
    expect(DevClient.changedPages('reload pages:a,b,c'), ['a', 'b', 'c']);
  });

  test('an eval push splits into id and source', () async {
    String? evalId;
    String? evalSource;
    client.onEval = (id, source) {
      evalId = id;
      evalSource = source;
    };
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    // the source has spaces of its own: only the first one separates the id
    server.push('eval a1b2c3 console.log(1 + 1)');
    await waitFor(() => evalId != null);
    expect(evalId, 'a1b2c3');
    expect(evalSource, 'console.log(1 + 1)');
    expect(reloads, 0, reason: 'an eval is not a reload');
  });

  test('console lines go up the socket for fjs log', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    client.sendLog(3, 'boom');
    await waitFor(() => server.received.isNotEmpty);
    expect(jsonDecode(server.received.single), {
      'fjs': 'log',
      'level': 3,
      'text': 'boom',
    });
  });

  test('sendLog on a closed client is a no-op, not a crash', () {
    expect(() => client.sendLog(1, 'nobody is listening'), returnsNormally);
  });

  test('a dropped socket reconnects and reloads once back', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);

    await server.dropSockets();
    await waitFor(() => server.sockets.isNotEmpty); // the retry timer's connect
    expect(server.sockets, isNotEmpty, reason: 'client did not reconnect');
    // an edit during the outage is not replayed, so reconnecting reloads
    await waitFor(() => reloads > 0);
    expect(reloads, 1);
    expect(lastPages, isNull, reason: 'a reconnect cannot know what changed');

    // and the fresh socket carries pushes like the first one did
    server.push('reload');
    await waitFor(() => reloads > 1);
    expect(reloads, 2);
  });

  test('close stops the reconnect loop', () async {
    await client.listen();
    await waitFor(() => server.sockets.isNotEmpty);
    await server.dropSockets();
    client.close();
    await Future<void>.delayed(const Duration(seconds: 3));
    expect(server.sockets, isEmpty, reason: 'closed client kept reconnecting');
    expect(reloads, 0);
  });

  test('a first connect that fails is the caller\'s to report', () async {
    await server.stop();
    await expectLater(client.listen(), throwsA(isA<SocketException>()));
  });
}
