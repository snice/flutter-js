import 'package:flutter/material.dart';

import '../mirror_tree.dart';
import '../render/decoration.dart';
import '../render/style.dart';
import '../widgets/dispatch.dart';

typedef FjsNodeBuilder = Widget Function(BuildContext context, MirrorNode node);

class FjsNodeAdapterContext {
  const FjsNodeAdapterContext({
    required this.flutterContext,
    required this.tree,
    required this.node,
    required this.style,
    required this.childNodes,
    required this.buildChildren,
    required this.buildNode,
    required this.dispatch,
    required this.pressed,
    required this.isRoot,
  });

  final BuildContext flutterContext;
  final MirrorTree tree;
  final MirrorNode node;
  final FjsStyle style;
  final List<MirrorNode> childNodes;
  final List<Widget> Function() buildChildren;
  final FjsNodeBuilder buildNode;
  final FjsDispatch dispatch;
  final bool pressed;
  final bool isRoot;
}

abstract class FjsNodeAdapter {
  const FjsNodeAdapter();

  String get tag;

  Widget build(FjsNodeAdapterContext context);

  Widget decorate(FjsNodeAdapterContext context, Widget content) {
    return decorateNode(context.style, content);
  }
}
