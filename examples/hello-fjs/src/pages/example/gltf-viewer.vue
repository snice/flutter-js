<route>
{"title": "glTF 模型（手写）", "group": "画布演示"}
</route>

<script setup lang="ts">
// glTF viewer, handwritten (spec 023): parse the GLB in JS, render with the
// plain WebGL commands the triangle page already proved on every device —
// shaders, buffers, vertexAttribPointer, drawElements. three.js runs on web
// (see three-gltf.vue) but its renderer exercises uniform/active-info
// diagnostics that flutter_angle does not answer on the iOS simulator, so
// the on-device demo is served by this viewer.
//
// Xbot has no textures: two primitives, two flat baseColorFactors. Skinning
// is ignored — raw accessor positions ARE the bind pose (a T-pose).
import '@/three/native-polyfills';
import '@ufjs/webgl';
import { ref, onUnmounted } from 'vue';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';
import type { FjsWebGLRenderingContextWithConstants } from '@ufjs/webgl';
import { parseGlb, type GlbPrimitive } from '@/gltf/glb';
import { lookAt, perspective } from '@/gltf/mat4';
import Panel from '@/components/Panel.vue';
import modelUrl from '@/assets/Xbot.glb';

defineOptions({ name: 'GltfViewerPage' });

const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uCenter;
uniform float uScale;
varying vec3 vNormal;
void main() {
  vec3 pos = (aPosition - uCenter) * uScale;
  gl_Position = uProj * uView * vec4(pos, 1.0);
  vNormal = aNormal;
}`;

const FS = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  // baseColorFactor is LINEAR; the framebuffer is displayed as sRGB.
  // three.js converts on output — a handwritten shader must too, or the
  // pale-pink skin renders as a dark brick red.
  vec3 c = uColor * (0.45 + 0.55 * diff);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}`;

const cv = ref();
const status = ref('等待画布…');

type Gl = FjsWebGLRenderingContextWithConstants;
/** The context's own program/shader/buffer handle type (not the DOM's). */
type Prog = Parameters<Gl['getUniformLocation']>[0];
type Shader = Parameters<Gl['getShaderParameter']>[0];
type Buffer = Parameters<Gl['bindBuffer']>[1];

interface PrimitiveBuffers {
  positions: Buffer;
  normals: Buffer;
  indices: Buffer;
  indexCount: number;
  color: [number, number, number];
}

let gl: Gl | null = null;
let program: Prog = null;
// uniform/attrib locations, resolved once per program (see draw())
let locs: {
  proj: Prog; view: Prog; center: Prog; scale: Prog; color: Prog;
  aPos: number; aNormal: number;
} | null = null;
let primitives: PrimitiveBuffers[] = [];
let raf = 0;
// render on demand: the rAF loop idles while the view is still, so a route
// pop's transition animation is not fighting a GL command stream (and the
// battery is happier). Anything that changes the picture calls requestDraw().
let needsDraw = false;
function requestDraw(): void {
  needsDraw = true;
}
let center: [number, number, number] = [0, 0, 0];
let scale = 1;

// orbit state — one finger drags yaw/pitch
let yaw = 0.5;
let pitch = 0.15;
const distance = 3.2;
let lastX = 0;
let lastY = 0;
let dragging = false;

function onTouchStart(e: FjsTouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragging = true;
  lastX = t.offsetX;
  lastY = t.offsetY;
}

function onTouchMove(e: FjsTouchEvent) {
  if (!dragging) return;
  const t = e.touches[0];
  if (!t) return;
  yaw -= (t.offsetX - lastX) * 0.01;
  pitch = Math.max(-1.2, Math.min(1.2, pitch + (t.offsetY - lastY) * 0.008));
  lastX = t.offsetX;
  lastY = t.offsetY;
  requestDraw();
}

function onTouchEnd() {
  dragging = false;
}

function draw() {
  if (!gl || !program) return;
  if (autoSpin) yaw += 0.01;
  const target: [number, number, number] = [0, 0, 0.05];
  const cp = Math.cos(pitch);
  const eye: [number, number, number] = [
    distance * cp * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * cp * Math.cos(yaw),
  ];
  const proj = perspective((45 * Math.PI) / 180, 1, 0.1, 100);
  const view = lookAt(eye, target, [0, 1, 0]);

  if (autoSpin) yaw += 0.01;

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  // light background like the reference render: Xbot's dark-brown joint
  // primitives vanish against a dark one and read as "missing geometry"
  gl.clearColor(0.82, 0.84, 0.86, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(program);
  if (!locs) {
    // cache once: every location call is a synchronous round-trip over the
    // ABI — 7 of them per frame here was a visible chunk of the drag jank
    locs = {
      proj: gl.getUniformLocation(program, 'uProj'),
      view: gl.getUniformLocation(program, 'uView'),
      center: gl.getUniformLocation(program, 'uCenter'),
      scale: gl.getUniformLocation(program, 'uScale'),
      color: gl.getUniformLocation(program, 'uColor'),
      aPos: gl.getAttribLocation(program, 'aPosition'),
      aNormal: gl.getAttribLocation(program, 'aNormal'),
    };
  }
  const { proj: projLoc, view: viewLoc, center: centerLoc, scale: scaleLoc, color: colorLoc, aPos, aNormal } = locs;
  if (projLoc) gl.uniformMatrix4fv(projLoc, false, proj);
  if (viewLoc) gl.uniformMatrix4fv(viewLoc, false, view);
  if (centerLoc) gl.uniform3f(centerLoc, center[0], center[1], center[2]);
  if (scaleLoc) gl.uniform1f(scaleLoc, scale);

  for (const prim of primitives) {
    gl.bindBuffer(gl.ARRAY_BUFFER, prim.positions);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, prim.normals);
    gl.enableVertexAttribArray(aNormal);
    gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prim.indices);
    if (colorLoc) {
      gl.uniform3f(colorLoc, prim.color[0], prim.color[1], prim.color[2]);
    }
    gl.drawElements(gl.TRIANGLES, prim.indexCount, gl.UNSIGNED_INT, 0);
  }
}

/** Buffers upload to the target they will be drawn from: an index buffer
 * filled under ARRAY_BUFFER has no storage on ELEMENT_ARRAY_BUFFER, and the
 * drawElements that binds it fails with INVALID_OPERATION. */
function uploadBuffer(
  target: number,
  data: Float32Array | Uint32Array,
): Buffer {
  const buffer = gl!.createBuffer();
  gl!.bindBuffer(target, buffer);
  gl!.bufferData(target, data, gl!.STATIC_DRAW);
  return buffer!;
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!needsDraw) return;
  needsDraw = false;
  draw();
}

function uploadModel(prims: ReturnType<typeof parseGlb>['primitives'], bounds: {
  min: [number, number, number];
  max: [number, number, number];
}) {
  if (!gl || !program) return;
  // center at origin and scale to a known height, like the three viewer
  for (let i = 0; i < 3; i++) {
    center[i] = (bounds.min[i] + bounds.max[i]) / 2;
  }
  const height = Math.max(bounds.max[1] - bounds.min[1], 0.001);
  scale = 1.7 / height;

  primitives = prims.map((p) => ({
    positions: uploadBuffer(gl!.ARRAY_BUFFER, p.positions),
    normals: uploadBuffer(gl!.ARRAY_BUFFER, p.normals),
    indices: uploadBuffer(gl!.ELEMENT_ARRAY_BUFFER, p.indices),
    indexCount: p.indices.length,
    color: p.color,
  }));
  status.value = '拖动模型旋转';
  requestDraw();
}

function loadModel() {
  status.value = '模型加载中…';
  fetch(modelUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => {
      const model = parseGlb(new Uint8Array(buf));
      uploadModel(model.primitives, model.bounds);
    })
    .catch((e: unknown) => {
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : '未知错误';
      status.value = `加载失败：${message}`;
    });
}

function onResize() {
  const instance = cv.value as FjsCanvasApi | undefined;
  if (!instance || gl) return;
  const context = (instance.getContext('webgl2') ??
    instance.getContext('webgl')) as unknown as Gl | null;
  if (!context) {
    status.value = '此环境没有 WebGL';
    return;
  }
  gl = context;
  gl.enable(gl.DEPTH_TEST);
  program = buildProgram();
  if (!program) {
    status.value = 'shader 编译失败（见日志）';
    return;
  }
  loadModel();
  loop();
}

function buildProgram(): Prog {
  const g = gl!;
  const compile = (type: number, source: string): Shader | null => {
    const shader = g.createShader(type) as Shader | null;
    if (!shader) return null;
    g.shaderSource(shader, source);
    g.compileShader(shader);
    if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
      console.error('[gltf] shader:', g.getShaderInfoLog(shader));
      g.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(g.VERTEX_SHADER, VS);
  const fs = compile(g.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;

  const prog = g.createProgram() as Prog;
  g.attachShader(prog, vs);
  g.attachShader(prog, fs);
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
    console.error('[gltf] link:', g.getProgramInfoLog(prog));
    return null;
  }
  g.useProgram(prog);
  return prog;
}

// Android bring-up (spec 023): two toggles that bisect the "missing band
// after a drag" — no-depth answers "is stale depth occluding geometry",
// auto-spin answers "does the gap move with the view angle"
const noDepth = ref(false);
const autoSpin = ref(false);

function toggleDepth() {
  noDepth.value = !noDepth.value;
  if (gl) {
    if (noDepth.value) gl.disable(gl.DEPTH_TEST);
    else gl.enable(gl.DEPTH_TEST);
  }
  requestDraw();
}

function toggleSpin() {
  autoSpin.value = !autoSpin.value;
  requestDraw();
}

onUnmounted(() => {
  console.log('[gltf] unmount: cancel rAF');
  cancelAnimationFrame(raf)
});
</script>

<template>
  <Panel title="glTF 模型（手写）" desc="JS 解析 GLB，基础 GL 命令渲染，双端同一份代码">
    <canvas
      ref="cv"
      class="gl"
      @resize="onResize"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    />
    <text class="tip">{{ status }}</text>
    <button class="dbg" @tap="toggleDepth">深度测试：{{ noDepth ? '关' : '开' }}</button>
    <button class="dbg" @tap="toggleSpin">自动旋转：{{ autoSpin ? '开' : '关' }}</button>
  </Panel>
</template>

<style scoped>
.gl {
  width: 340px;
  height: 340px;
  border-radius: 8px;
  background: #d1d6db;
}
.tip {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
}
.dbg {
  margin-top: 8px;
  align-self: flex-start;
}
</style>
