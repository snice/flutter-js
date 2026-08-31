// `list-view` tag -> ListView.builder, plus the onScroll offset reporting the
// JS-side virtual list drives itself from.
import 'package:flutter/material.dart';

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/style.dart';
import 'dispatch.dart';

class FjsListView extends StatefulWidget {
  const FjsListView({
    super.key,
    required this.node,
    required this.style,
    required this.items,
    required this.buildItem,
    required this.dispatch,
  });

  final MirrorNode node;
  final FjsStyle style;
  final List<MirrorNode> items;
  final Widget Function(BuildContext context, MirrorNode item) buildItem;
  final FjsDispatch dispatch;

  @override
  State<FjsListView> createState() => _FjsListViewState();
}

class _FjsListViewState extends State<FjsListView> {
  bool _scrollQueued = false;
  double _lastOffset = -1;
  double _lastSentOffset = -1;

  bool _onScroll(ScrollNotification notification) {
    if (widget.node.props['onScroll'] != true ||
        notification.metrics.axis != widget.style.scrollDirection) {
      return false;
    }
    _lastOffset = notification.metrics.pixels;
    if ((_lastOffset - _lastSentOffset).abs() < 0.5) return false;
    if (_scrollQueued) return false;
    _scrollQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollQueued = false;
      if (!mounted) return;
      if ((_lastOffset - _lastSentOffset).abs() < 0.5) return;
      _lastSentOffset = _lastOffset;
      widget.dispatch(
        widget.node.id,
        FjsEvent.scroll,
        text: _lastOffset.toStringAsFixed(1),
      );
    });
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final indexByKey = <String, int>{
      for (var index = 0; index < widget.items.length; index++)
        'fjs-list-item-${widget.items[index].id}': index,
    };
    return NotificationListener<ScrollNotification>(
      onNotification: _onScroll,
      child: ListView.builder(
        scrollDirection: widget.style.scrollDirection,
        itemCount: widget.items.length,
        // The JS virtual-list window replaces its leading/trailing spacers
        // and rows as the offset changes. Give Sliver stable node keys so it
        // relocates existing render boxes instead of retaining them by their
        // old list index (which otherwise leaves a blank viewport mid-scroll).
        findChildIndexCallback: (key) =>
            key is ValueKey<String> ? indexByKey[key.value] : null,
        itemBuilder: (context, index) {
          final item = widget.items[index];
          return KeyedSubtree(
            key: ValueKey<String>('fjs-list-item-${item.id}'),
            child: widget.buildItem(context, item),
          );
        },
      ),
    );
  }
}
