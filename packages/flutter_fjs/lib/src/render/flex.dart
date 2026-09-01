// CSS flex/wrap layout mapped onto Flutter's Flex and Wrap. This is the
// skeleton behind `view`, `scroll-view` and `safe-area`, and `positionedChild`
// is the absolute-positioning half that `stack` uses.
//
// Every function here takes the children already built as widgets, plus their
// nodes — the nodes are what carries per-child style (flex-grow, position,
// cross-axis size), which Flutter expresses through parent-side wrappers
// (Expanded, Align, Positioned) rather than on the child itself.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import 'style.dart';

Widget buildFlex(FjsStyle style, List<Widget> kids, List<MirrorNode> kidNodes) {
  final horizontal = (style.flexDirection ?? 'column') == 'row';
  final axis = horizontal ? Axis.horizontal : Axis.vertical;
  // main-axis gap is column-gap on a row, row-gap on a column (as in CSS);
  // `gap` is the shorthand for both
  final gap = horizontal ? style.columnGap : style.rowGap;
  final crossGap = horizontal ? style.rowGap : style.columnGap;
  if (style.flexWrap) {
    // wrapped children lay out run by run, so flexGrow (Expanded) has no
    // meaning here — pass the children through untouched
    return Wrap(
      direction: axis,
      spacing: gap ?? 0,
      runSpacing: crossGap ?? 0,
      alignment: style.wrapAlignment,
      crossAxisAlignment: style.wrapCrossAlignment,
      children: kids,
    );
  }
  final entries = <(Widget, MirrorNode?)>[
    for (var i = 0; i < kids.length; i++) ...[
      if (gap != null && i > 0)
        (
          horizontal ? SizedBox(width: gap) : SizedBox(height: gap),
          null,
        ),
      (kids[i], i < kidNodes.length ? kidNodes[i] : null),
    ],
  ];
  final crossAlignment = style.alignItems ??
      (horizontal ? CrossAxisAlignment.center : CrossAxisAlignment.stretch);
  return Flex(
    direction: axis,
    mainAxisSize: MainAxisSize.min,
    mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
    crossAxisAlignment: crossAlignment,
    textBaseline: TextBaseline.alphabetic,
    children: [
      for (final (child, childNode) in entries)
        _flexChild(
          child: child,
          childNode: childNode,
          horizontal: horizontal,
          stretches: crossAlignment == CrossAxisAlignment.stretch,
        ),
    ],
  );
}

Widget _flexChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required bool stretches,
}) {
  if (childNode == null) return child;
  final s = FjsStyle(childNode.props);
  // absolutely-positioned children are out of flow; never expand them
  if (s.position == 'absolute') return child;
  Widget out = child;
  // CSS `align-items: stretch` only stretches items that have no size of
  // their own on the cross axis, but Flutter's CrossAxisAlignment.stretch
  // passes a tight cross constraint to every child. An Align absorbs that
  // constraint so an explicit width (column) / height (row) survives.
  final crossSized = horizontal ? s.height != null : s.width != null;
  if (stretches && crossSized) {
    out = Align(
      alignment: AlignmentDirectional.topStart,
      widthFactor: horizontal ? 1 : null,
      heightFactor: horizontal ? null : 1,
      child: out,
    );
  }
  final grow = s.flexGrow;
  if (grow != null && grow > 0) {
    return Expanded(flex: grow.round().clamp(1, 9999), child: out);
  }
  return out;
}

/// Wraps a stack child in [Positioned] when it asks for absolute layout.
/// Takes the child's node directly: `kids` is built from the filtered
/// [kidNodes], so indexing back into `node.children` would misalign
/// whenever a hidden child was dropped.
Widget positionedChild(MirrorNode? childNode, Widget child) {
  final s = childNode != null ? FjsStyle(childNode.props) : null;
  if (s?.position != 'absolute') return child;
  return Positioned(
    key: ValueKey<int>(childNode!.id),
    left: s!.left,
    top: s.top,
    right: s.right,
    bottom: s.bottom,
    width: s.width,
    height: s.height,
    child: child,
  );
}
