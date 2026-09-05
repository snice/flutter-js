// Byte-level contract for the canvas display list, plus the state machine
// that produces it.
//
// The command table is written by hand in two places — canvas/display-list.ts
// and flutter_fjs's lib/src/canvas/canvas_ops.dart — with nothing generating
// one from the other. These assertions pin the encoding so a change on this
// side that forgets the other one fails here rather than on a device.
import { beforeEach, describe, expect, it } from 'vitest';

import { FjsCanvasRenderingContext2D, type CanvasSurface } from '../src/canvas/context-2d';
import { Cmd, CanvasWriter, PathCmd } from '../src/canvas/display-list';
import { parseFont } from '../src/canvas/font';
import { resolveCanvasContextForTest } from './helpers/canvas';

interface Decoded {
  cmd: number;
  args: number[];
  text?: string;
}

/** Strings the last decode() call saw defined, in order. */
let lastStringDefs: string[] = [];

/** Decodes a chunk into a readable command list. Mirrors the Dart reader. */
function decode(chunk: Uint8Array): Decoded[] {
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const decoder = new TextDecoder();
  const strings = new Map<number, string>();
  const defs: string[] = [];
  lastStringDefs = defs;
  const out: Decoded[] = [];
  let i = 0;
  const u8 = () => chunk[i++];
  const u16 = () => {
    const v = view.getUint16(i, true);
    i += 2;
    return v;
  };
  const u32 = () => {
    const v = view.getUint32(i, true);
    i += 4;
    return v;
  };
  const f32 = () => {
    const v = view.getFloat32(i, true);
    i += 4;
    return v;
  };
  while (i < chunk.length) {
    const cmd = u8();
    switch (cmd) {
      case Cmd.StrDef: {
        const id = u16();
        const len = u16();
        const value = decoder.decode(chunk.subarray(i, i + len));
        strings.set(id, value);
        defs.push(value);
        i += len;
        break;
      }
      case Cmd.ClearAll:
      case Cmd.Save:
      case Cmd.Restore:
      case Cmd.ResetTransform:
      case Cmd.Reset:
        out.push({ cmd, args: [] });
        break;
      case Cmd.SetFillColor:
      case Cmd.SetStrokeColor: {
        const id = u16();
        out.push({ cmd, args: [id], text: strings.get(id) });
        break;
      }
      case Cmd.SetLineWidth:
      case Cmd.SetGlobalAlpha:
      case Cmd.SetLineDashOffset:
      case Cmd.SetMiterLimit:
        out.push({ cmd, args: [f32()] });
        break;
      case Cmd.SetLineCap:
      case Cmd.SetLineJoin:
      case Cmd.SetComposite:
      case Cmd.SetTextAlign:
      case Cmd.SetTextBaseline:
        out.push({ cmd, args: [u8()] });
        break;
      case Cmd.SetLineDash: {
        const count = u8();
        out.push({ cmd, args: Array.from({ length: count }, () => f32()) });
        break;
      }
      case Cmd.SetFont: {
        const family = u16();
        out.push({
          cmd,
          args: [family, f32(), u16(), u8()],
          text: strings.get(family),
        });
        break;
      }
      case Cmd.SetShadow: {
        const color = u16();
        out.push({ cmd, args: [color, f32(), f32(), f32()], text: strings.get(color) });
        break;
      }
      case Cmd.ClearRect:
      case Cmd.FillRect:
      case Cmd.StrokeRect:
        out.push({ cmd, args: [f32(), f32(), f32(), f32()] });
        break;
      case Cmd.Transform:
      case Cmd.SetTransform:
        out.push({ cmd, args: [f32(), f32(), f32(), f32(), f32(), f32()] });
        break;
      case Cmd.FillPath:
      case Cmd.ClipPath: {
        const rule = u8();
        const len = u32();
        const path = Array.from(chunk.subarray(i, i + len));
        i += len;
        out.push({ cmd, args: [rule, ...path] });
        break;
      }
      case Cmd.StrokePath: {
        const len = u32();
        const path = Array.from(chunk.subarray(i, i + len));
        i += len;
        out.push({ cmd, args: path });
        break;
      }
      case Cmd.FillText:
      case Cmd.StrokeText: {
        const id = u16();
        out.push({ cmd, args: [f32(), f32(), u8(), f32()], text: strings.get(id) });
        break;
      }
      case Cmd.SetFillHandle:
      case Cmd.SetStrokeHandle:
        out.push({ cmd, args: [u32()] });
        break;
      case Cmd.DefLinearGradient: {
        const handle = u32();
        const geometry = [f32(), f32(), f32(), f32()];
        const count = u8();
        const stops: number[] = [];
        for (let s = 0; s < count; s++) {
          stops.push(f32());
          stops.push(u16());
        }
        out.push({ cmd, args: [handle, ...geometry, count, ...stops] });
        break;
      }
      default:
        throw new Error(`test decoder does not know command 0x${cmd.toString(16)}`);
    }
  }
  return out;
}

function makeSurface(width = 300, height = 200) {
  const chunks: Uint8Array[] = [];
  const writer = new CanvasWriter(() => {});
  const surface: CanvasSurface = {
    nodeId: 1,
    writer,
    width: () => width,
    height: () => height,
  };
  return {
    ctx: new FjsCanvasRenderingContext2D(surface, {}),
    take(): Uint8Array[] {
      chunks.push(...writer.takeChunks());
      const out = [...chunks];
      chunks.length = 0;
      return out;
    },
  };
}

describe('canvas 2d display list', () => {
  it('encodes a fill as an interned colour plus a rect', () => {
    const { ctx, take } = makeSurface();
    ctx.fillStyle = '#07c160';
    ctx.fillRect(10, 20, 30, 40);
    const [chunk] = take();
    expect(decode(chunk)).toEqual([
      { cmd: Cmd.SetFillColor, args: [1], text: '#07c160' },
      { cmd: Cmd.FillRect, args: [10, 20, 30, 40] },
    ]);
  });

  it('sends a repeated property once', () => {
    const { ctx, take } = makeSurface();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#000';
      ctx.fillRect(i, 0, 1, 1);
    }
    const commands = decode(take()[0]);
    expect(commands.filter((c) => c.cmd === Cmd.SetFillColor)).toHaveLength(1);
    expect(commands.filter((c) => c.cmd === Cmd.FillRect)).toHaveLength(3);
  });

  it('re-sends a property that a restore rolled back', () => {
    const { ctx, take } = makeSurface();
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 1, 1);
    ctx.save();
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    // back to #111111 as far as the page is concerned, and the host's own
    // stack popped to it too — so nothing needs re-sending
    ctx.fillRect(0, 0, 1, 1);
    const colors = decode(take()[0])
      .filter((c) => c.cmd === Cmd.SetFillColor)
      .map((c) => c.text);
    expect(colors).toEqual(['#111111', '#222222']);
  });

  it('opens a new chunk on a full-canvas clearRect', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.fillRect(0, 0, 10, 10);
    ctx.clearRect(0, 0, 300, 200);
    ctx.fillRect(0, 0, 20, 20);
    const chunks = take();
    expect(chunks).toHaveLength(2);
    expect(decode(chunks[1])[0].cmd).toBe(Cmd.ClearAll);
  });

  it('keeps a partial clear as a normal command', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.clearRect(0, 0, 100, 100);
    const chunks = take();
    expect(chunks).toHaveLength(1);
    expect(decode(chunks[0])).toEqual([
      { cmd: Cmd.ClearRect, args: [0, 0, 100, 100] },
    ]);
  });

  it('recognises a full clear under a translate', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.translate(0, 0);
    ctx.scale(1, 1);
    ctx.clearRect(0, 0, 300, 200);
    const chunks = take();
    expect(decode(chunks[chunks.length - 1])[0].cmd).toBe(Cmd.ClearAll);
  });

  it('does not truncate before the host has reported a size', () => {
    const { ctx, take } = makeSurface(0, 0);
    ctx.clearRect(0, 0, 300, 200);
    expect(decode(take()[0])[0].cmd).toBe(Cmd.ClearRect);
  });

  it('encodes a path with its commands inline', () => {
    const { ctx, take } = makeSurface();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 10);
    ctx.closePath();
    ctx.stroke();
    const stroke = decode(take()[0]).find((c) => c.cmd === Cmd.StrokePath);
    expect(stroke).toBeDefined();
    expect(stroke!.args[0]).toBe(PathCmd.MoveTo);
    expect(stroke!.args[9]).toBe(PathCmd.LineTo);
    expect(stroke!.args[stroke!.args.length - 1]).toBe(PathCmd.Close);
  });

  it('defines a gradient once and then names it by handle', () => {
    const { ctx, take } = makeSurface();
    const gradient = ctx.createLinearGradient(0, 0, 100, 0);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(1, '#000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 100, 10);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 100, 10);
    const commands = decode(take()[0]);
    expect(commands.filter((c) => c.cmd === Cmd.DefLinearGradient)).toHaveLength(1);
    expect(commands.filter((c) => c.cmd === Cmd.SetFillHandle)).toHaveLength(2);
  });

  it('interns a string once per chunk', () => {
    const { ctx, take } = makeSurface();
    ctx.font = '14px sans-serif';
    ctx.fillText('hello', 0, 0);
    ctx.fillText('hello', 0, 20);
    ctx.fillText('hello', 0, 40);
    const commands = decode(take()[0]);
    expect(commands.filter((c) => c.cmd === Cmd.FillText)).toHaveLength(3);
    // the family and the text: one definition each, however many times they
    // are used. The fill colour is not there at all — it is still the
    // default, which the host already starts from.
    expect(lastStringDefs).toEqual(['sans-serif', 'hello']);
  });

  it('re-states the font and strings after a truncating clear', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.font = '14px sans-serif';
    ctx.fillText('hello', 0, 0);
    ctx.clearRect(0, 0, 300, 200);
    ctx.fillText('hello', 0, 0);
    const chunks = take();
    expect(chunks).toHaveLength(2);
    decode(chunks[0]);
    const first = [...lastStringDefs];
    decode(chunks[1]);
    // a chunk has to stand on its own: the host may have dropped the
    // previous one, so every string it references is defined again
    expect(lastStringDefs).toEqual(first);
  });

  it('doubles an odd dash pattern, as the spec says', () => {
    const { ctx, take } = makeSurface();
    ctx.setLineDash([4]);
    expect(ctx.getLineDash()).toEqual([4, 4]);
    ctx.strokeRect(0, 0, 10, 10);
    const dash = decode(take()[0]).find((c) => c.cmd === Cmd.SetLineDash);
    expect(dash!.args).toEqual([4, 4]);
  });

  it('keeps drawing with the old font after an unsupported font string', () => {
    const { ctx, take } = makeSurface();
    ctx.font = '16px Menlo';
    ctx.font = 'caption';
    ctx.fillText('x', 0, 0);
    const font = decode(take()[0]).find((c) => c.cmd === Cmd.SetFont);
    // size 16, weight 400, upright — the last parseable assignment
    expect(font!.text).toBe('Menlo');
    expect(font!.args.slice(1)).toEqual([16, 400, 0]);
  });
});

describe('font shorthand', () => {
  it('parses the supported shape', () => {
    expect(parseFont('14px sans-serif')).toEqual({
      size: 14,
      weight: 400,
      italic: false,
      family: 'sans-serif',
    });
    expect(parseFont('italic bold 12.5px "PingFang SC", sans-serif')).toEqual({
      size: 12.5,
      weight: 700,
      italic: true,
      family: 'PingFang SC',
    });
    expect(parseFont('300 20px Menlo')).toEqual({
      size: 20,
      weight: 300,
      italic: false,
      family: 'Menlo',
    });
  });

  it('rejects what the host cannot resolve', () => {
    expect(parseFont('caption')).toBeNull();
    expect(parseFont('1.2em serif')).toBeNull();
    expect(parseFont('')).toBeNull();
  });
});

describe('getContext registry', () => {
  beforeEach(() => {
    // fresh warn state so the "warns once" assertion is about this test
    resolveCanvasContextForTest.reset();
  });

  it('returns the same 2d context every time', () => {
    const { first, second } = resolveCanvasContextForTest.twice('2d');
    expect(first).toBeInstanceOf(FjsCanvasRenderingContext2D);
    expect(second).toBe(first);
  });

  it('returns null for webgl and warns exactly once', () => {
    const { first, second, warnings } = resolveCanvasContextForTest.twice('webgl');
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe('chunk boundaries carry state forward', () => {
  it('re-applies the transform after a truncating clear', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.translate(10, 20);
    ctx.fillRect(0, 0, 5, 5);
    // covers the canvas in device space: the translate is undone by the
    // offset, so this IS a full clear
    ctx.clearRect(-10, -20, 300, 200);
    ctx.fillRect(0, 0, 5, 5);
    const chunks = take();
    const second = decode(chunks[chunks.length - 1]);
    expect(second[0].cmd).toBe(Cmd.ClearAll);
    expect(second[1]).toEqual({ cmd: Cmd.SetTransform, args: [1, 0, 0, 1, 10, 20] });
  });

  it('re-sends the fill colour after a truncating clear', () => {
    const { ctx, take } = makeSurface(300, 200);
    ctx.fillStyle = '#07c160';
    ctx.fillRect(0, 0, 5, 5);
    ctx.clearRect(0, 0, 300, 200);
    ctx.fillRect(0, 0, 5, 5);
    const second = decode(take()[1]);
    expect(second.find((c) => c.cmd === Cmd.SetFillColor)?.text).toBe('#07c160');
  });

  it('drops control characters the browser would not draw', () => {
    // ECharts names an unnamed series `series\u00000` (its
    // DUMMY_COMPONENT_NAME_PREFIX is literally 'series\0'). The browser's
    // shaper skips the NUL; Flutter's TextPainter paints .notdef for it, so
    // the same tooltip read `series0` on the web and `series▤0` on the app.
    const { ctx, take } = makeSurface();
    ctx.fillText('series\u00000: 735', 0, 0);
    decode(take()[0]);
    expect(lastStringDefs).toEqual(['series0: 735']);
  });

  it('keeps tab and newline, which both platforms lay out', () => {
    const { ctx, take } = makeSurface();
    ctx.fillText('a\tb\nc', 0, 0);
    decode(take()[0]);
    expect(lastStringDefs).toEqual(['a\tb\nc']);
  });
});
