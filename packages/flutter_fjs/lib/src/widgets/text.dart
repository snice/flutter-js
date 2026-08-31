// `text` tag -> Text. Resolves the CSS text properties that need the node's
// own font size to make sense (a unitless line-height is a multiplier, an
// absolute one has to be divided by the font size for Flutter's `height`).
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/style.dart';
import '../render/style_parse.dart';

Widget buildText(MirrorNode node, FjsStyle style, List<Widget> kids) {
  final data = node.text ??
      (kids.isNotEmpty
          ? (kids.first is Text ? (kids.first as Text).data ?? '' : '')
          : '');
  final transformed = style.textTransform != null
      ? transformText(style.textTransform, data)!
      : data;
  // Default line height. Flutter would otherwise use the font's own metrics
  // and CSS its `normal` — two different numbers, so a two-line row came out
  // noticeably taller here than on the web adapter. Both sides now pin the
  // same multiplier (see BASE_CSS's `text` rule).
  const defaultLineHeight = 1.4;
  final lineHeight = style.lineHeightMultiplier ??
      () {
        final abs = style.lineHeightAbsolute;
        if (abs == null) return null;
        final fs = style.fontSize;
        return fs != null && fs > 0 ? abs / fs : null;
      }();
  return Text(
    transformed,
    style: TextStyle(
      // Unstyled text is the web adapter's `body` rule — 14px #333333 —
      // not Flutter's inherited DefaultTextStyle. Anything the cascade did
      // resolve (including a color inherited from an ancestor, which the JS
      // style engine folds into this node's own style) still wins.
      color: style.color ?? const Color(0xFF333333),
      fontSize: style.fontSize ?? 14,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontFamily: style.fontFamily,
      height: lineHeight ?? defaultLineHeight,
      // CSS puts the extra leading half above / half below the text; Flutter
      // puts all of it above unless told otherwise.
      leadingDistribution: TextLeadingDistribution.even,
      letterSpacing: style.letterSpacing,
      decoration: style.textDecoration,
      shadows: style.textShadows,
    ),
    textAlign: style.textAlign,
    maxLines: style.whiteSpaceNowrap ? 1 : style.maxLines,
    overflow: style.overflow,
  );
}
