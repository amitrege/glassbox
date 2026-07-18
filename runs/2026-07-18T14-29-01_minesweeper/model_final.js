const model = {
  discoveries: [
    "Classic Minesweeper: revealed digit = count of mines in the 8 neighbors (verified across all numbered cells in every episode).",
    "counter = hiddenCount - (number of currently-flagged cells); flagging decrements, unflagging increments, can go negative (E14 reaches -2).",
    "flag toggles only on hidden cells; flag/reveal on an already-revealed cell is a no-op (E1 flag(1,0) on a revealed 0 keeps counter).",
    "Direct reveal on a flagged cell is a no-op (E13 reveal(2,2) while flagged unchanged).",
    "Flood fill from a 0-cell reveals neighbors INCLUDING flagged ones, clearing the flag and restoring counter (E15: flag(1,2) then reveal(3,3) un-flags it, counter 1->2).",
    "On loss: clicked mine shown as '!', all other mines as '*' (even if flagged); flagged non-mines stay 'F'. On win: all mines shown as '*'.",
    "reconstructHidden: hidden cells are exactly those shown as '*' or '!' in the final grid; count matches hiddenCount in all 19 episodes.",
    "Win = every non-mine cell revealed; Loss = revealing a mine."
  ],

  reconstructHidden(finalGrid) {
    const h = finalGrid.length, w = finalGrid[0].length;
    const hid = [];
    for (let y = 0; y < h; y++) {
      hid.push([]);
      for (let x = 0; x < w; x++) {
        const c = finalGrid[y][x];
        hid[y].push(c === '*' || c === '!');
      }
    }
    return hid;
  },

  init(w, h, hiddenCount, hiddenGrid, rng) {
    const mines = [];
    for (let y = 0; y < h; y++) {
      mines.push([]);
      for (let x = 0; x < w; x++) mines[y].push(false);
    }
    if (hiddenGrid) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          mines[y][x] = !!hiddenGrid[y][x];
    } else {
      let placed = 0;
      while (placed < hiddenCount) {
        const x = Math.floor(rng() * w);
        const y = Math.floor(rng() * h);
        if (!mines[y][x]) { mines[y][x] = true; placed++; }
      }
    }
    const revealed = [], flagged = [];
    for (let y = 0; y < h; y++) {
      revealed.push(new Array(w).fill(false));
      flagged.push(new Array(w).fill(false));
    }
    return {
      w, h, hiddenCount, mines, revealed, flagged,
      status: "playing", clickedX: -1, clickedY: -1
    };
  },

  _count(s, x, y) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h && s.mines[ny][nx]) c++;
      }
    return c;
  },

  step(state, action) {
    const s = state;
    if (s.status !== "playing") return s;
    const { x, y, type } = action;
    if (x < 0 || x >= s.w || y < 0 || y >= s.h) return s;

    if (type === "flag") {
      if (s.revealed[y][x]) return s;
      s.flagged[y][x] = !s.flagged[y][x];
      return s;
    }

    if (type === "reveal") {
      if (s.revealed[y][x]) return s;
      if (s.flagged[y][x]) return s;
      if (s.mines[y][x]) {
        s.revealed[y][x] = true;
        s.clickedX = x; s.clickedY = y;
        s.status = "lost";
        return s;
      }
      // reveal with flood
      const stack = [[x, y]];
      s.revealed[y][x] = true;
      s.flagged[y][x] = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (this._count(s, cx, cy) !== 0) continue;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= s.w || ny < 0 || ny >= s.h) continue;
            if (s.revealed[ny][nx] || s.mines[ny][nx]) continue;
            s.revealed[ny][nx] = true;
            s.flagged[ny][nx] = false;
            if (this._count(s, nx, ny) === 0) stack.push([nx, ny]);
          }
      }
      // win check
      let win = true;
      for (let yy = 0; yy < s.h && win; yy++)
        for (let xx = 0; xx < s.w; xx++)
          if (!s.mines[yy][xx] && !s.revealed[yy][xx]) { win = false; break; }
      if (win) s.status = "won";
      return s;
    }
    return s;
  },

  observe(state) {
    const s = state;
    const over = s.status !== "playing";
    const grid = [];
    let flags = 0;
    for (let y = 0; y < s.h; y++) {
      let row = "";
      for (let x = 0; x < s.w; x++) {
        if (s.flagged[y][x] && !s.revealed[y][x]) flags++;
        if (over && s.mines[y][x]) {
          if (s.status === "lost" && x === s.clickedX && y === s.clickedY) row += "!";
          else row += "*";
        } else if (s.flagged[y][x] && !s.revealed[y][x]) {
          row += "F";
        } else if (s.revealed[y][x]) {
          row += String(this._count(s, x, y));
        } else {
          row += "#";
        }
      }
      grid.push(row.split(""));
    }
    return {
      grid,
      vars: { counter: s.hiddenCount - flags },
      status: s.status
    };
  }
};