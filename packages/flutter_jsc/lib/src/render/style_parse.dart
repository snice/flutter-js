// CSS value parsing helpers shared by the widget layer: colors (#hex,
// rgb()/rgba()/hsl()/hsla(), CSS named colors), lengths ("16px" -> 16.0),
// font weights/styles, text decoration, box/text shadows, linear and radial
// gradients, border and border-radius shorthands.
//
// Pure functions with no widget imports so they are unit-testable. Values
// arriving from JS are either numbers (inline style API) or strings (CSS
// text from <style> blocks / style="..." attributes).

import 'dart:math' show cos, sin;

import 'package:flutter/painting.dart';

/// Parses any web color notation into a [Color], null if unrecognized.
Color? parseColor(Object? value) {
  if (value == null) return null;
  if (value is Color) return value;
  var v = value.toString().trim().toLowerCase();
  if (v.isEmpty) return null;
  if (v.startsWith('#')) return _parseHex(v.substring(1));
  if (v.endsWith(')')) {
    final open = v.indexOf('(');
    if (open > 0) {
      final fn = v.substring(0, open).trim();
      final args = v.substring(open + 1, v.length - 1);
      if (fn == 'rgb' || fn == 'rgba') return _parseRgbArgs(args);
      if (fn == 'hsl' || fn == 'hsla') return _parseHslArgs(args);
    }
  }
  final named = _namedColors[v];
  return named == null ? null : Color(0xFF000000 | named);
}

Color? _parseHex(String hex) {
  String expand(String nibble) => nibble + nibble;
  // #RGB #RGBA #RRGGBB #RRGGBBAA (web: last pair is alpha)
  String r, g, b, a;
  switch (hex.length) {
    case 3:
      r = expand(hex[0]);
      g = expand(hex[1]);
      b = expand(hex[2]);
      a = 'ff';
    case 4:
      r = expand(hex[0]);
      g = expand(hex[1]);
      b = expand(hex[2]);
      a = expand(hex[3]);
    case 6:
      r = hex.substring(0, 2);
      g = hex.substring(2, 4);
      b = hex.substring(4, 6);
      a = 'ff';
    case 8:
      r = hex.substring(0, 2);
      g = hex.substring(2, 4);
      b = hex.substring(4, 6);
      a = hex.substring(6, 8);
    default:
      return null;
  }
  final argb = int.tryParse('$a$r$g$b', radix: 16);
  return argb == null ? null : Color(argb);
}

/// Parses "255,0,0" / "255 0 0 / 0.5" style component lists; percentages
/// (50%) and 0-255 numbers are both accepted.
Color? _parseRgbArgs(String args) {
  final parts = _splitColorArgs(args);
  if (parts.length < 3) return null;
  final r = _channel(parts[0]);
  final g = _channel(parts[1]);
  final b = _channel(parts[2]);
  final a = parts.length > 3 ? _alpha(parts[3]) : 1.0;
  if (r == null || g == null || b == null || a == null) return null;
  return Color.fromARGB((a * 255).round(), r, g, b);
}

Color? _parseHslArgs(String args) {
  final parts = _splitColorArgs(args);
  if (parts.length < 3) return null;
  final h = double.tryParse(parts[0].replaceAll(RegExp(r'deg$'), '').trim());
  final s = _percent(parts[1]);
  final l = _percent(parts[2]);
  final a = parts.length > 3 ? _alpha(parts[3]) : 1.0;
  if (h == null || s == null || l == null || a == null) return null;
  return HSLColor.fromAHSL(a, h % 360, s.clamp(0, 1), l.clamp(0, 1)).toColor();
}

List<String> _splitColorArgs(String args) => args
    .split('/')
    .expand((seg) => seg.split(RegExp(r'[,\s]+')))
    .map((s) => s.trim())
    .where((s) => s.isNotEmpty)
    .toList();

int? _channel(String v) {
  if (v.endsWith('%')) {
    final p = double.tryParse(v.substring(0, v.length - 1));
    return p == null ? null : (p * 255 / 100).round().clamp(0, 255);
  }
  final n = double.tryParse(v);
  return n == null ? null : n.round().clamp(0, 255);
}

double? _percent(String v) {
  if (v.endsWith('%')) return double.tryParse(v.substring(0, v.length - 1))! / 100;
  return double.tryParse(v);
}

double? _alpha(String v) {
  if (v.endsWith('%')) return _percent(v);
  return double.tryParse(v);
}

/// Parses a length: num, "12", "12px" -> double. Other units are not
/// supported (rem/em are normalized to px on the JS side).
double? parseLength(Object? value) {
  if (value is num) return value.toDouble();
  if (value is! String) return null;
  var v = value.trim();
  if (v.endsWith('px')) v = v.substring(0, v.length - 2).trim();
  return double.tryParse(v);
}

FontWeight? parseFontWeight(Object? value) {
  if (value == null) return null;
  if (value is num) return _weightFor(value.round());
  final v = value.toString().trim();
  final n = int.tryParse(v);
  if (n != null) return _weightFor(n);
  switch (v) {
    case 'normal':
      return FontWeight.w400;
    case 'bold':
      return FontWeight.w700;
    default:
      return null; // bolder/lighter need the parent's weight — unsupported
  }
}

FontWeight _weightFor(int n) {
  const weights = [
    FontWeight.w100, FontWeight.w200, FontWeight.w300, FontWeight.w400,
    FontWeight.w500, FontWeight.w600, FontWeight.w700, FontWeight.w800,
    FontWeight.w900,
  ];
  return weights[(n.clamp(100, 900) - 100) ~/ 100];
}

FontStyle? parseFontStyle(Object? value) {
  final v = value?.toString();
  if (v == 'italic' || v == 'oblique') return FontStyle.italic;
  return null;
}

TextDecoration? parseTextDecoration(Object? value) {
  final v = value?.toString().trim();
  if (v == null || v.isEmpty) return null;
  if (v == 'none') return TextDecoration.none;
  TextDecoration? out;
  for (final part in v.split(RegExp(r'\s+'))) {
    final d = switch (part) {
      'underline' => TextDecoration.underline,
      'line-through' => TextDecoration.lineThrough,
      'overline' => TextDecoration.overline,
      _ => null,
    };
    if (d != null) out = out == null ? d : TextDecoration.combine([out, d]);
  }
  return out;
}

/// Parses one shadow ("0 2px 8px rgba(0,0,0,.2)") or a comma-separated
/// list. `inset` is ignored (no inset shadows in Flutter).
List<BoxShadow>? parseBoxShadows(Object? value) {
  if (value == null) return null;
  final List<Object?> items;
  if (value is List) {
    items = value;
  } else {
    items = _splitTopLevel(value.toString(), ',');
  }
  final shadows = <BoxShadow>[];
  for (final item in items) {
    final shadow = _parseShadow(item.toString().trim());
    if (shadow != null) shadows.add(shadow);
  }
  return shadows.isEmpty ? null : shadows;
}

BoxShadow? _parseShadow(String s) {
  if (s.isEmpty) return null;
  final tokens = _splitTopLevel(s, ' ').where((t) => t.isNotEmpty).toList();
  tokens.removeWhere((t) => t == 'inset');
  if (tokens.length < 2) return null;
  final dx = parseLength(tokens[0]);
  final dy = parseLength(tokens[1]);
  if (dx == null || dy == null) return null;
  var idx = 2;
  var blur = 0.0;
  var spread = 0.0;
  if (idx < tokens.length && parseLength(tokens[idx]) != null) {
    blur = parseLength(tokens[idx])!;
    idx++;
  }
  if (idx < tokens.length && parseLength(tokens[idx]) != null) {
    spread = parseLength(tokens[idx])!;
    idx++;
  }
  var color = const Color(0xFF000000);
  if (idx < tokens.length) {
    final c = parseColor(tokens[idx]);
    if (c != null) color = c;
  }
  return BoxShadow(
    offset: Offset(dx, dy),
    blurRadius: blur,
    spreadRadius: spread,
    color: color,
  );
}

/// Splits on [sep] occurrences that are not inside parentheses.
List<String> _splitTopLevel(String text, String sep) {
  final parts = <String>[];
  var depth = 0;
  var start = 0;
  for (var i = 0; i < text.length; i++) {
    final ch = text[i];
    if (ch == '(') {
      depth++;
    } else if (ch == ')') {
      if (depth > 0) depth--;
    } else if (ch == sep && depth == 0) {
      parts.add(text.substring(start, i));
      start = i + 1;
    }
  }
  parts.add(text.substring(start));
  return parts;
}

/// Parses `linear-gradient(...)` / `radial-gradient(...)` from a
/// `background` or `background-image` value; plain colors return null
/// (handled by the color getters).
Gradient? parseGradient(Object? value) {
  if (value == null) return null;
  final v = value.toString().trim().toLowerCase();
  final open = v.indexOf('(');
  if (open <= 0 || !v.endsWith(')')) return null;
  final fn = v.substring(0, open).trim();
  final args = _splitTopLevel(v.substring(open + 1, v.length - 1), ',')
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  if (fn == 'linear-gradient') return _parseLinear(args);
  if (fn == 'radial-gradient') return _parseRadial(args);
  return null;
}

Gradient? _parseLinear(List<String> args) {
  var begin = Alignment.topLeft;
  var end = Alignment.bottomRight;
  var colors = args;
  if (args.isNotEmpty && !_isColorStop(args.first)) {
    final dir = _parseDirection(args.first);
    if (dir == null) return null;
    begin = dir.$1;
    end = dir.$2;
    colors = args.sublist(1);
  }
  return _buildGradient(colors, (stops) => LinearGradient(begin: begin, end: end, colors: stops.$1, stops: stops.$2));
}

Gradient? _parseRadial(List<String> args) {
  var colors = args;
  // skip "circle", "ellipse", "closest-side at ...", position prefixes
  while (colors.isNotEmpty && !_isColorStop(colors.first)) {
    colors = colors.sublist(1);
  }
  if (colors.isEmpty) return null;
  return _buildGradient(colors, (stops) => RadialGradient(colors: stops.$1, stops: stops.$2));
}

Gradient? _buildGradient(
  List<String> args,
  Gradient Function((List<Color>, List<double>?)) build,
) {
  final colors = <Color>[];
  final stops = <double>[];
  var hasStops = false;
  for (final arg in args) {
    final parts = _splitTopLevel(arg, ' ').where((s) => s.isNotEmpty).toList();
    final color = parseColor(parts.first);
    if (color == null) return null;
    colors.add(color);
    if (parts.length > 1) {
      final stop = _stopFraction(parts[1]);
      if (stop == null) return null;
      stops.add(stop);
      hasStops = true;
    }
  }
  if (colors.length < 2) return null;
  return build((colors, hasStops ? stops : null));
}

bool _isColorStop(String arg) => parseColor(arg.trim().split(' ').first) != null;

double? _stopFraction(String v) {
  if (v.endsWith('%')) {
    final p = double.tryParse(v.substring(0, v.length - 1));
    return p == null ? null : p / 100;
  }
  return double.tryParse(v);
}

/// CSS gradient direction: "180deg" / "to bottom right" -> (begin, end).
(Alignment, Alignment)? _parseDirection(String spec) {
  final s = spec.trim();
  if (s.endsWith('deg')) {
    final deg = double.tryParse(s.substring(0, s.length - 3));
    if (deg == null) return null;
    // CSS: 0deg points up, clockwise. 90deg = to right.
    final rad = deg * 3.141592653589793 / 180;
    final x = _snap(sin(rad));
    final y = _snap(-cos(rad));
    return (Alignment(-x, -y), Alignment(x, y));
  }
  if (s.startsWith('to ')) {
    final parts = s.substring(3).split(RegExp(r'\s+'));
    var x = 0.0;
    var y = 0.0;
    for (final p in parts) {
      if (p == 'left') x = -1;
      if (p == 'right') x = 1;
      if (p == 'top') y = -1;
      if (p == 'bottom') y = 1;
    }
    return (Alignment(-x, -y), Alignment(x, y));
  }
  return null;
}

double _snap(double v) => v.abs() < 1e-6 ? 0 : (v.abs() > 1 - 1e-6 ? v.sign : v);

/// Parses `border: 1px solid #ccc` shorthand. Dashed/dotted styles parse
/// but render solid (Flutter single-value borders have no dash support).
({double width, Color color})? parseBorder(Object? value) {
  if (value == null) return null;
  final tokens = value
      .toString()
      .trim()
      .split(RegExp(r'\s+'))
      .where((t) => t.isNotEmpty)
      .toList();
  var width = 1.0;
  var color = const Color(0xFF000000);
  for (final t in tokens) {
    final len = parseLength(t);
    if (len != null) {
      width = len;
      continue;
    }
    final c = parseColor(t);
    if (c != null) {
      color = c;
      continue;
    }
    // border style keywords: accepted, rendered solid
  }
  return (width: width, color: color);
}

/// Parses a border-radius shorthand: one to four lengths
/// ("8px", "8px 16px", "8px 8px 0 0"). Percentage radii are not supported.
BorderRadius? parseBorderRadius(Object? value) {
  if (value == null) return null;
  if (value is num) return BorderRadius.circular(value.toDouble());
  final tokens = value
      .toString()
      .trim()
      .split(RegExp(r'\s+'))
      .where((t) => t.isNotEmpty)
      .toList();
  if (tokens.isEmpty) return null;
  final radii = [for (final t in tokens) parseLength(t)];
  if (radii.any((r) => r == null)) return null;
  Radius r(int i) => Radius.circular(radii[i.clamp(0, radii.length - 1)]!);
  return switch (radii.length) {
    1 => BorderRadius.all(Radius.circular(radii[0]!)),
    2 => BorderRadius.only(topLeft: r(0), topRight: r(1), bottomRight: r(0), bottomLeft: r(1)),
    3 => BorderRadius.only(topLeft: r(0), topRight: r(1), bottomRight: r(2), bottomLeft: r(1)),
    4 => BorderRadius.only(topLeft: r(0), topRight: r(1), bottomRight: r(2), bottomLeft: r(3)),
    _ => null,
  };
}

/// Applies a CSS text-transform to [text]. Returns null when the property
/// is absent/unset so callers keep the original string.
String? transformText(Object? value, String text) {
  switch (value?.toString()) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replaceAllMapped(
        RegExp(r'\b\w'),
        (m) => m[0]!.toUpperCase(),
      );
    default:
      return null;
  }
}

/// CSS extended named colors (hex RRGGBB, alpha always ff).
const Map<String, int> _namedColors = {
  'aliceblue': 0xF0F8FF,
  'antiquewhite': 0xFAEBD7,
  'aqua': 0x00FFFF,
  'aquamarine': 0x7FFFD4,
  'azure': 0xF0FFFF,
  'beige': 0xF5F5DC,
  'bisque': 0xFFE4C4,
  'black': 0x000000,
  'blanchedalmond': 0xFFEBCD,
  'blue': 0x0000FF,
  'blueviolet': 0x8A2BE2,
  'brown': 0xA52A2A,
  'burlywood': 0xDEB887,
  'cadetblue': 0x5F9EA0,
  'chartreuse': 0x7FFF00,
  'chocolate': 0xD2691E,
  'coral': 0xFF7F50,
  'cornflowerblue': 0x6495ED,
  'cornsilk': 0xFFF8DC,
  'crimson': 0xDC143C,
  'cyan': 0x00FFFF,
  'darkblue': 0x00008B,
  'darkcyan': 0x008B8B,
  'darkgoldenrod': 0xB8860B,
  'darkgray': 0xA9A9A9,
  'darkgreen': 0x006400,
  'darkgrey': 0xA9A9A9,
  'darkkhaki': 0xBDB76B,
  'darkmagenta': 0x8B008B,
  'darkolivegreen': 0x556B2F,
  'darkorange': 0xFF8C00,
  'darkorchid': 0x9932CC,
  'darkred': 0x8B0000,
  'darksalmon': 0xE9967A,
  'darkseagreen': 0x8FBC8F,
  'darkslateblue': 0x483D8B,
  'darkslategray': 0x2F4F4F,
  'darkslategrey': 0x2F4F4F,
  'darkturquoise': 0x00CED1,
  'darkviolet': 0x9400D3,
  'deeppink': 0xFF1493,
  'deepskyblue': 0x00BFFF,
  'dimgray': 0x696969,
  'dimgrey': 0x696969,
  'dodgerblue': 0x1E90FF,
  'firebrick': 0xB22222,
  'floralwhite': 0xFFFAF0,
  'forestgreen': 0x228B22,
  'fuchsia': 0xFF00FF,
  'gainsboro': 0xDCDCDC,
  'ghostwhite': 0xF8F8FF,
  'gold': 0xFFD700,
  'goldenrod': 0xDAA520,
  'gray': 0x808080,
  'green': 0x008000,
  'greenyellow': 0xADFF2F,
  'honeydew': 0xF0FFF0,
  'hotpink': 0xFF69B4,
  'indianred': 0xCD5C5C,
  'indigo': 0x4B0082,
  'ivory': 0xFFFFF0,
  'khaki': 0xF0E68C,
  'lavender': 0xE6E6FA,
  'lavenderblush': 0xFFF0F5,
  'lawngreen': 0x7CFC00,
  'lemonchiffon': 0xFFFACD,
  'lightblue': 0xADD8E6,
  'lightcoral': 0xF08080,
  'lightcyan': 0xE0FFFF,
  'lightgoldenrodyellow': 0xFAFAD2,
  'lightgray': 0xD3D3D3,
  'lightgreen': 0x90EE90,
  'lightgrey': 0xD3D3D3,
  'lightpink': 0xFFB6C1,
  'lightsalmon': 0xFFA07A,
  'lightseagreen': 0x20B2AA,
  'lightskyblue': 0x87CEFA,
  'lightslategray': 0x778899,
  'lightslategrey': 0x778899,
  'lightsteelblue': 0xB0C4DE,
  'lightyellow': 0xFFFFE0,
  'lime': 0x00FF00,
  'limegreen': 0x32CD32,
  'linen': 0xFAF0E6,
  'magenta': 0xFF00FF,
  'maroon': 0x800000,
  'mediumaquamarine': 0x66CDAA,
  'mediumblue': 0x0000CD,
  'mediumorchid': 0xBA55D3,
  'mediumpurple': 0x9370DB,
  'mediumseagreen': 0x3CB371,
  'mediumslateblue': 0x7B68EE,
  'mediumspringgreen': 0x00FA9A,
  'mediumturquoise': 0x48D1CC,
  'mediumvioletred': 0xC71585,
  'midnightblue': 0x191970,
  'mintcream': 0xF5FFFA,
  'mistyrose': 0xFFE4E1,
  'moccasin': 0xFFE4B5,
  'navajowhite': 0xFFDEAD,
  'navy': 0x000080,
  'oldlace': 0xFDF5E6,
  'olive': 0x808000,
  'olivedrab': 0x6B8E23,
  'orange': 0xFFA500,
  'orangered': 0xFF4500,
  'orchid': 0xDA70D6,
  'palegoldenrod': 0xEEE8AA,
  'palegreen': 0x98FB98,
  'paleturquoise': 0xAFEEEE,
  'palevioletred': 0xDB7093,
  'papayawhip': 0xFFEFD5,
  'peachpuff': 0xFFDAB9,
  'peru': 0xCD853F,
  'pink': 0xFFC0CB,
  'plum': 0xDDA0DD,
  'powderblue': 0xB0E0E6,
  'purple': 0x800080,
  'rebeccapurple': 0x663399,
  'red': 0xFF0000,
  'rosybrown': 0xBC8F8F,
  'royalblue': 0x4169E1,
  'saddlebrown': 0x8B4513,
  'salmon': 0xFA8072,
  'sandybrown': 0xF4A460,
  'seagreen': 0x2E8B57,
  'seashell': 0xFFF5EE,
  'sienna': 0xA0522D,
  'silver': 0xC0C0C0,
  'skyblue': 0x87CEEB,
  'slateblue': 0x6A5ACD,
  'slategray': 0x708090,
  'slategrey': 0x708090,
  'snow': 0xFFFAFA,
  'springgreen': 0x00FF7F,
  'steelblue': 0x4682B4,
  'tan': 0xD2B48C,
  'teal': 0x008080,
  'thistle': 0xD8BFD8,
  'tomato': 0xFF6347,
  'turquoise': 0x40E0D0,
  'violet': 0xEE82EE,
  'wheat': 0xF5DEB3,
  'white': 0xFFFFFF,
  'whitesmoke': 0xF5F5F5,
  'yellow': 0xFFFF00,
  'yellowgreen': 0x9ACD32,
};
