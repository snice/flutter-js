// 闭合的 Catmull-Rom 中心线，按弧长取样。
//
// 照搬 flutter3d_sim 的 CatmullRom：tension 0.5 的 Hermite 形式，每段 16 个
// 采样点建一张「采样序号 → 累计弧长」表，s 与参数 u 之间靠这张表二分互换。
// 赛道的宽度、侧倾、检查点、发车格全都以 s（米）为坐标，所以这一层必须和原版
// 一致，赛道文件才能原样使用。
import { Vector3 } from 'three';

const SAMPLES_PER_SEGMENT = 16;
const TENSION = 0.5;
const DIVISOR = 1e-9;

export class CatmullRom {
  readonly points: Vector3[];
  readonly length: number;
  private readonly samples: Float64Array;
  private readonly distances: Float64Array;

  constructor(points: Vector3[]) {
    if (points.length < 3) throw new Error('a closed curve needs at least three points');
    this.points = points.map((p) => p.clone());
    const count = this.sampleCount;
    this.samples = new Float64Array(count * 3);
    this.distances = new Float64Array(count);
    const p = new Vector3();
    let total = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i < count; i++) {
      this.evaluate(i / SAMPLES_PER_SEGMENT, p);
      if (i > 0) total += Math.hypot(p.x - px, p.y - py, p.z - pz);
      this.distances[i] = total;
      this.samples[i * 3] = p.x;
      this.samples[i * 3 + 1] = p.y;
      this.samples[i * 3 + 2] = p.z;
      px = p.x;
      py = p.y;
      pz = p.z;
    }
    this.length = total;
  }

  get segmentCount(): number {
    return this.points.length;
  }

  get pointCount(): number {
    return this.points.length;
  }

  private get sampleCount(): number {
    return this.segmentCount * SAMPLES_PER_SEGMENT + 1;
  }

  distanceToPoint(index: number): number {
    const wrapped = ((index % this.points.length) + this.points.length) % this.points.length;
    return this.distances[wrapped * SAMPLES_PER_SEGMENT];
  }

  wrap(s: number): number {
    if (this.length <= 0) return 0;
    const r = s % this.length;
    return r < 0 ? r + this.length : r;
  }

  sampleAt(s: number, out: Vector3): Vector3 {
    this.evaluate(this.toU(s), out);
    return out;
  }

  tangentAt(s: number, out: Vector3): Vector3 {
    const u = this.toU(s);
    this.derivative(u, out);
    let scale = out.length();
    if (scale < DIVISOR) {
      this.derivative(u + 1e-4, out);
      scale = out.length();
      if (scale < DIVISOR) return out.set(0, 0, 1);
    }
    return out.multiplyScalar(1 / scale);
  }

  curvatureAt(s: number): number {
    const u = this.toU(s);
    const a = this.derivative(u, _first);
    const b = this.secondDerivative(u, _second);
    const speed = a.length();
    if (speed < DIVISOR) return 0;
    const cx = a.y * b.z - a.z * b.y;
    const cy = a.z * b.x - a.x * b.z;
    const cz = a.x * b.y - a.y * b.x;
    return Math.sqrt(cx * cx + cy * cy + cz * cz) / (speed * speed * speed);
  }

  /** 离 point 最近的 s，只在 nearS 前后 window 米内找——车每步只挪几十厘米，
   * 窗口足够，也避免立交处跳到另一层路面上。 */
  closestS(point: Vector3, nearS: number, window = 30): number {
    if (this.length <= 0) return 0;
    if (window * 2 >= this.length) return this.refine(point, this.nearestSampleIn(point, 0, this.sampleCount - 1));
    const from = Math.floor(this.toU(nearS - window) * SAMPLES_PER_SEGMENT);
    let to = Math.ceil(this.toU(nearS + window) * SAMPLES_PER_SEGMENT);
    if (to < from) to += this.sampleCount - 1;
    return this.refine(point, this.nearestSampleIn(point, from, to));
  }

  private toU(s: number): number {
    if (this.length <= 0) return 0;
    const target = this.wrap(s);
    const d = this.distances;
    let low = 0;
    let high = d.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (d[middle] <= target) low = middle;
      else high = middle - 1;
    }
    if (low >= d.length - 1) return this.segmentCount;
    const span = d[low + 1] - d[low];
    const fraction = span > 1e-12 ? (target - d[low]) / span : 0;
    return (low + fraction) / SAMPLES_PER_SEGMENT;
  }

  private toS(u: number): number {
    const scaled = this.wrapU(u) * SAMPLES_PER_SEGMENT;
    const index = Math.floor(scaled);
    const d = this.distances;
    if (index >= d.length - 1) return this.length;
    if (index < 0) return 0;
    return d[index] + (d[index + 1] - d[index]) * (scaled - index);
  }

  private wrapU(u: number): number {
    const n = this.segmentCount;
    const r = u % n;
    return r < 0 ? r + n : r;
  }

  private nearestSampleIn(point: Vector3, from: number, to: number): number {
    let bestIndex = from;
    let best = Infinity;
    const period = this.sampleCount - 1;
    const s = this.samples;
    for (let i = from; i <= to; i++) {
      const index = ((i % period) + period) % period;
      const dx = s[index * 3] - point.x;
      const dy = s[index * 3 + 1] - point.y;
      const dz = s[index * 3 + 2] - point.z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < best) {
        best = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  private refine(point: Vector3, sampleIndex: number): number {
    const centre = sampleIndex / SAMPLES_PER_SEGMENT;
    const step = 1 / SAMPLES_PER_SEGMENT;
    let low = centre - step;
    let high = centre + step;
    for (let i = 0; i < 20; i++) {
      const third = (high - low) / 3;
      const a = low + third;
      const b = high - third;
      if (this.distanceSquaredAtU(a, point) <= this.distanceSquaredAtU(b, point)) high = b;
      else low = a;
    }
    return this.toS((low + high) / 2);
  }

  private distanceSquaredAtU(u: number, point: Vector3): number {
    this.evaluate(u, _probe);
    return _probe.distanceToSquared(point);
  }

  private segmentAt(u: number): [number, number] {
    const wrapped = this.wrapU(u);
    let index = Math.floor(wrapped);
    if (index >= this.segmentCount) index = this.segmentCount - 1;
    if (index < 0) index = 0;
    return [index, wrapped - index];
  }

  private control(index: number): Vector3 {
    const n = this.points.length;
    return this.points[((index % n) + n) % n];
  }

  private hermite(u: number, out: Vector3, h00: number, h10: number, h01: number, h11: number, index: number): Vector3 {
    const p0 = this.control(index - 1);
    const p1 = this.control(index);
    const p2 = this.control(index + 1);
    const p3 = this.control(index + 2);
    const k = TENSION;
    return out.set(
      h00 * p1.x + h10 * k * (p2.x - p0.x) + h01 * p2.x + h11 * k * (p3.x - p1.x),
      h00 * p1.y + h10 * k * (p2.y - p0.y) + h01 * p2.y + h11 * k * (p3.y - p1.y),
      h00 * p1.z + h10 * k * (p2.z - p0.z) + h01 * p2.z + h11 * k * (p3.z - p1.z),
    );
  }

  private evaluate(u: number, out: Vector3): Vector3 {
    const [index, t] = this.segmentAt(u);
    const t2 = t * t;
    const t3 = t2 * t;
    return this.hermite(u, out, 2 * t3 - 3 * t2 + 1, t3 - 2 * t2 + t, -2 * t3 + 3 * t2, t3 - t2, index);
  }

  private derivative(u: number, out: Vector3): Vector3 {
    const [index, t] = this.segmentAt(u);
    const t2 = t * t;
    return this.hermite(u, out, 6 * t2 - 6 * t, 3 * t2 - 4 * t + 1, -6 * t2 + 6 * t, 3 * t2 - 2 * t, index);
  }

  private secondDerivative(u: number, out: Vector3): Vector3 {
    const [index, t] = this.segmentAt(u);
    return this.hermite(u, out, 12 * t - 6, 6 * t - 4, -12 * t + 6, 6 * t - 2, index);
  }
}

const _first = new Vector3();
const _second = new Vector3();
const _probe = new Vector3();
