// 赛道：中心线 + 逐点宽度 / 侧倾 + 路面、护栏、检查点、发车格。
//
// 移植自 flutter3d_game_racing 的 TrackSpline / TrackDocument。赛道文件是
// tool/make_track.py 生成的原始 JSON，`<name>.json` 管赛道和天空，
// `<name>_level.json` 管场景里的方块（草地大平台、石柱）和灯光。
import { Vector3 } from 'three';
import { CatmullRom } from './spline';

export class TrackFrame {
  readonly position = new Vector3();
  readonly forward = new Vector3();
  readonly right = new Vector3();
  readonly up = new Vector3();
}

export interface SurfaceBand {
  fromS: number;
  toS: number;
  centre?: string;
  shoulder?: string;
}

export interface BarrierBand {
  fromS: number;
  toS: number;
  left: boolean;
  right: boolean;
}

export interface StartGrid {
  s: number;
  columns: number;
  rowGap: number;
  columnGap: number;
}

export interface SkyPreset {
  name: string;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  sunColor: number[];
  sunIntensity: number;
  zenith: number[];
  horizon: number[];
  belowHorizon: number[];
  glowWide: number;
  glowStrength: number;
  fogDensity: number;
  ambientIntensity: number;
  exposure: number;
  sunDisc: number;
}

export interface Brush {
  at: number[];
  size: number[];
  material: string;
  surface?: string;
}

export interface LevelDoc {
  fogColor: number[];
  fogDensity: number;
  materials: Record<string, { baseColor: number[]; roughness?: number }>;
  brushes: Brush[];
  lights: { type: string; direction: number[]; color: number[]; intensity: number }[];
}

const covers = (band: { fromS: number; toS: number }, s: number): boolean =>
  band.fromS <= band.toS ? s >= band.fromS && s < band.toS : s >= band.fromS || s < band.toS;

export class TrackSpline {
  readonly centre: CatmullRom;
  readonly shoulder: number;
  readonly checkpoints: number[];
  readonly grid: StartGrid;
  private readonly widths: number[];
  private readonly banks: number[];
  private readonly surfaces: SurfaceBand[];
  private readonly barriers: BarrierBand[];
  private readonly pointDistances: number[];
  private readonly scratch = new TrackFrame();

  constructor(opts: {
    centre: CatmullRom;
    widths: number[];
    banks: number[];
    shoulder: number;
    surfaces: SurfaceBand[];
    barriers: BarrierBand[];
    checkpoints: number[];
    grid: StartGrid;
  }) {
    this.centre = opts.centre;
    this.widths = opts.widths;
    this.banks = opts.banks;
    this.shoulder = opts.shoulder;
    this.surfaces = opts.surfaces;
    this.barriers = opts.barriers;
    this.checkpoints = opts.checkpoints;
    this.grid = opts.grid;
    this.pointDistances = opts.widths.map((_, i) => this.centre.distanceToPoint(i));
  }

  get length(): number {
    return this.centre.length;
  }

  widthAt(s: number): number {
    return this.betweenPoints(this.widths, s);
  }

  bankAt(s: number): number {
    return this.betweenPoints(this.banks, s);
  }

  frameAt(s: number, out: TrackFrame): TrackFrame {
    this.centre.sampleAt(s, out.position);
    this.centre.tangentAt(s, out.forward);
    const f = out.forward;
    // right = worldUp × forward
    let rx = f.z;
    let rz = -f.x;
    const flat = Math.hypot(rx, rz);
    if (flat < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= flat;
      rz /= flat;
    }
    // up = forward × right
    const ux = f.y * rz;
    const uy = f.z * rx - f.x * rz;
    const uz = -f.y * rx;
    const bank = this.bankAt(s);
    if (bank === 0) {
      out.right.set(rx, 0, rz);
      out.up.set(ux, uy, uz);
      return out;
    }
    // 绕行驶方向转一个侧倾角，路面仍是平的带子
    const c = Math.cos(bank);
    const sn = Math.sin(bank);
    out.right.set(rx * c + ux * sn, uy * sn, rz * c + uz * sn);
    out.up.set(ux * c - rx * sn, uy * c, uz * c - rz * sn);
    return out;
  }

  centreAt(s: number, out: Vector3): Vector3 {
    return this.centre.sampleAt(s, out);
  }

  surfaceAt(s: number, lateral: number): string | undefined {
    const wrapped = this.centre.wrap(s);
    const onRoad = Math.abs(lateral) <= this.widthAt(wrapped) / 2;
    for (const band of this.surfaces) {
      if (covers(band, wrapped)) return onRoad ? band.centre : band.shoulder;
    }
    return undefined;
  }

  barrierAt(s: number, left: boolean): boolean {
    const wrapped = this.centre.wrap(s);
    for (const band of this.barriers) {
      if (!covers(band, wrapped)) continue;
      if (left ? band.left : band.right) return true;
    }
    return false;
  }

  startSlot(index: number, outPosition: Vector3, outForward: Vector3): void {
    const g = this.grid;
    const row = Math.floor(index / g.columns);
    const column = index % g.columns;
    const lateral = (column - (g.columns - 1) / 2) * g.columnGap;
    const fr = this.frameAt(g.s - row * g.rowGap, this.scratch);
    outPosition.copy(fr.position).addScaledVector(fr.right, lateral);
    outForward.copy(fr.forward);
  }

  private betweenPoints(values: number[], s: number): number {
    const wrapped = this.centre.wrap(s);
    const d = this.pointDistances;
    let low = 0;
    let high = d.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (d[middle] <= wrapped) low = middle;
      else high = middle - 1;
    }
    const last = low === d.length - 1;
    const fromS = d[low];
    const toS = last ? this.centre.length : d[low + 1];
    const next = last ? 0 : low + 1;
    const span = toS - fromS;
    if (span <= 1e-9) return values[low];
    const t = Math.min(1, Math.max(0, (wrapped - fromS) / span));
    // smoothstep：宽度和侧倾的斜率在控制点处也连续，路边不会出折痕
    const blend = t * t * (3 - 2 * t);
    return values[low] + (values[next] - values[low]) * blend;
  }
}

const DEG = Math.PI / 180;

export interface TrackDocument {
  name: string;
  track: TrackSpline;
  sky: SkyPreset;
  level: LevelDoc;
}

type Json = Record<string, any>;

export function readTrack(trackJson: Json, levelJson: Json): TrackDocument {
  const t = trackJson.track as Json;
  const points = t.points as Json[];
  const centre = new CatmullRom(points.map((p) => new Vector3(p.at[0], p.at[1], p.at[2])));
  const track = new TrackSpline({
    centre,
    widths: points.map((p) => p.width ?? 12),
    banks: points.map((p) => (p.bank ?? 0) * DEG),
    shoulder: t.shoulder ?? 4,
    surfaces: ((t.surfaces ?? []) as Json[]).map((b) => ({
      fromS: b.fromS ?? 0,
      toS: b.toS ?? centre.length,
      centre: b.centre,
      shoulder: b.shoulder,
    })),
    barriers: ((t.barriers ?? []) as Json[]).map((b) => ({
      fromS: b.fromS ?? 0,
      toS: b.toS ?? centre.length,
      left: !!b.left,
      right: !!b.right,
    })),
    checkpoints: ((t.checkpoints ?? []) as Json[]).map((c) => c.s ?? 0),
    grid: {
      s: t.grid?.s ?? -12,
      columns: t.grid?.columns ?? 2,
      rowGap: t.grid?.rowGap ?? 6,
      columnGap: t.grid?.columnGap ?? 3.5,
    },
  });
  return {
    name: trackJson.name,
    track,
    sky: trackJson.sky as SkyPreset,
    level: levelJson as LevelDoc,
  };
}
