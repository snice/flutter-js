// Tag dispatch: turns each [MirrorNode] of the [MirrorTree] into a Flutter
// widget. Tag set reference: docs/ui-api.md.
//
// Built-ins: view, text, image, button, input, scroll-view, list-view,
//   switch, checkbox, slider, progress, divider, stack, safe-area, refresh,
//   swiper, modal
// Unknown tags fall back to the engine's [ComponentRegistry] (Dart-defined
// components), then to `view`.
//
// A tag whose build is more than a couple of lines lives in its own file
// under widgets/; what stays here is the switch itself and the tags that are
// a single widget. Whatever a tag builds then goes through the same three
// wrappers every node shares: flex.dart for the children, then
// decoration.dart for the box, then gesture.dart for input.
import 'package:flutter/gestures.dart' show kTouchSlop;
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../registry/component.dart';
import '../widgets/button.dart';
import '../widgets/checkbox.dart';
import '../widgets/dispatch.dart';
import '../widgets/image.dart';
import '../widgets/input.dart';
import '../widgets/list_view.dart';
import '../widgets/modal.dart';
import '../widgets/progress.dart';
import '../widgets/scroll_behavior.dart';
import '../widgets/slider.dart';
import '../widgets/switch.dart';
import '../widgets/text.dart';
import 'decoration.dart';
import 'flex.dart';
import 'gesture.dart';
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
        if (tree.node(id) != null) _buildNode(context, tree.node(id)!)
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
  Widget _buildNode(BuildContext context, MirrorNode node) {
    if (!_isHidden(node) && _tracksPress(node)) {
      return _PressedNode(
        key: ValueKey<int>(node.id),
        builder: (pressed) => _buildStyledNode(
          context,
          node,
          pressed ? FjsStyle.pressed(node.props) : FjsStyle(node.props),
          pressed: pressed,
        ),
      );
    }
    return _buildStyledNode(context, node, FjsStyle(node.props));
  }

  static bool _tracksPress(MirrorNode node) =>
      node.tag == 'button' || FjsStyle.hasPressedStyle(node.props);

  Widget _buildStyledNode(
    BuildContext context,
    MirrorNode node,
    FjsStyle style, {
    bool pressed = false,
  }) {
    if (_isHidden(node)) return const SizedBox.shrink();
    // hidden children (display:none, and Vue's empty-text v-if / fragment
    // anchors) are dropped here rather than per-tag, so they take no slot in
    // a swiper page, a stack layer or a list row either
    final kidNodes = [
      for (final id in node.children)
        if (tree.node(id) != null && !_isHidden(tree.node(id)!)) tree.node(id)!
    ];
    List<Widget>? kids;
    List<Widget> buildKids() =>
        kids ??= [for (final n in kidNodes) _buildNode(context, n)];

    Widget content;
    switch (node.tag) {
      case 'text':
        content = buildText(node, style, buildKids());
        break;
      case 'image':
        content = buildImage(node, style);
        break;
      case 'button':
        content = buildButton(tree, node, style, dispatch, pressed: pressed);
        break;
      case 'input':
        content = FjsInput(node: node, style: style, dispatch: dispatch);
        break;
      case 'scroll-view':
        content = ScrollConfiguration(
          behavior: const FjsMouseDragScrollBehavior(),
          child: SingleChildScrollView(
            // node-scoped storage bucket: a scroller replaced on the JS side
            // (a new :key) starts at the top instead of inheriting the
            // previous one's offset
            key: PageStorageKey<String>('fjs-scroll-${node.id}'),
            scrollDirection: style.scrollDirection,
            child: buildFlex(style, buildKids(), kidNodes),
          ),
        );
        break;
      case 'list-view':
        content = ScrollConfiguration(
          behavior: const FjsMouseDragScrollBehavior(),
          child: FjsListView(
            key: PageStorageKey<String>('fjs-list-${node.id}'),
            node: node,
            style: style,
            items: kidNodes,
            buildItem: (context, item) => _buildNode(context, item),
            dispatch: dispatch,
          ),
        );
        break;
      // ---- M1: form controls ------------------------------------------------
      case 'switch':
        content = FjsSwitch(node: node, dispatch: dispatch);
        break;
      case 'checkbox':
        content = FjsCheckbox(
          node: node,
          dispatch: dispatch,
          children: buildKids(),
          childNodes: kidNodes,
        );
        break;
      case 'slider':
        content = FjsSlider(node: node, dispatch: dispatch);
        break;
      case 'progress':
        content = buildProgress(node);
        break;
      case 'divider':
        // web: `divider` is a 16px box with a 1px #e0e0e0 rule down the
        // middle — Material's own default color comes from the theme
        content = Divider(
          color: style.color ?? const Color(0xFFE0E0E0),
          height: style.height ?? 16,
          thickness: 1,
        );
        break;
      // ---- M1: layout ---------------------------------------------------------
      case 'stack':
        content = Stack(
          children: [
            for (var i = 0; i < buildKids().length; i++)
              positionedChild(
                i < kidNodes.length ? kidNodes[i] : null,
                buildKids()[i],
              ),
          ],
        );
        break;
      case 'safe-area':
        content = SafeArea(child: buildFlex(style, buildKids(), kidNodes));
        break;
      case 'refresh':
        content = RefreshIndicator(
          onRefresh: () async {
            dispatch(node.id, FjsEvent.refresh);
            await Future<void>.delayed(const Duration(milliseconds: 600));
          },
          child: buildKids().isNotEmpty
              ? buildKids().single
              : ListView(children: const []),
        );
        break;
      // ---- M1: interaction ----------------------------------------------------
      case 'swiper':
        content = SizedBox(
          height: style.height ?? 200,
          // desktop defaults exclude mouse drags from scrollables
          child: ScrollConfiguration(
            behavior: const FjsMouseDragScrollBehavior(),
            child: PageView(
              onPageChanged: (i) =>
                  dispatch(node.id, FjsEvent.pageChanged, text: '$i'),
              children: buildKids(),
            ),
          ),
        );
        break;
      case 'modal':
        content =
            FjsModal(node: node, dispatch: dispatch, children: buildKids());
        break;
      case 'view':
        content = buildFlex(style, buildKids(), kidNodes);
        break;
      default:
        // Dart-registered component (engine.registerComponent) first...
        final builder = registry?.lookup(node.tag);
        if (builder != null) {
          content = builder(context, node, buildKids(), dispatch);
        } else {
          // ...then plain container fallback
          content = buildFlex(style, buildKids(), kidNodes);
        }
        break;
    }

    return gestureNode(node, decorateNode(style, content), dispatch);
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
  const _PressedNode({super.key, required this.builder});

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
      // behind it in a stack take the same pointer, as it would in CSS
      behavior: HitTestBehavior.translucent,
      onPointerDown: _onDown,
      onPointerMove: _onMove,
      onPointerUp: _onEnd,
      onPointerCancel: _onEnd,
      child: widget.builder(_pressed),
    );
  }
}
