// Mirror tree: the Dart-side copy of the JS virtual node tree, updated by
// applying UI op frames. The widget layer walks it to build Flutter
// widgets. IDs and semantics mirror fjs-runtime's node handles.
import 'dart:convert';
import 'dart:typed_data';

import 'ui_ops.dart';

class MirrorNode {
  MirrorNode(this.id, this.tag);

  final int id;
  String tag;
  String? text;
  Map<String, Object?> props = const {};
  final List<int> children = [];
}

class UiOpException implements Exception {
  UiOpException(this.message);
  final String message;
  @override
  String toString() => 'UiOpException: $message';
}

/// Applies op frames and notifies listeners (the engine wires this to
/// setState). ids: node handles from JS; 0 is the root container.
class MirrorTree {
  final Map<int, MirrorNode> _nodes = {};
  final List<int> _rootChildren = [];
  final Map<int, int> _parentOf = {};
  int _version = 0;
  int _generation = 0;

  /// Monotonic change counter; widgets watch it to decide rebuilds.
  int get version => _version;

  /// Bumped by [clear]; a new generation means the tree was rebuilt from
  /// scratch, so stateful widgets keyed on it must be recreated (otherwise
  /// Flutter reuses Element/State at matching positions and stale input
  /// text / switch state leaks across reloads).
  int get generation => _generation;
  List<int> get rootChildren => List.unmodifiable(_rootChildren);
  MirrorNode? node(int id) => _nodes[id];

  void applyFrame(Uint8List frame) {
    final bd = ByteData.sublistView(frame);
    var p = 0;

    void check(int need) {
      if (p + need > frame.length) {
        throw UiOpException('truncated op frame at offset $p (need $need, '
            'have ${frame.length - p})');
      }
    }

    while (p < frame.length) {
      check(1);
      final op = frame[p++];
      switch (op) {
        case UiOpCode.create:
          check(6);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final tagLen = bd.getUint16(p, Endian.little);
          p += 2;
          check(tagLen);
          final tag = utf8.decode(frame.sublist(p, p + tagLen));
          p += tagLen;
          _nodes[id] = MirrorNode(id, tag);
          break;

        case UiOpCode.remove:
          check(4);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          _removeDeep(id);
          break;

        case UiOpCode.insert:
          check(12);
          final parent = bd.getUint32(p, Endian.little);
          final child = bd.getUint32(p + 4, Endian.little);
          final index = bd.getUint32(p + 8, Endian.little);
          p += 12;
          // move semantics: detach from the previous parent first. Re-inserts
          // are legal (keyed moves, and a fresh VM re-inserting the same root
          // id into a replayed tree) — without the detach the child would end
          // up mounted twice.
          _detach(child);
          final target = _childList(parent);
          // clamp instead of throwing: Vue/patch can produce sparse indexes
          final at = index >= target.length ? target.length : index;
          target.insert(at, child);
          _parentOf[child] = parent;
          break;

        case UiOpCode.removeChild:
          check(8);
          final parent = bd.getUint32(p, Endian.little);
          p += 4;
          final child = bd.getUint32(p, Endian.little);
          p += 4;
          _childList(parent).remove(child);
          if (_parentOf[child] == parent) _parentOf.remove(child);
          break;

        case UiOpCode.setText:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final textLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(textLen);
          final text = utf8.decode(frame.sublist(p, p + textLen));
          p += textLen;
          _nodes[id]?.text = text;
          break;

        case UiOpCode.setProps:
          check(8);
          final id = bd.getUint32(p, Endian.little);
          p += 4;
          final jsonLen = bd.getUint32(p, Endian.little);
          p += 4;
          check(jsonLen);
          final json = utf8.decode(frame.sublist(p, p + jsonLen));
          p += jsonLen;
          final node = _nodes[id];
          if (node != null) {
            // patch semantics: the JS side sends one SetProps per changed
            // key (e.g. an event marker, then a recomputed style), so merge
            // instead of replacing — a replace would drop earlier keys like
            // onTap when the style engine flushes.
            final next = Map<String, Object?>.of(node.props);
            next.addAll(jsonDecode(json) as Map<String, Object?>);
            next.removeWhere((_, v) => v == null);
            node.props = next;
          }
          break;

        default:
          throw UiOpException('unknown op code $op at offset ${p - 1}');
      }
    }
    _version++;
  }

  List<int> _childList(int parent) {
    if (parent == 0) return _rootChildren;
    final node = _nodes[parent];
    if (node == null) {
      throw UiOpException('op references unknown parent $parent');
    }
    return node.children;
  }

  void _removeDeep(int id) {
    final node = _nodes.remove(id);
    if (node == null) return;
    for (final child in List<int>.of(node.children)) {
      _removeDeep(child);
    }
    _detach(id);
    _parentOf.remove(id);
    // detach from any other parent that still references us
    for (final other in _nodes.values) {
      other.children.remove(id);
    }
  }

  /// Removes `id` from whichever parent (element or root) currently holds it.
  /// Parent id 0 is the root container.
  void _detach(int id) {
    final prev = _parentOf[id];
    if (prev == null) return;
    if (prev == 0) {
      _rootChildren.remove(id);
    } else {
      _nodes[prev]?.children.remove(id);
    }
    _parentOf.remove(id);
  }

  /// Removes every node and root edge (used on hot reload / reset).
  void clear() {
    _nodes.clear();
    _rootChildren.clear();
    _parentOf.clear();
    _version++;
    _generation++;
  }
}
