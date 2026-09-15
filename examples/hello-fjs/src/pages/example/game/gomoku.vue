<route>
{"title": "五子棋", "scroll": false, "group": "交互游戏", "desc": "canvas 画棋盘，人机 / 双人对战"}
</route>

<script setup lang="ts">
// 五子棋：棋盘、棋子、胜负连线全画在一张 <canvas> 上，交互靠触点坐标反查交叉点。
//
// 和隔壁俄罗斯方块的区别：**这一页没有帧循环**。棋是回合制的，画面只在落子、
// 悔棋、重开时变，所以每次状态变化直接 `paint()` 一次——比挂个 rAF 空转省得多。
// 每次画之前照例整块 `clearRect`，宿主才会丢弃上一帧的显示列表
// （docs/canvas-compat.md §10）。
//
// 落子是「按住瞄准、抬手落子」：touchstart/touchmove 只挪半透明的预览子，
// touchend 才真的下——手指本身挡着棋盘，直接点按很容易下错一路。
// 命中测试用 touch.offsetX/offsetY（相对画布左上角），clientX 是页面坐标。
import { computed, onUnmounted, ref } from 'vue';
import type { FjsCanvasApi, FjsCanvasContext2D, FjsTouchEvent } from 'fjs';

/** 15 路棋盘。 */
const N = 15;
/** 天元和四个星位。 */
const STARS = [
  [3, 3],
  [3, 11],
  [11, 3],
  [11, 11],
  [7, 7],
];

/** 空点 0、黑 1、白 2。 */
type Side = 1 | 2;
type Slot = 0 | Side;

interface Move {
  x: number;
  y: number;
  side: Side;
}

const cv = ref<FjsCanvasApi>();

const mode = ref<'ai' | 'duo'>('ai');
const turn = ref<Side>(1);
const winner = ref<Slot>(0);
const thinking = ref(false);
const moves = ref<Move[]>([]);

/** AI 执白。 */
const AI_SIDE: Side = 2;

const board: Slot[] = Array<Slot>(N * N).fill(0);
/** 赢的那五颗，画连线用。 */
let winLine: [number, number][] = [];
/** 按住瞄准时的预览点。 */
let aim: [number, number] | null = null;

/** 画布尺寸算出来的路距与原点，都在 @resize 里更新。 */
let cell = 0;
let ox = 0;
let oy = 0;

let timer: ReturnType<typeof setTimeout> | null = null;

const at = (x: number, y: number): Slot =>
  x < 0 || x >= N || y < 0 || y >= N ? 0 : board[y * N + x];

const hint = computed(() => {
  if (winner.value) return winner.value === 1 ? '黑棋胜' : '白棋胜';
  if (moves.value.length === N * N) return '和棋';
  if (thinking.value) return '白棋思考中…';
  return turn.value === 1 ? '轮到黑棋' : '轮到白棋';
});

const canUndo = computed(() => moves.value.length > 0 && !thinking.value);

// ── 规则 ───────────────────────────────────────────────────────────────

const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 刚落的这颗有没有连成五：连成了就把那一串记进 winLine。 */
function wins(x: number, y: number, side: Side): boolean {
  for (const [dx, dy] of DIRS) {
    const line: [number, number][] = [[x, y]];
    for (const sign of [1, -1]) {
      for (let i = 1; i < 5; i++) {
        const nx = x + dx * i * sign;
        const ny = y + dy * i * sign;
        if (at(nx, ny) !== side) break;
        line.push([nx, ny]);
      }
    }
    if (line.length >= 5) {
      winLine = line;
      return true;
    }
  }
  return false;
}

function place(x: number, y: number, side: Side): void {
  board[y * N + x] = side;
  moves.value = [...moves.value, { x, y, side }];
  if (wins(x, y, side)) {
    winner.value = side;
    thinking.value = false;
  } else {
    turn.value = side === 1 ? 2 : 1;
  }
  paint();
}

/** 人类落子：轮到自己、这一格是空的才算数。 */
function play(x: number, y: number): void {
  if (winner.value || thinking.value) return;
  if (at(x, y) !== 0) return;
  const side = turn.value;
  place(x, y, side);
  if (!winner.value && mode.value === 'ai' && turn.value === AI_SIDE) {
    thinking.value = true;
    // 先让人类那颗子上屏，再想——顺带也像在思考
    timer = setTimeout(aiMove, 260);
  }
}

function restart(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  board.fill(0);
  moves.value = [];
  winner.value = 0;
  turn.value = 1;
  thinking.value = false;
  winLine = [];
  aim = null;
  paint();
}

/** 悔棋：人机模式一次退两手，退回自己该走的那一刻。 */
function undo(): void {
  if (!canUndo.value) return;
  const back = mode.value === 'ai' && moves.value.length >= 2 && !winner.value ? 2 : 1;
  const kept = moves.value.slice(0, Math.max(0, moves.value.length - back));
  for (const m of moves.value.slice(kept.length)) board[m.y * N + m.x] = 0;
  moves.value = kept;
  winner.value = 0;
  winLine = [];
  turn.value = kept.length % 2 === 0 ? 1 : 2;
  paint();
}

function setMode(next: 'ai' | 'duo'): void {
  if (mode.value === next) return;
  mode.value = next;
  restart();
}

// ── AI ─────────────────────────────────────────────────────────────────

/** 一个方向上的棋型分：连子数 + 两头堵没堵。
 *
 *  只认连子，不认「跳三」这类带空档的棋型——够这一页的对手强度，真要下棋还得
 *  上搜索（这里是 canvas 示例，不是棋力示例）。 */
function lineScore(x: number, y: number, dx: number, dy: number, side: Side): number {
  let count = 1;
  let blocked = 0;
  for (const sign of [1, -1]) {
    let i = 1;
    for (; i < 5; i++) {
      const v = at(x + dx * i * sign, y + dy * i * sign);
      if (v !== side) {
        // 出界或撞到对方 = 这头被堵死
        if (v !== 0) blocked++;
        break;
      }
      count++;
    }
    const nx = x + dx * i * sign;
    const ny = y + dy * i * sign;
    if (nx < 0 || nx >= N || ny < 0 || ny >= N) blocked++;
  }
  if (count >= 5) return 100000;
  if (blocked === 2) return 0;
  const open = blocked === 0;
  if (count === 4) return open ? 10000 : 1200;
  if (count === 3) return open ? 1000 : 120;
  if (count === 2) return open ? 100 : 12;
  return open ? 10 : 2;
}

/** 这一格对某一方的价值：四个方向加起来。 */
function scoreAt(x: number, y: number, side: Side): number {
  let sum = 0;
  for (const [dx, dy] of DIRS) sum += lineScore(x, y, dx, dy, side);
  return sum;
}

/** 只考虑已有棋子两格以内的空点：开局之外，远处的点没有价值。 */
function candidates(): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (at(x, y) !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (at(x + dx, y + dy) !== 0) {
            near = true;
            break;
          }
        }
      }
      if (near) out.push([x, y]);
    }
  }
  return out;
}

function aiMove(): void {
  timer = null;
  if (winner.value) return;
  const me = AI_SIDE;
  const foe: Side = me === 1 ? 2 : 1;
  const list = candidates();
  if (!list.length) {
    // 空盘就走天元
    thinking.value = false;
    place(7, 7, me);
    return;
  }
  let best: [number, number][] = [];
  let bestScore = -1;
  for (const [x, y] of list) {
    // 自己的收益 + 挡对手的收益：挡的权重略低，同分时优先自己成型
    const score = scoreAt(x, y, me) + scoreAt(x, y, foe) * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = [[x, y]];
    } else if (score === bestScore) {
      best.push([x, y]);
    }
  }
  const [x, y] = best[Math.floor(Math.random() * best.length)];
  thinking.value = false;
  place(x, y, me);
}

// ── 触摸 ───────────────────────────────────────────────────────────────

/** 触点 → 最近的交叉点；离得太远（超过半路）算没点中。 */
function hit(event: FjsTouchEvent): [number, number] | null {
  const touch = event.changedTouches[0];
  if (!touch || !cell) return null;
  const x = Math.round((touch.offsetX - ox) / cell);
  const y = Math.round((touch.offsetY - oy) / cell);
  if (x < 0 || x >= N || y < 0 || y >= N) return null;
  const dx = touch.offsetX - (ox + x * cell);
  const dy = touch.offsetY - (oy + y * cell);
  if (Math.abs(dx) > cell * 0.5 || Math.abs(dy) > cell * 0.5) return null;
  return [x, y];
}

function onAim(event: FjsTouchEvent): void {
  if (winner.value || thinking.value) return;
  const spot = hit(event);
  aim = spot && at(spot[0], spot[1]) === 0 ? spot : null;
  paint();
}

function onDrop(event: FjsTouchEvent): void {
  const spot = aim ?? hit(event);
  aim = null;
  if (spot) play(spot[0], spot[1]);
  else paint();
}

function onCancel(): void {
  aim = null;
  paint();
}

onUnmounted(() => {
  if (timer) clearTimeout(timer);
});

// ── 绘制 ───────────────────────────────────────────────────────────────

function onResize(): void {
  const canvas = cv.value;
  if (!canvas) return;
  // 棋盘是正方的：短边定路距，四周各留一路当边距
  const size = Math.min(canvas.width, canvas.height);
  cell = Math.floor(size / (N + 1));
  ox = Math.round((canvas.width - cell * (N - 1)) / 2);
  oy = Math.round((canvas.height - cell * (N - 1)) / 2);
  paint();
}

/** 圆角矩形。`roundRect()` 两端都不支持，四角用 `arcTo` 倒角——它是「从上一个
 *  点走向 (x1,y1)、再拐向 (x2,y2)，在拐角处切一段半径 r 的弧」，弧结束在切点上，
 *  所以四条边各写一次就闭合了。 */
function roundRect(
  ctx: FjsCanvasContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 一颗子：渐变球 + 落地阴影，黑白各一套配色。 */
function stone(ctx: FjsCanvasContext2D, x: number, y: number, side: Side, alpha = 1): void {
  const cx = ox + x * cell;
  const cy = oy + y * cell;
  const r = cell * 0.44;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  if (side === 1) {
    g.addColorStop(0, '#6b6b6b');
    g.addColorStop(1, '#080808');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#cfcfcf');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // 阴影是状态，画完就关掉，否则后面的线条也会带影子
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (side === 2) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paint(): void {
  const canvas = cv.value;
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas || !cell) return;

  // 整块清：这一页每次重画都是整幅，宿主据此丢掉上一幅的命令
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const span = cell * (N - 1);
  // 棋盘是一块正方的木板：四周各留一路当边距，圆角用 arcTo 拼（roundRect 不支持）
  const pad = cell * 0.8;
  const bx = ox - pad;
  const by = oy - pad;
  const bw = span + pad * 2;
  ctx.shadowColor = 'rgba(90, 60, 20, 0.28)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#e3bd83';
  roundRect(ctx, bx, by, bw, bw, Math.min(12, cell));
  ctx.fill();
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.strokeStyle = '#7c5a30';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    // +0.5 让 1px 的线落在像素中心，两端都不糊
    ctx.moveTo(ox + 0.5, oy + i * cell + 0.5);
    ctx.lineTo(ox + span + 0.5, oy + i * cell + 0.5);
    ctx.moveTo(ox + i * cell + 0.5, oy + 0.5);
    ctx.lineTo(ox + i * cell + 0.5, oy + span + 0.5);
  }
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.strokeRect(ox + 0.5, oy + 0.5, span, span);

  ctx.fillStyle = '#7c5a30';
  for (const [sx, sy] of STARS) {
    ctx.beginPath();
    ctx.arc(ox + sx * cell, oy + sy * cell, Math.max(2, cell * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = at(x, y);
      if (v) stone(ctx, x, y, v);
    }
  }

  // 最后一手打个点，回头看得出对手刚下在哪
  const last = moves.value[moves.value.length - 1];
  if (last && !winner.value) {
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(ox + last.x * cell, oy + last.y * cell, Math.max(2, cell * 0.1), 0, Math.PI * 2);
    ctx.fill();
  }

  if (aim) stone(ctx, aim[0], aim[1], turn.value, 0.45);

  if (winner.value && winLine.length >= 2) {
    // winLine 是「先落的那颗 + 两个方向各自延伸」，顺序不是首尾；按 x 再按 y
    // 排一次就得到两端（竖线 x 相同，退化成按 y 排）
    const sorted = [...winLine].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const head = sorted[0];
    const tail = sorted[sorted.length - 1];
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = Math.max(2, cell * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ox + head[0] * cell, oy + head[1] * cell);
    ctx.lineTo(ox + tail[0] * cell, oy + tail[1] * cell);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}
</script>

<template>
  <view class="page">
    <view class="bar">
      <view class="seg">
        <view
          class="seg-item"
          :class="{ on: mode === 'ai' }"
          @tap="setMode('ai')"
        >
          <text class="seg-text">人机</text>
        </view>
        <view
          class="seg-item"
          :class="{ on: mode === 'duo' }"
          @tap="setMode('duo')"
        >
          <text class="seg-text">双人</text>
        </view>
      </view>
      <view class="turn">
        <view class="dot" :class="{ white: (winner || turn) === 2 }" />
        <text class="turn-text">{{ hint }}</text>
      </view>
      <text class="count">第 {{ moves.length }} 手</text>
    </view>

    <view class="stage">
      <!-- 棋盘吃住触摸：按住瞄准、抬手落子，外层滚动不要抢 touchmove -->
      <canvas
        ref="cv"
        class="board"
        @resize="onResize"
        @touchstart="onAim"
        @touchmove="onAim"
        @touchend="onDrop"
        @touchcancel="onCancel"
      />
    </view>

    <view class="actions">
      <button class="btn" :class="{ dim: !canUndo }" @tap="undo()">悔棋</button>
      <button class="btn primary" @tap="restart()">重开</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  width: 100%;
  height: 100%;
  padding: 12px 16px 16px;
  background-color: #f4efe6;
}
.bar {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.seg {
  flex-direction: row;
  padding: 2px;
  border-radius: 8px;
  background-color: #e3dbcc;
}
.seg-item {
  padding: 5px 12px;
  border-radius: 6px;
}
/* 选中态照 WeUI：白底 + 轻阴影，不动位移 */
.seg-item.on {
  background-color: #ffffff;
}
.seg-text {
  font-size: 13px;
  color: #6b6156;
}
.seg-item.on .seg-text {
  color: #1a1a1a;
  font-weight: 500;
}
.turn {
  flex-grow: 1;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 6px;
  background-color: #1a1a1a;
}
.dot.white {
  background-color: #ffffff;
  border: 1px solid #c9bfae;
}
.turn-text {
  font-size: 13px;
  color: #4a4038;
}
.count {
  font-size: 12px;
  color: #9a8f80;
}
.stage {
  flex-grow: 1;
  margin-top: 12px;
}
.board {
  width: 100%;
  height: 100%;
  touch-action: none;
}
.actions {
  margin-top: 14px;
  flex-direction: row;
  gap: 12px;
}
.btn {
  flex-grow: 1;
  padding: 10px 0;
  border-radius: 8px;
  background-color: #e3dbcc;
  color: #4a4038;
  font-size: 15px;
}
.primary {
  background-color: #8a6a3f;
  color: #ffffff;
}
.dim {
  opacity: 0.45;
}
</style>
