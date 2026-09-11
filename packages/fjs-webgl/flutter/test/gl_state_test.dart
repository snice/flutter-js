// Per-canvas context state over one shared GL context (spec 036), against
// fake bindings. What this pins: a new canvas starts at the WebGL defaults
// whatever the previous one left, two canvases taking turns each see their
// own state, a canvas alone pays no extra calls, and the plugin's own GL
// calls are accounted for. No GPU is involved.
//
// NOT covered here: the wiring in FjsWebglRuntime (_activate, present,
// query) needs a real FlutterAngle and is verified on device — see
// specs/036-webgl-context-state-isolation/tasks.md T052–T055.
import 'dart:typed_data';

import 'package:fjs_webgl/src/gl_state.dart';
import 'package:flutter_test/flutter_test.dart';

import 'webgl_replay_test.dart' show FakeBindings;

const w = 300;
const h = 200;

const depthTest = 0x0B71;
const blend = 0x0BE2;
const dither = 0x0BD0;
const front = 0x0404;
const back = 0x0405;
const arrayBuffer = 0x8892;
const framebuffer = 0x8D40;
const renderbuffer = 0x8D41;
const texture0 = 0x84C0;
const texture2d = 0x0DE1;

/// [FakeBindings] records only what the decoder tests need; this also
/// records every context-level setter, so restores are observable. A
/// subclass rather than an edit keeps the decoder tests' call lists as they
/// are.
class StateRecorder extends FakeBindings {
  List<String> get log => [for (final c in calls) '${c.$1}${c.$2}'];

  @override
  void deleteFramebuffer(int id) => record('deleteFramebuffer', [id]);
  @override
  void deleteRenderbuffer(int id) => record('deleteRenderbuffer', [id]);
  @override
  void deleteTexture(int id) => record('deleteTexture', [id]);
  @override
  void activeTexture(int unit) => record('activeTexture', [unit]);
  @override
  void bindFramebuffer(int target, int id) =>
      record('bindFramebuffer', [target, id]);
  @override
  void bindRenderbuffer(int target, int id) =>
      record('bindRenderbuffer', [target, id]);
  @override
  void bindTexture(int target, int id) => record('bindTexture', [target, id]);
  @override
  void blendColor(double r, double g, double b, double a) =>
      record('blendColor', [r, g, b, a]);
  @override
  void blendEquation(int mode) => record('blendEquation', [mode]);
  @override
  void blendEquationSeparate(int modeRgb, int modeAlpha) =>
      record('blendEquationSeparate', [modeRgb, modeAlpha]);
  @override
  void blendFunc(int sfactor, int dfactor) =>
      record('blendFunc', [sfactor, dfactor]);
  @override
  void blendFuncSeparate(int srcRgb, int dstRgb, int srcAlpha, int dstAlpha) =>
      record('blendFuncSeparate', [srcRgb, dstRgb, srcAlpha, dstAlpha]);
  @override
  void clearDepth(double depth) => record('clearDepth', [depth]);
  @override
  void clearStencil(int s) => record('clearStencil', [s]);
  @override
  void colorMask(bool r, bool g, bool b, bool a) =>
      record('colorMask', [r, g, b, a]);
  @override
  void cullFace(int mode) => record('cullFace', [mode]);
  @override
  void depthFunc(int func) => record('depthFunc', [func]);
  @override
  void depthMask(bool flag) => record('depthMask', [flag]);
  @override
  void depthRange(double zNear, double zFar) =>
      record('depthRange', [zNear, zFar]);
  @override
  void disable(int cap) => record('disable', [cap]);
  @override
  void enable(int cap) => record('enable', [cap]);
  @override
  void frontFace(int mode) => record('frontFace', [mode]);
  @override
  void hint(int target, int mode) => record('hint', [target, mode]);
  @override
  void lineWidth(double width) => record('lineWidth', [width]);
  @override
  void pixelStorei(int pname, int param) =>
      record('pixelStorei', [pname, param]);
  @override
  void polygonOffset(double factor, double units) =>
      record('polygonOffset', [factor, units]);
  @override
  void sampleCoverage(double value, bool invert) =>
      record('sampleCoverage', [value, invert]);
  @override
  void scissor(int x, int y, int width, int height) =>
      record('scissor', [x, y, width, height]);
  @override
  void stencilFunc(int func, int ref, int mask) =>
      record('stencilFunc', [func, ref, mask]);
  @override
  void stencilFuncSeparate(int face, int func, int ref, int mask) =>
      record('stencilFuncSeparate', [face, func, ref, mask]);
  @override
  void stencilMask(int mask) => record('stencilMask', [mask]);
  @override
  void stencilMaskSeparate(int face, int mask) =>
      record('stencilMaskSeparate', [face, mask]);
  @override
  void stencilOp(int fail, int zfail, int zpass) =>
      record('stencilOp', [fail, zfail, zpass]);
  @override
  void stencilOpSeparate(int face, int fail, int zfail, int zpass) =>
      record('stencilOpSeparate', [face, fail, zfail, zpass]);
  @override
  void vertexAttrib1f(int index, double x) =>
      record('vertexAttrib1f', [index, x]);
  @override
  void vertexAttrib4f(int index, double x, double y, double z, double w) =>
      record('vertexAttrib4f', [index, x, y, z, w]);
  @override
  void vertexAttrib4fv(int index, Float32List v) =>
      record('vertexAttrib4fv', [index, ...v]);
}

String call(String method, List<Object?> args) => '$method$args';

/// A canvas on [gl], already synced once (so it owns the context), with its
/// recorder cleared.
(TrackedGlBindings, StateRecorder) canvas(GlCurrentState gl) {
  final rec = StateRecorder();
  final t = TrackedGlBindings(rec, gl, width: w, height: h);
  t.sync();
  rec.calls.clear();
  return (t, rec);
}

void main() {
  group('context state isolation (spec 036)', () {
    // Every context-level setter: set a non-default on canvas A, then a new
    // canvas B must restore the WebGL default — exactly one call. A setter
    // added to FjsGlBindings without a row here is a key nobody checked.
    final rows = <(String, void Function(TrackedGlBindings), String)>[
      ('enable', (a) => a.enable(depthTest), call('disable', [depthTest])),
      ('disable', (a) => a.disable(dither), call('enable', [dither])),
      ('blendColor', (a) => a.blendColor(.1, .2, .3, .4),
          call('blendColor', [0.0, 0.0, 0.0, 0.0])),
      ('blendEquation', (a) => a.blendEquation(0x800A),
          call('blendEquation', [0x8006])),
      ('blendEquationSeparate', (a) => a.blendEquationSeparate(0x800A, 0x8006),
          call('blendEquation', [0x8006])),
      ('blendFunc', (a) => a.blendFunc(0x0302, 0x0303), call('blendFunc', [1, 0])),
      ('blendFuncSeparate', (a) => a.blendFuncSeparate(0x0302, 0x0303, 1, 1),
          call('blendFunc', [1, 0])),
      ('clearColor', (a) => a.clearColor(1, 1, 1, 1),
          call('clearColor', [0.0, 0.0, 0.0, 0.0])),
      ('clearDepth', (a) => a.clearDepth(.5), call('clearDepth', [1.0])),
      ('clearStencil', (a) => a.clearStencil(3), call('clearStencil', [0])),
      ('colorMask', (a) => a.colorMask(false, false, false, false),
          call('colorMask', [true, true, true, true])),
      ('cullFace', (a) => a.cullFace(front), call('cullFace', [back])),
      ('depthFunc', (a) => a.depthFunc(0x0203), call('depthFunc', [0x0201])),
      ('depthMask', (a) => a.depthMask(false), call('depthMask', [true])),
      ('depthRange', (a) => a.depthRange(.2, .8),
          call('depthRange', [0.0, 1.0])),
      ('frontFace', (a) => a.frontFace(0x0900), call('frontFace', [0x0901])),
      ('hint', (a) => a.hint(0x8192, 0x1101), call('hint', [0x8192, 0x1100])),
      ('lineWidth', (a) => a.lineWidth(2), call('lineWidth', [1.0])),
      ('pixelStorei', (a) => a.pixelStorei(0x0CF5, 1),
          call('pixelStorei', [0x0CF5, 4])),
      ('polygonOffset', (a) => a.polygonOffset(1, 1),
          call('polygonOffset', [0.0, 0.0])),
      ('sampleCoverage', (a) => a.sampleCoverage(.5, true),
          call('sampleCoverage', [1.0, false])),
      ('scissor', (a) => a.scissor(1, 2, 3, 4), call('scissor', [0, 0, w, h])),
      ('stencilFunc', (a) => a.stencilFunc(0x0203, 1, 0xFF),
          call('stencilFunc', [0x0207, 0, 0xFFFFFFFF])),
      ('stencilFuncSeparate', (a) => a.stencilFuncSeparate(front, 0x0203, 1, 0xFF),
          call('stencilFunc', [0x0207, 0, 0xFFFFFFFF])),
      ('stencilMask', (a) => a.stencilMask(0xFF),
          call('stencilMask', [0xFFFFFFFF])),
      ('stencilMaskSeparate', (a) => a.stencilMaskSeparate(back, 0xF),
          call('stencilMask', [0xFFFFFFFF])),
      ('stencilOp', (a) => a.stencilOp(0x1E01, 0x1E01, 0x1E01),
          call('stencilOp', [0x1E00, 0x1E00, 0x1E00])),
      ('stencilOpSeparate', (a) => a.stencilOpSeparate(front, 0x1E01, 0x1E01, 0x1E01),
          call('stencilOp', [0x1E00, 0x1E00, 0x1E00])),
      ('viewport', (a) => a.viewport(1, 2, 3, 4), call('viewport', [0, 0, w, h])),
      ('useProgram', (a) => a.useProgram(5), call('useProgram', [0])),
      ('bindBuffer', (a) => a.bindBuffer(arrayBuffer, 3),
          call('bindBuffer', [arrayBuffer, 0])),
      ('bindFramebuffer', (a) => a.bindFramebuffer(framebuffer, 2),
          call('bindFramebuffer', [framebuffer, 0])),
      ('bindRenderbuffer', (a) => a.bindRenderbuffer(renderbuffer, 2),
          call('bindRenderbuffer', [renderbuffer, 0])),
      ('activeTexture', (a) => a.activeTexture(texture0 + 3),
          call('activeTexture', [texture0])),
      ('bindTexture', (a) => a.bindTexture(texture2d, 4),
          call('bindTexture', [texture2d, 0])),
      ('vertexAttrib4f', (a) => a.vertexAttrib4f(1, .1, .2, .3, .4),
          call('vertexAttrib4f', [1, 0.0, 0.0, 0.0, 1.0])),
      ('vertexAttrib1f', (a) => a.vertexAttrib1f(2, .5),
          call('vertexAttrib4f', [2, 0.0, 0.0, 0.0, 1.0])),
      ('vertexAttrib4fv',
          (a) => a.vertexAttrib4fv(3, Float32List.fromList([.5, .5, .5, .5])),
          call('vertexAttrib4f', [3, 0.0, 0.0, 0.0, 1.0])),
    ];

    for (final (name, set, restore) in rows) {
      test('$name on one canvas does not leak into the next', () {
        final gl = GlCurrentState();
        final (a, _) = canvas(gl);
        set(a);

        final bRec = StateRecorder();
        final b = TrackedGlBindings(bRec, gl, width: w, height: h);
        bRec.calls.clear(); // the hidden VAO create+bind, pinned elsewhere
        b.sync();
        expect(bRec.log, [restore]);
      });
    }

    test('a VAO bound on one canvas does not leak into the next', () {
      final gl = GlCurrentState();
      final (a, _) = canvas(gl);
      a.bindVertexArray(7);

      final bRec = StateRecorder();
      final b = TrackedGlBindings(bRec, gl, width: w, height: h);
      // the new canvas binds its own hidden VAO up front; sync has nothing
      // left to do
      expect(bRec.log, contains(call('bindVertexArray', [kHiddenVaoId])));
      bRec.calls.clear();
      b.sync();
      expect(bRec.log, isEmpty);
    });

    test('two canvases taking turns each get their own state back', () {
      final gl = GlCurrentState();
      final (a, aRec) = canvas(gl);
      final (b, bRec) = canvas(gl);

      a.sync();
      aRec.calls.clear();
      a.enable(depthTest);
      a.clearColor(1, 0, 0, 1);
      a.viewport(0, 0, 10, 10);

      // every switch also puts the canvas's own hidden VAO back
      final hiddenVao = call('bindVertexArray', [kHiddenVaoId]);

      b.sync();
      expect(bRec.log, unorderedEquals([
        hiddenVao,
        call('disable', [depthTest]),
        call('clearColor', [0.0, 0.0, 0.0, 0.0]),
        call('viewport', [0, 0, w, h]),
      ]));
      b.enable(blend);
      b.clearColor(0, 1, 0, 1);

      aRec.calls.clear();
      a.sync();
      expect(aRec.log, unorderedEquals([
        hiddenVao,
        call('disable', [blend]),
        call('enable', [depthTest]),
        call('clearColor', [1.0, 0.0, 0.0, 1.0]),
        call('viewport', [0, 0, 10, 10]),
      ]));
      expect(gl.values['clearColor'], (1.0, 0.0, 0.0, 1.0));

      // and back again: only what differs
      bRec.calls.clear();
      b.sync();
      expect(bRec.log, unorderedEquals([
        hiddenVao,
        call('disable', [depthTest]),
        call('enable', [blend]),
        call('clearColor', [0.0, 1.0, 0.0, 1.0]),
        call('viewport', [0, 0, w, h]),
      ]));
    });

    test('a canvas syncing again with nothing in between sends nothing', () {
      final gl = GlCurrentState();
      final (a, rec) = canvas(gl);
      a.enable(depthTest);
      a.viewport(0, 0, 10, 10);
      rec.calls.clear();

      a.sync();
      a.sync();
      expect(rec.log, isEmpty);
    });

    test('after activate(), only a viewport the page set itself is re-sent', () {
      final gl = GlCurrentState();
      final (a, aRec) = canvas(gl);
      a.viewport(0, 0, 10, 10);
      aRec.calls.clear();

      gl.pluginActivated(w, h);
      a.sync();
      expect(aRec.log, [call('viewport', [0, 0, 10, 10])]);

      // a canvas at the defaults pays nothing for the plugin's viewport and
      // default framebuffer
      final (b, bRec) = canvas(gl);
      b.sync();
      bRec.calls.clear();
      gl.pluginActivated(w, h);
      b.sync();
      expect(bRec.log, isEmpty);
    });

    test('after createTexture/updateTexture, the keys the plugin touches are re-sent', () {
      final gl = GlCurrentState();
      final (a, rec) = canvas(gl);
      a.enable(depthTest); // not touched by the plugin: must not be re-sent
      rec.calls.clear();

      gl.pluginTouched();
      a.sync();
      expect(rec.log, containsAll([
        call('viewport', [0, 0, w, h]),
        call('bindFramebuffer', [framebuffer, 0]),
        call('bindRenderbuffer', [renderbuffer, 0]),
        call('clearColor', [0.0, 0.0, 0.0, 0.0]),
        call('bindTexture', [texture2d, 0]),
      ]));
      expect(rec.log, isNot(contains(call('enable', [depthTest]))));

      rec.calls.clear();
      a.sync();
      expect(rec.log, isEmpty);
    });

    test('hidden VAO stands in for the default vertex array', () {
      final gl = GlCurrentState();
      final rec = StateRecorder();
      final a = TrackedGlBindings(rec, gl, width: w, height: h);
      expect(rec.log, [
        call('createVertexArray', [kHiddenVaoId]),
        call('bindVertexArray', [kHiddenVaoId]),
      ]);

      rec.calls.clear();
      a.bindVertexArray(0);
      expect(rec.log, [call('bindVertexArray', [kHiddenVaoId])]);

      rec.calls.clear();
      a.bindVertexArray(5);
      a.deleteVertexArray(5);
      expect(rec.log, [
        call('bindVertexArray', [5]),
        call('deleteVertexArray', [5]),
        call('bindVertexArray', [kHiddenVaoId]),
      ]);

      rec.calls.clear();
      a.dispose();
      expect(rec.log, [call('deleteVertexArray', [kHiddenVaoId])]);
      expect(gl.owner, isNull);
    });

    test('deleted objects are unbound, and same ids on two canvases are two objects', () {
      final gl = GlCurrentState();
      final (a, aRec) = canvas(gl);
      final (b, bRec) = canvas(gl);

      a.sync();
      a.bindBuffer(arrayBuffer, 3);
      a.bindTexture(texture2d, 4);
      a.deleteBuffer(3);
      a.deleteTexture(4);

      bRec.calls.clear();
      b.sync();
      expect(bRec.log, isNot(contains(call('bindBuffer', [arrayBuffer, 0]))));
      expect(bRec.log, isNot(contains(call('bindTexture', [texture2d, 0]))));

      aRec.calls.clear();
      a.sync();
      expect(aRec.log, isNot(contains(call('bindBuffer', [arrayBuffer, 3]))));
      expect(aRec.log, isNot(contains(call('bindTexture', [texture2d, 4]))));

      // both canvases call their buffer "1"
      a.bindBuffer(arrayBuffer, 1);
      b.sync();
      b.bindBuffer(arrayBuffer, 1);
      aRec.calls.clear();
      a.sync();
      expect(aRec.log, contains(call('bindBuffer', [arrayBuffer, 1])));
    });

    test('WebGL-only pixel-store pnames are not context state', () {
      final gl = GlCurrentState();
      final (a, _) = canvas(gl);
      a.pixelStorei(0x9240, 1); // UNPACK_FLIP_Y_WEBGL

      // a fresh canvas that has not synced yet, so the sync below diffs
      final bRec = StateRecorder();
      final b = TrackedGlBindings(bRec, gl, width: w, height: h);
      bRec.calls.clear();
      b.sync();
      expect(bRec.log, isEmpty);
    });

    test('faces that differ restore through the Separate calls', () {
      final gl = GlCurrentState();
      final (a, aRec) = canvas(gl);
      a.stencilFuncSeparate(front, 0x0203, 1, 0xFF);

      final (b, _) = canvas(gl);
      b.sync();

      aRec.calls.clear();
      a.sync();
      expect(aRec.log.where((c) => c.startsWith('stencil')), [
        call('stencilFuncSeparate', [front, 0x0203, 1, 0xFF]),
        call('stencilFuncSeparate', [back, 0x0207, 0, 0xFFFFFFFF]),
      ]);
    });
  });
}
