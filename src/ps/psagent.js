// PuzzleScript learning loop: probe the real game → LLM writes PuzzleScript source →
// compile + exact-replay verify → when consistent, run the decisive experiment:
// BFS a winning plan inside the LEARNED game, execute it on the REAL game, and
// require every predicted frame (and the win itself) to come true.
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Recorder, updateIndex } from "../recorder.js";
import { complete, extractCode, extractNarration, MODEL, DRIVER } from "../llm.js";
import { PS_SYSTEM, psFirstPrompt, psRevisePrompt } from "./psprompts.js";
import { makeEngine, observe, act, spriteNames, bfsSolve, ACTION_NAMES } from "./psharness.js";
import { mulberry32 } from "../envs/minesweeper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "..", "..", "runs");
const MAX_ITER = 8;

function childCall(payload, timeoutMs) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [path.join(__dirname, "psverify_child.js")],
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, loadError: `child crashed/timed out: ${String(err.message).slice(0, 200)}`, episodes: [], passed: 0, failed: 0 });
        try { resolve(JSON.parse(stdout.trim().split("\n").pop())); }
        catch { resolve({ ok: false, loadError: "child produced unparseable output", episodes: [], passed: 0, failed: 0 }); }
      });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function parseDiscoveries(text) {
  const m = text.match(/DISCOVERIES:\s*\n([\s\S]*?)(?:\n\s*\n|```)/);
  if (!m) return [];
  return m[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean).slice(0, 10);
}

async function recordAttempt({ id, source, actions, rec, stopOnSolve = true }) {
  const engine = makeEngine(source, 0);
  const at = { id, actions: [], obs: [observe(engine)], statuses: ["playing"] };
  rec.event("episode_start", { ep: id });
  rec.event("step", { ep: id, i: 0, action: null, obs: at.obs[0], status: "playing" });
  for (const a of actions) {
    const r = await act(engine, a);
    at.actions.push(a);
    at.obs.push(observe(engine));
    at.statuses.push(r.solved ? "solved" : "playing");
    rec.event("step", { ep: id, i: at.actions.length, action: a, obs: at.obs[at.obs.length - 1], status: r.solved ? "solved" : "playing" });
    if (r.solved && stopOnSolve) break;
  }
  rec.event("episode_end", { ep: id, status: at.statuses[at.statuses.length - 1], steps: at.actions.length });
  return at;
}

export async function runPS({ gameFile, label, title }) {
  const realSource = fs.readFileSync(gameFile, "utf8");
  const id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${label}`;
  const rec = new Recorder(RUNS_DIR, id, { env: "env_PS", envKind: "tokens", track: "ps", game: label, title, model: MODEL, driver: DRIVER });
  updateIndex(RUNS_DIR);
  console.log(`run ${id} — driver=${DRIVER} model=${MODEL}`);

  // ground truth for the discovery beat (never shown to the agent)
  const realOpt = await bfsSolve(realSource, { maxMs: 45000 });
  console.log(`real optimal solution: ${realOpt.solution ? realOpt.solution.length + " moves" : "none found"} (${realOpt.states} states)`);

  rec.event("phase", { name: "explore", text: "Probing the unknown game…" });
  const rng = mulberry32(7777);
  const attempts = [];
  let atId = 0;
  for (const a of ACTION_NAMES) attempts.push(await recordAttempt({ id: `A${atId++}`, source: realSource, actions: [a], rec }));
  for (let k = 0; k < 6; k++) {
    const actions = Array.from({ length: 10 }, () => ACTION_NAMES[Math.floor(rng() * 4)]);
    attempts.push(await recordAttempt({ id: `A${atId++}`, source: realSource, actions, rec }));
  }
  const engine0 = makeEngine(realSource, 0);
  const names = spriteNames(engine0).filter((n) => n.toLowerCase() !== "background");
  rec.event("explore_summary", { episodes: attempts.length, totalSteps: attempts.reduce((a, e) => a + e.actions.length, 0), objects: names });
  console.log(`explored ${attempts.length} attempts; objects: ${names.join(", ")}`);

  let source = null, report = null, converged = false, version = 0, planInfo = null, discoveries = [];
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const prompt = version === 0 ? psFirstPrompt(attempts, names) : psRevisePrompt(attempts, names, source, report);
    rec.event("llm_call", { iter, purpose: version === 0 ? "synthesize" : "revise", promptChars: prompt.length, promptText: prompt });
    console.log(`iter ${iter}: calling LLM (${prompt.length} chars)…`);
    let text, ms;
    try { ({ text, ms } = await complete({ system: PS_SYSTEM, prompt, purpose: "ps_synthesize" })); }
    catch (e) {
      console.error(`LLM call failed: ${e.message}`); rec.event("llm_error", { iter, error: String(e.message).slice(0, 300) });
      await new Promise((r) => setTimeout(r, 5000)); continue;
    }
    source = extractCode(text);
    version++;
    const narration = extractNarration(text) || "(revised the game)";
    discoveries = parseDiscoveries(text);
    rec.event("llm_result", { iter, ms, chars: text.length });
    rec.event("hypothesis", { version, narration, code: source });
    console.log(`iter ${iter}: v${version} (${ms}ms) — ${narration}`);

    report = await childCall({ mode: "verify", source, attempts }, 90000);
    report.discoveries = discoveries;
    rec.event("verify", {
      version, ok: report.ok, passed: report.passed, failed: report.failed, loadError: report.loadError,
      episodes: (report.episodes || []).map((e) => ({ id: e.id, ok: e.ok, failStep: e.failStep })),
      firstFailure: (report.episodes || []).find((e) => !e.ok)?.detail || null,
      discoveries,
    });
    console.log(`iter ${iter}: verify ${report.passed}/${report.passed + report.failed}${report.loadError ? " loadError: " + String(report.loadError).slice(0, 120) : ""}`);
    if (!report.ok) continue;

    // Decisive experiment: plan inside the learned game, execute on reality.
    rec.event("phase", { name: "experiment", text: "Model fits all data. Searching the LEARNED game for a winning plan to test on the real one…" });
    const plan = await childCall({ mode: "bfs", source }, 80000);
    if (!plan.solution) {
      rec.event("plan_failed", { version, states: plan.states, exhausted: plan.exhausted });
      console.log(`no plan in learned game (${plan.states} states) — win condition likely wrong`);
      report = { ok: false, loadError: `Experiment failed: exhaustive search of YOUR game (${plan.states} states) found no way to reach your WINCONDITIONS. Your win condition (or a movement rule) must be wrong — reconsider what winning could mean.`, episodes: [], passed: report.passed, failed: 1 };
      continue;
    }
    const predicted = await childCall({ mode: "predict", actions: plan.solution, source }, 30000);
    rec.event("plan", { version, len: plan.solution.length, states: plan.states, ms: plan.ms, actions: plan.solution });
    console.log(`plan found in learned game: ${plan.solution.length} moves (${plan.states} states) — executing on the REAL game…`);

    const engine = makeEngine(realSource, 0);
    let allMatch = true, realSolved = false, execActions = [], execObs = [observe(engine)], execStatuses = ["playing"];
    rec.event("episode_start", { ep: `PLAN_v${version}` });
    rec.event("step", { ep: `PLAN_v${version}`, i: 0, action: null, obs: execObs[0], status: "playing" });
    for (let i = 0; i < plan.solution.length; i++) {
      const a = plan.solution[i];
      const r = await act(engine, a);
      const actual = observe(engine);
      const pred = predicted.obs[i + 1];
      // After the winning move the real engine advances beyond the learned scope —
      // the post-win frame is not comparable, so it is n/a rather than a mismatch.
      const match = r.solved ? null : actual === pred;
      execActions.push(a); execObs.push(actual); execStatuses.push(r.solved ? "solved" : "playing");
      rec.event("plan_step", { ep: `PLAN_v${version}`, i: i + 1, action: a, obs: actual, predictedObs: pred, match, status: r.solved ? "solved" : "playing" });
      if (r.solved) { realSolved = true; break; }
      if (!match) { allMatch = false; break; }
    }
    rec.event("episode_end", { ep: `PLAN_v${version}`, status: realSolved ? "solved" : "playing", steps: execActions.length });
    const planAttempt = { id: `PLAN_v${version}`, actions: execActions, obs: execObs, statuses: execStatuses };
    attempts.push(planAttempt);

    if (realSolved && allMatch) {
      converged = true;
      planInfo = { planLen: plan.solution.length, planStates: plan.states, realOptimal: realOpt.solution ? realOpt.solution.length : null };
      rec.event("plan_result", { won: true, steps: execActions.length });
      rec.event("converged", {
        version, episodes: attempts.length,
        totalSteps: attempts.reduce((a, e) => a + e.actions.length, 0),
        discoveries,
        planLen: plan.solution.length, realOptimal: planInfo.realOptimal,
      });
      console.log(`CONVERGED at v${version}: solved the real level in ${plan.solution.length} moves using a plan computed inside its own model${planInfo.realOptimal ? ` (true optimum: ${planInfo.realOptimal})` : ""}.`);
      break;
    }
    rec.event("plan_result", { won: realSolved, steps: execActions.length, refuted: true });
    console.log(`plan execution ${realSolved ? "won but diverged from prediction" : "refuted the model"} — feeding reality back.`);
    report = await childCall({ mode: "verify", source, attempts }, 90000);
    report.discoveries = discoveries;
  }

  if (source) rec.saveFile("game_learned.txt", source);
  rec.finalize({
    converged, versions: version, episodes: attempts.length,
    totalSteps: attempts.reduce((a, e) => a + e.actions.length, 0),
    discoveries, ...(planInfo || {}),
  });
  updateIndex(RUNS_DIR);
  return { id, converged, version, dir: rec.dir, planInfo };
}
