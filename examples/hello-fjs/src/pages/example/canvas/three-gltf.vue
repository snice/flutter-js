<route>
{"title": "three.js glTF", "group": "画布演示"}
</route>

<script setup lang="ts">
// three.js glTF viewer (spec 023): Xbot renders through three's
// WebGLRenderer on the same canvas.getContext('webgl2') the triangle page
// uses — three is the first real consumer of the vertex-array /
// texStorage2D / texSubImage2D(source) commands this spec added.
//
// Import order matters: the polyfill module installs three's DOM
// expectations (TextDecoder, Blob, object URLs, fetch interception,
// createImageBitmap) before anything of three's can run. On web that module
// is a no-op and three hits the browser's natives — same source, both ends.
import '@/three/native-polyfills';
import '@ufjs/webgl';
import { ref, onUnmounted } from 'vue';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';
import Panel from '@/components/Panel.vue';
import { createPinch } from '@/gltf/pinch';
import modelUrl from '@/assets/Xbot.glb';
import { onPageSettled } from 'fjs/router';

defineOptions({ name: 'ThreeGltfPage' });

const cv = ref();
// First paint already says this: `onResize` used to set it AFTER
// `new WebGLRenderer()`, which is hundreds of sync host calls on Flutter
// and blocks the UI flush — the bottom stayed on "等待画布…" the whole
// time, and a failed/racy init never left it (spec 023 iOS simulator).
const status = ref('模型加载中…');
const loading = ref(true);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let gl: WebGLRenderingContext | null = null;
let pendingModel: THREE.Object3D | null = null;
let modelReady = false;
let raf = 0;
// render on demand — see gltf-viewer.vue; a continuous loop fights the
// route pop transition on Android
let needsRender = false;
function requestRender(): void {
  needsRender = true;
}

// orbit state — one finger drags yaw/pitch, two pinch the distance; three's
// OrbitControls needs DOM pointer/wheel events this surface does not raise,
// so the math is here
let yaw = 0.5;
let pitch = 0.15;
const target = new THREE.Vector3(0, 0.85, 0);
const DISTANCE_0 = 3.4;
// factors of the starting distance, not absolute numbers — see gltf-viewer
const MIN_DISTANCE = DISTANCE_0 * 0.4;
const MAX_DISTANCE = DISTANCE_0 * 2.5;
let distance = DISTANCE_0;
let lastX = 0;
let lastY = 0;
let dragging = false;
const pinch = createPinch();

/** Fingers spreading means "closer", so the distance moves the other way.
 * Shared by the pinch and the -/+ buttons so they cannot disagree about
 * the limits. */
function zoomBy(factor: number) {
  distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance / factor));
  updateCamera();
  requestRender();
}

const ZOOM_STEP = 1.2;
function zoomIn() {
  zoomBy(ZOOM_STEP);
}
function zoomOut() {
  zoomBy(1 / ZOOM_STEP);
}

/** three's renderer expects the DOM canvas: it registers a contextlost
 * listener, writes width/height in setSize, and pokes style. The fjs
 * canvas object has none of those members, so a literal shim carries the
 * contract; the GL calls go through the context handed to the renderer
 * options, which is the same one every draw in this module drives.
 *
 * The size is the GL drawing buffer's, taken off `gl.canvas` — see
 * bufferRatio for why not off the canvas element. */
function asDomCanvas(buffer: {
  readonly width: number;
  readonly height: number;
}): HTMLCanvasElement {
  return {
    width: buffer.width,
    height: buffer.height,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getContext: () => null,
  } as unknown as HTMLCanvasElement;
}

/** The ratio between the GL drawing buffer and the laid-out box — what the
 * DOM calls the canvas's pixel ratio, and what three needs for setSize to
 * land a viewport that covers the whole surface.
 *
 * It has to be read off `gl.canvas`, NOT off the canvas element: the
 * element's `devicePixelRatio` is the 2d contract's constant 1 on Flutter
 * (the host rasterizes the scene in logical pixels, so a 2d page never
 * scales), while a webgl canvas follows web semantics and its backing store
 * is logical x the host's real ratio. Reading the element's ratio put
 * three's viewport at 340x340 inside a 1020x1020 surface — one ninth of the
 * canvas, in a corner (spec 023, Android round 3). */
function bufferRatio(
  buffer: { readonly width: number },
  logicalWidth: number,
): number {
  if (logicalWidth <= 0 || buffer.width <= 0) return 1;
  return buffer.width / logicalWidth;
}

function updateCamera() {
  if (!camera) return;
  const cp = Math.cos(pitch);
  camera.position.set(
    target.x + distance * cp * Math.sin(yaw),
    target.y + distance * Math.sin(pitch),
    target.z + distance * cp * Math.cos(yaw),
  );
  camera.lookAt(target);
}

function onTouchStart(e: FjsTouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  dragging = true;
  lastX = t.offsetX;
  lastY = t.offsetY;
}

function onTouchMove(e: FjsTouchEvent) {
  const factor = pinch.ratio(e);
  if (factor !== null) {
    zoomBy(factor);
    return;
  }
  // two fingers down, baseline not taken yet: swallow rather than rotate
  if (e.touches.length >= 2) {
    dragging = false;
    return;
  }
  if (!dragging) {
    // coming back from a pinch: re-anchor instead of jumping by the gap
    const t = e.touches[0];
    if (!t) return;
    dragging = true;
    lastX = t.offsetX;
    lastY = t.offsetY;
    return;
  }
  const t = e.touches[0];
  if (!t) return;
  yaw -= (t.offsetX - lastX) * 0.01;
  // clamp so the camera cannot flip over the pole
  pitch = Math.max(-1.2, Math.min(1.2, pitch + (t.offsetY - lastY) * 0.008));
  lastX = t.offsetX;
  lastY = t.offsetY;
  updateCamera();
  requestRender();
}

function onTouchEnd() {
  dragging = false;
  pinch.reset();
}

/** The fjs WebGL context answers this; a browser context has no such
 * method, which means the surface is already there.
 *
 * Must be called as a method (`ctx.ready()`), not torn off — `ready()`
 * reads `this.q`, and an unbound call is `this === undefined`. */
function contextReady(ctx: WebGLRenderingContext): boolean {
  const fn = (ctx as WebGLRenderingContext & { ready?: () => boolean }).ready;
  return typeof fn === 'function' ? fn.call(ctx) === true : true;
}

function loop() {
  raf = requestAnimationFrame(loop);
  if (!renderer || !scene || !camera || !gl) return;
  // three.js snapshots ACTIVE_UNIFORMS on first program use. Before the
  // host surface exists that query is an optimistic 0, and the empty
  // uniform table is cached forever — later draws upload nothing and the
  // canvas stays black even though the model "loaded" (spec 023).
  if (!contextReady(gl)) return;
  if (pendingModel && scene) {
    scene.add(pendingModel);
    pendingModel = null;
    modelReady = true;
    needsRender = true;
  }
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
  if (modelReady) {
    status.value = '拖动旋转，双指缩放';
    loading.value = false;
  }
}

function loadModel() {
  new GLTFLoader()
    .loadAsync(modelUrl)
    .then((gltf) => {
      const model = gltf.scene;
      // normalize: center at the origin, height at a known 1.7 — the orbit
      // target and camera distance stay fixed whatever the asset's units
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 1.7 / (size.y || 1);
      model.position.sub(center).multiplyScalar(scale);
      model.scale.setScalar(scale);
      pendingModel = model;
      requestRender();
    })
    .catch((e: unknown) => {
      // load failures must be visible, not silent (constitution V)
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : '未知错误';
      status.value = `加载失败：${message}`;
      loading.value = false;
    });
}

function onResize() {
  const instance = cv.value as FjsCanvasApi | undefined;
  if (!instance || renderer) return;
  // webgl2 → webgl fallback, three.js's own chain; the context claim happens
  // once — three holds it for the page's lifetime
  const ctx = (instance.getContext('webgl2') ??
    instance.getContext('webgl')) as unknown as
    | WebGLRenderingContext
    | null;
  if (!ctx) {
    status.value = '此环境没有 WebGL';
    loading.value = false;
    return;
  }
  gl = ctx;
  renderer = new THREE.WebGLRenderer({
    canvas: asDomCanvas(ctx.canvas),
    context: ctx,
    antialias: true,
  });
  renderer.setPixelRatio(bufferRatio(ctx.canvas, instance.width));
  renderer.setSize(instance.width, instance.height, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15181c);

  camera = new THREE.PerspectiveCamera(
    45,
    instance.width / (instance.height || 1),
    0.1,
    100,
  );
  // Xbot ships PBR materials: hemisphere for fill, one directional for form
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  updateCamera();
  requestRender();
  loop();
}

onPageSettled(() => {
  loadModel();
});

onUnmounted(() => {
  cancelAnimationFrame(raf);
  pendingModel = null;
});
</script>

<template>
  <Panel title="three.js glTF" desc="GLTFLoader 加载 Xbot，ANGLE/浏览器执行 three 渲染">
    <canvas
      defer-resize
      ref="cv"
      class="gl"
      @resize="onResize"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <view v-if="loading" class="mask">
        <text class="mask-text">模型加载中…</text>
      </view>
    </canvas>
    <text class="tip">{{ status }}</text>
    <view class="zoom">
      <button class="zoom-btn" @tap="zoomOut">−</button>
      <button class="zoom-btn" @tap="zoomIn">＋</button>
    </view>
  </Panel>
</template>

<style scoped>
.gl {
  width: 340px;
  height: 340px;
  border-radius: 8px;
  background: #15181c;
  /* see gltf-viewer.vue: without this the enclosing scroller takes the
     two-finger spread and the model never zooms */
  touch-action: none;
}
.tip {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
}
/* same numbers as gltf-viewer.vue's .dbg / .zoom — the two viewers should
   not drift apart visually (constitution IV) */
.zoom {
  flex-direction: row;
  margin-top: 8px;
  align-self: flex-start;
}
.zoom-btn {
  width: 64px;
  margin-right: 8px;
}
.mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
}
.mask-text {
  font-size: 13px;
  color: #c8c8c8;
}
</style>
