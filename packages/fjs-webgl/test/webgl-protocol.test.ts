// Byte-level contract for the WebGL command stream, plus the context that
// produces it.
//
// The command table is written by hand in two places — src/protocol.ts and
// the fjs_webgl Dart package's webgl_replay.dart — with nothing generating
// one from the other. These assertions pin the encoding so a change on this
// side that forgets the other one fails here rather than on a device.
import { describe, expect, it, vi } from 'vitest';

// The context's sync queries go over invokeHost; tests here run hostless, so
// the ABI answers null — exactly the shape flutter_angle's "no log written"
// produces, which is the case the info-log test below pins.
const { invokeHostMock } = vi.hoisted(() => ({ invokeHostMock: vi.fn(() => null) }));
vi.mock('@ufjs/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ufjs/runtime')>();
  return { ...actual, invokeHost: invokeHostMock };
});

import { WebglChunkWriter, WebglCmd, TexSource } from '../src/protocol';
import { FjsWebGLObject, FjsWebGLRenderingContext, GL } from '../src/context';
import { registerWebgl } from '../index';
import { registerContextType, resolveContext, FjsCanvasImage } from '@ufjs/runtime';

/** A minimal reader for the handful of command shapes these tests pin. Not
 * the decoder's twin — webgl_replay.dart is — just enough to catch an
 * accidental schema change on this side. */
function decode(
  bytes: Uint8Array,
): Array<{ cmd: number; args: number[]; str?: string }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const strings = new Map<number, string>();
  const out: Array<{ cmd: number; args: number[]; str?: string }> = [];
  const eat = {
    u8: () => bytes[p++],
    u16: () => {
      const v = view.getUint16(p, true);
      p += 2;
      return v;
    },
    u32: () => {
      const v = view.getUint32(p, true);
      p += 4;
      return v;
    },
    i32: () => {
      const v = view.getInt32(p, true);
      p += 4;
      return v;
    },
    f32: () => {
      const v = view.getFloat32(p, true);
      p += 4;
      return v;
    },
    str: () => {
      const id = view.getUint16(p, true);
      p += 2;
      return strings.get(id) ?? '';
    },
  };
  while (p < bytes.length) {
    const cmd = view.getUint16(p, true);
    p += 2;
    if (cmd === WebglCmd.StrDef) {
      const id = view.getUint16(p, true);
      const len = view.getUint16(p + 2, true);
      p += 4;
      strings.set(id, new TextDecoder().decode(bytes.subarray(p, p + len)));
      p += len;
      continue;
    }
    if (cmd === WebglCmd.StrDef32) {
      const id = view.getUint16(p, true);
      const len = view.getUint32(p + 2, true);
      p += 6;
      strings.set(id, new TextDecoder().decode(bytes.subarray(p, p + len)));
      p += len;
      continue;
    }
    const args: number[] = [];
    let str: string | undefined;
    switch (cmd) {
      case WebglCmd.CreateShader:
        args.push(eat.u32(), eat.u32());
        break;
      case WebglCmd.CreateBuffer:
      case WebglCmd.CreateTexture:
      case WebglCmd.CreateVertexArray:
      case WebglCmd.BindVertexArray:
      case WebglCmd.DeleteVertexArray:
        args.push(eat.u32());
        break;
      case WebglCmd.BindBuffer:
        args.push(eat.u32(), eat.u32());
        break;
      case WebglCmd.PixelStorei:
        args.push(eat.u32(), eat.i32());
        break;
      case WebglCmd.ClearColor:
        args.push(eat.f32(), eat.f32(), eat.f32(), eat.f32());
        break;
      case WebglCmd.BufferData: {
        const target = eat.u32();
        const usage = eat.u32();
        const len = eat.u32();
        let sum = 0;
        for (let i = 0; i < len; i++) sum += bytes[p + i];
        p += len;
        args.push(target, usage, len, sum);
        break;
      }
      case WebglCmd.BufferDataSize:
        args.push(eat.u32(), eat.u32(), eat.u32());
        break;
      case WebglCmd.TexImage2DSource:
        args.push(
          eat.u32(), eat.i32(), eat.i32(), eat.u32(), eat.u32(),
          eat.u32(), eat.u32(), eat.u8(),
        );
        break;
      case WebglCmd.TexSubImage2DSource:
        args.push(
          eat.u32(), eat.i32(), eat.i32(), eat.i32(), eat.u32(),
          eat.u32(), eat.u32(), eat.u32(), eat.u8(),
        );
        break;
      case WebglCmd.TexStorage2D:
        args.push(eat.u32(), eat.i32(), eat.i32(), eat.i32(), eat.i32());
        break;
      case WebglCmd.TexImage3D: {
        const target = eat.u32();
        const level = eat.i32();
        const internalformat = eat.i32();
        const w = eat.i32();
        const h = eat.i32();
        const d = eat.i32();
        const border = eat.i32();
        const format = eat.u32();
        const type = eat.u32();
        const len = eat.u32();
        p += len; // payload shape pinned by the Dart side's decoder test
        args.push(target, level, internalformat, w, h, d, border, format, type, len);
        break;
      }
      case WebglCmd.DeleteBuffer:
      case WebglCmd.DeleteTexture:
      case WebglCmd.DeleteVertexArray:
        args.push(eat.u32());
        break;
      case WebglCmd.ShaderSource: {
        const shader = eat.u32();
        str = eat.str();
        args.push(shader);
        break;
      }
      case WebglCmd.UniformMatrix4fv: {
        const loc = eat.u32();
        const transpose = eat.u8();
        const n = eat.u32();
        const vals: number[] = [];
        for (let i = 0; i < n; i++) vals.push(eat.f32());
        args.push(loc, transpose, n, ...vals);
        break;
      }
      case WebglCmd.Uniform2fv: {
        const loc = eat.u32();
        const n = eat.u32();
        const vals: number[] = [];
        for (let i = 0; i < n; i++) vals.push(eat.f32());
        args.push(loc, n, ...vals);
        break;
      }
      case WebglCmd.DrawArrays:
        args.push(eat.u32(), eat.i32(), eat.u32());
        break;
      case WebglCmd.VertexAttribDivisor:
        args.push(eat.u32(), eat.u32());
        break;
      case WebglCmd.DrawArraysInstanced:
        args.push(eat.u32(), eat.i32(), eat.u32(), eat.u32());
        break;
      case WebglCmd.DrawElementsInstanced:
        args.push(eat.u32(), eat.u32(), eat.u32(), eat.i32(), eat.u32());
        break;
      case WebglCmd.Clear:
        args.push(eat.u32());
        break;
      default:
        throw new Error(`test reader does not know cmd 0x${cmd.toString(16)}`);
    }
    out.push({ cmd, args, str });
  }
  return out;
}

/** A surface shaped the way the core's FjsCanvasSurface presents itself to
 * context modules; `take()` closes and collects the chunks so each test
 * sees the commands its context emitted. */
function makeSurface() {
  const writer = new WebglChunkWriter(() => {});
  let attachedWriter: { takeChunks(): Uint8Array[] } | null = null;
  return {
    webglWriter: () => writer,
    /** what attachOpWriter hands the core: chunks go out as op 11 */
    attached: [] as Array<{ id: number; chunk: Uint8Array }>,
    take(): Uint8Array[] {
      // the CONTEXT attaches its own writer in the constructor; drain that
      // one, so context-level tests see the commands their gl.* calls made
      return (attachedWriter ?? writer).takeChunks();
    },
    width: () => 300,
    height: () => 200,
    devicePixelRatio: () => 2,
    nodeId: 7,
    attachOpWriter(w: { takeChunks(): Uint8Array[] }) {
      attachedWriter = w;
    },
    markDirty() {},
  };
}

describe('WebglChunkWriter encoding', () => {
  it('encodes createShader with a u16 command id and u32 args', () => {
    const s = makeSurface();
    s.webglWriter().createShader(3, GL.VERTEX_SHADER);
    const ops = decode(s.take()[0]);
    expect(ops).toEqual([
      { cmd: WebglCmd.CreateShader, args: [3, GL.VERTEX_SHADER] },
    ]);
  });

  it('interns shader source per chunk and references it by u16', () => {
    const s = makeSurface();
    const w = s.webglWriter();
    const id = w.str('void main() {}');
    w.shaderSource(2, id);
    w.shaderSource(3, w.str('void main() {}'));
    const ops = decode(s.take()[0]);
    // both references resolve to the same interned string, defined once
    expect(ops).toHaveLength(2);
    expect(ops[0].cmd).toBe(WebglCmd.ShaderSource);
    expect(ops[0].str).toBe('void main() {}');
    expect(ops[1].str).toBe('void main() {}');
  });

  it('resets the string table per chunk, keeping chunks self-contained', () => {
    const s = makeSurface();
    const w = s.webglWriter();
    w.shaderSource(2, w.str('first chunk'));
    s.take(); // closes the chunk
    w.shaderSource(3, w.str('second chunk'));
    const ops = decode(s.take()[0]);
    expect(ops[0].str).toBe('second chunk');
  });

  it('inlines buffer data after target and usage', () => {
    const s = makeSurface();
    s.webglWriter().bufferData(
      GL.ARRAY_BUFFER,
      new Uint8Array([1, 2, 3, 4]),
      GL.STATIC_DRAW,
    );
    const ops = decode(s.take()[0]);
    expect(ops[0]).toEqual({
      cmd: WebglCmd.BufferData,
      args: [GL.ARRAY_BUFFER, GL.STATIC_DRAW, 4, 10], // 1+2+3+4 checksum
    });
  });

  it('the size form of bufferData carries no payload', () => {
    const s = makeSurface();
    s.webglWriter().bufferDataSize(GL.ARRAY_BUFFER, 256, GL.DYNAMIC_DRAW);
    const ops = decode(s.take()[0]);
    expect(ops[0].args).toEqual([GL.ARRAY_BUFFER, GL.DYNAMIC_DRAW, 256]);
  });

  it('encodes texImage2DSource with the image-handle kind', () => {
    const s = makeSurface();
    s.webglWriter().texImage2DSource(
      GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, 42,
    );
    const ops = decode(s.take()[0]);
    // the trailing 0 is the flipY flag (spec 023) — always present on the wire
    expect(ops[0].args).toEqual([
      GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE,
      TexSource.ImageHandle, 42, 0,
    ]);
  });

  it('encodes vertex-array create/bind/delete (spec 023)', () => {
    const s = makeSurface();
    const w = s.webglWriter();
    w.createVertexArray(9);
    w.bindVertexArray(9);
    w.bindVertexArray(0);
    w.deleteVertexArray(9);
    const ops = decode(s.take()[0]);
    expect(ops.map((o) => [o.cmd, o.args])).toEqual([
      [WebglCmd.CreateVertexArray, [9]],
      [WebglCmd.BindVertexArray, [9]],
      [WebglCmd.BindVertexArray, [0]],
      [WebglCmd.DeleteVertexArray, [9]],
    ]);
  });

  it('shaderSource strings longer than 64 KiB use StrDef32 with u32 len', () => {
    // three.js's built-in PBR + skinning shader is ~70 KB once assembled;
    // a u16 length silently truncates and desyncs the stream (spec 023 iOS)
    const s = makeSurface();
    const big = 'void main() { //' + 'x'.repeat(70_000) + '}';
    const strId = s.webglWriter().str(big);
    s.webglWriter().shaderSource(5, strId);
    const chunk = s.take()[0];
    // StrDef32 = 0x0002, little-endian u16
    expect(chunk[0]).toBe(0x02);
    expect(chunk[1]).toBe(0x00);
    // str id, then u32 length just past it
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    expect(view.getUint16(2, true)).toBe(strId);
    expect(view.getUint32(4, true)).toBeGreaterThan(64 * 1024);
    const ops = decode(chunk);
    expect(ops[0].cmd).toBe(WebglCmd.ShaderSource);
    expect(ops[0].str).toBe(big);
  });

  it('encodes a mat4 uniform with transpose flag and 16 floats', () => {
    const s = makeSurface();
    const m = Array.from({ length: 16 }, (_, i) => i * 0.5);
    s.webglWriter().uniformMatrix4fv(5, false, m);
    const ops = decode(s.take()[0]);
    expect(ops[0].cmd).toBe(WebglCmd.UniformMatrix4fv);
    expect(ops[0].args[0]).toBe(5);
    expect(ops[0].args[1]).toBe(0); // transpose=false
    expect(ops[0].args[2]).toBe(16);
    expect(ops[0].args.slice(3)).toEqual(m);
  });

  it('vertexAttribDivisor round-trips (WebGL2 core, three calls it always)', () => {
    const s = makeSurface();
    s.webglWriter().vertexAttribDivisor(2, 0);
    const ops = decode(s.take()[0]);
    expect(ops[0].cmd).toBe(WebglCmd.VertexAttribDivisor);
    expect(ops[0].args).toEqual([2, 0]);
  });

  it('uniform2fv sends element count, arity implied by the command id', () => {
    const s = makeSurface();
    s.webglWriter().uniform2fv(1, [1, 2]);
    const ops = decode(s.take()[0]);
    // location, element count, then the floats
    expect(ops[0].args).toEqual([1, 2, 1, 2]);
  });
});

describe('FjsWebGLRenderingContext', () => {
  it('exposes gl.canvas in device pixels, unlike the 2d context', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    expect(gl.canvas.width).toBe(600); // 300 logical x dpr 2
    expect(gl.canvas.height).toBe(400);
  });

  it('instanced draws exist on the context and put instanceCount last (spec 033)', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    gl.drawArraysInstanced(GL.TRIANGLES, -2, 3, 12);
    gl.drawElementsInstanced(GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 8, 60);
    const ops = decode(s.take()[0]).filter(
      (o) =>
        o.cmd === WebglCmd.DrawArraysInstanced ||
        o.cmd === WebglCmd.DrawElementsInstanced,
    );
    expect(ops).toEqual([
      { cmd: WebglCmd.DrawArraysInstanced, args: [GL.TRIANGLES, -2, 3, 12] },
      {
        cmd: WebglCmd.DrawElementsInstanced,
        args: [GL.TRIANGLES, 6, GL.UNSIGNED_SHORT, 8, 60],
      },
    ]);
  });

  it('null resource arguments encode as id 0', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
    const ops = decode(s.take()[0]);
    expect(ops[0].args).toEqual([GL.ARRAY_BUFFER, 0]);
  });

  it('allocates distinct opaque resource ids and passes them back', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const a = gl.createBuffer();
    const b = gl.createTexture();
    expect(a!.kind).toBe('WebGLBuffer');
    expect(b!.kind).toBe('WebGLTexture');
    gl.bindBuffer(GL.ARRAY_BUFFER, a);
    gl.bindBuffer(GL.ARRAY_BUFFER, b);
    const ops = decode(s.take()[0]).filter((o) => o.cmd === WebglCmd.BindBuffer);
    expect(ops[0].args).toEqual([GL.ARRAY_BUFFER, a!.id]);
    expect(ops[1].args).toEqual([GL.ARRAY_BUFFER, b!.id]);
  });

  it('createShader rejects a non-shader type', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    expect(gl.createShader(GL.TRIANGLES)).toBeNull();
    expect(gl.createShader(GL.VERTEX_SHADER)).not.toBeNull();
  });

  it('getActiveUniform unpacks the Dart side\'s JSON answer', () => {
    // the Dart query answers '{"name":..,"size":..,"type":..}' (v1 ABI only
    // carries scalars); handing three.js the raw string blew up parseUniform,
    // which reads .name (spec 023 iOS)
    invokeHostMock.mockReturnValueOnce(
      '{"name":"u_projectionMatrix","size":1,"type":35676}' as never,
    );
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const program = gl.createProgram();
    const info = gl.getActiveUniform(program!, 0);
    expect(info).toEqual({ name: 'u_projectionMatrix', size: 1, type: 35676 });
    invokeHostMock.mockReturnValueOnce(null);
    expect(gl.getActiveAttrib(program!, 0)).toBeNull();
  });

  it('info-log queries return strings, never null (three trims them)', () => {
    // WebGLState's onFirstUse does gl.getProgramInfoLog(program).trim() —
    // a null from flutter_angle's "no log written" blew up every frame
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const prog = gl.createProgram();
    const sh = gl.createShader(GL.VERTEX_SHADER);
    expect(gl.getProgramInfoLog(prog!)).toBe('');
    expect(gl.getShaderInfoLog(sh!)).toBe('');
    expect(gl.getShaderSource(sh!)).toBe('');
  });

  it('createVertexArray allocates its own kind and binds id 0 unbound', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const vao = gl.createVertexArray();
    expect(vao!.kind).toBe('WebGLVertexArrayObject');
    gl.bindVertexArray(vao);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(vao);
    const ops = decode(s.take()[0]);
    expect(ops.map((o) => [o.cmd, o.args])).toEqual([
      [WebglCmd.CreateVertexArray, [vao!.id]],
      [WebglCmd.BindVertexArray, [vao!.id]],
      [WebglCmd.BindVertexArray, [0]],
      [WebglCmd.DeleteVertexArray, [vao!.id]],
    ]);
  });

  it('pixelStorei(UNPACK_FLIP_Y_WEBGL) rides along on texImage2DSource', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    // the 6-arg form requires a real FjsCanvasImage (instanceof check);
    // constructing one without setting `src` stays host-free
    const image = new FjsCanvasImage();
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, image);
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, image);
    const ops = decode(s.take()[0]).filter(
      (o) => o.cmd === WebglCmd.TexImage2DSource,
    );
    expect(ops).toHaveLength(2);
    expect(ops[0].args[6]).toBe(image.handle);
    expect(ops[0].args[7]).toBe(1);
    expect(ops[1].args[7]).toBe(0);
  });

  it('texSubImage2D 6-arg source form routes to TexSubImage2DSource', () => {
    // three.js's WebGL2 upload pair: texStorage2D then texSubImage2D(source)
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const image = new FjsCanvasImage();
    gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, image.width, image.height);
    gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texSubImage2D(
      GL.TEXTURE_2D, 0, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE, image,
    );
    const ops = decode(s.take()[0]);
    expect(ops[0].cmd).toBe(WebglCmd.TexStorage2D);
    expect(ops[1].cmd).toBe(WebglCmd.PixelStorei);
    expect(ops[2].cmd).toBe(WebglCmd.TexSubImage2DSource);
    expect(ops[2].args).toEqual([
      GL.TEXTURE_2D, 0, 0, 0, GL.RGBA, GL.UNSIGNED_BYTE,
      TexSource.ImageHandle, image.handle, 1,
    ]);
  });

  it('getShaderPrecisionFormat answers highp, not flutter_angle zeros', () => {
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    const float = gl.getShaderPrecisionFormat(
      GL.FRAGMENT_SHADER, GL.HIGH_FLOAT,
    );
    expect(float).toEqual({ rangeMin: 127, rangeMax: 127, precision: 23 });
    const int = gl.getShaderPrecisionFormat(
      GL.VERTEX_SHADER, GL.HIGH_INT,
    );
    expect(int!.precision).toBe(0);
    expect(int!.rangeMin).toBeGreaterThan(16);
  });

  it('answers the string pnames three.js version-sniffs without the host', () => {
    // flutter_angle's getParameter throws on these keys; WebGLState calls
    // .indexOf on VERSION during renderer init (spec 023 iOS crash)
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    expect(gl.getParameter(GL.VERSION)).toContain('WebGL 2.0');
    expect(gl.getParameter(GL.SHADING_LANGUAGE_VERSION)).toContain('GLSL ES 3.00');
    expect(gl.getParameter(GL.IMPLEMENTATION_COLOR_READ_TYPE)).toBe(
      GL.UNSIGNED_BYTE,
    );
    expect(gl.getParameter(GL.IMPLEMENTATION_COLOR_READ_FORMAT)).toBe(GL.RGBA);
    expect(s.take()).toHaveLength(0); // answered locally, nothing crossed the ABI
    // array pnames too: flutter_angle's GetIntegerv returns only the first
    // component, so WebGLState's Vector4.fromArray would get garbage or null
    const box = gl.getParameter(GL.SCISSOR_BOX);
    expect(box).toEqual([0, 0, 0, 0]);
    const viewport = gl.getParameter(GL.VIEWPORT) as number[];
    expect(viewport).toHaveLength(4);
    expect(viewport[2]).toBe(600); // canvas bitmap width (300 logical x dpr 2)
    expect(viewport[3]).toBe(400);
    expect(s.take()).toHaveLength(0);
  });

  it('ready() is false until the host has a GL surface', () => {
    // three.js snapshots ACTIVE_UNIFORMS on first program use; answering
    // that before the surface exists poisons the cache. Pages wait on this.
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    expect(gl.ready()).toBe(false);
    invokeHostMock.mockReturnValueOnce(true as never);
    expect(gl.ready()).toBe(true);
  });

  it('texImage3D carries depth and border, inlining the payload', () => {
    // three's WebGLState seeds empty TEXTURE_3D / TEXTURE_2D_ARRAY textures
    // at renderer init — without this command those calls are not-a-function
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    gl.texImage3D(
      GL.TEXTURE_3D, 0, GL.RGBA, 1, 1, 1, 0,
      GL.RGBA, GL.UNSIGNED_BYTE, new Uint8Array([9, 8, 7, 6]),
    );
    const ops = decode(s.take()[0]);
    expect(ops[0].cmd).toBe(WebglCmd.TexImage3D);
    expect(ops[0].args).toEqual([
      GL.TEXTURE_3D, 0, GL.RGBA, 1, 1, 1, 0, GL.RGBA, GL.UNSIGNED_BYTE, 4,
    ]);
  });

  it('uniform array truncation never sends a ragged tail', () => {
    // a ragged tail is INVALID_OPERATION in GL and the decoder slices by
    // implied arity, so the context must truncate before encoding
    const s = makeSurface();
    const gl = new FjsWebGLRenderingContext(s as never, 7);
    // a real WebGLUniformLocation comes from getUniformLocation, which the
    // host answers; a standalone object is what the id encoder needs
    const location = new FjsWebGLObject('WebGLUniformLocation', 9);
    // 3 floats into uniform2fv — tail dropped
    gl.uniform2fv(location, [1, 2, 3]);
    const ops = decode(s.take()[0]);
    expect(ops[0].args).toEqual([9, 2, 1, 2]); // location, count, floats
  });

  it('attaches an op writer that emits op 11 through the runtime', () => {
    const s = makeSurface();
    // the real FjsCanvasSurface.attachOpWriter is what bridges to
    // getWriter().webgl; here we verify the context attaches one and that
    // its write() would carry the node id
    let attached: { write: (id: number, chunk: Uint8Array) => void } | null = null;
    const surface = {
      ...s,
      attachOpWriter(w: never) {
        attached = w as never;
      },
      markDirty: () => {},
    };
    void new FjsWebGLRenderingContext(surface as never, 7);
    expect(attached).not.toBeNull();
    // the writer produces chunks; write() forwards them with the node id
    s.webglWriter().clear(GL.COLOR_BUFFER_BIT);
    const [chunk] = s.take();
    expect(chunk.length).toBeGreaterThan(0);
    expect(() => attached!.write(7, chunk)).not.toThrow();
  });
});

describe('registration', () => {
  it('registers webgl and webgl2 into the runtime registry on import', () => {
    registerWebgl(); // idempotent; the import already ran it
    // through the same registry the core canvas uses. Separate caches: a
    // DOM canvas hands out ONE context type per element.
    const dom = { getContext: (t: string) => ({ native: t }) };
    const ctx = resolveContext(new Map(), 'webgl', { canvas: {}, domCanvas: dom });
    expect(ctx).toEqual({ native: 'webgl' });
    const ctx2 = resolveContext(new Map(), 'webgl2', { canvas: {}, domCanvas: dom });
    expect(ctx2).toEqual({ native: 'webgl2' });
  });

  it('does not disturb other registered types', () => {
    registerContextType('test-other', () => 'other');
    const cache = new Map<string, unknown>();
    const target = {
      canvas: {},
      surface: makeSurface() as unknown as import('@ufjs/runtime').CanvasSurface,
    };
    expect(resolveContext(cache, 'test-other', target)).toBe('other');
  });
});
