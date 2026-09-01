// margin/padding resolution: the shorthand forms and the longhands, which
// is what an ordinary stylesheet mixes. Before longhands were read, a rule
// like `margin-top: 12px` resolved to nothing here while the web build
// (real CSS) spaced the node normally — the same source laid out
// differently on the two targets.
import 'package:flutter/painting.dart';
import 'package:flutter_fjs/src/render/style.dart';
import 'package:flutter_test/flutter_test.dart';

FjsStyle styled(Map<String, Object?> style) =>
    FjsStyle({'style': style});

void main() {
  group('shorthand', () {
    test('1, 2, 3 and 4 value forms, and bare numbers', () {
      expect(styled({'margin': 8}).margin, const EdgeInsets.all(8));
      expect(styled({'margin': '8px'}).margin, const EdgeInsets.all(8));
      expect(styled({'margin': '4px 8px'}).margin,
          const EdgeInsets.symmetric(vertical: 4, horizontal: 8));
      // top | horizontal | bottom
      expect(styled({'margin': '1px 2px 3px'}).margin,
          const EdgeInsets.fromLTRB(2, 1, 2, 3));
      // CSS order is top right bottom left
      expect(styled({'padding': '1px 2px 3px 4px'}).padding,
          const EdgeInsets.fromLTRB(4, 1, 2, 3));
    });

    test('an unparseable value resolves to nothing', () {
      expect(styled({'margin': 'auto'}).margin, isNull);
      expect(styled({'margin': ''}).margin, isNull);
    });
  });

  group('longhands', () {
    test('one side on its own leaves the others at zero', () {
      expect(styled({'marginTop': 12}).margin,
          const EdgeInsets.only(top: 12));
      expect(styled({'paddingLeft': '10px'}).padding,
          const EdgeInsets.only(left: 10));
    });

    test('all four sides', () {
      expect(
        styled({
          'marginTop': 1,
          'marginRight': 2,
          'marginBottom': 3,
          'marginLeft': 4,
        }).margin,
        const EdgeInsets.fromLTRB(4, 1, 2, 3),
      );
    });

    test('override the side the shorthand set, keeping the rest', () {
      expect(styled({'margin': '8px', 'marginLeft': 0}).margin,
          const EdgeInsets.fromLTRB(0, 8, 8, 8));
      expect(styled({'padding': '4px 8px', 'paddingTop': 20}).padding,
          const EdgeInsets.fromLTRB(8, 20, 8, 4));
    });

    test('padding and margin do not read each other', () {
      final s = styled({'marginTop': 12, 'paddingTop': 4});
      expect(s.margin, const EdgeInsets.only(top: 12));
      expect(s.padding, const EdgeInsets.only(top: 4));
    });

    test('nothing declared stays null, so widget defaults still apply', () {
      expect(styled({'color': '#fff'}).margin, isNull);
      expect(styled({'color': '#fff'}).padding, isNull);
    });
  });

  test('legacy top-level props resolve like style entries', () {
    expect(FjsStyle({'marginTop': 6}).margin, const EdgeInsets.only(top: 6));
  });
}
