// Unit tests for CSS value parsing (colors, units, shadows, gradients,
// shorthands) used by the widget style mapper.
import 'package:flutter/painting.dart';
import 'package:flutter_jsc/src/render/style_parse.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseColor', () {
    test('hex notations', () {
      expect(parseColor('#ff0000'), const Color(0xFFFF0000));
      expect(parseColor('#f00'), const Color(0xFFFF0000));
      expect(parseColor('#ff000080'), const Color(0x80FF0000));
      // 4-digit hex is RGBA
      expect(parseColor('#f008'), const Color(0x88FF0000));
    });

    test('rgb()/rgba() with commas, spaces and percentages', () {
      expect(parseColor('rgb(255, 0, 0)'), const Color(0xFFFF0000));
      expect(parseColor('rgb(255 0 0)'), const Color(0xFFFF0000));
      expect(parseColor('rgba(255 0 0 / 0.5)'), const Color(0x80FF0000));
      expect(parseColor('rgb(100% 0% 0%)'), const Color(0xFFFF0000));
      expect(parseColor('rgba(0, 0, 255, 50%)'), const Color(0x800000FF));
    });

    test('hsl()', () {
      expect(parseColor('hsl(0, 100%, 50%)'), const Color(0xFFFF0000));
      expect(parseColor('hsl(120deg, 100%, 50%)'), const Color(0xFF00FF00));
      expect(parseColor('hsl(240 100% 50% / 50%)'), const Color(0x800000FF));
    });

    test('named colors, case-insensitive', () {
      expect(parseColor('tomato'), const Color(0xFFFF6347));
      expect(parseColor('REBECCAPURPLE'), const Color(0xFF663399));
      expect(parseColor('white'), const Color(0xFFFFFFFF));
      expect(parseColor('notacolor'), isNull);
    });
  });

  group('parseLength', () {
    test('numbers and px strings', () {
      expect(parseLength(16), 16.0);
      expect(parseLength('16px'), 16.0);
      expect(parseLength('-8px'), -8.0);
      expect(parseLength('1.5'), 1.5);
      expect(parseLength('2em'), isNull);
      expect(parseLength(null), isNull);
    });
  });

  group('parseFontWeight', () {
    test('full numeric range and keywords', () {
      expect(parseFontWeight(100), FontWeight.w100);
      expect(parseFontWeight('450'), FontWeight.w400);
      expect(parseFontWeight('900'), FontWeight.w900);
      expect(parseFontWeight('normal'), FontWeight.w400);
      expect(parseFontWeight('bold'), FontWeight.w700);
      expect(parseFontWeight('bolder'), isNull);
    });
  });

  group('parseBoxShadows', () {
    test('single shadow string', () {
      final shadows = parseBoxShadows('0 2px 8px rgba(0,0,0,0.2)')!;
      expect(shadows, hasLength(1));
      expect(shadows[0].offset, const Offset(0, 2));
      expect(shadows[0].blurRadius, 8);
      expect(shadows[0].color, const Color(0x33000000));
    });

    test('multiple shadows with spread and color', () {
      final shadows = parseBoxShadows('1px 2px 3px 4px #ff0000, 0 0 5px')!;
      expect(shadows, hasLength(2));
      expect(shadows[0].offset, const Offset(1, 2));
      expect(shadows[0].spreadRadius, 4);
      expect(shadows[0].color, const Color(0xFFFF0000));
      expect(shadows[1].color, const Color(0xFF000000));
    });
  });

  group('parseGradient', () {
    test('linear-gradient with angle and stops', () {
      final g = parseGradient('linear-gradient(180deg, #ff0000 0%, #0000ff 100%)')
          as LinearGradient?;
      expect(g, isNotNull);
      expect(g!.begin, Alignment.topCenter);
      expect(g.end, Alignment.bottomCenter);
      expect(g.colors, const [Color(0xFFFF0000), Color(0xFF0000FF)]);
      expect(g.stops, const [0.0, 1.0]);
    });

    test('linear-gradient direction keywords', () {
      final g = parseGradient('linear-gradient(to right, red, blue)') as LinearGradient?;
      expect(g!.begin, Alignment.centerLeft);
      expect(g.end, Alignment.centerRight);
    });

    test('plain colors are not gradients', () {
      expect(parseGradient('#ffffff'), isNull);
      expect(parseGradient('red'), isNull);
    });
  });

  group('parseBorderRadius', () {
    test('shorthands', () {
      expect(parseBorderRadius(8), BorderRadius.circular(8));
      expect(parseBorderRadius('12px'), BorderRadius.circular(12));
      final two = parseBorderRadius('8px 16px')!;
      expect(two.topLeft, const Radius.circular(8));
      expect(two.topRight, const Radius.circular(16));
      expect(two.bottomRight, const Radius.circular(8));
      final four = parseBorderRadius('1px 2px 3px 4px')!;
      expect(four.bottomLeft, const Radius.circular(4));
      expect(parseBorderRadius('50%'), isNull); // percent unsupported
    });
  });

  group('parseBorder', () {
    test('shorthand width/style/color', () {
      final b = parseBorder('1px solid #ccc')!;
      expect(b.width, 1);
      expect(b.color, const Color(0xFFCCCCCC));
      final dashed = parseBorder('2px dashed red')!;
      expect(dashed.width, 2);
      expect(dashed.color, const Color(0xFFFF0000));
    });
  });

  group('transformText', () {
    test('uppercase/lowercase/capitalize', () {
      expect(transformText('uppercase', 'abc'), 'ABC');
      expect(transformText('lowercase', 'ABC'), 'abc');
      expect(transformText('capitalize', 'hello world'), 'Hello World');
      expect(transformText('none', 'abc'), isNull);
      expect(transformText(null, 'abc'), isNull);
    });
  });
}
