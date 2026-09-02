// Tag adapters: turn each [MirrorNode] of the [MirrorTree] into a Flutter
// widget. Tag set reference: docs/ui-api.md.
//
// Built-ins: view, text, image, button, input, scroll-view, list-view,
//   switch, checkbox, slider, progress, divider, safe-area, refresh,
//   swiper, modal
// Unknown tags fall back to the engine's [ComponentRegistry] (Dart-defined
// components), then to `view`.
//
// A tag whose build is more than a couple of lines lives in its own file
// under widgets/; renderer.dart owns the adapter table and the tags that are
// a single widget. Whatever a tag builds then goes through the same wrapper
// pipeline every node shares: flex.dart for the children, decoration.dart for
// the box, then gesture.dart for input.
import 'package:flutter/gestures.dart' show kTouchSlop;
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../node/node_adapter.dart';
import '../node/node_adapters.dart';
import '../registry/component.dart';
import '../widgets/dispatch.dart';
import 'decoration.dart' show decorateNode, transitionNode;
import 'gesture.dart';
import 'touch.dart' show needsTouchNode;
import 'style.dart';

class FjsNodeRenderer extends StatelessWidget {
  const FjsNodeRenderer({
    required this.tree,
    required this.ids,
    required this.dispatch,
    this.registry,
  });

  final MirrorTree tree;
  final List<int> ids;
  final FjsDispatch dispatch;
  final ComponentRegistry? registry;

  @override
  Widget build(BuildContext context) {
    final children = [
      for (final id in ids)
        if (tree.node(id) != null)
          _buildNode(context, tree.node(id)!, isRoot: true)
    ];
    if (children.length == 1) return children.single;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }

  /// Nodes that take no space at all: `display: none`, and empty text nodes
  /// (Vue's fragment / v-if anchors arrive as text nodes with no content —
  /// a `Text('')` would still claim a line's height).
  static bool _isHidden(MirrorNode node) {
    if (FjsStyle(node.props).display == 'none') return true;
    return node.tag == 'text' &&
        (node.text == null || node.text!.isEmpty) &&
        node.children.isEmpty;
  }

  /// A node that paints while pressed — CSS `:active`, or a `button` with
  /// the default WeUI mask — gets a [_PressedNode] so the press lives in
  /// the widget tree. No round trip through JS, and no wait for a
  /// recognizer to win the arena (that delay is why a quick tap showed
  /// nothing).
  Widget _buildNode(BuildContext context, MirrorNode node,
      {bool isRoot = false}) {
    final style = FjsStyle(node.props);
    // a draggable node keeps its transform wrapper even before it has a
    // transform — see transformNode
    final stable = needsTouchNode(node, style);
    final tracksPress = !_isHidden(node) && _tracksPress(node);
    Widget built = tracksPress
        ? _PressedNode(
            builder: (pressed) => _buildStyledNode(
              context,
              node,
              pressed ? FjsStyle.pressed(node.props) : style,
              pressed: pressed,
              isRoot: isRoot,
            ),
          )
        : _buildStyledNode(context, node, style, isRoot: isRoot);
    built = transitionNode(
      style,
      built,
      key: 'fjs-transition-${tree.generation}-${node.id}',
      stableTransform: stable,
    );
    // Nodes that hold state of their own (a finger mid-drag, a press) are
    // keyed by node id at the very top, so reordering a list matches them
    // by identity. Without the key the children reconcile by position: a
    // reorder would rebuild every row from scratch and the drag doing the
    // reordering would lose the listener holding its finger.
    if (stable || tracksPress) {
      built = KeyedSubtree(key: ValueKey<int>(node.id), child: built);
    }
    return built;
  }

  static bool _tracksPress(MirrorNode node) =>
      node.tag == 'button' || FjsStyle.hasPressedStyle(node.props);

  Widget _buildStyledNode(
    BuildContext context,
    MirrorNode node,
    FjsStyle style, {
    bool pressed = false,
    // the page root fills its route, and so do its children — the same rule
    // the web stylesheet writes as `fjs-page-entry > * { flex: 1 1 0% }`
    bool isRoot = false,
  }) {
    if (_isHidden(node)) return const SizedBox.shrink();
    // hidden children (display:none, and Vue's empty-text v-if / fragment
    // anchors) are dropped here rather than per-tag, so they take no slot in
    // a swiper page, a positioned layer or a list row either
    final kidNodes = [
      for (final id in node.children)
        if (tree.node(id) != null && !_isHidden(tree.node(id)!)) tree.node(id)!
    ];
    List<Widget>? kids;
    List<Widget> buildKids() =>
        kids ??= [for (final n in kidNodes) _buildNode(context, n)];

    final adapter = builtInNodeAdapterByTag[node.tag];
    final adapterContext = FjsNodeAdapterContext(
      flutterContext: context,
      tree: tree,
      node: node,
      style: style,
      childNodes: kidNodes,
      buildChildren: buildKids,
      buildNode: _buildNode,
      dispatch: dispatch,
      pressed: pressed,
      isRoot: isRoot,
    );

    Widget content;
    Widget decorated;
    if (adapter != null) {
      content = adapter.build(adapterContext);
      decorated = adapter.decorate(adapterContext, content);
    } else {
      // Dart-registered component (engine.registerComponent) first...
      final builder = registry?.lookup(node.tag);
      if (builder != null) {
        content = builder(context, node, buildKids(), dispatch);
      } else {
        // ...then plain container fallback
        content = viewNodeAdapter.build(adapterContext);
      }
      decorated = decorateNode(style, content);
    }
    return gestureNode(node, style, decorated, dispatch);
  }
}

/// Holds one node's `:active` state, driven by raw pointer input.
///
/// Why not a tap recognizer: `onTapDown` only fires once the recognizer wins
/// the gesture arena, which inside a list is `kPressTimeout` later or never
/// for a quick tap — the pressed style would flash after the finger is gone,
/// or not at all. And `onTapCancel` fires as soon as the enclosing scrollable
/// claims the gesture, which for a mouse (1px slop) is the tiniest jitter,
/// so a press would vanish while the button is still held.
///
/// Pointers give the browser's behaviour instead: on at pointer-down, off at
/// pointer-up, and off early only when the pointer travels far enough that
/// the gesture is really a scroll rather than a press.
class _PressedNode extends StatefulWidget {
  const _PressedNode({required this.builder});

  final Widget Function(bool pressed) builder;

  @override
  State<_PressedNode> createState() => _PressedNodeState();
}

class _PressedNodeState extends State<_PressedNode> {
  bool _pressed = false;
  Offset? _downAt;

  void _setPressed(bool value) {
    if (_pressed == value || !mounted) return;
    setState(() => _pressed = value);
  }

  void _onDown(PointerDownEvent event) {
    _downAt = event.position;
    _setPressed(true);
  }

  void _onMove(PointerMoveEvent event) {
    final from = _downAt;
    if (from == null) return;
    // same threshold the framework uses to call a drag a drag
    if ((event.position - from).distance <= kTouchSlop) return;
    _downAt = null;
    _setPressed(false);
  }

  void _onEnd([PointerEvent? _]) {
    _downAt = null;
    _setPressed(false);
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      // translucent, not opaque: an `:active` node still lets whatever sits
      // behind it in a positioned box take the same pointer, as it would in CSS
      behavior: HitTestBehavior.translucent,
      onPointerDown: _onDown,
      onPointerMove: _onMove,
      onPointerUp: _onEnd,
      onPointerCancel: _onEnd,
      child: widget.builder(_pressed),
    );
  }
}
