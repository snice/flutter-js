// Host entry point: a Navigator whose page stack mirrors the JS router's.
import 'package:flutter/material.dart';

import 'engine.dart';
import 'fjs_view.dart';

/// A [Navigator] driven by the JS router: one native route per JS route.
///
/// This is what makes `router.push('/detail')` an ordinary Flutter page
/// push — the platform's transition and its back gesture (iOS swipe,
/// Android system back) come with it, and popping tells JS to unmount the
/// page. Place it where you would place a [FjsView]:
///
/// ```dart
/// MaterialApp(home: FjsApp(engine: engine))
/// ```
class FjsApp extends StatefulWidget {
  const FjsApp({
    super.key,
    required this.engine,
    this.placeholder,
    this.observers = const [],
  });

  final FjsEngine engine;

  /// Shown by a page whose JS side has not mounted yet — for a pushed route
  /// that is the moment between the transition starting and its chunk
  /// arriving.
  final Widget? placeholder;

  final List<NavigatorObserver> observers;

  @override
  State<FjsApp> createState() => _FjsAppState();
}

class _FjsAppState extends State<FjsApp> {
  static const _keyPrefix = 'fjs-nav-';

  final GlobalKey<NavigatorState> _navigator = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.engine,
      builder: (context, _) {
        final stack = widget.engine.navStack;
        return NavigatorPopHandler(
          // this Navigator is usually nested (under a host's Scaffold), and
          // a nested one does not see the system back button on its own
          enabled: stack.isNotEmpty,
          onPop: () => _navigator.currentState?.pop(),
          child: Navigator(
            key: _navigator,
            observers: widget.observers,
            pages: [
              _page(context, 0, null),
              for (final entry in stack) _page(context, entry.key, entry.path),
            ],
            onDidRemovePage: (page) {
              final key = page.key;
              if (key is! ValueKey<String>) return;
              final id = int.tryParse(key.value.substring(_keyPrefix.length));
              // the base page is the host's, not the router's
              if (id != null && id != 0) widget.engine.onRouteRemoved(id);
            },
          ),
        );
      },
    );
  }

  Page<void> _page(BuildContext context, int navKey, String? path) {
    return MaterialPage<void>(
      key: ValueKey('$_keyPrefix$navKey'),
      name: path,
      // routes paint no background of their own; without this the previous
      // page shows through wherever the JS tree is transparent (the safe
      // area strips, and the whole page while its chunk loads)
      child: Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: FjsView(
          engine: widget.engine,
          navKey: navKey,
          placeholder: widget.placeholder,
        ),
      ),
    );
  }
}
