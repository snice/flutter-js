// Host entry point: a Navigator whose page stack mirrors the JS router's.
import 'package:flutter/material.dart';

import 'engine.dart';
import 'fjs_view.dart';
import 'transitions.dart';

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
              for (final entry in stack)
                _page(context, entry.key, entry.path,
                    transition: entry.transition),
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

  Page<void> _page(
    BuildContext context,
    int navKey,
    String? path, {
    String transition = '',
  }) {
    // routes paint no background of their own; without this the previous
    // page shows through wherever the JS tree is transparent (the safe
    // area strips, and the whole page while its chunk loads)
    final child = Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: FjsView(
        engine: widget.engine,
        navKey: navKey,
        placeholder: widget.placeholder,
      ),
    );
    final key = ValueKey('$_keyPrefix$navKey');
    // '' is the platform's own transition — a plain MaterialPage, which is
    // Cupertino on iOS and the theme's builder on Android. Every other name
    // is the same animation on both, which is the point of naming them.
    final builder = fjsTransitionBuilder(transition);
    if (transition.isEmpty || (builder == null && transition != 'none')) {
      return MaterialPage<void>(key: key, name: path, child: child);
    }
    return FjsTransitionPage(
      key: key,
      name: path,
      builder: builder,
      duration: builder == null ? Duration.zero : const Duration(milliseconds: 280),
      child: child,
    );
  }
}

/// A route whose transition the JS side named. A null [builder] is the
/// no-animation case (`meta.transition: false`); the route is a real
/// Navigator route either way, so the back gesture and [Navigator.pop]
/// keep working.
class FjsTransitionPage extends Page<void> {
  const FjsTransitionPage({
    required this.child,
    required this.builder,
    required this.duration,
    super.key,
    super.name,
  });

  final Widget child;
  final PageTransitionsBuilder? builder;
  final Duration duration;

  @override
  Route<void> createRoute(BuildContext context) => _FjsPageRoute(page: this);
}

class _FjsPageRoute extends PageRoute<void> {
  _FjsPageRoute({required this.page}) : super(settings: page);

  final FjsTransitionPage page;

  @override
  Duration get transitionDuration => page.duration;

  @override
  Duration get reverseTransitionDuration => page.duration;

  @override
  Color? get barrierColor => null;

  @override
  String? get barrierLabel => null;

  @override
  bool get maintainState => true;

  @override
  Widget buildPage(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
  ) =>
      page.child;

  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    final builder = page.builder;
    if (builder == null) return child;
    return builder.buildTransitions<void>(
      this,
      context,
      animation,
      secondaryAnimation,
      child,
    );
  }
}
