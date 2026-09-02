// The box every tag's content is wrapped in: padding, explicit size,
// background/border/shadow, clipping and margin — in the order CSS
// applies them.
import 'dart:async' show Timer;

import 'package:flutter/material.dart';
import 'package:vector_math/vector_math_64.dart' show Matrix4;

import 'dashed_border.dart';
import 'style.dart';
import 'style_parse.dart';

/// Applies [style]'s box properties to [content].
Widget decorateNode(
  FjsStyle style,
  Widget content, {
  EdgeInsets? defaultPadding,
  BorderRadius? defaultBorderRadius,
  Decoration? foregroundDecoration,
  Key? foregroundKey,
}) {
  Widget w = content;
  final padding = style.padding ?? defaultPadding;
  if (padding != null) w = Padding(padding: padding, child: w);
  final side = style.border;
  // A dashed / dotted one is painted over the box instead of being part of
  // the decoration ([Border] only strokes solid), so it has to reserve its
  // own room — BoxDecoration.border does that for the solid case.
  final dashed = side != null && side.kind != FjsBorderStyle.solid ? side : null;
  if (dashed != null) {
    w = Padding(padding: EdgeInsets.all(dashed.width), child: w);
  }
  final border = side == null || dashed != null
      ? null
      : Border.all(color: side.color, width: side.width);
  final borderRadius = style.borderRadius ?? defaultBorderRadius;
  if (style.hasDecoration || border != null || foregroundDecoration != null) {
    w = Container(
      key: foregroundKey,
      width: style.width,
      height: style.height,
      decoration: BoxDecoration(
        color: style.gradient == null ? style.backgroundColor : null,
        gradient: style.gradient,
        borderRadius: borderRadius,
        border: border,
        boxShadow: style.boxShadows,
      ),
      foregroundDecoration: foregroundDecoration,
      child: w,
    );
  } else if (style.width != null || style.height != null) {
    w = SizedBox(width: style.width, height: style.height, child: w);
  }
  if (dashed != null) {
    w = CustomPaint(
      foregroundPainter: FjsDashedBorderPainter(
        width: dashed.width,
        color: dashed.color,
        kind: dashed.kind,
        borderRadius: borderRadius,
      ),
      child: w,
    );
  }
  final constraints = style.constraints;
  if (constraints != null)
    w = ConstrainedBox(constraints: constraints, child: w);
  if (style.overflowHidden) {
    w = borderRadius != null
        ? ClipRRect(borderRadius: borderRadius, child: w)
        : ClipRect(child: w);
  }
  // margin sits OUTSIDE the sized/decorated box, as in CSS: it must not eat
  // into width/height, the background must not paint through it, and the
  // overflow clip stays aligned with the box's own corners
  if (style.margin != null) w = Padding(padding: style.margin!, child: w);
  return w;
}

/// Applies `transform` — the outermost wrapper a node gets, so it moves the
/// input layers with the paint the way CSS does: the finger keeps holding
/// the block it picked up. Layout is untouched, which is the point — a
/// translate costs a repaint, not a relayout, and that is what a drag can
/// afford every frame. The origin is the box centre, CSS's default.
///
/// [stable] keeps the wrapper in the tree even with no transform declared.
/// A node that gains one mid-gesture would otherwise change the shape of
/// the widget chain above its pointer listener, which rebuilds the listener
/// from scratch — dropping the very drag that set the transform. Nodes that
/// can be dragged (the ones with touch handlers) therefore always carry the
/// wrapper; the rest only pay for it once they ask for a transform.
Widget transitionNode(
  FjsStyle style,
  Widget content, {
  required Object? key,
  bool stableTransform = false,
}) {
  final transitions = style.transitions;
  final transformTrack = transitions?.forProperty('transform');
  final opacityTrack = transitions?.forProperty('opacity');
  final transform = style.transform ?? Matrix4.identity();
  final opacity = style.opacity ?? 1.0;
  final wantsTransform = stableTransform ||
      style.transform != null ||
      (transformTrack != null && transformTrack.duration > Duration.zero);
  final wantsOpacity = style.opacity != null ||
      (opacityTrack != null && opacityTrack.duration > Duration.zero);
  final animatesTransform = transformTrack != null &&
      transformTrack.duration > Duration.zero &&
      wantsTransform;
  final animatesOpacity = opacityTrack != null &&
      opacityTrack.duration > Duration.zero &&
      wantsOpacity;

  if (transitions?.hasAnimatedTrack != true &&
      !wantsTransform &&
      !wantsOpacity) {
    return content;
  }
  return _TransitionNode(
    key: key == null ? null : ValueKey<Object>(key),
    transform: transform,
    opacity: opacity,
    transformTrack: animatesTransform ? transformTrack : null,
    opacityTrack: animatesOpacity ? opacityTrack : null,
    stableTransform: wantsTransform,
    child: content,
  );
}

@Deprecated(
    'Use transitionNode so CSS transition can animate transform/opacity.')
Widget transformNode(FjsStyle style, Widget content, {bool stable = false}) {
  final transform = style.transform;
  if (transform == null && !stable) return content;
  return Transform(
    transform: transform ?? Matrix4.identity(),
    alignment: Alignment.center,
    child: content,
  );
}

class _TransitionNode extends StatefulWidget {
  const _TransitionNode({
    super.key,
    required this.transform,
    required this.opacity,
    required this.stableTransform,
    required this.child,
    this.transformTrack,
    this.opacityTrack,
  });

  final Matrix4 transform;
  final double opacity;
  final bool stableTransform;
  final FjsTransitionTrack? transformTrack;
  final FjsTransitionTrack? opacityTrack;
  final Widget child;

  @override
  State<_TransitionNode> createState() => _TransitionNodeState();
}

class _TransitionNodeState extends State<_TransitionNode>
    with TickerProviderStateMixin {
  AnimationController? _transformController;
  AnimationController? _opacityController;
  Animation<double>? _transformAnimation;
  Animation<double>? _opacityAnimation;
  Timer? _transformDelay;
  Timer? _opacityDelay;
  Matrix4? _transformBegin;
  Matrix4? _transformEnd;
  double? _opacityBegin;
  double? _opacityEnd;

  @override
  void initState() {
    super.initState();
    _transformEnd = widget.transform.clone();
    _opacityEnd = widget.opacity;
    _syncControllers(oldWidget: null);
  }

  @override
  void didUpdateWidget(covariant _TransitionNode oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncControllers(oldWidget: oldWidget);
    if (!_sameMatrix(widget.transform, oldWidget.transform)) {
      _retargetTransform(oldWidget);
    }
    if (widget.opacity != oldWidget.opacity) {
      _retargetOpacity(oldWidget);
    }
  }

  void _syncControllers({_TransitionNode? oldWidget}) {
    if (widget.transformTrack == null) {
      _transformDelay?.cancel();
      _transformDelay = null;
      _transformAnimation = null;
      _transformBegin = null;
      _transformEnd = widget.transform.clone();
    }
    if (widget.opacityTrack == null) {
      _opacityDelay?.cancel();
      _opacityDelay = null;
      _opacityAnimation = null;
      _opacityBegin = null;
      _opacityEnd = widget.opacity;
    }
    _transformController = _syncController(
      controller: _transformController,
      oldTrack: oldWidget?.transformTrack,
      nextTrack: widget.transformTrack,
    );
    _opacityController = _syncController(
      controller: _opacityController,
      oldTrack: oldWidget?.opacityTrack,
      nextTrack: widget.opacityTrack,
    );
  }

  AnimationController? _syncController({
    required AnimationController? controller,
    required FjsTransitionTrack? oldTrack,
    required FjsTransitionTrack? nextTrack,
  }) {
    if (nextTrack == null) {
      controller?.dispose();
      return null;
    }
    if (controller == null) {
      return AnimationController(vsync: this, duration: nextTrack.duration)
        ..value = 1;
    }
    if (oldTrack?.duration != nextTrack.duration) {
      controller.duration = nextTrack.duration;
    }
    return controller;
  }

  void _retargetTransform(_TransitionNode oldWidget) {
    final controller = _transformController;
    if (controller == null) {
      _transformEnd = widget.transform.clone();
      _transformBegin = null;
      return;
    }
    _transformBegin = _currentTransform(oldWidget.transform).clone();
    _transformEnd = widget.transform.clone();
    _transformDelay?.cancel();
    _run(
      controller,
      widget.transformTrack!,
      (animation) => _transformAnimation = animation,
      (timer) => _transformDelay = timer,
    );
  }

  void _retargetOpacity(_TransitionNode oldWidget) {
    final controller = _opacityController;
    if (controller == null) {
      _opacityEnd = widget.opacity;
      _opacityBegin = null;
      return;
    }
    _opacityBegin = _currentOpacity(oldWidget.opacity);
    _opacityEnd = widget.opacity;
    _opacityDelay?.cancel();
    _run(
      controller,
      widget.opacityTrack!,
      (animation) => _opacityAnimation = animation,
      (timer) => _opacityDelay = timer,
    );
  }

  void _run(
    AnimationController controller,
    FjsTransitionTrack track,
    void Function(Animation<double>) setAnimation,
    void Function(Timer?) setDelayTimer,
  ) {
    controller.stop();
    controller.duration = track.duration;
    setAnimation(CurvedAnimation(parent: controller, curve: track.curve));
    controller.value = 0;
    if (track.delay <= Duration.zero) {
      controller.forward();
      setDelayTimer(null);
      return;
    }
    setDelayTimer(Timer(track.delay, () {
      if (!mounted) return;
      if (controller.value == 0) controller.forward();
    }));
  }

  Matrix4 _currentTransform(Matrix4 fallback) {
    final begin = _transformBegin;
    final end = _transformEnd;
    final animation = _transformAnimation;
    if (begin == null || end == null || animation == null) return fallback;
    return Matrix4Tween(begin: begin, end: end).transform(animation.value);
  }

  double _currentOpacity(double fallback) {
    final begin = _opacityBegin;
    final end = _opacityEnd;
    final animation = _opacityAnimation;
    if (begin == null || end == null || animation == null) return fallback;
    return begin + (end - begin) * animation.value;
  }

  @override
  void dispose() {
    _transformDelay?.cancel();
    _opacityDelay?.cancel();
    _transformController?.dispose();
    _opacityController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final listeners = [
      if (_transformController != null) _transformController!,
      if (_opacityController != null) _opacityController!,
    ];
    final listenable = listeners.isEmpty
        ? const AlwaysStoppedAnimation<double>(1)
        : Listenable.merge(listeners);
    return AnimatedBuilder(
      animation: listenable,
      child: widget.child,
      builder: (context, child) {
        Widget w = child!;
        if (widget.stableTransform) {
          w = Transform(
            transform: _currentTransform(widget.transform),
            alignment: Alignment.center,
            child: w,
          );
        }
        final opacity = _currentOpacity(widget.opacity).clamp(0.0, 1.0);
        if (opacity < 1 || widget.opacityTrack != null) {
          w = Opacity(opacity: opacity, child: w);
        }
        return w;
      },
    );
  }
}

bool _sameMatrix(Matrix4 a, Matrix4 b) {
  final av = a.storage;
  final bv = b.storage;
  for (var i = 0; i < av.length; i++) {
    if (av[i] != bv[i]) return false;
  }
  return true;
}
