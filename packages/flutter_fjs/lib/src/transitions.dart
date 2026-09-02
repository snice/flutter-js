// The named page transitions. `transition: 'fjs-fade'` on the JS side has
// to look the same on iOS, on Android and on web — the web half is a CSS
// family in the runtime's base stylesheet (base-css.ts), this is the
// native half. The default ('') is deliberately *not* in here: it stays
// the platform's own transition, which is what an app that never mentions
// transitions should get.
import 'package:flutter/material.dart';

/// Route builder for a name from the JS side, or null when the name has no
/// native animation — 'none', and any name this side does not know (a web
/// CSS family of the app's own, which falls back to the platform's).
PageTransitionsBuilder? fjsTransitionBuilder(String name) {
  switch (name) {
    case 'fjs-slide':
      // iOS's own, on every platform
      return const CupertinoPageTransitionsBuilder();
    case 'fjs-zoom':
      return const ZoomPageTransitionsBuilder();
    case 'fjs-fade':
      return const FjsFadeTransitionsBuilder();
    case 'fjs-slide-up':
      return const FjsSlideUpTransitionsBuilder();
    default:
      return null;
  }
}

/// Cross-fade, no movement. The leaving page stays put and fades under it,
/// which is what the CSS family does.
class FjsFadeTransitionsBuilder extends PageTransitionsBuilder {
  const FjsFadeTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    return FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
      child: child,
    );
  }
}

/// Up from the bottom — a modal / sheet-like page. Going back it drops
/// straight down again; the page underneath does not move.
class FjsSlideUpTransitionsBuilder extends PageTransitionsBuilder {
  const FjsSlideUpTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    return SlideTransition(
      position: Tween<Offset>(
        begin: const Offset(0, 1),
        end: Offset.zero,
      ).animate(CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeInCubic,
      )),
      child: child,
    );
  }
}
