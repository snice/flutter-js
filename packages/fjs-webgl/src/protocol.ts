// WebGL command-stream writer — the Dart twin of the fjs_webgl package's
// webgl_replay.dart decoder. Both files list the same command ids in the
// same order and must move together; nothing generates one from the other,
// exactly like ui/ops.ts and ui_ops.dart.
//
// The payload of op 11 (UiOp.Webgl, which lives in the runtime core — the
// protocol is the engine's contract, the implementation is this module's).
// Shaped like the 2d display list — little-endian, f32 coordinates, strings
// interned per chunk, binary data inlined — but with a different retention
// model: 2d chunks are REPLAYED (the host keeps them and repaints on
// demand), these are EXECUTED (the host runs each chunk into the node's GL
// framebuffer as it arrives, then marks the texture for display). That is
// why there is no ClearAll / NeedsLayer machinery here: the framebuffer
// itself is the state, and a WebGL page that wants a fresh frame calls
// gl.clear().
//
// Numbering is u16, grouped by instruction family, with the gaps left for
// WebGL 2 (VAO 0x0900+, query objects) — see spec 021 §1. WebGL 2 commands
// that belong to an existing family join it instead of the reserved range:
// vertexAttribDivisor sits in 0x05xx (spec 023), the instanced draws in
// 0x06xx next to their non-instanced twins (spec 033).
import { ByteBuf, utf8Encode } from '@ufjs/runtime';

export const enum WebglCmd {
  /** u16 id, u16 len, utf8 — per-chunk string intern, same shape as 2d. */
  StrDef = 0x0001,
  /** u16 id, u32 len, utf8. Same intern, longer strings: three.js's built-in
   * PBR + skinning shader source crosses 64 KiB, and a silently truncated
   * u16 length desyncs the whole stream from that point on (spec 023, iOS).
   * The webgl family switched to this form; the 2d display list keeps its
   * own shorter-string encoding, so the two share the id space's low slot
   * but not the field widths. */
  StrDef32 = 0x0002,

  // -- resources 0x01xx --------------------------------------------------
  CreateBuffer = 0x0101,
  DeleteBuffer = 0x0102,
  CreateFramebuffer = 0x0103,
  DeleteFramebuffer = 0x0104,
  CreateProgram = 0x0105,
  DeleteProgram = 0x0106,
  CreateRenderbuffer = 0x0107,
  DeleteRenderbuffer = 0x0108,
  CreateShader = 0x0109,
  DeleteShader = 0x010a,
  CreateTexture = 0x010b,
  DeleteTexture = 0x010c,

  // -- binding & state 0x02xx -------------------------------------------
  ActiveTexture = 0x0201,
  BindBuffer = 0x0202,
  BindFramebuffer = 0x0203,
  BindRenderbuffer = 0x0204,
  BindTexture = 0x0205,
  BlendColor = 0x0206,
  BlendEquation = 0x0207,
  BlendEquationSeparate = 0x0208,
  BlendFunc = 0x0209,
  BlendFuncSeparate = 0x020a,
  ClearColor = 0x020b,
  ClearDepth = 0x020c,
  ClearStencil = 0x020d,
  ColorMask = 0x020e,
  CullFace = 0x020f,
  DepthFunc = 0x0210,
  DepthMask = 0x0211,
  DepthRange = 0x0212,
  Disable = 0x0213,
  Enable = 0x0214,
  FrontFace = 0x0215,
  Hint = 0x0216,
  LineWidth = 0x0217,
  PixelStorei = 0x0218,
  PolygonOffset = 0x0219,
  SampleCoverage = 0x021a,
  Scissor = 0x021b,
  StencilFunc = 0x021c,
  StencilFuncSeparate = 0x021d,
  StencilMask = 0x021e,
  StencilMaskSeparate = 0x021f,
  StencilOp = 0x0220,
  StencilOpSeparate = 0x0221,
  Viewport = 0x0222,

  // -- data upload 0x03xx ------------------------------------------------
  BufferData = 0x0301,
  BufferDataSize = 0x0302,
  BufferSubData = 0x0303,
  TexImage2D = 0x0304,
  TexImage2DSource = 0x0305,
  TexSubImage2D = 0x0306,
  TexParameterf = 0x0307,
  TexParameteri = 0x0308,
  GenerateMipmap = 0x0309,
  // three.js r163+ dropped WebGL 1: every image texture uploads through
  // texStorage2D + texSubImage2D(source) (spec 023)
  TexStorage2D = 0x030a,
  TexSubImage2DSource = 0x030b,
  // three.js's WebGLState also seeds empty 3D/array textures at init
  TexImage3D = 0x030c,
  TexSubImage3D = 0x030d,

  // -- program 0x04xx ----------------------------------------------------
  ShaderSource = 0x0401,
  CompileShader = 0x0402,
  AttachShader = 0x0403,
  DetachShader = 0x0404,
  LinkProgram = 0x0405,
  UseProgram = 0x0406,
  ValidateProgram = 0x0407,
  BindAttribLocation = 0x0408,

  // -- vertex & uniform 0x05xx ------------------------------------------
  EnableVertexAttribArray = 0x0501,
  DisableVertexAttribArray = 0x0502,
  VertexAttribPointer = 0x0503,
  /** WebGL2 core: three.js's WebGLBindingStates calls it for EVERY enabled
   * attribute (divisor 1 for plain ones), not just instanced draws. */
  VertexAttribDivisor = 0x050c,
  VertexAttrib1f = 0x0504,
  VertexAttrib2f = 0x0505,
  VertexAttrib3f = 0x0506,
  VertexAttrib4f = 0x0507,
  VertexAttrib1fv = 0x0508,
  VertexAttrib2fv = 0x0509,
  VertexAttrib3fv = 0x050a,
  VertexAttrib4fv = 0x050b,
  Uniform1i = 0x0510,
  Uniform2i = 0x0511,
  Uniform3i = 0x0512,
  Uniform4i = 0x0513,
  Uniform1f = 0x0514,
  Uniform2f = 0x0515,
  Uniform3f = 0x0516,
  Uniform4f = 0x0517,
  Uniform1iv = 0x0518,
  Uniform2iv = 0x0519,
  Uniform3iv = 0x051a,
  Uniform4iv = 0x051b,
  Uniform1fv = 0x051c,
  Uniform2fv = 0x051d,
  Uniform3fv = 0x051e,
  Uniform4fv = 0x051f,
  UniformMatrix2fv = 0x0520,
  UniformMatrix3fv = 0x0521,
  UniformMatrix4fv = 0x0522,

  // -- draw 0x06xx -------------------------------------------------------
  Clear = 0x0601,
  DrawArrays = 0x0602,
  DrawElements = 0x0603,
  Finish = 0x0604,
  Flush = 0x0605,
  /** WebGL2 core (spec 033): DrawArrays' fields, then u32 instanceCount.
   * three.js's InstancedMesh draws through these; the per-instance
   * attributes ride on VertexAttribDivisor. */
  DrawArraysInstanced = 0x0606,
  /** DrawElements' fields, then u32 instanceCount (spec 033). */
  DrawElementsInstanced = 0x0607,

  // -- framebuffer 0x07xx ------------------------------------------------
  FramebufferTexture2D = 0x0701,
  FramebufferRenderbuffer = 0x0702,
  RenderbufferStorage = 0x0703,

  // -- vertex arrays 0x09xx ----------------------------------------------
  // WebGL 2's VAOs, added for three.js (spec 023): its WebGLBindingStates
  // wraps every draw in a VAO, unconditionally, when the context is WebGL2.
  CreateVertexArray = 0x0901,
  BindVertexArray = 0x0902,
  DeleteVertexArray = 0x0903,
}

/** texImage2D's source kinds for TexImage2DSource. Pixels (TypedArray /
 * ArrayBuffer) take the 9-arg form instead and never use these. */
export const enum TexSource {
  /** u32 handle into the host's canvas image table (FjsCanvasImage). */
  ImageHandle = 1,
}

/** Writes one canvas node's WebGL command stream. Chunks are closed at flush
 * time only — there is no truncation concept, so a frame is simply whatever
 * accumulated since the last take. */
export class WebglChunkWriter {
  private buf = new ByteBuf();
  private pending: Uint8Array[] = [];
  /** Per-chunk string table; cleared whenever a chunk is closed. */
  private strings = new Map<string, number>();
  private nextStringId = 1;

  constructor(private readonly onDirty: () => void) {}

  /** Interns a string in the current chunk, emitting its definition once.
   * u32 length: shader sources exceed the 64 KiB a u16 can express. */
  str(value: string): number {
    const known = this.strings.get(value);
    if (known !== undefined) return known;
    const id = this.nextStringId++;
    this.strings.set(value, id);
    const encoded = utf8Encode(value);
    this.buf.u16(WebglCmd.StrDef32);
    this.buf.u16(id);
    this.buf.u32(encoded.length);
    this.buf.bytes(encoded);
    return id;
  }

  private cmd(c: WebglCmd): ByteBuf {
    this.buf.u16(c);
    this.onDirty();
    return this.buf;
  }

  // Everything below is a one-method-per-GL-call encoder. Typed schemas keep
  // the decoder in the Dart package trivially table-like; the alternative
  // (a generic arg-descriptor DSL) would cost a runtime interpreter on both
  // ends for no gain at this size.

  createBuffer(id: number): void {
    this.cmd(WebglCmd.CreateBuffer).u32(id);
  }

  deleteBuffer(id: number): void {
    this.cmd(WebglCmd.DeleteBuffer).u32(id);
  }

  createFramebuffer(id: number): void {
    this.cmd(WebglCmd.CreateFramebuffer).u32(id);
  }

  deleteFramebuffer(id: number): void {
    this.cmd(WebglCmd.DeleteFramebuffer).u32(id);
  }

  createProgram(id: number): void {
    this.cmd(WebglCmd.CreateProgram).u32(id);
  }

  deleteProgram(id: number): void {
    this.cmd(WebglCmd.DeleteProgram).u32(id);
  }

  createRenderbuffer(id: number): void {
    this.cmd(WebglCmd.CreateRenderbuffer).u32(id);
  }

  deleteRenderbuffer(id: number): void {
    this.cmd(WebglCmd.DeleteRenderbuffer).u32(id);
  }

  createShader(id: number, type: number): void {
    this.cmd(WebglCmd.CreateShader).u32(id).u32(type);
  }

  deleteShader(id: number): void {
    this.cmd(WebglCmd.DeleteShader).u32(id);
  }

  createTexture(id: number): void {
    this.cmd(WebglCmd.CreateTexture).u32(id);
  }

  deleteTexture(id: number): void {
    this.cmd(WebglCmd.DeleteTexture).u32(id);
  }

  createVertexArray(id: number): void {
    this.cmd(WebglCmd.CreateVertexArray).u32(id);
  }

  bindVertexArray(id: number): void {
    this.cmd(WebglCmd.BindVertexArray).u32(id);
  }

  deleteVertexArray(id: number): void {
    this.cmd(WebglCmd.DeleteVertexArray).u32(id);
  }

  activeTexture(unit: number): void {
    this.cmd(WebglCmd.ActiveTexture).u32(unit);
  }

  bindBuffer(target: number, id: number): void {
    this.cmd(WebglCmd.BindBuffer).u32(target).u32(id);
  }

  bindFramebuffer(target: number, id: number): void {
    this.cmd(WebglCmd.BindFramebuffer).u32(target).u32(id);
  }

  bindRenderbuffer(target: number, id: number): void {
    this.cmd(WebglCmd.BindRenderbuffer).u32(target).u32(id);
  }

  bindTexture(target: number, id: number): void {
    this.cmd(WebglCmd.BindTexture).u32(target).u32(id);
  }

  blendColor(r: number, g: number, b: number, a: number): void {
    this.cmd(WebglCmd.BlendColor).f32(r).f32(g).f32(b).f32(a);
  }

  blendEquation(mode: number): void {
    this.cmd(WebglCmd.BlendEquation).u32(mode);
  }

  blendEquationSeparate(modeRgb: number, modeAlpha: number): void {
    this.cmd(WebglCmd.BlendEquationSeparate).u32(modeRgb).u32(modeAlpha);
  }

  blendFunc(sfactor: number, dfactor: number): void {
    this.cmd(WebglCmd.BlendFunc).u32(sfactor).u32(dfactor);
  }

  blendFuncSeparate(
    srcRgb: number,
    dstRgb: number,
    srcAlpha: number,
    dstAlpha: number,
  ): void {
    this.cmd(WebglCmd.BlendFuncSeparate)
      .u32(srcRgb)
      .u32(dstRgb)
      .u32(srcAlpha)
      .u32(dstAlpha);
  }

  clearColor(r: number, g: number, b: number, a: number): void {
    this.cmd(WebglCmd.ClearColor).f32(r).f32(g).f32(b).f32(a);
  }

  clearDepth(depth: number): void {
    this.cmd(WebglCmd.ClearDepth).f32(depth);
  }

  clearStencil(s: number): void {
    this.cmd(WebglCmd.ClearStencil).i32(s);
  }

  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void {
    this.cmd(WebglCmd.ColorMask)
      .u8(r ? 1 : 0)
      .u8(g ? 1 : 0)
      .u8(b ? 1 : 0)
      .u8(a ? 1 : 0);
  }

  cullFace(mode: number): void {
    this.cmd(WebglCmd.CullFace).u32(mode);
  }

  depthFunc(func: number): void {
    this.cmd(WebglCmd.DepthFunc).u32(func);
  }

  depthMask(flag: boolean): void {
    this.cmd(WebglCmd.DepthMask).u8(flag ? 1 : 0);
  }

  depthRange(zNear: number, zFar: number): void {
    this.cmd(WebglCmd.DepthRange).f32(zNear).f32(zFar);
  }

  disable(cap: number): void {
    this.cmd(WebglCmd.Disable).u32(cap);
  }

  enable(cap: number): void {
    this.cmd(WebglCmd.Enable).u32(cap);
  }

  frontFace(mode: number): void {
    this.cmd(WebglCmd.FrontFace).u32(mode);
  }

  hint(target: number, mode: number): void {
    this.cmd(WebglCmd.Hint).u32(target).u32(mode);
  }

  lineWidth(width: number): void {
    this.cmd(WebglCmd.LineWidth).f32(width);
  }

  pixelStorei(pname: number, param: number): void {
    this.cmd(WebglCmd.PixelStorei).u32(pname).i32(param);
  }

  polygonOffset(factor: number, units: number): void {
    this.cmd(WebglCmd.PolygonOffset).f32(factor).f32(units);
  }

  sampleCoverage(value: number, invert: boolean): void {
    this.cmd(WebglCmd.SampleCoverage).f32(value).u8(invert ? 1 : 0);
  }

  scissor(x: number, y: number, width: number, height: number): void {
    this.cmd(WebglCmd.Scissor)
      .i32(x)
      .i32(y)
      .i32(width)
      .i32(height);
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    this.cmd(WebglCmd.StencilFunc).u32(func).i32(ref).u32(mask);
  }

  stencilFuncSeparate(
    face: number,
    func: number,
    ref: number,
    mask: number,
  ): void {
    this.cmd(WebglCmd.StencilFuncSeparate)
      .u32(face)
      .u32(func)
      .i32(ref)
      .u32(mask);
  }

  stencilMask(mask: number): void {
    this.cmd(WebglCmd.StencilMask).u32(mask);
  }

  stencilMaskSeparate(face: number, mask: number): void {
    this.cmd(WebglCmd.StencilMaskSeparate).u32(face).u32(mask);
  }

  stencilOp(fail: number, zfail: number, zpass: number): void {
    this.cmd(WebglCmd.StencilOp).u32(fail).u32(zfail).u32(zpass);
  }

  stencilOpSeparate(
    face: number,
    fail: number,
    zfail: number,
    zpass: number,
  ): void {
    this.cmd(WebglCmd.StencilOpSeparate)
      .u32(face)
      .u32(fail)
      .u32(zfail)
      .u32(zpass);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.cmd(WebglCmd.Viewport)
      .i32(x)
      .i32(y)
      .i32(width)
      .i32(height);
  }

  /** bufferData's data form: TypedArray/ArrayBuffer payload inlined. */
  bufferData(target: number, data: Uint8Array, usage: number): void {
    this.cmd(WebglCmd.BufferData)
      .u32(target)
      .u32(usage)
      .u32(data.length)
      .bytes(data);
  }

  bufferDataSize(target: number, size: number, usage: number): void {
    this.cmd(WebglCmd.BufferDataSize).u32(target).u32(usage).u32(size);
  }

  bufferSubData(target: number, offset: number, data: Uint8Array): void {
    this.cmd(WebglCmd.BufferSubData)
      .u32(target)
      .i32(offset)
      .u32(data.length)
      .bytes(data);
  }

  /** texImage2D's 9-arg pixel form (TypedArray/ArrayBuffer source). */
  texImage2D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void {
    this.cmd(WebglCmd.TexImage2D)
      .u32(target)
      .i32(level)
      .i32(internalformat)
      .i32(width)
      .i32(height)
      .i32(border)
      .u32(format)
      .u32(type)
      .u32(pixels.length)
      .bytes(pixels);
  }

  /** texImage2D's 6-arg source form. Only FjsCanvasImage sources cross here:
   * the pixels stay on the host, named by handle.
   *
   * flipY carries the one GL state this module tracks client-side:
   * `pixelStorei(UNPACK_FLIP_Y_WEBGL, …)`. three.js sets it before every
   * image-texture upload and the decoder has no state machine to remember
   * it, so the flag rides along with the command. Web browsers implement
   * the flip inside texImage2D; ANGLE was observed not to honor the pname on
   * the raw-pixel upload path, so the Dart side flips the cached RGBA rows
   * itself when this is 1. */
  texImage2DSource(
    target: number,
    level: number,
    internalformat: number,
    format: number,
    type: number,
    handle: number,
    flipY = false,
  ): void {
    this.cmd(WebglCmd.TexImage2DSource)
      .u32(target)
      .i32(level)
      .i32(internalformat)
      .u32(format)
      .u32(type)
      .u32(TexSource.ImageHandle)
      .u32(handle)
      .u8(flipY ? 1 : 0);
  }

  texSubImage2D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void {
    this.cmd(WebglCmd.TexSubImage2D)
      .u32(target)
      .i32(level)
      .i32(xoffset)
      .i32(yoffset)
      .i32(width)
      .i32(height)
      .u32(format)
      .u32(type)
      .u32(pixels.length)
      .bytes(pixels);
  }

  texStorage2D(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.cmd(WebglCmd.TexStorage2D)
      .u32(target)
      .i32(levels)
      .i32(internalformat)
      .i32(width)
      .i32(height);
  }

  /** texSubImage2D's 6-arg source form, told apart from the 9-arg pixel form
   * by arity — the same DOM shape three.js reaches after texStorage2D. The
   * pixel dimensions come from the host's cached image, not the wire. */
  texSubImage2DSource(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    format: number,
    type: number,
    handle: number,
    flipY = false,
  ): void {
    this.cmd(WebglCmd.TexSubImage2DSource)
      .u32(target)
      .i32(level)
      .i32(xoffset)
      .i32(yoffset)
      .u32(format)
      .u32(type)
      .u32(TexSource.ImageHandle)
      .u32(handle)
      .u8(flipY ? 1 : 0);
  }

  texParameterf(target: number, pname: number, param: number): void {
    this.cmd(WebglCmd.TexParameterf).u32(target).u32(pname).f32(param);
  }

  /** texImage3D's pixel form — 3D/array textures only ever carry TypedArray
   * pixels in this runtime (an image handle has no depth). */
  texImage3D(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    depth: number,
    border: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void {
    this.cmd(WebglCmd.TexImage3D)
      .u32(target)
      .i32(level)
      .i32(internalformat)
      .i32(width)
      .i32(height)
      .i32(depth)
      .i32(border)
      .u32(format)
      .u32(type)
      .u32(pixels.length)
      .bytes(pixels);
  }

  texSubImage3D(
    target: number,
    level: number,
    xoffset: number,
    yoffset: number,
    zoffset: number,
    width: number,
    height: number,
    depth: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ): void {
    this.cmd(WebglCmd.TexSubImage3D)
      .u32(target)
      .i32(level)
      .i32(xoffset)
      .i32(yoffset)
      .i32(zoffset)
      .i32(width)
      .i32(height)
      .i32(depth)
      .u32(format)
      .u32(type)
      .u32(pixels.length)
      .bytes(pixels);
  }

  texParameteri(target: number, pname: number, param: number): void {
    this.cmd(WebglCmd.TexParameteri).u32(target).u32(pname).i32(param);
  }

  generateMipmap(target: number): void {
    this.cmd(WebglCmd.GenerateMipmap).u32(target);
  }

  shaderSource(shader: number, source: number): void {
    this.cmd(WebglCmd.ShaderSource).u32(shader).u16(source);
  }

  compileShader(shader: number): void {
    this.cmd(WebglCmd.CompileShader).u32(shader);
  }

  attachShader(program: number, shader: number): void {
    this.cmd(WebglCmd.AttachShader).u32(program).u32(shader);
  }

  detachShader(program: number, shader: number): void {
    this.cmd(WebglCmd.DetachShader).u32(program).u32(shader);
  }

  linkProgram(program: number): void {
    this.cmd(WebglCmd.LinkProgram).u32(program);
  }

  useProgram(program: number): void {
    this.cmd(WebglCmd.UseProgram).u32(program);
  }

  validateProgram(program: number): void {
    this.cmd(WebglCmd.ValidateProgram).u32(program);
  }

  bindAttribLocation(program: number, index: number, name: number): void {
    this.cmd(WebglCmd.BindAttribLocation).u32(program).u32(index).u16(name);
  }

  enableVertexAttribArray(index: number): void {
    this.cmd(WebglCmd.EnableVertexAttribArray).u32(index);
  }

  disableVertexAttribArray(index: number): void {
    this.cmd(WebglCmd.DisableVertexAttribArray).u32(index);
  }

  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.cmd(WebglCmd.VertexAttribPointer)
      .u32(index)
      .i32(size)
      .u32(type)
      .u8(normalized ? 1 : 0)
      .i32(stride)
      .i32(offset);
  }

  vertexAttribDivisor(index: number, divisor: number): void {
    this.cmd(WebglCmd.VertexAttribDivisor).u32(index).u32(divisor);
  }

  vertexAttrib1f(index: number, x: number): void {
    this.cmd(WebglCmd.VertexAttrib1f).u32(index).f32(x);
  }

  vertexAttrib2f(index: number, x: number, y: number): void {
    this.cmd(WebglCmd.VertexAttrib2f).u32(index).f32(x).f32(y);
  }

  vertexAttrib3f(index: number, x: number, y: number, z: number): void {
    this.cmd(WebglCmd.VertexAttrib3f).u32(index).f32(x).f32(y).f32(z);
  }

  vertexAttrib4f(
    index: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.cmd(WebglCmd.VertexAttrib4f)
      .u32(index)
      .f32(x)
      .f32(y)
      .f32(z)
      .f32(w);
  }

  /** Shared by the fv forms: count floats, not components — the GL call's
   * own arity is implied by the command id, so the decoder slices exactly. */
  private vertexAttribNfv(cmd: WebglCmd, index: number, v: number[]): void {
    const buf = this.cmd(cmd).u32(index).u32(v.length);
    for (const x of v) buf.f32(x);
  }

  vertexAttrib1fv(index: number, v: number[]): void {
    this.vertexAttribNfv(WebglCmd.VertexAttrib1fv, index, v);
  }

  vertexAttrib2fv(index: number, v: number[]): void {
    this.vertexAttribNfv(WebglCmd.VertexAttrib2fv, index, v);
  }

  vertexAttrib3fv(index: number, v: number[]): void {
    this.vertexAttribNfv(WebglCmd.VertexAttrib3fv, index, v);
  }

  vertexAttrib4fv(index: number, v: number[]): void {
    this.vertexAttribNfv(WebglCmd.VertexAttrib4fv, index, v);
  }

  uniform1i(location: number, x: number): void {
    this.cmd(WebglCmd.Uniform1i).u32(location).i32(x);
  }

  uniform2i(location: number, x: number, y: number): void {
    this.cmd(WebglCmd.Uniform2i).u32(location).i32(x).i32(y);
  }

  uniform3i(location: number, x: number, y: number, z: number): void {
    this.cmd(WebglCmd.Uniform3i).u32(location).i32(x).i32(y).i32(z);
  }

  uniform4i(
    location: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.cmd(WebglCmd.Uniform4i)
      .u32(location)
      .i32(x)
      .i32(y)
      .i32(z)
      .i32(w);
  }

  uniform1f(location: number, x: number): void {
    this.cmd(WebglCmd.Uniform1f).u32(location).f32(x);
  }

  uniform2f(location: number, x: number, y: number): void {
    this.cmd(WebglCmd.Uniform2f).u32(location).f32(x).f32(y);
  }

  uniform3f(location: number, x: number, y: number, z: number): void {
    this.cmd(WebglCmd.Uniform3f).u32(location).f32(x).f32(y).f32(z);
  }

  uniform4f(
    location: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    this.cmd(WebglCmd.Uniform4f)
      .u32(location)
      .f32(x)
      .f32(y)
      .f32(z)
      .f32(w);
  }

  private uniformNiv(cmd: WebglCmd, location: number, v: number[]): void {
    const buf = this.cmd(cmd).u32(location).u32(v.length);
    for (const x of v) buf.i32(x);
  }

  private uniformNfv(cmd: WebglCmd, location: number, v: number[]): void {
    const buf = this.cmd(cmd).u32(location).u32(v.length);
    for (const x of v) buf.f32(x);
  }

  uniform1iv(location: number, v: number[]): void {
    this.uniformNiv(WebglCmd.Uniform1iv, location, v);
  }

  uniform2iv(location: number, v: number[]): void {
    this.uniformNiv(WebglCmd.Uniform2iv, location, v);
  }

  uniform3iv(location: number, v: number[]): void {
    this.uniformNiv(WebglCmd.Uniform3iv, location, v);
  }

  uniform4iv(location: number, v: number[]): void {
    this.uniformNiv(WebglCmd.Uniform4iv, location, v);
  }

  uniform1fv(location: number, v: number[]): void {
    this.uniformNfv(WebglCmd.Uniform1fv, location, v);
  }

  uniform2fv(location: number, v: number[]): void {
    this.uniformNfv(WebglCmd.Uniform2fv, location, v);
  }

  uniform3fv(location: number, v: number[]): void {
    this.uniformNfv(WebglCmd.Uniform3fv, location, v);
  }

  uniform4fv(location: number, v: number[]): void {
    this.uniformNfv(WebglCmd.Uniform4fv, location, v);
  }

  private uniformMatrixNfv(
    cmd: WebglCmd,
    location: number,
    transpose: boolean,
    v: number[],
  ): void {
    const buf = this.cmd(cmd)
      .u32(location)
      .u8(transpose ? 1 : 0)
      .u32(v.length);
    for (const x of v) buf.f32(x);
  }

  uniformMatrix2fv(location: number, transpose: boolean, v: number[]): void {
    this.uniformMatrixNfv(WebglCmd.UniformMatrix2fv, location, transpose, v);
  }

  uniformMatrix3fv(location: number, transpose: boolean, v: number[]): void {
    this.uniformMatrixNfv(WebglCmd.UniformMatrix3fv, location, transpose, v);
  }

  uniformMatrix4fv(location: number, transpose: boolean, v: number[]): void {
    this.uniformMatrixNfv(WebglCmd.UniformMatrix4fv, location, transpose, v);
  }

  clear(mask: number): void {
    this.cmd(WebglCmd.Clear).u32(mask);
  }

  drawArrays(mode: number, first: number, count: number): void {
    this.cmd(WebglCmd.DrawArrays).u32(mode).i32(first).u32(count);
  }

  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.cmd(WebglCmd.DrawElements)
      .u32(mode)
      .u32(count)
      .u32(type)
      .i32(offset);
  }

  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.cmd(WebglCmd.DrawArraysInstanced)
      .u32(mode)
      .i32(first)
      .u32(count)
      .u32(instanceCount);
  }

  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void {
    this.cmd(WebglCmd.DrawElementsInstanced)
      .u32(mode)
      .u32(count)
      .u32(type)
      .i32(offset)
      .u32(instanceCount);
  }

  finish(): void {
    this.cmd(WebglCmd.Finish);
  }

  flush(): void {
    this.cmd(WebglCmd.Flush);
  }

  framebufferTexture2D(
    target: number,
    attachment: number,
    textarget: number,
    texture: number,
    level: number,
  ): void {
    this.cmd(WebglCmd.FramebufferTexture2D)
      .u32(target)
      .u32(attachment)
      .u32(textarget)
      .u32(texture)
      .i32(level);
  }

  framebufferRenderbuffer(
    target: number,
    attachment: number,
    renderbuffertarget: number,
    renderbuffer: number,
  ): void {
    this.cmd(WebglCmd.FramebufferRenderbuffer)
      .u32(target)
      .u32(attachment)
      .u32(renderbuffertarget)
      .u32(renderbuffer);
  }

  renderbufferStorage(
    target: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.cmd(WebglCmd.RenderbufferStorage)
      .u32(target)
      .u32(internalformat)
      .i32(width)
      .i32(height);
  }

  /** Closes the current chunk (if anything was written) and hands back the
   * chunks to send, oldest first. The string table resets per chunk, so a
   * dropped chunk never leaves the decoder with a dangling intern. */
  takeChunks(): Uint8Array[] {
    if (this.buf.length > 0) this.pending.push(this.buf.take());
    this.strings.clear();
    this.nextStringId = 1;
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get isEmpty(): boolean {
    return this.buf.length === 0 && this.pending.length === 0;
  }
}
