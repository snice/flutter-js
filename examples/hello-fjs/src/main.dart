import 'package:flutter_fjs/flutter_fjs.dart';

Future<void> fjsAttachHost(FjsEngine engine) async {
    final asyncStore = <String, String>{};
    engine.host.registerAsync('demo.asyncStore', (args) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    switch (args[0] as String? ?? '') {
        case 'set':
        asyncStore[args[1] as String] = args[2] as String;
        return true;
        case 'get':
        return asyncStore[args[1] as String];
        case 'keys':
        return asyncStore.keys.toList();
        default:
        throw ArgumentError('unknown op ${args[0]} (use set / get / keys)');
    }
    });
}