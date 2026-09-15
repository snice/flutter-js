// Match-3 board model — pure functions, no pixi / no Vue (spec 058).
//
// The page owns the grid instance. Each phase of a turn maps to one function
// so the page can animate between them:
//
//   swap → findClears（无 → swap 回去）
//        → removeCells → collapse（下落 + 顶部补充）→ 再 findClears，直到没有
//
// 网格是满的 number[][]，-1 只在 removeCells 与 collapse 之间瞬时存在。
// rng 显式传入（默认 Math.random 也行），函数本身不碰时间与全局状态，
// 这样重排、补充的随机性都由页面控制。

export type Rng = () => number;

export interface Swap {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** 既有宝石在同一列里从 r1 落到 r2。 */
export interface Fall {
  r1: number;
  r2: number;
  c: number;
}

/** 新宝石落进第 c 列第 r 行；出发位置在棋盘上方（from 为负行号）。 */
export interface Spawn {
  c: number;
  r: number;
  color: number;
  from: number;
}

export interface Collapse {
  falls: Fall[];
  spawns: Spawn[];
}

export type Grid = number[][];

/** 生成一个没有现成三消、且至少有一个可行交换的棋盘。 */
export function createBoard(
  rows: number,
  cols: number,
  colors: number,
  rng: Rng,
): Grid {
  let best: Grid | null = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid = fillBoard(rows, cols, colors, rng);
    if (findMove(grid)) return grid;
    // 留着最后一个无三消的盘面当兜底——理论上 200 次内必有可行步
    if (!best && findClears(grid).length === 0) best = grid;
  }
  return best ?? fillBoard(rows, cols, colors, rng);
}

function fillBoard(
  rows: number,
  cols: number,
  colors: number,
  rng: Rng,
): Grid {
  const grid: Grid = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array<number>(cols);
    for (let c = 0; c < cols; c++) row[c] = Math.floor(rng() * colors);
    grid.push(row);
  }
  // 抹掉现成三消：把命中的格子重掷，直到干净（列优先扫描天然收敛）
  for (let i = 0; i < 100; i++) {
    const clears = findClears(grid);
    if (clears.length === 0) break;
    for (const idx of clears) {
      grid[Math.floor(idx / cols)][idx % cols] = Math.floor(rng() * colors);
    }
  }
  return grid;
}

/** 所有处于 ≥3 同色连线上（横/竖）的格子，flat 下标 r*cols+c。 */
export function findClears(grid: Grid): number[] {
  const rows = grid.length;
  const cols = grid[0].length;
  const hits = new Set<number>();
  const run = (cells: Array<[number, number]>, color: number): void => {
    // color < 0 只存在于 collapse 的瞬间，视为不可消除
    if (color >= 0 && cells.length >= 3) {
      for (const [r, c] of cells) hits.add(r * cols + c);
    }
  };
  for (let r = 0; r < rows; r++) {
    let start = 0;
    for (let c = 1; c <= cols; c++) {
      if (c === cols || grid[r][c] !== grid[r][start]) {
        run(
          Array.from({ length: c - start }, (_, k) => [r, start + k] as [number, number]),
          grid[r][start],
        );
        start = c;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let start = 0;
    for (let r = 1; r <= rows; r++) {
      const color = r < rows ? grid[r][c] : NaN;
      if (r === rows || color !== grid[start][c]) {
        run(
          Array.from({ length: r - start }, (_, k) => [start + k, c] as [number, number]),
          grid[start][c],
        );
        start = r;
      }
    }
  }
  return [...hits];
}

export function swapCells(
  grid: Grid,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): void {
  const t = grid[r1][c1];
  grid[r1][c1] = grid[r2][c2];
  grid[r2][c2] = t;
}

/** 这个交换（须相邻）能不能产生三消。试完原样换回。 */
export function swapClears(
  grid: Grid,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  swapCells(grid, r1, c1, r2, c2);
  const hits = findClears(grid).length > 0;
  swapCells(grid, r1, c1, r2, c2);
  return hits;
}

/** 第一个可行的交换（行优先，确定性顺序），没有则 null —— 提示与死局共用。 */
export function findMove(grid: Grid): Swap | null {
  const rows = grid.length;
  const cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && swapClears(grid, r, c, r, c + 1)) {
        return { r1: r, c1: c, r2: r, c2: c + 1 };
      }
      if (r + 1 < rows && swapClears(grid, r, c, r + 1, c)) {
        return { r1: r, c1: c, r2: r + 1, c2: c };
      }
    }
  }
  return null;
}

export function removeCells(grid: Grid, cells: number[]): void {
  const cols = grid[0].length;
  for (const idx of cells) grid[Math.floor(idx / cols)][idx % cols] = -1;
}

/** 每列压实到底部；空出的顶部格子按落点顺序给出新宝石（出发行堆在盘外）。 */
export function collapse(
  grid: Grid,
  colors: number,
  rng: Rng,
): Collapse {
  const rows = grid.length;
  const cols = grid[0].length;
  const falls: Fall[] = [];
  const spawns: Spawn[] = [];
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const color = grid[r][c];
      if (color < 0) continue;
      if (write !== r) {
        grid[write][c] = color;
        grid[r][c] = -1;
        falls.push({ r1: r, r2: write, c });
      }
      write--;
    }
    // write 之后还空着 write..0 共 write+1 格，新宝石按最终落点堆叠出发
    const need = write + 1;
    for (let j = 0; j < need; j++) {
      const color = Math.floor(rng() * colors);
      grid[j][c] = color;
      spawns.push({ c, r: j, color, from: j - need });
    }
  }
  return { falls, spawns };
}

/** 原地重排（保持颜色数量），直到无现成三消且有可行步。 */
export function shuffleBoard(grid: Grid, rng: Rng): void {
  const rows = grid.length;
  const cols = grid[0].length;
  const colors: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) colors.push(grid[r][c]);
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = colors[i];
      colors[i] = colors[j];
      colors[j] = t;
    }
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) grid[r][c] = colors[k++];
    }
    if (findClears(grid).length === 0 && findMove(grid)) return;
  }
}
