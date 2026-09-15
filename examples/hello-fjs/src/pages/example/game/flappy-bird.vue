<route>
{"title": "Flappy Bird", "scroll": false, "group": "交互游戏", "desc": "canvas drawImage 贴图，点击振翅穿过管道"}
</route>

<script setup lang="ts">
// Flappy Bird：整局都画在一块 <canvas> 里，素材在 public/fb/。
//
// 和俄罗斯方块那页不同，这页每帧都在动（地面、管道一直滚），所以 rAF 里每帧
// 整块 clearRect 再重画。几件和 canvas 相关的约定：
//
// 1. **图片用 loadCanvasImage**。App 侧没有 `new Image()`，解码后的位图留在
//    宿主、JS 只拿句柄（web 侧它内部就是浏览器的 Image）；全部就绪前只画天空色。
// 2. **世界坐标 = 素材像素**。素材是原版像素画放大约 5.33 倍导出的，所以物理
//    数值、管道间距都按素材像素写；绘制时整体 `scale(k)`，k 由画布高度决定，
//    画布变宽只是看得更远，玩法不变。
// 3. **命中测试用 offsetX / offsetY**（相对画布左上角），再除以 k 回到世界坐标。
import { onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { loadCanvasImage } from 'fjs';
import type { FjsCanvasApi, FjsCanvasContext2D, FjsCanvasImage, FjsTouchEvent } from 'fjs';

// ── 数值（世界单位 = 素材像素）──────────────────────────────────────────

/** 世界高度：背景 896 + 地面 128。 */
const WORLD_H = 1024;
const GROUND_Y = 896;
const GROUND_H = WORLD_H - GROUND_Y;

const BIRD_W = 92;
const BIRD_H = 64;
/** 小鸟固定在屏幕的这个横坐标上，动的是世界。 */
const BIRD_X_RATIO = 0.3;
/** 碰撞用的圆半径，比贴图小一圈，擦边不算死。 */
const BIRD_R = 26;

const GRAVITY = 3600;
const FLAP_V = -1000;
const MAX_FALL = 1500;
const SPEED = 300;

const PIPE_W = 138;
const PIPE_CAP_H = 64;
const PIPE_BODY_X = 5;
const PIPE_BODY_W = 128;
const PIPE_GAP = 300;
const PIPE_SPACING = 520;
/** 缺口上沿离天顶、下沿离地面至少留这么多。 */
const PIPE_MARGIN = 140;

const BG_W = 768;
const TILE_W = 37;

const DIGIT_W = 145;
const DIGIT_H = 219;

type Phase = 'ready' | 'playing' | 'dying' | 'over';

interface Pipe {
  x: number;
  /** 缺口上沿的 y。 */
  gapTop: number;
  passed: boolean;
}

// ── 素材 ───────────────────────────────────────────────────────────────

const SOURCES = {
  bg: '/fb/background.png',
  ground: '/fb/gress.png',
  pipe: '/fb/pipe.png',
  panel: '/fb/score.png',
  restart: '/fb/restart.png',
  bird1: '/fb/bird1.png',
  bird2: '/fb/bird2.png',
  bird3: '/fb/bird3.png',
  d0: '/fb/0.png',
  d1: '/fb/1.png',
  d2: '/fb/2.png',
  d3: '/fb/3.png',
  d4: '/fb/4.png',
  d5: '/fb/5.png',
  d6: '/fb/6.png',
  d7: '/fb/7.png',
  d8: '/fb/8.png',
  d9: '/fb/9.png',
} as const;
type Key = keyof typeof SOURCES;

const images = {} as Record<Key, FjsCanvasImage>;
const loaded = ref(false);
const failed = ref('');
{
  let left = Object.keys(SOURCES).length;
  for (const key of Object.keys(SOURCES) as Key[]) {
    images[key] = loadCanvasImage(
      SOURCES[key],
      () => {
        if (--left === 0) loaded.value = true;
      },
      (message) => {
        failed.value = `${SOURCES[key]}: ${message}`;
      },
    );
  }
}

// ── 状态 ───────────────────────────────────────────────────────────────

const cv = ref<FjsCanvasApi>();

let phase: Phase = 'ready';
let score = 0;
// 最高分挂在模块上：离开页面再回来还在（这个 demo 不碰持久化存储）。
let best = 0;
let newBest = false;

let birdY = 0;
let birdV = 0;
/** 振翅动画的时钟；死了就停。 */
let flapClock = 0;
/** ready 阶段上下浮动的时钟。 */
let bobClock = 0;
/** 地面 / 管道累计滚过的距离，背景按它的一小部分做视差。 */
let scroll = 0;
let pipes: Pipe[] = [];
/** 撞上那一下的闪白，和结算面板的滑入。 */
let flash = 0;
let overClock = 0;

/** 画布尺寸换算：k = 画布高 / 世界高，worldW 是当前能看到的世界宽度。 */
let k = 0;
let worldW = 0;

let raf = 0;
let last = 0;

const birdX = (): number => Math.round(worldW * BIRD_X_RATIO);

function reset(): void {
  phase = 'ready';
  score = 0;
  newBest = false;
  birdY = GROUND_Y * 0.45;
  birdV = 0;
  bobClock = 0;
  pipes = [];
  flash = 0;
  overClock = 0;
}
reset();

function randomGap(): number {
  const min = PIPE_MARGIN;
  const max = GROUND_Y - PIPE_MARGIN - PIPE_GAP;
  return min + Math.random() * (max - min);
}

// ── 输入 ───────────────────────────────────────────────────────────────

function flap(): void {
  birdV = FLAP_V;
}

function onTouchStart(e: FjsTouchEvent): void {
  if (!loaded.value || !k) return;
  const t = e.touches[0] ?? e.changedTouches[0];
  switch (phase) {
    case 'ready':
      phase = 'playing';
      // 第一根管道从屏幕右边外面进来，给玩家一点反应时间
      pipes = [{ x: worldW + 200, gapTop: randomGap(), passed: false }];
      flap();
      return;
    case 'playing':
      flap();
      return;
    case 'dying':
      return;
    case 'over': {
      // 面板滑完才接受点击，免得死的那一下连点直接重开
      if (overClock < 0.6 || !t) return;
      const r = restartRect();
      const x = t.offsetX / k;
      const y = t.offsetY / k;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) reset();
      return;
    }
  }
}

// ── 更新 ───────────────────────────────────────────────────────────────

function die(): void {
  if (phase !== 'playing') return;
  phase = 'dying';
  flash = 1;
  if (score > best) {
    best = score;
    newBest = true;
  }
}

function update(dt: number): void {
  flash = Math.max(0, flash - dt * 4);

  if (phase === 'ready') {
    bobClock += dt;
    flapClock += dt;
    scroll += SPEED * dt;
    birdY = GROUND_Y * 0.45 + Math.sin(bobClock * 6) * 12;
    return;
  }

  if (phase === 'over') {
    overClock += dt;
    return;
  }

  // playing 和 dying 都受重力；dying 时世界不再滚，鸟一头栽到地上
  birdV = Math.min(birdV + GRAVITY * dt, MAX_FALL);
  birdY += birdV * dt;
  if (birdY < -BIRD_H) birdY = -BIRD_H;

  if (birdY + BIRD_R >= GROUND_Y) {
    birdY = GROUND_Y - BIRD_R;
    if (phase === 'playing') die();
    phase = 'over';
    overClock = 0;
    return;
  }

  if (phase !== 'playing') return;

  flapClock += dt;
  scroll += SPEED * dt;

  const bx = birdX();
  for (const p of pipes) {
    p.x -= SPEED * dt;
    if (!p.passed && p.x + PIPE_W / 2 < bx) {
      p.passed = true;
      score++;
    }
  }
  while (pipes.length && pipes[0].x + PIPE_W < 0) pipes.shift();
  const tail = pipes[pipes.length - 1];
  if (!tail || tail.x < worldW - PIPE_SPACING) {
    pipes.push({ x: (tail?.x ?? worldW) + PIPE_SPACING, gapTop: randomGap(), passed: false });
  }

  for (const p of pipes) {
    if (hitsPipe(bx, birdY, p)) {
      die();
      break;
    }
  }
}

/** 圆 vs 上下两根管道的矩形：最近点距离小于半径即相撞。 */
function hitsPipe(cx: number, cy: number, p: Pipe): boolean {
  const rects = [
    { x: p.x, y: -WORLD_H, w: PIPE_W, h: p.gapTop + WORLD_H },
    { x: p.x, y: p.gapTop + PIPE_GAP, w: PIPE_W, h: GROUND_Y },
  ];
  for (const r of rects) {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    if ((cx - nx) ** 2 + (cy - ny) ** 2 < BIRD_R * BIRD_R) return true;
  }
  return false;
}

// ── 循环 ───────────────────────────────────────────────────────────────

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  // 切后台回来 dt 可能很大，截断成一小步，免得鸟直接穿墙
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (loaded.value && k) update(dt);
  paint();
}

function startLoop(): void {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

onMounted(startLoop);
// 路由是 keep-alive 的：离开就停帧回调，回来再接上
onActivated(startLoop);
onDeactivated(stopLoop);
onUnmounted(stopLoop);

function onResize(): void {
  const instance = cv.value;
  if (!instance || !instance.height) return;
  k = instance.height / WORLD_H;
  worldW = instance.width / k;
  startLoop();
}

// ── 绘制 ───────────────────────────────────────────────────────────────

function paint(): void {
  const instance = cv.value;
  const ctx = instance?.getContext('2d');
  if (!ctx || !instance || !k) return;

  // 整块清：宿主据此丢弃上一帧的显示列表（docs/canvas-compat.md §10）
  ctx.clearRect(0, 0, instance.width, instance.height);
  ctx.fillStyle = '#70c5cf';
  ctx.fillRect(0, 0, instance.width, instance.height);

  ctx.save();
  ctx.scale(k, k);

  if (loaded.value) {
    paintBackground(ctx);
    paintPipes(ctx);
    paintGround(ctx);
    paintBird(ctx);
    paintHud(ctx);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(failed.value ? '素材加载失败' : '加载中…', worldW / 2, WORLD_H / 2);
  }

  ctx.restore();

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.8})`;
    ctx.fillRect(0, 0, instance.width, instance.height);
  }
}

function paintBackground(ctx: FjsCanvasContext2D): void {
  // 远景滚得慢：地面速度的 1/5
  const offset = (scroll * 0.2) % BG_W;
  for (let x = -offset; x < worldW; x += BG_W) {
    // 多画 1 单位宽，拼缝处缩放取整不会漏出一条天空色
    ctx.drawImage(images.bg, x, 0, BG_W + 1, GROUND_Y);
  }
}

function paintGround(ctx: FjsCanvasContext2D): void {
  const offset = scroll % TILE_W;
  for (let x = -offset; x < worldW; x += TILE_W) {
    ctx.drawImage(images.ground, x, GROUND_Y, TILE_W + 1, GROUND_H);
  }
}

function paintPipes(ctx: FjsCanvasContext2D): void {
  const img = images.pipe;
  for (const p of pipes) {
    const bodyX = p.x + PIPE_BODY_X;
    // 管身是竖条纹，源图只有 44px 高，纵向拉伸就能接成任意长
    const topBodyH = p.gapTop - PIPE_CAP_H;
    if (topBodyH > 0) {
      ctx.drawImage(img, PIPE_BODY_X, PIPE_CAP_H, PIPE_BODY_W, 44, bodyX, 0, PIPE_BODY_W, topBodyH);
    }
    // 上管道的帽子朝下：翻转着画
    ctx.save();
    ctx.translate(p.x, p.gapTop);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, PIPE_W, PIPE_CAP_H, 0, 0, PIPE_W, PIPE_CAP_H);
    ctx.restore();

    const bottomY = p.gapTop + PIPE_GAP;
    ctx.drawImage(img, 0, 0, PIPE_W, PIPE_CAP_H, p.x, bottomY, PIPE_W, PIPE_CAP_H);
    const bottomBodyH = GROUND_Y - bottomY - PIPE_CAP_H;
    if (bottomBodyH > 0) {
      ctx.drawImage(
        img,
        PIPE_BODY_X,
        PIPE_CAP_H,
        PIPE_BODY_W,
        44,
        bodyX,
        bottomY + PIPE_CAP_H,
        PIPE_BODY_W,
        bottomBodyH,
      );
    }
  }
}

const WING = ['bird1', 'bird2', 'bird3', 'bird2'] as const;

function paintBird(ctx: FjsCanvasContext2D): void {
  const frameKey = WING[Math.floor(flapClock * 12) % WING.length];
  // 上升时抬头，下落越快越低头，最多垂直朝下
  let angle = 0;
  if (phase !== 'ready') angle = Math.max(-0.45, Math.min(Math.PI / 2, (birdV / MAX_FALL) * 1.9));
  ctx.save();
  ctx.translate(birdX(), birdY);
  ctx.rotate(angle);
  ctx.drawImage(images[frameKey], -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H);
  ctx.restore();
}

/** 用 0-9 的贴图画一个数字，(cx, y) 是整串的上边中点。 */
function paintNumber(ctx: FjsCanvasContext2D, value: number, cx: number, y: number, scale: number): void {
  const text = String(value);
  const w = DIGIT_W * scale;
  const gap = -4 * scale;
  const total = text.length * w + (text.length - 1) * gap;
  let x = cx - total / 2;
  for (const ch of text) {
    ctx.drawImage(images[`d${ch}` as Key], x, y, w, DIGIT_H * scale);
    x += w + gap;
  }
}

function paintHud(ctx: FjsCanvasContext2D): void {
  const cx = worldW / 2;

  if (phase === 'ready') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#543847';
    ctx.fillStyle = '#ffffff';
    const y = GROUND_Y * 0.62;
    ctx.strokeText('点击屏幕开始', cx, y);
    ctx.fillText('点击屏幕开始', cx, y);
    if (best > 0) {
      ctx.font = 'bold 32px sans-serif';
      ctx.strokeText(`最高 ${best}`, cx, y + 60);
      ctx.fillText(`最高 ${best}`, cx, y + 60);
    }
    return;
  }

  if (phase === 'playing' || phase === 'dying') {
    paintNumber(ctx, score, cx, 80, 0.45);
    return;
  }

  // 结算：面板从下面滑上来
  const t = Math.min(1, overClock / 0.5);
  const ease = 1 - (1 - t) ** 3;
  const panel = panelRect();
  const slide = (1 - ease) * (WORLD_H - panel.y);
  ctx.globalAlpha = ease;
  ctx.drawImage(images.panel, panel.x, panel.y + slide, panel.w, panel.h);
  const s = panel.w / 172;
  paintNumber(ctx, score, cx, panel.y + slide + 62 * s, 0.2 * s);
  paintNumber(ctx, best, cx, panel.y + slide + 150 * s, 0.2 * s);
  if (newBest) {
    ctx.fillStyle = '#e86101';
    ctx.font = `bold ${Math.round(18 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEW', panel.x + panel.w - 30 * s, panel.y + slide + 170 * s);
  }
  const r = restartRect();
  ctx.drawImage(images.restart, r.x, r.y + slide, r.w, r.h);
  ctx.globalAlpha = 1;
}

function panelRect(): { x: number; y: number; w: number; h: number } {
  const w = 172 * 1.8;
  const h = 228 * 1.8;
  return { x: worldW / 2 - w / 2, y: GROUND_Y * 0.18, w, h };
}

function restartRect(): { x: number; y: number; w: number; h: number } {
  const panel = panelRect();
  const w = 214 * 1.3;
  const h = 75 * 1.3;
  return { x: worldW / 2 - w / 2, y: panel.y + panel.h + 40, w, h };
}
</script>

<template>
  <view class="page">
    <canvas
      ref="cv"
      class="cv"
      @resize="onResize"
      @touchstart="onTouchStart"
    />
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  background-color: #70c5cf;
}
.cv {
  width: 100%;
  height: 100%;
  touch-action: none;
}
</style>
