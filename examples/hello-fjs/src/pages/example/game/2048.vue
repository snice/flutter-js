<route>
{"title": "2048", "scroll": false, "group": "交互游戏", "desc": "滑动合并数字，位置和缩放都走 transform"}
</route>

<script setup lang="ts">
// 2048：手势 + CSS transition 驱动的合并游戏。
//
// 棋盘是一个 4×4 的坐标系，而**方块列表是扁平的**：每个方块自己记 row/col，
// 位置只写在 transform 上，所以一次滑动里没有任何节点插入/删除/重排——16 个
// 节点从头到尾都在原地，跨桥的只是它们的 transform。合并出来的那一格晚 MOVE_MS
// 才改数字，等被吃掉的方块滑到位再消失，这样「滑过去 → 合成」是连贯的一段。
//
// 手势不等 touchend：手指划过阈值当帧就走一步，然后锁到这根手指抬起为止。
import { nextTick, reactive, ref, shallowRef } from 'vue';
import type { FjsTouchEvent } from 'fjs';

const SIZE = 4;
const CELL = 68;
const GAP = 10;
const STEP = CELL + GAP;
const BOARD = GAP + SIZE * STEP;

/** 一步滑动的时长，和 .tile 上的 transition 对齐。 */
const MOVE_MS = 110;
/** 划过多少像素算一次滑动。 */
const THRESHOLD = 18;

type Dir = 'up' | 'down' | 'left' | 'right';

const VECTORS: Record<Dir, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

interface Tile {
  id: number;
  value: number;
  row: number;
  col: number;
  /** 刚生成：先画在 scale(0.2)，下一帧回 1，靠 transition 弹出来。 */
  spawn: boolean;
  /** 刚合并：短暂放大一下。 */
  pop: boolean;
  /** 这一步已经吃过一次，不能再吃第二次。 */
  eaten: boolean;
}

/** 一步棋的快照，撤销用。 */
interface Snapshot {
  cells: number[];
  score: number;
}

const CELLS = Array.from({ length: SIZE * SIZE }, (_, i) => ({
  id: i,
  x: GAP + (i % SIZE) * STEP,
  y: GAP + Math.floor(i / SIZE) * STEP,
}));

// 最高分挂在模块上：离开页面再回来还在（这个 demo 不碰持久化存储）。
const best = ref(0);

const tiles = shallowRef<Tile[]>([]);
const score = ref(0);
const over = ref(false);
const won = ref(false);
const canUndo = ref(false);

let grid: (Tile | null)[][] = emptyGrid();
let nextId = 1;
/** 动画没播完之前不接新的一步。 */
let busy = false;
let history: Snapshot | null = null;

function emptyGrid(): (Tile | null)[][] {
  return Array.from({ length: SIZE }, () => Array<Tile | null>(SIZE).fill(null));
}

const inside = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

function afterPaint(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

// ── 棋盘 ───────────────────────────────────────────────────────────────

function addTile(row: number, col: number, value: number, animate = true): Tile {
  const tile = reactive<Tile>({
    id: nextId++,
    value,
    row,
    col,
    spawn: animate,
    pop: false,
    eaten: false,
  });
  grid[row][col] = tile;
  tiles.value = [...tiles.value, tile];
  if (animate) {
    // 先让它以 scale(0.2) 上屏，画完这一帧再回 1，transition 才有得插值
    void nextTick(() => afterPaint(() => (tile.spawn = false)));
  }
  return tile;
}

function spawn(): void {
  const free: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) if (!grid[r][c]) free.push([r, c]);
  }
  if (!free.length) return;
  const [r, c] = free[Math.floor(Math.random() * free.length)];
  addTile(r, c, Math.random() < 0.9 ? 2 : 4);
}

function restart(): void {
  busy = false;
  history = null;
  canUndo.value = false;
  grid = emptyGrid();
  tiles.value = [];
  score.value = 0;
  over.value = false;
  won.value = false;
  spawn();
  spawn();
}

/** 棋盘拍平成 16 个数字，撤销时按这个重建。 */
function snapshot(): Snapshot {
  const cells: number[] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) cells.push(grid[r][c]?.value ?? 0);
  }
  return { cells, score: score.value };
}

function undo(): void {
  if (!history || busy) return;
  const snap = history;
  history = null;
  canUndo.value = false;
  grid = emptyGrid();
  tiles.value = [];
  snap.cells.forEach((value, i) => {
    if (value) addTile(Math.floor(i / SIZE), i % SIZE, value, false);
  });
  score.value = snap.score;
  over.value = false;
}

/** 还有空格，或者还有一对相邻的相同数字。 */
function movesLeft(): boolean {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tile = grid[r][c];
      if (!tile) return true;
      const right = c + 1 < SIZE ? grid[r][c + 1] : null;
      const down = r + 1 < SIZE ? grid[r + 1][c] : null;
      if (right?.value === tile.value || down?.value === tile.value) return true;
    }
  }
  return false;
}

// ── 一步滑动 ───────────────────────────────────────────────────────────

function move(dir: Dir): void {
  if (busy || over.value) return;
  const [dr, dc] = VECTORS[dir];

  // 顺着移动方向从远端开始扫，前面的格子先落位，后面的才知道自己能滑到哪
  const rows = [0, 1, 2, 3];
  const cols = [0, 1, 2, 3];
  if (dr > 0) rows.reverse();
  if (dc > 0) cols.reverse();

  const before = snapshot();
  const merges: { tile: Tile; value: number }[] = [];
  const eaten: Tile[] = [];
  let moved = false;
  let gained = 0;

  for (const tile of tiles.value) tile.eaten = false;

  for (const r of rows) {
    for (const c of cols) {
      const tile = grid[r][c];
      if (!tile) continue;
      grid[r][c] = null;

      let nr = r;
      let nc = c;
      while (inside(nr + dr, nc + dc) && !grid[nr + dr][nc + dc]) {
        nr += dr;
        nc += dc;
      }

      const tr = nr + dr;
      const tc = nc + dc;
      const target = inside(tr, tc) ? grid[tr][tc] : null;

      if (target && target.value === tile.value && !target.eaten) {
        // 滑到目标格上面叠着，等动画播完再消失、目标格再翻倍
        tile.row = tr;
        tile.col = tc;
        target.eaten = true;
        eaten.push(tile);
        merges.push({ tile: target, value: target.value * 2 });
        gained += target.value * 2;
        moved = true;
      } else {
        grid[nr][nc] = tile;
        if (nr !== r || nc !== c) {
          tile.row = nr;
          tile.col = nc;
          moved = true;
        }
      }
    }
  }

  if (!moved) return;

  busy = true;
  history = before;
  canUndo.value = true;
  score.value += gained;
  if (score.value > best.value) best.value = score.value;

  setTimeout(() => {
    const gone = new Set(eaten.map((t) => t.id));
    if (gone.size) tiles.value = tiles.value.filter((t) => !gone.has(t.id));
    for (const { tile, value } of merges) {
      tile.value = value;
      tile.pop = true;
      if (value >= 2048) won.value = true;
    }
    if (merges.length) {
      setTimeout(() => {
        for (const { tile } of merges) tile.pop = false;
      }, MOVE_MS);
    }
    spawn();
    busy = false;
    if (!movesLeft()) over.value = true;
  }, MOVE_MS);
}

// ── 手势 ───────────────────────────────────────────────────────────────

let pointer = -1;
let startX = 0;
let startY = 0;
/** 这一划已经走过一步，抬手之前不再触发。 */
let fired = false;

function onTouchstart(event: FjsTouchEvent) {
  const touch = event.changedTouches[0];
  if (!touch) return;
  pointer = touch.identifier;
  startX = touch.clientX;
  startY = touch.clientY;
  fired = false;
}

function onTouchmove(event: FjsTouchEvent) {
  if (fired || pointer === -1) return;
  const touch = [...event.changedTouches].find((t) => t.identifier === pointer);
  if (!touch) return;
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
  fired = true;
  move(
    Math.abs(dx) > Math.abs(dy)
      ? dx > 0
        ? 'right'
        : 'left'
      : dy > 0
        ? 'down'
        : 'up',
  );
}

function onTouchend() {
  pointer = -1;
  fired = false;
}

// ── 皮肤 ───────────────────────────────────────────────────────────────

const SKIN: Record<number, [string, string]> = {
  2: ['#eee4da', '#776e65'],
  4: ['#ede0c8', '#776e65'],
  8: ['#f2b179', '#f9f6f2'],
  16: ['#f59563', '#f9f6f2'],
  32: ['#f67c5f', '#f9f6f2'],
  64: ['#f65e3b', '#f9f6f2'],
  128: ['#edcf72', '#f9f6f2'],
  256: ['#edcc61', '#f9f6f2'],
  512: ['#edc850', '#f9f6f2'],
  1024: ['#edc53f', '#f9f6f2'],
  2048: ['#edc22e', '#f9f6f2'],
};

function tileStyle(tile: Tile): Record<string, unknown> {
  const [bg, color] = SKIN[tile.value] ?? ['#3c3a32', '#f9f6f2'];
  const digits = String(tile.value).length;
  const scale = tile.spawn ? 0.2 : tile.pop ? 1.1 : 1;
  return {
    backgroundColor: bg,
    color,
    fontSize: digits > 4 ? 18 : digits > 3 ? 21 : digits > 2 ? 26 : 30,
    transform: `translate(${GAP + tile.col * STEP}px, ${GAP + tile.row * STEP}px) scale(${scale})`,
  };
}

restart();
</script>

<template>
  <view class="page">
    <view class="head">
      <view class="head-main">
        <text class="title">2048</text>
        <text class="hint">滑动棋盘合并相同数字</text>
      </view>
      <view class="board-box">
        <text class="box-label">分数</text>
        <text class="box-value">{{ score }}</text>
      </view>
      <view class="board-box">
        <text class="box-label">最高</text>
        <text class="box-value">{{ best }}</text>
      </view>
    </view>

    <view
      class="board"
      @touchstart="onTouchstart"
      @touchmove="onTouchmove"
      @touchend="onTouchend"
      @touchcancel="onTouchend"
    >
      <view
        v-for="cell in CELLS"
        :key="`cell-${cell.id}`"
        class="slot"
        :style="{ transform: `translate(${cell.x}px, ${cell.y}px)` }"
      />

      <view
        v-for="tile in tiles"
        :key="tile.id"
        class="tile"
        :style="tileStyle(tile)"
      >
        <!-- color / font-size 沿树继承，方块上写一次就够了 -->
        <text class="tile-text">{{ tile.value }}</text>
      </view>

      <view v-if="over" class="mask">
        <text class="mask-title">没有可以走的了</text>
        <text class="mask-score">得分 {{ score }}</text>
      </view>
    </view>

    <text v-if="won" class="won">🎉 合出 2048 了，接着往上叠</text>

    <view class="actions">
      <button class="btn" @tap="restart()">重开</button>
      <button class="btn ghost" :class="{ dim: !canUndo }" @tap="undo()">撤销</button>
    </view>
  </view>
</template>

<style scoped>
.page {
  flex-grow: 1;
  padding: 16px;
  align-items: center;
  background-color: #faf8ef;
}
.head {
  width: 322px;
  flex-direction: row;
  align-items: flex-end;
  gap: 8px;
}
.head-main {
  flex-grow: 1;
  gap: 4px;
}
.title {
  font-size: 30px;
  font-weight: 700;
  color: #776e65;
}
.hint {
  font-size: 12px;
  color: #a29a90;
}
.board-box {
  width: 64px;
  padding: 6px 0;
  align-items: center;
  border-radius: 6px;
  background-color: #bbada0;
}
.box-label {
  font-size: 11px;
  color: #eee4da;
}
.box-value {
  margin-top: 2px;
  font-size: 17px;
  font-weight: 700;
  color: #ffffff;
}
.board {
  position: relative;
  margin-top: 16px;
  width: 322px;
  height: 322px;
  border-radius: 12px;
  background-color: #bbada0;
  overflow: hidden;
  /* 手势归棋盘自己：上下滑不再被外层滚动抢走 */
  touch-action: none;
}
.slot {
  position: absolute;
  left: 0;
  top: 0;
  width: 68px;
  height: 68px;
  border-radius: 8px;
  background-color: #cdc1b4;
}
.tile {
  position: absolute;
  left: 0;
  top: 0;
  width: 68px;
  height: 68px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  /* 移动和弹出是同一条 transform，一条 transition 全包了 */
  transition: transform 110ms ease;
}
.tile-text {
  font-weight: 700;
}
.mask {
  position: absolute;
  left: 0;
  top: 0;
  width: 322px;
  height: 322px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background-color: rgba(238, 228, 218, 0.86);
}
.mask-title {
  font-size: 22px;
  font-weight: 700;
  color: #776e65;
}
.mask-score {
  font-size: 14px;
  color: #8f8578;
}
.won {
  margin-top: 12px;
  font-size: 13px;
  color: #b8873c;
}
.actions {
  margin-top: 16px;
  flex-direction: row;
  gap: 12px;
}
.btn {
  padding: 9px 22px;
  border-radius: 6px;
  background-color: #8f7a66;
  color: #f9f6f2;
  font-size: 14px;
}
.ghost {
  background-color: #cdc1b4;
  color: #776e65;
}
.dim {
  opacity: 0.45;
}
</style>
