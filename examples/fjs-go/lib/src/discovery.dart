// Nearby `fjs dev` servers, heard over UDP broadcast.
//
// `fjs dev` sends a small JSON datagram to the LAN once a second; this
// listens on the fixed discovery port and keeps the ones still talking. It
// removes the last manual step of a debug session: no address to read off
// the terminal, no address to type.
//
// The host comes from the datagram's source address, never from its body —
// that is the interface the packet actually reached this device on, and so
// the one address known to work. A server that goes quiet drops off the
// list after [_ttl], which is how a stopped `fjs dev` disappears.
//
// Best-effort by construction: broadcast does not cross subnets, guest
// networks and "AP isolation" drop it, and some Android devices hold back
// broadcast packets to save power. Scanning the QR code and typing the
// address both still work — this is a shortcut, not the mechanism.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'dev_server.dart';

const _wifiChannel = MethodChannel('fjs_go/wifi');

@immutable
class DiscoveredServer {
  const DiscoveredServer({
    required this.server,
    required this.name,
    required this.mode,
  });

  final DevServer server;

  /// Project name, the same one `GET /manifest.json` reports.
  final String name;

  /// 'bundle' or 'pages' — what shape the server is serving.
  final String mode;
}

class DevServerDiscovery {
  /// Fixed on both sides: the app has to bind it before it knows anything
  /// about the servers out there. Not related to a server's HTTP port.
  static const discoveryPort = 38901;

  /// A beacon is due every second; three missed ones means gone.
  static const _ttl = Duration(seconds: 4);

  final Map<DevServer, _Seen> _seen = <DevServer, _Seen>{};
  final StreamController<List<DiscoveredServer>> _controller =
      StreamController<List<DiscoveredServer>>.broadcast();

  RawDatagramSocket? _socket;
  Timer? _sweep;
  bool _stopped = false;

  /// The current list, newest reading of each server, sorted by name.
  List<DiscoveredServer> get servers {
    final list = [for (final e in _seen.values) e.server];
    list.sort((a, b) => a.name.compareTo(b.name));
    return list;
  }

  Stream<List<DiscoveredServer>> get changes => _controller.stream;

  /// Whether the discovery port is actually bound. False means another
  /// listener already has it, or the platform refused — the address field
  /// and the scanner are unaffected either way.
  bool get listening => _socket != null;

  /// Binds the discovery port. Failure is not an error worth surfacing: the
  /// address field and the QR scanner are the paths that always work.
  Future<void> start() async {
    if (_socket != null || _stopped) return;
    // Take the multicast lock before the socket is up: Android otherwise
    // drops the beacons that arrive in the gap, and the list stays empty.
    await _setMulticastLock(true);
    try {
      final socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        discoveryPort,
        reuseAddress: true,
      );
      if (_stopped) {
        socket.close();
        await _setMulticastLock(false);
        return;
      }
      _socket = socket;
      socket.broadcastEnabled = true;
      socket.listen((event) {
        if (event != RawSocketEvent.read) return;
        final datagram = socket.receive();
        if (datagram != null) _accept(datagram);
      });
      _sweep = Timer.periodic(const Duration(seconds: 1), (_) => _expire());
    } on SocketException {
      // port taken (a second fjs go on this machine), or no permission
      await _setMulticastLock(false);
    } on OSError {
      // same, on platforms that surface it this way
      await _setMulticastLock(false);
    }
  }

  Future<void> stop() async {
    _stopped = true;
    _sweep?.cancel();
    _sweep = null;
    _socket?.close();
    _socket = null;
    await _setMulticastLock(false);
    await _controller.close();
  }

  /// No-op off Android, and on a test/desktop engine that has no plugin.
  static Future<void> _setMulticastLock(bool on) async {
    if (!Platform.isAndroid) return;
    try {
      await _wifiChannel.invokeMethod<void>(
        on ? 'acquireMulticastLock' : 'releaseMulticastLock',
      );
    } on MissingPluginException {
      // widget tests, or a host that has not wired MainActivity
    } on PlatformException {
      // WIFI_SERVICE missing (emulator without wifi)
    }
  }

  void _accept(Datagram datagram) {
    final beacon = parseBeacon(datagram);
    if (beacon == null) return;
    final known = _seen[beacon.server];
    _seen[beacon.server] = _Seen(beacon, DateTime.now());
    // a re-heard beacon is the common case and changes nothing on screen
    if (known == null || known.server.name != beacon.name) _publish();
  }

  /// A datagram becomes a server only if it says it is one: anything else on
  /// this port (another tool, a stray broadcast) is ignored, not shown.
  static DiscoveredServer? parseBeacon(Datagram datagram) {
    try {
      final json = jsonDecode(utf8.decode(datagram.data));
      if (json is! Map<String, dynamic>) return null;
      if (json['fjs'] != 'dev') return null;
      final port = json['port'];
      if (port is! int || port <= 0 || port > 65535) return null;
      return DiscoveredServer(
        server: DevServer(datagram.address.address, port),
        name: json['name'] as String? ?? 'fjs project',
        mode: json['mode'] as String? ?? 'bundle',
      );
    } catch (_) {
      return null; // truncated, not JSON, not UTF-8 — not ours
    }
  }

  void _expire() {
    final deadline = DateTime.now().subtract(_ttl);
    final gone = [
      for (final entry in _seen.entries)
        if (entry.value.at.isBefore(deadline)) entry.key,
    ];
    if (gone.isEmpty) return;
    for (final key in gone) {
      _seen.remove(key);
    }
    _publish();
  }

  void _publish() {
    if (!_controller.isClosed) _controller.add(servers);
  }
}

class _Seen {
  const _Seen(this.server, this.at);

  final DiscoveredServer server;
  final DateTime at;
}
