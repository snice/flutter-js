// `canvas` tag -> CustomPaint replaying the node's retained display list.
//
// Three things this widget owns, none of which JS can do:
//
//   * SIZE. A canvas has no intrinsic size; the box comes from the style, and
//     the page needs to know it in logical pixels (`canvas.width`). The size
//     is only known after layout, so it is reported back through
//     FjsEvent.canvas — and only when it changes, so a steady page sends
//     nothing.
//   * DEVICE PIXELS. There is no backing store to scale here. Flutter
//     rasterizes the whole scene at the device ratio, so commands drawn in
//     logical pixels come out sharp for free. That is why a page never
//     multiplies by devicePixelRatio on this platform (docs/canvas-compat.md).
//   * CLEARING ON RESIZE. A browser drops the bitmap when the backing store
//     is resized. Keeping the picture here instead would make the same page
//     behave differently on the two platforms, so the display list is
//     dropped to match (constitution I).
import 'dart:convert';

import 'package:flutter/widgets.dart';

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

  void _reportSize(Size size) {
    if (size == _reported) return;
    final first = _reported == Size.zero;
    _reported = size;
    if (!first) widget.node.canvas?.clear();
    widget.node.canvas?.size = size;
    // after the frame: this runs from layout, and dispatching into JS can
    // produce ops, which must not land in the middle of Flutter's own build
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.dispatch(
        widget.node.id,
        FjsEvent.canvas,
        text: jsonEncode({
          't': 'size',
          'w': _round(size.width),
          'h': _round(size.height),
        }),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = Size(
          constraints.maxWidth.isFinite ? constraints.maxWidth : 0,
          constraints.maxHeight.isFinite ? constraints.maxHeight : 0,
        );
        _reportSize(size);
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
    CanvasReplay(canvas, size).run(commands.chunks);
    canvas.restore();
  }

  @override
  bool shouldRepaint(_CanvasPainter oldDelegate) =>
      oldDelegate.version != version || !identical(oldDelegate.list, list);
}
