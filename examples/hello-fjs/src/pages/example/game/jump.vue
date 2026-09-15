<route>
{"title": "跳一跳", "scroll": false, "group": "交互游戏", "desc": "three.js 正交视角，按住蓄力、松开跳到下一个台子"}
</route>

<script setup lang="ts">
// 跳一跳：复刻微信小游戏，three.js 持续渲染。
//
// 写法上沿用 shooter.vue 的几条约定（App 端的 GL 是命令流）：
//
// 1. **draw call 少**。棋子的底座、身子、头合成一个 Mesh；台子只留最近几块，
//    旧的直接移出场景。几何体都是单位尺寸共享的，大小靠 scale。
// 2. **不用 shadowMap**。阴影是贴在地面 / 台面上的半透明平面，两端结果一致，
//    也省掉深度纹理那一整条管线。
// 3. **材质建场景时一次建好**，ready 之后 renderer.compile()；之后新生成的台子
//    只是换 scale 和共享材质，不会再编新 shader。
//
// 玩法：棋子沿「当前位置 → 下一块台子中心」的方向跳，距离 = 按住时长 × 速度。
// 落在台子中心附近算「完美」，连续完美分数翻倍递增。
//
// polyfill 必须在 three 之前 import：ESM 按声明顺序执行模块。web 端它是空操作。
import '@/adapters/three/native-polyfills';
import '@ufjs/webgl';
import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FjsCanvasApi } from 'fjs';

// ── 数值（世界单位）─────────────────────────────────────────────────────

/** 台子高度；所有台子一样高，落点的 y 才是个常数。 */
const H = 1;
/** 棋子脚底的碰撞半径：中心出了台面、但脚还压着边，就是「踩边翻倒」。 */
const FOOT_R = 0.3;
/** 蓄力：每秒能跳多远、最多蓄多久。 */
const CHARGE_SPEED = 5.2;
const MAX_CHARGE = 1.8;
/** 落点离台面中心多近算完美。 */
const PERFECT_R = 0.32;
const JUMP_HEIGHT = 2.2;
const KEEP_PLATFORMS = 8;

/** 相机方向：从右后上方斜看，+x 在屏幕右上，-z 在屏幕左上。 */
const CAMERA_OFFSET = new THREE.Vector3(-12, 14, 12);
/** 光从左后上方来：顶面最亮，左侧面（-x）次之，右侧面（+z）最暗；
 * 影子往屏幕右边拖（+x 和 +z 各偏一点）。 */
const LIGHT_DIR = new THREE.Vector3(-1, 3, -0.6).normalize();
const SHADOW_SHIFT = new THREE.Vector2(0.8, 0.45);

const PLATFORM_COLORS = [
  0xf4f4f4, 0xff8a65, 0x66bb6a, 0x42a5f5, 0xab47bc, 0xffca28, 0x8d6e63, 0xef5350, 0x26c6da,
];
/** 背景每 20 分换一档。 */
const BG_COLORS = [0xd9dde6, 0xe8ddd2, 0xd4e5dc, 0xdfd7ea, 0xe6e1cf];

type Phase = 'ready' | 'playing' | 'over';
type Kind = 'box' | 'cyl';

interface Platform {
  kind: Kind;
  x: number;
  z: number;
  /** 方块的半边长 / 圆柱的半径。 */
  half: number;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  /** 生成时从空中落下来的剩余时间。 */
  drop: number;
  /** 蓄力压扁的程度，0..1。 */
  squash: number;
  /** 松手后回弹：振幅和经过的时间。 */
  springAmp: number;
  springT: number;
}

interface Jump {
  t: number;
  duration: number;
  x0: number;
  z0: number;
  y0: number;
  x1: number;
  z1: number;
  axis: THREE.Vector3;
}

interface Fall {
  t: number;
  y0: number;
  /** 踩边翻倒时绕着转的轴；直直掉下去时为 null。 */
  axis: THREE.Vector3 | null;
}

// ── 页面状态 ─────────────────────────────────────────────────────────

const cv = ref<FjsCanvasApi>();
const phase = ref<Phase>('ready');
const score = ref(0);
const best = ref(0);
const ready = ref(false);
const error = ref('');
const popup = ref('');

const maskTitle = computed(() => {
  if (error.value) return '无法启动';
  return phase.value === 'over' ? '游戏结束' : '跳一跳';
});
const maskSub = computed(() => {
  if (error.value) return error.value;
  if (!ready.value) return '场景准备中…';
  if (phase.value === 'over') return `本局 ${score.value} 分　最高 ${best.value} 分`;
  return '按住屏幕蓄力，松开跳到下一个台子\n落在正中间有额外加分';
});

// ── 随机 ─────────────────────────────────────────────────────────────

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

// ── three 与宿主 canvas 的衔接（同 shooter.vue） ─────────────────────────

/** three 的 renderer 要一个 DOM canvas（挂 contextlost 监听、setSize 写宽高、
 * 碰 style）。fjs 的 canvas 没有这些成员，字面量垫上；GL 调用走传进去的 context。 */
function asDomCanvas(buffer: { readonly width: number; readonly height: number }): HTMLCanvasElement {
  return {
    width: buffer.width,
    height: buffer.height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

/** GL 绘制缓冲与布局尺寸之比。必须从 `gl.canvas` 读：App 端 canvas 元素的
 * devicePixelRatio 是 2d 契约里的常量 1，而 webgl 缓冲是逻辑尺寸 × 真实像素比。 */
function bufferRatio(buffer: { readonly width: number }, logicalWidth: number): number {
  if (logicalWidth <= 0 || buffer.width <= 0) return 1;
  return buffer.width / logicalWidth;
}

/** fjs 的 context 有 ready()，浏览器的没有（没有就是已就绪）。必须当方法调。 */
function contextReady(ctx: WebGLRenderingContext): boolean {
  const fn = (ctx as WebGLRenderingContext & { ready?: () => boolean }).ready;
  return typeof fn === 'function' ? fn.call(ctx) === true : true;
}

// ── 场景 ─────────────────────────────────────────────────────────────

let renderer: THREE.WebGLRenderer | null = null;
let gl: WebGLRenderingContext | null = null;
let compiled = false;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 100);
const camTarget = new THREE.Vector3();
const camGoal = new THREE.Vector3();

// 单位几何体：底面在 y=0，尺寸靠 scale
const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 48).translate(0, 0.5, 0);
const squareShadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const circleShadowGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

const platformMats = PLATFORM_COLORS.map((color) => new THREE.MeshLambertMaterial({ color }));
const shadowMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
});
const playerShadowMat = shadowMat.clone();
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const groundMat = new THREE.MeshBasicMaterial({ color: BG_COLORS[0] });
const bgColor = new THREE.Color(BG_COLORS[0]);
const bgGoal = new THREE.Color(BG_COLORS[0]);

let ground: THREE.Mesh;
/** 棋子：root 在脚底（负责位置和压扁），pivot 在重心（负责空翻和翻倒）。 */
let player: THREE.Group;
let pivot: THREE.Group;
let playerShadow: THREE.Mesh;
let ring: THREE.Mesh;
let ringT = 1;

let platforms: Platform[] = [];
/** 棋子站着的台子，和要跳去的下一块。 */
let current: Platform;
let next: Platform;

function buildScene(): void {
  scene.background = bgColor;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.copy(LIGHT_DIR).multiplyScalar(10);
  scene.add(sun);

  ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -0.001;
  scene.add(ground);

  // 棋子的三段合成一个 Mesh：一次 draw call
  const base = new THREE.CylinderGeometry(0.4, 0.42, 0.12, 32).translate(0, 0.06, 0);
  const body = new THREE.CylinderGeometry(0.2, 0.36, 0.9, 32).translate(0, 0.57, 0);
  const head = new THREE.SphereGeometry(0.28, 32, 16).translate(0, 1.3, 0);
  const merged = mergeGeometries([base, body, head])!;
  base.dispose();
  body.dispose();
  head.dispose();
  const pieceMesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: 0x3b3563 }));
  pieceMesh.position.y = -0.75;
  pivot = new THREE.Group();
  pivot.position.y = 0.75;
  pivot.add(pieceMesh);
  player = new THREE.Group();
  player.add(pivot);
  scene.add(player);

  playerShadow = new THREE.Mesh(circleShadowGeo, playerShadowMat);
  playerShadow.scale.setScalar(0.42);
  playerShadow.renderOrder = 1;
  scene.add(playerShadow);

  ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 48).rotateX(-Math.PI / 2), ringMat);
  ring.visible = false;
  ring.renderOrder = 2;
  scene.add(ring);

  resetGame();
}

function makePlatform(x: number, z: number, level: number, dropIn: boolean): Platform {
  const kind: Kind = Math.random() < 0.5 ? 'box' : 'cyl';
  // 分数越高台子越小，下限 0.7
  const shrink = Math.min(level * 0.012, 0.5);
  const half = Math.max(0.7, kind === 'box' ? rand(1.0, 1.6) - shrink : rand(0.9, 1.4) - shrink * 0.8);
  const mesh = new THREE.Mesh(kind === 'box' ? boxGeo : cylGeo, pick(platformMats));
  const shadow = new THREE.Mesh(kind === 'box' ? squareShadowGeo : circleShadowGeo, shadowMat);
  const size = kind === 'box' ? half * 2 : half;
  mesh.scale.set(size, H, size);
  shadow.scale.set(size, 1, size);
  shadow.position.set(x + SHADOW_SHIFT.x, 0.002, z + SHADOW_SHIFT.y);
  mesh.position.set(x, 0, z);
  scene.add(mesh, shadow);
  const p: Platform = {
    kind,
    x,
    z,
    half,
    mesh,
    shadow,
    drop: dropIn ? 0.45 : 0,
    squash: 0,
    springAmp: 0,
    springT: 0,
  };
  platforms.push(p);
  while (platforms.length > KEEP_PLATFORMS) {
    const old = platforms.shift()!;
    scene.remove(old.mesh, old.shadow);
  }
  return p;
}

/** 在 from 的 +x 或 -z 方向上放下一块。 */
function spawnNext(from: Platform): Platform {
  const alongX = Math.random() < 0.5;
  const level = score.value;
  // 先按最大可能尺寸估距离，再生成；间隙随分数略微变大
  const gap = rand(1.2, 2.6 + Math.min(level * 0.03, 1.2));
  const dist = from.half + 1.3 + gap;
  const x = alongX ? from.x + dist : from.x;
  const z = alongX ? from.z : from.z - dist;
  return makePlatform(x, z, level, true);
}

function resetGame(): void {
  for (const p of platforms) scene.remove(p.mesh, p.shadow);
  platforms = [];
  score.value = 0;
  combo = 0;
  popup.value = '';
  state = 'idle';
  charge = 0;
  jump = null;
  fall = null;
  ringT = 1;
  ring.visible = false;
  bgGoal.setHex(BG_COLORS[0]);

  current = makePlatform(0, 0, 0, false);
  current.mesh.material = platformMats[0];
  next = spawnNext(current);
  next.drop = 0;
  px = 0;
  pz = 0;
  player.position.set(0, H, 0);
  player.scale.set(1, 1, 1);
  pivot.quaternion.identity();
  playerShadowMat.opacity = shadowMat.opacity;
  goalOf(camGoal);
  camTarget.copy(camGoal);
}

// ── 游戏逻辑 ─────────────────────────────────────────────────────────

let state: 'idle' | 'charging' | 'jumping' | 'falling' = 'idle';
let charge = 0;
let combo = 0;
let jump: Jump | null = null;
let fall: Fall | null = null;
/** 棋子脚底的水平位置。 */
let px = 0;
let pz = 0;
let popupLeft = 0;

const tmpDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const flipQ = new THREE.Quaternion();

function topOf(p: Platform): number {
  return p.mesh.scale.y + p.mesh.position.y;
}

function goalOf(out: THREE.Vector3): THREE.Vector3 {
  return out.set((current.x + next.x) / 2, H * 0.5, (current.z + next.z) / 2);
}

/** 点是否落在台面上；margin 为正时把台面放大一圈（用来判断踩边）。 */
function inside(p: Platform, x: number, z: number, margin = 0): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  const r = p.half + margin;
  return p.kind === 'box'
    ? Math.abs(dx) <= r && Math.abs(dz) <= r
    : dx * dx + dz * dz <= r * r;
}

function start(): void {
  if (!ready.value) return;
  if (phase.value === 'over') resetGame();
  phase.value = 'playing';
}

function onTouchStart(): void {
  if (phase.value !== 'playing' || state !== 'idle' || next.drop > 0) return;
  state = 'charging';
  charge = 0;
}

function onTouchEnd(): void {
  if (state !== 'charging') return;
  const distance = charge * CHARGE_SPEED;
  current.springAmp = current.squash;
  current.springT = 0;
  current.squash = 0;

  // 方向：脚下 → 下一块中心。横向偏差由方向吸收，玩家只管距离
  tmpDir.set(next.x - px, 0, next.z - pz);
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(1, 0, 0);
  tmpDir.normalize();
  jump = {
    t: 0,
    duration: 0.38 + distance * 0.025,
    x0: px,
    z0: pz,
    y0: player.position.y,
    x1: px + tmpDir.x * distance,
    z1: pz + tmpDir.z * distance,
    axis: new THREE.Vector3().crossVectors(UP, tmpDir).normalize(),
  };
  state = 'jumping';
  charge = 0;
}

/** 手指被系统收走（来电、手势冲突）：蓄力作废，不起跳。 */
function onTouchCancel(): void {
  if (state !== 'charging') return;
  current.springAmp = current.squash;
  current.springT = 0;
  current.squash = 0;
  charge = 0;
  state = 'idle';
}

function land(j: Jump): void {
  px = j.x1;
  pz = j.z1;
  pivot.quaternion.identity();

  if (inside(next, px, pz)) {
    const dx = px - next.x;
    const dz = pz - next.z;
    const perfect = dx * dx + dz * dz <= PERFECT_R * PERFECT_R;
    let gain = 1;
    if (perfect) {
      combo++;
      gain = combo * 2;
      showPopup(combo > 1 ? `完美 ×${combo}  +${gain}` : `完美  +${gain}`);
      ring.position.set(next.x, H + 0.01, next.z);
      ringT = 0;
    } else {
      combo = 0;
      showPopup(`+${gain}`);
    }
    score.value += gain;
    bgGoal.setHex(BG_COLORS[Math.floor(score.value / 20) % BG_COLORS.length]);
    current = next;
    next = spawnNext(current);
    goalOf(camGoal);
    state = 'idle';
    return;
  }

  if (inside(current, px, pz)) {
    // 跳得太近，还在原来的台子上：不得分，也不算输
    state = 'idle';
    return;
  }

  // 没踩上：脚压着边就朝外翻倒，否则直直掉下去
  let edge: Platform | null = null;
  if (inside(next, px, pz, FOOT_R)) edge = next;
  else if (inside(current, px, pz, FOOT_R)) edge = current;
  let axis: THREE.Vector3 | null = null;
  if (edge) {
    tmpDir.set(px - edge.x, 0, pz - edge.z);
    if (edge.kind === 'box') {
      // 方块的边是直的：只保留越界的那一个分量
      if (Math.abs(tmpDir.x) > Math.abs(tmpDir.z)) tmpDir.z = 0;
      else tmpDir.x = 0;
    }
    tmpDir.normalize();
    axis = new THREE.Vector3().crossVectors(UP, tmpDir).normalize();
  }
  fall = { t: 0, y0: H, axis };
  combo = 0;
  state = 'falling';
}

function die(): void {
  phase.value = 'over';
  if (score.value > best.value) best.value = score.value;
}

function showPopup(text: string): void {
  popup.value = text;
  popupLeft = 0.9;
}

function update(dt: number): void {
  // 台子：落下动画、蓄力压扁、松手回弹
  for (const p of platforms) {
    if (p.drop > 0) p.drop = Math.max(0, p.drop - dt);
    const d = p.drop / 0.45;
    p.mesh.position.y = d * d * 3;
    let sy = 1 - p.squash * 0.45;
    if (p.springAmp > 0) {
      p.springT += dt;
      const decay = Math.exp(-p.springT * 7);
      sy = 1 - p.springAmp * 0.45 * decay * Math.cos(p.springT * 26);
      if (decay < 0.01) p.springAmp = 0;
    }
    p.mesh.scale.y = H * sy;
  }

  if (state === 'charging') {
    charge = Math.min(charge + dt, MAX_CHARGE);
    const c = charge / MAX_CHARGE;
    current.squash = c;
    player.scale.set(1 + c * 0.18, 1 - c * 0.4, 1 + c * 0.18);
  } else {
    // 松手后棋子的形变很快弹回
    const k = 1 - Math.exp(-dt * 18);
    player.scale.x += (1 - player.scale.x) * k;
    player.scale.y += (1 - player.scale.y) * k;
    player.scale.z += (1 - player.scale.z) * k;
  }

  if (state === 'idle' || state === 'charging') {
    player.position.set(px, topOf(current), pz);
  } else if (state === 'jumping' && jump) {
    const j = jump;
    j.t = Math.min(j.t + dt, j.duration);
    const t = j.t / j.duration;
    const x = j.x0 + (j.x1 - j.x0) * t;
    const z = j.z0 + (j.z1 - j.z0) * t;
    const y = j.y0 + (H - j.y0) * t + 4 * JUMP_HEIGHT * t * (1 - t);
    player.position.set(x, y, z);
    // 空中翻一整圈，头先朝前
    flipQ.setFromAxisAngle(j.axis, Math.PI * 2 * easeInOut(t));
    pivot.quaternion.copy(flipQ);
    if (j.t >= j.duration) {
      jump = null;
      land(j);
    }
  } else if (state === 'falling' && fall) {
    const f = fall;
    f.t += dt;
    if (f.axis) {
      // 先绕边缘翻倒，再落地；躺平后重心离地大约是身子的半径
      const tip = Math.min(f.t / 0.35, 1);
      pivot.quaternion.setFromAxisAngle(f.axis, (Math.PI / 2) * tip * tip);
      const drop = Math.min(Math.max(f.t - 0.1, 0) / 0.35, 1);
      player.position.set(px, f.y0 + (-0.4 - f.y0) * drop * drop, pz);
    } else {
      const drop = Math.min(f.t / 0.3, 1);
      player.position.set(px, f.y0 * (1 - drop * drop), pz);
    }
    // 落地后停一小会儿再弹结算，先让人看清摔在哪
    if (f.t >= 0.9 && phase.value === 'playing') die();
  }

  // 棋子影子：站着时贴在台面上，空中淡出，掉到地上贴地面
  const onGround = state === 'falling';
  const shadowY = onGround ? 0.004 : topOf(current) + 0.004;
  const lift = Math.max(0, player.position.y - (onGround ? 0 : topOf(current)));
  playerShadowMat.opacity = shadowMat.opacity * Math.max(0, 1 - lift / 1.2);
  playerShadow.position.set(
    player.position.x + SHADOW_SHIFT.x * 0.5,
    shadowY,
    player.position.z + SHADOW_SHIFT.y * 0.5,
  );

  // 完美落点的白色波纹
  if (ringT < 1) {
    ringT = Math.min(1, ringT + dt / 0.6);
    ring.visible = ringT < 1;
    ring.scale.setScalar(1 + ringT * 2);
    ringMat.opacity = 0.9 * (1 - ringT);
  }

  if (popupLeft > 0) {
    popupLeft -= dt;
    if (popupLeft <= 0) popup.value = '';
  }

  const follow = 1 - Math.exp(-dt * 4);
  camTarget.lerp(camGoal, follow);
  bgColor.lerp(bgGoal, follow * 0.5);
  groundMat.color.copy(bgColor);
  ground.position.set(camTarget.x, -0.001, camTarget.z);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// ── 循环 ─────────────────────────────────────────────────────────────

let raf = 0;
let last = 0;

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (!renderer || !gl || !contextReady(gl)) return;
  if (!compiled) {
    renderer.compile(scene, camera);
    compiled = true;
    ready.value = true;
  }
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
  last = now;
  update(dt);
  camera.position.copy(camTarget).add(CAMERA_OFFSET);
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
}

function startLoop(): void {
  if (raf || !renderer) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// 路由是 keep-alive 的：离开就停帧回调，正在蓄的力作废
onActivated(startLoop);
onDeactivated(() => {
  stopLoop();
  onTouchCancel();
});
onUnmounted(stopLoop);

// ── 画布 ─────────────────────────────────────────────────────────────

function onResize(): void {
  const instance = cv.value;
  if (!instance) return;
  if (!renderer) {
    // webgl2 → webgl 回落，three 自己的顺序；context 只取一次，three 持有到页面结束
    const ctx = (instance.getContext('webgl2') ?? instance.getContext('webgl')) as unknown as
      | WebGLRenderingContext
      | null;
    if (!ctx) {
      error.value = '此环境没有 WebGL';
      return;
    }
    gl = ctx;
    renderer = new THREE.WebGLRenderer({ canvas: asDomCanvas(ctx.canvas), context: ctx, antialias: true });
    buildScene();
  }

  const width = instance.width;
  const height = instance.height;
  renderer.setPixelRatio(bufferRatio(gl!.canvas, width));
  renderer.setSize(width, height, false);
  // 正交视野：竖屏保证横向看得到 12 个单位，横屏保证纵向 12 个单位
  const aspect = width / (height || 1);
  let halfW = 6;
  let halfH = halfW / aspect;
  if (halfH < 6) {
    halfH = 6;
    halfW = halfH * aspect;
  }
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
  startLoop();
}
</script>

<template>
  <view class="page">
    <canvas
      defer-resize
      ref="cv"
      class="gl"
      @resize="onResize"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @touchcancel="onTouchCancel"
    />
    <view v-if="phase === 'playing'" class="hud">
      <text class="score">{{ score }}</text>
      <text v-if="popup" class="popup">{{ popup }}</text>
    </view>
    <view v-if="phase !== 'playing'" class="mask">
      <text class="mask-title">{{ maskTitle }}</text>
      <text class="mask-sub">{{ maskSub }}</text>
      <button v-if="ready && !error" type="primary" class="action" @tap="start()">
        {{ phase === 'over' ? '再来一局' : '开始游戏' }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #d9dde6;
}
.gl {
  width: 100%;
  height: 100%;
  /* 画布自己吃长按，别让外层滚动或浏览器手势抢走 */
  touch-action: none;
}
.hud {
  position: absolute;
  left: 20px;
  top: 16px;
}
.score {
  font-size: 40px;
  font-weight: 700;
  color: #3b3563;
}
.popup {
  margin-top: 2px;
  font-size: 15px;
  font-weight: 700;
  color: #ff7043;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 24px;
  background-color: rgba(30, 28, 48, 0.55);
}
.mask-title {
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
}
.mask-sub {
  font-size: 14px;
  color: #e4e2ee;
  text-align: center;
  line-height: 1.7;
}
.action {
  margin-top: 14px;
  width: 184px;
}
</style>
