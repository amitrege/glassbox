// Canned LLM responses for plumbing tests (GLASSBOX_LLM=mock).
// Call 1 returns a model with a deliberate flood-fill bug (4-neighbor) so we can
// watch the refutation loop fire; call 2 returns the corrected model.

const modelSrc = (floodNeighbors) => `
const N8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
const N4 = [[0,-1],[-1,0],[1,0],[0,1]];
const FLOOD = ${floodNeighbors === 4 ? "N4" : "N8"};
const model = {
  discoveries: [
    "Revealed digits equal the count of adjacent hidden-special cells (8-neighborhood)",
    "Revealing a 0-cell auto-reveals its neighborhood recursively",
    "counter = hiddenCount - number of F cells",
    "Final grids expose hidden cells as * (and ! for the fatal one)",
    "status becomes lost on revealing a hidden cell; won when all non-hidden cells are revealed",
    "The first revealed cell was never a hidden cell in any episode — placement appears to avoid it"
  ],
  reconstructHidden(finalGrid) {
    return finalGrid.map(row => row.map(c => c === "*" || c === "!"));
  },
  init(w, h, hiddenCount, hiddenGrid, rng) {
    let hidden = null;
    if (hiddenGrid) {
      hidden = new Set();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (hiddenGrid[y][x]) hidden.add(y * w + x);
    }
    return { w, h, hiddenCount, hidden, rng, revealed: new Set(), flagged: new Set(), status: "playing", fatal: null };
  },
  _adj(s, x, y) {
    let n = 0;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h && s.hidden.has(ny * s.w + nx)) n++;
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
      if (s.flagged.has(idx)) s.flagged.delete(idx); else s.flagged.add(idx);
      return s;
    }
    if (s.flagged.has(idx) || s.revealed.has(idx)) return s;
    if (s.hidden === null) {
      const cells = [];
      for (let i = 0; i < s.w * s.h; i++) if (i !== idx) cells.push(i);
      for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(s.rng() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }
      s.hidden = new Set(cells.slice(0, s.hiddenCount));
    }
    if (s.hidden.has(idx)) { s.status = "lost"; s.fatal = idx; return s; }
    const stack = [idx];
    while (stack.length) {
      const i = stack.pop();
      if (s.revealed.has(i)) continue;
      s.revealed.add(i);
      s.flagged.delete(i);
      const cx = i % s.w, cy = Math.floor(i / s.w);
      if (this._adj(s, cx, cy) === 0) {
        for (const [dx, dy] of FLOOD) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h) {
            const ni = ny * s.w + nx;
            if (!s.revealed.has(ni) && !s.hidden.has(ni)) stack.push(ni);
          }
        }
      }
    }
    if (s.revealed.size === s.w * s.h - s.hiddenCount) s.status = "won";
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
        else if (over && s.hidden && s.hidden.has(idx)) row.push(idx === s.fatal ? "!" : "*");
        else if (s.flagged.has(idx)) row.push("F");
        else row.push("#");
      }
      grid.push(row);
    }
    return { grid, vars: { counter: s.hiddenCount - s.flagged.size }, status: s.status };
  },
};`;

let calls = 0;
export async function mockComplete() {
  calls++;
  const wrong = calls === 1;
  const narration = wrong
    ? "Digits count adjacent hidden cells; zero-cells cascade to their 4 orthogonal neighbors."
    : "The cascade counterexample shows diagonal cells opening too — the cascade uses the full 8-neighborhood, same as the digit counts.";
  return `NARRATION: ${narration}\n\`\`\`js${modelSrc(wrong ? 4 : 8)}\n\`\`\``;
}
