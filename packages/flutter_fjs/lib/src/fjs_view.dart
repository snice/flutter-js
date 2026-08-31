// Host entry point: mounts one JS root subtree as Flutter widgets.
import 'package:flutter/material.dart';

import 'engine.dart';
import 'mirror_tree.dart';
import 'render/renderer.dart';
import 'widgets/toast_host.dart';

/// Renders the JS UI of [engine]. Place it under a [MaterialApp] body.
///
/// With the JS router in play each route mounts its own root element,
/// tagged with the route key the router allocated; [navKey] selects which
/// one this view draws. The default, 0, is the base page — which is also
/// what an app that never touches the router mounts. Use [FjsApp] to get a
/// native Navigator driven by the router instead of placing these by hand.
class FjsView extends StatelessWidget {
  const FjsView({
    super.key,
    required this.engine,
    this.placeholder,
    this.navKey = 0,
  });

  final FjsEngine engine;
  final Widget? placeholder;
  final int navKey;

  /// Route key a root element belongs to; roots without the marker are the
  /// base page.
  static int rootNavKey(MirrorNode node) {
    final value = node.props['__navKey'];
    if (value is num) return value.toInt();
    return int.tryParse('$value') ?? 0;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: engine,
      builder: (context, _) {
        final tree = engine.tree;
        final ids = [
          for (final id in tree.rootChildren)
            if (tree.node(id) != null && rootNavKey(tree.node(id)!) == navKey)
              id,
        ];
        if (tree.version == 0 || ids.isEmpty) {
          return placeholder ?? const SizedBox.expand();
        }
        return Directionality(
          textDirection: TextDirection.ltr,
          // new tree generation → fresh Element/State under this key, so
          // inputs and switches don't inherit state from the previous load
          child: KeyedSubtree(
            key: ValueKey('fjs-tree-${tree.generation}'),
            child: FjsToastHost(
              engine: engine,
              child: FjsNodeRenderer(
                tree: tree,
                ids: ids,
                dispatch: engine.dispatchEvent,
                registry: engine.components,
              ),
            ),
          ),
        );
      },
    );
  }
}
