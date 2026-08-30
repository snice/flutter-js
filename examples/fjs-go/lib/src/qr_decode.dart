// QR decoding for camera frames, pure Dart (zxing2).
//
// Split out from the scan screen so it can be tested without a camera: the
// input is a luminance plane, which is exactly what every platform hands us
// and exactly what a test can build.
//
// The usual scanner plugin (mobile_scanner) would bring MLKit along, which
// on iOS forces the deployment target to 15.5 and drops arm64 simulator
// builds, and on Android ships a barcode model in the APK. fjs go opens
// this screen once per debug session; it is not worth any of that.
import 'dart:typed_data';

import 'package:zxing2/qrcode.dart';

/// One camera frame's luminance plane, in a form an isolate accepts: plain
/// data, no platform objects.
class QrFrame {
  const QrFrame({
    required this.bytes,
    required this.rowStride,
    required this.width,
    required this.height,
  });

  /// Row-major luminance, [rowStride] bytes per row.
  final Uint8List bytes;

  /// Bytes per row, which is >= [width]: camera planes are padded.
  final int rowStride;

  final int width;
  final int height;

  /// The text of the first QR code in the frame, or null if there is none.
  ///
  /// Safe to hand to `Isolate.run`: it reads nothing but these fields.
  String? decode() {
    try {
      final source = _LuminancePlane(bytes, rowStride, width, height);
      return QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source))).text;
    } catch (_) {
      // NotFoundException is the normal case — most frames hold no code —
      // and a damaged one (Checksum/Format) is equally "try the next frame"
      return null;
    }
  }
}

/// The luminance plane as ZXing sees it. Both accessors step by stride: the
/// plane is padded, so it is not a plain width*height matrix.
class _LuminancePlane extends LuminanceSource {
  _LuminancePlane(this._bytes, this._rowStride, super.width, super.height);

  final Uint8List _bytes;
  final int _rowStride;

  @override
  Int8List getRow(int y, Int8List? row) {
    final out = (row != null && row.length >= width) ? row : Int8List(width);
    final start = y * _rowStride;
    for (var x = 0; x < width; x++) {
      out[x] = _bytes[start + x].toSigned(8);
    }
    return out;
  }

  @override
  Int8List getMatrix() {
    final out = Int8List(width * height);
    for (var y = 0; y < height; y++) {
      final start = y * _rowStride;
      final target = y * width;
      for (var x = 0; x < width; x++) {
        out[target + x] = _bytes[start + x].toSigned(8);
      }
    }
    return out;
  }
}
