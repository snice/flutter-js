// The app half of specs/013-web-view. The web twin is
// ../../test/web-view-web.test.ts, and the payload strings asserted here are
// the same ones it asserts — that pair IS the "two ends, one contract" check.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:fjs_webview/fjs_webview.dart';

MirrorNode nodeWith(Map<String, Object?> props) {
  final node = MirrorNode(7, 'web-view');
  node.props = props;
  return node;
}

void main() {
  setUp(resetFjsWebViewWarnings);

  group('payloads mirror the JS side', () {
    test('load, error and message', () {
      expect(
        fjsWebViewLoadPayload('https://example.com/a'),
        '{"src":"https://example.com/a"}',
      );
      expect(
        fjsWebViewErrorPayload('https://example.com/a'),
        '{"src":"https://example.com/a","errMsg":"web-view load failed"}',
      );
      expect(fjsWebViewMessagePayload('hello #1'), '{"data":"hello #1"}');
    });

    test('escapes what JSON has to escape', () {
      expect(fjsWebViewMessagePayload('a "b"\nc'), '{"data":"a \\"b\\"\\nc"}');
      expect(fjsWebViewMessagePayload('tab\there'), '{"data":"tab\\there"}');
    });
  });

  group('src', () {
    test('classifies the loadable schemes and refuses the rest', () {
      expect(fjsClassifyWebViewSrc('https://a'), FjsWebViewSrcKind.http);
      expect(fjsClassifyWebViewSrc('http://a'), FjsWebViewSrcKind.http);
      expect(fjsClassifyWebViewSrc('asset://a.html'), FjsWebViewSrcKind.asset);
      expect(fjsClassifyWebViewSrc(''), FjsWebViewSrcKind.empty);
      expect(fjsClassifyWebViewSrc(null), FjsWebViewSrcKind.empty);
      for (final src in const [
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:text/html,x',
        'example.com',
      ]) {
        expect(fjsClassifyWebViewSrc(src), FjsWebViewSrcKind.unsupported,
            reason: src);
      }
    });

    test('an asset path cannot escape the module directory', () {
      expect(fjsWebViewAssetPath('asset://demo.html'), 'demo.html');
      expect(fjsWebViewAssetPath('asset:///demo.html'), 'demo.html');
      expect(fjsWebViewAssetPath('asset://../secret'), isNull);
      expect(fjsWebViewAssetPath('asset://'), isNull);
    });

    test('asset:// goes to the dev server while fjs dev is connected', () {
      final target = fjsResolveWebViewSrc(
        'asset://demo.html',
        devUri: Uri.parse('http://127.0.0.1:38900/'),
      );
      expect(target.url, 'http://127.0.0.1:38900/modules/webview/demo.html');
      expect(target.asset, isNull);
    });

    test('asset:// is a Flutter asset without one', () {
      final target = fjsResolveWebViewSrc('asset://demo.html');
      // loadFlutterAsset takes a key, not a URL — hence the separate shape
      expect(target.asset, 'assets/fjs/modules/webview/demo.html');
      expect(target.url, isNull);
      expect(target.droppedQuery, isFalse);
    });

    test('an asset key cannot carry a query, and the drop is reported', () {
      // Found in a release build: FWFURLParsingError, because
      // `demo.html?q=hello` is not a key in the bundle manifest. Dev keeps
      // the query, so silence here would make dev and release differ.
      final release = fjsResolveWebViewSrc('asset://demo.html?q=hello');
      expect(release.asset, 'assets/fjs/modules/webview/demo.html');
      expect(release.droppedQuery, isTrue);

      final dev = fjsResolveWebViewSrc(
        'asset://demo.html?q=hello',
        devUri: Uri.parse('http://127.0.0.1:38900'),
      );
      expect(dev.url, 'http://127.0.0.1:38900/modules/webview/demo.html?q=hello');
      expect(dev.droppedQuery, isFalse);
    });

    test('strips a fragment too', () {
      expect(fjsWebViewStripQuery('a.html#top'), 'a.html');
      expect(fjsWebViewStripQuery('a.html'), 'a.html');
    });

    test('http is left alone either way', () {
      expect(fjsResolveWebViewSrc('https://example.com/a').url,
          'https://example.com/a');
      expect(
        fjsResolveWebViewSrc('https://example.com/a',
                devUri: Uri.parse('http://127.0.0.1:38900'))
            .url,
        'https://example.com/a',
      );
    });

    test('nothing to load for empty and unsupported', () {
      expect(fjsResolveWebViewSrc('').isNothing, isTrue);
      expect(fjsResolveWebViewSrc('file:///x').isNothing, isTrue);
      expect(fjsResolveWebViewSrc('asset://../x').isNothing, isTrue);
    });
  });

  group('load cycle', () {
    test('reports one terminal event per load', () {
      final cycle = FjsWebViewLoadCycle();
      final generation = cycle.begin();
      expect(cycle.finish(generation), isTrue);
      // error after load, or a second onPageFinished, is not a second event
      expect(cycle.finish(generation), isFalse);
    });

    test('drops the previous page after the src changes', () {
      final cycle = FjsWebViewLoadCycle();
      final first = cycle.begin();
      final second = cycle.begin();
      expect(cycle.finish(first), isFalse);
      expect(cycle.finish(second), isTrue);
    });

    test('accepts messages only from the current page', () {
      final cycle = FjsWebViewLoadCycle();
      final first = cycle.begin();
      expect(cycle.accepts(first), isTrue);
      cycle.begin();
      expect(cycle.accepts(first), isFalse);
    });
  });

  group('box', () {
    test('needs a bounded height, because a page has no natural one', () {
      expect(
        fjsWebViewFitsBox(const BoxConstraints.tightFor(width: 300, height: 200)),
        isTrue,
      );
      expect(
        fjsWebViewFitsBox(const BoxConstraints(maxWidth: 300)),
        isFalse,
      );
    });
  });

  group('widget', () {
    testWidgets('an empty src builds nothing at all', (tester) async {
      final events = <(int, String?)>[];
      await tester.pumpWidget(MaterialApp(
        home: FjsWebViewWidget(
          node: nodeWith(const {}),
          dispatch: (id, type, {String? text}) => events.add((type, text)),
        ),
      ));
      expect(find.byType(SizedBox), findsOneWidget);
      expect(events, isEmpty);
    });

    testWidgets('an unsupported scheme warns once and loads nothing',
        (tester) async {
      final logs = <String>[];
      final original = debugPrint;
      debugPrint = (message, {wrapWidth}) => logs.add(message ?? '');
      try {
        await tester.pumpWidget(MaterialApp(
          home: FjsWebViewWidget(
            node: nodeWith(const {'src': 'file:///etc/passwd'}),
            dispatch: (id, type, {String? text}) {},
          ),
        ));
      } finally {
        debugPrint = original;
      }
      expect(logs.where((l) => l.contains('file:///etc/passwd')), isNotEmpty);
    });
  });
}
