// `button` tag -> TextButton with Material's own chrome disabled.
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
  final enabled = hasTapEvent(node);
  return TextButton(
    onPressed: enabled ? () => dispatchTap(node, dispatch) : null,
    style: TextButton.styleFrom(
      foregroundColor: style.color ?? _defaultForeground,
      padding: EdgeInsets.zero,
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      textStyle: const TextStyle(fontWeight: FontWeight.w400),
      // Press feedback is the Stack mask below, driven by pointer-down —
      // Material's own overlay waits for the tap recognizer to win the
      // arena (`kPressTimeout`), so a quick tap painted nothing. Keep
      // InkWell visually inert.
      animationDuration: Duration.zero,
    ).copyWith(
      overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      splashFactory: NoSplash.splashFactory,
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

/// Test hook: the default press mask is present iff the button is down.
const fjsButtonPressMaskKey = ValueKey<String>('fjs-button-press-mask');

/// `.fjs-button`'s default color in the web base stylesheet.
const _defaultForeground = Color(0xFF007AFF);
const _pressedMask = Color(0x1A000000); // rgba(0, 0, 0, 0.1)

const fjsButtonDefaultPadding =
    EdgeInsets.symmetric(horizontal: 16, vertical: 10);
final fjsButtonDefaultBorderRadius = BorderRadius.circular(8);

Decoration? fjsButtonForegroundDecoration(FjsStyle style, bool active) {
  if (!active) return null;
  return BoxDecoration(
    color: _pressedMask,
    borderRadius: style.borderRadius ?? fjsButtonDefaultBorderRadius,
  );
}
