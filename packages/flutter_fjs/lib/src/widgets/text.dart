// `text` tag -> Text. Resolves the CSS text properties that need the node's
// own font size to make sense (a unitless line-height is a multiplier, an
// absolute one has to be divided by the font size for Flutter's `height`).
//
// A `text` nested in a `text` is a SPAN of the outer one, laid out inline in
// the same paragraph (specs/034-rich-text §3.5) — the web adapter's twin is
// base-css.ts's `text text { display: inline }`. Anything else nested in a
// text (an image, a view) is an inline-block box on the same line.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/renderer.dart';
import '../render/style.dart';
import '../render/style_parse.dart';

// Default line height. Flutter would otherwise use the font's own metrics
// and CSS its `normal` — two different numbers, so a two-line row came out
// noticeably taller here than on the web adapter. Both sides now pin the
// same multiplier (see BASE_CSS's `text` rule).
const _defaultLineHeight = 1.4;
const _defaultFontSize = 14.0;

/// The TextStyle of one text node. [span] adds what only an inline box
/// paints with its text (a background behind the glyphs); a paragraph's own
/// background is its box decoration, drawn by decorateNode.
TextStyle fjsTextStyle(FjsStyle style, {bool span = false}) {
  final lineHeight = style.lineHeightMultiplier ??
      () {
        final abs = style.lineHeightAbsolute;
        if (abs == null) return null;
        final fs = style.fontSize;
        return fs != null && fs > 0 ? abs / fs : null;
      }();
  return TextStyle(
    // Unstyled text is the web adapter's `body` rule — 14px #333333 —
    // not Flutter's inherited DefaultTextStyle. Anything the cascade did
    // resolve (including a color inherited from an ancestor, which the JS
    // style engine folds into this node's own style) still wins.
    color: style.color ?? const Color(0xFF333333),
    fontSize: style.fontSize ?? _defaultFontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontFamily: style.fontFamily,
    height: lineHeight ?? _defaultLineHeight,
    // CSS puts the extra leading half above / half below the text; Flutter
    // puts all of it above unless told otherwise.
    leadingDistribution: TextLeadingDistribution.even,
    letterSpacing: style.letterSpacing,
    decoration: style.textDecoration,
    shadows: style.textShadows,
    backgroundColor: span ? style.backgroundColor : null,
  );
}

/// [childNodes] are the visible children the renderer already collected;
/// [tree] resolves deeper spans; [buildNode] builds a non-text child as a
/// regular node view (its own decoration, press state and signals).
Widget buildText(
  MirrorNode node,
  FjsStyle style, {
  MirrorTree? tree,
  List<MirrorNode> childNodes = const [],
  Widget Function(MirrorNode node)? buildNode,
}) {
  final textAlign = style.textAlign;
  final maxLines = style.whiteSpaceNowrap ? 1 : style.maxLines;
  final overflow = style.overflow;

  // The common case — `<text>{{ x }}</text>` compiles to element text, no
  // child nodes — stays a plain Text.
  if (childNodes.isEmpty || tree == null) {
    return Text(
      _transformed(style, node.text ?? ''),
      style: fjsTextStyle(style),
      textAlign: textAlign,
      maxLines: maxLines,
      overflow: overflow,
    );
  }

  final spans = <InlineSpan>[
    if (node.text != null && node.text!.isNotEmpty)
      TextSpan(text: _transformed(style, node.text!)),
    for (final kid in childNodes) _span(tree, kid, style, buildNode),
  ];
  // Paragraph-level properties (align, line clamp, nowrap) come from this
  // node only: a span has no box to align or clamp.
  return Text.rich(
    TextSpan(style: fjsTextStyle(style), children: spans),
    textAlign: textAlign,
    maxLines: maxLines,
    overflow: overflow,
  );
}

String _transformed(FjsStyle style, String data) =>
    style.textTransform != null ? transformText(style.textTransform, data)! : data;

/// One child of a paragraph.
///
/// Spans are built from the child MirrorNodes directly, not from the child
/// node views: a TextSpan is not a widget, so a child's own view could not
/// sit inside the paragraph anyway, and a paragraph is laid out in one pass.
/// The price is that a change to a deep span must rebuild the paragraph
/// root — mirror_tree.dart's dirty marking walks up text ancestors for that.
InlineSpan _span(
  MirrorTree tree,
  MirrorNode kid,
  FjsStyle parent,
  Widget Function(MirrorNode node)? buildNode,
) {
  if (kid.tag != 'text') {
    // An inline-block box, its bottom edge on the baseline — what CSS does
    // with an <img> in a line (an image has no baseline of its own).
    return WidgetSpan(
      alignment: PlaceholderAlignment.baseline,
      baseline: TextBaseline.alphabetic,
      child: buildNode?.call(kid) ?? const SizedBox.shrink(),
    );
  }

  final style = FjsStyle.of(kid);
  assert(() {
    _warnBoxOnSpan(style);
    return true;
  }());

  final grandKids = <MirrorNode>[
    for (final id in kid.children)
      if (tree.node(id) case final n? when !FjsNodeRenderer.isHidden(n)) n,
  ];
  // A node the style engine never styled (a bare run with nothing to
  // inherit) takes its enclosing span's style. fjsTextStyle would pin the
  // 14px #333333 defaults instead, turning a run inside `<b style="color:
  // red">` back to grey.
  final textStyle = style.style.isEmpty && kid.props['style'] == null
      ? null
      : fjsTextStyle(style, span: true);
  final content = TextSpan(
    text: kid.text == null || kid.text!.isEmpty ? null : _transformed(style, kid.text!),
    style: textStyle,
    children: grandKids.isEmpty
        ? null
        : [for (final n in grandKids) _span(tree, n, style, buildNode)],
  );

  final align = style.verticalAlign;
  if (align == 'sub' || align == 'super') {
    // TextSpan has no baseline shift, so a sub/superscript is a small
    // paragraph of its own, moved off the baseline. Chrome shifts `super`
    // up by a third of the PARENT's font size and `sub` down by a fifth;
    // the same fractions here keep the two sides looking alike. The
    // translation is paint-only, so the line box does not grow the way a
    // browser's does — close enough for footnote marks and exponents, and
    // it cannot wrap inside, which a span this short never needs.
    final parentSize = parent.fontSize ?? _defaultFontSize;
    final dy = align == 'super' ? -parentSize / 3 : parentSize / 5;
    return WidgetSpan(
      alignment: PlaceholderAlignment.baseline,
      baseline: TextBaseline.alphabetic,
      child: Transform.translate(
        offset: Offset(0, dy),
        child: Text.rich(content),
      ),
    );
  }
  return content;
}

bool _warnedBoxOnSpan = false;

/// An inline box has no margin / padding / border / size here, and the web
/// adapter forces the same (base-css.ts) — say so once instead of dropping
/// them without a word (constitution V).
void _warnBoxOnSpan(FjsStyle style) {
  if (_warnedBoxOnSpan) return;
  if (style.margin != null ||
      style.padding != null ||
      style.border != null ||
      style.widthLength != null ||
      style.heightLength != null) {
    _warnedBoxOnSpan = true;
    debugPrint('[fjs] a <text> nested in a <text> is an inline span: its '
        'margin / padding / border / width / height are ignored');
  }
}
