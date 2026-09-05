// Decoded images, by the handle the JS side allocated.
//
// The pixels stay here on purpose: a decoded bitmap is the one thing in the
// canvas subsystem that must not cross the boundary (v1 passes scalars, and
// base64'ing a texture per frame would dwarf everything else the frame
// costs). JS holds a number, this table holds the ui.Image.
//
// Not in display_list.dart because images outlive any one canvas: two
// canvases can draw the same loaded image, and a canvas that is torn down
// and rebuilt on a route change should not have to decode it again.
import 'dart:typed_data';
import 'dart:ui' as ui;

class FjsCanvasImages {
  FjsCanvasImages._();

  static final FjsCanvasImages instance = FjsCanvasImages._();

  final Map<int, ui.Image> _byHandle = {};

  ui.Image? lookup(int handle) => _byHandle[handle];

  void put(int handle, ui.Image image) {
    _byHandle[handle]?.dispose();
    _byHandle[handle] = image;
  }

  void remove(int handle) {
    _byHandle.remove(handle)?.dispose();
  }

  /// Drops everything. Called when the VM is reset: the handles were the old
  /// VM's, and the next one starts numbering from 1 again.
  void clear() {
    for (final image in _byHandle.values) {
      image.dispose();
    }
    _byHandle.clear();
  }

  /// Decodes [bytes] and files it under [handle].
  static Future<ui.Image> decode(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  }
}
