// Runs candidate model code against recorded episodes in an isolated process.
// stdin: JSON {code, episodes:[{id,w,h,hiddenCount,actions,obs,statuses,counters}], smoke:bool}
// stdout: JSON report. Parent enforces a kill timeout, so runaway model code can't hang the run.
import vm from "node:vm";
import { mulberry32, parseGrid, gridStr } from "./envs/minesweeper.js";

const input = JSON.parse(await new Promise((res) => {
  let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d));
}));

function loadModel(code) {
  const ctx = vm.createContext({});
  return new vm.Script(code + "\n;model").runInContext(ctx, { timeout: 8000 });
}

function cmpObs(exp, got, w, h) {
  const diffs = [];
  if (!got || !got.grid) return { equal: false, diffs: [{ err: "observe() returned no grid" }] };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const e = exp.grid[y]?.[x], g = got.grid[y]?.[x] == null ? "?" : String(got.grid[y][x]);
    if (e !== g) diffs.push({ x, y, expected: e, got: g });
  }
  if (String(got.status) !== exp.status) diffs.push({ field: "status", expected: exp.status, got: String(got.status) });
  const gc = got.vars ? got.vars.counter : undefined;
  if (Number(gc) !== exp.counter) diffs.push({ field: "counter", expected: exp.counter, got: gc });
  return { equal: diffs.length === 0, diffs };
}

const report = { ok: false, loadError: null, episodes: [], passed: 0, failed: 0, smoke: null };
let model;
try {
  model = loadModel(input.code);
  for (const fn of ["reconstructHidden", "init", "step", "observe"]) {
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
    const finalGrid = parseGrid(ep.obs[ep.obs.length - 1]);
    const hidden = model.reconstructHidden(finalGrid);
    let st = model.init(ep.w, ep.h, ep.hiddenCount, hidden, mulberry32(1));
    let bad = null;
    for (let i = 0; i < ep.obs.length; i++) {
      if (i > 0) st = model.step(st, ep.actions[i - 1]);
      const exp = { grid: parseGrid(ep.obs[i]), status: ep.statuses[i], counter: ep.counters[i] };
      const got = model.observe(st);
      const { equal, diffs } = cmpObs(exp, got, ep.w, ep.h);
      if (!equal) {
        bad = {
          step: i, action: i > 0 ? ep.actions[i - 1] : "initial",
          diffs: diffs.slice(0, 8),
          expectedGrid: ep.obs[i],
          gotGrid: got && got.grid ? gridStr(got.grid.map((r) => r.map(String))) : "(none)",
          expectedStatus: exp.status, gotStatus: got ? String(got.status) : "?",
          expectedCounter: exp.counter, gotCounter: got?.vars?.counter,
        };
        break;
      }
    }
    if (bad) { res.failStep = bad.step; res.detail = bad; }
    else res.ok = true;
  } catch (e) {
    res.detail = { error: String(e.message || e).slice(0, 400), stack: String(e.stack || "").split("\n").slice(0, 3).join(" | ") };
  }
  report.episodes.push(res);
  if (res.ok) report.passed++; else report.failed++;
}
report.ok = report.failed === 0 && report.episodes.length > 0;

// Smoke-test the generative side (fresh games for the playable clone)
if (input.smoke && report.ok) {
  try {
    const rng = mulberry32(42);
    let st = model.init(6, 6, 5, null, rng);
    let statusSeen = new Set();
    for (let i = 0; i < 60; i++) {
      const o = model.observe(st);
      statusSeen.add(String(o.status));
      if (o.status !== "playing") break;
      const x = Math.floor(rng() * 6), y = Math.floor(rng() * 6);
      st = model.step(st, { type: rng() < 0.2 ? "flag" : "reveal", x, y });
    }
    report.smoke = { ok: true, statuses: [...statusSeen] };
  } catch (e) {
    report.smoke = { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}
console.log(JSON.stringify(report));
