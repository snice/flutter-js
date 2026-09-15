// 车：一个悬在路面上方的球，加一套 Pacejka 形状的轮胎曲线。
//
// 移植自 flutter3d_game_racing 的 SphereVehicle / TireModel / Tyres /
// TrackField。车身在物理上就是一个半径 0.7 的球，离路面 rideHeight 悬着；
// 路面高度和法线来自赛道样条（路面和路肩范围内），出了路肩就往下打射线找场景
// 里的方块。轮胎力 = 纵向滑移率 / 侧向滑移角 过曲线，再夹进摩擦圆。
import { Box3, Vector3 } from 'three';
import type { Brush, TrackSpline } from './track';
import { TrackFrame } from './track';

// ── 小工具 ───────────────────────────────────────────────────────────────

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const approach = (from: number, to: number, step: number): number =>
  from < to ? Math.min(from + step, to) : Math.max(from - step, to);
export const easeFactor = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ── 场景碰撞：关卡里的方块 ─────────────────────────────────────────────────

export class World {
  /** 所有方块（射线找地面用）。 */
  readonly boxes: { box: Box3; surface?: string }[];
  /** 会挡车的方块：带 surface 的是地面大平台，只当地面，不参与侧向碰撞。 */
  readonly solids: Box3[];

  constructor(brushes: Brush[]) {
    this.boxes = brushes.map((b) => {
      const half = new Vector3(b.size[0] / 2, b.size[1] / 2, b.size[2] / 2);
      const c = new Vector3(b.at[0], b.at[1], b.at[2]);
      return { box: new Box3(c.clone().sub(half), c.clone().add(half)), surface: b.surface };
    });
    this.solids = this.boxes.filter((b) => !b.surface).map((b) => b.box);
  }

  /** 从 (x, fromY, z) 往下找最高的顶面。 */
  groundBelow(x: number, fromY: number, z: number, maxDrop: number, out: { height: number; surface?: string }): boolean {
    let found = false;
    let best = -Infinity;
    for (const { box, surface } of this.boxes) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      const top = box.max.y;
      if (top > fromY || top < fromY - maxDrop) continue;
      if (top > best) {
        best = top;
        out.surface = surface ?? 'stone';
        found = true;
      }
    }
    if (found) out.height = best;
    return found;
  }
}

// ── 轮胎 ─────────────────────────────────────────────────────────────────

export class TireModel {
  readonly lateralShape: number;
  readonly longitudinalShape: number;
  readonly lateralStiffness: number;
  readonly longitudinalStiffness: number;

  constructor(peakSlipAngle = 0.16, lateralTail = 0.72, peakSlipRatio = 0.14, longitudinalTail = 0.82) {
    this.lateralShape = TireModel.shapeFor(lateralTail);
    this.longitudinalShape = TireModel.shapeFor(longitudinalTail);
    this.lateralStiffness = TireModel.stiffnessFor(this.lateralShape, peakSlipAngle);
    this.longitudinalStiffness = TireModel.stiffnessFor(this.longitudinalShape, peakSlipRatio);
  }

  lateralAt(slipAngle: number): number {
    return Math.sin(this.lateralShape * Math.atan(this.lateralStiffness * slipAngle));
  }

  longitudinalAt(slipRatio: number): number {
    return Math.sin(this.longitudinalShape * Math.atan(this.longitudinalStiffness * slipRatio));
  }

  private static shapeFor(tail: number): number {
    return 2 - (2 * Math.asin(clamp(tail, 0.05, 0.999))) / Math.PI;
  }

  private static stiffnessFor(shape: number, peak: number): number {
    if (peak <= 1e-6) return 1e6;
    return Math.tan(Math.PI / (2 * shape)) / peak;
  }
}

export interface Tyres {
  name: string;
  label: string;
  model: TireModel;
  grips: Record<string, number>;
  limit: number;
}

export const TYRES: Tyres[] = [
  {
    name: 'road',
    label: '公路胎',
    model: new TireModel(),
    limit: 1.05,
    grips: { asphalt: 1, concrete: 0.95, kerb: 0.85, dirt: 0.65, gravel: 0.55, grass: 0.45, sand: 0.4, wet: 0.7, ice: 0.22 },
  },
  {
    name: 'slicks',
    label: '光头胎',
    model: new TireModel(0.12, 0.58, 0.11, 0.7),
    limit: 1.24,
    grips: { asphalt: 1, concrete: 0.95, kerb: 0.8, dirt: 0.34, gravel: 0.26, grass: 0.2, sand: 0.16, wet: 0.44, ice: 0.12 },
  },
  {
    name: 'rally',
    label: '拉力胎',
    model: new TireModel(0.21, 0.86, 0.18, 0.9),
    limit: 0.92,
    grips: { asphalt: 1, concrete: 1, kerb: 0.95, dirt: 0.92, gravel: 0.88, grass: 0.82, sand: 0.7, wet: 0.85, ice: 0.3 },
  },
];

// ── 调校 ─────────────────────────────────────────────────────────────────

export const TUNING = {
  radius: 0.7,
  rideHeight: 0.55,
  maxSpeed: 52,
  maxReverse: 12,
  enginePush: 14,
  brakeStrength: 26,
  rollingDrag: 3,
  rollingResistance: 0.9,
  holdSpeed: 0.7,
  holdSlope: 1.2,
  airDrag: 0.0006,
  slipstream: 0.34,
  maxSteer: 0.62,
  steerFalloff: 26,
  wheelBase: 2.7,
  gravity: 20,
  impactShrugged: 6,
  impactCost: 0.017,
  powerLostWhenWrecked: 0.45,
  speedLostWhenWrecked: 0.25,
  groundStick: 0.45,
  suspensionRate: 18,
  slideAlignment: 2.2,
  wheelInertia: 0.25,
};

export class VehicleInput {
  throttle = 0;
  brake = 0;
  /** +1 向右打满。 */
  steer = 0;
  handbrake = false;
  /** 前车尾流的遮挡程度 0..1，模拟那边每步写入。 */
  shelter = 0;

  reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = false;
    this.shelter = 0;
  }
}

// ── 地面采样 ─────────────────────────────────────────────────────────────

export class GroundSample {
  s = 0;
  lateral = 0;
  height = 0;
  readonly normal = new Vector3(0, 1, 0);
  surface: string | undefined;
  onRoad = false;
  barrier = false;
  halfWidth = 0;
  readonly lateralAxis = new Vector3(1, 0, 0);
}

export class TrackField {
  private readonly frame = new TrackFrame();
  private readonly toCar = new Vector3();
  private readonly probe: { height: number; surface?: string } = { height: 0 };

  constructor(
    readonly track: TrackSpline,
    readonly world: World,
  ) {}

  sample(position: Vector3, nearHint: number, out: GroundSample): boolean {
    const track = this.track;
    const s = track.centre.closestS(position, nearHint, 30);
    const fr = track.frameAt(s, this.frame);
    const lateral = this.toCar.copy(position).sub(fr.position).dot(fr.right);
    const halfWidth = track.widthAt(s) / 2;
    out.s = s;
    out.lateral = lateral;
    if (Math.abs(lateral) <= halfWidth + track.shoulder) {
      out.height = fr.position.y + fr.right.y * lateral;
      out.onRoad = Math.abs(lateral) <= halfWidth;
      out.surface = track.surfaceAt(s, lateral);
      out.barrier = track.barrierAt(s, lateral < 0);
      out.halfWidth = halfWidth;
      out.normal.copy(fr.up);
      out.lateralAxis.copy(fr.right);
      return true;
    }
    out.onRoad = false;
    out.barrier = false;
    out.halfWidth = 0;
    out.lateralAxis.copy(fr.right);
    if (!this.world.groundBelow(position.x, position.y + 3, position.z, 63, this.probe)) {
      out.surface = undefined;
      return false;
    }
    out.height = this.probe.height;
    out.normal.set(0, 1, 0);
    out.surface = this.probe.surface;
    return true;
  }
}

// ── 车 ───────────────────────────────────────────────────────────────────

export class SphereVehicle {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  headingYaw: number;
  tyres: Tyres = TYRES[0];
  damage = 0;
  slipAngle = 0;
  slipRatio = 0;
  grounded = false;
  wheelSpeed = 0;
  /** 本步撞墙 / 蹭护栏的速度，给音效和镜头抖动用。 */
  struck = 0;
  scraped = 0;

  readonly ground = new GroundSample();
  readonly forward = new Vector3(0, 0, 1);
  readonly right = new Vector3(1, 0, 0);
  readonly up = new Vector3(0, 1, 0);
  private readonly normal = new Vector3(0, 1, 0);
  private readonly gravityVec = new Vector3();
  private readonly force = { x: 0, y: 0 };
  private underPower = false;
  private coasting = true;

  constructor(
    readonly field: TrackField,
    readonly world: World,
    position: Vector3,
    headingYaw: number,
  ) {
    this.position.copy(position);
    this.headingYaw = headingYaw;
  }

  get speed(): number {
    return this.velocity.length();
  }

  get rpm(): number {
    return clamp(Math.abs(this.wheelSpeed) / TUNING.maxSpeed, 0, 1);
  }

  get trackDistance(): number {
    return this.ground.s;
  }

  get impact(): number {
    return Math.max(this.struck, this.scraped);
  }

  placeAt(position: Vector3, headingYaw: number, trackDistance?: number): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.headingYaw = headingYaw;
    this.wheelSpeed = 0;
    this.slipAngle = 0;
    this.slipRatio = 0;
    this.grounded = false;
    if (trackDistance !== undefined) this.ground.s = trackDistance;
    this.buildFrame();
  }

  /** 换胎（顺带修车）：只有停稳了才换。 */
  pitStop(next: Tyres): boolean {
    if (this.speed > 0.5) return false;
    this.tyres = next;
    this.damage = 0;
    return true;
  }

  step(dt: number, input: VehicleInput): void {
    this.scraped = 0;
    this.struck = 0;
    const found = this.field.sample(this.position, this.ground.s, this.ground);
    this.readGround(found);
    this.buildFrame();
    const limit = this.gripLimit();
    if (this.grounded) this.steer(dt, input);
    this.drive(dt, input);
    const forwardSpeed = this.velocity.dot(this.forward);
    const lateralSpeed = this.velocity.dot(this.right);
    this.measureSlip(forwardSpeed, lateralSpeed);
    if (this.grounded) this.applyTires(dt, limit);
    this.applyGravityAndDrag(dt, input);
    this.rollAndHold(dt);
    this.move(dt);
    this.holdInsideBarrier();
    this.settle(dt, found);
  }

  private readGround(found: boolean): void {
    if (!found) {
      this.grounded = false;
      return;
    }
    this.grounded = this.position.y <= this.ground.height + TUNING.rideHeight + TUNING.groundStick;
  }

  private buildFrame(): void {
    if (this.grounded) this.normal.copy(this.ground.normal);
    else this.normal.set(0, 1, 0);
    const sin = Math.sin(this.headingYaw);
    const cos = Math.cos(this.headingYaw);
    const f = this.forward.set(sin, 0, cos);
    f.addScaledVector(this.normal, -f.dot(this.normal));
    const len = f.length();
    if (len < 1e-6) f.set(sin, 0, cos);
    else f.multiplyScalar(1 / len);
    this.right.crossVectors(this.normal, f);
    const rl = this.right.length();
    if (rl > 1e-6) this.right.multiplyScalar(1 / rl);
    this.up.crossVectors(f, this.right);
  }

  private gripLimit(): number {
    const grip = this.tyres.grips[this.ground.surface ?? ''] ?? 1;
    const lean = clamp(this.normal.y, 0.2, 1);
    return grip * this.tyres.limit * TUNING.gravity * lean;
  }

  private slideStrength(): number {
    return clamp(this.speed / 8, 0, 1);
  }

  private steer(dt: number, input: VehicleInput): void {
    const forwardSpeed = this.velocity.dot(this.forward);
    const authority = TUNING.steerFalloff / (TUNING.steerFalloff + this.speed);
    const angle = -TUNING.maxSteer * clamp(input.steer, -1, 1) * authority;
    let yawRate = (forwardSpeed / TUNING.wheelBase) * Math.tan(angle);
    yawRate += this.slipAngle * TUNING.slideAlignment * this.slideStrength();
    this.headingYaw += yawRate * dt;
  }

  private drive(dt: number, input: VehicleInput): void {
    const forwardSpeed = this.velocity.dot(this.forward);
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    this.underPower = !input.handbrake && brake <= 0 && throttle > 0;
    this.coasting = !input.handbrake && brake <= 0 && throttle <= 0;
    if (input.handbrake) {
      this.wheelSpeed = approach(this.wheelSpeed, 0, TUNING.brakeStrength * 2 * dt);
      return;
    }
    if (brake > 0) {
      const target = forwardSpeed > 0.5 ? 0 : -TUNING.maxReverse;
      this.wheelSpeed = approach(this.wheelSpeed, target, TUNING.brakeStrength * brake * dt);
      return;
    }
    if (throttle > 0) {
      this.wheelSpeed += TUNING.enginePush * (1 - this.damage * TUNING.powerLostWhenWrecked) * throttle * dt;
      this.wheelSpeed = clamp(
        this.wheelSpeed,
        -TUNING.maxReverse,
        TUNING.maxSpeed * (1 - this.damage * TUNING.speedLostWhenWrecked),
      );
      return;
    }
    this.wheelSpeed = approach(this.wheelSpeed, forwardSpeed, TUNING.rollingDrag * dt);
  }

  private measureSlip(forwardSpeed: number, lateralSpeed: number): void {
    this.slipAngle = Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 1.5));
    this.slipRatio = clamp((this.wheelSpeed - forwardSpeed) / Math.max(Math.abs(forwardSpeed), 3), -1, 1);
  }

  private applyTires(dt: number, limit: number): void {
    const model = this.tyres.model;
    const f = this.force;
    f.x = model.longitudinalAt(this.slipRatio) * limit;
    f.y = -model.lateralAt(this.slipAngle) * limit;
    const magnitude = Math.hypot(f.x, f.y);
    if (magnitude > limit && magnitude > 1e-9) {
      f.x *= limit / magnitude;
      f.y *= limit / magnitude;
    }
    this.velocity.addScaledVector(this.forward, f.x * dt).addScaledVector(this.right, f.y * dt);
    this.wheelSpeed -= f.x * TUNING.wheelInertia * dt;
    const leaving = this.velocity.dot(this.forward);
    if (this.underPower && this.wheelSpeed < leaving) this.wheelSpeed = leaving;
  }

  private rollAndHold(dt: number): void {
    if (!this.grounded || !this.coasting) return;
    const along = this.velocity.dot(this.forward);
    const slope = Math.abs(this.gravityVec.dot(this.forward));
    if (Math.abs(along) <= TUNING.holdSpeed && slope <= TUNING.holdSlope) {
      this.velocity.addScaledVector(this.forward, -along);
      this.wheelSpeed = 0;
      return;
    }
    const drop = Math.min(TUNING.rollingResistance * dt, Math.abs(along));
    this.velocity.addScaledVector(this.forward, along > 0 ? -drop : drop);
    this.wheelSpeed = approach(this.wheelSpeed, this.velocity.dot(this.forward), TUNING.rollingDrag * dt);
  }

  private applyGravityAndDrag(dt: number, input: VehicleInput): void {
    if (this.grounded) {
      const g = this.gravityVec.set(0, -TUNING.gravity, 0);
      g.addScaledVector(this.normal, -g.dot(this.normal));
      this.velocity.addScaledVector(g, dt);
      const into = this.velocity.dot(this.normal);
      if (into < 0) this.velocity.addScaledVector(this.normal, -into);
    } else {
      this.velocity.y -= TUNING.gravity * dt;
    }
    const speed = this.speed;
    if (speed > 0) {
      const drag = TUNING.airDrag * (1 - input.shelter * TUNING.slipstream);
      this.velocity.addScaledVector(this.velocity, -drag * speed * dt);
    }
  }

  /** 位移 + 石柱碰撞。原版是球体扫掠；这里的障碍只有 4m 见方的柱子，单步最多
   * 走 0.9m，直接挪过去再把穿进去的部分推出来就够了。 */
  private move(dt: number): void {
    this.position.addScaledVector(this.velocity, dt);
    const r = TUNING.radius;
    for (const box of this.world.solids) {
      const p = this.position;
      if (p.x < box.min.x - r || p.x > box.max.x + r || p.z < box.min.z - r || p.z > box.max.z + r) continue;
      if (p.y < box.min.y - r || p.y > box.max.y + r) continue;
      box.clampPoint(p, _closest);
      _normal.copy(p).sub(_closest);
      let dist = _normal.length();
      if (dist >= r) continue;
      if (dist < 1e-6) {
        _normal.set(p.x - (box.min.x + box.max.x) / 2, 0, p.z - (box.min.z + box.max.z) / 2).normalize();
        dist = 0;
      } else {
        _normal.multiplyScalar(1 / dist);
      }
      p.addScaledVector(_normal, r - dist);
      const speedInto = this.velocity.dot(_normal);
      if (speedInto < 0) {
        this.velocity.addScaledVector(_normal, -speedInto);
        this.struck = Math.max(this.struck, -speedInto);
        this.hurt(-speedInto);
      }
    }
  }

  private hurt(speed: number): void {
    const past = speed - TUNING.impactShrugged;
    if (past <= 0) return;
    this.damage = clamp(this.damage + past * TUNING.impactCost, 0, 1);
  }

  private holdInsideBarrier(): void {
    const g = this.ground;
    if (!g.barrier || g.halfWidth <= 0) return;
    const over = Math.abs(g.lateral) - g.halfWidth;
    if (over <= 0) return;
    const inward = g.lateral > 0 ? -1 : 1;
    this.position.addScaledVector(g.lateralAxis, over * inward);
    g.lateral += over * inward;
    const into = this.velocity.dot(g.lateralAxis) * -inward;
    if (into > 0) {
      this.scraped = into;
      this.velocity.addScaledVector(g.lateralAxis, into * inward);
      this.hurt(into);
    }
  }

  private settle(dt: number, found: boolean): void {
    if (!found || !this.grounded) return;
    const target = this.ground.height + TUNING.rideHeight;
    this.position.y += (target - this.position.y) * easeFactor(TUNING.suspensionRate, dt);
  }
}

const _closest = new Vector3();
const _normal = new Vector3();
