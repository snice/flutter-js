// `scroll-view` tag -> SingleChildScrollView plus the properties that need a
// controller: scroll-top / scroll-left, scroll-into-view, the @scroll report
// and the two edge events.
//
// A scroll-view whose direct children include sticky-header / sticky-section
// (specs/052) takes the `slivers` route instead: a CustomScrollView whose
// slivers are the sticky split (widgets/sticky.dart). Everything else — the
// controller, the edge events, the @scroll report — is shared between the
// two routes.
//
// The scrolling SEMANTICS are not decided here — they are written once in
// fjs-runtime/src/scroll/metrics.ts and mirrored in
// render/scroll_metrics.dart, so the web adapter and this widget agree on
// the payload's shape and on when an edge counts as "reached".
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderViewport;

import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import '../render/cull.dart' show fjsScrollerMoved;
import '../render/image_visibility.dart' show scheduleFjsImageVisibilityRefresh;
import '../render/scroll_metrics.dart';
import '../render/style.dart';
import 'control_scope.dart' show fjsWarnOnce;
import 'dispatch.dart';
import 'scroll_behavior.dart';

class FjsScrollView extends StatefulWidget {
  const FjsScrollView({
    super.key,
    required this.node,
    required this.tree,
    required this.style,
    required this.dispatch,
    this.child,
    this.slivers,
    this.stickyHeaderIds = const <int>[],
  })  : assert(child != null || slivers != null),
        assert(
          slivers == null || child == null,
          'a scroll view is either box-content or slivers, not both',
        );

  final MirrorNode node;
  final MirrorTree tree;
  final FjsStyle style;
  final FjsDispatch dispatch;

  /// The whole scroll content (the non-sticky route).
  final Widget? child;

  /// The sticky route's sliver list; built by widgets/sticky.dart.
  final List<Widget>? slivers;

  /// sticky-header node ids living in [slivers], probed after every scroll
  /// frame for the @stickontopchange flip.
  final List<int> stickyHeaderIds;

  @override
  State<FjsScrollView> createState() => _FjsScrollViewState();
}

class _FjsScrollViewState extends State<FjsScrollView> {
  final ScrollController _controller = ScrollController();

  /// Last position the PAGE asked for. Like input's `_lastPropValue`: a
  /// prop that has not changed must not yank the scroller back while the
  /// user's finger is on it.
  double? _lastRequestedOffset;
  String? _lastRequestedView;

  FjsScrollEdge? _edge;
  bool _scrollQueued = false;
  double _pendingOffset = 0;
  double _lastReported = 0;
  ScrollMetrics? _pendingMetrics;
  bool _stickyQueued = false;

  /// Per-header pin state. null = not primed yet: like the edge events, the
  /// initial state is registered silently — a header that opens pinned has
  /// not "stuck", the user just has not scrolled (web/sticky.ts measures the
  /// same way).
  final Map<int, bool?> _stickyStuck = <int, bool?>{};

  /// `scroll-x` / `scroll-y` beat the `direction` style key (spec Q1: the
  /// two live in different layers, so both keep working).
  Axis get _axis {
    final x = fjsBool(widget.node.props['scrollX']);
    final y = fjsBool(widget.node.props['scrollY']);
    if (x && y) {
      fjsWarnOnce(
        'scroll-both-axes:${widget.node.id}',
        '<scroll-view> node ${widget.node.id} sets both scroll-x and '
        'scroll-y; fjs scrolls vertically. Pick one.',
      );
      return Axis.vertical;
    }
    if (x) return Axis.horizontal;
    if (y) return Axis.vertical;
    return widget.style.scrollDirection;
  }

  bool get _horizontal => _axis == Axis.horizontal;

  double? _numProp(String key) {
    final raw = widget.node.props[key];
    if (raw is num) return raw.toDouble();
    return double.tryParse('${raw ?? ''}');
  }

  double get _upperThreshold =>
      _numProp('upperThreshold') ?? fjsDefaultScrollThreshold;
  double get _lowerThreshold =>
      _numProp('lowerThreshold') ?? fjsDefaultScrollThreshold;
  bool get _animated => widget.node.props['scrollWithAnimation'] == true ||
      widget.node.props['scrollWithAnimation'] == '';

  @override
  void didUpdateWidget(covariant FjsScrollView oldWidget) {
    super.didUpdateWidget(oldWidget);
    WidgetsBinding.instance.addPostFrameCallback((_) => _applyProps());
  }

  @override
  void initState() {
    super.initState();
    if (widget.slivers != null && _horizontal) {
      fjsWarnOnce(
        'sticky-horizontal:${widget.node.id}',
        '<scroll-view> node ${widget.node.id}: sticky-header / '
        'sticky-section only pin along the vertical axis.',
      );
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _applyProps());
  }

  /// True once the edge state has been primed from the first layout.
  bool _edgePrimed = false;

  /// Moves the scroller where the page asked, if it asked for something new.
  void _applyProps() {
    if (!mounted || !_controller.hasClients) return;
    if (!_edgePrimed) {
      _edgePrimed = true;
      // Prime, do not report: opening at the top is not "the user reached
      // the top" (see scroll/metrics.ts).
      final position = _controller.position;
      _edge = fjsEdgeZone(
        offset: position.pixels,
        viewport: position.viewportDimension,
        content: position.maxScrollExtent + position.viewportDimension,
        upperThreshold: _upperThreshold,
        lowerThreshold: _lowerThreshold,
      );
    }
    _probeSticky();
    final target = _numProp(_horizontal ? 'scrollLeft' : 'scrollTop');
    if (target != null && target != _lastRequestedOffset) {
      _lastRequestedOffset = target;
      _moveTo(target.clamp(0, _controller.position.maxScrollExtent));
    }
    final view = widget.node.props['scrollIntoView']?.toString();
    if (view != null && view.isNotEmpty && view != _lastRequestedView) {
      _lastRequestedView = view;
      _scrollIntoView(view);
    }
  }

  void _moveTo(double offset) {
    if (!_controller.hasClients) return;
    if ((offset - _controller.offset).abs() < 0.5) return;
    if (_animated) {
      _controller.animateTo(
        offset,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    } else {
      _controller.jumpTo(offset);
    }
  }

  /// Scrolls the child whose `id` prop matches [id] into view.
  ///
  /// Measured against this scroller's own render box rather than
  /// Scrollable.ensureVisible, which also aligns and animates by its own
  /// rules — the web side computes the same offset by hand for the same
  /// reason.
  void _scrollIntoView(String id) {
    final targetId = _findByDomId(widget.node, id);
    if (targetId == null) {
      fjsWarnOnce(
        'scroll-into-view:${widget.node.id}:$id',
        '<scroll-view> node ${widget.node.id}: scroll-into-view="$id" '
        'matches no descendant id — nothing scrolled.',
      );
      return;
    }
    final targetContext = widget.tree.existingGlobalKey(targetId)?.currentContext;
    if (targetContext == null || !targetContext.mounted) return;
    final box = targetContext.findRenderObject();
    final scroller = this.context.findRenderObject();
    if (box is! RenderBox || scroller is! RenderBox) return;
    final local = box.localToGlobal(Offset.zero, ancestor: scroller);
    final delta = _horizontal ? local.dx : local.dy;
    _moveTo(
      (_controller.offset + delta)
          .clamp(0, _controller.position.maxScrollExtent),
    );
  }

  /// Depth-first search for a descendant carrying this `id` prop.
  int? _findByDomId(MirrorNode from, String id) {
    for (final childId in from.children) {
      final child = widget.tree.node(childId);
      if (child == null) continue;
      if (child.props['id']?.toString() == id) return childId;
      final nested = _findByDomId(child, id);
      if (nested != null) return nested;
    }
    return null;
  }

  /// Reads each sticky header's real painted position once per scroll frame:
  /// stuck ⇔ its box top sits at the viewport's leading edge. Measuring the
  /// paint result — instead of modelling scroll offsets against sliver
  /// extents — means group push-out, push-pinned-header and whatever the
  /// sliver toolkit does next all flip the event for free. The web side
  /// computes the same state from getBoundingClientRect (web/sticky.ts).
  void _probeSticky() {
    if (widget.stickyHeaderIds.isEmpty || !mounted) return;
    final viewport = _findViewport();
    if (viewport == null) return;
    for (final id in widget.stickyHeaderIds) {
      final ctx = widget.tree.existingGlobalKey(id)?.currentContext;
      final ro = ctx?.findRenderObject();
      if (ro is! RenderBox || !ro.attached) continue;
      final dy = ro.localToGlobal(Offset.zero, ancestor: viewport).dy;
      final stuck = dy.abs() < 0.5;
      if (_stickyStuck[id] == null) {
        _stickyStuck[id] = stuck;
        continue;
      }
      if (_stickyStuck[id] == stuck) continue;
      _stickyStuck[id] = stuck;
      // The @stickontopchange handler lives on the HEADER node, not on the
      // scroll-view that probes it.
      final header = widget.tree.node(id);
      if (header != null && header.props['onStickontopchange'] == true) {
        widget.dispatch(
          id,
          FjsEvent.stickOnTopChange,
          text: '{"isStickOnTop":$stuck}',
        );
      }
    }
  }

  RenderViewport? _findViewport() {
    RenderViewport? found;
    void visit(RenderObject obj) {
      if (found != null) return;
      if (obj is RenderViewport) {
        found = obj;
        return;
      }
      obj.visitChildren(visit);
    }

    final ro = context.findRenderObject();
    if (ro != null) visit(ro);
    return found;
  }

  bool _onNotification(ScrollNotification notification) {
    if (notification.metrics.axis != _axis) return false;
    if (!_edgePrimed) {
      // The first layout usually primes this (see _applyProps); if a scroll
      // beats it, prime here so the state is never null when an edge is
      // judged — the web adapter primes synchronously on mount for the same
      // reason.
      _edgePrimed = true;
      _edge = fjsEdgeZone(
        offset: notification.metrics.pixels,
        viewport: notification.metrics.viewportDimension,
        content: notification.metrics.maxScrollExtent +
            notification.metrics.viewportDimension,
        upperThreshold: _upperThreshold,
        lowerThreshold: _lowerThreshold,
      );
    }
    // An inner scroller is a repaint boundary, so a flex inside one that
    // culled against THIS window will not repaint on its own (cull.dart).
    fjsScrollerMoved();
    scheduleFjsImageVisibilityRefresh();
    _pendingOffset = notification.metrics.pixels;
    _pendingMetrics = notification.metrics;
    _reportEdges(notification.metrics);
    // The sticky probe is not gated on onScroll: @stickontopchange is its
    // own prop, checked per header inside _probeSticky.
    if (widget.stickyHeaderIds.isNotEmpty && !_stickyQueued) {
      _stickyQueued = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _stickyQueued = false;
        _probeSticky();
      });
    }
    if (widget.node.props['onScroll'] != true) return false;
    // One dispatch per frame, the same rate the web adapter's rAF queue and
    // list_view.dart keep.
    if (_scrollQueued) return false;
    _scrollQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollQueued = false;
      if (!mounted) return;
      _reportScroll();
    });
    return false;
  }

  void _reportScroll() {
    final metrics = _pendingMetrics;
    if (metrics == null) return;
    final delta = _pendingOffset - _lastReported;
    if (delta.abs() < 0.5) return;
    _lastReported = _pendingOffset;
    final extent = metrics.maxScrollExtent + metrics.viewportDimension;
    widget.dispatch(
      widget.node.id,
      FjsEvent.scroll,
      text: fjsScrollPayload(
        scrollTop: _horizontal ? 0 : _pendingOffset,
        scrollLeft: _horizontal ? _pendingOffset : 0,
        scrollHeight: _horizontal ? 0 : extent,
        scrollWidth: _horizontal ? extent : 0,
        deltaX: _horizontal ? delta : 0,
        deltaY: _horizontal ? 0 : delta,
      ),
    );
  }

  void _reportEdges(ScrollMetrics metrics) {
    final step = fjsEdgeTransition(
      _edge,
      offset: metrics.pixels,
      viewport: metrics.viewportDimension,
      content: metrics.maxScrollExtent + metrics.viewportDimension,
      upperThreshold: _upperThreshold,
      lowerThreshold: _lowerThreshold,
    );
    _edge = step.state;
    final edge = step.emit;
    if (edge == null) return;
    final prop = edge == FjsScrollEdge.upper
        ? 'onScrolltoupper'
        : 'onScrolltolower';
    if (widget.node.props[prop] != true) return;
    widget.dispatch(
      widget.node.id,
      edge == FjsScrollEdge.upper
          ? FjsEvent.scrollToUpper
          : FjsEvent.scrollToLower,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scroller = widget.slivers != null
        ? CustomScrollView(
            controller: _controller,
            // Node-scoped storage bucket: a scroller replaced on the JS side
            // starts at the top instead of inheriting the previous one's
            // offset.
            key: PageStorageKey<String>(
              'fjs-scroll-${widget.tree.generation}-${widget.node.id}',
            ),
            scrollDirection: _axis,
            slivers: widget.slivers!,
          )
        : SingleChildScrollView(
            controller: _controller,
            // Node-scoped storage bucket: a scroller replaced on the JS side
            // starts at the top instead of inheriting the previous one's
            // offset.
            key: PageStorageKey<String>(
              'fjs-scroll-${widget.tree.generation}-${widget.node.id}',
            ),
            scrollDirection: _axis,
            child: widget.child,
          );
    return NotificationListener<ScrollNotification>(
      onNotification: _onNotification,
      child: ScrollConfiguration(
        behavior: const FjsMouseDragScrollBehavior(),
        child: scroller,
      ),
    );
  }
}
