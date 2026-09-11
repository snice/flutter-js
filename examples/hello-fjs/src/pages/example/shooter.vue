<route>
{"title": "3D 飞机大战", "scroll": false, "group": "交互游戏", "desc": "three.js 持续渲染，拖动战机自动开火"}
</route>

<script setup lang="ts">
// 3D 飞机大战（spec 032）：three.js 的「持续渲染」示例 —— 两个 glTF 查看器是
// 按需画一帧，这一页每帧几十个物体在动。
//
// 三件事决定了这页的写法，都跟 App 端的 GL 是「命令流」有关：
//
// 1. **draw call 要少**。每个 draw call 在 App 端都是一串 uniform 上传。飞机的
//    零件合成一个 Mesh（顶点色区分部位）；子弹 / 敌弹 / 碎片各是一个 Batch，
//    一批只有一次 draw call。
// 2. **没有 instancing**。`@ufjs/webgl` 没有 drawElementsInstanced，所以不能用
//    InstancedMesh —— Batch 就是它的替代：CPU 侧把每个小物体的顶点写进一块
//    预分配的缓冲，只上传用到的那一段。
// 3. **shader 在 ready 之后一次编完**。对象池初始化时就建好（隐藏），首帧前
//    renderer.compile()；过早查询 ACTIVE_UNIFORMS 会被 three 缓存成空表（spec 023）。
//
// polyfill 必须在 three 之前 import：ESM 按声明顺序执行模块。web 端它是空操作。
import '@/three/native-polyfills';
import '@ufjs/webgl';
import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';

// ── 数值 ───────────────────────────────────────────────────────────────

const MAX_HP = 5;
const MAX_POWER = 4;
/** 被击中后的无敌时长（秒）。 */
const INVULN = 1.6;
const FIRE_INTERVAL = 0.12;
const BULLET_SPEED = 44;
/** 地面、浮石往后退的速度 —— 「前飞」全靠它。 */
const FLIGHT = 14;

const BG = 0x0a0f1f;
const CAMERA_POS = new THREE.Vector3(0, 24, 17);
const CAMERA_TARGET = new THREE.Vector3(0, 0, -5);

type Phase = 'ready' | 'playing' | 'paused' | 'over';
type EnemyKind = 'scout' | 'fighter' | 'bomber';
type PickupKind = 'power' | 'heal';

interface KindSpec {
  hp: number;
  /** 碰撞盒半宽 / 半深（世界单位，xz 平面）。 */
  halfW: number;
  halfD: number;
  speed: number;
  score: number;
  /** 开火间隔，0 表示不开火。 */
  fireEvery: number;
  drop: number;
}

const SPECS: Record<EnemyKind, KindSpec> = {
  scout: { hp: 1, halfW: 1.7, halfD: 1.4, speed: 14, score: 100, fireEvery: 0, drop: 0.05 },
  fighter: { hp: 5, halfW: 2.3, halfD: 1.6, speed: 8, score: 300, fireEvery: 1.8, drop: 0.22 },
  bomber: { hp: 45, halfW: 4.8, halfD: 2.6, speed: 5, score: 2500, fireEvery: 0.9, drop: 1 },
};

/** 每级火力的弹道：[横向偏移, 偏角]。 */
const PATTERNS: Array<Array<[number, number]>> = [
  [[0, 0]],
  [
    [-0.45, 0],
    [0.45, 0],
  ],
  [
    [0, 0],
    [-0.55, -0.1],
    [0.55, 0.1],
  ],
  [
    [-0.3, 0],
    [0.3, 0],
    [-0.7, -0.12],
    [0.7, 0.12],
    [-0.9, -0.26],
    [0.9, 0.26],
  ],
];

interface Enemy {
  kind: EnemyKind;
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  active: boolean;
  hp: number;
  x: number;
  z: number;
  baseX: number;
  vx: number;
  weave: number;
  seed: number;
  t: number;
  fireCd: number;
  volley: number;
  glow: number;
}

interface Shot {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  spin: number;
  r: number;
  g: number;
  b: number;
}

interface Pickup {
  kind: PickupKind;
  mesh: THREE.Mesh;
  active: boolean;
  x: number;
  z: number;
  t: number;
}

// ── 页面状态（只放 HUD 要显示的，逐帧的量都是普通变量） ───────────────

const cv = ref<FjsCanvasApi>();
const phase = ref<Phase>('ready');
const ready = ref(false);
const error = ref('');
const score = ref(0);
const best = ref(0);
const hp = ref(3);
const power = ref(1);

const hearts = computed(
  () => '♥'.repeat(Math.max(0, hp.value)) + '♡'.repeat(Math.max(0, MAX_HP - hp.value)),
);

const maskTitle = computed(() => {
  if (error.value) return '无法启动';
  if (phase.value === 'paused') return '暂停中';
  if (phase.value === 'over') return '战机坠毁';
  return '3D 飞机大战';
});

const maskSub = computed(() => {
  if (error.value) return error.value;
  if (!ready.value) return '场景加载中…';
  if (phase.value === 'paused') return `当前得分 ${score.value}`;
  if (phase.value === 'over') return `得分 ${score.value} · 最高 ${best.value}`;
  return '按住画面拖动战机，自动开火\n绿色道具升级火力，粉色道具回血';
});

const maskAction = computed(() => {
  if (phase.value === 'paused') return '继续';
  if (phase.value === 'over') return '再来一局';
  return '开始游戏';
});

// ── 模型：零件合成一个几何体 ─────────────────────────────────────────

const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

function at(
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    tmpQuat.setFromEuler(tmpEuler.set(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** 一个零件：摆好位置，整块刷成一种顶点色。uv 删掉，合并要求属性集一致。 */
function part(geo: THREE.BufferGeometry, color: number, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 零件都按「机头朝 -z」拼；敌机朝玩家飞，turn 掉个头。 */
function merge(parts: THREE.BufferGeometry[], turn = false): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('shooter: mergeGeometries failed');
  if (turn) g.rotateY(Math.PI);
  g.computeBoundingSphere();
  return g;
}

const HALF_PI = Math.PI / 2;

function playerGeometry(): THREE.BufferGeometry {
  const body = 0xe2e8f0;
  const wing = 0x2563eb;
  return merge([
    part(new THREE.CylinderGeometry(0.5, 0.34, 3.2, 8), body, at(0, 0, 0, HALF_PI)),
    part(new THREE.ConeGeometry(0.34, 1.3, 8), body, at(0, 0, -2.25, -HALF_PI)),
    part(new THREE.SphereGeometry(0.32, 10, 6), 0x67e8f9, at(0, 0.3, -0.8, 0, 0, 0, 1, 0.8, 2.2)),
    part(new THREE.BoxGeometry(2.6, 0.1, 1.1), wing, at(-1.35, -0.05, 0.35, 0, 0.32, 0)),
    part(new THREE.BoxGeometry(2.6, 0.1, 1.1), wing, at(1.35, -0.05, 0.35, 0, -0.32, 0)),
    part(new THREE.BoxGeometry(1.3, 0.08, 0.6), wing, at(-0.6, 0, 1.45, 0, 0.35, 0)),
    part(new THREE.BoxGeometry(1.3, 0.08, 0.6), wing, at(0.6, 0, 1.45, 0, -0.35, 0)),
    part(new THREE.BoxGeometry(0.08, 0.9, 0.8), wing, at(0, 0.5, 1.35)),
    part(new THREE.CylinderGeometry(0.3, 0.3, 0.35, 8), 0x2a2f3a, at(0, 0, 1.75, HALF_PI)),
  ]);
}

function enemyGeometry(kind: EnemyKind): THREE.BufferGeometry {
  if (kind === 'scout') {
    const body = 0xe5484d;
    const wing = 0x9b2c3a;
    return merge(
      [
        part(new THREE.CylinderGeometry(0.42, 0.28, 2.0, 6), body, at(0, 0, 0, HALF_PI)),
        part(new THREE.ConeGeometry(0.28, 1.0, 6), body, at(0, 0, -1.5, -HALF_PI)),
        part(new THREE.SphereGeometry(0.26, 8, 5), 0xffd166, at(0, 0.22, -0.4, 0, 0, 0, 1, 0.8, 1.8)),
        part(new THREE.BoxGeometry(1.8, 0.08, 1.2), wing, at(-0.85, 0, 0.35, 0, 0.5, 0)),
        part(new THREE.BoxGeometry(1.8, 0.08, 1.2), wing, at(0.85, 0, 0.35, 0, -0.5, 0)),
        part(new THREE.BoxGeometry(0.06, 0.6, 0.6), body, at(0, 0.3, 0.8)),
      ],
      true,
    );
  }
  if (kind === 'fighter') {
    const body = 0xf59e0b;
    const wing = 0xb45309;
    return merge(
      [
        part(new THREE.CylinderGeometry(0.32, 0.32, 2.8, 8), body, at(-0.7, 0, 0, HALF_PI)),
        part(new THREE.CylinderGeometry(0.32, 0.32, 2.8, 8), body, at(0.7, 0, 0, HALF_PI)),
        part(new THREE.ConeGeometry(0.32, 0.8, 8), body, at(-0.7, 0, -1.8, -HALF_PI)),
        part(new THREE.ConeGeometry(0.32, 0.8, 8), body, at(0.7, 0, -1.8, -HALF_PI)),
        part(new THREE.SphereGeometry(0.5, 10, 6), 0x7dd3fc, at(0, 0.15, -0.5, 0, 0, 0, 1, 0.8, 1.6)),
        part(new THREE.BoxGeometry(4.6, 0.12, 1.1), wing, at(0, 0, 0.1)),
        part(new THREE.BoxGeometry(0.08, 0.7, 0.7), body, at(-0.7, 0.4, 1.1)),
        part(new THREE.BoxGeometry(0.08, 0.7, 0.7), body, at(0.7, 0.4, 1.1)),
      ],
      true,
    );
  }
  const body = 0x7c3aed;
  const wing = 0x5b21b6;
  const engine = 0x1f2937;
  return merge(
    [
      part(new THREE.CylinderGeometry(1.0, 0.7, 5.2, 10), body, at(0, 0, 0, HALF_PI)),
      part(new THREE.ConeGeometry(0.7, 1.6, 10), body, at(0, 0, -3.4, -HALF_PI)),
      part(new THREE.SphereGeometry(0.6, 10, 6), 0xf0abfc, at(0, 0.55, -1.6, 0, 0, 0, 1, 0.7, 1.8)),
      part(new THREE.BoxGeometry(5, 0.3, 2.4), wing, at(-2.6, 0, 0.5, 0, 0.28, 0)),
      part(new THREE.BoxGeometry(5, 0.3, 2.4), wing, at(2.6, 0, 0.5, 0, -0.28, 0)),
      part(new THREE.CylinderGeometry(0.38, 0.38, 1.6, 8), engine, at(-1.9, -0.3, 0.9, HALF_PI)),
      part(new THREE.CylinderGeometry(0.38, 0.38, 1.6, 8), engine, at(1.9, -0.3, 0.9, HALF_PI)),
      part(new THREE.CylinderGeometry(0.34, 0.34, 1.4, 8), engine, at(-3.6, -0.25, 1.4, HALF_PI)),
      part(new THREE.CylinderGeometry(0.34, 0.34, 1.4, 8), engine, at(3.6, -0.25, 1.4, HALF_PI)),
      part(new THREE.SphereGeometry(0.22, 6, 4), 0xff4d6d, at(-4.9, 0.15, 1.6)),
      part(new THREE.SphereGeometry(0.22, 6, 4), 0xff4d6d, at(4.9, 0.15, 1.6)),
      part(new THREE.BoxGeometry(2.6, 0.1, 0.9), wing, at(0, 0.1, 2.5)),
      part(new THREE.BoxGeometry(0.12, 1.2, 1.0), body, at(0, 0.7, 2.3)),
    ],
    true,
  );
}

// ── Batch：一批小物体，一次 draw call ─────────────────────────────────

/** InstancedMesh 的替代品（`@ufjs/webgl` 没有 instanced draw）。
 *
 * 顶点缓冲按容量一次分配好，每帧 begin → push… → end。只做绕 y 旋转 + 等比缩放，
 * 子弹和碎片用不上更多。材质是 unlit 的，所以按法线的 y 分量把明暗烤进顶点色，
 * 碎片才看得出是立体的。end() 只上传用到的那一段，而不是整块缓冲。 */
class Batch {
  readonly mesh: THREE.Mesh;
  private readonly shape: Float32Array;
  private readonly shade: Float32Array;
  private readonly verts: number;
  private readonly capacity: number;
  private readonly position: THREE.BufferAttribute;
  private readonly color: THREE.BufferAttribute;
  private used = 0;

  constructor(shape: THREE.BufferGeometry, capacity: number, material: THREE.Material) {
    const flat = shape.index ? shape.toNonIndexed() : shape;
    flat.computeVertexNormals();
    this.shape = Float32Array.from(flat.getAttribute('position').array as ArrayLike<number>);
    this.verts = this.shape.length / 3;
    this.capacity = capacity;
    const normals = flat.getAttribute('normal');
    this.shade = new Float32Array(this.verts);
    for (let i = 0; i < this.verts; i++) this.shade[i] = 0.55 + 0.45 * Math.abs(normals.getY(i));

    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * this.verts * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.BufferAttribute(new Float32Array(capacity * this.verts * 3), 3);
    this.color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('color', this.color);
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geometry, material);
    // 顶点每帧在变，包围球永远是旧的；干脆不裁剪
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.used = 0;
  }

  push(x: number, y: number, z: number, scale: number, spin: number, r: number, g: number, b: number): void {
    if (this.used >= this.capacity) return;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const p = this.position.array as Float32Array;
    const c = this.color.array as Float32Array;
    let o = this.used * this.verts * 3;
    for (let i = 0; i < this.verts; i++) {
      const lx = this.shape[i * 3] * scale;
      const ly = this.shape[i * 3 + 1] * scale;
      const lz = this.shape[i * 3 + 2] * scale;
      p[o] = x + lx * cos + lz * sin;
      p[o + 1] = y + ly;
      p[o + 2] = z - lx * sin + lz * cos;
      const s = this.shade[i];
      c[o] = r * s;
      c[o + 1] = g * s;
      c[o + 2] = b * s;
      o += 3;
    }
    this.used++;
  }

  end(): void {
    const n = this.used * this.verts;
    this.mesh.geometry.setDrawRange(0, n);
    if (n === 0) return;
    for (const attr of [this.position, this.color]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
  }
}

// ── three 与宿主 canvas 的衔接（同 three-gltf.vue） ─────────────────────

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
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
const bgBase = new THREE.Color(BG);
const bgHit = new THREE.Color(0x5a0d1e);

let player: THREE.Group;
let exhaust: THREE.Mesh;
let grid: THREE.GridHelper;
const rocks: THREE.Mesh[] = [];
const enemies: Enemy[] = [];
const pickups: Pickup[] = [];
const enemyGeo = {} as Record<EnemyKind, THREE.BufferGeometry>;
const pickupMaterial = {} as Record<PickupKind, THREE.MeshLambertMaterial>;
let pickupGeo: THREE.BufferGeometry;
let shotBatch: Batch;
let enemyShotBatch: Batch;
let sparkBatch: Batch;

/** 可活动范围与刷怪 / 回收线，都在 computeBounds() 里从相机反推。 */
const world = { xHalf: 6, zMin: -8, zMax: 8, spawnZ: -60, despawnZ: 20, xSpawn: 8, unitX: 0.05, unitZ: 0.05 };

function buildScene(): void {
  scene.background = bgBase.clone();
  // 雾把刷怪线附近的敌机淡进来，也盖住网格的尽头
  scene.fog = new THREE.Fog(BG, 50, 95);

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1f2e, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-6, 20, 10);
  scene.add(sun);

  grid = new THREE.GridHelper(240, 60, 0x1e40af, 0x172554);
  grid.position.y = -12;
  scene.add(grid);

  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  // 非索引几何上重算法线 = 面法线，低多边形的棱角才出得来
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
  for (let i = 0; i < 12; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    placeRock(rock, -95 + Math.random() * 110);
    scene.add(rock);
    rocks.push(rock);
  }

  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  player = new THREE.Group();
  player.add(new THREE.Mesh(playerGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true })));
  exhaust = new THREE.Mesh(
    part(new THREE.ConeGeometry(0.28, 1.4, 8), 0xffa94d, at(0, 0, 0, HALF_PI)),
    glowMat,
  );
  exhaust.position.z = 2.65;
  player.add(exhaust);
  scene.add(player);

  for (const kind of Object.keys(SPECS) as EnemyKind[]) enemyGeo[kind] = enemyGeometry(kind);
  // 对象池先建好：compile() 能一次编完所有 shader，游戏中也不再分配
  for (let i = 0; i < 12; i++) makeEnemy('scout');
  for (let i = 0; i < 6; i++) makeEnemy('fighter');
  makeEnemy('bomber');

  pickupGeo = new THREE.OctahedronGeometry(0.75, 0);
  pickupGeo.computeVertexNormals();
  pickupMaterial.power = new THREE.MeshLambertMaterial({ color: 0x22c55e, emissive: 0x0f5132 });
  pickupMaterial.heal = new THREE.MeshLambertMaterial({ color: 0xf472b6, emissive: 0x6b1840 });
  makePickup('power');
  makePickup('heal');

  shotBatch = new Batch(new THREE.PlaneGeometry(0.24, 1.3).rotateX(-HALF_PI), 160, glowMat);
  enemyShotBatch = new Batch(new THREE.OctahedronGeometry(0.34, 0), 120, glowMat);
  sparkBatch = new Batch(new THREE.TetrahedronGeometry(0.45, 0), 320, glowMat);
  scene.add(shotBatch.mesh, enemyShotBatch.mesh, sparkBatch.mesh);

  player.position.set(0, 0, world.zMax - 2);
}

function placeRock(rock: THREE.Mesh, z: number): void {
  const side = Math.random() < 0.5 ? -1 : 1;
  rock.position.set(side * (5 + Math.random() * 26), -9 + Math.random() * 4, z);
  rock.scale.setScalar(0.8 + Math.random() * 2);
  rock.rotation.set(Math.random() * 6, Math.random() * 6, 0);
}

function makeEnemy(kind: EnemyKind): Enemy {
  // 每架一份材质：受击发白要单独改 emissive。参数相同，three 复用同一个 program
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(enemyGeo[kind], material);
  mesh.visible = false;
  scene.add(mesh);
  const enemy: Enemy = {
    kind,
    mesh,
    material,
    active: false,
    hp: 0,
    x: 0,
    z: 0,
    baseX: 0,
    vx: 0,
    weave: 0,
    seed: 0,
    t: 0,
    fireCd: 0,
    volley: 0,
    glow: 0,
  };
  enemies.push(enemy);
  return enemy;
}

function makePickup(kind: PickupKind): Pickup {
  const mesh = new THREE.Mesh(pickupGeo, pickupMaterial[kind]);
  mesh.visible = false;
  scene.add(mesh);
  const pickup: Pickup = { kind, mesh, active: false, x: 0, z: 0, t: 0 };
  pickups.push(pickup);
  return pickup;
}

// ── 相机与边界 ───────────────────────────────────────────────────────

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

/** 屏幕上的一个 NDC 点落在 y=0 平面的哪里。返回的是共享向量，读完就用。 */
function groundAt(nx: number, ny: number): THREE.Vector3 | null {
  ndc.set(nx, ny);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, hitPoint);
}

/** 从相机反推所有边界：横屏竖屏、任何尺寸都对，不写死数字。 */
function computeBounds(width: number, height: number): void {
  camera.updateMatrixWorld();
  const edge = groundAt(0.86, -0.82);
  if (edge) {
    world.xHalf = Math.max(2, Math.abs(edge.x) - 1);
    world.zMax = edge.z;
  }
  const mid = groundAt(0, 0);
  if (mid) world.zMin = mid.z;
  const top = groundAt(0.9, 1);
  if (top) {
    world.spawnZ = top.z - 8;
    world.xSpawn = Math.min(Math.abs(top.x) * 0.8, world.xHalf * 1.6);
  } else {
    world.spawnZ = -60;
    world.xSpawn = world.xHalf * 1.4;
  }
  const bottom = groundAt(0, -1.2);
  world.despawnZ = (bottom ? bottom.z : world.zMax + 6) + 5;

  // 拖动增益：在战机所在的那一带量「每像素多少世界单位」。用手指当前位置的
  // 射线求交会让屏幕上方的拖动特别快（透视），手感不稳。
  const a = groundAt(0, -0.5);
  if (a) {
    const ax = a.x;
    const az = a.z;
    const b = groundAt(0.1, -0.5);
    if (b && width > 0) world.unitX = Math.abs(b.x - ax) / (0.05 * width);
    const c = groundAt(0, -0.6);
    if (c && height > 0) world.unitZ = Math.abs(c.z - az) / (0.05 * height);
  }
}

// ── 玩法 ─────────────────────────────────────────────────────────────

const shots: Shot[] = [];
const enemyShots: Shot[] = [];
const sparks: Spark[] = [];

let px = 0;
let pz = 0;
let tx = 0;
let tz = 0;
let bank = 0;
let alive = true;
let dying = 0;
let invuln = 0;
let fireCd = 0;
let spawnCd = 0;
let bomberCd = 0;
let elapsed = 0;
let clock = 0;
let shake = 0;
let flashT = 0;
let gridScroll = 0;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = THREE.MathUtils.clamp;

function removeAt<T>(list: T[], i: number): void {
  list[i] = list[list.length - 1];
  list.pop();
}

function reset(): void {
  for (const e of enemies) {
    e.active = false;
    e.mesh.visible = false;
  }
  for (const p of pickups) {
    p.active = false;
    p.mesh.visible = false;
  }
  shots.length = 0;
  enemyShots.length = 0;
  sparks.length = 0;
  score.value = 0;
  hp.value = 3;
  power.value = 1;
  elapsed = 0;
  spawnCd = 1.2;
  bomberCd = 30;
  fireCd = 0;
  invuln = 1;
  alive = true;
  dying = 0;
  shake = 0;
  flashT = 0;
  px = tx = 0;
  pz = tz = world.zMax - 2;
  bank = 0;
  player.visible = true;
}

function start(): void {
  if (!ready.value) return;
  if (phase.value === 'paused') {
    phase.value = 'playing';
  } else {
    reset();
    phase.value = 'playing';
  }
  last = 0;
}

function togglePause(): void {
  if (phase.value === 'playing') {
    phase.value = 'paused';
    dirty = true;
  } else if (phase.value === 'paused') {
    phase.value = 'playing';
    last = 0;
  }
}

function update(dt: number): void {
  elapsed += dt;
  // 0 → 1：两分半钟到顶
  const hard = Math.min(elapsed / 150, 1);

  if (alive) {
    const follow = 1 - Math.exp(-dt * 18);
    const nx = px + (tx - px) * follow;
    const vx = (nx - px) / dt;
    px = nx;
    pz += (tz - pz) * follow;
    // 往右移 → 右翼压低（绕 z 轴负向滚转）
    bank += (clamp(-vx * 0.06, -0.7, 0.7) - bank) * (1 - Math.exp(-dt * 10));
    player.position.set(px, Math.sin(clock * 2) * 0.15, pz);
    player.rotation.z = bank;

    invuln = Math.max(0, invuln - dt);
    player.visible = invuln === 0 || Math.floor(invuln * 14) % 2 === 0;

    fireCd -= dt;
    if (fireCd <= 0) {
      fire();
      fireCd += FIRE_INTERVAL;
    }
  } else {
    dying -= dt;
    if (dying <= 0) {
      phase.value = 'over';
      if (score.value > best.value) best.value = score.value;
    }
  }

  spawnCd -= dt;
  if (spawnCd <= 0) {
    spawnWave(hard);
    spawnCd = (1.25 - hard * 0.7) * rand(0.7, 1.3);
  }
  bomberCd -= dt;
  if (bomberCd <= 0 && !enemies.some((e) => e.active && e.kind === 'bomber')) {
    spawnEnemy('bomber', 0, world.spawnZ - 6);
    bomberCd = 38 - hard * 12;
  }

  updateShots(dt);
  updateEnemies(dt, hard);
  updatePickups(dt);
}

function fire(): void {
  for (const [offset, angle] of PATTERNS[power.value - 1]) {
    shots.push({
      x: px + offset,
      z: pz - 2.6,
      vx: Math.sin(angle) * BULLET_SPEED,
      vz: -Math.cos(angle) * BULLET_SPEED,
    });
  }
}

function spawnWave(hard: number): void {
  const roll = Math.random();
  if (elapsed > 8 && roll < 0.18 + hard * 0.1) {
    // V 字编队：五架侦察机，领队在前
    const cx = rand(-world.xSpawn * 0.5, world.xSpawn * 0.5);
    for (let i = -2; i <= 2; i++) spawnEnemy('scout', cx + i * 2.2, world.spawnZ - Math.abs(i) * 2.4);
  } else if (elapsed > 5 && roll < 0.5 + hard * 0.15) {
    spawnEnemy('fighter', rand(-world.xSpawn, world.xSpawn), world.spawnZ);
  } else {
    spawnEnemy('scout', rand(-world.xSpawn, world.xSpawn), world.spawnZ, rand(1, 3));
  }
}

function spawnEnemy(kind: EnemyKind, x: number, z: number, weave = 0): void {
  const e = enemies.find((it) => !it.active && it.kind === kind) ?? makeEnemy(kind);
  const spec = SPECS[kind];
  e.active = true;
  e.hp = spec.hp;
  e.x = e.baseX = x;
  e.z = z;
  e.vx = 0;
  e.weave = weave;
  e.seed = Math.random() * Math.PI * 2;
  e.t = 0;
  e.fireCd = spec.fireEvery * rand(0.5, 1);
  e.volley = 0;
  e.glow = 0;
  e.material.emissive.setScalar(0);
  e.mesh.position.set(x, 0, z);
  e.mesh.rotation.set(0, 0, 0);
  e.mesh.visible = true;
}

/** 子弹走得快，一帧能跨过侦察机整个碰撞盒 —— 所以按这一帧扫过的线段判。 */
function sweepHits(s: Shot, dt: number, cx: number, cz: number, halfW: number, halfD: number): boolean {
  if (Math.abs(s.x - cx) > halfW) return false;
  const z0 = s.z - s.vz * dt;
  return Math.max(z0, s.z) > cz - halfD && Math.min(z0, s.z) < cz + halfD;
}

function updateShots(dt: number): void {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    let gone = s.z < world.spawnZ - 10 || Math.abs(s.x) > 60;
    if (!gone) {
      for (const e of enemies) {
        // 还在雾里的不算：打不到看不见的东西
        if (!e.active || e.z < world.spawnZ + 4) continue;
        const spec = SPECS[e.kind];
        if (sweepHits(s, dt, e.x, e.z, spec.halfW, spec.halfD)) {
          burst(s.x, e.z + spec.halfD * 0.5, 3, 7, 0.35, [0.6, 0.9, 1]);
          damage(e, 1);
          gone = true;
          break;
        }
      }
    }
    if (gone) removeAt(shots, i);
  }

  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    let gone = s.z > world.despawnZ || s.z < world.spawnZ - 10 || Math.abs(s.x) > 60;
    // 玩家的判定盒故意比机身小：擦着机翼过去不算
    if (!gone && alive && invuln === 0 && sweepHits(s, dt, px, pz, 0.6, 0.9)) {
      hurt();
      gone = true;
    }
    if (gone) removeAt(enemyShots, i);
  }
}

function updateEnemies(dt: number, hard: number): void {
  const speedMul = 1 + hard * 0.6;
  for (const e of enemies) {
    if (!e.active) continue;
    const spec = SPECS[e.kind];
    const prevX = e.x;
    e.t += dt;

    if (e.kind === 'scout') {
      e.z += spec.speed * speedMul * dt;
      e.x = e.baseX + Math.sin(e.t * 2.4 + e.seed) * e.weave;
    } else if (e.kind === 'fighter') {
      e.z += spec.speed * speedMul * dt;
      const want = clamp(px - e.x, -1, 1) * 3.5;
      e.vx += (want - e.vx) * (1 - Math.exp(-dt * 1.5));
      e.x += e.vx * dt;
    } else if (e.t < 24) {
      // 轰炸机：飞到上半屏悬停，左右扫射；一段时间没被打掉就撤
      e.z += (world.zMin - 4 - e.z) * (1 - Math.exp(-dt * 0.8));
      e.x = Math.sin(e.t * 0.55) * world.xHalf * 0.7;
    } else {
      e.z += spec.speed * 2 * dt;
    }

    e.mesh.position.set(e.x, 0, e.z);
    e.mesh.rotation.z = clamp(-((e.x - prevX) / dt) * 0.08, -0.6, 0.6);

    if (e.glow > 0) {
      e.glow = Math.max(0, e.glow - dt * 6);
      e.material.emissive.setScalar(e.glow * 0.8);
    }

    if (spec.fireEvery && alive) {
      e.fireCd -= dt;
      if (e.fireCd <= 0 && e.z > world.spawnZ + 10 && e.z < pz - 4) {
        e.fireCd = spec.fireEvery * rand(0.8, 1.2) * (1 - hard * 0.35);
        enemyFire(e);
      }
    }

    if (e.z > world.despawnZ) {
      e.active = false;
      e.mesh.visible = false;
      continue;
    }

    if (
      alive &&
      invuln === 0 &&
      Math.abs(e.x - px) < spec.halfW * 0.7 + 0.9 &&
      Math.abs(e.z - pz) < spec.halfD * 0.7 + 1
    ) {
      hurt();
      damage(e, e.kind === 'bomber' ? 3 : 99);
    }
  }
}

function enemyFire(e: Enemy): void {
  const shoot = (angle: number, speed: number) =>
    enemyShots.push({ x: e.x, z: e.z + 1.5, vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed });
  // 角度从 +z 量起，正好是敌机朝向
  const aim = Math.atan2(px - e.x, pz - e.z);
  if (e.kind === 'fighter') {
    shoot(aim, 15);
    return;
  }
  e.volley++;
  if (e.volley % 3 === 0) {
    for (let i = 0; i < 14; i++) shoot((i / 14) * Math.PI * 2 + e.t, 9);
  } else {
    for (let i = -2; i <= 2; i++) shoot(aim + i * 0.22, 12);
  }
}

function damage(e: Enemy, amount: number): void {
  e.hp -= amount;
  e.glow = 1;
  if (e.hp > 0) return;

  e.active = false;
  e.mesh.visible = false;
  score.value += SPECS[e.kind].score;
  if (e.kind === 'bomber') {
    burst(e.x, e.z, 110, 18, 1.6);
    shake = Math.max(shake, 1.5);
    dropPickup('power', e.x - 1.5, e.z);
    dropPickup('heal', e.x + 1.5, e.z);
    return;
  }
  burst(e.x, e.z, e.kind === 'fighter' ? 40 : 24, e.kind === 'fighter' ? 11 : 9, 1);
  shake = Math.max(shake, 0.3);
  if (Math.random() < SPECS[e.kind].drop) {
    dropPickup(hp.value < 3 && Math.random() < 0.4 ? 'heal' : 'power', e.x, e.z);
  }
}

function hurt(): void {
  hp.value -= 1;
  invuln = INVULN;
  shake = Math.max(shake, 0.9);
  flashT = 1;
  power.value = Math.max(1, power.value - 1);
  burst(px, pz, 16, 8, 0.8);
  if (hp.value > 0) return;

  alive = false;
  dying = 1.8;
  player.visible = false;
  burst(px, pz, 120, 16, 1.5);
  shake = 1.8;
}

function dropPickup(kind: PickupKind, x: number, z: number): void {
  const p = pickups.find((it) => !it.active && it.kind === kind) ?? makePickup(kind);
  p.active = true;
  p.x = x;
  p.z = z;
  p.t = 0;
  p.mesh.visible = true;
  p.mesh.position.set(x, 0, z);
}

function updatePickups(dt: number): void {
  for (const p of pickups) {
    if (!p.active) continue;
    p.t += dt;
    p.z += 6 * dt;
    p.mesh.position.set(p.x, Math.sin(p.t * 4) * 0.3, p.z);
    p.mesh.rotation.y = p.t * 3;
    if (p.z > world.despawnZ) {
      p.active = false;
      p.mesh.visible = false;
      continue;
    }
    if (alive && Math.abs(p.x - px) < 1.8 && Math.abs(p.z - pz) < 1.8) {
      p.active = false;
      p.mesh.visible = false;
      if (p.kind === 'heal') {
        hp.value = Math.min(MAX_HP, hp.value + 1);
      } else if (power.value < MAX_POWER) {
        power.value += 1;
      } else {
        score.value += 500;
      }
      burst(p.x, p.z, 14, 6, 0.6, p.kind === 'heal' ? [1, 0.45, 0.75] : [0.35, 1, 0.5]);
    }
  }
}

const FIRE_PALETTE: Array<[number, number, number]> = [
  [1, 0.85, 0.4],
  [1, 0.5, 0.15],
  [1, 0.95, 0.8],
  [0.9, 0.25, 0.1],
];

function burst(
  x: number,
  z: number,
  count: number,
  speed: number,
  size: number,
  tint?: [number, number, number],
): void {
  for (let i = 0; i < count && sparks.length < 320; i++) {
    const angle = Math.random() * Math.PI * 2;
    const v = speed * rand(0.25, 1);
    const [r, g, b] = tint ?? FIRE_PALETTE[(Math.random() * FIRE_PALETTE.length) | 0];
    const life = rand(0.45, 1.1);
    sparks.push({
      x,
      y: 0,
      z,
      vx: Math.cos(angle) * v,
      vy: rand(-0.3, 0.8) * v,
      vz: Math.sin(angle) * v,
      life,
      max: life,
      size: size * rand(0.5, 1.4),
      spin: Math.random() * 6,
      r,
      g,
      b,
    });
  }
}

/** 暂停时不跑：地面、浮石、碎片、尾焰，以及抖动 / 闪红的衰减。 */
function scenery(dt: number): void {
  clock += dt;
  gridScroll = (gridScroll + FLIGHT * dt) % 4;
  grid.position.z = gridScroll;

  for (const rock of rocks) {
    rock.position.z += FLIGHT * dt;
    rock.rotation.x += dt * 0.3;
    if (rock.position.z > world.despawnZ + 10) placeRock(rock, world.spawnZ - rand(20, 40));
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    const drag = Math.exp(-dt * 2.5);
    s.vx *= drag;
    s.vy *= drag;
    s.vz *= drag;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt + FLIGHT * 0.3 * dt;
    s.spin += dt * 5;
    s.life -= dt;
    if (s.life <= 0) removeAt(sparks, i);
  }

  exhaust.scale.set(1, 1, 0.75 + Math.random() * 0.55);
  shake *= Math.exp(-dt * 5);
  flashT = Math.max(0, flashT - dt * 3);
  (scene.background as THREE.Color).copy(bgBase).lerp(bgHit, flashT * 0.8);
}

/** 标题 / 结束画面：战机在下方悬停晃动。 */
function idle(): void {
  if (!alive) return;
  player.position.set(Math.sin(clock * 0.7) * 1.2, Math.sin(clock * 2) * 0.2, world.zMax - 3);
  player.rotation.z = -Math.cos(clock * 0.7) * 0.25;
}

// ── 循环 ─────────────────────────────────────────────────────────────

let raf = 0;
let last = 0;
/** 暂停时不渲染；尺寸变了要补一帧，由它标记。 */
let dirty = false;
const shakeOffset = new THREE.Vector3();

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

  if (phase.value === 'paused') {
    if (dirty) draw();
    return;
  }
  if (phase.value === 'playing') {
    update(dt);
  } else {
    idle();
    // 结束画面里剩下的敌机、子弹、道具照常飞走，不刷新怪也不开火（alive 为
    // false）——只停 update() 的话它们会定在半空，而地面还在往后退
    if (phase.value === 'over') {
      updateShots(dt);
      updateEnemies(dt, 0);
      updatePickups(dt);
    }
  }
  scenery(dt);
  draw();
}

function draw(): void {
  if (!renderer) return;
  dirty = false;

  shotBatch.begin();
  for (const s of shots) shotBatch.push(s.x, 0, s.z, 1, Math.atan2(-s.vx, -s.vz), 0.55, 0.95, 1);
  shotBatch.end();

  enemyShotBatch.begin();
  for (const s of enemyShots) enemyShotBatch.push(s.x, 0, s.z, 1, clock * 6, 1, 0.3, 0.6);
  enemyShotBatch.end();

  sparkBatch.begin();
  for (const s of sparks) {
    // 加法混合下颜色压暗就是淡出，不需要透明度
    const k = s.life / s.max;
    sparkBatch.push(s.x, s.y, s.z, s.size * (0.4 + k * 0.6), s.spin, s.r * k, s.g * k, s.b * k);
  }
  sparkBatch.end();

  // 抖动只在 render 这一下临时加上：触摸求交用的始终是没抖的相机
  shakeOffset.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(shake * 0.5);
  camera.position.add(shakeOffset);
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  camera.position.sub(shakeOffset);
  camera.updateMatrixWorld();
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

// 路由是 keep-alive 的：离开就停帧回调，正在玩的局转成暂停
onActivated(startLoop);
onDeactivated(() => {
  stopLoop();
  if (phase.value === 'playing') phase.value = 'paused';
  dragging = false;
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
  camera.aspect = width / (height || 1);
  // 竖屏视野窄，把垂直视角放大一点，屏幕上方才看得到来袭的敌机
  camera.fov = camera.aspect < 0.75 ? 58 : 46;
  camera.updateProjectionMatrix();
  camera.position.copy(CAMERA_POS);
  camera.lookAt(CAMERA_TARGET);
  computeBounds(width, height);
  tx = clamp(tx, -world.xHalf, world.xHalf);
  tz = clamp(tz, world.zMin, world.zMax);
  dirty = true;
  startLoop();
}

let dragging = false;
let lastX = 0;
let lastY = 0;

function onTouchStart(e: FjsTouchEvent): void {
  const t = e.touches[0];
  if (!t) return;
  dragging = true;
  lastX = t.offsetX;
  lastY = t.offsetY;
}

/** 相对拖动：战机跟手指的位移走，不跳到手指底下（手指会挡住战机）。 */
function onTouchMove(e: FjsTouchEvent): void {
  const t = e.touches[0];
  if (!t || !dragging) return;
  const dx = t.offsetX - lastX;
  const dy = t.offsetY - lastY;
  lastX = t.offsetX;
  lastY = t.offsetY;
  if (phase.value !== 'playing' || !alive) return;
  tx = clamp(tx + dx * world.unitX * 1.25, -world.xHalf, world.xHalf);
  tz = clamp(tz + dy * world.unitZ * 1.25, world.zMin, world.zMax);
}

function onTouchEnd(): void {
  dragging = false;
}
</script>

<template>
  <view class="page">
    <view class="hud">
      <view class="stat">
        <text class="k">得分</text>
        <text class="v">{{ score }}</text>
      </view>
      <view class="stat">
        <text class="k">生命</text>
        <text class="hearts">{{ hearts }}</text>
      </view>
      <view class="stat">
        <text class="k">火力</text>
        <text class="v">Lv {{ power }}</text>
      </view>
      <view
        class="pause"
        :class="{ dim: phase !== 'playing' && phase !== 'paused' }"
        @tap="togglePause()"
      >
        <text class="pause-glyph">{{ phase === 'paused' ? '▶' : 'Ⅱ' }}</text>
      </view>
    </view>

    <view class="stage">
      <canvas
        defer-resize
        ref="cv"
        class="gl"
        @resize="onResize"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      />
      <view v-if="phase !== 'playing'" class="mask">
        <text class="mask-title">{{ maskTitle }}</text>
        <text class="mask-sub">{{ maskSub }}</text>
        <button v-if="ready && !error" type="primary" class="action" @tap="start()">
          {{ maskAction }}
        </button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  padding: 10px 12px 12px;
  background-color: #070b16;
}
.hud {
  flex-direction: row;
  align-items: stretch;
  gap: 8px;
}
.stat {
  flex-grow: 1;
  flex-basis: 0;
  padding: 6px 0;
  align-items: center;
  border-radius: 8px;
  background-color: #111a2e;
}
.k {
  font-size: 11px;
  color: #7b8aa8;
}
.v {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 700;
  color: #e8eefc;
}
.hearts {
  margin-top: 2px;
  font-size: 15px;
  color: #ff5d7a;
}
.pause {
  width: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background-color: #1b2540;
}
/* 按下态照 WeUI：变深一档 */
.pause:active {
  background-color: #131b30;
}
.pause.dim {
  opacity: 0.4;
}
.pause-glyph {
  font-size: 16px;
  color: #cfd8ee;
}
.stage {
  position: relative;
  flex-grow: 1;
  margin-top: 10px;
  border-radius: 10px;
  overflow: hidden;
  background-color: #0a0f1f;
}
.gl {
  width: 100%;
  height: 100%;
  /* 画布自己吃拖动，别让外层滚动或浏览器手势抢走 */
  touch-action: none;
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
  background-color: rgba(7, 11, 22, 0.6);
}
.mask-title {
  font-size: 26px;
  font-weight: 700;
  color: #ffffff;
}
.mask-sub {
  font-size: 13px;
  color: #a9b4cc;
  text-align: center;
  line-height: 1.7;
}
.action {
  margin-top: 14px;
  width: 184px;
}
</style>
