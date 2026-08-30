// Connect screen: pick a `fjs dev` server. Defaults are platform-aware
// because "localhost" means different things to an emulator and a phone.
import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';

import 'dev_server.dart';
import 'discovery.dart';
import 'recent_servers.dart';
import 'scan_screen.dart';

class ConnectScreen extends StatefulWidget {
  const ConnectScreen({
    super.key,
    required this.recents,
    required this.onConnect,
    this.error,
    this.busy = false,
  });

  final RecentServers? recents;
  final Future<void> Function(DevServer server) onConnect;
  final String? error;
  final bool busy;

  @override
  State<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends State<ConnectScreen> {
  late final TextEditingController _controller =
      TextEditingController(text: _defaultAddress());
  String? _parseError;

  /// Nearby servers, for as long as this screen is up. Listening stops on
  /// dispose: a connected session has no use for it, and an idle UDP socket
  /// on a phone is not free.
  final DevServerDiscovery _discovery = DevServerDiscovery();

  /// The camera path only exists on the platforms that have one worth using;
  /// on macOS the terminal with the QR code is on the same screen.
  static final bool _canScan = Platform.isAndroid || Platform.isIOS;

  /// An Android emulator reaches the host machine at 10.0.2.2; simulators and
  /// desktop share the host's loopback. A physical device needs the LAN IP
  /// that `fjs dev` prints — nothing here can guess it.
  static String _defaultAddress() {
    final host = Platform.isAndroid ? '10.0.2.2' : '127.0.0.1';
    return '$host:${DevServer.defaultPort}';
  }

  @override
  void initState() {
    super.initState();
    unawaited(_discovery.start());
  }

  @override
  void dispose() {
    unawaited(_discovery.stop());
    _controller.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final server = await scanDevServer(context);
    if (server == null || !mounted) return;
    _controller.text = server.label;
    _submit(server.label);
  }

  void _submit([String? raw]) {
    final text = raw ?? _controller.text;
    try {
      final server = DevServer.parse(text);
      setState(() => _parseError = null);
      widget.onConnect(server);
    } on FormatException catch (e) {
      setState(() => _parseError = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final recents = widget.recents?.entries ?? const <DevServer>[];
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('fjs go', style: theme.textTheme.displaySmall),
                  const SizedBox(height: 8),
                  Text(
                    '连接到运行中的 fjs dev 服务器，无需重新编译原生层即可调试任意 fjs 工程。',
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: theme.colorScheme.outline),
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _controller,
                    enabled: !widget.busy,
                    autocorrect: false,
                    keyboardType: TextInputType.url,
                    textInputAction: TextInputAction.go,
                    onSubmitted: _submit,
                    decoration: InputDecoration(
                      labelText: 'dev server',
                      hintText: '192.168.1.20:${DevServer.defaultPort}',
                      helperText: 'host:port，也可直接粘贴 fjs dev 打印的 URL',
                      errorText: _parseError,
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.dns_outlined),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: widget.busy ? null : () => _submit(),
                          icon: widget.busy
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.play_arrow),
                          label: Text(widget.busy ? '连接中…' : '连接'),
                          style: FilledButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                        ),
                      ),
                      if (_canScan) ...[
                        const SizedBox(width: 12),
                        OutlinedButton.icon(
                          onPressed: widget.busy ? null : () => unawaited(_scan()),
                          icon: const Icon(Icons.qr_code_scanner),
                          label: const Text('扫一扫'),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(
                                vertical: 16, horizontal: 16),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (widget.error != null) ...[
                    const SizedBox(height: 16),
                    _ErrorPanel(message: widget.error!),
                  ],
                  _NearbyServers(
                    discovery: _discovery,
                    busy: widget.busy,
                    onPick: (server) => _submit(server.label),
                  ),
                  if (recents.isNotEmpty) ...[
                    const SizedBox(height: 32),
                    Text('最近连接', style: theme.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    for (final server in recents)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.history),
                        title: Text(server.label),
                        onTap: widget.busy ? null : () => _submit(server.label),
                        trailing: IconButton(
                          icon: const Icon(Icons.close),
                          tooltip: '移除',
                          onPressed: widget.busy
                              ? null
                              : () async {
                                  await widget.recents?.forget(server);
                                  if (mounted) setState(() {});
                                },
                        ),
                      ),
                  ],
                  const SizedBox(height: 24),
                  _Hint(
                    text: _canScan
                        ? '真机最快的路子是扫 fjs dev 终端里那个二维码；同一局域网时它也会自己出现在上面的列表里。'
                        : '模拟器可用 127.0.0.1；同一局域网的 fjs dev 会自己出现在上面的列表里。',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The servers heard on the LAN. Renders nothing at all when there are
/// none: on a network that drops broadcast an empty "附近的服务器" box would
/// read as a broken feature rather than a quiet one.
class _NearbyServers extends StatelessWidget {
  const _NearbyServers({
    required this.discovery,
    required this.busy,
    required this.onPick,
  });

  final DevServerDiscovery discovery;
  final bool busy;
  final void Function(DevServer server) onPick;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return StreamBuilder<List<DiscoveredServer>>(
      stream: discovery.changes,
      initialData: discovery.servers,
      builder: (context, snapshot) {
        final found = snapshot.data ?? const <DiscoveredServer>[];
        if (found.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 32),
            Row(
              children: [
                Icon(Icons.wifi_tethering,
                    size: 16, color: theme.colorScheme.primary),
                const SizedBox(width: 6),
                Text('附近的 dev 服务器', style: theme.textTheme.titleSmall),
              ],
            ),
            const SizedBox(height: 4),
            for (final nearby in found)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.dns_outlined),
                title: Text(nearby.name),
                subtitle: Text(
                  '${nearby.server.label}${nearby.mode == 'pages' ? ' · 分页构建' : ''}',
                ),
                onTap: busy ? null : () => onPick(nearby.server),
              ),
          ],
        );
      },
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, color: scheme.onErrorContainer, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              message,
              style: TextStyle(color: scheme.onErrorContainer, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, size: 16, color: theme.colorScheme.outline),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.outline),
          ),
        ),
      ],
    );
  }
}
