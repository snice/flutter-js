// `progress` tag -> a Material progress indicator.
//
// `type: 'circular'` picks the spinner; anything else is a bar. A `value`
// prop (0..1) makes it determinate — without one the indicator animates as
// an indeterminate "still working" state.
import 'package:flutter/material.dart';

import '../mirror_tree.dart';

// Sizes and colors are the web adapter's `.fjs-progress` rules: a 4px bar
// with 2px corners over a 20%-alpha track, and a 32px ring with a 3px stroke.
const _accent = Color(0xFF007AFF);
const _track = Color(0x33007AFF);

Widget buildProgress(MirrorNode node) {
  if (node.props['type']?.toString() == 'circular') {
    return const SizedBox(
      width: 32,
      height: 32,
      child: CircularProgressIndicator(
        color: _accent,
        backgroundColor: Colors.transparent,
        strokeWidth: 3,
      ),
    );
  }
  final value = node.props['value'];
  return LinearProgressIndicator(
    value: value == null ? null : _clamp01(_asDouble(value, 0)),
    color: _accent,
    backgroundColor: _track,
    minHeight: 4,
    borderRadius: BorderRadius.circular(2),
  );
}

double _asDouble(Object? v, double fallback) =>
    v is num ? v.toDouble() : (double.tryParse('$v') ?? fallback);

double _clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);
