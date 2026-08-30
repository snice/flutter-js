// Session screen: the connected project owns the whole viewport, with a
// collapsible dev bar for reload / disconnect / logs.
import 'package:flutter/material.dart';
import 'package:flutter_jsc/flutter_jsc.dart';

import 'dev_server.dart';
import 'log_store.dart';

class SessionScreen extends StatelessWidget {
  const SessionScreen({
    super.key,
    required this.engine,
    required this.server,
    required this.manifest,
    required this.logs,
    required this.onReload,
    required this.onDisconnect,
  });

  final FjsEngine engine;
  final DevServer server;
  final DevManifest manifest;
  final LogStore logs;
  final Future<void> Function() onReload;
  final VoidCallback onDisconnect;

  void _showLogs(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LogSheet(logs: logs),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _DevBar(
              server: server,
              manifest: manifest,
              logs: logs,
              onReload: onReload,
              onDisconnect: onDisconnect,
              onShowLogs: () => _showLogs(context),
            ),
            Expanded(
              // FjsApp, not FjsView: the connected project's routes become
              // real Flutter routes, so the back gesture and the page
              // transition are the platform's
              child: FjsApp(
                engine: engine,
                placeholder: const Center(child: CircularProgressIndicator()),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DevBar extends StatelessWidget {
  const _DevBar({
    required this.server,
    required this.manifest,
    required this.logs,
    required this.onReload,
    required this.onDisconnect,
    required this.onShowLogs,
  });

  final DevServer server;
  final DevManifest manifest;
  final LogStore logs;
  final Future<void> Function() onReload;
  final VoidCallback onDisconnect;
  final VoidCallback onShowLogs;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          children: [
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    manifest.displayName,
                    style: theme.textTheme.titleSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    server.label,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.outline),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            // the error badge is the only hint a phone user gets that the JS
            // side logged something bad, so it lives in the bar itself
            ListenableBuilder(
              listenable: logs,
              builder: (context, _) => IconButton(
                tooltip: '日志',
                onPressed: onShowLogs,
                icon: Icon(
                  logs.hasErrors ? Icons.error_outline : Icons.article_outlined,
                  color: logs.hasErrors ? theme.colorScheme.error : null,
                ),
              ),
            ),
            IconButton(
              tooltip: '重新加载',
              onPressed: onReload,
              icon: const Icon(Icons.refresh),
            ),
            IconButton(
              tooltip: '断开',
              onPressed: onDisconnect,
              icon: const Icon(Icons.logout),
            ),
          ],
        ),
      ),
    );
  }
}

class _LogSheet extends StatelessWidget {
  const _LogSheet({required this.logs});

  final LogStore logs;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.95,
      builder: (context, controller) => ListenableBuilder(
        listenable: logs,
        builder: (context, _) {
          final entries = logs.entries.reversed.toList();
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
                child: Row(
                  children: [
                    Text('日志 (${entries.length})',
                        style: theme.textTheme.titleMedium),
                    const Spacer(),
                    TextButton(onPressed: logs.clear, child: const Text('清空')),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: entries.isEmpty
                    ? const Center(child: Text('暂无输出'))
                    : ListView.builder(
                        controller: controller,
                        itemCount: entries.length,
                        itemBuilder: (context, i) => _LogRow(entry: entries[i]),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _LogRow extends StatelessWidget {
  const _LogRow({required this.entry});

  final LogEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (entry.level) {
      LogLevel.error => scheme.error,
      LogLevel.warn => Colors.orange.shade800,
      LogLevel.status => scheme.primary,
      LogLevel.log => scheme.onSurface,
    };
    final t = entry.at;
    final stamp = '${t.hour.toString().padLeft(2, '0')}:'
        '${t.minute.toString().padLeft(2, '0')}:'
        '${t.second.toString().padLeft(2, '0')}';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(stamp,
              style: TextStyle(
                  fontFamily: 'monospace', fontSize: 11, color: scheme.outline)),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              entry.message,
              style: TextStyle(fontFamily: 'monospace', fontSize: 12, color: color),
            ),
          ),
        ],
      ),
    );
  }
}
