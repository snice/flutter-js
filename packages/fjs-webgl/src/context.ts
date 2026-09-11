// WebGLRenderingContext, implemented in JS on top of the command stream.
//
// The division of labour matches the 2d context: everything JS can hold —
// resource ids, the argument encoding, the error-free fast path — lives here;
// the host does the part JS cannot do at all, running the commands against a
// real GPU context (flutter_angle, in the fjs_webgl Dart package). The
// queries that the DOM's WebGL can answer synchronously — getAttribLocation,
// shader compile status, the info logs — cross back over invokeHost as
// scalars or JSON strings (v1 ABI, constitution II), which is why the spec
// only promises query semantics for resource/compile state, not for commands
// that have not been flushed yet.
//
// Unlike the 2d context there is NO state machine here: GL is already a
// state machine, deduplicating it client-side would need a faithful second
// copy of it, and a WebGL page redraws every frame anyway. Everything
// mutates the stream directly.
import {
  invokeHost,
  flushNow,
  getWriter,
  FjsCanvasImage,
  type CanvasContextTarget,
  type FjsCanvasOpWriter,
} from '@ufjs/runtime';
import { WebglChunkWriter } from './protocol';
import { warnWebglOnce } from './warn';

/** What the WebGL context needs from whatever owns the canvas: the core
 * surface's members, narrowed structurally (the core never names this
 * module, and this module never imports runtime internals). */
export interface WebglSurface {
  readonly nodeId: number;
  /** Current LOGICAL size; 0 before the host has laid the box out. */
  width(): number;
  height(): number;
  /** The ratio the host renders this canvas's backing store at. Real dpr on
   * web; on Flutter the host reports it in the size event. The 2d surface
   * hides dpr from the page — GL cannot, `viewport` is in pixels — so a
   * webgl context follows web semantics instead: bitmap size = logical ×
   * dpr, page derives viewport from gl.canvas.width. (spec 021 §3.2) */
  devicePixelRatio(): number;
  /** Frame plumbing: this module's chunks ride the canvas node's op frame
   * as op 11 (written through the core's op writer). */
  attachOpWriter(w: FjsCanvasOpWriter): void;
  /** The dirty signal the module's writer feeds — same flush cadence as 2d. */
  markDirty(): void;
}

/** An opaque GL resource: what `createBuffer()` & co. hand back. A page only
 * ever passes it back to the context that made it, so the id is the whole
 * story; the kind exists for error messages. */
export class FjsWebGLObject {
  constructor(
    readonly kind: string,
    /** 0 means "null object" — the DOM's `null` argument. */
    readonly id: number,
  ) {}

  toString(): string {
    return `[object ${this.kind}]`;
  }
}

type Resource = FjsWebGLObject | null;

function resourceId(res: Resource): number {
  // undefined/null → 0, which the host maps to "no object"
  return res instanceof FjsWebGLObject ? res.id : 0;
}

// -- constants (WebGL 1.0 spec values) -------------------------------------

export const GL = {
  /* ClearBufferMask */
  DEPTH_BUFFER_BIT: 0x00000100,
  STENCIL_BUFFER_BIT: 0x00000400,
  COLOR_BUFFER_BIT: 0x00004000,
  /* BeginMode */
  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
  /* BlendingFactorDest / BlendingFactorSrc */
  ZERO: 0,
  ONE: 1,
  SRC_COLOR: 0x0300,
  ONE_MINUS_SRC_COLOR: 0x0301,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_ALPHA: 0x0304,
  ONE_MINUS_DST_ALPHA: 0x0305,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  SRC_ALPHA_SATURATE: 0x0308,
  CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002,
  CONSTANT_ALPHA: 0x8003,
  ONE_MINUS_CONSTANT_ALPHA: 0x8004,
  BLEND_COLOR: 0x8005,
  FUNC_ADD: 0x8006,
  BLEND_EQUATION: 0x8009,
  BLEND_EQUATION_RGB: 0x8009,
  BLEND_EQUATION_ALPHA: 0x883d,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  BLEND_DST_RGB: 0x80c8,
  BLEND_SRC_RGB: 0x80c9,
  BLEND_DST_ALPHA: 0x80ca,
  BLEND_SRC_ALPHA: 0x80cb,
  /* Buffer objects */
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  ARRAY_BUFFER_BINDING: 0x8894,
  ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
  BUFFER_SIZE: 0x8764,
  BUFFER_USAGE: 0x8765,
  CURRENT_VERTEX_ATTRIB: 0x8626,
  /* BufferUsage */
  STREAM_DRAW: 0x88e0,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  /* CullFaceMode */
  FRONT: 0x0404,
  BACK: 0x0405,
  FRONT_AND_BACK: 0x0408,
  CULL_FACE: 0x0b44,
  CULL_FACE_MODE: 0x0b45,
  FRONT_FACE: 0x0b46,
  /* EnableCap */
  BLEND: 0x0be2,
  DITHER: 0x0bd0,
  STENCIL_TEST: 0x0b90,
  DEPTH_TEST: 0x0b71,
  SCISSOR_TEST: 0x0c11,
  POLYGON_OFFSET_FILL: 0x8037,
  SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
  SAMPLE_COVERAGE: 0x80a0,
  /* ErrorCode */
  NO_ERROR: 0,
  INVALID_ENUM: 0x0500,
  INVALID_VALUE: 0x0501,
  INVALID_OPERATION: 0x0502,
  INVALID_FRAMEBUFFER_OPERATION: 0x0506,
  OUT_OF_MEMORY: 0x0505,
  CONTEXT_LOST_WEBGL: 0x9242,
  /* FrontFaceDirection */
  CW: 0x0900,
  CCW: 0x0901,
  /* GetParameter */
  DEPTH_FUNC: 0x0b74,
  DEPTH_CLEAR_VALUE: 0x0b73,
  DEPTH_WRITEMASK: 0x0b72,
  DEPTH_RANGE: 0x0b70,
  STENCIL_CLEAR_VALUE: 0x0b91,
  STENCIL_FUNC: 0x0b92,
  STENCIL_VALUE_MASK: 0x0b93,
  STENCIL_FAIL: 0x0b94,
  STENCIL_PASS_DEPTH_FAIL: 0x0b95,
  STENCIL_PASS_DEPTH_PASS: 0x0b96,
  STENCIL_REF: 0x0b97,
  STENCIL_WRITEMASK: 0x0b98,
  STENCIL_BACK_FUNC: 0x8800,
  STENCIL_BACK_FAIL: 0x8801,
  STENCIL_BACK_PASS_DEPTH_FAIL: 0x8802,
  STENCIL_BACK_PASS_DEPTH_PASS: 0x8803,
  STENCIL_BACK_REF: 0x8ca3,
  STENCIL_BACK_VALUE_MASK: 0x8ca4,
  STENCIL_BACK_WRITEMASK: 0x8ca5,
  VIEWPORT: 0x0ba2,
  SCISSOR_BOX: 0x0c10,
  COLOR_CLEAR_VALUE: 0x0c22,
  COLOR_WRITEMASK: 0x0c23,
  LINE_WIDTH: 0x0b21,
  LINE_WIDTH_RANGE: 0x0b22,
  POLYGON_OFFSET_FACTOR: 0x8038,
  POLYGON_OFFSET_UNITS: 0x2a00,
  SAMPLE_COVERAGE_VALUE: 0x80aa,
  SAMPLE_COVERAGE_INVERT: 0x80ab,
  ACTIVE_TEXTURE: 0x84e0,
  ALIASED_LINE_WIDTH_RANGE: 0x846e,
  ALIASED_POINT_SIZE_RANGE: 0x846d,
  IMPLEMENTATION_COLOR_READ_FORMAT: 0x8b9b,
  IMPLEMENTATION_COLOR_READ_TYPE: 0x8b9a,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d,
  MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c,
  MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_VARYING_VECTORS: 0x8dfc,
  MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb,
  MAX_VIEWPORT_DIMS: 0x0d3a,
  RED_BITS: 0x0d52,
  GREEN_BITS: 0x0d53,
  BLUE_BITS: 0x0d54,
  ALPHA_BITS: 0x0d55,
  DEPTH_BITS: 0x0d56,
  STENCIL_BITS: 0x0d57,
  SAMPLES: 0x80a9,
  SAMPLE_BUFFERS: 0x80a8,
  SUBPIXEL_BITS: 0x0d50,
  RENDERER: 0x1f01,
  VENDOR: 0x1f00,
  VERSION: 0x1f02,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
  /* DepthFunction / StencilFunction */
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  /* StencilOp */
  KEEP: 0x1e00,
  REPLACE: 0x1e01,
  INCR: 0x1e02,
  DECR: 0x1e03,
  INVERT: 0x150a,
  INCR_WRAP: 0x8507,
  DECR_WRAP: 0x8508,
  /* DataType / PixelType */
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140b,
  UNSIGNED_SHORT_4_4_4_4: 0x8033,
  UNSIGNED_SHORT_5_5_5_1: 0x8034,
  UNSIGNED_SHORT_5_6_5: 0x8363,
  /* Pixel formats / internal formats */
  DEPTH_COMPONENT: 0x1902,
  ALPHA: 0x1906,
  RGB: 0x1907,
  RGBA: 0x1908,
  LUMINANCE: 0x1909,
  LUMINANCE_ALPHA: 0x190a,
  RGB565: 0x8d62,
  RGBA4: 0x8056,
  RGB5_A1: 0x8057,
  RGBA8: 0x8058,
  DEPTH_COMPONENT16: 0x81a5,
  STENCIL_INDEX8: 0x8d48,
  DEPTH_STENCIL: 0x84f9,
  /* Texture */
  TEXTURE: 0x1702,
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_BINDING_2D: 0x8069,
  TEXTURE_BINDING_CUBE_MAP: 0x8514,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  /* 3D / array textures — three.js's WebGLState creates empty ones at
   * renderer init, so these constants must exist or the empty-texture
   * factory compares undefined === undefined and walks into texImage3D
   * with the wrong target (spec 023 iOS bring-up) */
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE_BINDING_3D: 0x806a,
  TEXTURE_BINDING_2D_ARRAY: 0x8c1d,
  TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
  TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517,
  TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
  TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519,
  TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  MIRRORED_REPEAT: 0x8370,
  GENERATE_MIPMAP_HINT: 0x8192,
  /* pixelStorei's WebGL-specific pnames */
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  /* HintMode */
  DONT_CARE: 0x1100,
  FASTEST: 0x1101,
  NICEST: 0x1102,
  /* Framebuffer */
  FRAMEBUFFER: 0x8d40,
  RENDERBUFFER: 0x8d41,
  FRAMEBUFFER_BINDING: 0x8ca6,
  RENDERBUFFER_BINDING: 0x8ca7,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_ATTACHMENT: 0x8d00,
  STENCIL_ATTACHMENT: 0x8d20,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8cd6,
  FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8cd7,
  FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8cd9,
  FRAMEBUFFER_UNSUPPORTED: 0x8cdd,
  /* Vertex arrays */
  VERTEX_ATTRIB_ARRAY_ENABLED: 0x8622,
  VERTEX_ATTRIB_ARRAY_SIZE: 0x8623,
  VERTEX_ATTRIB_ARRAY_STRIDE: 0x8624,
  VERTEX_ATTRIB_ARRAY_TYPE: 0x8625,
  VERTEX_ATTRIB_ARRAY_NORMALIZED: 0x886a,
  VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 0x889f,
  VERTEX_ARRAY_BINDING: 0x85b5,
  CURRENT_PROGRAM: 0x8b8d,
  /* Shaders */
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VALIDATE_STATUS: 0x8b83,
  SHADER_TYPE: 0x8b4f,
  DELETE_STATUS: 0x8b80,
  ATTACHED_SHADERS: 0x8b85,
  ACTIVE_UNIFORMS: 0x8b86,
  ACTIVE_ATTRIBUTES: 0x8b89,
  /* Shader precision */
  HIGH_FLOAT: 0x8df2,
  MEDIUM_FLOAT: 0x8df1,
  LOW_FLOAT: 0x8df0,
  HIGH_INT: 0x8df5,
  MEDIUM_INT: 0x8df4,
  LOW_INT: 0x8df3,

  // -- WebGL 2 (and the WebGL 1 names the table above still missed) -------
  //
  // A constant the page reads but this table does not carry is `undefined`,
  // and `undefined` encodes as 0 on the wire — so a missing name is not a
  // TypeError, it is a GL call with a garbage enum that the driver rejects
  // and the page never hears about. That is how three.js rendered nothing on
  // both Flutter ends for a whole spec: `gl.RGBA32F` was absent, so the
  // skinning bone texture was allocated as texStorage2D(..., 0, ...), the
  // upload failed, every bone matrix stayed zero and every skinned vertex
  // collapsed to the origin (spec 023 Android round 3). `gl.TEXTURE0` and
  // `gl.UNPACK_ALIGNMENT` were missing the same way.
  //
  // So the rule is: this table is the DOM's table, whole. Values below are
  // generated from flutter_angle's IDL amalgamation (lib/shared/webgl.dart)
  // and cross-checked against the entries above — which is how the RGBA4
  // typo (0x805f, actually RGB10_A2) was found.
  /* Texture units. `gl.TEXTURE0 + slot` is how every renderer addresses a
   * unit; without TEXTURE0 the sum is NaN and every bind lands on unit 0. */
  TEXTURE0: 0x84c0,
  TEXTURE1: 0x84c1,
  TEXTURE2: 0x84c2,
  TEXTURE3: 0x84c3,
  TEXTURE4: 0x84c4,
  TEXTURE5: 0x84c5,
  TEXTURE6: 0x84c6,
  TEXTURE7: 0x84c7,
  TEXTURE8: 0x84c8,
  TEXTURE9: 0x84c9,
  TEXTURE10: 0x84ca,
  TEXTURE11: 0x84cb,
  TEXTURE12: 0x84cc,
  TEXTURE13: 0x84cd,
  TEXTURE14: 0x84ce,
  TEXTURE15: 0x84cf,
  TEXTURE16: 0x84d0,
  TEXTURE17: 0x84d1,
  TEXTURE18: 0x84d2,
  TEXTURE19: 0x84d3,
  TEXTURE20: 0x84d4,
  TEXTURE21: 0x84d5,
  TEXTURE22: 0x84d6,
  TEXTURE23: 0x84d7,
  TEXTURE24: 0x84d8,
  TEXTURE25: 0x84d9,
  TEXTURE26: 0x84da,
  TEXTURE27: 0x84db,
  TEXTURE28: 0x84dc,
  TEXTURE29: 0x84dd,
  TEXTURE30: 0x84de,
  TEXTURE31: 0x84df,
  /* Pixel store (WebGL2 adds the row/skip family; UNPACK_ALIGNMENT was
   * missing outright, which made three.js's every upload INVALID_ENUM). */
  PACK_ALIGNMENT: 0xd05,
  PACK_ROW_LENGTH: 0xd02,
  PACK_SKIP_PIXELS: 0xd04,
  PACK_SKIP_ROWS: 0xd03,
  UNPACK_ALIGNMENT: 0xcf5,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  UNPACK_IMAGE_HEIGHT: 0x806e,
  UNPACK_ROW_LENGTH: 0xcf2,
  UNPACK_SKIP_IMAGES: 0x806d,
  UNPACK_SKIP_PIXELS: 0xcf4,
  UNPACK_SKIP_ROWS: 0xcf3,
  /* Sized internal formats. glTF/PBR pipelines pick one per texture —
   * RGBA32F is what three.js asks for the skinning bone texture. */
  DEPTH24_STENCIL8: 0x88f0,
  DEPTH32F_STENCIL8: 0x8cad,
  DEPTH_COMPONENT24: 0x81a6,
  DEPTH_COMPONENT32F: 0x8cac,
  R8: 0x8229,
  R8I: 0x8231,
  R8UI: 0x8232,
  R8_SNORM: 0x8f94,
  R11F_G11F_B10F: 0x8c3a,
  R16F: 0x822d,
  R16I: 0x8233,
  R16UI: 0x8234,
  R32F: 0x822e,
  R32I: 0x8235,
  R32UI: 0x8236,
  RG8: 0x822b,
  RG8I: 0x8237,
  RG8UI: 0x8238,
  RG8_SNORM: 0x8f95,
  RG16F: 0x822f,
  RG16I: 0x8239,
  RG16UI: 0x823a,
  RG32F: 0x8230,
  RG32I: 0x823b,
  RG32UI: 0x823c,
  RGB8: 0x8051,
  RGB8I: 0x8d8f,
  RGB8UI: 0x8d7d,
  RGB8_SNORM: 0x8f96,
  RGB9_E5: 0x8c3d,
  RGB10_A2: 0x8059,
  RGB10_A2UI: 0x906f,
  RGB16F: 0x881b,
  RGB16I: 0x8d89,
  RGB16UI: 0x8d77,
  RGB32F: 0x8815,
  RGB32I: 0x8d83,
  RGB32UI: 0x8d71,
  RGBA8I: 0x8d8e,
  RGBA8UI: 0x8d7c,
  RGBA8_SNORM: 0x8f97,
  RGBA16F: 0x881a,
  RGBA16I: 0x8d88,
  RGBA16UI: 0x8d76,
  RGBA32F: 0x8814,
  RGBA32I: 0x8d82,
  RGBA32UI: 0x8d70,
  SRGB8: 0x8c41,
  SRGB8_ALPHA8: 0x8c43,
  /* Unsized formats and pixel types. */
  BYTE: 0x1400,
  COLOR: 0x1800,
  COMPRESSED_TEXTURE_FORMATS: 0x86a3,
  DEPTH: 0x1801,
  FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8dad,
  INT: 0x1404,
  INT_2_10_10_10_REV: 0x8d9f,
  INVALID_INDEX: 0xffffffff,
  NONE: 0x0,
  RED: 0x1903,
  RED_INTEGER: 0x8d94,
  RG: 0x8227,
  RGBA_INTEGER: 0x8d99,
  RGB_INTEGER: 0x8d98,
  RG_INTEGER: 0x8228,
  SHORT: 0x1402,
  SIGNED_NORMALIZED: 0x8f9c,
  SRGB: 0x8c40,
  STENCIL: 0x1802,
  UNSIGNED_INT_2_10_10_10_REV: 0x8368,
  UNSIGNED_INT_5_9_9_9_REV: 0x8c3e,
  UNSIGNED_INT_10F_11F_11F_REV: 0x8c3b,
  UNSIGNED_INT_24_8: 0x84fa,
  UNSIGNED_NORMALIZED: 0x8c17,
  /* GLSL types, as reported by getActiveUniform/getActiveAttrib. */
  BOOL: 0x8b56,
  BOOL_VEC2: 0x8b57,
  BOOL_VEC3: 0x8b58,
  BOOL_VEC4: 0x8b59,
  FLOAT_MAT2: 0x8b5a,
  FLOAT_MAT3: 0x8b5b,
  FLOAT_MAT4: 0x8b5c,
  FLOAT_VEC2: 0x8b50,
  FLOAT_VEC3: 0x8b51,
  FLOAT_VEC4: 0x8b52,
  INT_SAMPLER_2D: 0x8dca,
  INT_SAMPLER_2D_ARRAY: 0x8dcf,
  INT_SAMPLER_3D: 0x8dcb,
  INT_SAMPLER_CUBE: 0x8dcc,
  INT_VEC2: 0x8b53,
  INT_VEC3: 0x8b54,
  INT_VEC4: 0x8b55,
  SAMPLER_2D: 0x8b5e,
  SAMPLER_2D_ARRAY: 0x8dc1,
  SAMPLER_2D_ARRAY_SHADOW: 0x8dc4,
  SAMPLER_2D_SHADOW: 0x8b62,
  SAMPLER_3D: 0x8b5f,
  SAMPLER_BINDING: 0x8919,
  SAMPLER_CUBE: 0x8b60,
  SAMPLER_CUBE_SHADOW: 0x8dc5,
  UNSIGNED_INT_SAMPLER_2D: 0x8dd2,
  UNSIGNED_INT_SAMPLER_2D_ARRAY: 0x8dd7,
  UNSIGNED_INT_SAMPLER_3D: 0x8dd3,
  UNSIGNED_INT_SAMPLER_CUBE: 0x8dd4,
  UNSIGNED_INT_VEC2: 0x8dc6,
  UNSIGNED_INT_VEC3: 0x8dc7,
  UNSIGNED_INT_VEC4: 0x8dc8,
  /* Texture parameters WebGL2 adds (LOD clamping, depth compare, 3D wrap). */
  TEXTURE_BASE_LEVEL: 0x813c,
  TEXTURE_COMPARE_FUNC: 0x884d,
  TEXTURE_COMPARE_MODE: 0x884c,
  TEXTURE_IMMUTABLE_FORMAT: 0x912f,
  TEXTURE_IMMUTABLE_LEVELS: 0x82df,
  TEXTURE_MAX_LEVEL: 0x813d,
  TEXTURE_MAX_LOD: 0x813b,
  TEXTURE_MIN_LOD: 0x813a,
  TEXTURE_WRAP_R: 0x8072,
  /* Framebuffers: read/draw split, multiple color attachments, and the
   * attachment/renderbuffer query pnames. */
  COLOR_ATTACHMENT1: 0x8ce1,
  COLOR_ATTACHMENT2: 0x8ce2,
  COLOR_ATTACHMENT3: 0x8ce3,
  COLOR_ATTACHMENT4: 0x8ce4,
  COLOR_ATTACHMENT5: 0x8ce5,
  COLOR_ATTACHMENT6: 0x8ce6,
  COLOR_ATTACHMENT7: 0x8ce7,
  COLOR_ATTACHMENT8: 0x8ce8,
  COLOR_ATTACHMENT9: 0x8ce9,
  COLOR_ATTACHMENT10: 0x8cea,
  COLOR_ATTACHMENT11: 0x8ceb,
  COLOR_ATTACHMENT12: 0x8cec,
  COLOR_ATTACHMENT13: 0x8ced,
  COLOR_ATTACHMENT14: 0x8cee,
  COLOR_ATTACHMENT15: 0x8cef,
  DRAW_BUFFER0: 0x8825,
  DRAW_BUFFER1: 0x8826,
  DRAW_BUFFER2: 0x8827,
  DRAW_BUFFER3: 0x8828,
  DRAW_BUFFER4: 0x8829,
  DRAW_BUFFER5: 0x882a,
  DRAW_BUFFER6: 0x882b,
  DRAW_BUFFER7: 0x882c,
  DRAW_BUFFER8: 0x882d,
  DRAW_BUFFER9: 0x882e,
  DRAW_BUFFER10: 0x882f,
  DRAW_BUFFER11: 0x8830,
  DRAW_BUFFER12: 0x8831,
  DRAW_BUFFER13: 0x8832,
  DRAW_BUFFER14: 0x8833,
  DRAW_BUFFER15: 0x8834,
  DRAW_FRAMEBUFFER: 0x8ca9,
  DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
  FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE: 0x8215,
  FRAMEBUFFER_ATTACHMENT_BLUE_SIZE: 0x8214,
  FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING: 0x8210,
  FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE: 0x8211,
  FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE: 0x8216,
  FRAMEBUFFER_ATTACHMENT_GREEN_SIZE: 0x8213,
  FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 0x8cd1,
  FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8cd0,
  FRAMEBUFFER_ATTACHMENT_RED_SIZE: 0x8212,
  FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE: 0x8217,
  FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: 0x8cd3,
  FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER: 0x8cd4,
  FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL: 0x8cd2,
  FRAMEBUFFER_DEFAULT: 0x8218,
  FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: 0x8d56,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  MAX_DRAW_BUFFERS: 0x8824,
  MAX_SAMPLES: 0x8d57,
  READ_BUFFER: 0xc02,
  READ_FRAMEBUFFER: 0x8ca8,
  READ_FRAMEBUFFER_BINDING: 0x8caa,
  RENDERBUFFER_ALPHA_SIZE: 0x8d53,
  RENDERBUFFER_BLUE_SIZE: 0x8d52,
  RENDERBUFFER_DEPTH_SIZE: 0x8d54,
  RENDERBUFFER_GREEN_SIZE: 0x8d51,
  RENDERBUFFER_HEIGHT: 0x8d43,
  RENDERBUFFER_INTERNAL_FORMAT: 0x8d44,
  RENDERBUFFER_RED_SIZE: 0x8d50,
  RENDERBUFFER_SAMPLES: 0x8cab,
  RENDERBUFFER_STENCIL_SIZE: 0x8d55,
  RENDERBUFFER_WIDTH: 0x8d42,
  /* Buffer targets and usages WebGL2 adds. */
  COPY_READ_BUFFER: 0x8f36,
  COPY_READ_BUFFER_BINDING: 0x8f36,
  COPY_WRITE_BUFFER: 0x8f37,
  COPY_WRITE_BUFFER_BINDING: 0x8f37,
  DYNAMIC_COPY: 0x88ea,
  DYNAMIC_READ: 0x88e9,
  PIXEL_PACK_BUFFER: 0x88eb,
  PIXEL_PACK_BUFFER_BINDING: 0x88ed,
  PIXEL_UNPACK_BUFFER: 0x88ec,
  PIXEL_UNPACK_BUFFER_BINDING: 0x88ef,
  STATIC_COPY: 0x88e6,
  STATIC_READ: 0x88e5,
  STREAM_COPY: 0x88e2,
  STREAM_READ: 0x88e1,
  /* Uniform blocks (UBO). */
  ACTIVE_UNIFORM_BLOCKS: 0x8a36,
  UNIFORM_ARRAY_STRIDE: 0x8a3c,
  UNIFORM_BLOCK_ACTIVE_UNIFORMS: 0x8a42,
  UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 0x8a43,
  UNIFORM_BLOCK_BINDING: 0x8a3f,
  UNIFORM_BLOCK_DATA_SIZE: 0x8a40,
  UNIFORM_BLOCK_INDEX: 0x8a3a,
  UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 0x8a46,
  UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 0x8a44,
  UNIFORM_BUFFER: 0x8a11,
  UNIFORM_BUFFER_BINDING: 0x8a28,
  UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8a34,
  UNIFORM_BUFFER_SIZE: 0x8a2a,
  UNIFORM_BUFFER_START: 0x8a29,
  UNIFORM_IS_ROW_MAJOR: 0x8a3e,
  UNIFORM_MATRIX_STRIDE: 0x8a3d,
  UNIFORM_OFFSET: 0x8a3b,
  UNIFORM_SIZE: 0x8a38,
  UNIFORM_TYPE: 0x8a37,
  /* Transform feedback. */
  INTERLEAVED_ATTRIBS: 0x8c8c,
  RASTERIZER_DISCARD: 0x8c89,
  SEPARATE_ATTRIBS: 0x8c8d,
  TRANSFORM_FEEDBACK: 0x8e22,
  TRANSFORM_FEEDBACK_ACTIVE: 0x8e24,
  TRANSFORM_FEEDBACK_BINDING: 0x8e25,
  TRANSFORM_FEEDBACK_BUFFER: 0x8c8e,
  TRANSFORM_FEEDBACK_BUFFER_BINDING: 0x8c8f,
  TRANSFORM_FEEDBACK_BUFFER_MODE: 0x8c7f,
  TRANSFORM_FEEDBACK_BUFFER_SIZE: 0x8c85,
  TRANSFORM_FEEDBACK_BUFFER_START: 0x8c84,
  TRANSFORM_FEEDBACK_PAUSED: 0x8e23,
  TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN: 0x8c88,
  TRANSFORM_FEEDBACK_VARYINGS: 0x8c83,
  /* Query objects and fences. */
  ALREADY_SIGNALED: 0x911a,
  ANY_SAMPLES_PASSED: 0x8c2f,
  ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8d6a,
  CONDITION_SATISFIED: 0x911c,
  CURRENT_QUERY: 0x8865,
  OBJECT_TYPE: 0x9112,
  QUERY_RESULT: 0x8866,
  QUERY_RESULT_AVAILABLE: 0x8867,
  SIGNALED: 0x9119,
  SYNC_CONDITION: 0x9113,
  SYNC_FENCE: 0x9116,
  SYNC_FLAGS: 0x9115,
  SYNC_FLUSH_COMMANDS_BIT: 0x1,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  SYNC_STATUS: 0x9114,
  TIMEOUT_EXPIRED: 0x911b,
  UNSIGNALED: 0x9118,
  WAIT_FAILED: 0x911d,
  /* Implementation limits three.js and friends read at startup. */
  MAX_3D_TEXTURE_SIZE: 0x8073,
  MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
  MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS: 0x8a33,
  MAX_COMBINED_UNIFORM_BLOCKS: 0x8a2e,
  MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS: 0x8a31,
  MAX_ELEMENTS_INDICES: 0x80e9,
  MAX_ELEMENTS_VERTICES: 0x80e8,
  MAX_ELEMENT_INDEX: 0x8d6b,
  MAX_FRAGMENT_INPUT_COMPONENTS: 0x9125,
  MAX_FRAGMENT_UNIFORM_BLOCKS: 0x8a2d,
  MAX_FRAGMENT_UNIFORM_COMPONENTS: 0x8b49,
  MAX_PROGRAM_TEXEL_OFFSET: 0x8905,
  MAX_SERVER_WAIT_TIMEOUT: 0x9111,
  MAX_TEXTURE_LOD_BIAS: 0x84fd,
  MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS: 0x8c8a,
  MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS: 0x8c8b,
  MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS: 0x8c80,
  MAX_UNIFORM_BLOCK_SIZE: 0x8a30,
  MAX_UNIFORM_BUFFER_BINDINGS: 0x8a2f,
  MAX_VARYING_COMPONENTS: 0x8b4b,
  MAX_VERTEX_OUTPUT_COMPONENTS: 0x9122,
  MAX_VERTEX_UNIFORM_BLOCKS: 0x8a2b,
  MAX_VERTEX_UNIFORM_COMPONENTS: 0x8b4a,
  MIN_PROGRAM_TEXEL_OFFSET: 0x8904,
  /* Everything else in the WebGL2 IDL. */
  BROWSER_DEFAULT_WEBGL: 0x9244,
  COMPARE_REF_TO_TEXTURE: 0x884e,
  FRAGMENT_SHADER_DERIVATIVE_HINT: 0x8b8b,
  MAX: 0x8008,
  MIN: 0x8007,
  VERTEX_ATTRIB_ARRAY_DIVISOR: 0x88fe,
  VERTEX_ATTRIB_ARRAY_INTEGER: 0x88fd,
  VERTEX_ATTRIB_ARRAY_POINTER: 0x8645,
} as const;

/** Accepts a TypedArray, a number[] or null for the fv / matrix / pixel
 * arguments. */
type NumericArg =
  | number[]
  | Float32Array
  | Int32Array
  | Uint8Array
  | Uint32Array
  // toBytes / toArray already handle every integer view; the type only
  // lagged. Uint16Array is THE index-buffer type in WebGL, and pages hit a
  // type error uploading one (found writing spec 033's instancing example).
  | Uint16Array
  | Int16Array
  | Int8Array
  | Uint8ClampedArray
  | null;

function toArray(v: NumericArg): number[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Array.from(v as ArrayLike<number>);
}

function toBytes(v: NumericArg): Uint8Array {
  if (!v) return new Uint8Array(0);
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  const out = new Uint8Array(v.length * 4);
  new Float32Array(out.buffer).set(v as number[]);
  return out;
}

/** Truncates a uniform array to a whole number of the call's vector size —
 * a ragged tail is INVALID_OPERATION in GL, and the decoder slices by the
 * command's implied arity, so sending the tail would corrupt the stream. */
function evenCount(v: number[], per: number, what: string): number[] {
  const usable = v.length - (v.length % per);
  if (usable !== v.length) {
    warnWebglOnce(
      `webgl-${what}`,
      `gl.${what}(): array length ${v.length} is not a multiple of ${per}; ` +
        'the tail was dropped (GL would raise INVALID_OPERATION).',
    );
  }
  return v.length === usable ? v : v.slice(0, usable);
}

export class FjsWebGLRenderingContext {
  /** Opaque id the host knows this context by (query dispatch key). */
  readonly ctxId: number;

  /** The DOM's `gl.canvas`. Assigned in the constructor; declared here so
   * pages get real types off it. */
  declare readonly canvas: { readonly width: number; readonly height: number };

  private readonly surface: WebglSurface;
  private readonly writer: WebglChunkWriter;
  private nextResourceId = 1;
  /** Attribute slots this side chose for a program because the host had no
   * GL context to ask yet — see getAttribLocation. Keyed by program id. */
  private readonly promisedAttribs = new Map<number, Map<string, number>>();

  constructor(surface: WebglSurface, ctxId: number) {
    this.surface = surface;
    this.ctxId = ctxId;
    // The DOM's `gl.canvas`: the drawing buffer's size in DEVICE pixels,
    // unlike the 2d context's logical-pixel view (spec 021 §3.2).
    Object.defineProperty(this, 'canvas', {
      value: {
        get width(): number {
          return Math.round(surface.width() * surface.devicePixelRatio());
        },
        get height(): number {
          return Math.round(surface.height() * surface.devicePixelRatio());
        },
      },
      writable: false,
      enumerable: true,
      configurable: true,
    });
    // The module owns the command buffer; the core surface only carries it
    // through the frame as op 11.
    const writer = new WebglChunkWriter(() => surface.markDirty());
    this.writer = writer;
    surface.attachOpWriter({
      takeChunks: () => writer.takeChunks(),
      write: (nodeId: number, chunk: Uint8Array) => {
        getWriter().webgl(nodeId, chunk);
      },
    });
  }

  private nextId(): number {
    return this.nextResourceId++;
  }

  /** Synchronous query over the v1 ABI: scalars and strings only. */
  private q<T>(name: string, ...args: FjsHostValue[]): T {
    // Push this canvas's queued GL commands out NOW instead of at the
    // microtask flush: a page checks compile/link status in the same tick it
    // compiled (every WebGL page does), and the host can only answer from
    // state the stream has already delivered.
    flushNow();
    return invokeHost<T>(`fjs.webgl.${name}`, this.ctxId, ...args);
  }

  // -- resources -----------------------------------------------------------

  createBuffer(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLBuffer', this.nextId());
    this.writer.createBuffer(res.id);
    return res;
  }

  deleteBuffer(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteBuffer(id);
  }

  createFramebuffer(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLFramebuffer', this.nextId());
    this.writer.createFramebuffer(res.id);
    return res;
  }

  deleteFramebuffer(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteFramebuffer(id);
  }

  createProgram(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLProgram', this.nextId());
    this.writer.createProgram(res.id);
    return res;
  }

  deleteProgram(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteProgram(id);
  }

  createRenderbuffer(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLRenderbuffer', this.nextId());
    this.writer.createRenderbuffer(res.id);
    return res;
  }

  deleteRenderbuffer(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteRenderbuffer(id);
  }

  createTexture(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLTexture', this.nextId());
    this.writer.createTexture(res.id);
    return res;
  }

  deleteTexture(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteTexture(id);
  }

  createVertexArray(): FjsWebGLObject {
    const res = new FjsWebGLObject('WebGLVertexArrayObject', this.nextId());
    this.writer.createVertexArray(res.id);
    return res;
  }

  bindVertexArray(res: Resource): void {
    this.writer.bindVertexArray(resourceId(res));
  }

  deleteVertexArray(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteVertexArray(id);
  }

  createShader(type: number): FjsWebGLObject | null {
    if (type !== GL.VERTEX_SHADER && type !== GL.FRAGMENT_SHADER) {
      warnWebglOnce(
        'webgl-shader-type',
        'gl.createShader(): type must be VERTEX_SHADER or FRAGMENT_SHADER.',
      );
      return null;
    }
    const res = new FjsWebGLObject(
      type === GL.VERTEX_SHADER ? 'WebGLVertexShader' : 'WebGLFragmentShader',
      this.nextId(),
    );
    this.writer.createShader(res.id, type);
    return res;
  }

  deleteShader(res: Resource): void {
    const id = resourceId(res);
    if (id) this.writer.deleteShader(id);
  }

  // -- binding & state -----------------------------------------------------

  activeTexture(unit: number): void {
    this.writer.activeTexture(unit);
  }

  bindBuffer(target: number, res: Resource): void {
    this.writer.bindBuffer(target, resourceId(res));
  }

  bindFramebuffer(target: number, res: Resource): void {
    this.writer.bindFramebuffer(target, resourceId(res));
  }

  bindRenderbuffer(target: number, res: Resource): void {
    this.writer.bindRenderbuffer(target, resourceId(res));
  }

  bindTexture(target: number, res: Resource): void {
    this.writer.bindTexture(target, resourceId(res));
  }

  blendColor(r: number, g: number, b: number, a: number): void {
    this.writer.blendColor(r, g, b, a);
  }

  blendEquation(mode: number): void {
    this.writer.blendEquation(mode);
  }

  blendEquationSeparate(modeRgb: number, modeAlpha: number): void {
    this.writer.blendEquationSeparate(modeRgb, modeAlpha);
  }

  blendFunc(sfactor: number, dfactor: number): void {
    this.writer.blendFunc(sfactor, dfactor);
  }

  blendFuncSeparate(
    srcRgb: number,
    dstRgb: number,
    srcAlpha: number,
    dstAlpha: number,
  ): void {
    this.writer.blendFuncSeparate(srcRgb, dstRgb, srcAlpha, dstAlpha);
  }

  clearColor(r: number, g: number, b: number, a: number): void {
    this.writer.clearColor(r, g, b, a);
  }

  clearDepth(depth: number): void {
    this.writer.clearDepth(depth);
  }

  clearStencil(s: number): void {
    this.writer.clearStencil(s);
  }

  colorMask(r: boolean, g: boolean, b: boolean, a: boolean): void {
    this.writer.colorMask(r, g, b, a);
  }

  cullFace(mode: number): void {
    this.writer.cullFace(mode);
  }

  depthFunc(func: number): void {
    this.writer.depthFunc(func);
  }

  depthMask(flag: boolean): void {
    this.writer.depthMask(flag);
  }

  depthRange(zNear: number, zFar: number): void {
    this.writer.depthRange(zNear, zFar);
  }

  disable(cap: number): void {
    this.writer.disable(cap);
  }

  enable(cap: number): void {
    this.writer.enable(cap);
  }

  frontFace(mode: number): void {
    this.writer.frontFace(mode);
  }

  hint(target: number, mode: number): void {
    this.writer.hint(target, mode);
  }

  lineWidth(width: number): void {
    this.writer.lineWidth(width);
  }

  // The one exception to "no state machine": UNPACK_FLIP_Y_WEBGL. three.js
  // sets it before every image-texture upload and the Dart decoder has no
  // state to remember it, so the value rides along on TexImage2DSource (see
  // protocol.ts) and the host flips the cached RGBA rows when it is set.
  private unpackFlipY = false;

  pixelStorei(pname: number, param: number): void {
    if (pname === GL.UNPACK_FLIP_Y_WEBGL) this.unpackFlipY = param !== 0;
    this.writer.pixelStorei(pname, param);
  }

  polygonOffset(factor: number, units: number): void {
    this.writer.polygonOffset(factor, units);
  }

  sampleCoverage(value: number, invert: boolean): void {
    this.writer.sampleCoverage(value, invert);
  }

  scissor(x: number, y: number, width: number, height: number): void {
    this.writer.scissor(x, y, width, height);
  }

  stencilFunc(func: number, ref: number, mask: number): void {
    this.writer.stencilFunc(func, ref, mask);
  }

  stencilFuncSeparate(
    face: number,
    func: number,
    ref: number,
    mask: number,
  ): void {
    this.writer.stencilFuncSeparate(face, func, ref, mask);
  }

  stencilMask(mask: number): void {
    this.writer.stencilMask(mask);
  }

  stencilMaskSeparate(face: number, mask: number): void {
    this.writer.stencilMaskSeparate(face, mask);
  }

  stencilOp(fail: number, zfail: number, zpass: number): void {
    this.writer.stencilOp(fail, zfail, zpass);
  }

  stencilOpSeparate(
    face: number,
    fail: number,
    zfail: number,
    zpass: number,
  ): void {
    this.writer.stencilOpSeparate(face, fail, zfail, zpass);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.writer.viewport(x, y, width, height);
  }

  // -- data upload ---------------------------------------------------------

  bufferData(
    target: number,
    data: NumericArg | number,
    usage?: number,
  ): void {
    if (typeof data === 'number') {
      this.writer.bufferDataSize(target, data, usage ?? GL.STATIC_DRAW);
      return;
    }
    this.writer.bufferData(target, toBytes(data), usage ?? GL.STATIC_DRAW);
  }

  bufferSubData(target: number, offset: number, data: NumericArg): void {
    this.writer.bufferSubData(target, offset, toBytes(data));
  }

  /** The DOM's 6-arg source form and 9-arg pixel form, told apart by arity.
   * The only source this runtime supports is `FjsCanvasImage` (handle across
   * the bridge, pixels stay on the host) — an HTMLImageElement cannot exist
   * here. */
  texImage2D(...args: unknown[]): void {
    if (args.length === 6) {
      const [target, level, internalformat, format, type, source] = args as [
        number,
        number,
        number,
        number,
        number,
        unknown,
      ];
      if (source instanceof FjsCanvasImage) {
        this.writer.texImage2DSource(
          target,
          level,
          internalformat,
          format,
          type,
          source.handle,
          this.unpackFlipY,
        );
        return;
      }
      warnWebglOnce(
        'webgl-tex-source',
        'gl.texImage2D(): the only supported source is the image object ' +
          'returned by loadImage()/FjsCanvasImage.',
      );
      return;
    }
    const [target, level, internalformat, width, height, border, format, type, pixels] =
      args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        NumericArg,
      ];
    this.writer.texImage2D(
      target,
      level,
      internalformat,
      width,
      height,
      border,
      format,
      type,
      toBytes(pixels),
    );
  }

  texSubImage2D(...args: unknown[]): void {
    // 7 args: the DOM's source form (target, level, x, y, format, type,
    // image) — one more pair than texImage2D's 6-arg source form because a
    // sub-image needs its offset. 9 args: the pixel form.
    if (args.length === 7) {
      const [target, level, xoffset, yoffset, format, type, source] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        unknown,
      ];
      if (source instanceof FjsCanvasImage) {
        this.writer.texSubImage2DSource(
          target,
          level,
          xoffset,
          yoffset,
          format,
          type,
          source.handle,
          this.unpackFlipY,
        );
        return;
      }
      warnWebglOnce(
        'webgl-tex-sub-source',
        'gl.texSubImage2D(): the only supported source is the image object ' +
          'returned by loadImage()/FjsCanvasImage.',
      );
      return;
    }
    const [target, level, xoffset, yoffset, width, height, format, type, pixels] =
      args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        NumericArg,
      ];
    this.writer.texSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      type,
      toBytes(pixels),
    );
  }

  texStorage2D(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.writer.texStorage2D(target, levels, internalformat, width, height);
  }

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
    pixels?: NumericArg,
  ): void {
    // no source-object form: a 3D/array texture's depth has no DOM image
    // analogue, so pixels-only is the whole API here
    this.writer.texImage3D(
      target,
      level,
      internalformat,
      width,
      height,
      depth,
      border,
      format,
      type,
      toBytes(pixels ?? new Uint8Array(0)),
    );
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
    pixels?: NumericArg,
  ): void {
    this.writer.texSubImage3D(
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      width,
      height,
      depth,
      format,
      type,
      toBytes(pixels ?? new Uint8Array(0)),
    );
  }

  texParameterf(target: number, pname: number, param: number): void {
    this.writer.texParameterf(target, pname, param);
  }

  texParameteri(target: number, pname: number, param: number): void {
    this.writer.texParameteri(target, pname, param);
  }

  generateMipmap(target: number): void {
    this.writer.generateMipmap(target);
  }

  // -- program -------------------------------------------------------------

  shaderSource(shader: Resource, source: string): void {
    const id = resourceId(shader);
    if (!id) return;
    this.writer.shaderSource(id, this.writer.str(source));
  }

  compileShader(shader: Resource): void {
    const id = resourceId(shader);
    if (id) this.writer.compileShader(id);
  }

  attachShader(program: Resource, shader: Resource): void {
    const p = resourceId(program);
    const s = resourceId(shader);
    if (p && s) this.writer.attachShader(p, s);
  }

  detachShader(program: Resource, shader: Resource): void {
    const p = resourceId(program);
    const s = resourceId(shader);
    if (p && s) this.writer.detachShader(p, s);
  }

  linkProgram(program: Resource): void {
    const id = resourceId(program);
    if (id) this.writer.linkProgram(id);
  }

  useProgram(program: Resource): void {
    this.writer.useProgram(resourceId(program));
  }

  validateProgram(program: Resource): void {
    const id = resourceId(program);
    if (id) this.writer.validateProgram(id);
  }

  bindAttribLocation(program: Resource, index: number, name: string): void {
    const id = resourceId(program);
    if (id) this.writer.bindAttribLocation(id, index, this.writer.str(name));
  }

  // -- vertex --------------------------------------------------------------

  enableVertexAttribArray(index: number): void {
    this.writer.enableVertexAttribArray(index);
  }

  disableVertexAttribArray(index: number): void {
    this.writer.disableVertexAttribArray(index);
  }

  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.writer.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }

  vertexAttribDivisor(index: number, divisor: number): void {
    this.writer.vertexAttribDivisor(index, divisor);
  }

  vertexAttrib1f(index: number, x: number): void {
    this.writer.vertexAttrib1f(index, x);
  }

  vertexAttrib2f(index: number, x: number, y: number): void {
    this.writer.vertexAttrib2f(index, x, y);
  }

  vertexAttrib3f(index: number, x: number, y: number, z: number): void {
    this.writer.vertexAttrib3f(index, x, y, z);
  }

  vertexAttrib4f(index: number, x: number, y: number, z: number, w: number): void {
    this.writer.vertexAttrib4f(index, x, y, z, w);
  }

  vertexAttrib1fv(index: number, v: NumericArg): void {
    this.writer.vertexAttrib1fv(index, toArray(v));
  }

  vertexAttrib2fv(index: number, v: NumericArg): void {
    this.writer.vertexAttrib2fv(index, evenCount(toArray(v), 2, 'vertexAttrib2fv'));
  }

  vertexAttrib3fv(index: number, v: NumericArg): void {
    this.writer.vertexAttrib3fv(index, evenCount(toArray(v), 3, 'vertexAttrib3fv'));
  }

  vertexAttrib4fv(index: number, v: NumericArg): void {
    this.writer.vertexAttrib4fv(index, evenCount(toArray(v), 4, 'vertexAttrib4fv'));
  }

  // -- uniform -------------------------------------------------------------

  uniform1i(location: Resource, x: number): void {
    this.writer.uniform1i(resourceId(location), x);
  }

  uniform2i(location: Resource, x: number, y: number): void {
    this.writer.uniform2i(resourceId(location), x, y);
  }

  uniform3i(location: Resource, x: number, y: number, z: number): void {
    this.writer.uniform3i(resourceId(location), x, y, z);
  }

  uniform4i(location: Resource, x: number, y: number, z: number, w: number): void {
    this.writer.uniform4i(resourceId(location), x, y, z, w);
  }

  uniform1f(location: Resource, x: number): void {
    this.writer.uniform1f(resourceId(location), x);
  }

  uniform2f(location: Resource, x: number, y: number): void {
    this.writer.uniform2f(resourceId(location), x, y);
  }

  uniform3f(location: Resource, x: number, y: number, z: number): void {
    this.writer.uniform3f(resourceId(location), x, y, z);
  }

  uniform4f(location: Resource, x: number, y: number, z: number, w: number): void {
    this.writer.uniform4f(resourceId(location), x, y, z, w);
  }

  uniform1iv(location: Resource, v: NumericArg): void {
    this.writer.uniform1iv(resourceId(location), toArray(v));
  }

  uniform2iv(location: Resource, v: NumericArg): void {
    this.writer.uniform2iv(resourceId(location), evenCount(toArray(v), 2, 'uniform2iv'));
  }

  uniform3iv(location: Resource, v: NumericArg): void {
    this.writer.uniform3iv(resourceId(location), evenCount(toArray(v), 3, 'uniform3iv'));
  }

  uniform4iv(location: Resource, v: NumericArg): void {
    this.writer.uniform4iv(resourceId(location), evenCount(toArray(v), 4, 'uniform4iv'));
  }

  uniform1fv(location: Resource, v: NumericArg): void {
    this.writer.uniform1fv(resourceId(location), toArray(v));
  }

  uniform2fv(location: Resource, v: NumericArg): void {
    this.writer.uniform2fv(resourceId(location), evenCount(toArray(v), 2, 'uniform2fv'));
  }

  uniform3fv(location: Resource, v: NumericArg): void {
    this.writer.uniform3fv(resourceId(location), evenCount(toArray(v), 3, 'uniform3fv'));
  }

  uniform4fv(location: Resource, v: NumericArg): void {
    this.writer.uniform4fv(resourceId(location), evenCount(toArray(v), 4, 'uniform4fv'));
  }

  uniformMatrix2fv(location: Resource, transpose: boolean, v: NumericArg): void {
    this.writer.uniformMatrix2fv(resourceId(location), transpose, toArray(v));
  }

  uniformMatrix3fv(location: Resource, transpose: boolean, v: NumericArg): void {
    this.writer.uniformMatrix3fv(resourceId(location), transpose, toArray(v));
  }

  uniformMatrix4fv(location: Resource, transpose: boolean, v: NumericArg): void {
    this.writer.uniformMatrix4fv(resourceId(location), transpose, toArray(v));
  }

  // -- draw ----------------------------------------------------------------

  clear(mask: number): void {
    this.writer.clear(mask);
  }

  drawArrays(mode: number, first: number, count: number): void {
    this.writer.drawArrays(mode, first, count);
  }

  drawElements(mode: number, count: number, type: number, offset: number): void {
    this.writer.drawElements(mode, count, type, offset);
  }

  // WebGL2 core instancing (spec 033). Before these existed the app-side
  // context simply lacked the methods, so three.js's InstancedMesh died on
  // `drawElementsInstanced is not a function` while web rendered fine.
  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void {
    this.writer.drawArraysInstanced(mode, first, count, instanceCount);
  }

  drawElementsInstanced(
    mode: number,
    count: number,
    type: number,
    offset: number,
    instanceCount: number,
  ): void {
    this.writer.drawElementsInstanced(mode, count, type, offset, instanceCount);
  }

  finish(): void {
    this.writer.finish();
  }

  flush(): void {
    this.writer.flush();
  }

  // -- framebuffer ---------------------------------------------------------

  framebufferTexture2D(
    target: number,
    attachment: number,
    textarget: number,
    texture: Resource,
    level: number,
  ): void {
    this.writer.framebufferTexture2D(
      target,
      attachment,
      textarget,
      resourceId(texture),
      level,
    );
  }

  framebufferRenderbuffer(
    target: number,
    attachment: number,
    renderbuffertarget: number,
    renderbuffer: Resource,
  ): void {
    this.writer.framebufferRenderbuffer(
      target,
      attachment,
      renderbuffertarget,
      resourceId(renderbuffer),
    );
  }

  renderbufferStorage(
    target: number,
    internalformat: number,
    width: number,
    height: number,
  ): void {
    this.writer.renderbufferStorage(target, internalformat, width, height);
  }

  checkFramebufferStatus(target: number): number {
    return this.q<number>('checkFramebufferStatus', target) ?? 0;
  }

  // -- queries (synchronous, over invokeHost) ------------------------------

  getError(): number {
    return this.q<number>('getError') ?? 0;
  }

  /** Unlike a uniform location, this number is an index into the CALLER's own
   * per-attribute arrays — three.js sizes them MAX_VERTEX_ATTRIBS and writes
   * `enabledAttributes[loc]`, so anything outside that range vanishes
   * silently and enableVertexAttribArray never fires. It therefore cannot be
   * an opaque handle, and it cannot be a placeholder either.
   *
   * The host answers for real once its GL context exists. Before that (a
   * page that compiles and links inside the canvas's first @resize, which is
   * every hand-written GL page) it cannot answer at all — so this side picks
   * the slot and then makes the choice true through bindAttribLocation, which
   * is the DOM's own way of assigning an attribute index. The relink is the
   * price, and only pages that link before the first frame pay it. */
  getAttribLocation(program: Resource, name: string): number {
    const id = resourceId(program);
    const loc = this.q<number | null>('getAttribLocation', id, name);
    if (typeof loc === 'number') return loc;
    const promised = this.promisedAttribs.get(id) ?? new Map<string, number>();
    const known = promised.get(name);
    if (known !== undefined) return known;
    const index = promised.size;
    promised.set(name, index);
    this.promisedAttribs.set(id, promised);
    this.bindAttribLocation(program, index, name);
    this.linkProgram(program);
    return index;
  }

  getUniformLocation(program: Resource, name: string): FjsWebGLObject | null {
    const id = this.q<number>('getUniformLocation', resourceId(program), name);
    return typeof id === 'number' && id > 0
      ? new FjsWebGLObject('WebGLUniformLocation', id)
      : null;
  }

  /** A scalar pname returns a number; an array pname (VIEWPORT, DEPTH_RANGE,
   * SCISSOR_BOX, COLOR_CLEAR_VALUE, …) returns number[]. The string pnames
   * are answered here, not over the ABI: flutter_angle's getParameter only
   * implements a fixed list of integer keys and throws on the rest, and
   * three.js's WebGLState calls `.indexOf` on VERSION during renderer init —
   * a null there aborts the whole page. The read-back pair is the GLES3
   * guaranteed combination (RGBA/UNSIGNED_BYTE).
   *
   * SCISSOR_BOX/VIEWPORT are also answered locally: the plugin's
   * GetIntegerv path copies 4 slots but returns only the FIRST component,
   * so the array pnames cannot cross this bridge faithfully. The initial
   * values below are the WebGL defaults; three reads them once into its
   * current-state cache and immediately overwrites them from
   * renderer.setSize/state.viewport on the first render, so only the
   * shape (4 numbers) matters, not the values. */
  getParameter(pname: number): number | number[] | boolean | string | null {
    switch (pname) {
      case GL.VERSION:
        return 'WebGL 2.0 (fjs)';
      case GL.SHADING_LANGUAGE_VERSION:
        return 'WebGL GLSL ES 3.00 (fjs)';
      case GL.RENDERER:
      case GL.VENDOR:
        return 'fjs (ANGLE)';
      case GL.IMPLEMENTATION_COLOR_READ_TYPE:
        return GL.UNSIGNED_BYTE;
      case GL.IMPLEMENTATION_COLOR_READ_FORMAT:
        return GL.RGBA;
      case GL.SCISSOR_BOX:
        return [0, 0, 0, 0];
      case GL.VIEWPORT:
        return [0, 0, this.canvas.width, this.canvas.height];
    }
    const result = this.q<number | number[] | boolean | string | null>(
      'getParameter',
      pname,
    );
    return this.unpackMaybeJson(result);
  }

  getContextAttributes(): Record<string, boolean> | null {
    return this.q<Record<string, boolean>>('getContextAttributes') ?? null;
  }

  /** Registered extensions only — and none are registered (spec 021 §2).
   * The host answers the JSON string "[]" (v1 ABI lists cross as JSON), so
   * it goes through the same unpack as getParameter. */
  getSupportedExtensions(): string[] {
    return this.unpackMaybeJson<string[]>(
      this.q<string | null>('getSupportedExtensions'),
    ) ?? [];
  }

  getExtension(name: string): null {
    warnWebglOnce(
      `webgl-ext-${name}`,
      `gl.getExtension("${name}") is not supported by fjs; see ` +
        'docs/canvas-compat.md. Returning null on both Flutter and web.',
    );
    return null;
  }

  getShaderParameter(shader: Resource, pname: number): number | boolean | null {
    return this.unpackMaybeJson<number | boolean | null>(
      this.q<number | boolean | string | null>(
        'getShaderParameter',
        resourceId(shader),
        pname,
      ),
    );
  }

  getProgramParameter(
    program: Resource,
    pname: number,
  ): number | boolean | null {
    return this.unpackMaybeJson<number | boolean | null>(
      this.q<number | boolean | string | null>(
        'getProgramParameter',
        resourceId(program),
        pname,
      ),
    );
  }

  /** The DOM returns a STRING from the info-log/source queries even on
   * success — an empty one, which `.trim()` callers in three.js depend on.
   * flutter_angle's null (GLES writes no log on success) becomes '' here,
   * and a failed lookup (Dart-side exception over the ABI) degrades to ''
   * too: these are diagnostics, they must never kill the render loop. */
  getShaderInfoLog(shader: Resource): string {
    try {
      return this.q<string | null>('getShaderInfoLog', resourceId(shader)) ?? '';
    } catch {
      return '';
    }
  }

  getProgramInfoLog(program: Resource): string {
    try {
      return this.q<string | null>('getProgramInfoLog', resourceId(program)) ?? '';
    } catch {
      return '';
    }
  }

  /** Answered client-side, not over the ABI: flutter_angle 0.4.2's
   * getShaderPrecisionFormat is a stub returning an all-zero
   * ShaderPrecisionFormat, and three.js turns zeros into 'lowp' shaders.
   * The real values on every ANGLE surface this module runs on (Metal,
   * Vulkan, GL, D3D — WebGL2 requires highp in both stages) are the
   * WebGL2 spec's minimum highp float/int figures; lying smaller would
   * only make three pick a worse precision, never a wrong one. */
  getShaderPrecisionFormat(
    shadertype: number,
    precisiontype: number,
  ): { rangeMin: number; rangeMax: number; precision: number } {
    if (precisiontype === GL.HIGH_INT || precisiontype === GL.MEDIUM_INT ||
        precisiontype === GL.LOW_INT) {
      // WebGL2 guarantees 31-bit mantissa integers in every stage
      return { rangeMin: 31, rangeMax: 30, precision: 0 };
    }
    return { rangeMin: 127, rangeMax: 127, precision: 23 };
  }

  /** Same DOM string semantics as the info logs (flutter_angle's
   * getShaderSource is unimplemented and answers null). */
  getShaderSource(shader: Resource): string {
    return this.q<string | null>('getShaderSource', resourceId(shader)) ?? '';
  }

  /** `{ name, size, type }` on both platforms. The Dart side answers a JSON
   * string (v1 ABI carries objects stringified) — it MUST be unpacked here:
   * three.js reads `.name` off the result, and the raw string's `.name` is
   * undefined, which used to blow up parseUniform (spec 023 iOS). */
  getActiveAttrib(program: Resource, index: number): { name: string; size: number; type: number } | null {
    return this.unpackMaybeJson<{ name: string; size: number; type: number } | null>(
      this.q<string | null>(
        'getActiveAttrib',
        resourceId(program),
        index,
      ),
    );
  }

  getActiveUniform(program: Resource, index: number): { name: string; size: number; type: number } | null {
    return this.unpackMaybeJson<{ name: string; size: number; type: number } | null>(
      this.q<string | null>(
        'getActiveUniform',
        resourceId(program),
        index,
      ),
    );
  }

  getUniform(program: Resource, location: Resource): number | number[] | null {
    return this.unpackMaybeJson<number | number[] | null>(
      this.q<number | number[] | string | null>(
        'getUniform',
        resourceId(program),
        resourceId(location),
      ),
    );
  }

  getVertexAttrib(index: number, pname: number): number | number[] | null {
    return this.unpackMaybeJson<number | number[] | null>(
      this.q<number | number[] | string | null>('getVertexAttrib', index, pname),
    );
  }

  getBufferParameter(target: number, pname: number): number | null {
    return this.q<number | null>('getBufferParameter', target, pname);
  }

  getFramebufferAttachmentParameter(
    target: number,
    attachment: number,
    pname: number,
  ): number | null {
    return this.q<number | null>(
      'getFramebufferAttachmentParameter',
      target,
      attachment,
      pname,
    );
  }

  getRenderbufferParameter(target: number, pname: number): number | null {
    return this.q<number | null>('getRenderbufferParameter', target, pname);
  }

  isBuffer(res: Resource): boolean {
    return this.q<boolean>('isBuffer', resourceId(res)) === true;
  }

  isTexture(res: Resource): boolean {
    return this.q<boolean>('isTexture', resourceId(res)) === true;
  }

  isProgram(res: Resource): boolean {
    return this.q<boolean>('isProgram', resourceId(res)) === true;
  }

  isShader(res: Resource): boolean {
    return this.q<boolean>('isShader', resourceId(res)) === true;
  }

  isFramebuffer(res: Resource): boolean {
    return this.q<boolean>('isFramebuffer', resourceId(res)) === true;
  }

  isRenderbuffer(res: Resource): boolean {
    return this.q<boolean>('isRenderbuffer', resourceId(res)) === true;
  }

  isContextLost(): boolean {
    return false;
  }

  /** True once the host has a real GL surface for this canvas.
   *
   * three.js snapshots `ACTIVE_UNIFORMS` the first time a program is used
   * and never asks again. Answering that query before the surface exists
   * (the optimistic 0 we have to return to not crash `info.name`) poisons
   * the cache: every later draw uploads no uniforms, the canvas stays
   * black, and the page thinks the model loaded. Pages that compile or
   * render through three must wait for this before the first `render()`. */
  ready(): boolean {
    return this.q<boolean>('contextReady') === true;
  }

  /** The host answers JSON strings for the queries whose GL type can be a
   * list; scalars pass through untouched. The call sites know which GL type
   * the pname returns — hence the generic. */
  private unpackMaybeJson<T>(
    value: number | number[] | boolean | string | null | undefined,
  ): T {
    // Dart null crosses the ABI as undefined; both mean "no answer".
    if (value === undefined || value === null) return null as T;
    if (typeof value !== 'string') return value as T;
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T;
      if (typeof parsed === 'number' || typeof parsed === 'boolean') {
        return parsed as T;
      }
      // a plain object (getActiveUniform's {name,size,type}) — anything
      // else is not a shape the ABI could have produced
      if (typeof parsed === 'object' && parsed !== null) return parsed as T;
      return null as T;
    } catch {
      return null as T;
    }
  }
}

/** What pages type against: the context plus the GL constants, mirroring
 * the DOM's WebGLRenderingContext shape. */
export type FjsWebGLRenderingContextWithConstants =
  FjsWebGLRenderingContext & typeof GL;

// The DOM's context carries the GL constants as instance properties; attach
// them to the prototype once so `gl.VERTEX_SHADER` works the same here.
// (Dropping this line is exactly the "type must be VERTEX_SHADER or
// FRAGMENT_SHADER" + failed-link cascade — fixed during 022's iOS run.)
Object.assign(FjsWebGLRenderingContext.prototype, GL);

// A GL constant this table does not carry reads as `undefined`, which the
// writer encodes as 0 — a garbage enum the driver rejects while the page
// renders nothing and hears nothing (see the GL table's WebGL 2 header).
// This sentinel sits at the END of the prototype chain, so it is consulted
// only when the lookup already missed the instance, the methods AND the
// constants: the hot path never pays for it, and a name we forgot becomes
// one log line instead of a blank canvas.
Object.setPrototypeOf(
  FjsWebGLRenderingContext.prototype,
  new Proxy(Object.prototype, {
    get(target, prop, receiver) {
      if (
        typeof prop === 'string' &&
        /^[A-Z][A-Z0-9_]*$/.test(prop) &&
        !(prop in target)
      ) {
        warnWebglOnce(
          `webgl-const-${prop}`,
          `gl.${prop} is not a GL constant this runtime knows. It reads as ` +
            'undefined and encodes as 0, so the call using it will be ' +
            'rejected by the driver — report it as an fjs bug.',
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }),
);

/** The factory the core registry calls for 'webgl'/'webgl2'. Narrowing the
 * core surface to what this module needs is a structural cast: the core
 * never names this module. */
export function createWebglContext(
  target: CanvasContextTarget,
): unknown {
  if (target.domCanvas) return target.domCanvas.getContext('webgl');
  if (!target.surface) return null;
  // One webgl context per canvas; the node id is the host-side key for the
  // sync-query channel (fjs.webgl.*).
  const surface = target.surface as unknown as WebglSurface;
  return new FjsWebGLRenderingContext(surface, surface.nodeId);
}

export function createWebgl2Context(
  target: CanvasContextTarget,
): unknown {
  if (target.domCanvas) return target.domCanvas.getContext('webgl2');
  return createWebglContext(target);
}
