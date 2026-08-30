// `progress` tag -> a Material progress indicator.
//
// `type: 'circular'` picks the spinner; anything else is a bar. A `value`
// prop (0..1) makes it determinate — without one the indicator animates as
// an indeterminate "still working" state.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';

Widget buildProgress(MirrorNode node) {
  if (node.props['type']?.toString() == 'circular') {
    return const CircularProgressIndicator();
  }
  final value = node.props['value'];
  if (value == null) return const LinearProgressIndicator();
  return LinearProgressIndicator(value: _clamp01(_asDouble(value, 0)));
}

double _asDouble(Object? v, double fallback) =>
    v is num ? v.toDouble() : (double.tryParse('$v') ?? fallback);

double _clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);
