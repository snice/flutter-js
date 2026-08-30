// Address of a `fjs dev` server, plus the probe that runs before the engine
// connects: a bad host would otherwise surface as an opaque socket error
// from deep inside the engine.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show immutable;

@immutable
class DevServer {
  const DevServer(this.host, this.port);

  factory DevServer.parse(String input) {
    var text = input.trim();
    if (text.isEmpty) throw const FormatException('address is empty');
    // accept pasted URLs (http://1.2.3.4:38900/bundle.js) as well as host:port
    if (text.contains('://')) {
      final uri = Uri.parse(text);
      return DevServer(uri.host, uri.hasPort ? uri.port : defaultPort);
    }
    text = text.split('/').first;
    final colon = text.lastIndexOf(':');
    if (colon < 0) return DevServer(text, defaultPort);
    final port = int.tryParse(text.substring(colon + 1));
    if (port == null) throw FormatException('bad port in "$input"');
    return DevServer(text.substring(0, colon), port);
  }

  static const defaultPort = 38900;

  final String host;
  final int port;

  String get label => '$host:$port';
  Uri get bundleUrl => Uri.http(label, '/bundle.js');

  /// Asks the server what project it is serving. Doubles as the reachability
  /// check: a connect attempt only proceeds if this succeeds.
  Future<DevManifest> probe({Duration timeout = const Duration(seconds: 4)}) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      final req = await client.getUrl(Uri.http(label, '/manifest.json')).timeout(timeout);
      final res = await req.close().timeout(timeout);
      if (res.statusCode == 404) return const DevManifest.unknown();
      if (res.statusCode != 200) {
        throw HttpException('dev server returned ${res.statusCode}');
      }
      final body = await res.transform(utf8.decoder).join().timeout(timeout);
      return DevManifest.fromJson(jsonDecode(body) as Map<String, dynamic>);
    } finally {
      client.close(force: true);
    }
  }

  @override
  bool operator ==(Object other) =>
      other is DevServer && other.host == host && other.port == port;

  @override
  int get hashCode => Object.hash(host, port);

  @override
  String toString() => label;
}

/// What `GET /manifest.json` reports. Servers that predate the endpoint
/// answer 404 and land on [DevManifest.unknown].
@immutable
class DevManifest {
  const DevManifest({required this.name, required this.entry});
  const DevManifest.unknown() : name = null, entry = null;

  factory DevManifest.fromJson(Map<String, dynamic> json) => DevManifest(
        name: json['name'] as String?,
        entry: json['entry'] as String?,
      );

  final String? name;
  final String? entry;

  String get displayName => name ?? 'fjs project';
}
