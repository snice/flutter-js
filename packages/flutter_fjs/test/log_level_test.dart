// The level a console line carries is an int all the way from the native
// side; these pin the mapping the hosts print names from.
import 'package:flutter_fjs/flutter_fjs.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('levels match the native FJS_LOG_* values', () {
    expect(FjsLogLevel.debug.index, 0);
    expect(FjsLogLevel.info.index, 1);
    expect(FjsLogLevel.warn.index, 2);
    expect(FjsLogLevel.error.index, 3);
  });

  test('of() names every level the console can produce', () {
    expect(FjsLogLevel.of(0).name, 'debug');
    expect(FjsLogLevel.of(1).name, 'info');
    expect(FjsLogLevel.of(2).name, 'warn');
    expect(FjsLogLevel.of(3).name, 'error');
  });

  test('an unknown level reads as info instead of throwing', () {
    // a log line must never be the thing that brings the app down
    expect(FjsLogLevel.of(99), FjsLogLevel.info);
    expect(FjsLogLevel.of(-1), FjsLogLevel.info);
  });
}
