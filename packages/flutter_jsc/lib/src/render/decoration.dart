// The box every tag's content is wrapped in: padding, explicit size,
// background/border/shadow, clipping, opacity and margin — in the order CSS
// applies them.
import 'package:flutter/material.dart';

import 'style.dart';

/// Applies [style]'s box properties to [content].
Widget decorateNode(FjsStyle style, Widget content) {
  Widget w = content;
  if (style.padding != null) w = Padding(padding: style.padding!, child: w);
  final shorthand = style.borderShorthand;
  final border = style.borderWidth > 0
      ? Border.all(color: style.borderColor, width: style.borderWidth)
      : shorthand != null
          ? Border.all(color: shorthand.color, width: shorthand.width)
          : null;
  if (style.hasDecoration) {
    w = Container(
      width: style.width,
      height: style.height,
      decoration: BoxDecoration(
        color: style.gradient == null ? style.backgroundColor : null,
        gradient: style.gradient,
        borderRadius: style.borderRadius,
        border: border,
        boxShadow: style.boxShadows,
      ),
      child: w,
    );
  } else if (style.width != null || style.height != null) {
    w = SizedBox(width: style.width, height: style.height, child: w);
  }
  final constraints = style.constraints;
  if (constraints != null)
    w = ConstrainedBox(constraints: constraints, child: w);
  if (style.overflowHidden) {
    w = style.borderRadius != null
        ? ClipRRect(borderRadius: style.borderRadius!, child: w)
        : ClipRect(child: w);
  }
  if (style.opacity != null) w = Opacity(opacity: style.opacity!, child: w);
  // margin sits OUTSIDE the sized/decorated box, as in CSS: it must not eat
  // into width/height, the background must not paint through it, and the
  // overflow clip stays aligned with the box's own corners
  if (style.margin != null) w = Padding(padding: style.margin!, child: w);
  return w;
}
