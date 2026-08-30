// Byte helpers for the engine's program-loading APIs.
import 'dart:io' show gzip;
import 'dart:typed_data';

extension FjsByteData on ByteData {
  /// The bytes this view covers, as a [Uint8List], without copying.
  ///
  /// `rootBundle.load()` returns a view into a larger shared buffer, so a
  /// bare `buffer.asUint8List()` would hand the engine everything that
  /// happens to sit in that buffer. This keeps the view's window:
  ///
  /// ```dart
  /// final asset = await rootBundle.load('assets/app.fjsbundle');
  /// engine.runBundle(asset.toUint8List());
  /// ```
  Uint8List toUint8List() => buffer.asUint8List(offsetInBytes, lengthInBytes);
}

/// Returns decompressed bytes when [bytes] is gzip data, otherwise [bytes].
Uint8List fjsMaybeGunzip(Uint8List bytes) {
  if (bytes.length < 2 || bytes[0] != 0x1f || bytes[1] != 0x8b) {
    return bytes;
  }
  return Uint8List.fromList(gzip.decode(bytes));
}
