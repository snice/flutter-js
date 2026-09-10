// WebglChunkDecoder against fake bindings: the encoding is pinned byte-for-
// byte by fjs-runtime's test/webgl-protocol.test.ts on the other side; here
// we pin that the decoder dispatches the same schema faithfully, resolves
// per-chunk string interns, and fails loudly on a corrupted stream instead
// of executing garbage (constitution V). No GPU is involved.
import 'dart:convert';
import 'dart:typed_data';

import 'package:fjs_webgl/src/replay.dart';
import 'package:flutter_fjs/flutter_fjs.dart'
    show CanvasOpException, MirrorNode;
import 'package:flutter_test/flutter_test.dart';

/// Records calls as (method, args) pairs.
class FakeBindings extends FjsGlBindings {
  final List<(String, List<Object?>)> calls = [];
  final Set<int> created = {};
  final Map<int, String> shaderSources = {};

  void record(String method, [List<Object?> args = const []]) =>
      calls.add((method, args));

  // resources
  @override
  void createBuffer(int id) => created.add(id);
  @override
  void deleteBuffer(int id) => record('deleteBuffer', [id]);
  @override
  void createFramebuffer(int id) {}
  @override
  void deleteFramebuffer(int id) {}
  @override
  void createProgram(int id) {}
  @override
  void deleteProgram(int id) {}
  @override
  void createRenderbuffer(int id) {}
  @override
  void deleteRenderbuffer(int id) {}
  @override
  void createShader(int id, int type) => record('createShader', [id, type]);
  @override
  void deleteShader(int id) {}
  @override
  void createTexture(int id) {}
  @override
  void deleteTexture(int id) {}
  @override
  void createVertexArray(int id) => record('createVertexArray', [id]);
  @override
  void deleteVertexArray(int id) => record('deleteVertexArray', [id]);

  // binding & state
  @override
  void activeTexture(int unit) {}
  @override
  void bindBuffer(int target, int id) => record('bindBuffer', [target, id]);
  @override
  void bindFramebuffer(int target, int id) {}
  @override
  void bindRenderbuffer(int target, int id) {}
  @override
  void bindTexture(int target, int id) {}
  @override
  void bindVertexArray(int id) => record('bindVertexArray', [id]);
  @override
  void blendColor(double r, double g, double b, double a) {}
  @override
  void blendEquation(int mode) {}
  @override
  void blendEquationSeparate(int modeRgb, int modeAlpha) {}
  @override
  void blendFunc(int sfactor, int dfactor) {}
  @override
  void blendFuncSeparate(int srcRgb, int dstRgb, int srcAlpha, int dstAlpha) {}
  @override
  void clearColor(double r, double g, double b, double a) =>
      record('clearColor', [r, g, b, a]);
  @override
  void clearDepth(double depth) {}
  @override
  void clearStencil(int s) {}
  @override
  void colorMask(bool r, bool g, bool b, bool a) {}
  @override
  void cullFace(int mode) {}
  @override
  void depthFunc(int func) {}
  @override
  void depthMask(bool flag) {}
  @override
  void depthRange(double zNear, double zFar) {}
  @override
  void disable(int cap) {}
  @override
  void enable(int cap) {}
  @override
  void frontFace(int mode) {}
  @override
  void hint(int target, int mode) {}
  @override
  void lineWidth(double width) {}
  @override
  void pixelStorei(int pname, int param) {}
  @override
  void polygonOffset(double factor, double units) {}
  @override
  void sampleCoverage(double value, bool invert) {}
  @override
  void scissor(int x, int y, int width, int height) {}
  @override
  void stencilFunc(int func, int ref, int mask) {}
  @override
  void stencilFuncSeparate(int face, int func, int ref, int mask) {}
  @override
  void stencilMask(int mask) {}
  @override
  void stencilMaskSeparate(int face, int mask) {}
  @override
  void stencilOp(int fail, int zfail, int zpass) {}
  @override
  void stencilOpSeparate(int face, int fail, int zfail, int zpass) {}
  @override
  void viewport(int x, int y, int width, int height) =>
      record('viewport', [x, y, width, height]);

  // data upload
  @override
  void bufferData(int target, Uint8List data, int usage) =>
      record('bufferData', [target, data, usage]);
  @override
  void bufferDataSize(int target, int size, int usage) {}
  @override
  void bufferSubData(int target, int offset, Uint8List data) {}
  @override
  void texImage2D(int target, int level, int internalformat, int width,
      int height, int border, int format, int type, Uint8List pixels) {}
  @override
  void texImage2DSource(int target, int level, int internalformat,
      int format, int type, int handle, bool flipY) {
    record('texImage2DSource', [target, level, internalformat, format, type, handle, flipY]);
  }
  @override
  void texSubImage2D(int target, int level, int xoffset, int yoffset,
      int width, int height, int format, int type, Uint8List pixels) {}
  @override
  void texSubImage2DSource(int target, int level, int xoffset, int yoffset,
      int format, int type, int handle, bool flipY) {
    record('texSubImage2DSource', [target, level, xoffset, yoffset, format, type, handle, flipY]);
  }
  @override
  void texStorage2D(int target, int levels, int internalformat, int width,
      int height) {
    record('texStorage2D', [target, levels, internalformat, width, height]);
  }
  @override
  void texImage3D(int target, int level, int internalformat, int width,
      int height, int depth, int border, int format, int type,
      Uint8List pixels) {
    record('texImage3D', [target, width, height, depth]);
  }
  @override
  void texSubImage3D(int target, int level, int xoffset, int yoffset,
      int zoffset, int width, int height, int depth, int format, int type,
      Uint8List pixels) {
    record('texSubImage3D', [target, xoffset, yoffset, zoffset, depth]);
  }
  @override
  void texParameterf(int target, int pname, double param) {}
  @override
  void texParameteri(int target, int pname, int param) {}
  @override
  void generateMipmap(int target) {}

  // program
  @override
  void shaderSource(int shader, String source) {
    record('shaderSource', [shader]);
    shaderSources[shader] = source;
  }

  @override
  void compileShader(int shader) {}
  @override
  void attachShader(int program, int shader) {}
  @override
  void detachShader(int program, int shader) {}
  @override
  void linkProgram(int program) {}
  @override
  void useProgram(int id) => record('useProgram', [id]);
  @override
  void validateProgram(int program) {}
  @override
  void bindAttribLocation(int program, int index, String name) {}

  // vertex
  @override
  void enableVertexAttribArray(int index) {}
  @override
  void disableVertexAttribArray(int index) {}
  @override
  void vertexAttribPointer(
      int index, int size, int type, bool normalized, int stride, int offset) {
    record('vertexAttribPointer', [index, size, type, normalized, offset]);
  }

  @override
  void vertexAttribDivisor(int index, int divisor) {
    record('vertexAttribDivisor', [index, divisor]);
  }

  @override
  void vertexAttrib1f(int index, double x) {}
  @override
  void vertexAttrib2f(int index, double x, double y) {}
  @override
  void vertexAttrib3f(int index, double x, double y, double z) {}
  @override
  void vertexAttrib4f(int index, double x, double y, double z, double w) {}
  @override
  void vertexAttrib1fv(int index, Float32List v) {}
  @override
  void vertexAttrib2fv(int index, Float32List v) {}
  @override
  void vertexAttrib3fv(int index, Float32List v) {}
  @override
  void vertexAttrib4fv(int index, Float32List v) {}

  // uniform
  @override
  void uniform1i(int location, int x) {}
  @override
  void uniform2i(int location, int x, int y) {}
  @override
  void uniform3i(int location, int x, int y, int z) {}
  @override
  void uniform4i(int location, int x, int y, int z, int w) {}
  @override
  void uniform1f(int location, double x) {}
  @override
  void uniform2f(int location, double x, double y) {}
  @override
  void uniform3f(int location, double x, double y, double z) {}
  @override
  void uniform4f(int location, double x, double y, double z, double w) {}
  @override
  void uniform1iv(int location, Int32List v) {}
  @override
  void uniform2iv(int location, Int32List v) {}
  @override
  void uniform3iv(int location, Int32List v) {}
  @override
  void uniform4iv(int location, Int32List v) {}
  @override
  void uniform1fv(int location, Float32List v) {}
  @override
  void uniform2fv(int location, Float32List v) {}
  @override
  void uniform3fv(int location, Float32List v) {}
  @override
  void uniform4fv(int location, Float32List v) {}
  @override
  void uniformMatrix2fv(int location, bool transpose, Float32List v) {}
  @override
  void uniformMatrix3fv(int location, bool transpose, Float32List v) {}
  @override
  void uniformMatrix4fv(int location, bool transpose, Float32List v) =>
      record('uniformMatrix4fv', [location, transpose, v]);

  // draw
  @override
  void clear(int mask) => record('clear', [mask]);
  @override
  void drawArrays(int mode, int first, int count) =>
      record('drawArrays', [mode, first, count]);
  @override
  void drawElements(int mode, int count, int type, int offset) {}
  @override
  void finish() {}
  @override
  void flush() {}

  // framebuffer
  @override
  void framebufferTexture2D(
      int target, int attachment, int textarget, int texture, int level) {}
  @override
  void framebufferRenderbuffer(
      int target, int attachment, int renderbuffertarget, int renderbuffer) {}
  @override
  void renderbufferStorage(
      int target, int internalformat, int width, int height) {}
}

/// Minimal chunk writer — the mirror of webgl/protocol.ts, sufficient for
/// the commands these tests pin.
class ChunkWriter {
  final bytes = BytesBuilder();
  final strings = <String, int>{};

  void u8(int v) => bytes.addByte(v & 0xff);
  void u16(int v) => bytes
    ..addByte(v & 0xff)
    ..addByte((v >> 8) & 0xff);
  void u32(int v) => bytes.add([
        v & 0xff,
        (v >> 8) & 0xff,
        (v >> 16) & 0xff,
        (v >> 24) & 0xff,
      ]);
  void f32(double v) =>
      bytes.add((Float32List.fromList([v]).buffer).asUint8List());

  int str(String s) {
    final existing = strings[s];
    if (existing != null) return existing;
    final id = strings.length + 1;
    strings[s] = id;
    u16(WebglCmd.strDef);
    u16(id);
    final encoded = utf8.encode(s);
    u16(encoded.length);
    bytes.add(encoded);
    return id;
  }

  void cmd(int c) => u16(c);
  Uint8List take() => bytes.takeBytes();
}

void main() {
  test('draw sequence: buffer, vertex attrib, matrix, draw', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    w.cmd(WebglCmd.bindBuffer);
    w.u32(0x8892);
    w.u32(1);
    w.cmd(WebglCmd.bufferData);
    w.u32(0x8892);
    w.u32(0x88e4);
    w.u32(4);
    w.bytes.add([9, 8, 7, 6]);
    w.cmd(WebglCmd.vertexAttribPointer);
    w.u32(0);
    w.u32(3);
    w.u32(0x1406);
    w.u8(0);
    w.u32(0);
    w.u32(0);
    w.cmd(WebglCmd.drawArrays);
    w.u32(4);
    w.u32(0xFFFFFFFF); // i32 first = -1 on the wire
    w.u32(3);

    decoder.run(w.take());

    expect(fake.calls, hasLength(4));
    // records hold List<Object?>, so compare field by field
    expect(fake.calls[0].$1, 'bindBuffer');
    expect(fake.calls[0].$2, hasLength(2));
    expect(fake.calls[0].$2[0], 0x8892);
    expect(fake.calls[0].$2[1], 1);
    final (_, bufferDataArgs) = fake.calls[1];
    expect(bufferDataArgs[0], 0x8892);
    expect(bufferDataArgs[1], Uint8List.fromList([9, 8, 7, 6]));
    final (_, drawArgs) = fake.calls[3];
    expect(drawArgs, [4, -1, 3]);
  });

  test('per-chunk string interns resolve inside the chunk', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    final id = w.str('void main() { gl_FragColor = vec4(1.0); }');
    w.cmd(WebglCmd.shaderSource);
    w.u32(7);
    w.u16(id);
    // second reference to the same intern in the same chunk
    w.cmd(WebglCmd.shaderSource);
    w.u32(8);
    w.u16(id);

    decoder.run(w.take());

    expect(fake.shaderSources[7], 'void main() { gl_FragColor = vec4(1.0); }');
    expect(fake.shaderSources[8], same(fake.shaderSources[7]));
  });

  test('a chunk referencing an intern from an older chunk fails loudly', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);

    final first = ChunkWriter();
    final id = first.str('only in chunk one');
    first.cmd(WebglCmd.shaderSource);
    first.u32(1);
    first.u16(id);
    decoder.run(first.take());

    // chunk two reuses the handle — the JS writer resets its table per
    // chunk, so this can only mean a broken stream
    final second = ChunkWriter();
    second.cmd(WebglCmd.shaderSource);
    second.u32(2);
    second.u16(id);
    expect(() => decoder.run(second.take()), throwsA(isA<CanvasOpException>()));
  });

  test('unknown command aborts the chunk instead of executing garbage', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();
    w.cmd(0x0999); // WebGL2 territory, unimplemented here
    w.u32(1);
    w.cmd(WebglCmd.drawArrays); // must never run
    w.u32(4);
    w.u32(0);
    w.u32(3);

    expect(() => decoder.run(w.take()), throwsA(isA<CanvasOpException>()));
    expect(fake.calls.where((c) => c.$1 == 'drawArrays'), isEmpty);
  });

  test('vertex array create/bind/delete round-trips (spec 023)', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    w.cmd(WebglCmd.createVertexArray);
    w.u32(9);
    w.cmd(WebglCmd.bindVertexArray);
    w.u32(9);
    w.cmd(WebglCmd.bindVertexArray);
    w.u32(0); // unbind — the DOM's null object
    w.cmd(WebglCmd.deleteVertexArray);
    w.u32(9);

    decoder.run(w.take());

    final names = fake.calls.map((c) => c.$1).toList();
    expect(names, ['createVertexArray', 'bindVertexArray', 'bindVertexArray', 'deleteVertexArray']);
    expect(fake.calls[0].$2, [9]);
    expect(fake.calls[1].$2, [9]);
    expect(fake.calls[2].$2, [0]);
    expect(fake.calls[3].$2, [9]);
  });

  test('texImage2DSource carries the flipY flag', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    for (final flip in [0, 1]) {
      w.cmd(WebglCmd.texImage2DSource);
      w.u32(0x0de1); // TEXTURE_2D
      w.u32(0); // level
      w.u32(0x1908); // internalformat RGBA
      w.u32(0x1908); // format
      w.u32(0x1401); // type UNSIGNED_BYTE
      w.u32(1); // TexSource.imageHandle
      w.u32(4); // image handle
      w.u8(flip);
    }

    decoder.run(w.take());

    expect(fake.calls[0].$2[6], isFalse);
    expect(fake.calls[1].$2[6], isTrue);
  });

  test('texStorage2D + texSubImage2D(source) round-trips (spec 023)', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    w.cmd(WebglCmd.texStorage2D);
    w.u32(0x0de1); // TEXTURE_2D
    w.u32(1); // levels
    w.u32(0x8058); // RGBA8
    w.u32(512);
    w.u32(256);
    w.cmd(WebglCmd.texSubImage2DSource);
    w.u32(0x0de1);
    w.u32(0); // level
    w.u32(0); // x
    w.u32(0); // y
    w.u32(0x1908); // format RGBA
    w.u32(0x1401); // type UNSIGNED_BYTE
    w.u32(1); // TexSource.imageHandle
    w.u32(4); // image handle
    w.u8(1); // flipY

    decoder.run(w.take());

    expect(fake.calls, hasLength(2));
    expect(fake.calls[0].$1, 'texStorage2D');
    expect(fake.calls[0].$2, [0x0de1, 1, 0x8058, 512, 256]);
    expect(fake.calls[1].$1, 'texSubImage2DSource');
    expect(fake.calls[1].$2, [0x0de1, 0, 0, 0, 0x1908, 0x1401, 4, true]);
  });

  test('texImage3D / texSubImage3D round-trip with depth (spec 023)', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    w.cmd(WebglCmd.texImage3D);
    w.u32(0x806f); // TEXTURE_3D
    w.u32(0); // level
    w.u32(0x1908); // RGBA
    w.u32(2);
    w.u32(2);
    w.u32(2); // depth
    w.u32(0); // border
    w.u32(0x1908);
    w.u32(0x1401);
    w.u32(4); // bytes (tiny; sizes don't matter to the decoder)
    w.bytes.add([1, 2, 3, 4]);
    w.cmd(WebglCmd.texSubImage3D);
    w.u32(0x806f);
    w.u32(0);
    w.u32(0);
    w.u32(0);
    w.u32(1); // z
    w.u32(2);
    w.u32(2);
    w.u32(1);
    w.u32(0x1908);
    w.u32(0x1401);
    w.u32(0); // empty payload

    decoder.run(w.take());

    expect(fake.calls[0].$1, 'texImage3D');
    expect(fake.calls[0].$2, [0x806f, 2, 2, 2]);
    expect(fake.calls[1].$1, 'texSubImage3D');
    expect(fake.calls[1].$2, [0x806f, 0, 0, 1, 1]);
  });

  test('StrDef32 interns strings longer than 64 KiB (spec 023)', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();

    // strDef32: u16 cmd, u16 str id, u32 len, utf8
    w.cmd(WebglCmd.strDef32);
    w.u16(1);
    final longSource = 'void main() { //' + ('x' * 70000) + '}';
    final encoded = utf8.encode(longSource);
    final len = encoded.length;
    w.u32(len);
    w.bytes.add(encoded);
    w.cmd(WebglCmd.shaderSource);
    w.u32(7);
    w.u16(1);

    decoder.run(w.take());

    expect(fake.shaderSources[7], longSource);
  });

  test('mat4 uniform keeps transpose and all 16 floats', () {
    final fake = FakeBindings();
    final decoder = WebglChunkDecoder(fake);
    final w = ChunkWriter();
    final matrix = [for (var i = 0; i < 16; i++) i.toDouble()];
    w.cmd(WebglCmd.uniformMatrix4fv);
    w.u32(12);
    w.u8(1); // transpose
    w.u32(16);
    for (final v in matrix) {
      w.f32(v);
    }
    decoder.run(w.take());

    final (_, args) = fake.calls.single;
    expect(args[0], 12);
    expect(args[1], isTrue);
    expect(args[2], Float32List.fromList(matrix));
  });

  test('pre-context program queries answer counts as 0, not true', () {
    // A count answered with `true` reads as 1 in JS, so three.js walked a
    // one-entry uniform list and crashed on the getActiveUniform(program, 0)
    // this branch cannot answer either (spec 023, iOS simulator).
    const node = 4242;
    final gl = FjsWebglRuntime.instance;
    addTearDown(() => gl.disposeNode(node));

    expect(gl.query(node, 'getProgramParameter', [1, 0x8b82]), isTrue);
    expect(gl.query(node, 'getProgramParameter', [1, 0x8b86]), 0);
    expect(gl.query(node, 'getProgramParameter', [1, 0x8b89]), 0);
    expect(gl.query(node, 'getShaderParameter', [1, 0x8b81]), isTrue);
    // A caller that asks past the 0 count still gets a walkable entry
    expect(gl.query(node, 'getActiveUniform', [1, 0]), isA<String>());
    expect(gl.query(node, 'contextReady', []), isFalse);
  });

  test('layerReady on a node with no texture neither throws nor presents', () {
    // The view calls this from a post-frame callback on every build that has
    // a texture id, and a node can be torn down between the build and that
    // callback. It must be a no-op then, not a crash inside a framework
    // callback (constitution V).
    //
    // NOTE ON COVERAGE (spec 028): this is as far as widget tests reach.
    // `pump` and `present` need a real FlutterAngle, so the three invariants
    // this spec turns on — one present per Flutter frame, drain-before-
    // present, and the Apple pre-swap sync — are verified ON DEVICE, not
    // here. A green `flutter test` is NOT regression cover for them.
    const node = 4343;
    final gl = FjsWebglRuntime.instance;
    addTearDown(() => gl.disposeNode(node));

    expect(() => gl.layerReady(node), returnsNormally);
    expect(gl.textureId(node), isNull);
    // an unknown node id is equally harmless
    expect(() => gl.layerReady(999999), returnsNormally);
  });

  test('the mirror node queues webgl chunks as opaque bytes', () {
    // op 11 lands on MirrorNode.webglChunks (core, plain data); this module
    // drains and executes them — the queue itself is not module state
    final node = MirrorNode(7, 'inner-canvas');
    expect(node.webglChunks, isEmpty);
    node.webglChunks.add(Uint8List.fromList([1]));
    node.webglChunks.add(Uint8List.fromList([2]));
    expect(node.webglChunks, hasLength(2));
  });
}
