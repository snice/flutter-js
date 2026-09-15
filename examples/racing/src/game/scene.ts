// 把一条赛道搭成 three.js 场景：天空、灯光、雾，路面 / 路肩 / 护栏网格，
// 关卡方块，路边的房子和广告牌，起跑线，四辆车。
//
// 网格生成照 flutter3d_game_racing/bridge.dart：沿中心线按曲率取站点（弯越急
// 站点越密，弦高误差 4cm），每个站点在横向上放两点，连成带子。
//
// App 端的 GL 是命令流，draw call 越少越好：石柱合成一个网格，同一种房子的
// 所有实例合成一个网格，广告牌的柱子合成一个网格。
import {
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { drawText } from './pixel-font';
import { TrackFrame, type TrackDocument, type TrackSpline } from './track';
import type { World } from './vehicle';

const linear = (c: number[]): Color => new Color().setRGB(c[0], c[1], c[2]);

// ── 站点 ─────────────────────────────────────────────────────────────────

const SAGITTA = 0.04;
const MIN_STEP = 1.5;
const MAX_STEP = 8;
const METRES_PER_TILE = 9;
const BARRIER_HEIGHT = 1.1;

function stations(track: TrackSpline): number[] {
  const out: number[] = [];
  let s = 0;
  while (s < track.length) {
    out.push(s);
    const bend = Math.abs(track.centre.curvatureAt(s));
    const wanted = bend < 1e-6 ? MAX_STEP : Math.sqrt((8 * SAGITTA) / bend);
    s += Math.min(MAX_STEP, Math.max(MIN_STEP, wanted));
  }
  out.push(track.length);
  return out;
}

interface Builder {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const builder = (): Builder => ({ positions: [], normals: [], uvs: [], indices: [] });

function vertex(b: Builder, p: Vector3, n: Vector3, u: number, v: number): number {
  b.positions.push(p.x, p.y, p.z);
  b.normals.push(n.x, n.y, n.z);
  b.uvs.push(u, v);
  return b.positions.length / 3 - 1;
}

function geometryOf(b: Builder): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(b.positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(b.normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(b.uvs, 2));
  g.setIndex(b.indices);
  g.computeBoundingSphere();
  return g;
}

/** 沿赛道的一条带子，横向从 inner(s) 到 outer(s)。顶点总按横向从小到大排，
 * 三角形逆时针朝上。 */
function ribbon(
  track: TrackSpline,
  all: number[],
  inner: (s: number) => number,
  outer: (s: number) => number,
  tile: number,
  lift = 0,
): BufferGeometry {
  const b = builder();
  const fr = new TrackFrame();
  const l = new Vector3();
  const r = new Vector3();
  let pl = -1;
  let pr = -1;
  for (const s of all) {
    track.frameAt(s, fr);
    const i = inner(s);
    const o = outer(s);
    const low = Math.min(i, o);
    const high = Math.max(i, o);
    l.copy(fr.position).addScaledVector(fr.right, low).addScaledVector(fr.up, lift);
    r.copy(fr.position).addScaledVector(fr.right, high).addScaledVector(fr.up, lift);
    const v = s / (METRES_PER_TILE * tile);
    const a = vertex(b, l, fr.up, 0, v);
    const c = vertex(b, r, fr.up, 1, v);
    if (pl >= 0) b.indices.push(pl, a, c, pl, c, pr);
    pl = a;
    pr = c;
  }
  return geometryOf(b);
}

function barriers(track: TrackSpline, all: number[], side: -1 | 1): BufferGeometry | null {
  const b = builder();
  const fr = new TrackFrame();
  const foot = new Vector3();
  const head = new Vector3();
  const normal = new Vector3();
  let pb = -1;
  let pt = -1;
  for (const s of all) {
    if (!track.barrierAt(s, side < 0)) {
      pb = -1;
      pt = -1;
      continue;
    }
    track.frameAt(s, fr);
    foot.copy(fr.position).addScaledVector(fr.right, (side * track.widthAt(s)) / 2);
    head.copy(foot).addScaledVector(fr.up, BARRIER_HEIGHT);
    normal.copy(fr.right).multiplyScalar(-side);
    const v = s / METRES_PER_TILE;
    const bottom = vertex(b, foot, normal, v, 1);
    const top = vertex(b, head, normal, v, 0);
    if (pb >= 0) b.indices.push(pb, bottom, top, pb, top, pt);
    pb = bottom;
    pt = top;
  }
  return b.indices.length ? geometryOf(b) : null;
}

function skirt(track: TrackSpline, all: number[], side: number, groundY: number): BufferGeometry {
  const b = builder();
  const fr = new TrackFrame();
  const top = new Vector3();
  const foot = new Vector3();
  const normal = new Vector3();
  let pt = -1;
  let pf = -1;
  for (const s of all) {
    track.frameAt(s, fr);
    top.copy(fr.position).addScaledVector(fr.right, side * (track.widthAt(s) / 2 + track.shoulder));
    top.y -= 0.01;
    foot.set(top.x, groundY - 0.5, top.z);
    normal.set(fr.right.x * side, 0, fr.right.z * side).normalize();
    const t = vertex(b, top, normal, 0, 0);
    const f = vertex(b, foot, normal, 0, 1);
    if (pt >= 0) b.indices.push(pt, pf, f, pt, f, t);
    pt = t;
    pf = f;
  }
  return geometryOf(b);
}

// ── 程序贴图 ─────────────────────────────────────────────────────────────

function dataTexture(data: Uint8Array<ArrayBuffer>, w: number, h: number, repeat: boolean, nearest = false): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  if (nearest) {
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
  } else {
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
  }
  t.needsUpdate = true;
  return t;
}

/** 可重复的伪随机，贴图每次生成都一样。 */
function noise(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1000) / 1000;
  };
}

/** 沥青：细颗粒 + 两侧白线。u 横跨路面，v 沿赛道每 9 米一格。 */
function asphaltTexture(): DataTexture {
  const w = 128;
  const h = 64;
  const d = new Uint8Array(w * h * 4);
  const rnd = noise(7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grain = 114 + rnd() * 12;
      let r = grain;
      let g = grain;
      let b = grain + 4;
      const u = x / w;
      if ((u > 0.025 && u < 0.05) || (u > 0.95 && u < 0.975)) {
        r = g = b = 222;
      } else if (u > 0.493 && u < 0.507 && y < h * 0.45) {
        // 中线虚线
        r = g = b = 200;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  return dataTexture(d, w, h, true);
}

function grassTexture(): DataTexture {
  const w = 64;
  const d = new Uint8Array(w * w * 4);
  const rnd = noise(11);
  for (let i = 0; i < w * w; i++) {
    // 贴图只提供明暗颗粒，颜色交给材质；值要留在 255 以内，Uint8Array 会回绕
    const k = 0.8 + rnd() * 0.2;
    d[i * 4] = 255 * k;
    d[i * 4 + 1] = 255 * k;
    d[i * 4 + 2] = 255 * k;
    d[i * 4 + 3] = 255;
  }
  return dataTexture(d, w, w, true);
}

/** 护栏：红白相间。 */
function barrierTexture(): DataTexture {
  const w = 16;
  const h = 4;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const red = x < w / 2;
      d[i] = red ? 200 : 235;
      d[i + 1] = red ? 40 : 235;
      d[i + 2] = red ? 36 : 238;
      d[i + 3] = 255;
    }
  }
  return dataTexture(d, w, h, true, true);
}

function checkerTexture(): DataTexture {
  const w = 16;
  const h = 2;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = (x + y) % 2 ? 240 : 24;
      d[i] = d[i + 1] = d[i + 2] = c;
      d[i + 3] = 255;
    }
  }
  return dataTexture(d, w, h, false, true);
}

const SIGNS: { top: string; bottom: string; tint: [number, number, number] }[] = [
  { top: 'PIT', bottom: 'LANE', tint: [0x1b, 0x4f, 0x9c] },
  { top: 'FJS', bottom: 'THREE', tint: [0x0b, 0x6e, 0x4f] },
  { top: 'LAP', bottom: 'RECORD', tint: [0x8a, 0x2b, 0x2b] },
  { top: 'DRIVE', bottom: 'FAST', tint: [0x7a, 0x5c, 0x10] },
];

function signTexture(sign: (typeof SIGNS)[number]): DataTexture {
  const w = 256;
  const h = 128;
  const d = new Uint8Array(w * h * 4);
  const cream: [number, number, number] = [0xf2, 0xef, 0xe6];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const border = x >= 9 && x < 12 ? true : x >= w - 12 && x < w - 9 ? true : y >= 9 && y < 12 ? true : y >= h - 12 && y < h - 9;
      const inside = x >= 9 && x < w - 9 && y >= 9 && y < h - 9;
      const c = border && inside ? cream : sign.tint;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  drawText(d, w, sign.top, w / 2, 24, 6, cream);
  drawText(d, w, sign.bottom, w / 2, 76, 4, cream, 2);
  // 字是按 y 朝下画的，贴图第 0 行在底下：整张翻一下
  const flipped = new Uint8Array(d.length);
  for (let y = 0; y < h; y++) flipped.set(d.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  return dataTexture(flipped, w, h, false);
}

// ── 天空 ─────────────────────────────────────────────────────────────────

function skyMaterial(doc: TrackDocument, toSun: Vector3): ShaderMaterial {
  const sky = doc.sky;
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: linear(sky.zenith) },
      horizon: { value: linear(sky.horizon) },
      below: { value: linear(sky.belowHorizon) },
      sunColor: { value: linear(sky.sunColor) },
      sunDir: { value: toSun },
      glowWide: { value: sky.glowWide },
      glowStrength: { value: sky.glowStrength },
      sunDisc: { value: sky.sunDisc },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 below;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform float glowWide;
      uniform float glowStrength;
      uniform float sunDisc;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h >= 0.0
          ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5))
          : mix(horizon, below, pow(clamp(-h * 3.0, 0.0, 1.0), 0.6));
        float mu = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * glowStrength * pow(mu, glowWide);
        col += sunColor * glowStrength * 0.6 * pow(mu, glowWide * 12.0);
        if (sunDisc > 0.0) {
          float r = sunDisc * 0.0011;
          float disc = smoothstep(cos(r), cos(r * 0.7), mu);
          col = mix(col, sunColor * 6.0, disc);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ── 组装 ─────────────────────────────────────────────────────────────────

export interface Circuit {
  scene: Scene;
  sky: Mesh;
  /** 每辆车一个节点：root 放位置朝向，里面是模型。 */
  cars: Group[];
  shadows: Mesh[];
  carLift: number;
  sun: DirectionalLight;
  exposure: number;
}

export interface Models {
  car: GLTF | null;
  buildings: GLTF[];
}

const CAR_PAINT: [number, number, number][] = [
  [0.85, 0.16, 0.12],
  [0.12, 0.35, 0.85],
  [0.95, 0.72, 0.1],
  [0.15, 0.7, 0.35],
];

/** 车模里摄像机从外面看不见的零件：驾驶舱里的按钮、方向盘、仪表、刹车盘……
 * 每一个都是一次 draw call，四辆车就是四份。 */
const HIDDEN_PARTS =
  /BTNS|HNDLS|steeringwheel|revs_type|lcd|Styrofoam|INT_Carbon|cockpit_cf|cockpit_main|FIA_LOGO|Caliper|Brake_Disk|brake__brake|goldhat|Mechanicals|ENGINE|SUSP|RIM_BLUR|WIND_IN|WIND_MCL|RAINLIGHT|LED_Light|CLEARLED|MERCLOG|copper|^material$|^CARB$/i;

export function buildCircuit(doc: TrackDocument, world: World, models: Models, carCount: number): Circuit {
  const { track, sky, level } = doc;
  const scene = new Scene();
  const fogColor = linear(level.fogColor ?? sky.horizon);
  scene.background = fogColor.clone();
  scene.fog = new FogExp2(fogColor, sky.fogDensity);

  // 太阳：关卡灯光的 direction 是光线前进方向，朝太阳是它的反方向
  const dir = level.lights?.[0]?.direction ?? [0, -1, 0];
  const toSun = new Vector3(-dir[0], -dir[1], -dir[2]).normalize();
  const sun = new DirectionalLight(linear(sky.sunColor), Math.max(0.35, sky.sunIntensity * 0.85));
  sun.position.copy(toSun).multiplyScalar(100);
  scene.add(sun, sun.target);
  scene.add(new HemisphereLight(linear(sky.zenith), linear([0.2, 0.22, 0.16]), 0.9 + sky.ambientIntensity * 6));

  const skyMesh = new Mesh(new SphereGeometry(900, 32, 16), skyMaterial(doc, toSun));
  skyMesh.renderOrder = -1;
  scene.add(skyMesh);

  // 路面 / 路肩 / 护栏
  const all = stations(track);
  const asphalt = new MeshLambertMaterial({ map: asphaltTexture(), color: 0x6f7178 });
  const grassTex = grassTexture();
  const verge = new MeshLambertMaterial({ map: grassTex, color: linear([0.14, 0.24, 0.11]) });
  const half = (s: number) => track.widthAt(s) / 2;
  scene.add(new Mesh(ribbon(track, all, (s) => -half(s), half, 1), asphalt));
  // 路肩压低一厘米，和路面交界处不闪
  scene.add(new Mesh(ribbon(track, all, (s) => -half(s), (s) => -half(s) - track.shoulder, 2.5, -0.01), verge));
  scene.add(new Mesh(ribbon(track, all, half, (s) => half(s) + track.shoulder, 2.5, -0.01), verge));
  // 路基侧墙：原版的赛道是悬在地面平台上方的一条带子，从路肩外沿垂直落到
  // 地面，看起来是一道堤而不是一张纸。只是画面，不参与碰撞。
  const slab = level.brushes.find((b) => b.surface);
  if (slab) {
    const groundY = slab.at[1] + slab.size[1] / 2;
    const stone = level.materials.stone?.baseColor ?? [0.45, 0.44, 0.42];
    const embankment = new MeshLambertMaterial({ color: linear(stone), side: DoubleSide });
    for (const side of [-1, 1]) scene.add(new Mesh(skirt(track, all, side, groundY), embankment));
  }
  const barrierMat = new MeshLambertMaterial({ map: barrierTexture(), side: DoubleSide });
  for (const side of [-1, 1] as const) {
    const g = barriers(track, all, side);
    if (g) scene.add(new Mesh(g, barrierMat));
  }

  // 起跑线
  {
    const fr = new TrackFrame();
    const w = track.widthAt(0) / 2;
    const corners: Vector3[] = [];
    for (const s of [-1.2, 1.2]) {
      track.frameAt(s, fr);
      for (const lat of [-w, w]) {
        corners.push(fr.position.clone().addScaledVector(fr.right, lat).addScaledVector(fr.up, 0.02));
      }
    }
    const b = builder();
    const up = fr.up;
    const i0 = vertex(b, corners[0], up, 0, 0);
    const i1 = vertex(b, corners[1], up, 1, 0);
    const i2 = vertex(b, corners[2], up, 0, 1);
    const i3 = vertex(b, corners[3], up, 1, 1);
    b.indices.push(i0, i2, i3, i0, i3, i1);
    const mat = new MeshLambertMaterial({ map: checkerTexture(), side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    scene.add(new Mesh(geometryOf(b), mat));
  }

  // 关卡方块：地面大平台单独一块（带草地贴图），石柱合成一个网格
  const pillars: BufferGeometry[] = [];
  for (const brush of level.brushes) {
    const g = new BoxGeometry(brush.size[0], brush.size[1], brush.size[2]);
    if (brush.surface) {
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (brush.size[0] / 20), uv.getY(i) * (brush.size[2] / 20));
      const base = level.materials[brush.material]?.baseColor ?? [0.18, 0.3, 0.14];
      const mesh = new Mesh(g, new MeshLambertMaterial({ map: grassTex, color: linear(base) }));
      mesh.position.set(brush.at[0], brush.at[1], brush.at[2]);
      scene.add(mesh);
    } else {
      g.translate(brush.at[0], brush.at[1], brush.at[2]);
      pillars.push(g);
    }
  }
  if (pillars.length) {
    const stone = level.materials.stone?.baseColor ?? [0.45, 0.44, 0.42];
    scene.add(new Mesh(mergeGeometries(pillars)!, new MeshLambertMaterial({ color: linear(stone) })));
  }

  addRoadside(scene, track, world, models.buildings);

  // 车
  const cars: Group[] = [];
  const shadows: Mesh[] = [];
  let carLift = 0.5 - 0.55;
  let template: Object3D | null = null;
  if (models.car) {
    template = models.car.scene;
    template.updateMatrixWorld(true);
    const box = new Box3().setFromObject(template);
    carLift = -box.min.y - 0.55;
    template.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial;
      if (HIDDEN_PARTS.test(mat.name ?? '')) mesh.visible = false;
      // 没有环境贴图，金属面会整片发黑
      if (mat.metalness !== undefined) mat.metalness = Math.min(mat.metalness, 0.25);
    });
  }
  const shadowGeo = new CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const shadowMat = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, fog: false });
  for (let i = 0; i < carCount; i++) {
    const root = new Group();
    if (template) {
      const model = template.clone(true);
      if (i > 0) paint(model, CAR_PAINT[i % CAR_PAINT.length]);
      root.add(model);
    } else {
      const box = new Mesh(new BoxGeometry(1.8, 1, 4.3), new MeshLambertMaterial({ color: linear(CAR_PAINT[i % CAR_PAINT.length]) }));
      root.add(box);
    }
    scene.add(root);
    cars.push(root);
    const shadow = new Mesh(shadowGeo, shadowMat);
    shadow.scale.set(1.15, 1, 2.5);
    shadow.renderOrder = 1;
    scene.add(shadow);
    shadows.push(shadow);
  }

  return { scene, sky: skyMesh, cars, shadows, carLift, sun, exposure: sky.exposure };
}

function paint(model: Object3D, rgb: [number, number, number]): void {
  const cache = new Map<Material, Material>();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    if (!mat.name || !mat.name.toLowerCase().includes('chassis')) return;
    let painted = cache.get(mat) as MeshStandardMaterial | undefined;
    if (!painted) {
      painted = mat.clone();
      painted.color.setRGB(rgb[0], rgb[1], rgb[2]);
      cache.set(mat, painted);
    }
    mesh.material = painted;
  });
}

function addRoadside(scene: Scene, track: TrackSpline, world: World, buildings: GLTF[]): void {
  const fr = new TrackFrame();
  const ground = { height: 0 } as { height: number; surface?: string };
  const groundAt = (x: number, z: number, fallback: number): number =>
    world.groundBelow(x, fallback + 200, z, 400, ground) ? ground.height : fallback;

  // 房子：每 90 米一栋，左右交替。同一个模型的所有实例烘进一个几何体
  const spacing = 90;
  const count = Math.floor(track.length / spacing);
  const perModel: BufferGeometry[][] = buildings.map(() => []);
  const sources = buildings.map((gltf) => {
    let mesh: Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    return mesh as Mesh | null;
  });
  const walls = [
    [0.62, 0.58, 0.52],
    [0.48, 0.44, 0.42],
    [0.55, 0.5, 0.45],
  ];
  const sheds: BufferGeometry[][] = walls.map(() => []);
  const m = new Matrix4();
  const q = new Object3D();
  for (let i = 0; i < count; i++) {
    const s = i * spacing;
    track.frameAt(s, fr);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = track.widthAt(s) * 0.5 + 14 + (i % 3) * 4;
    const cx = fr.position.x + fr.right.x * side * offset;
    const cz = fr.position.z + fr.right.z * side * offset;
    const cy = groundAt(cx, cz, fr.position.y + fr.right.y * side * offset);
    const yaw = Math.atan2(-fr.forward.x, -fr.forward.z) + ((i % 5) - 2) * 0.18;
    const k = sources.length ? i % sources.length : -1;
    const src = k >= 0 ? sources[k] : null;
    if (!src) {
      const wide = 6 + (i % 3) * 2;
      const high = 3.5 + (i % 4) * 0.8;
      const g = new BoxGeometry(wide, high, 5 + (i % 2) * 3);
      q.position.set(cx, cy + high / 2, cz);
      q.rotation.set(0, yaw, 0);
      q.scale.setScalar(1);
      q.updateMatrix();
      sheds[i % walls.length].push(g.applyMatrix4(q.matrix));
      continue;
    }
    q.position.set(cx, cy, cz);
    q.rotation.set(0, yaw, 0);
    q.scale.setScalar(4.2 + (i % 4) * 0.5);
    q.updateMatrix();
    m.multiplyMatrices(q.matrix, src.matrixWorld);
    perModel[k].push(src.geometry.clone().applyMatrix4(m));
  }
  perModel.forEach((list, k) => {
    const src = sources[k];
    if (!list.length || !src) return;
    const merged = mergeGeometries(list);
    if (merged) scene.add(new Mesh(merged, src.material));
  });
  sheds.forEach((list, k) => {
    if (list.length) scene.add(new Mesh(mergeGeometries(list)!, new MeshLambertMaterial({ color: linear(walls[k]) })));
  });

  // 广告牌：均匀分布四块，立在右侧，牌面迎着来车
  const posts: BufferGeometry[] = [];
  const boardW = 10;
  const boardH = 5;
  const stand = 3;
  SIGNS.forEach((sign, i) => {
    const s = (track.length * (i + 0.5)) / SIGNS.length;
    track.frameAt(s, fr);
    const offset = track.widthAt(s) * 0.5 + 9;
    const bx = fr.position.x + fr.right.x * offset;
    const bz = fr.position.z + fr.right.z * offset;
    const by = groundAt(bx, bz, fr.position.y + fr.right.y * offset);
    const tex: Texture = signTexture(sign);
    const board = new Mesh(new PlaneGeometry(boardW, boardH), new MeshLambertMaterial({ map: tex, side: DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
    board.position.set(bx, by + stand + boardH / 2, bz);
    // 牌面朝向路中心，宽度沿着赛道方向
    board.lookAt(fr.position.x, board.position.y, fr.position.z);
    scene.add(board);
    const postH = stand + boardH / 2;
    const yaw = Math.atan2(fr.right.x, fr.right.z);
    for (const lean of [-1, 1]) {
      const g = new BoxGeometry(0.4, postH, 0.4);
      q.position.set(bx + fr.forward.x * lean * boardW * 0.35, by + postH / 2, bz + fr.forward.z * lean * boardW * 0.35);
      q.rotation.set(0, yaw, 0);
      q.scale.setScalar(1);
      q.updateMatrix();
      posts.push(g.applyMatrix4(q.matrix));
    }
  });
  if (posts.length) scene.add(new Mesh(mergeGeometries(posts)!, new MeshLambertMaterial({ color: linear([0.3, 0.3, 0.32]) })));
}
