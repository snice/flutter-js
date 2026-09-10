// `canvas` tag -> CustomPaint replaying the node's retained display list —
// unless a context module (@ufjs/webgl) owns the node's display, in which
// case the module's override view renders instead.
//
// Three things this widget owns, none of which JS can do:
//
//   * SIZE. A canvas has no intrinsic size; the box comes from the style, and
//     the page needs to know it in logical pixels (`canvas.width`). The size
//     is only known after layout, so it is reported back through
//     FjsEvent.canvas — and only when it changes, so a steady page sends
//     nothing. The webgl view reports the device ratio alongside, because a
//     GL page needs it: `gl.viewport` is in device pixels (spec 021 §3.2).
//   * DEVICE PIXELS. For the 2d path there is no backing store to scale —
//     Flutter rasterizes the whole scene at the device ratio. Context
//     modules with a real backing store (webgl's GL framebuffer) get the
//     ratio reported alongside the size, so the page handles dpr itself,
//     exactly as it would in a browser.
//   * CLEARING ON RESIZE. A browser drops the bitmap when the backing store
//     is resized; the 2d path drops its display list to match. The webgl
//     path recreates its texture, which drops the framebuffer the same way
//     (constitution I).
import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../canvas/canvas_module.dart';
import '../canvas/display_list.dart';
import '../canvas/replay.dart';
import '../ffi.dart' show FjsEvent;
import '../mirror_tree.dart';
import 'dispatch.dart';

Widget buildCanvas(MirrorNode node, FjsDispatch dispatch) {
  return _FjsCanvas(node: node, dispatch: dispatch);
}

class _FjsCanvas extends StatefulWidget {
  const _FjsCanvas({required this.node, required this.dispatch});

  final MirrorNode node;
  final FjsDispatch dispatch;

  @override
  State<_FjsCanvas> createState() => _FjsCanvasState();
}

class _FjsCanvasState extends State<_FjsCanvas> {
  Size _reported = Size.zero;
  double _reportedDpr = 0;
  bool _firstReportSent = false;

  void _reportSize(Size size, double dpr) {
    if (size == _reported && dpr == _reportedDpr) return;
    final first = _reported == Size.zero;
    _reported = size;
    _reportedDpr = dpr;
    if (!first) widget.node.canvas?.clear();
    widget.node.canvas?.size = size;
    // after the frame: this runs from layout, and dispatching into JS can
    // produce ops, which must not land in the middle of Flutter's own build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _dispatchSize(size, dpr);
    });
  }

  /// With `defer-resize`, the FIRST size report waits for the route's push
  /// transition.
  ///
  /// `@resize` is where a charting page builds its chart (that is what spec
  /// 019 designed it for), and building one is expensive — F2 costs ~70ms per
  /// chart, three of them ~210ms. Landing that on the frames the Navigator is
  /// animating is a visible freeze: 205ms of dropped frames on every push
  /// into the F2 example (specs/027 §6c).
  ///
  /// OPT-IN, and deliberately so: waiting costs the page a transition's worth
  /// of blank canvas, which is the wrong trade for a cheap one (a sparkline,
  /// a signature pad). The pages that need it are the ones whose first paint
  /// is measured in tens of milliseconds — charts and WebGL scenes.
  ///
  /// Only the first report waits. Later ones are real size changes (rotation,
  /// a split-view drag) where the page is already on screen and the picture is
  /// already wrong — those must go out immediately, `defer-resize` or not.
  void _dispatchSize(Size size, double dpr) {
    void send() {
      if (!mounted) return;
      widget.dispatch(
        widget.node.id,
        FjsEvent.canvas,
        text: jsonEncode({
          't': 'size',
          'w': _round(size.width),
          'h': _round(size.height),
          'dpr': dpr,
        }),
      );
    }

    if (_firstReportSent || !fjsBool(widget.node.props['deferResize'])) {
      _firstReportSent = true;
      send();
      return;
    }
    _firstReportSent = true;
    final animation = ModalRoute.of(context)?.animation;
    // no route (the base page), or the transition is already over
    if (animation == null || animation.isCompleted || animation.isDismissed) {
      send();
      return;
    }
    void listener(AnimationStatus status) {
      if (status != AnimationStatus.completed &&
          status != AnimationStatus.dismissed) {
        return;
      }
      animation.removeStatusListener(listener);
      send();
    }

    animation.addStatusListener(listener);
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(
          constraints.maxWidth.isFinite ? constraints.maxWidth : 0,
          constraints.maxHeight.isFinite ? constraints.maxHeight : 0,
        );
        // the ratio the whole scene is rasterized at; the webgl view needs
        // it for its backing store, the 2d path ignores it (logical pixels)
        final dpr = MediaQuery.maybeOf(context)?.devicePixelRatio ?? 1;
        _reportSize(size, dpr);
        // a context module that owns this node's display renders it (the
        // webgl Texture view); null falls through to the 2d CustomPaint
        final override = canvasDisplayOverride;
        if (override != null) {
          final view = override(widget.node, widget.dispatch);
          if (view != null) return view;
        }
        final list = widget.node.canvas;
        return CustomPaint(
          size: size,
          painter: _CanvasPainter(list, list?.version ?? 0),
          // an empty box of the style's size when nothing has been drawn yet
          child: const SizedBox.expand(),
        );
      },
    );
  }
}

/// Rounded to two decimals: the size crosses as JSON text, and a page reading
/// `canvas.width` wants 300, not 299.99999999999994.
num _round(double v) => (v * 100).round() / 100;

class _CanvasPainter extends CustomPainter {
  _CanvasPainter(this.list, this.version);

  final FjsCanvasDisplayList? list;

  /// Compared in [shouldRepaint]. The display list is mutated in place by the
  /// op decoder, so identity says nothing — the version is what changes.
  final int version;

  @override
  void paint(Canvas canvas, Size size) {
    final commands = list;
    if (commands == null || commands.isEmpty) return;
    // clipped so a page that draws outside its box cannot paint over its
    // siblings, which is what a real canvas' bitmap boundary does
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    // A canvas that erases part of itself needs a surface of its own: the
    // blend-clear a partial clearRect replays as would otherwise punch
    // through everything painted under the box. Only those pages pay for the
    // layer — see FjsCanvasDisplayList.needsLayer.
    if (commands.needsLayer) canvas.saveLayer(Offset.zero & size, Paint());
    CanvasReplay(canvas, size).run(commands.chunks);
    if (commands.needsLayer) canvas.restore();
    canvas.restore();
  }

  @override
  bool shouldRepaint(_CanvasPainter oldDelegate) =>
      oldDelegate.version != version || !identical(oldDelegate.list, list);
}
