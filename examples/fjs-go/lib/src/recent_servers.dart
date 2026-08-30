// Most-recently-connected servers, persisted so relaunching the app does not
// mean retyping a LAN address on a phone keyboard.
//
// Deliberately plugin-free (a plain JSON file under the app's temp dir):
// fjs go must stay buildable on any Flutter/Android toolchain, and a
// convenience list of addresses is not worth a native dependency. Losing it
// to a cache purge costs the user one retype.
import 'dart:convert';
import 'dart:io';

import 'dev_server.dart';

class RecentServers {
  RecentServers._(this._file, this._entries);

  static const _limit = 8;

  static Future<RecentServers> load() async {
    final file = File('${Directory.systemTemp.path}/fjs_go_servers.json');
    final entries = <DevServer>[];
    try {
      if (await file.exists()) {
        final raw = jsonDecode(await file.readAsString());
        for (final line in (raw as List<dynamic>)) {
          try {
            entries.add(DevServer.parse(line as String));
          } on FormatException {
            // one corrupted entry must not take the list down with it
          }
        }
      }
    } catch (_) {
      // unreadable/garbled file: start from an empty list rather than fail
      // the app launch over a convenience cache
    }
    return RecentServers._(file, entries);
  }

  final File _file;
  final List<DevServer> _entries;

  List<DevServer> get entries => List.unmodifiable(_entries);

  Future<void> remember(DevServer server) async {
    _entries.removeWhere((e) => e == server);
    _entries.insert(0, server);
    if (_entries.length > _limit) _entries.removeRange(_limit, _entries.length);
    await _save();
  }

  Future<void> forget(DevServer server) async {
    _entries.removeWhere((e) => e == server);
    await _save();
  }

  Future<void> _save() async {
    try {
      await _file.writeAsString(jsonEncode([for (final e in _entries) e.label]));
    } catch (_) {
      // read-only or full storage: the in-memory list still works this session
    }
  }
}
