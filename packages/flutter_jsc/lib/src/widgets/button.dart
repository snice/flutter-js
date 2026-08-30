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
      // The defaults below are the .fjs-button rule in the web adapter's
      // base stylesheet, not Material's — a button has to look the same on
      // both platforms before the page styles it. Anything the page does set
      // still wins.
      foregroundColor: style.color ?? _defaultForeground,
      side: style.borderWidth > 0
          ? BorderSide(color: style.borderColor, width: style.borderWidth)
          : shorthand != null
              ? BorderSide(color: shorthand.color, width: shorthand.width)
              // `border-color` on its own is a 1px border in CSS
              : BorderSide(
                  color: style.declaredBorderColor ?? _defaultBorder,
                  width: 1,
                ),
      padding: style.padding ??
          const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      shape: RoundedRectangleBorder(
        borderRadius: style.borderRadius ?? BorderRadius.circular(8),
      ),
      // Material would pad the button out to a 48dp tap target and hold a
      // 64dp minimum width; CSS sizes it from padding + label alone.
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      textStyle: const TextStyle(fontWeight: FontWeight.w400),
    ),
    child: Text(
      label,
      style: TextStyle(
        fontSize: style.fontSize ?? 14,
        fontWeight: style.fontWeight ?? FontWeight.w400,
        fontStyle: style.fontStyle,
        fontFamily: style.fontFamily,
        height: 1.4,
        leadingDistribution: TextLeadingDistribution.even,
      ),
    ),
  );
}

/// `.fjs-button`'s `color` and `border` in the web base stylesheet.
const _defaultForeground = Color(0xFF007AFF);
const _defaultBorder = Color(0x29000000); // rgba(0, 0, 0, 0.16)
