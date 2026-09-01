// Style resolution for the widget layer. Property reference: docs/ui-api.md.
import 'package:flutter/material.dart';

import 'style_parse.dart';

/// Reads the merged `style` map (plus legacy top-level props) of a node and
/// maps CSS properties onto Flutter values. Parsing of raw CSS values lives
/// in style_parse.dart; this class only resolves which value to use.
class FjsStyle {
  FjsStyle(this.props) {
    final s = props['style'];
    if (s is Map<String, Object?>) style = s;
  }

  /// The style this node has while pressed: its computed style with the
  /// `:active` one the JS style engine sent alongside it laid over the top.
  /// Same map as [FjsStyle] when the node matched no `:active` rule.
  FjsStyle.pressed(this.props) {
    final s = props['style'];
    final base = s is Map<String, Object?> ? s : const <String, Object?>{};
    final active = props['activeStyle'];
    style = active is Map<String, Object?> ? {...base, ...active} : base;
  }

  /// Whether the node carries a page-authored `:active` style. Buttons also
  /// track press for the default WeUI mask, even when this is false.
  static bool hasPressedStyle(Map<String, Object?> props) =>
      props['activeStyle'] is Map;

  final Map<String, Object?> props;
  late Map<String, Object?> style = const {};

  Object? _v(String key) => style[key] ?? props[key];

  double? _num(String key) => parseLength(_v(key));

  double get borderWidth => _num('borderWidth') ?? 0;
  Color get borderColor => _color('borderColor') ?? const Color(0xFFDDDDDD);

  /// The declared border color, or null when the node never set one — lets a
  /// widget tell `border-color` alone (which implies a 1px border in CSS)
  /// apart from its own default.
  Color? get declaredBorderColor => _color('borderColor');
  double? get width => _num('width');
  double? get height => _num('height');
  double? get fontSize => _num('fontSize');
  int? get maxLines => _v('maxLines') is int ? _v('maxLines') as int : null;
  TextOverflow? get overflow {
    final v = _v('overflow')?.toString();
    if (v == 'ellipsis') return TextOverflow.ellipsis;
    if (v == 'clip') return TextOverflow.clip;
    return null;
  }

  bool get hasDecoration =>
      backgroundColor != null ||
      gradient != null ||
      boxShadows != null ||
      (borderRadius?.bottomRight.x ?? 0) > 0 ||
      borderWidth > 0;

  Axis get scrollDirection => (_v('direction')?.toString() == 'horizontal')
      ? Axis.horizontal
      : Axis.vertical;

  Color? _color(String key) => parseColor(_v(key));

  Color? get backgroundColor =>
      _color('backgroundColor') ?? _color('background');
  Color? get color => _color('color');

  FontWeight? get fontWeight => parseFontWeight(_v('fontWeight'));
  FontStyle? get fontStyle => parseFontStyle(_v('fontStyle'));
  String? get fontFamily => _v('fontFamily')?.toString();
  double? get letterSpacing => _num('letterSpacing');

  /// Unitless numbers are line-height multipliers; "24px" is absolute.
  double? get lineHeightMultiplier {
    final v = _v('lineHeight');
    if (v is num) return v.toDouble();
    if (v is String) {
      final s = v.trim();
      if (s.endsWith('px')) return null;
      return double.tryParse(s);
    }
    return null;
  }

  double? get lineHeightAbsolute {
    final v = _v('lineHeight');
    if (v is String && v.trim().endsWith('px')) return parseLength(v);
    return null;
  }

  TextDecoration? get textDecoration =>
      parseTextDecoration(_v('textDecoration'));
  String? get textTransform => _v('textTransform')?.toString();
  List<BoxShadow>? get textShadows => parseBoxShadows(_v('textShadow'));
  bool get whiteSpaceNowrap => _v('whiteSpace')?.toString() == 'nowrap';

  TextAlign? get textAlign {
    final v = _v('textAlign')?.toString();
    if (v == 'center') return TextAlign.center;
    if (v == 'right' || v == 'end') return TextAlign.right;
    if (v == 'left' || v == 'start') return TextAlign.left;
    return null;
  }

  BoxFit? get fit {
    final v = _v('fit')?.toString();
    if (v == 'contain') return BoxFit.contain;
    if (v == 'fill') return BoxFit.fill;
    if (v == 'cover') return BoxFit.cover;
    return null;
  }

  EdgeInsets? get padding => _edge('padding');
  EdgeInsets? get margin => _edge('margin');

  /// The shorthand (`margin: 8px 0`) plus the longhands (`margin-top`), with
  /// a longhand overriding the side the shorthand set — the common authoring
  /// pattern `margin: 8px; margin-left: 0`. Declaration order within a block
  /// is lost by the time the style map arrives here, so that precedence is
  /// fixed rather than positional; a shorthand written *after* a longhand is
  /// the one case CSS would resolve the other way.
  EdgeInsets? _edge(String key) {
    final base = _edgeShorthand(_v(key));
    final top = _num('${key}Top');
    final right = _num('${key}Right');
    final bottom = _num('${key}Bottom');
    final left = _num('${key}Left');
    if (top == null && right == null && bottom == null && left == null) {
      return base;
    }
    final b = base ?? EdgeInsets.zero;
    return EdgeInsets.fromLTRB(
      left ?? b.left,
      top ?? b.top,
      right ?? b.right,
      bottom ?? b.bottom,
    );
  }

  EdgeInsets? _edgeShorthand(Object? v) {
    if (v is num) return EdgeInsets.all(v.toDouble());
    if (v is String) {
      final parts = v.split(RegExp(r'\s+'));
      final nums = parts.map(parseLength).toList();
      if (nums.length == 1 && nums[0] != null) return EdgeInsets.all(nums[0]!);
      if (nums.length == 2 && nums[0] != null && nums[1] != null) {
        return EdgeInsets.symmetric(vertical: nums[0]!, horizontal: nums[1]!);
      }
      if (nums.length == 3 && nums.every((n) => n != null)) {
        // top | horizontal | bottom
        return EdgeInsets.fromLTRB(nums[1]!, nums[0]!, nums[1]!, nums[2]!);
      }
      if (nums.length == 4 && nums.every((n) => n != null)) {
        // CSS order: top right bottom left -> Flutter: left top right bottom
        return EdgeInsets.fromLTRB(nums[3]!, nums[0]!, nums[1]!, nums[2]!);
      }
      return null;
    }
    if (v is Map) {
      double? g(String k) {
        final x = v[k];
        return x is num ? x.toDouble() : null;
      }

      return EdgeInsets.fromLTRB(
          g('left') ?? 0, g('top') ?? 0, g('right') ?? 0, g('bottom') ?? 0);
    }
    return null;
  }

  BorderRadius? get borderRadius => parseBorderRadius(_v('borderRadius'));

  /// `border: 1px solid #ccc` shorthand fills in width/color when the
  /// longhand props are absent.
  ({double width, Color color})? get borderShorthand =>
      parseBorder(_v('border'));

  Gradient? get gradient =>
      parseGradient(_v('backgroundImage')) ?? parseGradient(_v('background'));

  List<BoxShadow>? get boxShadows => parseBoxShadows(_v('boxShadow'));

  double? get opacity {
    final v = _num('opacity');
    return v == null ? null : v.clamp(0.0, 1.0);
  }

  /// `transform` — translate/scale/rotate, composed left to right as in
  /// CSS. A translated node repaints instead of relaying out, which is what
  /// makes a drag cheap.
  Matrix4? get transform => parseTransform(_v('transform'));

  /// CSS transition support for paint-only wrappers. The native renderer
  /// currently animates `transform` and `opacity`; layout properties still
  /// jump to their new value.
  FjsTransitions? get transitions => parseTransitions(style);

  /// `touch-action`: which gestures this node takes away from whatever
  /// would otherwise handle them (a scrollable, usually). Parsed in
  /// touch.dart, which owns the arena side of it.
  Object? get touchAction => _v('touchAction');

  String? get display => _v('display')?.toString();
  bool get overflowHidden => _v('overflow')?.toString() == 'hidden';

  double? get gap => _num('gap');

  /// `row-gap` / `column-gap`, each falling back to the `gap` shorthand.
  double? get rowGap => _num('rowGap') ?? gap;
  double? get columnGap => _num('columnGap') ?? gap;

  /// `flex-wrap`. `wrap-reverse` wraps without reversing the run order
  /// (Flutter's Wrap can do it, but nothing needs it yet).
  bool get flexWrap {
    final v = _v('flexWrap')?.toString();
    return v == 'wrap' || v == 'wrap-reverse';
  }

  /// justify-content / align-items for the wrapped variant. Flutter models
  /// Wrap with its own enums, so the same CSS values map twice.
  WrapAlignment get wrapAlignment {
    switch (_v('justifyContent')?.toString()) {
      case 'center':
        return WrapAlignment.center;
      case 'flex-end':
      case 'end':
        return WrapAlignment.end;
      case 'space-between':
        return WrapAlignment.spaceBetween;
      case 'space-around':
        return WrapAlignment.spaceAround;
      case 'space-evenly':
        return WrapAlignment.spaceEvenly;
      default:
        return WrapAlignment.start;
    }
  }

  WrapCrossAlignment get wrapCrossAlignment {
    switch (_v('alignItems')?.toString()) {
      case 'center':
        return WrapCrossAlignment.center;
      case 'flex-end':
      case 'end':
        return WrapCrossAlignment.end;
      default:
        return WrapCrossAlignment.start;
    }
  }

  /// flexGrow; also accepts the `flex` shorthand (`flex: 1`).
  double? get flexGrow {
    final v = _v('flexGrow');
    if (v is num) return v.toDouble();
    final f = _v('flex');
    if (f is num) return f.toDouble();
    if (f is String) {
      final first = f.trim().split(RegExp(r'\s+')).first;
      final n = double.tryParse(first);
      if (n != null) return n;
    }
    return null;
  }

  /// min/max sizes -> box constraints for the widget subtree.
  BoxConstraints? get constraints {
    final minWidth = _num('minWidth');
    final minHeight = _num('minHeight');
    final maxWidth = _num('maxWidth');
    final maxHeight = _num('maxHeight');
    if (minWidth == null &&
        minHeight == null &&
        maxWidth == null &&
        maxHeight == null) {
      return null;
    }
    return BoxConstraints(
      minWidth: minWidth ?? 0,
      minHeight: minHeight ?? 0,
      maxWidth: maxWidth ?? double.infinity,
      maxHeight: maxHeight ?? double.infinity,
    );
  }

  MainAxisAlignment? get justifyContent {
    switch (_v('justifyContent')?.toString()) {
      case 'center':
        return MainAxisAlignment.center;
      case 'flex-end':
      case 'end':
        return MainAxisAlignment.end;
      case 'space-between':
        return MainAxisAlignment.spaceBetween;
      case 'space-around':
        return MainAxisAlignment.spaceAround;
      case 'space-evenly':
        return MainAxisAlignment.spaceEvenly;
      default:
        return null;
    }
  }

  CrossAxisAlignment? get alignItems {
    switch (_v('alignItems')?.toString()) {
      case 'center':
        return CrossAxisAlignment.center;
      case 'flex-start':
      case 'start':
        return CrossAxisAlignment.start;
      case 'flex-end':
      case 'end':
        return CrossAxisAlignment.end;
      case 'stretch':
        return CrossAxisAlignment.stretch;
      default:
        return null;
    }
  }

  String? get flexDirection {
    final v = _v('flexDirection')?.toString();
    if (v == 'row') return 'row';
    if (v == 'column' || v == null) return 'column';
    return 'column';
  }

  // ---- absolute positioning (inside stack) ----------------------------------
  String? get position => _v('position')?.toString();
  double? get left => _num('left');
  double? get top => _num('top');
  double? get right => _num('right');
  double? get bottom => _num('bottom');
}
