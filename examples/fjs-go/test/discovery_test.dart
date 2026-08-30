// A beacon arrives from the network, so it is untrusted input: the parser
// has to survive anything else that happens to reach the discovery port.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:fjs_go/src/discovery.dart';

Datagram _beacon(Object? body, {String from = '192.168.1.20'}) {
  final bytes = body is String ? utf8.encode(body) : utf8.encode(jsonEncode(body));
  return Datagram(bytes, InternetAddress(from), 51234);
}

void main() {
  test('a beacon names the server, the source address gives the host', () {
    final found = DevServerDiscovery.parseBeacon(_beacon({
      'fjs': 'dev',
      'v': 1,
      'name': 'vue3-dashboard',
      'port': 38900,
      'mode': 'pages',
    }));
    expect(found, isNotNull);
    expect(found!.name, 'vue3-dashboard');
    expect(found.mode, 'pages');
    // the host is where the packet came from, never what the payload claims
    expect(found.server.host, '192.168.1.20');
    expect(found.server.port, 38900);
  });

  test('the HTTP port comes from the payload, not the sender port', () {
    final found = DevServerDiscovery.parseBeacon(
      _beacon({'fjs': 'dev', 'name': 'x', 'port': 41000}),
    );
    expect(found!.server.port, 41000);
  });

  test('a nameless beacon still connects', () {
    final found = DevServerDiscovery.parseBeacon(
      _beacon({'fjs': 'dev', 'port': 38900}),
    );
    expect(found!.name, 'fjs project');
    expect(found.mode, 'bundle');
  });

  test('anything that is not a fjs dev beacon is ignored', () {
    expect(DevServerDiscovery.parseBeacon(_beacon('not json at all')), isNull);
    expect(DevServerDiscovery.parseBeacon(_beacon([1, 2, 3])), isNull);
    expect(DevServerDiscovery.parseBeacon(_beacon({'hello': 'world'})), isNull);
    expect(DevServerDiscovery.parseBeacon(_beacon({'fjs': 'dev'})), isNull);
    expect(
      DevServerDiscovery.parseBeacon(_beacon({'fjs': 'dev', 'port': '38900'})),
      isNull,
    );
    expect(
      DevServerDiscovery.parseBeacon(_beacon({'fjs': 'dev', 'port': 70000})),
      isNull,
    );
  });

  _liveSocket();
}

// The socket path, end to end on loopback: bind the discovery port, send it
// the datagram `fjs dev` sends, and expect the server to show up.
void _liveSocket() {
  test('a real datagram on the discovery port reaches the stream', () async {
    final discovery = DevServerDiscovery();
    await discovery.start();
    addTearDown(discovery.stop);
    if (!discovery.listening) {
      // something else holds the discovery port on this machine (a running
      // fjs go, most likely) — the parser tests above still cover the logic
      markTestSkipped('discovery port is busy');
      return;
    }

    final sender = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    addTearDown(sender.close);
    final beacon = utf8.encode(
      jsonEncode({'fjs': 'dev', 'name': 'hello-js', 'port': 38900, 'mode': 'bundle'}),
    );

    final seen = discovery.changes.first;
    // one send can be lost even on loopback if the receiver is not polling yet
    for (var i = 0; i < 5; i++) {
      sender.send(beacon, InternetAddress.loopbackIPv4,
          DevServerDiscovery.discoveryPort);
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }

    final found = await seen.timeout(const Duration(seconds: 3));
    expect(found.single.name, 'hello-js');
    expect(found.single.server.port, 38900);
  });
}
