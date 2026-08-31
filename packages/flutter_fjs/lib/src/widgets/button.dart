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
  FjsDispatch dispatch, {
  bool pressed = false,
}) {
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
  final radius = style.borderRadius ?? BorderRadius.circular(8);
  final enabled = hasTapEvent(node);
  final button = OutlinedButton(
    onPressed: enabled ? () => dispatchTap(node, dispatch) : null,
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
      shape: RoundedRectangleBorder(borderRadius: radius),
      // Material would pad the button out to a 48dp tap target and hold a
      // 64dp minimum width; CSS sizes it from padding + label alone.
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
  // WeUI `--weui-BTN-ACTIVE-MASK` / web `.fjs-button:active::after`:
  // 10% black the instant the finger is down. Painted as a foreground
  // on the button's own box — a Stack+Positioned.fill would take the
  // stretched width of a column and leave the button shrink-wrapped
  // in the corner. Disabled buttons skip it (`:active:not(:disabled)`).
  return Container(
    key: pressed && enabled ? fjsButtonPressMaskKey : null,
    foregroundDecoration: pressed && enabled
        ? BoxDecoration(color: _pressedMask, borderRadius: radius)
        : null,
    child: button,
  );
}

/// Test hook: the default press mask is present iff the button is down.
const fjsButtonPressMaskKey = ValueKey<String>('fjs-button-press-mask');

/// `.fjs-button`'s `color` and `border` in the web base stylesheet.
const _defaultForeground = Color(0xFF007AFF);
const _defaultBorder = Color(0x29000000); // rgba(0, 0, 0, 0.16)
const _pressedMask = Color(0x1A000000); // rgba(0, 0, 0, 0.1)
