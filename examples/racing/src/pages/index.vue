<route>
{"title": "Ring", "scroll": false}
</route>

<script setup lang="ts">
// 赛车：pleiondev/flutter3d 的 flutter3d_demo_racing 用 three.js 复刻。
//
// 五条赛道一个赛季，四辆车跑三圈；物理、AI、镜头都照原版移植（src/game/），
// 赛道文件、车模、房子模型、音效直接用原项目的资源。
//
// polyfill 必须在 three 之前 import：ESM 按声明顺序执行模块。web 端它是空操作。
import '@/three/native-polyfills';
import '@ufjs/webgl';
import { computed, onUnmounted, ref, shallowRef } from 'vue';
import { WebGLRenderer } from 'three';
import { hasNativeHost, type FjsCanvasApi, type FjsTouchEvent } from 'fjs';
import { formatTime, Game, SEASON, type RaceResult, type Readout } from '@/game/game';


type Phase = 'loading' | 'title' | 'racing' | 'result' | 'error';

const cv = ref<FjsCanvasApi>();
const mapCv = ref<FjsCanvasApi>();
const phase = ref<Phase>('loading');
const status = ref('准备场景…');
const warning = ref('');
const hud = shallowRef<Readout | null>(null);
const result = shallowRef<RaceResult | null>(null);
const circuitIndex = ref(0);
const muted = ref(false);

/** 触屏按钮：App 端总是显示；浏览器里只在触摸设备上显示（桌面用键盘）。 */
const touchUi = hasNativeHost || (typeof window !== 'undefined' && 'ontouchstart' in window);

const circuit = computed(() => SEASON[circuitIndex.value]);
const lastCircuit = computed(() => circuitIndex.value === SEASON.length - 1);
const placeText = computed(() => {
  const r = result.value;
  if (!r) return '';
  return r.place === 1 ? '冠军' : `第 ${r.place} 名`;
});

let game: Game | null = null;
let gl: WebGLRenderingContext | null = null;
let modelsReady = false;

// ── three 与宿主 canvas 的衔接（同 hello-fjs 的 jump.vue） ──────────────────

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

function bufferRatio(buffer: { readonly width: number }, logicalWidth: number): number {
  if (logicalWidth <= 0 || buffer.width <= 0) return 1;
  return buffer.width / logicalWidth;
}

function contextReady(ctx: WebGLRenderingContext): boolean {
  const fn = (ctx as WebGLRenderingContext & { ready?: () => boolean }).ready;
  return typeof fn === 'function' ? fn.call(ctx) === true : true;
}

function onResize(): void {
  const instance = cv.value;
  if (!instance) return;
  if (!game) {
    const ctx = (instance.getContext('webgl2') ?? instance.getContext('webgl')) as unknown as WebGLRenderingContext | null;
    if (!ctx) {
      status.value = '此环境没有 WebGL';
      phase.value = 'error';
      return;
    }
    gl = ctx;
    const renderer = new WebGLRenderer({ canvas: asDomCanvas(ctx.canvas), context: ctx, antialias: true });
    game = new Game(renderer);
    game.onResult = (r) => {
      result.value = r;
      phase.value = 'result';
    };
    status.value = '加载车模…';
    void game.loadModels().then((problem) => {
      if (problem) warning.value = problem;
      modelsReady = true;
    });
  }
  applySize();
  startLoop();
}

let sizedW = 0;
let sizedH = 0;
let sizedBuffer = 0;

/** 布局尺寸或绘制缓冲变了就重设 three 的视口。@resize 在浏览器里窗口变化后
 * 不一定再来一次（缓冲先变、事件没到），所以帧循环里也查一遍。 */
function applySize(): void {
  const instance = cv.value;
  if (!instance || !game || !gl) return;
  const width = instance.width;
  const height = instance.height;
  const buffer = gl.canvas.width;
  if (width === sizedW && height === sizedH && buffer === sizedBuffer) return;
  sizedW = width;
  sizedH = height;
  sizedBuffer = buffer;
  game.renderer.setPixelRatio(bufferRatio(gl.canvas, width));
  game.renderer.setSize(width, height, false);
  game.resize(width, height);
}

// ── 循环 ─────────────────────────────────────────────────────────────────

let raf = 0;
let last = 0;
let hudClock = 0;

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (!game || !gl || !contextReady(gl)) return;
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
  last = now;
  applySize();

  if (phase.value === 'loading') {
    if (!modelsReady) return;
    game.setup(circuitIndex.value);
    phase.value = 'title';
  }

  readKeys();
  game.frame(dt, phase.value === 'racing' || phase.value === 'result');

  hudClock -= dt;
  if (hudClock <= 0 && phase.value === 'racing') {
    hudClock = 0.1;
    hud.value = game.readout();
    drawMap();
  }
}

function startLoop(): void {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

onUnmounted(() => {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  game?.sounds.suspend();
  detachKeys();
});

// ── 流程 ─────────────────────────────────────────────────────────────────

function begin(): void {
  if (!game) return;
  game.start();
  hud.value = game.readout();
  phase.value = 'racing';
}

function retry(): void {
  if (!game) return;
  game.setup(circuitIndex.value);
  result.value = null;
  begin();
}

function nextCircuit(): void {
  if (!game) return;
  circuitIndex.value = lastCircuit.value ? 0 : circuitIndex.value + 1;
  game.setup(circuitIndex.value);
  result.value = null;
  phase.value = 'title';
}

function pitStop(): void {
  game?.pitStop();
}

function toggleMute(): void {
  muted.value = !muted.value;
  game?.sounds.setMuted(muted.value);
}

// ── 键盘（浏览器） ──────────────────────────────────────────────────────────

const keys = new Set<string>();
const onKeyDown = (e: KeyboardEvent) => {
  keys.add(e.code);
  if (e.code === 'KeyT' && phase.value === 'racing') game?.pitStop();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Enter' || e.code === 'Space') {
    if (phase.value === 'title') begin();
    else if (phase.value === 'result') nextCircuit();
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
};
const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
const hasKeyboard = !hasNativeHost && typeof window !== 'undefined';
if (hasKeyboard) {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}
function detachKeys(): void {
  if (!hasKeyboard) return;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
}

// 触屏状态，和键盘合并成一份 controls
const touch = { steer: 0, throttle: false, brake: false, handbrake: false };
const steerTouching = ref(false);
const steerValue = ref(0);
const pedals = ref({ throttle: false, brake: false, handbrake: false });

function readKeys(): void {
  if (!game) return;
  const k = (...codes: string[]) => codes.some((c) => keys.has(c));
  const c = game.controls;
  c.throttle = k('KeyW', 'ArrowUp') || touch.throttle ? 1 : 0;
  c.brake = k('KeyS', 'ArrowDown') || touch.brake ? 1 : 0;
  const keySteer = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  c.steer = keySteer !== 0 ? keySteer : touch.steer;
  c.handbrake = k('Space') || touch.handbrake;
}

const BAND_WIDTH = 220;

function onSteer(e: FjsTouchEvent): void {
  const t = e.targetTouches[0];
  if (!t) {
    touch.steer = 0;
    steerTouching.value = false;
    steerValue.value = 0;
    return;
  }
  let v = (t.offsetX / BAND_WIDTH) * 2 - 1;
  v = Math.max(-1, Math.min(1, v));
  // 中间留一小段死区，手指放上去不会立刻打方向
  const dead = 0.08;
  v = Math.abs(v) < dead ? 0 : Math.sign(v) * ((Math.abs(v) - dead) / (1 - dead));
  touch.steer = v;
  steerTouching.value = true;
  steerValue.value = v;
}

function pedal(name: 'throttle' | 'brake' | 'handbrake', e: FjsTouchEvent): void {
  const down = e.type !== 'touchcancel' && e.targetTouches.length > 0;
  touch[name] = down;
  if (pedals.value[name] !== down) pedals.value = { ...pedals.value, [name]: down };
}

// ── 小地图 ───────────────────────────────────────────────────────────────

function drawMap(): void {
  const instance = mapCv.value;
  const ctx = instance?.getContext('2d');
  const r = hud.value;
  if (!ctx || !instance || !game || !r) return;
  const w = instance.width;
  const h = instance.height;
  if (!w || !h) return;
  const pad = 8;
  const size = Math.min(w, h) - pad * 2;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  ctx.clearRect(0, 0, w, h);
  const outline = game.outline;
  if (outline.length > 1) {
    ctx.beginPath();
    ctx.moveTo(ox + outline[0].x * size, oy + outline[0].y * size);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(ox + outline[i].x * size, oy + outline[i].y * size);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const colours = ['#ff4d3d', '#3d7bff', '#f5c11a', '#2fbf5f'];
  for (let i = r.dots.length - 1; i >= 0; i--) {
    const d = r.dots[i];
    ctx.beginPath();
    ctx.arc(ox + d.x * size, oy + d.y * size, i === 0 ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = colours[i % colours.length];
    ctx.fill();
    if (i === 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

const speedText = computed(() => String(Math.round(hud.value?.speed ?? 0)));
const countdownText = computed(() => {
  const c = hud.value?.countdown;
  if (c === null || c === undefined) return '';
  return c > 0 ? String(Math.ceil(c)) : 'GO';
});
</script>

<template>
  <view class="page">
    <canvas defer-resize ref="cv" class="gl" @resize="onResize" />

    <!-- HUD -->
    <safe-area v-if="phase === 'racing' && hud" class="layer">
      <view class="panel">
        <view class="line"><text class="label">圈数</text><text class="value">{{ hud.lap }}/{{ hud.laps }}</text></view>
        <view class="line"><text class="label">名次</text><text class="value">{{ hud.position }}/{{ hud.racers }}</text></view>
        <view class="line"><text class="label">本圈</text><text class="value">{{ formatTime(hud.lapTime) }}</text></view>
        <view class="line">
          <text class="label">最快</text>
          <text class="value">{{ hud.bestLap === null ? '--:--.---' : formatTime(hud.bestLap) }}</text>
        </view>
        <view class="line">
          <text class="label">纪录</text>
          <text class="value">{{ hud.record === null ? '--:--.---' : formatTime(hud.record) }}</text>
        </view>
        <view v-if="hud.damage > 0.02" class="line">
          <text class="label">损伤</text>
          <text class="value" :class="{ accent: hud.damage > 0.5 }">{{ Math.round(hud.damage * 100) }}%</text>
        </view>
        <view class="line">
          <text class="label">轮胎</text>
          <text class="value" :class="{ accent: hud.tyres === '先停车' }">{{ hud.tyres }}</text>
        </view>
      </view>

      <view class="map-box" :class="{ 'map-touch': touchUi }">
        <canvas ref="mapCv" class="map" />
      </view>

      <view class="speedo" :class="{ 'speedo-touch': touchUi }">
        <text class="speed">{{ speedText }}</text>
        <text class="unit">km/h</text>
      </view>

      <text v-if="hud.wrongWay" class="banner wrong">逆行</text>
      <text v-else-if="hud.notice" class="banner">{{ hud.notice }}</text>
      <view v-if="countdownText" class="countdown-box">
        <text class="countdown">{{ countdownText }}</text>
      </view>
    </safe-area>

    <!-- 触屏操作 -->
    <safe-area v-if="phase === 'racing' && touchUi" class="layer">
      <view
        class="band"
        :class="{ pressed: steerTouching }"
        @touchstart="onSteer"
        @touchmove="onSteer"
        @touchend="onSteer"
        @touchcancel="onSteer"
      >
        <!-- 箭头用两条边框画、各自绝对定位：App 端横条里有绝对定位的滑块时，
             space-between 会把两头的箭头挤到同一边 -->
        <view class="chevron chevron-left" />
        <view class="band-knob" :style="{ transform: `translateX(${steerValue * 80 - 20}px)` }" />
        <view class="chevron chevron-right" />
      </view>
      <view class="pedals">
        <view
          class="pedal small"
          :class="{ pressed: pedals.handbrake }"
          @touchstart="pedal('handbrake', $event)"
          @touchmove="pedal('handbrake', $event)"
          @touchend="pedal('handbrake', $event)"
          @touchcancel="pedal('handbrake', $event)"
        >
          <text class="pedal-text">手刹</text>
        </view>
        <view
          class="pedal"
          :class="{ pressed: pedals.brake }"
          @touchstart="pedal('brake', $event)"
          @touchmove="pedal('brake', $event)"
          @touchend="pedal('brake', $event)"
          @touchcancel="pedal('brake', $event)"
        >
          <text class="pedal-text">刹车</text>
        </view>
        <view
          class="pedal gas"
          :class="{ pressed: pedals.throttle }"
          @touchstart="pedal('throttle', $event)"
          @touchmove="pedal('throttle', $event)"
          @touchend="pedal('throttle', $event)"
          @touchcancel="pedal('throttle', $event)"
        >
          <text class="pedal-text">油门</text>
        </view>
      </view>
      <view class="pit" @tap="pitStop()">
        <text class="pit-text">换胎</text>
      </view>
    </safe-area>

    <!-- 标题 / 加载 / 结算 -->
    <view v-if="phase !== 'racing'" class="mask" :class="{ dim: phase === 'result' }">
      <view class="card">
        <view v-if="phase === 'loading' || phase === 'error'">
          <text class="title">Ring</text>
          <text class="sub">{{ status }}</text>
        </view>

        <view v-else-if="phase === 'title'">
          <text class="title">Ring</text>
          <text class="sub">五条赛道，一辆车，一个比晚上还长命的圈速。</text>
          <text class="circuit">第 {{ circuitIndex + 1 }} 站 / 共 {{ SEASON.length }} 站 · {{ circuit.title }} {{ circuit.en }}</text>
          <view class="help">
            <view v-if="touchUi">
              <text class="help-line">左下角的横条打方向，按住拖向弯心。</text>
              <text class="help-line">右下角是手刹、刹车和油门。</text>
              <text class="help-line">停稳之后点右上角「换胎」：公路胎 / 光头胎 / 拉力胎。</text>
            </view>
            <view v-else>
              <text class="help-line">W / S 或 ↑ / ↓：油门、刹车；A / D 或 ← / →：方向。</text>
              <text class="help-line">空格：手刹。T：停稳后换胎（公路 / 光头 / 拉力）。M：静音。</text>
            </view>
            <text class="help-line">三圈定胜负，冲出赛道太久会被放回上一个检查点。</text>
          </view>
          <text v-if="warning" class="warn">{{ warning }}</text>
          <button type="primary" class="action" @tap="begin()">开始比赛</button>
          <text class="credit">车模「2002 McLaren MP4-17」© Dave Love，CC BY 4.0（有修改）· 房子 Kenney City Kit，CC0</text>
        </view>

        <view v-else-if="phase === 'result' && result">
          <text class="title">{{ placeText }}</text>
          <text class="circuit">{{ circuit.title }} {{ circuit.en }}</text>
          <view class="help">
            <text class="help-line">总用时 {{ formatTime(result.total) }}</text>
            <text class="help-line">最快一圈 {{ result.bestLap === null ? '--' : formatTime(result.bestLap) }}{{ result.newRecord ? '（新纪录）' : '' }}</text>
          </view>
          <text v-if="lastCircuit" class="sub">赛季结束！</text>
          <view class="row">
            <button class="action half" @tap="retry()">再跑一次</button>
            <button type="primary" class="action half" @tap="nextCircuit()">{{ lastCircuit ? '重新开始赛季' : '下一站' }}</button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  height: 100%;
  background-color: #0e1116;
}
.gl {
  width: 100%;
  height: 100%;
  touch-action: none;
}
.layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

/* HUD */
.panel {
  position: absolute;
  left: 12px;
  top: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.45);
}
.line {
  flex-direction: row;
  align-items: center;
  height: 20px;
}
.label {
  width: 40px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 1px;
}
.value {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
}
.accent {
  color: #ffb13d;
}
.map-box {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 116px;
  height: 116px;
  border-radius: 8px;
  background-color: rgba(0, 0, 0, 0.35);
}
.map-touch {
  top: 64px;
}
.map {
  width: 116px;
  height: 116px;
}
.speedo {
  position: absolute;
  right: 20px;
  bottom: 16px;
  flex-direction: row;
  align-items: flex-end;
}
.speedo-touch {
  bottom: 124px;
}
.speed {
  font-size: 40px;
  font-weight: 800;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
}
.unit {
  margin-left: 4px;
  margin-bottom: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}
.banner {
  position: absolute;
  left: 0;
  right: 0;
  top: 72px;
  text-align: center;
  font-size: 26px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 2px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}
.wrong {
  font-size: 32px;
  font-weight: 800;
  color: #ff4d3d;
}
.countdown-box {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
.countdown {
  font-size: 110px;
  font-weight: 900;
  color: #ffffff;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.85);
}

/* 触屏 */
.band {
  position: absolute;
  left: 20px;
  bottom: 20px;
  width: 220px;
  height: 72px;
  border-radius: 36px;
  background-color: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.chevron {
  position: absolute;
  top: 29px;
  width: 12px;
  height: 12px;
  border-left: 3px solid rgba(255, 255, 255, 0.75);
  border-bottom: 3px solid rgba(255, 255, 255, 0.75);
}
.chevron-left {
  left: 22px;
  transform: rotate(45deg);
}
.chevron-right {
  right: 22px;
  transform: rotate(-135deg);
}
/* 横向用 left: 50% 再在 transform 里回拉 20px（半个滑块）：不受横条边框、
   内边距在两端怎么算的影响，静止时一定在正中 */
.band-knob {
  position: absolute;
  left: 50%;
  top: 15px;
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: rgba(255, 255, 255, 0.55);
}
.pedals {
  position: absolute;
  right: 20px;
  bottom: 20px;
  flex-direction: row;
  align-items: flex-end;
}
.pedal {
  width: 76px;
  height: 92px;
  margin-left: 12px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.small {
  width: 64px;
  height: 64px;
}
.gas {
  height: 108px;
}
.pressed {
  background-color: rgba(255, 255, 255, 0.4);
}
.pedal-text {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}
.pit {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 116px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.35);
}
.pit-text {
  font-size: 13px;
  color: #ffffff;
}

/* 遮罩卡片 */
.mask {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  background-color: rgba(0, 0, 0, 0.62);
}
.dim {
  background-color: rgba(0, 0, 0, 0.5);
}
.card {
  width: 100%;
  max-width: 520px;
  padding: 24px;
  border-radius: 14px;
  background-color: rgba(12, 14, 20, 0.82);
}
.title {
  font-size: 40px;
  font-weight: 200;
  color: #ffffff;
  letter-spacing: 6px;
}
.sub {
  margin-top: 6px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.72);
}
.circuit {
  margin-top: 16px;
  font-size: 16px;
  font-weight: 700;
  color: #ffd166;
}
.help {
  margin-top: 12px;
}
.help-line {
  font-size: 13px;
  line-height: 22px;
  color: #e8e8e8;
}
.warn {
  margin-top: 8px;
  font-size: 12px;
  color: #ffb13d;
}
.action {
  margin-top: 18px;
}
.row {
  flex-direction: row;
  gap: 12px;
}
.half {
  flex-grow: 1;
  flex-basis: 0px;
}
.credit {
  margin-top: 14px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
</style>
