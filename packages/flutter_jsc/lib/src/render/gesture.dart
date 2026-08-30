// Event wiring shared by every tag: which props mean "this node is tappable",
// and the GestureDetector that reports taps back to JS.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../widgets/dispatch.dart';

/// Whether the node asked for tap handling. `onClick` is the alias Vue
/// templates reach for; both arrive as a `true` prop, not a function.
bool hasTapEvent(MirrorNode node) =>
    node.props['onTap'] == true || node.props['onClick'] == true;

void dispatchTap(MirrorNode node, FjsDispatch dispatch) =>
    dispatch(node.id, FjsEvent.tap);

/// Wraps [content] in a [GestureDetector] when the node listens for taps or
/// long presses; returns it untouched when it does not, so nodes that ignore
/// input add no hit-test entry.
Widget gestureNode(MirrorNode node, Widget content, FjsDispatch dispatch) {
  final onTap = hasTapEvent(node) ? () => dispatch(node.id, FjsEvent.tap) : null;
  final onLongPress = node.props['onLongPress'] == true
      ? () => dispatch(node.id, FjsEvent.longPress)
      : null;
  if (onTap == null && onLongPress == null) return content;
  return GestureDetector(
    onTap: onTap,
    onLongPress: onLongPress,
    behavior: HitTestBehavior.opaque,
    child: content,
  );
}
