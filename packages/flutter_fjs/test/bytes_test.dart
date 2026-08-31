import 'dart:convert' show utf8;
import 'dart:io' show gzip;
import 'dart:typed_data';

import 'package:flutter_fjs/src/bytes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fjsMaybeGunzip leaves plain bytes unchanged', () {
    final bytes = Uint8List.fromList([0x46, 0x4a, 0x53, 0x42]);

    expect(identical(fjsMaybeGunzip(bytes), bytes), isTrue);
  });

  test('fjsMaybeGunzip expands gzip bytes', () {
    final plain = Uint8List.fromList(utf8.encode('FJSB bytecode payload'));
    final zipped = Uint8List.fromList(gzip.encode(plain));

    expect(fjsMaybeGunzip(zipped), plain);
  });
}
