const model = {
  discoveries: [
    "Digit on a revealed cell = number of hidden mines exactly one knight's-move away (offsets (±1,±2),(±2,±1)); verified on all revealed digits in E0-E11 (200+ cells, 0 mismatches).",
    "Mines are the hidden special cells; on WIN all non-mine cells show their knight-digit and mines show '*'; on LOSS the clicked mine shows '!', other mines '*', unrevealed non-mines '#', flagged non-mines 'F'.",
    "Reveal on a 0-digit cell flood-fills through its on-board knight-neighbors (E3 reveal(4,4) revealed exactly its two knight-neighbors (3,2)=2,(2,3)=1).",
    "counter = hiddenCount - (currently flagged cells). Flag on a revealed/flag no-op leaves counter unchanged (E1,E5); flood-fill that covers a flagged cell clears the flag and raises counter (E4:2->4, E6:4->5).",
    "Reveal on a flagged or already-revealed cell is a no-op (E6 reveal(1,3) unchanged). Flags on mine cells survive a win (E5 counter stays 3), flags on non-mines cleared by winning flood (E7 counter 4->5).",
    "reconstructHidden: hidden cells are exactly the '*' and '!' characters in the final grid (matches hiddenCount in every episode)."
  ],

  _knight: [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]],

  _digit(state, x, y) {
    let c = 0;
    for (const [dx, dy] of this._knight) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < state.w && ny < state.h && state.mines[ny][nx]) c++;
    }
    return c;
  },

  reconstructHidden(finalGrid) {
    const h = finalGrid.length, w = finalGrid[0].length;
    const out = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const ch = finalGrid[y][x];
        row.push(ch === '*' || ch === '!');
      }
      out.push(row);
    }
    return out;
  },

  init(w, h, hiddenCount, hiddenGrid, rng) {
    const mines = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push(hiddenGrid ? !!hiddenGrid[y][x] : false);
      mines.push(row);
    }
    if (!hiddenGrid) {
      let placed = 0;
      while (placed < hiddenCount) {
        const x = Math.floor(rng() * w);
        const y = Math.floor(rng() * h);
        if (!mines[y][x]) { mines[y][x] = true; placed++; }
      }
    }
    const revealed = [], flags = [];
    for (let y = 0; y < h; y++) {
      revealed.push(new Array(w).fill(false));
      flags.push(new Array(w).fill(false));
    }
    return { w, h, hiddenCount, mines, revealed, flags, status: 'playing', clicked: null };
  },

  _flood(state, x, y) {
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= state.w || cy >= state.h) continue;
      if (state.revealed[cy][cx]) continue;
      if (state.mines[cy][cx]) continue;
      state.revealed[cy][cx] = true;
      state.flags[cy][cx] = false;
      if (this._digit(state, cx, cy) === 0) {
        for (const [dx, dy] of this._knight) stack.push([cx + dx, cy + dy]);
      }
    }
  },

  step(state, action) {
    if (state.status !== 'playing') return state;
    const { type, x, y } = action;
    if (x < 0 || y < 0 || x >= state.w || y >= state.h) return state;

    if (type === 'flag') {
      if (state.revealed[y][x]) return state; // no-op on revealed
      state.flags[y][x] = !state.flags[y][x]; // toggle
      return state;
    }

    if (type === 'reveal') {
      if (state.revealed[y][x] || state.flags[y][x]) return state; // no-op
      if (state.mines[y][x]) {
        state.status = 'lost';
        state.clicked = [x, y];
        return state;
      }
      this._flood(state, x, y);
      // win check: all non-mine cells revealed
      let won = true;
      for (let yy = 0; yy < state.h && won; yy++)
        for (let xx = 0; xx < state.w; xx++)
          if (!state.mines[yy][xx] && !state.revealed[yy][xx]) { won = false; break; }
      if (won) state.status = 'won';
      return state;
    }
    return state;
  },

  observe(state) {
    const grid = [];
    let flagCount = 0;
    for (let y = 0; y < state.h; y++) {
      const row = [];
      for (let x = 0; x < state.w; x++) {
        if (state.flags[y][x]) flagCount++;
        let ch;
        if (state.status === 'lost') {
          if (state.mines[y][x]) {
            ch = (state.clicked && state.clicked[0] === x && state.clicked[1] === y) ? '!' : '*';
          } else if (state.flags[y][x]) {
            ch = 'F';
          } else if (state.revealed[y][x]) {
            ch = String(this._digit(state, x, y));
          } else {
            ch = '#';
          }
        } else if (state.status === 'won') {
          ch = state.mines[y][x] ? '*' : String(this._digit(state, x, y));
        } else {
          if (state.flags[y][x]) ch = 'F';
          else if (state.revealed[y][x]) ch = String(this._digit(state, x, y));
          else ch = '#';
        }
        row.push(ch);
      }
      grid.push(row);
    }
    return { grid, vars: { counter: state.hiddenCount - flagCount }, status: state.status };
  }
};