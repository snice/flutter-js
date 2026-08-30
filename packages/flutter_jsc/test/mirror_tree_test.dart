// Decoder round-trip against frames matching fjs-runtime's OpWriter
// encoding (hand-encoded here to avoid a Node dependency in Dart tests).
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_jsc/src/mirror_tree.dart';
import 'package:flutter_jsc/src/ui_ops.dart';

class _W {
  final List<int> b = [];
  void u8(int v) => b.add(v & 0xff);
  void u16(int v) => b..add(v & 0xff)..add((v >> 8) & 0xff);
  void u32(int v) {
    final d = ByteData(4)..setUint32(0, v, Endian.little);
    b.addAll(d.buffer.asUint8List());
  }

  void str(String s) => b.addAll(utf8.encode(s));
  void raw(List<int> l) => b.addAll(l);
}

void main() {
  test('create/insert/setText/setProps frame applies', () {
    final w = _W();
    // create #1 'view'
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    // insert parent=0 child=1 index=0
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // create #2 'text' + text + props, insert into #1
    w.u8(UiOpCode.create);
    w.u32(2);
    w.u16(4);
    w.str('text');
    w.u8(UiOpCode.setText);
    w.u32(2);
    w.u32(5);
    w.str('hello');
    w.u8(UiOpCode.setProps);
    w.u32(2);
    final json = utf8.encode('{"style":{"fontSize":20}}');
    w.u32(json.length);
    w.raw(json);
    w.u8(UiOpCode.insert);
    w.u32(1);
    w.u32(2);
    w.u32(0);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.version, 1);
    expect(tree.rootChildren, [1]);
    expect(tree.node(1)!.tag, 'view');
    expect(tree.node(1)!.children, [2]);
    expect(tree.node(2)!.text, 'hello');
    expect((tree.node(2)!.props['style'] as Map)['fontSize'], 20);
  });

  test('removeChild and remove detach nodes', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // removeChild parent=0 child=1, then remove #1
    w.u8(UiOpCode.removeChild);
    w.u32(0);
    w.u32(1);
    w.u8(UiOpCode.remove);
    w.u32(1);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));
    expect(tree.rootChildren, isEmpty);
    expect(tree.node(1), isNull);
  });

  test('setProps merges per-key patches instead of replacing', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(6);
    w.str('button');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // event marker first...
    w.u8(UiOpCode.setProps);
    w.u32(1);
    var json = utf8.encode('{"onTap":true}');
    w.u32(json.length);
    w.raw(json);
    // ...then a style flush from the style engine
    w.u8(UiOpCode.setProps);
    w.u32(1);
    json = utf8.encode('{"style":{"margin":4}}');
    w.u32(json.length);
    w.raw(json);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.node(1)!.props['onTap'], true);
    expect((tree.node(1)!.props['style'] as Map)['margin'], 4);
  });

  test('frames replay deterministically into a cleared tree', () {
    // one session: view#1 { text#2 'hi', button#3 'go' with onTap marker }
    final List<int> session;
    {
      final w = _W();
      w.u8(UiOpCode.create);
      w.u32(1);
      w.u16(4);
      w.str('view');
      w.u8(UiOpCode.insert);
      w.u32(0);
      w.u32(1);
      w.u32(0);
      w.u8(UiOpCode.create);
      w.u32(2);
      w.u16(4);
      w.str('text');
      w.u8(UiOpCode.setText);
      w.u32(2);
      w.u32(2);
      w.str('hi');
      w.u8(UiOpCode.insert);
      w.u32(1);
      w.u32(2);
      w.u32(0);
      w.u8(UiOpCode.create);
      w.u32(3);
      w.u16(6);
      w.str('button');
      w.u8(UiOpCode.setProps);
      w.u32(3);
      var json = utf8.encode('{"onTap":true}');
      w.u32(json.length);
      w.raw(json);
      w.u8(UiOpCode.setText);
      w.u32(3);
      w.u32(2);
      w.str('go');
      w.u8(UiOpCode.insert);
      w.u32(1);
      w.u32(3);
      w.u32(1);
      session = w.b;
    }

    MirrorTree play() {
      final tree = MirrorTree();
      tree.applyFrame(Uint8List.fromList(session));
      return tree;
    }

    final live = play();
    // restore path: fresh tree (clear bumps generation), replay same frames
    final restored = MirrorTree();
    restored.clear();
    restored.applyFrame(Uint8List.fromList(session));

    for (final id in [1, 2, 3]) {
      expect(restored.node(id)!.tag, live.node(id)!.tag);
      expect(restored.node(id)!.text, live.node(id)!.text);
      expect(restored.node(id)!.props, live.node(id)!.props);
      expect(restored.node(id)!.children, live.node(id)!.children);
    }
    expect(restored.rootChildren, live.rootChildren);
  });

  test('re-inserting a child moves it instead of mounting it twice', () {
    final w = _W();
    w.u8(UiOpCode.create);
    w.u32(1);
    w.u16(4);
    w.str('view');
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    // a fresh VM re-inserts the same root id (snapshot restore path) and
    // keyed diffs re-insert moved children — both must detach first
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);
    w.u8(UiOpCode.insert);
    w.u32(0);
    w.u32(1);
    w.u32(0);

    final tree = MirrorTree();
    tree.applyFrame(Uint8List.fromList(w.b));

    expect(tree.rootChildren, [1]);
  });

  test('truncated frame throws with offset', () {
    final tree = MirrorTree();
    expect(() => tree.applyFrame(Uint8List.fromList([UiOpCode.create, 1])),
        throwsA(isA<UiOpException>()));
  });
}
