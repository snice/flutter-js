// `button` tag -> OutlinedButton.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/gesture.dart';
import '../render/style.dart';
import 'dispatch.dart';

Widget buildButton(
  MirrorTree tree,
  MirrorNode node,
  FjsStyle style,
  FjsDispatch dispatch,
) {
  // Vue compiles <button>label</button> to a string child that lands on
  // the button node's own text (hostSetElementText), not a child text
  // element — so fall back to it when there are no text children.
  final childLabel = node.children
      .map((id) => tree.node(id))
      .whereType<MirrorNode>()
      .where((n) => n.tag == 'text')
      .map((n) => n.text ?? '')
      .join();
  final label = childLabel.isNotEmpty ? childLabel : (node.text ?? '');
  final shorthand = style.borderShorthand;
  return OutlinedButton(
    onPressed: hasTapEvent(node) ? () => dispatchTap(node, dispatch) : null,
    style: OutlinedButton.styleFrom(
      backgroundColor: style.backgroundColor,
      foregroundColor: style.color,
      side: style.borderWidth > 0
          ? BorderSide(color: style.borderColor, width: style.borderWidth)
          : shorthand != null
              ? BorderSide(color: shorthand.color, width: shorthand.width)
              : null,
      padding: style.padding,
      shape: RoundedRectangleBorder(
        borderRadius: style.borderRadius ?? BorderRadius.circular(8),
      ),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        fontFamily: style.fontFamily,
      ),
    ),
  );
}
