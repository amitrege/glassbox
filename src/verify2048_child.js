// Mode-B verifier: the candidate model supplies the DETERMINISTIC part (slide)
// and explains the random part as reconstructed events (spawns); the trusted
// harness applies those events and demands exact reproduction of every frame.
// stdin: {code, episodes:[{id,w,h,actions,obs,scores,statuses}], smoke}
import vm from "node:vm";
import { parseNumGrid, numGridStr } from "./envs/game2048.js";
import { mulberry32 } from "./envs/minesweeper.js";

const input = JSON.parse(await new Promise((res) => {
  let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d));
}));

function loadModel(code) {
  const ctx = vm.createContext({});
  return new vm.Script(code + "\n;model").runInContext(ctx, { timeout: 8000 });
}

const eq = (a, b) => numGridStr(a) === numGridStr(b);

const report = { ok: false, loadError: null, episodes: [], passed: 0, failed: 0, smoke: null };
let model;
try {
  model = loadModel(input.code);
  for (const fn of ["slide", "reconstructEvents", "statusOf", "newGame", "spawn"]) {
    if (typeof model?.[fn] !== "function") throw new Error(`model.${fn} is not a function`);
  }
} catch (e) {
  report.loadError = String(e.message || e).slice(0, 600);
  console.log(JSON.stringify(report));
  process.exit(0);
}
report.discoveries = Array.isArray(model.discoveries) ? model.discoveries.map(String) : [];

for (const ep of input.episodes) {
  const res = { id: ep.id, ok: false, failStep: null, detail: null };
  try {
    let bad = null;
    let grid = parseNumGrid(ep.obs[0]);
    let score = ep.scores[0];
    const st0 = String(model.statusOf(grid));
    if (st0 !== ep.statuses[0]) bad = { step: 0, action: "initial", diffs: [{ field: "status", expected: ep.statuses[0], got: st0 }], expectedGrid: ep.obs[0], gotGrid: ep.obs[0] };
    for (let i = 0; !bad && i < ep.actions.length; i++) {
      const action = ep.actions[i];
      const next = parseNumGrid(ep.obs[i + 1]);
      const sr = model.slide(grid, action);
      const g2 = sr && sr.grid ? sr.grid : sr;
      const sd = sr && sr.scoreDelta != null ? Number(sr.scoreDelta) : 0;
      let events;
      try { events = model.reconstructEvents(g2, next) || []; }
      catch (e) { bad = { step: i + 1, action, diffs: [{ field: "reconstructEvents", expected: "events", got: String(e.message).slice(0, 120) }], expectedGrid: ep.obs[i + 1], gotGrid: numGridStr(g2) }; break; }
      const g3 = g2.map((r) => r.slice());
      let evBad = null;
      for (const ev of events) {
        if (!ev || g3[ev.y]?.[ev.x] === undefined) { evBad = `event out of bounds: ${JSON.stringify(ev)}`; break; }
        if (g3[ev.y][ev.x] !== 0) { evBad = `event places tile on non-empty cell (${ev.x},${ev.y})`; break; }
        g3[ev.y][ev.x] = ev.v;
      }
      if (evBad) { bad = { step: i + 1, action, diffs: [{ field: "events", expected: "valid spawn(s)", got: evBad }], expectedGrid: ep.obs[i + 1], gotGrid: numGridStr(g2) }; break; }
      const expScore = ep.scores[i + 1];
      const gotScore = score + sd;
      const expStatus = ep.statuses[i + 1];
      const gotStatus = String(model.statusOf(g3));
      if (!eq(g3, next) || gotScore !== expScore || gotStatus !== expStatus) {
        const diffs = [];
        for (let y = 0; y < next.length; y++) for (let x = 0; x < next[0].length; x++)
          if (g3[y][x] !== next[y][x]) diffs.push({ x, y, expected: String(next[y][x]), got: String(g3[y][x]) });
        if (gotScore !== expScore) diffs.push({ field: "score", expected: expScore, got: gotScore });
        if (gotStatus !== expStatus) diffs.push({ field: "status", expected: expStatus, got: gotStatus });
        bad = { step: i + 1, action, diffs: diffs.slice(0, 8), expectedGrid: ep.obs[i + 1], gotGrid: numGridStr(g3), expectedStatus: expStatus, gotStatus, expectedCounter: expScore, gotCounter: gotScore };
        break;
      }
      grid = next; score = expScore;
    }
    if (bad) { res.failStep = bad.step; res.detail = bad; } else res.ok = true;
  } catch (e) {
    res.detail = { error: String(e.message || e).slice(0, 400) };
  }
  report.episodes.push(res);
  if (res.ok) report.passed++; else report.failed++;
}
report.ok = report.failed === 0 && report.episodes.length > 0;

if (input.smoke && report.ok) {
  try {
    const rng = mulberry32(7);
    let grid = model.newGame(4, 4, rng);
    for (let i = 0; i < 40; i++) {
      if (String(model.statusOf(grid)) !== "playing") break;
      const dir = ["up", "down", "left", "right"][Math.floor(rng() * 4)];
      const sr = model.slide(grid, dir);
      const g2 = sr && sr.grid ? sr.grid : sr;
      if (numGridStr(g2) === numGridStr(grid)) continue;
      const sp = model.spawn(g2, rng);
      if (sp && g2[sp.y]?.[sp.x] === 0) g2[sp.y][sp.x] = sp.v;
      grid = g2;
    }
    report.smoke = { ok: true };
  } catch (e) {
    report.smoke = { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}
console.log(JSON.stringify(report));
