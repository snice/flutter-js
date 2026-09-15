// 一场比赛的主循环：固定 60Hz 步进模拟，渲染按帧插值；读输入、驱动 AI、
// 处理事件、摆车和镜头，把 HUD 需要的数攒成一个 readout。
//
// 与 Vue 无关：页面只负责 canvas、输入和把 readout 画成 HUD。
import { ACESFilmicToneMapping, Matrix4, PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AiDriver, ChaseCamera, FIELD_SIZE, LAPS, RacingSimulation, type RaceEvent } from './race';
import { buildCircuit, type Circuit, type Models } from './scene';
import { Sounds } from './sounds';
import { readTrack, type TrackDocument } from './track';
import { clamp, TYRES, World } from './vehicle';

import carUrl from '@/assets/models/car.glb';
import buildingA from '@/assets/models/building-a.glb';
import buildingE from '@/assets/models/building-e.glb';
import buildingK from '@/assets/models/building-k.glb';
import buildingQ from '@/assets/models/building-q.glb';

import ring from '@/assets/tracks/ring.json';
import ringLevel from '@/assets/tracks/ring_level.json';
import gorge from '@/assets/tracks/gorge.json';
import gorgeLevel from '@/assets/tracks/gorge_level.json';
import flats from '@/assets/tracks/flats.json';
import flatsLevel from '@/assets/tracks/flats_level.json';
import quarry from '@/assets/tracks/quarry.json';
import quarryLevel from '@/assets/tracks/quarry_level.json';
import ridge from '@/assets/tracks/ridge.json';
import ridgeLevel from '@/assets/tracks/ridge_level.json';

/** 赛季：五条赛道，按难度排好。 */
export const SEASON = [
  { name: 'ring', title: '环形赛道', en: 'The Ring', track: ring, level: ringLevel },
  { name: 'gorge', title: '峡谷', en: 'The Gorge', track: gorge, level: gorgeLevel },
  { name: 'flats', title: '平原', en: 'The Flats', track: flats, level: flatsLevel },
  { name: 'quarry', title: '采石场', en: 'The Quarry', track: quarry, level: quarryLevel },
  { name: 'ridge', title: '山脊', en: 'The Ridge', track: ridge, level: ridgeLevel },
];

const STEP = 1 / 60;

export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

export interface Readout {
  lap: number;
  laps: number;
  position: number;
  racers: number;
  lapTime: number;
  bestLap: number | null;
  record: number | null;
  speed: number;
  damage: number;
  tyres: string;
  wrongWay: boolean;
  countdown: number | null;
  notice: string | null;
  /** 小地图：各车在 [0,1] 方框里的位置，玩家在第一个。 */
  dots: { x: number; y: number }[];
}

export interface RaceResult {
  place: number;
  total: number;
  bestLap: number | null;
  newRecord: boolean;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

function loadRecord(name: string): number | null {
  try {
    const v = globalThis.localStorage?.getItem(`racing.record.${name}`);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

function saveRecord(name: string, t: number): void {
  try {
    globalThis.localStorage?.setItem(`racing.record.${name}`, String(t));
  } catch {
    /* 没有持久化就只在这次运行里记着 */
  }
}

export class Game {
  readonly sounds = new Sounds();
  readonly camera = new PerspectiveCamera(60, 1, 0.3, 1600);
  readonly controls: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  models: Models | null = null;
  circuitIndex = 0;
  doc: TrackDocument | null = null;
  circuit: Circuit | null = null;
  sim: RacingSimulation | null = null;
  outline: { x: number; y: number }[] = [];

  onResult: ((r: RaceResult) => void) | null = null;

  private chase: ChaseCamera | null = null;
  private ai: AiDriver | null = null;
  private accumulator = 0;
  private prev: Vector3[] = [];
  private notice: string | null = null;
  private noticeLeft = 0;
  private goLeft = 0;
  private refusedLeft = 0;
  private finished = false;
  private resultSent = false;
  private resultDelay = 0;
  private records = new Map<string, number | null>();
  private recordSet = false;
  private bounds = { minX: 0, minZ: 0, size: 1 };
  private readonly basis = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly draw = new Vector3();
  private aspect = 1;

  constructor(readonly renderer: WebGLRenderer) {
    renderer.toneMapping = ACESFilmicToneMapping;
  }

  /** 车和四栋房子。车模失败就退回方块车，房子失败就退回方块房。 */
  async loadModels(): Promise<string | null> {
    const loader = new GLTFLoader();
    const load = (url: string) => loader.loadAsync(url).catch((e: unknown) => {
      console.warn(`[racing] ${url}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    const [car, ...buildings] = await Promise.all([carUrl, buildingA, buildingE, buildingK, buildingQ].map(load));
    this.models = { car, buildings: buildings.filter((b): b is GLTF => b !== null) };
    return car ? null : '车模加载失败，用方块车代替';
  }

  get season() {
    return SEASON[this.circuitIndex];
  }

  record(): number | null {
    const name = this.season.name;
    if (!this.records.has(name)) this.records.set(name, loadRecord(name));
    return this.records.get(name) ?? null;
  }

  /** 搭好第 index 条赛道，车停在发车格上，倒计时还没开始走。 */
  setup(index: number): void {
    this.dispose();
    this.circuitIndex = index;
    const entry = SEASON[index];
    const doc = readTrack(entry.track, entry.level);
    const world = new World(doc.level.brushes);
    this.doc = doc;
    this.sim = new RacingSimulation(doc.track, world, FIELD_SIZE);
    this.chase = new ChaseCamera(doc.track);
    this.ai = new AiDriver(doc.track);
    this.circuit = buildCircuit(doc, world, this.models ?? { car: null, buildings: [] }, FIELD_SIZE);
    this.renderer.toneMappingExposure = this.circuit.exposure * 0.62;
    this.prev = this.sim.cars.map((c) => c.position.clone());
    this.accumulator = 0;
    this.finished = false;
    this.resultSent = false;
    this.recordSet = false;
    this.notice = null;
    this.goLeft = 0;
    this.buildOutline();
    this.chase.follow(this.sim.cars[0], 0);
    this.place(1);
    this.renderer.compile(this.circuit.scene, this.camera);
  }

  /** 释放上一条赛道的显存；车模和房子的材质贴图是共享的，留着。 */
  private dispose(): void {
    const circuit = this.circuit;
    if (!circuit) return;
    const keep = new Set<unknown>();
    const models = this.models;
    const collect = (gltf: GLTF | null) =>
      gltf?.scene.traverse((o) => {
        const m = o as unknown as { geometry?: unknown; material?: unknown };
        if (m.geometry) keep.add(m.geometry);
        if (m.material) keep.add(m.material);
      });
    collect(models?.car ?? null);
    models?.buildings.forEach(collect);
    circuit.scene.traverse((o) => {
      const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } | null; name?: string } };
      if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
      const mat = m.material;
      if (mat && !keep.has(mat) && !(mat.name ?? '').toLowerCase().includes('chassis')) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    this.circuit = null;
  }

  resize(width: number, height: number): void {
    this.aspect = width / (height || 1);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 倒计时从头开始走。 */
  start(): void {
    this.sounds.unlock();
  }

  pitStop(): void {
    const car = this.sim?.cars[0];
    if (!car) return;
    const next = TYRES[(TYRES.indexOf(car.tyres) + 1) % TYRES.length];
    if (car.pitStop(next)) {
      this.say(`换上${next.label}`, 1.5);
      this.sounds.play('checkpoint');
    } else {
      this.refusedLeft = 2;
    }
  }

  /** 推进 dt 秒并画一帧。running=false 时只画（标题 / 结算画面后面的背景）。 */
  frame(dt: number, running: boolean): void {
    const sim = this.sim;
    const circuit = this.circuit;
    if (!sim || !circuit || !this.chase) return;
    if (running) {
      this.accumulator += Math.min(dt, 0.1);
      let steps = 0;
      while (this.accumulator >= STEP && steps < 6) {
        this.stepOnce(STEP);
        this.accumulator -= STEP;
        steps++;
      }
      if (steps === 6) this.accumulator = 0;
    }
    const alpha = running ? this.accumulator / STEP : 1;
    this.chase.follow(sim.cars[0], dt);
    this.place(alpha);
    this.tickTimers(dt);
    this.updateSounds(running);
    this.renderer.render(circuit.scene, this.camera);
  }

  private stepOnce(dt: number): void {
    const sim = this.sim!;
    const input = sim.inputs[0];
    for (let i = 0; i < sim.cars.length; i++) this.prev[i].copy(sim.cars[i].position);
    if (this.finished) {
      // 冲线之后交给 AI 开完减速圈
      this.ai!.drive(sim.cars[0], input, sim.cars, 0, 0.6);
    } else {
      input.throttle = this.controls.throttle;
      input.brake = this.controls.brake;
      input.steer = this.controls.steer;
      input.handbrake = this.controls.handbrake;
    }
    const L = sim.track.length;
    const player = sim.progress[0];
    for (let i = 1; i < sim.cars.length; i++) {
      let gap = player.progressAlong(L) - sim.progress[i].progressAlong(L);
      if (Math.abs(gap) > L / 2) gap -= Math.sign(gap) * L;
      this.ai!.drive(sim.cars[i], sim.inputs[i], sim.cars, this.finished ? 0 : gap, 1);
    }
    sim.step(dt);
    const me = sim.cars[0];
    if (me.impact > 6) {
      this.sounds.play('bump', 0.12);
      this.chase!.shake(Math.min(me.impact / 10, 2));
    }
    for (const e of sim.events.splice(0)) this.handle(e);
  }

  private handle(e: RaceEvent): void {
    const sim = this.sim!;
    switch (e.type) {
      case 'tick':
        this.sounds.play('count');
        break;
      case 'go':
        this.sounds.play('go');
        this.goLeft = 0.8;
        break;
      case 'checkpoint':
        if (e.racer === 0 && !this.finished) this.sounds.play('checkpoint');
        break;
      case 'lap':
        if (e.racer !== 0 || this.finished) break;
        this.sounds.play('lap');
        if (sim.progress[0].lap === LAPS - 1) this.say('最后一圈', 2);
        else if (sim.progress[0].lap < LAPS) this.say(`第 ${sim.progress[0].lap + 1} 圈 · ${formatTime(e.time)}`, 2);
        break;
      case 'best': {
        if (e.racer !== 0 || this.finished) break;
        const record = this.record();
        if (record === null || e.time < record) {
          this.records.set(this.season.name, e.time);
          saveRecord(this.season.name, e.time);
          this.recordSet = true;
          this.sounds.play('best');
          this.say(`新纪录 ${formatTime(e.time)}`, 2.5);
        }
        break;
      }
      case 'finish':
        if (e.racer !== 0) break;
        this.finished = true;
        this.resultDelay = 1.6;
        this.say(e.place === 1 ? '冠军！' : `第 ${e.place} 名完赛`, 2);
        break;
      case 'respawn':
        if (e.racer === 0) {
          this.say('回到赛道', 1.5);
          this.chase!.cut();
          this.prev[0].copy(sim.cars[0].position);
        } else {
          this.prev[e.racer].copy(sim.cars[e.racer].position);
        }
        break;
      case 'drift':
        if (e.racer === 0 && e.score > 30 && !this.finished) this.say(`漂移 +${Math.round(e.score)}`, 1.2);
        break;
      default:
        break;
    }
  }

  private say(text: string, seconds: number): void {
    this.notice = text;
    this.noticeLeft = seconds;
  }

  private tickTimers(dt: number): void {
    if (this.noticeLeft > 0) {
      this.noticeLeft -= dt;
      if (this.noticeLeft <= 0) this.notice = null;
    }
    if (this.goLeft > 0) this.goLeft -= dt;
    if (this.refusedLeft > 0) this.refusedLeft -= dt;
    if (this.finished && !this.resultSent) {
      this.resultDelay -= dt;
      if (this.resultDelay <= 0) {
        this.resultSent = true;
        const sim = this.sim!;
        const me = sim.progress[0];
        this.onResult?.({
          place: sim.positionOf(0),
          total: me.finishedAt ?? me.totalTime,
          bestLap: me.bestLap,
          newRecord: this.recordSet,
        });
      }
    }
  }

  private place(alpha: number): void {
    const sim = this.sim!;
    const circuit = this.circuit!;
    for (let i = 0; i < sim.cars.length; i++) {
      const car = sim.cars[i];
      const node = circuit.cars[i];
      this.draw.lerpVectors(this.prev[i] ?? car.position, car.position, alpha);
      this.basis.makeBasis(car.right, car.up, car.forward);
      this.quat.setFromRotationMatrix(this.basis);
      node.position.copy(this.draw).addScaledVector(car.up, circuit.carLift);
      node.quaternion.copy(this.quat);
      const shadow = circuit.shadows[i];
      shadow.position.copy(this.draw).addScaledVector(car.up, -0.5);
      shadow.quaternion.copy(this.quat);
      shadow.visible = car.grounded;
    }
    const chase = this.chase!;
    const cam = this.camera;
    cam.position.copy(chase.eye);
    cam.lookAt(chase.target);
    // 原版的 fov 是竖直视场；竖屏时改成保证横向视场，免得左右只看得见一条缝
    let fov = chase.fov;
    if (this.aspect < 1) fov = Math.min(2 * Math.atan(Math.tan(fov / 2) / this.aspect), 1.9);
    const deg = (fov * 180) / Math.PI;
    if (Math.abs(cam.fov - deg) > 0.01) {
      cam.fov = deg;
      cam.updateProjectionMatrix();
    }
    circuit.sky.position.copy(cam.position);
    circuit.sun.position.copy(cam.position).add(this.sunOffset());
    circuit.sun.target.position.copy(cam.position);
  }

  private readonly sunDir = new Vector3();
  private sunOffset(): Vector3 {
    const dir = this.doc?.level.lights?.[0]?.direction ?? [0, -1, 0];
    return this.sunDir.set(-dir[0], -dir[1], -dir[2]).normalize().multiplyScalar(100);
  }

  private updateSounds(running: boolean): void {
    const sim = this.sim!;
    const car = sim.cars[0];
    const sliding = Math.max(Math.abs(car.slipAngle), Math.abs(car.slipRatio) * 0.7);
    const moving = clamp(car.speed / 8, 0, 1);
    const skid = car.grounded ? clamp((sliding - 0.12) / (0.55 - 0.12), 0, 1) * moving : 0;
    const rumble = sim.progress[0].offRoad && car.grounded ? moving : 0;
    this.sounds.update(Math.max(0.12, car.rpm), skid, rumble, running);
  }

  private buildOutline(): void {
    const track = this.doc!.track;
    const at = new Vector3();
    const pts: { x: number; z: number }[] = [];
    for (let s = 0; s < track.length; s += 12) {
      track.centreAt(s, at);
      pts.push({ x: at.x, z: at.z });
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const size = Math.max(maxX - minX, maxZ - minZ) || 1;
    // 居中放进方框
    this.bounds = { minX: minX - (size - (maxX - minX)) / 2, minZ: minZ - (size - (maxZ - minZ)) / 2, size };
    this.outline = pts.map((p) => this.toMap(p.x, p.z));
  }

  /** 世界坐标 → 小地图 [0,1]。x 轴取反：镜头朝 +z 看时 +x 在屏幕左边。 */
  private toMap(x: number, z: number): { x: number; y: number } {
    const b = this.bounds;
    return { x: 1 - (x - b.minX) / b.size, y: 1 - (z - b.minZ) / b.size };
  }

  readout(): Readout | null {
    const sim = this.sim;
    if (!sim) return null;
    const me = sim.progress[0];
    const car = sim.cars[0];
    const countdown = sim.phase === 'countdown' ? sim.countdown : this.goLeft > 0 ? 0 : null;
    return {
      lap: Math.min(me.lap + 1, LAPS),
      laps: LAPS,
      position: sim.positionOf(0),
      racers: sim.cars.length,
      lapTime: me.lapTime,
      bestLap: me.bestLap,
      record: this.record(),
      speed: car.speed * 3.6,
      damage: car.damage,
      tyres: this.refusedLeft > 0 ? '先停车' : car.tyres.label,
      wrongWay: me.wrongWay && !this.finished,
      countdown,
      notice: this.notice,
      dots: sim.cars.map((c) => this.toMap(c.position.x, c.position.z)),
    };
  }
}
