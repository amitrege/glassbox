const model = {
  discoveries: [
    "Mechanics are standard 2048: tiles slide in the action direction, each pair of equal adjacent tiles merges once into their sum (checked across all ~300 moves).",
    "scoreDelta equals the sum of all newly-created merged tile values (e.g. E0 right merging 2+2 gives +4; two merges of 2+2 and 8+8 give +16+... matching every counter increment).",
    "After any move that changes the board, exactly one new tile appears on a previously-empty cell; a move that changes nothing spawns nothing (verified on all no-op frames like E0 down/down, E2 repeated rights).",
    "Spawned tile value is 2 in the large majority of cases and occasionally 4 (both observed in logs); starting boards contain two such tiles.",
    "Game status becomes 'over' exactly when the board is full and no two orthogonally-adjacent cells are equal (checked on all terminal frames E0-E3)."
  ],

  _clone(grid) { return grid.map(r => r.slice()); },

  _collapseLine(line) {
    const nz = line.filter(v => v !== 0);
    const out = [];
    let gained = 0;
    for (let i = 0; i < nz.length; i++) {
      if (i + 1 < nz.length && nz[i] === nz[i + 1]) {
        const merged = nz[i] * 2;
        out.push(merged);
        gained += merged;
        i++;
      } else {
        out.push(nz[i]);
      }
    }
    while (out.length < line.length) out.push(0);
    return { out, gained };
  },

  slide(grid, action) {
    const h = grid.length, w = grid[0].length;
    const g = this._clone(grid);
    let scoreDelta = 0;

    if (action === 'left' || action === 'right') {
      for (let y = 0; y < h; y++) {
        let line = g[y].slice();
        if (action === 'right') line.reverse();
        const { out, gained } = this._collapseLine(line);
        scoreDelta += gained;
        let res = out;
        if (action === 'right') res = res.slice().reverse();
        g[y] = res;
      }
    } else { // up / down
      for (let x = 0; x < w; x++) {
        let line = [];
        for (let y = 0; y < h; y++) line.push(g[y][x]);
        if (action === 'down') line.reverse();
        const { out, gained } = this._collapseLine(line);
        scoreDelta += gained;
        let res = out;
        if (action === 'down') res = res.slice().reverse();
        for (let y = 0; y < h; y++) g[y][x] = res[y];
      }
    }

    return { grid: g, scoreDelta };
  },

  reconstructEvents(postSlideGrid, nextGrid) {
    const events = [];
    for (let y = 0; y < nextGrid.length; y++) {
      for (let x = 0; x < nextGrid[y].length; x++) {
        if (postSlideGrid[y][x] === 0 && nextGrid[y][x] !== 0) {
          events.push({ x, y, v: nextGrid[y][x] });
        }
      }
    }
    return events;
  },

  statusOf(grid) {
    const h = grid.length, w = grid[0].length;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (grid[y][x] === 0) return "playing";
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (x + 1 < w && grid[y][x] === grid[y][x + 1]) return "playing";
        if (y + 1 < h && grid[y][x] === grid[y + 1][x]) return "playing";
      }
    return "over";
  },

  newGame(w, h, rng) {
    const grid = [];
    for (let y = 0; y < h; y++) grid.push(new Array(w).fill(0));
    let placed = 0;
    while (placed < 2) {
      const s = this.spawn(grid, rng);
      if (grid[s.y][s.x] === 0) {
        grid[s.y][s.x] = s.v;
        placed++;
      }
    }
    return grid;
  },

  spawn(grid, rng) {
    const empties = [];
    for (let y = 0; y < grid.length; y++)
      for (let x = 0; x < grid[y].length; x++)
        if (grid[y][x] === 0) empties.push({ x, y });
    if (empties.length === 0) return { x: 0, y: 0, v: 0 };
    const cell = empties[Math.floor(rng() * empties.length)];
    const v = rng() < 0.9 ? 2 : 4;
    return { x: cell.x, y: cell.y, v };
  }
};