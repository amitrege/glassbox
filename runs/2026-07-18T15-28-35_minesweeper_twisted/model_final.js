const model = {
  discoveries: [
    "Revealed number = count of mines at the 8 knight offsets (±1,±2)/(±2,±1) computed toroidally, per-offset-vector; on 4x4 opposite offsets coincide so values double. Verified across all episodes.",
    "Mines are exposed as '*' at game end; the specific mine that lost the game shows '!' (E1,E2,E3,E5,E6).",
    "Revealing a 0-valued cell flood-fills through toroidal KNIGHT adjacency; number cells reveal but stop propagation, mines block.",
    "CORRECTED: flood-fill does NOT treat flagged cells as blockers — it reveals flagged non-mine cells too, clearing the flag and incrementing the counter (E6: flag at (4,2) counter 3, reveal(5,3) flood reaches it -> '2', counter back to 4).",
    "Directly reveal-clicking a flagged cell is a no-op; flag on a revealed cell is a no-op (E6 step2, E1 flag).",
    "During play counter = hiddenCount - active flags. Flags refunded when flood reveals them.",
    "CORRECTED: on a LOSS, still-flagged non-mine cells render as 'F' (E7 (1,0) stays 'F'); mines render '*'/'!'. Counter is left unchanged on loss.",
    "On WIN the whole board is exposed (all non-mine cells shown as values). Counter is simply the natural running counter after flood refunds flags (E0=2, E4 flags refunded back to 2). No special recompute needed.",
    "Win = every non-mine cell revealed OR flagged; loss = a mine revealed.",
    "Placement rule not observable (hiddenGrid supplied for replays); brand-new games place mines uniformly at random distinct cells."
  ],
  reconstructHidden(finalGrid) {
    const h = finalGrid.length, w = finalGrid[0].length;
    const g = [];
    for (let y = 0; y < h; y++) {
      g.push([]);
      for (let x = 0; x < w; x++) {
        const c = finalGrid[y][x];
        g[y].push(c === '*' || c === '!');
      }
    }
    return g;
  },
  init(w, h, hiddenCount, hiddenGrid, rng) {
    const mines = [];
    for (let y = 0; y < h; y++) { mines.push([]); for (let x = 0; x < w; x++) mines[y].push(false); }
    if (hiddenGrid) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mines[y][x] = !!hiddenGrid[y][x];
    } else {
      let placed = 0;
      while (placed < hiddenCount) {
        const x = Math.floor(rng() * w), y = Math.floor(rng() * h);
        if (!mines[y][x]) { mines[y][x] = true; placed++; }
      }
    }
    const revealed = [], flagged = [];
    for (let y = 0; y < h; y++) {
      revealed.push([]); flagged.push([]);
      for (let x = 0; x < w; x++) { revealed[y].push(false); flagged[y].push(false); }
    }
    return { w, h, hiddenCount, mines, revealed, flagged, status: "playing", counter: hiddenCount, lostX: -1, lostY: -1 };
  },
  _offs: [[1,2],[1,-2],[-1,2],[-1,-2],[2,1],[2,-1],[-2,1],[-2,-1]],
  _val(s, x, y) {
    let c = 0;
    for (const o of this._offs) {
      const nx = ((x + o[0]) % s.w + s.w) % s.w, ny = ((y + o[1]) % s.h + s.h) % s.h;
      if (s.mines[ny][nx]) c++;
    }
    return c;
  },
  step(state, action) {
    const s = state;
    if (s.status !== "playing") return s;
    const type = action.type, x = action.x, y = action.y;
    if (type === "flag") {
      if (s.revealed[y][x]) return s;
      if (s.flagged[y][x]) { s.flagged[y][x] = false; s.counter++; }
      else { s.flagged[y][x] = true; s.counter--; }
      return s;
    }
    // reveal
    if (s.flagged[y][x] || s.revealed[y][x]) return s;
    if (s.mines[y][x]) { s.status = "lost"; s.lostX = x; s.lostY = y; return s; }
    const stack = [[x, y]];
    while (stack.length) {
      const cell = stack.pop();
      const cx = cell[0], cy = cell[1];
      if (s.revealed[cy][cx] || s.mines[cy][cx]) continue;
      if (s.flagged[cy][cx]) { s.flagged[cy][cx] = false; s.counter++; }
      s.revealed[cy][cx] = true;
      if (this._val(s, cx, cy) === 0) {
        for (const o of this._offs) {
          const nx = ((cx + o[0]) % s.w + s.w) % s.w, ny = ((cy + o[1]) % s.h + s.h) % s.h;
          if (!s.revealed[ny][nx] && !s.mines[ny][nx]) stack.push([nx, ny]);
        }
      }
    }
    let win = true;
    for (let yy = 0; yy < s.h && win; yy++) {
      for (let xx = 0; xx < s.w; xx++) {
        if (!s.mines[yy][xx] && !s.revealed[yy][xx] && !s.flagged[yy][xx]) { win = false; break; }
      }
    }
    if (win) s.status = "won";
    return s;
  },
  observe(state) {
    const s = state;
    const grid = [];
    for (let y = 0; y < s.h; y++) {
      const row = [];
      for (let x = 0; x < s.w; x++) {
        if (s.status === "won") {
          row.push(s.mines[y][x] ? '*' : String(this._val(s, x, y)));
        } else if (s.status === "lost") {
          if (s.mines[y][x]) row.push(x === s.lostX && y === s.lostY ? '!' : '*');
          else if (s.flagged[y][x]) row.push('F');
          else if (s.revealed[y][x]) row.push(String(this._val(s, x, y)));
          else row.push('#');
        } else {
          if (s.flagged[y][x]) row.push('F');
          else if (s.revealed[y][x]) row.push(String(this._val(s, x, y)));
          else row.push('#');
        }
      }
      grid.push(row);
    }
    return { grid, vars: { counter: s.counter }, status: s.status };
  }
};