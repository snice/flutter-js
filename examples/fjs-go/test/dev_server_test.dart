// Address parsing is the one piece of fjs go that users hit blind (typing a
// LAN address on a phone), so it carries the tests.
import 'package:flutter_test/flutter_test.dart';
import 'package:fjs_go/src/dev_server.dart';

void main() {
  test('host:port', () {
    final s = DevServer.parse('192.168.1.20:38900');
    expect(s.host, '192.168.1.20');
    expect(s.port, 38900);
  });

  test('bare host takes the default port', () {
    expect(DevServer.parse('10.0.2.2').port, DevServer.defaultPort);
  });

  test('a pasted url from fjs dev works verbatim', () {
    final s = DevServer.parse('http://192.168.1.20:38900/bundle.js');
    expect(s.host, '192.168.1.20');
    expect(s.port, 38900);
    expect(s.bundleUrl.toString(), 'http://192.168.1.20:38900/bundle.js');
  });

  test('trailing path on a host:port form is ignored', () {
    expect(DevServer.parse('192.168.1.20:38900/bundle.js').port, 38900);
  });

  test('surrounding whitespace is trimmed', () {
    expect(DevServer.parse('  10.0.2.2:38900 ').host, '10.0.2.2');
  });

  test('bad input reports instead of throwing something opaque', () {
    expect(() => DevServer.parse(''), throwsFormatException);
    expect(() => DevServer.parse('host:notaport'), throwsFormatException);
  });

  test('equality drives the recent-servers de-dup', () {
    expect(DevServer.parse('a:1'), DevServer.parse('a:1'));
    expect(DevServer.parse('a:1'), isNot(DevServer.parse('a:2')));
  });
}
