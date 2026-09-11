// Per-canvas GL context state on top of ONE shared GL context (spec 036).
//
// WHY THIS EXISTS. flutter_angle (checked against 0.4.2) creates a single
// EGL context on every platform — `g_context` in the Android JNI layer,
// `_baseAppContext` on Apple/desktop — and a canvas is only a surface/FBO
// made current on it. The browser gives each `getContext` call its own
// context that starts at the WebGL defaults. Without this file the App side
// let one canvas inherit another's state: the triangle page enables
// DEPTH_TEST, the instanced page never touches depth and clears only the
// colour buffer, and every fragment it draws fails the depth test — a canvas
// showing nothing but its clear colour, no GL error anywhere (constitution V).
//
// HOW. Every context-level setter a canvas issues is recorded twice: in its
// own [WebglContextState] (what this canvas wants), and in the one
// [GlCurrentState] (what the real context holds right now, and which canvas
// put it there). Before a canvas executes again, [TrackedGlBindings.sync]
// re-issues only the keys whose current value differs from what this canvas
// wants. One canvas rendering alone pays an identity check per frame.
//
// Rejected, see specs/036-webgl-context-state-isolation/plan.md 3.5:
//  * reset to defaults only when a canvas is created — two canvases alive at
//    once (a pushed page over a mounted one, a page leaving through its
//    transition, keep-alive tabs) interleave on the same context anyway;
//  * one EGL context per canvas — needs flutter_angle's native layer;
//  * replaying all state on every switch — tens of calls per switch;
//  * glGet* the real values — per-switch pipeline stalls, and the plugin's
//    getParameter throws for many keys.
//
// VERTEX ATTRIBUTES ARE NOT RECORDED. Each canvas gets a hidden vertex array
// object ([kHiddenVaoId]) that stands in for its default VAO, so pointer,
// enable, divisor and ELEMENT_ARRAY_BUFFER state live in GL objects the
// canvas owns. Recording them one by one (with the buffer bound at pointer
// time) was the long, easy-to-get-wrong alternative.
//
// STATE THE PLUGIN CHANGES BEHIND OUR BACK (flutter_angle 0.4.2,
// lib/desktop/angle.dart) — re-check when upgrading:
//  * createTexture: activeTexture(TEXTURE0), bindTexture(TEXTURE_2D),
//    bindFramebuffer, bindRenderbuffer(0), viewport;
//  * FlutterAngleTexture.activate(): viewport(0, 0, w*dpr, h*dpr) and the
//    canvas's own default framebuffer;
//  * updateTexture: bindFramebuffer(0) on the non-surface path;
//  * deleteTexture: bindFramebuffer, clearColor(0, 0, 0, 0).
// [GlCurrentState.pluginTouched] / [GlCurrentState.pluginActivated] model
// exactly these.

import 'dart:typed_data';

import 'replay.dart' show FjsActiveInfo, FjsGlBindings;

/// The JS id this module reserves for a canvas's hidden default VAO. JS ids
/// count up from 1 in a per-canvas table, so the top of the u32 range never
/// collides.
const int kHiddenVaoId = 0xFFFFFFFF;

/// A bound GL object: the owning canvas and its JS id. The null object (id 0)
/// has no owner — it means the same thing on every canvas. The owner matters
/// for everything else: two canvases both allocate id 1, and those are two
/// different GL objects.
typedef GlBound = (WebglContextState?, int);

const GlBound _none = (null, 0);

// GL enums this file needs by value
const int _dither = 0x0BD0;
const int _funcAdd = 0x8006;
const int _one = 1;
const int _zero = 0;
const int _back = 0x0405;
const int _front = 0x0404;
const int _frontAndBack = 0x0408;
const int _less = 0x0201;
const int _ccw = 0x0901;
const int _dontCare = 0x1100;
const int _always = 0x0207;
const int _keep = 0x1E00;
const int _texture0 = 0x84C0;
const int _texture2d = 0x0DE1;
const int _unpackAlignment = 0x0CF5;
const int _packAlignment = 0x0D05;
const int _elementArrayBuffer = 0x8893;
const int _framebuffer = 0x8D40;
const int _drawFramebuffer = 0x8CA9;
const int _readFramebuffer = 0x8CA8;
const int _allBits = 0xFFFFFFFF;

/// WebGL-only pixel-store pnames. [FjsAngleBindings.pixelStorei] absorbs
/// them before GL (FLIP_Y rides on the upload command), so they are not
/// context state here.
const Set<int> _webglOnlyPixelStore = {0x9240, 0x9241, 0x9243};

/// Current-value marker for a key whose real GL value nobody knows (the
/// plugin changed it). Never equal to anything, so the next sync re-issues.
final Object _unknown = Object();

/// What one canvas has set. A key that was never set holds the WebGL default
/// ([defaultFor]).
///
/// Keys: `('cap', cap)`, `'blendColor'`, `'blendEquation'` (rgb, alpha),
/// `'blendFunc'` (srcRgb, dstRgb, srcAlpha, dstAlpha), `'clearColor'`,
/// `'clearDepth'`, `'clearStencil'`, `'colorMask'`, `'cullFace'`,
/// `'depthFunc'`, `'depthMask'`, `'depthRange'`, `'frontFace'`,
/// `('hint', target)`, `'lineWidth'`, `('pixelStore', pname)`,
/// `'polygonOffset'`, `'sampleCoverage'`, `'scissor'`, `'stencilFunc'`
/// (front, back), `'stencilMask'` (front, back), `'stencilOp'` (front, back),
/// `'viewport'`, `'program'`, `'vao'`, `('buffer', target)`, `'framebuffer'`
/// (draw, read), `'renderbuffer'`, `'activeTexture'`,
/// `('texture', unit, target)`, `('attrib', index)`.
class WebglContextState {
  WebglContextState(this.width, this.height);

  /// Drawing buffer size in device pixels at context creation — the WebGL
  /// default for viewport and scissor.
  final int width;
  final int height;

  final Map<Object, Object> values = {};

  Object target(Object key) => values[key] ?? defaultFor(key);

  Object defaultFor(Object key) {
    switch (key) {
      case ('cap', final int cap):
        return cap == _dither;
      case ('hint', int _):
        return _dontCare;
      case ('pixelStore', final int pname):
        return pname == _unpackAlignment || pname == _packAlignment ? 4 : 0;
      case ('buffer', int _):
        return _none;
      case ('texture', int _, int _):
        return _none;
      case ('attrib', int _):
        return (0.0, 0.0, 0.0, 1.0);
      case 'blendColor':
      case 'clearColor':
        return (0.0, 0.0, 0.0, 0.0);
      case 'blendEquation':
        return (_funcAdd, _funcAdd);
      case 'blendFunc':
        return (_one, _zero, _one, _zero);
      case 'clearDepth':
        return 1.0;
      case 'clearStencil':
        return 0;
      case 'colorMask':
        return (true, true, true, true);
      case 'cullFace':
        return _back;
      case 'depthFunc':
        return _less;
      case 'depthMask':
        return true;
      case 'depthRange':
        return (0.0, 1.0);
      case 'frontFace':
        return _ccw;
      case 'lineWidth':
        return 1.0;
      case 'polygonOffset':
        return (0.0, 0.0);
      case 'sampleCoverage':
        return (1.0, false);
      case 'scissor':
      case 'viewport':
        return (0, 0, width, height);
      case 'stencilFunc':
        return ((_always, 0, _allBits), (_always, 0, _allBits));
      case 'stencilMask':
        return (_allBits, _allBits);
      case 'stencilOp':
        return ((_keep, _keep, _keep), (_keep, _keep, _keep));
      case 'program':
      case 'renderbuffer':
        return _none;
      case 'framebuffer':
        return (_none, _none);
      case 'vao':
        // not the null object: this canvas's hidden VAO
        return (this, 0);
      case 'activeTexture':
        return _texture0;
    }
    throw ArgumentError('webgl state: no default for key $key');
  }
}

/// What the ONE real GL context holds. Shared by every canvas.
class GlCurrentState {
  final Map<Object, Object> values = {};

  /// The canvas that last synced. While it stays the same, only [dirty]
  /// needs checking.
  WebglContextState? owner;

  /// Keys the plugin changed since the last sync.
  final Set<Object> dirty = {};

  void _markUnknown(Object key) {
    values[key] = _unknown;
    dirty.add(key);
  }

  /// After createTexture / updateTexture / deleteTexture: the keys those
  /// calls touch hold values nobody recorded.
  void pluginTouched() {
    for (final key in const [
      'viewport',
      'framebuffer',
      'renderbuffer',
      'clearColor',
    ]) {
      _markUnknown(key);
    }
    final unit = values['activeTexture'];
    if (unit is int) {
      _markUnknown(('texture', unit, _texture2d));
    } else {
      // the active unit itself is unknown: any unit's 2D binding may be hit
      for (final key in values.keys.toList()) {
        if (key case ('texture', int _, _texture2d)) _markUnknown(key);
      }
    }
    _markUnknown(('texture', _texture0, _texture2d));
    _markUnknown('activeTexture');
  }

  /// After `FlutterAngleTexture.activate()`: the plugin set viewport to the
  /// whole drawing buffer and bound the canvas's default framebuffer. Both
  /// are KNOWN values — equal to the canvas defaults — so a canvas that never
  /// set its own pays no call for them.
  void pluginActivated(int width, int height) {
    values['viewport'] = (0, 0, width, height);
    values['framebuffer'] = (_none, _none);
    dirty
      ..add('viewport')
      ..add('framebuffer');
  }

  /// A canvas is going away: forget that it was the last to sync.
  void release(WebglContextState state) {
    if (identical(owner, state)) owner = null;
  }
}

/// [FjsGlBindings] that records context-level state per canvas and forwards
/// every call to [inner] unchanged. Calls are never filtered — a page that
/// sets the same value twice sends it twice, exactly as before spec 036.
class TrackedGlBindings extends FjsGlBindings {
  TrackedGlBindings(this.inner, this.current,
      {required int width, required int height})
      : own = WebglContextState(width, height) {
    inner.createVertexArray(kHiddenVaoId);
    inner.bindVertexArray(kHiddenVaoId);
    current.values['vao'] = (own, 0);
  }

  final FjsGlBindings inner;
  final GlCurrentState current;
  final WebglContextState own;

  GlBound _bound(int id) => id == 0 ? _none : (own, id);

  void _set(Object key, Object value) {
    own.values[key] = value;
    current.values[key] = value;
  }

  // ---- sync

  /// Makes the real context hold this canvas's state. Call after the plugin
  /// has made this canvas's surface current, before executing its commands
  /// or reading GL on its behalf.
  void sync() {
    final gl = current;
    final Iterable<Object> keys;
    if (identical(gl.owner, own)) {
      if (gl.dirty.isEmpty) return;
      keys = gl.dirty.toList();
    } else {
      keys = {...own.values.keys, ...gl.values.keys};
    }

    // Texture bindings are per unit and need activeTexture juggling, so they
    // go last and the active unit is put back once at the end.
    final textureKeys = <(String, int, int)>[];
    for (final key in keys) {
      if (key case ('texture', int _, int _)) {
        textureKeys.add(key as (String, int, int));
        continue;
      }
      if (key == 'activeTexture') continue;
      final want = own.target(key);
      if (gl.values[key] == want) continue;
      _apply(key, want);
      gl.values[key] = want;
    }

    final wantUnit = own.target('activeTexture') as int;
    Object? glUnit = gl.values['activeTexture'];
    for (final key in textureKeys) {
      final want = own.target(key) as GlBound;
      if (gl.values[key] == want) continue;
      final (_, unit, target) = key;
      if (glUnit != unit) {
        inner.activeTexture(unit);
        glUnit = unit;
      }
      inner.bindTexture(target, want.$2);
      gl.values[key] = want;
    }
    if (glUnit != wantUnit) inner.activeTexture(wantUnit);
    gl.values['activeTexture'] = wantUnit;

    gl.dirty.clear();
    gl.owner = own;
  }

  void _apply(Object key, Object want) {
    switch (key) {
      case ('cap', final int cap):
        want == true ? inner.enable(cap) : inner.disable(cap);
      case ('hint', final int target):
        inner.hint(target, want as int);
      case ('pixelStore', final int pname):
        inner.pixelStorei(pname, want as int);
      case ('buffer', final int target):
        inner.bindBuffer(target, (want as GlBound).$2);
      case ('attrib', final int index):
        final (x, y, z, w) = want as (double, double, double, double);
        inner.vertexAttrib4f(index, x, y, z, w);
      case 'blendColor':
        final (r, g, b, a) = want as (double, double, double, double);
        inner.blendColor(r, g, b, a);
      case 'clearColor':
        final (r, g, b, a) = want as (double, double, double, double);
        inner.clearColor(r, g, b, a);
      case 'blendEquation':
        final (rgb, alpha) = want as (int, int);
        rgb == alpha
            ? inner.blendEquation(rgb)
            : inner.blendEquationSeparate(rgb, alpha);
      case 'blendFunc':
        final (sRgb, dRgb, sA, dA) = want as (int, int, int, int);
        sRgb == sA && dRgb == dA
            ? inner.blendFunc(sRgb, dRgb)
            : inner.blendFuncSeparate(sRgb, dRgb, sA, dA);
      case 'clearDepth':
        inner.clearDepth(want as double);
      case 'clearStencil':
        inner.clearStencil(want as int);
      case 'colorMask':
        final (r, g, b, a) = want as (bool, bool, bool, bool);
        inner.colorMask(r, g, b, a);
      case 'cullFace':
        inner.cullFace(want as int);
      case 'depthFunc':
        inner.depthFunc(want as int);
      case 'depthMask':
        inner.depthMask(want as bool);
      case 'depthRange':
        final (n, f) = want as (double, double);
        inner.depthRange(n, f);
      case 'frontFace':
        inner.frontFace(want as int);
      case 'lineWidth':
        inner.lineWidth(want as double);
      case 'polygonOffset':
        final (factor, units) = want as (double, double);
        inner.polygonOffset(factor, units);
      case 'sampleCoverage':
        final (value, invert) = want as (double, bool);
        inner.sampleCoverage(value, invert);
      case 'scissor':
        final (x, y, w, h) = want as (int, int, int, int);
        inner.scissor(x, y, w, h);
      case 'viewport':
        final (x, y, w, h) = want as (int, int, int, int);
        inner.viewport(x, y, w, h);
      // Stencil and blend state restore through the non-Separate call when
      // both faces agree: flutter_angle does not implement stencil*Separate,
      // and the common case must not depend on it.
      case 'stencilFunc':
        final (front, back) =
            want as ((int, int, int), (int, int, int));
        if (front == back) {
          inner.stencilFunc(front.$1, front.$2, front.$3);
        } else {
          inner.stencilFuncSeparate(_front, front.$1, front.$2, front.$3);
          inner.stencilFuncSeparate(_back, back.$1, back.$2, back.$3);
        }
      case 'stencilMask':
        final (front, back) = want as (int, int);
        if (front == back) {
          inner.stencilMask(front);
        } else {
          inner.stencilMaskSeparate(_front, front);
          inner.stencilMaskSeparate(_back, back);
        }
      case 'stencilOp':
        final (front, back) =
            want as ((int, int, int), (int, int, int));
        if (front == back) {
          inner.stencilOp(front.$1, front.$2, front.$3);
        } else {
          inner.stencilOpSeparate(_front, front.$1, front.$2, front.$3);
          inner.stencilOpSeparate(_back, back.$1, back.$2, back.$3);
        }
      case 'program':
        inner.useProgram((want as GlBound).$2);
      case 'renderbuffer':
        inner.bindRenderbuffer(0x8D41, (want as GlBound).$2);
      case 'framebuffer':
        final (draw, read) = want as (GlBound, GlBound);
        if (draw == read) {
          inner.bindFramebuffer(_framebuffer, draw.$2);
        } else {
          inner.bindFramebuffer(_drawFramebuffer, draw.$2);
          inner.bindFramebuffer(_readFramebuffer, read.$2);
        }
      case 'vao':
        final id = (want as GlBound).$2;
        inner.bindVertexArray(id == 0 ? kHiddenVaoId : id);
      default:
        throw ArgumentError('webgl state: cannot apply key $key');
    }
  }

  /// Frees the hidden VAO. The canvas's other GL objects follow the existing
  /// node lifecycle.
  void dispose() {
    inner.deleteVertexArray(kHiddenVaoId);
    if (current.values['vao'] == (own, 0)) current._markUnknown('vao');
    current.release(own);
  }

  // ---- deletion: GL unbinds a deleted object from the context

  void _unbind(bool Function(Object key) matches, int id) {
    final gone = (own, id);
    for (final key in own.values.keys.toList()) {
      if (matches(key) && own.values[key] == gone) own.values.remove(key);
    }
    for (final key in current.values.keys.toList()) {
      if (matches(key) && current.values[key] == gone) {
        current.values[key] = _none;
      }
    }
  }

  void _unbindFramebuffer(int id) {
    final gone = (own, id);
    (GlBound, GlBound) scrub(Object value) {
      final (draw, read) = value as (GlBound, GlBound);
      return (draw == gone ? _none : draw, read == gone ? _none : read);
    }

    final mine = own.values['framebuffer'];
    if (mine != null) own.values['framebuffer'] = scrub(mine);
    final theirs = current.values['framebuffer'];
    if (theirs != null && !identical(theirs, _unknown)) {
      current.values['framebuffer'] = scrub(theirs);
    }
  }

  // ---- resources

  @override
  void createBuffer(int id) => inner.createBuffer(id);
  @override
  void deleteBuffer(int id) {
    inner.deleteBuffer(id);
    _unbind((k) => k is (String, int) && k.$1 == 'buffer', id);
  }

  @override
  void createFramebuffer(int id) => inner.createFramebuffer(id);
  @override
  void deleteFramebuffer(int id) {
    inner.deleteFramebuffer(id);
    _unbindFramebuffer(id);
  }

  @override
  void createProgram(int id) => inner.createProgram(id);
  @override
  // GL keeps a deleted program in use until something else is bound
  void deleteProgram(int id) => inner.deleteProgram(id);

  @override
  void createRenderbuffer(int id) => inner.createRenderbuffer(id);
  @override
  void deleteRenderbuffer(int id) {
    inner.deleteRenderbuffer(id);
    _unbind((k) => k == 'renderbuffer', id);
  }

  @override
  void createShader(int id, int type) => inner.createShader(id, type);
  @override
  void deleteShader(int id) => inner.deleteShader(id);

  @override
  void createTexture(int id) => inner.createTexture(id);
  @override
  void deleteTexture(int id) {
    inner.deleteTexture(id);
    _unbind((k) => k is (String, int, int) && k.$1 == 'texture', id);
  }

  @override
  void createVertexArray(int id) => inner.createVertexArray(id);
  @override
  void deleteVertexArray(int id) {
    inner.deleteVertexArray(id);
    if (own.values['vao'] == (own, id)) {
      // GL fell back to its real default VAO, which is nobody's: go home to
      // this canvas's hidden one
      own.values.remove('vao');
      inner.bindVertexArray(kHiddenVaoId);
      current.values['vao'] = (own, 0);
    } else if (current.values['vao'] == (own, id)) {
      current._markUnknown('vao');
    }
  }

  // ---- binding & state

  @override
  void activeTexture(int unit) {
    _set('activeTexture', unit);
    inner.activeTexture(unit);
  }

  @override
  void bindBuffer(int target, int id) {
    // ELEMENT_ARRAY_BUFFER belongs to the bound VAO, not the context
    if (target != _elementArrayBuffer) _set(('buffer', target), _bound(id));
    inner.bindBuffer(target, id);
  }

  @override
  void bindFramebuffer(int target, int id) {
    final (draw, read) = own.target('framebuffer') as (GlBound, GlBound);
    final b = _bound(id);
    _set(
      'framebuffer',
      switch (target) {
        _drawFramebuffer => (b, read),
        _readFramebuffer => (draw, b),
        _ => (b, b),
      },
    );
    inner.bindFramebuffer(target, id);
  }

  @override
  void bindRenderbuffer(int target, int id) {
    _set('renderbuffer', _bound(id));
    inner.bindRenderbuffer(target, id);
  }

  @override
  void bindTexture(int target, int id) {
    final unit = own.target('activeTexture') as int;
    _set(('texture', unit, target), _bound(id));
    inner.bindTexture(target, id);
  }

  @override
  void bindVertexArray(int id) {
    _set('vao', (own, id));
    inner.bindVertexArray(id == 0 ? kHiddenVaoId : id);
  }

  @override
  void blendColor(double r, double g, double b, double a) {
    _set('blendColor', (r, g, b, a));
    inner.blendColor(r, g, b, a);
  }

  @override
  void blendEquation(int mode) {
    _set('blendEquation', (mode, mode));
    inner.blendEquation(mode);
  }

  @override
  void blendEquationSeparate(int modeRgb, int modeAlpha) {
    _set('blendEquation', (modeRgb, modeAlpha));
    inner.blendEquationSeparate(modeRgb, modeAlpha);
  }

  @override
  void blendFunc(int sfactor, int dfactor) {
    _set('blendFunc', (sfactor, dfactor, sfactor, dfactor));
    inner.blendFunc(sfactor, dfactor);
  }

  @override
  void blendFuncSeparate(int srcRgb, int dstRgb, int srcAlpha, int dstAlpha) {
    _set('blendFunc', (srcRgb, dstRgb, srcAlpha, dstAlpha));
    inner.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
  }

  @override
  void clearColor(double r, double g, double b, double a) {
    _set('clearColor', (r, g, b, a));
    inner.clearColor(r, g, b, a);
  }

  @override
  void clearDepth(double depth) {
    _set('clearDepth', depth);
    inner.clearDepth(depth);
  }

  @override
  void clearStencil(int s) {
    _set('clearStencil', s);
    inner.clearStencil(s);
  }

  @override
  void colorMask(bool r, bool g, bool b, bool a) {
    _set('colorMask', (r, g, b, a));
    inner.colorMask(r, g, b, a);
  }

  @override
  void cullFace(int mode) {
    _set('cullFace', mode);
    inner.cullFace(mode);
  }

  @override
  void depthFunc(int func) {
    _set('depthFunc', func);
    inner.depthFunc(func);
  }

  @override
  void depthMask(bool flag) {
    _set('depthMask', flag);
    inner.depthMask(flag);
  }

  @override
  void depthRange(double zNear, double zFar) {
    _set('depthRange', (zNear, zFar));
    inner.depthRange(zNear, zFar);
  }

  @override
  void disable(int cap) {
    _set(('cap', cap), false);
    inner.disable(cap);
  }

  @override
  void enable(int cap) {
    _set(('cap', cap), true);
    inner.enable(cap);
  }

  @override
  void frontFace(int mode) {
    _set('frontFace', mode);
    inner.frontFace(mode);
  }

  @override
  void hint(int target, int mode) {
    _set(('hint', target), mode);
    inner.hint(target, mode);
  }

  @override
  void lineWidth(double width) {
    _set('lineWidth', width);
    inner.lineWidth(width);
  }

  @override
  void pixelStorei(int pname, int param) {
    if (!_webglOnlyPixelStore.contains(pname)) {
      _set(('pixelStore', pname), param);
    }
    inner.pixelStorei(pname, param);
  }

  @override
  void polygonOffset(double factor, double units) {
    _set('polygonOffset', (factor, units));
    inner.polygonOffset(factor, units);
  }

  @override
  void sampleCoverage(double value, bool invert) {
    _set('sampleCoverage', (value, invert));
    inner.sampleCoverage(value, invert);
  }

  @override
  void scissor(int x, int y, int width, int height) {
    _set('scissor', (x, y, width, height));
    inner.scissor(x, y, width, height);
  }

  /// The (front, back) pair under [key] with [value] written into the faces
  /// [face] names.
  (T, T) _faces<T>(String key, int face, T value) {
    final (front, back) = own.target(key) as (T, T);
    return switch (face) {
      _front => (value, back),
      _back => (front, value),
      _frontAndBack => (value, value),
      _ => (front, back),
    };
  }

  @override
  void stencilFunc(int func, int ref, int mask) {
    _set('stencilFunc', ((func, ref, mask), (func, ref, mask)));
    inner.stencilFunc(func, ref, mask);
  }

  @override
  void stencilFuncSeparate(int face, int func, int ref, int mask) {
    _set('stencilFunc', _faces<(int, int, int)>('stencilFunc', face, (func, ref, mask)));
    inner.stencilFuncSeparate(face, func, ref, mask);
  }

  @override
  void stencilMask(int mask) {
    _set('stencilMask', (mask, mask));
    inner.stencilMask(mask);
  }

  @override
  void stencilMaskSeparate(int face, int mask) {
    _set('stencilMask', _faces<int>('stencilMask', face, mask));
    inner.stencilMaskSeparate(face, mask);
  }

  @override
  void stencilOp(int fail, int zfail, int zpass) {
    _set('stencilOp', ((fail, zfail, zpass), (fail, zfail, zpass)));
    inner.stencilOp(fail, zfail, zpass);
  }

  @override
  void stencilOpSeparate(int face, int fail, int zfail, int zpass) {
    _set('stencilOp', _faces<(int, int, int)>('stencilOp', face, (fail, zfail, zpass)));
    inner.stencilOpSeparate(face, fail, zfail, zpass);
  }

  @override
  void viewport(int x, int y, int width, int height) {
    _set('viewport', (x, y, width, height));
    inner.viewport(x, y, width, height);
  }

  // ---- data upload (object state, forwarded)

  @override
  void bufferData(int target, Uint8List data, int usage) =>
      inner.bufferData(target, data, usage);
  @override
  void bufferDataSize(int target, int size, int usage) =>
      inner.bufferDataSize(target, size, usage);
  @override
  void bufferSubData(int target, int offset, Uint8List data) =>
      inner.bufferSubData(target, offset, data);
  @override
  void texImage2D(int target, int level, int internalformat, int width,
          int height, int border, int format, int type, Uint8List pixels) =>
      inner.texImage2D(target, level, internalformat, width, height, border,
          format, type, pixels);
  @override
  void texImage2DSource(int target, int level, int internalformat, int format,
          int type, int handle, bool flipY) =>
      inner.texImage2DSource(
          target, level, internalformat, format, type, handle, flipY);
  @override
  void texSubImage2D(int target, int level, int xoffset, int yoffset,
          int width, int height, int format, int type, Uint8List pixels) =>
      inner.texSubImage2D(target, level, xoffset, yoffset, width, height,
          format, type, pixels);
  @override
  void texSubImage2DSource(int target, int level, int xoffset, int yoffset,
          int format, int type, int handle, bool flipY) =>
      inner.texSubImage2DSource(
          target, level, xoffset, yoffset, format, type, handle, flipY);
  @override
  void texStorage2D(
          int target, int levels, int internalformat, int width, int height) =>
      inner.texStorage2D(target, levels, internalformat, width, height);
  @override
  void texImage3D(int target, int level, int internalformat, int width,
          int height, int depth, int border, int format, int type,
          Uint8List pixels) =>
      inner.texImage3D(target, level, internalformat, width, height, depth,
          border, format, type, pixels);
  @override
  void texSubImage3D(int target, int level, int xoffset, int yoffset,
          int zoffset, int width, int height, int depth, int format, int type,
          Uint8List pixels) =>
      inner.texSubImage3D(target, level, xoffset, yoffset, zoffset, width,
          height, depth, format, type, pixels);
  @override
  void texParameterf(int target, int pname, double param) =>
      inner.texParameterf(target, pname, param);
  @override
  void texParameteri(int target, int pname, int param) =>
      inner.texParameteri(target, pname, param);
  @override
  void generateMipmap(int target) => inner.generateMipmap(target);

  // ---- program

  @override
  void shaderSource(int shader, String source) =>
      inner.shaderSource(shader, source);
  @override
  void compileShader(int shader) => inner.compileShader(shader);
  @override
  void attachShader(int program, int shader) =>
      inner.attachShader(program, shader);
  @override
  void detachShader(int program, int shader) =>
      inner.detachShader(program, shader);
  @override
  void linkProgram(int program) => inner.linkProgram(program);
  @override
  void useProgram(int id) {
    _set('program', _bound(id));
    inner.useProgram(id);
  }

  @override
  void validateProgram(int program) => inner.validateProgram(program);
  @override
  void bindAttribLocation(int program, int index, String name) =>
      inner.bindAttribLocation(program, index, name);

  // ---- vertex: array state lives in the bound (possibly hidden) VAO and is
  // forwarded; the generic attribute VALUE is context state

  @override
  void enableVertexAttribArray(int index) =>
      inner.enableVertexAttribArray(index);
  @override
  void disableVertexAttribArray(int index) =>
      inner.disableVertexAttribArray(index);
  @override
  void vertexAttribPointer(int index, int size, int type, bool normalized,
          int stride, int offset) =>
      inner.vertexAttribPointer(index, size, type, normalized, stride, offset);
  @override
  void vertexAttribDivisor(int index, int divisor) =>
      inner.vertexAttribDivisor(index, divisor);

  void _attrib(int index, double x, double y, double z, double w) =>
      _set(('attrib', index), (x, y, z, w));

  @override
  void vertexAttrib1f(int index, double x) {
    _attrib(index, x, 0, 0, 1);
    inner.vertexAttrib1f(index, x);
  }

  @override
  void vertexAttrib2f(int index, double x, double y) {
    _attrib(index, x, y, 0, 1);
    inner.vertexAttrib2f(index, x, y);
  }

  @override
  void vertexAttrib3f(int index, double x, double y, double z) {
    _attrib(index, x, y, z, 1);
    inner.vertexAttrib3f(index, x, y, z);
  }

  @override
  void vertexAttrib4f(int index, double x, double y, double z, double w) {
    _attrib(index, x, y, z, w);
    inner.vertexAttrib4f(index, x, y, z, w);
  }

  @override
  void vertexAttrib1fv(int index, Float32List v) {
    _attrib(index, v[0], 0, 0, 1);
    inner.vertexAttrib1fv(index, v);
  }

  @override
  void vertexAttrib2fv(int index, Float32List v) {
    _attrib(index, v[0], v[1], 0, 1);
    inner.vertexAttrib2fv(index, v);
  }

  @override
  void vertexAttrib3fv(int index, Float32List v) {
    _attrib(index, v[0], v[1], v[2], 1);
    inner.vertexAttrib3fv(index, v);
  }

  @override
  void vertexAttrib4fv(int index, Float32List v) {
    _attrib(index, v[0], v[1], v[2], v[3]);
    inner.vertexAttrib4fv(index, v);
  }

  // ---- uniform (program object state, forwarded)

  @override
  void uniform1i(int location, int x) => inner.uniform1i(location, x);
  @override
  void uniform2i(int location, int x, int y) =>
      inner.uniform2i(location, x, y);
  @override
  void uniform3i(int location, int x, int y, int z) =>
      inner.uniform3i(location, x, y, z);
  @override
  void uniform4i(int location, int x, int y, int z, int w) =>
      inner.uniform4i(location, x, y, z, w);
  @override
  void uniform1f(int location, double x) => inner.uniform1f(location, x);
  @override
  void uniform2f(int location, double x, double y) =>
      inner.uniform2f(location, x, y);
  @override
  void uniform3f(int location, double x, double y, double z) =>
      inner.uniform3f(location, x, y, z);
  @override
  void uniform4f(int location, double x, double y, double z, double w) =>
      inner.uniform4f(location, x, y, z, w);
  @override
  void uniform1iv(int location, Int32List v) => inner.uniform1iv(location, v);
  @override
  void uniform2iv(int location, Int32List v) => inner.uniform2iv(location, v);
  @override
  void uniform3iv(int location, Int32List v) => inner.uniform3iv(location, v);
  @override
  void uniform4iv(int location, Int32List v) => inner.uniform4iv(location, v);
  @override
  void uniform1fv(int location, Float32List v) =>
      inner.uniform1fv(location, v);
  @override
  void uniform2fv(int location, Float32List v) =>
      inner.uniform2fv(location, v);
  @override
  void uniform3fv(int location, Float32List v) =>
      inner.uniform3fv(location, v);
  @override
  void uniform4fv(int location, Float32List v) =>
      inner.uniform4fv(location, v);
  @override
  void uniformMatrix2fv(int location, bool transpose, Float32List v) =>
      inner.uniformMatrix2fv(location, transpose, v);
  @override
  void uniformMatrix3fv(int location, bool transpose, Float32List v) =>
      inner.uniformMatrix3fv(location, transpose, v);
  @override
  void uniformMatrix4fv(int location, bool transpose, Float32List v) =>
      inner.uniformMatrix4fv(location, transpose, v);

  // ---- draw

  @override
  void clear(int mask) => inner.clear(mask);
  @override
  void drawArrays(int mode, int first, int count) =>
      inner.drawArrays(mode, first, count);
  @override
  void drawElements(int mode, int count, int type, int offset) =>
      inner.drawElements(mode, count, type, offset);
  @override
  void drawArraysInstanced(int mode, int first, int count, int instanceCount) =>
      inner.drawArraysInstanced(mode, first, count, instanceCount);
  @override
  void drawElementsInstanced(
          int mode, int count, int type, int offset, int instanceCount) =>
      inner.drawElementsInstanced(mode, count, type, offset, instanceCount);
  @override
  void finish() => inner.finish();
  @override
  void flush() => inner.flush();

  // ---- framebuffer attachments (object state, forwarded)

  @override
  void framebufferTexture2D(
          int target, int attachment, int textarget, int texture, int level) =>
      inner.framebufferTexture2D(target, attachment, textarget, texture, level);
  @override
  void framebufferRenderbuffer(int target, int attachment,
          int renderbuffertarget, int renderbuffer) =>
      inner.framebufferRenderbuffer(
          target, attachment, renderbuffertarget, renderbuffer);
  @override
  void renderbufferStorage(
          int target, int internalformat, int width, int height) =>
      inner.renderbufferStorage(target, internalformat, width, height);

  // ---- queries (forwarded; the caller syncs first)

  @override
  int getError() => inner.getError();
  @override
  int getAttribLocation(int program, String name) =>
      inner.getAttribLocation(program, name);
  @override
  Object? getParameter(int pname) => inner.getParameter(pname);
  @override
  Object? getShaderParameter(int shader, int pname) =>
      inner.getShaderParameter(shader, pname);
  @override
  Object? getProgramParameter(int program, int pname) =>
      inner.getProgramParameter(program, pname);
  @override
  String? getShaderInfoLog(int shader) => inner.getShaderInfoLog(shader);
  @override
  String? getProgramInfoLog(int program) => inner.getProgramInfoLog(program);
  @override
  String? getShaderSource(int shader) => inner.getShaderSource(shader);
  @override
  FjsActiveInfo? getActiveAttrib(int program, int index) =>
      inner.getActiveAttrib(program, index);
  @override
  FjsActiveInfo? getActiveUniform(int program, int index) =>
      inner.getActiveUniform(program, index);
  @override
  Object? getUniform(int program, int location) =>
      inner.getUniform(program, location);
  @override
  Object? getVertexAttrib(int index, int pname) =>
      inner.getVertexAttrib(index, pname);
  @override
  int? getBufferParameter(int target, int pname) =>
      inner.getBufferParameter(target, pname);
  @override
  int? getFramebufferAttachmentParameter(
          int target, int attachment, int pname) =>
      inner.getFramebufferAttachmentParameter(target, attachment, pname);
  @override
  int? getRenderbufferParameter(int target, int pname) =>
      inner.getRenderbufferParameter(target, pname);
  @override
  bool isBuffer(int id) => inner.isBuffer(id);
  @override
  bool isTexture(int id) => inner.isTexture(id);
  @override
  bool isProgram(int id) => inner.isProgram(id);
  @override
  bool isShader(int id) => inner.isShader(id);
  @override
  bool isFramebuffer(int id) => inner.isFramebuffer(id);
  @override
  bool isRenderbuffer(int id) => inner.isRenderbuffer(id);
  @override
  int checkFramebufferStatus(int target) =>
      inner.checkFramebufferStatus(target);
  @override
  Uint8List? readPixelsRgba(int x, int y, int width, int height) =>
      inner.readPixelsRgba(x, y, width, height);
}
