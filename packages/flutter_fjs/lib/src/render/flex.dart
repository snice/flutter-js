// CSS flex/wrap layout mapped onto Flutter's Flex and Wrap. This is the
// skeleton behind `view`, `scroll-view` and `safe-area`; `buildBox` adds the
// absolute-positioning half, which any box turns on with
// `position: relative`.
//
// Every function here takes the children already built as widgets, plus their
// nodes — the nodes are what carries per-child style (flex-grow, position,
// cross-axis size), which Flutter expresses through parent-side wrappers
// (Expanded, Align, Positioned) rather than on the child itself.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import 'cull.dart';
import 'style.dart';

/// [growChildren] is the page root's rule: its children fill it even
/// without saying `flex-grow`, which is what the web stylesheet does with
/// `fjs-page-entry > * { flex: 1 1 0% }`. Without it the root column hands
/// a child that never asked to grow an *unbounded* height — and the app
/// shell inside, whose middle area does ask, cannot resolve it.
///
/// [cull] swaps the [Flex] for one that skips painting children outside the
/// clip. Only a scroller turns it on: everywhere else there is no clip to
/// cull against, so it would be per-child arithmetic for nothing. See
/// [FjsCullingFlex] for what it does and does not change.
Widget buildFlex(
  FjsStyle style,
  List<Widget> kids,
  List<MirrorNode> kidNodes, {
  bool growChildren = false,
  bool cull = false,
}) {
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
  final children = [
    for (final (child, childNode) in entries)
      _flexChild(
        child: child,
        childNode: childNode,
        horizontal: horizontal,
        stretches: crossAlignment == CrossAxisAlignment.stretch,
        defaultGrow: growChildren ? 1 : null,
      ),
  ];
  if (cull) {
    return FjsCullingFlex(
      direction: axis,
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
      crossAxisAlignment: crossAlignment,
      textBaseline: TextBaseline.alphabetic,
      children: children,
    );
  }
  return Flex(
    direction: axis,
    mainAxisSize: MainAxisSize.min,
    mainAxisAlignment: style.justifyContent ?? MainAxisAlignment.start,
    crossAxisAlignment: crossAlignment,
    textBaseline: TextBaseline.alphabetic,
    children: children,
  );
}

/// Wraps one flex child.
///
/// Every wrapper carries the child's own key. A wrapper is what the parent's
/// element reconciles against, so an unkeyed one makes Flutter match children
/// by POSITION: after a reorder, position 0 holds a different node than
/// before, `canUpdate` fails on the mismatched keys inside, and the whole
/// subtree is rebuilt from scratch. Keying the wrapper is what lets a move
/// stay a move.
Widget _flexChild({
  required Widget child,
  required MirrorNode? childNode,
  required bool horizontal,
  required bool stretches,
  int? defaultGrow,
}) {
  if (childNode == null) {
    return defaultGrow == null
        ? child
        : Expanded(flex: defaultGrow, child: child);
  }
  final key = ValueKey<int>(childNode.id);
  final s = FjsStyle.of(childNode);
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
      key: key,
      alignment: AlignmentDirectional.topStart,
      widthFactor: horizontal ? 1 : null,
      heightFactor: horizontal ? null : 1,
      child: out,
    );
  }
  final grow = s.flexGrow ?? defaultGrow?.toDouble();
  if (grow != null && grow > 0) {
    return Expanded(
      key: identical(out, child) ? key : null,
      flex: grow.round().clamp(1, 9999),
      child: out,
    );
  }
  return out;
}

/// A box whose in-flow children lay out as flex and whose
/// absolutely-positioned ones sit over the top — CSS's positioned
/// containing block, which is what `view { position: relative }` is. Only a
/// positioned box is one (again CSS): elsewhere `position: absolute` on a
/// child means "some ancestor", which this side does not chase, so the
/// child stays in flow.
///
Widget buildBox(
  FjsStyle style,
  List<Widget> kids,
  List<MirrorNode> kidNodes, {
  bool growChildren = false,
  bool cull = false,
}) {
  if (!style.isPositioningContext) {
    return buildFlex(style, kids, kidNodes,
        growChildren: growChildren, cull: cull);
  }
  final flow = <Widget>[];
  final flowNodes = <MirrorNode>[];
  final over = <Widget>[];
  for (var i = 0; i < kids.length; i++) {
    final childNode = i < kidNodes.length ? kidNodes[i] : null;
    if (childNode != null && FjsStyle.of(childNode).position == 'absolute') {
      over.add(positionedChild(childNode, kids[i]));
      continue;
    }
    flow.add(kids[i]);
    if (childNode != null) flowNodes.add(childNode);
  }
  if (over.isEmpty) {
    return buildFlex(style, kids, kidNodes,
        growChildren: growChildren, cull: cull);
  }
  return Stack(
    // the box sizes to its in-flow content, and a positioned child may hang
    // outside it (`top: -4px`) exactly like it does on web
    clipBehavior: Clip.none,
    children: [
      // a positioned child may hang outside the flow box, so the flow half
      // keeps culling but the Stack as a whole is left alone
      buildFlex(style, flow, flowNodes,
          growChildren: growChildren, cull: cull),
      ...over,
    ],
  );
}

/// Wraps a child in [Positioned] when it asks for absolute layout.
/// Takes the child's node directly: `kids` is built from the filtered
/// [kidNodes], so indexing back into `node.children` would misalign
/// whenever a hidden child was dropped.
Widget positionedChild(MirrorNode? childNode, Widget child) {
  final s = childNode != null ? FjsStyle.of(childNode) : null;
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
