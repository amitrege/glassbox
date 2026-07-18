// Exploration policy: play episodes against the real environment, record every
// transition. Mostly random probing plus deliberate "weird" probes (acting on
// already-revealed cells etc.) so the data pins down edge-case rules.
import { minesweeper as env, gridStr, mulberry32 } from "./envs/minesweeper.js";

export function playEpisode({ id, w, h, mines, seed, rec, maxSteps = 60, neighborhood = "n8", torus = false }) {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const s = env.init({ w, h, mines, seed, neighborhood, torus });
  const o0 = env.observe(s);
  const ep = {
    id, w, h, hiddenCount: mines,
    actions: [], obs: [gridStr(o0.grid)], statuses: [o0.status], counters: [o0.vars.counter],
  };
  rec?.event("episode_start", { ep: id, w, h, hiddenCount: mines });
  rec?.event("step", { ep: id, i: 0, action: null, obs: ep.obs[0], status: o0.status, counter: o0.vars.counter });

  let firstRevealWasSafe = null;
  for (let i = 0; i < maxSteps; i++) {
    const obs = env.observe(s);
    if (obs.status !== "playing") break;
    let action;
    const r = rng();
    const hiddenCells = [], revealedCells = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = obs.grid[y][x];
      if (c === "#" || c === "F") hiddenCells.push({ x, y });
      else revealedCells.push({ x, y });
    }
    if (r < 0.12 && revealedCells.length) {
      // deliberate weird probe: act on an already-revealed cell
      const c = revealedCells[Math.floor(rng() * revealedCells.length)];
      action = { type: rng() < 0.5 ? "reveal" : "flag", x: c.x, y: c.y };
    } else if (r < 0.27 && hiddenCells.length) {
      const c = hiddenCells[Math.floor(rng() * hiddenCells.length)];
      action = { type: "flag", x: c.x, y: c.y };
    } else {
      const pool = hiddenCells.length ? hiddenCells : revealedCells;
      const c = pool[Math.floor(rng() * pool.length)];
      action = { type: "reveal", x: c.x, y: c.y };
    }
    if (action.type === "reveal" && firstRevealWasSafe === null) {
      env.step(s, action);
      firstRevealWasSafe = env.observe(s).status !== "lost";
    } else {
      env.step(s, action);
    }
    const o = env.observe(s);
    ep.actions.push(action);
    ep.obs.push(gridStr(o.grid));
    ep.statuses.push(o.status);
    ep.counters.push(o.vars.counter);
    rec?.event("step", { ep: id, i: ep.actions.length, action, obs: gridStr(o.grid), status: o.status, counter: o.vars.counter });
  }
  const last = ep.statuses[ep.statuses.length - 1];
  rec?.event("episode_end", { ep: id, status: last, steps: ep.actions.length });
  return { ep, finished: last !== "playing", won: last === "won", firstRevealWasSafe };
}

export function explorationPlan({ rec, baseSeed = 1000, startId = 0, neighborhood = "n8", torus = false }) {
  const episodes = [];
  let id = startId, wins = 0, seed = baseSeed, firstSafeCount = 0, firstTotal = 0;
  const boards = [
    [4, 4, 2], [4, 4, 2], [4, 4, 3], [5, 5, 3], [5, 5, 4], [5, 5, 4],
    [6, 6, 5], [6, 6, 5], [6, 6, 7], [5, 5, 6], [4, 4, 4], [6, 6, 4],
  ];
  for (const [w, h, m] of boards) {
    const r = playEpisode({ id: `E${id++}`, w, h, mines: m, seed: seed++, rec, neighborhood, torus });
    if (r.finished) episodes.push(r.ep);
    if (r.won) wins++;
    if (r.firstRevealWasSafe !== null) { firstTotal++; if (r.firstRevealWasSafe) firstSafeCount++; }
  }
  // make sure the data contains wins (win condition must be learnable)
  let guard = 0;
  while (wins < 2 && guard++ < 60) {
    const r = playEpisode({ id: `E${id++}`, w: 4, h: 4, mines: 2, seed: seed++, rec, neighborhood, torus });
    if (r.finished) episodes.push(r.ep);
    if (r.won) wins++;
    if (r.firstRevealWasSafe !== null) { firstTotal++; if (r.firstRevealWasSafe) firstSafeCount++; }
  }
  rec?.event("explore_summary", {
    episodes: episodes.length, wins,
    totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0),
    firstRevealSafe: `${firstSafeCount}/${firstTotal}`,
  });
  return { episodes, nextId: id, nextSeed: seed, wins, firstRevealSafe: [firstSafeCount, firstTotal] };
}
