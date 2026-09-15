// 比赛：发车倒计时、圈数 / 检查点 / 名次、车与车的碰撞、尾流、掉出赛道复位，
// 以及对手的 AI 和追尾镜头。
//
// 移植自 flutter3d_game_racing 的 RacingSimulation / RaceState / AiDriver /
// ChaseCamera，数值与原版一致。
import { Vector3 } from 'three';
import { TrackFrame, type TrackSpline } from './track';
import { clamp, easeFactor, shortestAngle, SphereVehicle, TrackField, TUNING, VehicleInput, type World } from './vehicle';

export const FIELD_SIZE = 4;
export const LAPS = 3;
const COUNTDOWN = 3;

export type RacePhase = 'countdown' | 'running' | 'finished';

export type RaceEvent =
  | { type: 'tick'; count: number }
  | { type: 'go' }
  | { type: 'checkpoint'; racer: number }
  | { type: 'lap'; racer: number; time: number }
  | { type: 'best'; racer: number; time: number }
  | { type: 'finish'; racer: number; place: number }
  | { type: 'raceOver' }
  | { type: 'respawn'; racer: number }
  | { type: 'wrongWay'; racer: number }
  | { type: 'drift'; racer: number; score: number };

export class RacerProgress {
  s = 0;
  lap = 0;
  nextCheckpoint = 0;
  wrongWay = false;
  offRoad = false;
  lateral = 0;
  lapTime = 0;
  bestLap: number | null = null;
  lastLap = 0;
  totalTime = 0;
  finishedAt: number | null = null;
  driftFor = 0;
  driftScore = 0;

  get finished(): boolean {
    return this.finishedAt !== null;
  }

  progressAlong(lapLength: number): number {
    return this.lap * lapLength + this.s;
  }
}

const DRIFT_ANGLE = 0.14;
const DRIFT_SPEED = 8;
const DRIFT_MINIMUM = 0.5;
const SLIPSTREAM_REACH = 40;
const SLIPSTREAM_WIDTH = 3;
const KILL_PLANE = -50;
const OFF_ROAD_PATIENCE = 4;
const CONTACT_RESTITUTION = 0.35;
/** 玩家起步打滑时收一点油（原版 Difficulty.normal 的牵引力辅助）。 */
const ASSISTANCE = 0.5;

export class RacingSimulation {
  readonly cars: SphereVehicle[] = [];
  readonly inputs: VehicleInput[] = [];
  readonly progress: RacerProgress[] = [];
  readonly events: RaceEvent[] = [];
  readonly field: TrackField;
  phase: RacePhase = 'countdown';
  countdown = COUNTDOWN;
  elapsed = 0;

  private readonly previousS: number[] = [];
  private readonly backwards: number[] = [];
  private readonly offRoadFor: number[] = [];
  private readonly held = new VehicleInput();
  private readonly frame = new TrackFrame();
  private readonly offset = new Vector3();
  private readonly between = new Vector3();

  constructor(
    readonly track: TrackSpline,
    world: World,
    count = FIELD_SIZE,
  ) {
    this.field = new TrackField(track, world);
    const position = new Vector3();
    const forward = new Vector3();
    for (let i = 0; i < count; i++) {
      track.startSlot(i, position, forward);
      const car = new SphereVehicle(this.field, world, position.clone().setY(position.y + 0.6), Math.atan2(forward.x, forward.z));
      car.placeAt(car.position, car.headingYaw, track.centre.wrap(track.grid.s));
      this.cars.push(car);
      this.inputs.push(new VehicleInput());
      const p = new RacerProgress();
      p.s = car.trackDistance;
      this.progress.push(p);
      this.previousS.push(car.trackDistance);
      this.backwards.push(0);
      this.offRoadFor.push(0);
    }
  }

  positionOf(racer: number): number {
    const mine = this.progress[racer];
    let ahead = 0;
    for (const other of this.progress) {
      if (other === mine) continue;
      if (this.isAhead(other, mine)) ahead++;
    }
    return ahead + 1;
  }

  private isAhead(other: RacerProgress, mine: RacerProgress): boolean {
    if (other.finished && mine.finished) return other.finishedAt! < mine.finishedAt!;
    if (other.finished !== mine.finished) return other.finished;
    const L = this.track.length;
    return other.progressAlong(L) > mine.progressAlong(L);
  }

  step(dt: number): void {
    if (this.phase === 'finished') return;
    const racing = this.runLights(dt);
    this.elapsed += dt;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      this.readDrift(i, car, dt);
      this.inputs[i].shelter = this.shelterFor(i);
      if (i === 0) this.assist(this.inputs[i], car);
      car.step(dt, racing ? this.inputs[i] : this.revvingOnly(this.inputs[i]));
      if (!racing) car.velocity.set(0, 0, 0);
    }
    this.separateCars();
    for (let i = 0; i < this.cars.length; i++) this.readProgress(i, dt, racing);
    for (let i = 0; i < this.cars.length; i++) this.recover(i, dt);
  }

  private runLights(dt: number): boolean {
    if (this.phase !== 'countdown') return true;
    const before = Math.ceil(this.countdown);
    this.countdown -= dt;
    const after = Math.ceil(this.countdown);
    if (after !== before && after > 0) this.events.push({ type: 'tick', count: after });
    if (this.countdown > 0) return false;
    this.countdown = 0;
    this.phase = 'running';
    this.events.push({ type: 'go' });
    return true;
  }

  private revvingOnly(asked: VehicleInput): VehicleInput {
    this.held.reset();
    this.held.throttle = asked.throttle;
    return this.held;
  }

  private assist(input: VehicleInput, car: SphereVehicle): void {
    if (input.throttle <= 0) return;
    if (Math.abs(car.slipAngle) >= DRIFT_ANGLE) return;
    const spinning = clamp((car.slipRatio - 0.05) / 0.05, 0, 1);
    if (spinning <= 0) return;
    input.throttle *= 1 - ASSISTANCE * spinning;
  }

  private separateCars(): void {
    const cars = this.cars;
    const r = TUNING.radius;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const between = this.between.copy(b.position).sub(a.position);
        const distance = between.length();
        const overlap = r * 2 - distance;
        if (overlap <= 0) continue;
        if (distance < 1e-6) between.set(1, 0, 0);
        else between.multiplyScalar(1 / distance);
        a.position.addScaledVector(between, -overlap / 2);
        b.position.addScaledVector(between, overlap / 2);
        const closing = b.velocity.dot(between) - a.velocity.dot(between);
        if (closing >= 0) continue;
        const exchange = (-closing * (1 + CONTACT_RESTITUTION)) / 2;
        a.velocity.addScaledVector(between, -exchange);
        b.velocity.addScaledVector(between, exchange);
        a.struck = Math.max(a.struck, -closing);
        b.struck = Math.max(b.struck, -closing);
      }
    }
  }

  private readDrift(index: number, car: SphereVehicle, dt: number): void {
    const racer = this.progress[index];
    const sideways = Math.abs(car.slipAngle);
    if (car.grounded && sideways >= DRIFT_ANGLE && car.speed >= DRIFT_SPEED) {
      racer.driftFor += dt;
      racer.driftScore += sideways * car.speed * dt;
      return;
    }
    if (racer.driftFor >= DRIFT_MINIMUM) this.events.push({ type: 'drift', racer: index, score: racer.driftScore });
    racer.driftFor = 0;
    racer.driftScore = 0;
  }

  private shelterFor(index: number): number {
    const mine = this.progress[index];
    const L = this.track.length;
    let best = 0;
    for (let other = 0; other < this.progress.length; other++) {
      if (other === index) continue;
      const ahead = this.progress[other];
      const gap = ahead.progressAlong(L) - mine.progressAlong(L);
      if (gap <= 0 || gap > SLIPSTREAM_REACH) continue;
      const across = Math.abs(ahead.lateral - mine.lateral);
      if (across > SLIPSTREAM_WIDTH) continue;
      best = Math.max(best, (1 - gap / SLIPSTREAM_REACH) * (1 - across / SLIPSTREAM_WIDTH));
    }
    return best;
  }

  private readProgress(index: number, dt: number, racing: boolean): void {
    const racer = this.progress[index];
    const car = this.cars[index];
    const track = this.track;
    const length = track.length;
    const previous = this.previousS[index];
    const current = track.centre.wrap(car.trackDistance);
    const moved = shortestDelta(previous, current, length);
    this.previousS[index] = current;
    racer.s = current;
    const fr = track.frameAt(current, this.frame);
    racer.lateral = this.offset.copy(car.position).sub(fr.position).dot(fr.right);
    racer.offRoad = Math.abs(racer.lateral) > track.widthAt(current) / 2;
    if (!racing || racer.finished) return;

    racer.lapTime += dt;
    racer.totalTime += dt;

    // 逆行：往回走的距离累计超过 12 米才算
    if (moved < 0) this.backwards[index] -= moved;
    else this.backwards[index] = Math.max(0, this.backwards[index] - moved);
    const wrong = this.backwards[index] > 12;
    if (wrong && !racer.wrongWay) this.events.push({ type: 'wrongWay', racer: index });
    racer.wrongWay = wrong;

    const checkpoints = track.checkpoints;
    if (moved > 0) {
      while (racer.nextCheckpoint < checkpoints.length && swept(previous, moved, checkpoints[racer.nextCheckpoint], length)) {
        racer.nextCheckpoint++;
        this.events.push({ type: 'checkpoint', racer: index });
      }
      if (swept(previous, moved, 0, length) && racer.nextCheckpoint >= checkpoints.length) this.completeLap(index);
    }
  }

  private completeLap(index: number): void {
    const racer = this.progress[index];
    racer.lap++;
    racer.nextCheckpoint = 0;
    racer.lastLap = racer.lapTime;
    this.events.push({ type: 'lap', racer: index, time: racer.lastLap });
    if (racer.bestLap === null || racer.lastLap < racer.bestLap) {
      racer.bestLap = racer.lastLap;
      this.events.push({ type: 'best', racer: index, time: racer.lastLap });
    }
    racer.lapTime = 0;
    if (racer.lap >= LAPS) {
      racer.finishedAt = this.elapsed;
      this.events.push({ type: 'finish', racer: index, place: this.positionOf(index) });
      if (this.progress.every((p) => p.finished)) {
        this.phase = 'finished';
        this.events.push({ type: 'raceOver' });
      }
    }
  }

  private recover(index: number, dt: number): void {
    const racer = this.progress[index];
    const car = this.cars[index];
    if (racer.offRoad) this.offRoadFor[index] += dt;
    else this.offRoadFor[index] = 0;
    const fell = car.position.y < KILL_PLANE;
    const lost = this.offRoadFor[index] > OFF_ROAD_PATIENCE;
    if (!fell && !lost) return;
    this.respawn(index);
  }

  /** 放回上一个检查点（还没过检查点就回起点线）。 */
  respawn(index: number): void {
    const racer = this.progress[index];
    const checkpoints = this.track.checkpoints;
    const at = racer.nextCheckpoint === 0 ? 0 : checkpoints[racer.nextCheckpoint - 1];
    const fr = this.track.frameAt(at, this.frame);
    const spawn = this.offset.copy(fr.position);
    spawn.y += 1;
    this.cars[index].placeAt(spawn, Math.atan2(fr.forward.x, fr.forward.z), at);
    this.previousS[index] = this.track.centre.wrap(at);
    this.backwards[index] = 0;
    this.offRoadFor[index] = 0;
    racer.s = this.previousS[index];
    racer.offRoad = false;
    racer.wrongWay = false;
    this.events.push({ type: 'respawn', racer: index });
  }
}

function swept(from: number, moved: number, mark: number, length: number): boolean {
  const to = from + moved;
  for (const candidate of [mark - length, mark, mark + length]) {
    if (candidate > from && candidate <= to) return true;
  }
  return false;
}

function shortestDelta(from: number, to: number, length: number): number {
  let delta = (to - from) % length;
  if (delta < 0) delta += length;
  if (delta > length / 2) delta -= length;
  return delta;
}

// ── AI ───────────────────────────────────────────────────────────────────

const AI = {
  lookAheadPerSpeed: 0.55,
  minLookAhead: 12,
  steerGain: 2.2,
  corneringGrip: 14,
  brakeHorizon: 45,
  brakeMargin: 1.1,
  rubberBandPer100m: 0.07,
  rubberBandClamp: 0.22,
  avoidRange: 22,
  avoidWidth: 3.2,
  avoidOffset: 3,
};

export class AiDriver {
  private readonly frameAhead = new TrackFrame();
  private readonly here = new TrackFrame();
  private readonly toAim = new Vector3();
  private readonly offset = new Vector3();

  constructor(readonly track: TrackSpline) {}

  drive(self: SphereVehicle, out: VehicleInput, others: SphereVehicle[], playerGap: number, skill: number): void {
    const at = self.trackDistance;
    const speed = self.speed;
    const lookAhead = Math.max(AI.minLookAhead, speed * AI.lookAheadPerSpeed);
    const lateral = this.avoidanceOffset(self, others, at);
    const fr = this.track.frameAt(at + lookAhead, this.frameAhead);
    this.toAim.copy(fr.position).addScaledVector(fr.right, lateral).sub(self.position);
    const wanted = Math.atan2(this.toAim.x, this.toAim.z);
    const error = shortestAngle(self.headingYaw, wanted);
    const pace = this.pace(at, playerGap, skill);
    out.steer = clamp(-error * AI.steerGain, -1, 1);
    out.throttle = speed < pace ? 1 : 0;
    out.brake = speed > pace * AI.brakeMargin ? 1 : 0;
    out.handbrake = false;
  }

  private pace(at: number, playerGap: number, skill: number): number {
    let sharpest = 0;
    for (let ahead = 0; ahead <= AI.brakeHorizon; ahead += 5) {
      sharpest = Math.max(sharpest, Math.abs(this.track.centre.curvatureAt(at + ahead)));
    }
    const ceiling = sharpest < 1e-4 ? Infinity : Math.sqrt(AI.corneringGrip / sharpest);
    let pace = ceiling * skill;
    if (playerGap !== 0) {
      pace *= 1 + clamp((playerGap / 100) * AI.rubberBandPer100m, -AI.rubberBandClamp, AI.rubberBandClamp);
    }
    return pace;
  }

  private avoidanceOffset(self: SphereVehicle, others: SphereVehicle[], at: number): number {
    const here = this.track.frameAt(at, this.here);
    const mine = this.offset.copy(self.position).sub(here.position).dot(here.right);
    const length = this.track.length;
    for (const other of others) {
      if (other === self) continue;
      let gap = (other.trackDistance - at) % length;
      if (gap < 0) gap += length;
      if (gap > length / 2) gap -= length;
      if (gap <= 0 || gap > AI.avoidRange) continue;
      const theirs = this.offset.copy(other.position).sub(here.position).dot(here.right);
      if (Math.abs(theirs - mine) > AI.avoidWidth) continue;
      const room = this.track.widthAt(at) / 2;
      const target = theirs + room > room - theirs ? theirs - AI.avoidOffset : theirs + AI.avoidOffset;
      return clamp(target, -room + 1, room - 1);
    }
    return 0;
  }
}

// ── 追尾镜头 ─────────────────────────────────────────────────────────────

const CHASE = {
  distance: 8,
  height: 3,
  aimHeight: 1,
  lag: 7,
  headingBlend: 0.75,
  headingFrom: 4,
  headingTo: 14,
  lookAhead: 26,
  lookAheadWeight: 0.35,
  baseFov: 1.05,
  fovPerSpeed: 0.006,
  maxFov: 1.45,
};

export class ChaseCamera {
  readonly eye = new Vector3();
  readonly target = new Vector3();
  /** 竖直方向视场角（弧度）。 */
  fov = CHASE.baseFov;
  private readonly wantedEye = new Vector3();
  private readonly wantedTarget = new Vector3();
  private readonly ahead = new Vector3();
  private placed = false;
  private shakeLeft = 0;
  private shakeAmount = 0;

  constructor(readonly track: TrackSpline) {}

  cut(): void {
    this.placed = false;
  }

  shake(amount: number, seconds = 0.35): void {
    if (amount < this.shakeAmount && this.shakeLeft > 0) return;
    this.shakeAmount = amount;
    this.shakeLeft = seconds;
  }

  follow(car: SphereVehicle, dt: number): void {
    const speed = car.speed;
    const travelling = Math.atan2(car.velocity.x, car.velocity.z);
    const reach = clamp((speed - CHASE.headingFrom) / (CHASE.headingTo - CHASE.headingFrom), 0, 1);
    const heading = car.headingYaw + shortestAngle(car.headingYaw, travelling) * reach * CHASE.headingBlend;

    const wt = this.wantedTarget.copy(car.position);
    wt.y += CHASE.aimHeight;
    this.track.centreAt(car.trackDistance + CHASE.lookAhead, this.ahead);
    wt.x += (this.ahead.x - wt.x) * CHASE.lookAheadWeight;
    wt.z += (this.ahead.z - wt.z) * CHASE.lookAheadWeight;

    this.wantedEye.set(
      car.position.x - Math.sin(heading) * CHASE.distance,
      car.position.y + CHASE.height,
      car.position.z - Math.cos(heading) * CHASE.distance,
    );

    if (!this.placed) {
      this.eye.copy(this.wantedEye);
      this.target.copy(wt);
      this.placed = true;
    } else {
      const k = easeFactor(CHASE.lag, dt);
      this.eye.lerp(this.wantedEye, k);
      this.target.lerp(wt, k);
    }
    // 镜头不能钻到路面以下
    const floor = car.position.y + 0.8;
    if (this.eye.y < floor) this.eye.y = floor;

    this.fov = Math.min(CHASE.baseFov + speed * CHASE.fovPerSpeed, CHASE.maxFov);

    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      const a = this.shakeAmount * Math.max(0, this.shakeLeft) * 0.4;
      this.eye.x += (Math.random() - 0.5) * a;
      this.eye.y += (Math.random() - 0.5) * a;
    }
  }
}
