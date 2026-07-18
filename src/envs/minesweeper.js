// The real environment the agent probes. The agent never sees this file —
// only observations. Works in Node and in the browser (ES module).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
// Knight's-move neighborhood: the "not-quite-minesweeper" variant. Digits count
// mines a knight's move away, and 0-cells cascade along knight moves too.
// Looks exactly like Minesweeper; prior knowledge actively misleads.
const KNIGHT = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

export const minesweeper = {
  id: "env_A",
  actions: ["reveal(x,y)", "flag(x,y)"],

  init({ w, h, mines, seed, neighborhood = "n8", torus = false }) {
    return {
      w, h, minesCount: mines, rng: mulberry32(seed), torus,
      neigh: neighborhood === "knight" ? KNIGHT : N8,
      mines: null, // placed lazily on first reveal (the hidden mechanic)
      revealed: new Set(), flagged: new Set(),
      status: "playing", fatal: null,
    };
  },

  _placeMines(s, avoidIdx) {
    const total = s.w * s.h;
    const cells = [];
    for (let i = 0; i < total; i++) if (i !== avoidIdx) cells.push(i);
    // Fisher-Yates partial shuffle with the seeded rng
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(s.rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    s.mines = new Set(cells.slice(0, s.minesCount));
  },

  _adj(s, x, y) {
    let n = 0;
    for (const [dx, dy] of s.neigh) {
      let nx = x + dx, ny = y + dy;
      if (s.torus) { nx = (nx + s.w) % s.w; ny = (ny + s.h) % s.h; }
      if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h && s.mines.has(ny * s.w + nx)) n++;
    }
    return n;
  },

  step(s, action) {
    if (s.status !== "playing") return s;
    const { x, y } = action;
    if (x < 0 || x >= s.w || y < 0 || y >= s.h) return s;
    const idx = y * s.w + x;

    if (action.type === "flag") {
      if (s.revealed.has(idx)) return s;
      if (s.flagged.has(idx)) s.flagged.delete(idx);
      else s.flagged.add(idx);
      return s;
    }

    // reveal
    if (s.flagged.has(idx) || s.revealed.has(idx)) return s;
    if (s.mines === null) this._placeMines(s, idx); // first click is always safe
    if (s.mines.has(idx)) {
      s.status = "lost";
      s.fatal = idx;
      return s;
    }
    // flood reveal
    const stack = [idx];
    while (stack.length) {
      const i = stack.pop();
      if (s.revealed.has(i)) continue;
      s.revealed.add(i);
      s.flagged.delete(i);
      const cx = i % s.w, cy = Math.floor(i / s.w);
      if (this._adj(s, cx, cy) === 0) {
        for (const [dx, dy] of s.neigh) {
          let nx = cx + dx, ny = cy + dy;
          if (s.torus) { nx = (nx + s.w) % s.w; ny = (ny + s.h) % s.h; }
          if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h) {
            const ni = ny * s.w + nx;
            if (!s.revealed.has(ni) && !s.mines.has(ni)) stack.push(ni);
          }
        }
      }
    }
    if (s.revealed.size === s.w * s.h - s.minesCount) s.status = "won";
    return s;
  },

  observe(s) {
    const grid = [];
    const over = s.status !== "playing";
    for (let y = 0; y < s.h; y++) {
      const row = [];
      for (let x = 0; x < s.w; x++) {
        const idx = y * s.w + x;
        if (s.revealed.has(idx)) row.push(String(this._adj(s, x, y)));
        else if (over && s.mines && s.mines.has(idx)) row.push(idx === s.fatal ? "!" : "*");
        else if (s.flagged.has(idx)) row.push("F");
        else row.push("#");
      }
      grid.push(row);
    }
    return { grid, vars: { counter: s.minesCount - s.flagged.size }, status: s.status };
  },
};

export const gridStr = (grid) => grid.map((r) => r.join("")).join("/");
export const parseGrid = (str) => str.split("/").map((r) => r.split(""));
