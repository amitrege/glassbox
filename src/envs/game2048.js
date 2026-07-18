// 2048: deterministic slide/merge + one random spawn per effective move.
// The stochastic part is fully observable (the new tile), which is what makes
// exact verification possible via event reconstruction.
import { mulberry32 } from "./minesweeper.js";

const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export function slideGrid(grid, dir) {
  const h = grid.length, w = grid[0].length;
  const g = grid.map((r) => r.slice());
  let scoreDelta = 0, changed = false;
  const lines = [];
  if (dir === "left" || dir === "right") {
    for (let y = 0; y < h; y++) lines.push([...Array(w)].map((_, x) => [dir === "left" ? x : w - 1 - x, y]));
  } else {
    for (let x = 0; x < w; x++) lines.push([...Array(h)].map((_, y) => [x, dir === "up" ? y : h - 1 - y]));
  }
  for (const line of lines) {
    const vals = line.map(([x, y]) => g[y][x]).filter((v) => v !== 0);
    const out = [];
    for (let i = 0; i < vals.length; i++) {
      if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
        out.push(vals[i] * 2);
        scoreDelta += vals[i] * 2;
        i++;
      } else out.push(vals[i]);
    }
    line.forEach(([x, y], i) => {
      const v = i < out.length ? out[i] : 0;
      if (g[y][x] !== v) changed = true;
      g[y][x] = v;
    });
  }
  return { grid: g, scoreDelta, changed };
}

function empties(g) {
  const out = [];
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) if (g[y][x] === 0) out.push({ x, y });
  return out;
}

function anyMove(g) {
  return Object.keys(DIRS).some((d) => slideGrid(g, d).changed);
}

export const game2048 = {
  id: "env_B",
  actions: ["up", "down", "left", "right"],

  init({ w, h, seed }) {
    const rng = mulberry32(seed);
    const grid = Array.from({ length: h }, () => Array(w).fill(0));
    const s = { w, h, grid, score: 0, rng, status: "playing" };
    this._spawn(s); this._spawn(s);
    return s;
  },

  _spawn(s) {
    const e = empties(s.grid);
    if (!e.length) return;
    const { x, y } = e[Math.floor(s.rng() * e.length)];
    s.grid[y][x] = s.rng() < 0.9 ? 2 : 4;
  },

  step(s, action) {
    if (s.status !== "playing" || !DIRS[action]) return s;
    const { grid, scoreDelta, changed } = slideGrid(s.grid, action);
    if (!changed) return s; // ineffective move: nothing happens, no spawn
    s.grid = grid;
    s.score += scoreDelta;
    this._spawn(s);
    if (!anyMove(s.grid)) s.status = "over";
    return s;
  },

  observe(s) {
    return { grid: s.grid.map((r) => r.slice()), vars: { score: s.score }, status: s.status };
  },
};

export const numGridStr = (grid) => grid.map((r) => r.join(",")).join("/");
export const parseNumGrid = (str) => str.split("/").map((r) => r.split(",").map(Number));
