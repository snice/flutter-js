// Gradients and patterns.
//
// Both are HANDLES: the definition (stops, geometry, source image) crosses
// once, and `fillStyle = gradient` after that is a 5-byte command naming an
// id. ECharts assigns the same gradient object on every draw of every bar,
// so re-sending the stops each time would put the most verbose thing in the
// stream on the hottest path.
//
// The definition is emitted lazily — on the first assignment, not at
// construction — because a page may build a gradient it never uses, and
// because the writer only exists once the canvas has a node to draw into.
import { Cmd, type CanvasWriter } from './display-list';
import { warnCanvasOnce } from './warn';

let nextHandle = 1;

interface Stop {
  offset: number;
  color: string;
}

export class FjsCanvasGradient {
  readonly handle = nextHandle++;
  private readonly stops: Stop[] = [];
  /** Writers this definition has already been sent to. A gradient can be
   * used by more than one canvas, and each host-side canvas keeps its own
   * resource table. */
  private readonly defined = new WeakSet<object>();

  constructor(
    private readonly radial: boolean,
    private readonly geometry: readonly number[],
  ) {}

  addColorStop(offset: number, color: string): void {
    if (!Number.isFinite(offset)) return;
    this.stops.push({ offset, color });
  }

  /** Emits the definition into [writer] if it has not seen it yet. */
  define(writer: CanvasWriter): void {
    if (this.defined.has(writer)) return;
    this.defined.add(writer);
    if (this.stops.length === 0) {
      warnCanvasOnce(
        'gradient-no-stops',
        'a canvas gradient was used with no color stops; nothing will be ' +
          'painted with it.',
      );
    }
    const ids = this.stops.map((stop) => writer.str(stop.color));
    const buf = writer.cmd(
      this.radial ? Cmd.DefRadialGradient : Cmd.DefLinearGradient,
    );
    buf.u32(this.handle);
    for (const value of this.geometry) buf.f32(value);
    buf.u8(Math.min(this.stops.length, 255));
    for (let i = 0; i < this.stops.length && i < 255; i++) {
      buf.f32(this.stops[i].offset);
      buf.u16(ids[i]);
    }
  }
}

export const enum PatternRepeat {
  Repeat = 0,
  RepeatX = 1,
  RepeatY = 2,
  NoRepeat = 3,
}

export class FjsCanvasPattern {
  readonly handle = nextHandle++;
  private readonly defined = new WeakSet<object>();

  constructor(
    private readonly imageHandle: number,
    private readonly repeat: PatternRepeat,
  ) {}

  define(writer: CanvasWriter): void {
    if (this.defined.has(writer)) return;
    this.defined.add(writer);
    const buf = writer.cmd(Cmd.DefPattern);
    buf.u32(this.handle);
    buf.u32(this.imageHandle);
    buf.u8(this.repeat);
  }
}

export function patternRepeat(value: string | null): PatternRepeat {
  switch (value) {
    case 'repeat-x':
      return PatternRepeat.RepeatX;
    case 'repeat-y':
      return PatternRepeat.RepeatY;
    case 'no-repeat':
      return PatternRepeat.NoRepeat;
    default:
      return PatternRepeat.Repeat;
  }
}

/** Test hook: makes handle ids deterministic. */
export function resetCanvasHandles(): void {
  nextHandle = 1;
}
