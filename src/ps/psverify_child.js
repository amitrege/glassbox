// Isolated process for candidate PuzzleScript sources (compile, replay-verify, BFS,
// predict). Parent enforces kill timeouts — a pathological candidate can't hang the run.
import { replay, bfsSolve, makeEngine, observe } from "./psharness.js";

const input = JSON.parse(await new Promise((res) => {
  let d = ""; process.stdin.on("data", (c) => (d += c)); process.stdin.on("end", () => res(d));
}));

function out(x) { console.log(JSON.stringify(x)); process.exit(0); }

try {
  if (input.mode === "verify") {
    // compile check
    try { makeEngine(input.source, 0); }
    catch (e) {
      out({ ok: false, loadError: `PuzzleScript compile error: ${String(e.message || e).slice(0, 900)}`, episodes: [], passed: 0, failed: input.attempts.length });
    }
    const report = { ok: false, loadError: null, episodes: [], passed: 0, failed: 0 };
    for (const at of input.attempts) {
      const res = { id: at.id, ok: false, failStep: null, detail: null };
      try {
        const r = await replay(input.source, at.actions, 0);
        let bad = null;
        for (let i = 0; i < at.obs.length; i++) {
          const gotObs = r.obs[i];
          const gotSolved = Boolean(r.solved[i]);
          const expSolved = at.statuses[i] === "solved";
          if (gotObs === undefined) { bad = { step: i, action: i > 0 ? at.actions[i - 1] : "initial", note: "your game ended the attempt early (win fired too soon)", expectedGrid: at.obs[i], gotGrid: "(attempt already ended)" }; break; }
          if (gotObs !== at.obs[i] || gotSolved !== expSolved) {
            const expRows = at.obs[i].split("/"), gotRows = gotObs.split("/");
            const rowDiffs = [];
            for (let y = 0; y < Math.max(expRows.length, gotRows.length); y++)
              if (expRows[y] !== gotRows[y]) rowDiffs.push({ y, expected: expRows[y], got: gotRows[y] });
            bad = {
              step: i, action: i > 0 ? at.actions[i - 1] : "initial",
              expectedGrid: at.obs[i], gotGrid: gotObs,
              rowDiffs: rowDiffs.slice(0, 6),
              expectedStatus: at.statuses[i], gotStatus: gotSolved ? "solved" : "playing",
            };
            break;
          }
        }
        if (bad) { res.failStep = bad.step; res.detail = bad; }
        else res.ok = true;
      } catch (e) {
        res.detail = { error: String(e.message || e).slice(0, 400) };
      }
      report.episodes.push(res);
      if (res.ok) report.passed++; else report.failed++;
    }
    report.ok = report.failed === 0 && report.episodes.length > 0;
    out(report);
  }

  if (input.mode === "bfs") {
    const r = await bfsSolve(input.source, { maxMs: input.maxMs ?? 45000 });
    out(r);
  }

  if (input.mode === "predict") {
    const r = await replay(input.source, input.actions, 0);
    out(r);
  }

  out({ error: "unknown mode" });
} catch (e) {
  out({ ok: false, loadError: String(e.message || e).slice(0, 600), episodes: [], passed: 0, failed: 0 });
}
