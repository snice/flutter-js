<route>
{"title": "消消乐 LeaferJS", "scroll": false, "group": "交互游戏", "desc": "@leafer-ui/miniapp 画在 canvas 2d 上，App / Web / 小程序同一份"}
</route>

<script setup lang="ts">
// 消消乐 LeaferJS 版（spec 059）：玩法、状态机、HUD 与 match3.vue（pixi 版）
// 一一对应，棋盘逻辑同样是 @/match3/model；渲染换成 Leafer 的矢量场景图，
// 走 canvas 2d，所以小程序也能跑（pixi 版吃 WebGL，被 mp exclude）。
//
// 平台适配全在 @/leafer/platform，页面只守它顶部列的那条规矩：只用直接画在
// 画布上的矢量图形。具体到这页：
//   - 宝石是 Group（不设 opacity）+ 形状 + 高光；消除动画只缩放不淡出 ——
//     Group 的 opacity < 1 会让 Leafer 借一张临时画布合成，App 端没有离屏画布。
//   - 分数、连击、按钮都在画布外用 fjs 组件，不用 Leafer Text。
//   - 输入不走 Leafer 的交互系统（它命中测试用 isPointInPath，App 端 ❌），
//     页面用 offsetX/offsetY 自己算格子。
//
// 动画：页面内 tween + requestAnimationFrame，只在有 tween 时跑；Leafer 自己
// 在属性变化后的下一帧重画，不需要常驻 ticker。
import { onActivated, onDeactivated, onUnmounted, ref } from 'vue';
import { Ellipse, Group, Path, Polygon, Rect, Star } from '@leafer-ui/miniapp';
import type { Leafer } from '@leafer-ui/miniapp';
import type { FjsCanvasApi, FjsTouchEvent } from 'fjs';
import { mountLeafer } from '@/leafer/platform';
import {
  collapse,
  createBoard,
  findClears,
  findMove,
  removeCells,
  shuffleBoard,
  swapCells,
} from '@/match3/model';
import type { Grid, Swap } from '@/match3/model';

defineOptions({ name: 'Match3LeaferPage' });

const ROWS = 8;
const COLS = 8;
const COLORS = 6;

const GEM_COLORS = ['#ff5a5f', '#ff9f43', '#feca57', '#1dd1a1', '#54a0ff', '#a55eea'];

const SWAP_MS = 140;
const POP_MS = 150;
const FALL_MS = 240;

// ── 状态 ───────────────────────────────────────────────────────────────

const cvRef = ref<FjsCanvasApi>();
const score = ref(0);
const best = ref(0);
/** 连锁进行中的当前连击数，0 表示不在连锁里。 */
const combo = ref(0);
const toast = ref('');
const status = ref('等待画布…');

const grid: Grid = createBoard(ROWS, COLS, COLORS, Math.random);
while (!findMove(grid)) shuffleBoard(grid, Math.random);

/** views[r][c] 是该格宝石的显示节点，与 grid 同步换位/置空。 */
const views: (Group | null)[][] = Array.from({ length: ROWS }, () =>
  Array<Group | null>(COLS).fill(null),
);

let leafer: Leafer | null = null;
/** 棋盘层：平移到 (ox, oy)，宝石坐标都相对它。 */
let layer: Group | null = null;
let gems: Group | null = null;
let selMark: Rect | null = null;
/** 挂载时的尺寸；@resize 报来的尺寸不同就重建 Leafer（见 mountLeafer 注释）。 */
let mountedW = 0;
let mountedH = 0;

let cell = 0;
let ox = 0;
let oy = 0;

/** busy = 动画/结算中，输入只更新选中，不触发交换。 */
let busy = false;
let selected: { r: number; c: number } | null = null;
let active = true;

// ── tween 小工具 ───────────────────────────────────────────────────────

interface Tween {
  left: number;
  dur: number;
  step: (k: number) => void;
  done: () => void;
}

const tweens: Tween[] = [];
let raf = 0;
let last = 0;

const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;

function animate(dur: number, step: (k: number) => void): Promise<void> {
  return new Promise((resolve) => {
    tweens.push({ left: dur, dur, step, done: resolve });
    kick();
  });
}

function kick(): void {
  if (raf || !active || !tweens.length) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function frame(now: number): void {
  raf = 0;
  // 首帧没有上一帧时间，按 16ms 走一步
  const dt = last ? Math.min(now - last, 100) : 16;
  last = now;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.left -= dt;
    const k = 1 - Math.max(tw.left, 0) / tw.dur;
    tw.step(easeOutCubic(Math.min(k, 1)));
    if (tw.left <= 0) {
      tweens.splice(i, 1);
      tw.done();
    }
  }
  if (tweens.length && active) raf = requestAnimationFrame(frame);
}

/** 宝石节点从当前 xy 滑到 (r,c) 格中心。 */
function glideTo(node: Group, r: number, c: number, dur: number, fromY?: number): Promise<void> {
  const x0 = node.x ?? 0;
  const y0 = fromY ?? node.y ?? 0;
  const x1 = c * cell + cell / 2;
  const y1 = r * cell + cell / 2;
  if (x0 === x1 && y0 === y1) return Promise.resolve();
  return animate(dur, (k) => {
    node.x = x0 + (x1 - x0) * k;
    node.y = y0 + (y1 - y0) * k;
  });
}

// ── 宝石绘制 ───────────────────────────────────────────────────────────

/** 一颗宝石：Group 原点在格子中心，子图形围着原点画，缩放就是绕中心缩放。 */
function makeGem(color: number): Group {
  const s = cell * 0.78;
  const half = s / 2;
  const fill = GEM_COLORS[color];
  let shape;
  // 六种颜色配六个剪影，颜色弱视也能分
  switch (color) {
    case 0:
      shape = new Ellipse({ x: -half, y: -half, width: s, height: s, fill });
      break;
    case 1:
      shape = new Polygon({ points: [0, -half, half, 0, 0, half, -half, 0], fill });
      break;
    case 2:
      shape = new Star({ x: -half, y: -half, width: s, height: s, corners: 5, innerRadius: 0.52, fill });
      break;
    case 3:
      shape = new Rect({
        x: -half * 0.9,
        y: -half * 0.9,
        width: s * 0.9,
        height: s * 0.9,
        cornerRadius: s * 0.24,
        fill,
      });
      break;
    case 4:
      shape = new Polygon({ points: [0, -half, half * 0.95, half * 0.72, -half * 0.95, half * 0.72], fill });
      break;
    default:
      shape = new Polygon({
        points: [half, 0, half * 0.5, -half * 0.87, -half * 0.5, -half * 0.87, -half, 0, -half * 0.5, half * 0.87, half * 0.5, half * 0.87],
        fill,
      });
  }
  // 左上一笔高光，纯色块才有"糖"的质感（透明度写在颜色里，不设 opacity）
  const shine = new Ellipse({
    x: -half * 0.62,
    y: -half * 0.58,
    width: half * 0.6,
    height: half * 0.36,
    fill: 'rgba(255,255,255,0.32)',
  });
  return new Group({ children: [shape, shine] });
}

function placeGem(node: Group, r: number, c: number): void {
  node.x = c * cell + cell / 2;
  node.y = r * cell + cell / 2;
}

function rebuildViews(): void {
  if (!gems) return;
  gems.clear();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const node = makeGem(grid[r][c]);
      placeGem(node, r, c);
      views[r][c] = node;
      gems.add(node);
    }
  }
}

// ── 回合流程 ───────────────────────────────────────────────────────────

function setSelected(pos: { r: number; c: number } | null): void {
  selected = pos;
  if (!selMark) return;
  selMark.visible = !!pos;
  if (pos) {
    selMark.x = pos.c * cell + 2;
    selMark.y = pos.r * cell + 2;
  }
}

async function trySwap(a: Swap): Promise<void> {
  busy = true;
  setSelected(null);
  const { r1, c1, r2, c2 } = a;
  swapCells(grid, r1, c1, r2, c2);
  const va = views[r1][c1]!;
  const vb = views[r2][c2]!;
  views[r1][c1] = vb;
  views[r2][c2] = va;
  await Promise.all([glideTo(va, r2, c2, SWAP_MS), glideTo(vb, r1, c1, SWAP_MS)]);

  if (!findClears(grid).length) {
    // 不成立：原路弹回
    swapCells(grid, r1, c1, r2, c2);
    views[r1][c1] = va;
    views[r2][c2] = vb;
    await Promise.all([glideTo(va, r1, c1, SWAP_MS), glideTo(vb, r2, c2, SWAP_MS)]);
    busy = false;
    return;
  }
  await resolveBoard();
  busy = false;
}

/** 连锁结算：消除 → 下落补充 → 再查，直到稳定；随后查死局。 */
async function resolveBoard(): Promise<void> {
  combo.value = 0;
  for (let chain = 1; ; chain++) {
    const clears = findClears(grid);
    if (!clears.length) break;
    combo.value = chain;
    score.value += clears.length * chain;
    if (score.value > best.value) best.value = score.value;
    if (chain > 1) showToast(`连击 ×${chain}`);
    await Promise.all(clears.map((idx) => popGem(Math.floor(idx / COLS), idx % COLS)));
    removeCells(grid, clears);

    const { falls, spawns } = collapse(grid, COLORS, Math.random);
    const moving: Promise<void>[] = [];
    for (const f of falls) {
      const node = views[f.r1][f.c]!;
      views[f.r1][f.c] = null;
      views[f.r2][f.c] = node;
      moving.push(glideTo(node, f.r2, f.c, FALL_MS));
    }
    for (const s of spawns) {
      const node = makeGem(s.color);
      views[s.r][s.c] = node;
      node.x = s.c * cell + cell / 2;
      node.y = (s.from + 0.5) * cell;
      gems!.add(node);
      moving.push(glideTo(node, s.r, s.c, FALL_MS));
    }
    await Promise.all(moving);
  }
  combo.value = 0;
  if (!findMove(grid)) {
    showToast('无可消除，自动重排');
    await scaleAll(1, 0);
    shuffleBoard(grid, Math.random);
    rebuildViews();
    await scaleAll(0, 1);
  }
}

/** 整盘缩放（重排的过场）。不用层透明度，理由见文件顶部。 */
function scaleAll(from: number, to: number): Promise<void> {
  const nodes = views.flat().filter((n): n is Group => !!n);
  return animate(140, (k) => {
    const s = from + (to - from) * k;
    for (const n of nodes) n.scale = s;
  });
}

async function popGem(r: number, c: number): Promise<void> {
  const node = views[r][c];
  views[r][c] = null;
  if (!node) return;
  await animate(POP_MS, (k) => {
    node.scale = Math.max(1 - k, 0.001);
  });
  node.destroy();
}

function hint(): void {
  if (busy || !leafer) return;
  const move = findMove(grid);
  if (!move) return;
  busy = true;
  const a = views[move.r1][move.c1]!;
  const b = views[move.r2][move.c2]!;
  animate(500, (k) => {
    const s = 1 + 0.16 * Math.abs(Math.sin(k * Math.PI * 2));
    a.scale = s;
    b.scale = s;
  }).then(() => {
    a.scale = 1;
    b.scale = 1;
    busy = false;
  });
}

function restart(): void {
  if (busy || !leafer) return;
  score.value = 0;
  combo.value = 0;
  showToast('新的一局');
  setSelected(null);
  shuffleBoard(grid, Math.random);
  rebuildViews();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
    toastTimer = null;
  }, 1400);
}

// ── 触摸 → 格子 ────────────────────────────────────────────────────────

let pressR = -1;
let pressC = -1;
let pressX = 0;
let pressY = 0;
let dragUsed = false;

function cellAt(x: number, y: number): { r: number; c: number } | null {
  if (!cell) return null;
  const c = Math.floor((x - ox) / cell);
  const r = Math.floor((y - oy) / cell);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

const adjacent = (a: { r: number; c: number }, b: { r: number; c: number }): boolean =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

function onTouch(type: 'start' | 'move' | 'end', event: FjsTouchEvent): void {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  const pos = cellAt(touch.offsetX, touch.offsetY);

  if (type === 'start') {
    if (!pos) return;
    pressR = pos.r;
    pressC = pos.c;
    pressX = touch.offsetX;
    pressY = touch.offsetY;
    dragUsed = false;
    return;
  }
  if (type === 'move') {
    if (busy || dragUsed || pressR < 0) return;
    const dx = touch.offsetX - pressX;
    const dy = touch.offsetY - pressY;
    // 位移过半格就按主导方向和邻格交换
    if (Math.abs(dx) < cell * 0.5 && Math.abs(dy) < cell * 0.5) return;
    const to = Math.abs(dx) > Math.abs(dy)
      ? { r: pressR, c: pressC + (dx > 0 ? 1 : -1) }
      : { r: pressR + (dy > 0 ? 1 : -1), c: pressC };
    dragUsed = true;
    if (to.r < 0 || to.r >= ROWS || to.c < 0 || to.c >= COLS) return;
    void trySwap({ r1: pressR, c1: pressC, r2: to.r, c2: to.c });
    return;
  }
  // touchend：没拖动就当 tap —— 选中 / 与选中邻格交换 / 换一个选中
  if (dragUsed || busy) {
    pressR = -1;
    return;
  }
  pressR = -1;
  if (!pos) {
    setSelected(null);
    return;
  }
  if (selected && adjacent(selected, pos)) {
    void trySwap({ r1: selected.r, c1: selected.c, r2: pos.r, c2: pos.c });
    return;
  }
  setSelected(selected && selected.r === pos.r && selected.c === pos.c ? null : pos);
}

// ── 启动与生命周期 ─────────────────────────────────────────────────────

function build(width: number, height: number): void {
  const pad = 8;
  cell = Math.floor(Math.min((width - pad * 2) / COLS, (height - pad * 2) / ROWS));
  ox = Math.floor((width - cell * COLS) / 2);
  oy = Math.floor((height - cell * ROWS) / 2);

  const app = mountLeafer(cvRef.value!, width, height);
  leafer = app;
  mountedW = width;
  mountedH = height;

  // 画布底色也是一个 Rect：miniapp 平台的 LeaferCanvas 不画 Leafer 的 fill
  app.add(new Rect({ width, height, fill: '#0b0d13' }));

  const w = cell * COLS;
  const h = cell * ROWS;
  let lines = '';
  for (let c = 1; c < COLS; c++) lines += `M${c * cell} 0L${c * cell} ${h}`;
  for (let r = 1; r < ROWS; r++) lines += `M0 ${r * cell}L${w} ${r * cell}`;

  layer = new Group({ x: ox, y: oy });
  layer.add(new Rect({ width: w, height: h, cornerRadius: 10, fill: '#12141c' }));
  layer.add(new Path({ path: lines, stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }));
  gems = new Group();
  layer.add(gems);
  selMark = new Rect({
    width: cell - 4,
    height: cell - 4,
    cornerRadius: 10,
    stroke: 'rgba(255,255,255,0.85)',
    strokeWidth: 2,
    visible: false,
  });
  layer.add(selMark);
  app.add(layer);

  rebuildViews();
  setSelected(selected);
}

function teardown(): void {
  leafer?.destroy();
  leafer = null;
  layer = gems = selMark = null;
  for (const row of views) row.fill(null);
}

function onResize(): void {
  const cv = cvRef.value;
  if (!cv || !cv.width || !cv.height) return;
  if (leafer && cv.width === mountedW && cv.height === mountedH) return;
  // 尺寸真的变了：动画中途重建会让 tween 指向已销毁的节点，等回合结束
  if (busy) {
    setTimeout(onResize, 200);
    return;
  }
  teardown();
  try {
    build(cv.width, cv.height);
    status.value = '';
  } catch (error) {
    // 启动失败必须可见（宪法 V）
    const message = error instanceof Error ? error.message : String(error);
    status.value = `Leafer 启动失败：${message}`;
  }
}

onActivated(() => {
  active = true;
  kick();
  onResize();
});
onDeactivated(() => {
  active = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
});
onUnmounted(() => {
  active = false;
  if (raf) cancelAnimationFrame(raf);
  if (toastTimer) clearTimeout(toastTimer);
  teardown();
});

// 自动化走查用的调试钩子：只读棋盘与几何。
(globalThis as unknown as Record<string, unknown>).__match3Leafer = {
  grid,
  geometry: () => ({ cell, ox, oy }),
  findMove: () => findMove(grid),
};
</script>

<template>
  <view class="page">
    <view class="hud">
      <view class="stat">
        <text class="k">分数</text>
        <text class="v">{{ score }}</text>
      </view>
      <view class="stat">
        <text class="k">最高</text>
        <text class="v">{{ best }}</text>
      </view>
      <view class="stat">
        <text class="k">连击</text>
        <text class="v">{{ combo > 1 ? `×${combo}` : '—' }}</text>
      </view>
    </view>

    <view class="stage">
      <canvas
        ref="cvRef"
        class="board"
        @resize="onResize"
        @touchstart="(e: FjsTouchEvent) => onTouch('start', e)"
        @touchmove="(e: FjsTouchEvent) => onTouch('move', e)"
        @touchend="(e: FjsTouchEvent) => onTouch('end', e)"
        @touchcancel="(e: FjsTouchEvent) => onTouch('end', e)"
      />
      <view v-if="status" class="mask">
        <text class="mask-text">{{ status }}</text>
      </view>
    </view>

    <view class="bar">
      <button class="btn" size="mini" @tap="hint()">提示</button>
      <button class="btn ghost" size="mini" @tap="restart()">重开</button>
      <view class="grow">
        <text v-if="toast" class="toast">{{ toast }}</text>
        <text v-else class="tip">点选相邻宝石交换，或朝一个方向拖动</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  padding: 12px 16px 16px;
  background-color: #0b0d13;
}
.hud {
  flex-direction: row;
  gap: 8px;
}
.stat {
  flex-grow: 1;
  padding: 6px 0;
  align-items: center;
  border-radius: 8px;
  background-color: #171a24;
}
.k {
  font-size: 11px;
  color: #7b8296;
}
.v {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 700;
  color: #e8ebf2;
}
.stage {
  position: relative;
  flex-grow: 1;
  margin-top: 12px;
}
.board {
  width: 100%;
  height: 100%;
  /* 画布自己吃触摸，不让外层滚动抢手势 */
  touch-action: none;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: rgba(11, 13, 19, 0.78);
}
.mask-text {
  font-size: 13px;
  color: #e8ebf2;
}
.bar {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.btn {
  padding: 8px 14px;
  border-radius: 8px;
  background-color: #232838;
  color: #cfd5e4;
  font-size: 14px;
}
.ghost {
  background-color: #171a24;
  color: #8a91a6;
}
.grow {
  flex-grow: 1;
}
.toast {
  font-size: 13px;
  font-weight: 700;
  color: #feca57;
}
.tip {
  font-size: 12px;
  color: #7b8296;
}
</style>
