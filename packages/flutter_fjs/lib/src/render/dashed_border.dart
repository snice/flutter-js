// Dashed / dotted borders. Flutter's [Border] only strokes solid, so a
// `border: 1px dashed #ccc` is painted here instead: the same rounded box
// the decoration would have drawn, walked with PathMetrics and stroked in
// pieces.
//
// CSS does not define the dash lengths (every browser picks its own), so
// these are chosen to read like Chrome's at the widths a phone UI uses:
// dashes and gaps three times the border width, dots one width across with
// two between.
import 'dart:math' as math;
import 'dart:ui' show PointMode;

import 'package:flutter/material.dart';

import 'style_parse.dart' show FjsBorderStyle;

class FjsDashedBorderPainter extends CustomPainter {
  const FjsDashedBorderPainter({
    required this.width,
    required this.color,
    required this.kind,
    this.borderRadius,
  });

  final double width;
  final Color color;
  final FjsBorderStyle kind;
  final BorderRadius? borderRadius;

  @override
  void paint(Canvas canvas, Size size) {
    if (width <= 0 || size.isEmpty) return;
    // the stroke straddles the path, so walk the box inset by half a width
    // — same footprint a solid Border of this width would paint
    final rect = (Offset.zero & size).deflate(width / 2);
    if (rect.width <= 0 || rect.height <= 0) return;
    final path = Path();
    if (borderRadius != null) {
      path.addRRect(borderRadius!.toRRect(Offset.zero & size).deflate(width / 2));
    } else {
      path.addRect(rect);
    }
    final paint = Paint()
      ..color = color
      ..strokeWidth = width
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    if (kind == FjsBorderStyle.dotted) {
      final dots = <Offset>[];
      for (final metric in path.computeMetrics()) {
        for (var d = 0.0; d < metric.length; d += width * 3) {
          final tangent = metric.getTangentForOffset(d);
          if (tangent != null) dots.add(tangent.position);
        }
      }
      canvas.drawPoints(PointMode.points, dots, paint);
      return;
    }

    paint.strokeCap = StrokeCap.butt;
    final dash = width * 3;
    final gap = width * 3;
    for (final metric in path.computeMetrics()) {
      var start = 0.0;
      while (start < metric.length) {
        final end = math.min(start + dash, metric.length);
        canvas.drawPath(metric.extractPath(start, end), paint);
        start = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(FjsDashedBorderPainter old) =>
      old.width != width ||
      old.color != color ||
      old.kind != kind ||
      old.borderRadius != borderRadius;
}
