// 2048-track learning loop: same probe → hypothesize → verify-by-exact-replay
// discipline; the stochastic spawn is handled by event reconstruction (mode B).
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Recorder, updateIndex } from "./recorder.js";
import { complete, extractCode, extractNarration, MODEL, DRIVER } from "./llm.js";
import { SYSTEM } from "./prompts.js";
import { game2048 as env, numGridStr } from "./envs/game2048.js";
import { mulberry32 } from "./envs/minesweeper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "..", "runs");
const MAX_ITER = 8;

function verify2048({ code, episodes, smoke = true, timeoutMs = 40000 }) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [path.join(__dirname, "verify2048_child.js")],
      { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, loadError: `verifier crashed/timed out: ${String(err.message).slice(0, 200)}`, episodes: [], passed: 0, failed: episodes.length });
        try { resolve(JSON.parse(stdout.trim().split("\n").pop())); }
        catch { resolve({ ok: false, loadError: "verifier produced unparseable output", episodes: [], passed: 0, failed: episodes.length }); }
      });
    child.stdin.write(JSON.stringify({ code, episodes, smoke }));
    child.stdin.end();
  });
}

function playEpisode({ id, w, h, seed, rec, maxSteps = 40 }) {
  const rng = mulberry32(seed ^ 0xabcdef);
  const s = env.init({ w, h, seed });
  const o0 = env.observe(s);
  const ep = { id, w, h, actions: [], obs: [numGridStr(o0.grid)], scores: [o0.vars.score], statuses: [o0.status] };
  rec?.event("episode_start", { ep: id, w, h });
  rec?.event("step", { ep: id, i: 0, action: null, obs: ep.obs[0], status: o0.status, counter: o0.vars.score });
  const dirs = ["up", "down", "left", "right"];
  let lastDir = null;
  for (let i = 0; i < maxSteps; i++) {
    const o = env.observe(s);
    if (o.status !== "playing") break;
    // 15%: deliberately repeat the same direction (probes the "nothing happens" rule)
    const action = lastDir && rng() < 0.15 ? lastDir : dirs[Math.floor(rng() * 4)];
    lastDir = action;
    env.step(s, action);
    const o2 = env.observe(s);
    ep.actions.push(action);
    ep.obs.push(numGridStr(o2.grid));
    ep.scores.push(o2.vars.score);
    ep.statuses.push(o2.status);
    rec?.event("step", { ep: id, i: ep.actions.length, action, obs: numGridStr(o2.grid), status: o2.status, counter: o2.vars.score });
  }
  const last = ep.statuses[ep.statuses.length - 1];
  rec?.event("episode_end", { ep: id, status: last, steps: ep.actions.length });
  return ep;
}

function contract2048() {
  return `## Model contract

Grids in the log are rows joined by "/", cells joined "," (numbers; 0 = empty). "counter" in the log is a score-like variable. Actions: up, down, left, right.

Your code block must define \`const model\` with:
- \`discoveries\`: array of falsifiable claims with evidence counts.
- \`slide(grid, action)\` → \`{grid, scoreDelta}\` — the DETERMINISTIC part of one move: the board immediately after the action's rearrangement, BEFORE any randomness, plus how much the score variable increases.
- \`reconstructEvents(postSlideGrid, nextGrid)\` → array of \`{x, y, v}\` — explain the random event(s) between your post-slide board and the actually observed next board (typically tiles appearing). Return [] if none. The harness applies your events to your post-slide grid (each target cell must be empty) and requires the result to equal the observed board EXACTLY, and observed score to equal previous score + your scoreDelta.
- \`statusOf(grid)\` → "playing" | "over" — checked against every logged frame.
- \`newGame(w, h, rng)\` → grid — a brand-new starting board per your learned start rule (rng() in [0,1) is the only randomness).
- \`spawn(grid, rng)\` → \`{x, y, v}\` — your learned random-event rule, used to play fresh games.

Study when moves change nothing, how tiles combine, what exactly the score adds, where and what new tiles appear (and with what frequencies), and when the game ends.`;
}

function episodesBlock2048(episodes, failingIds = new Set(), maxChars = 42000) {
  const fmt = (ep) => {
    const lines = [`### Episode ${ep.id} — ${ep.w}x${ep.h}`];
    lines.push(`obs0 (status=${ep.statuses[0]}, counter=${ep.scores[0]}):  ${ep.obs[0]}`);
    for (let i = 0; i < ep.actions.length; i++)
      lines.push(`${ep.actions[i]} -> (status=${ep.statuses[i + 1]}, counter=${ep.scores[i + 1]})  ${ep.obs[i + 1]}`);
    return lines.join("\n");
  };
  const ordered = [...episodes].sort((a, b) => (failingIds.has(b.id) ? 1 : 0) - (failingIds.has(a.id) ? 1 : 0));
  const parts = []; let used = 0, skipped = 0;
  for (const ep of ordered) {
    const s = fmt(ep);
    if (used + s.length > maxChars && parts.length > 4) { skipped++; continue; }
    parts.push(s); used += s.length;
  }
  if (skipped) parts.push(`(…${skipped} additional passing episodes omitted — your model must still fit them)`);
  return `## Interaction log\n\n${parts.join("\n\n")}`;
}

function failText(report) {
  if (report.loadError) return `Your code failed to load/run: ${report.loadError}`;
  return report.episodes.filter((e) => !e.ok).slice(0, 3).map((f) => {
    const d = f.detail || {};
    if (d.error) return `Episode ${f.id}: your model threw: ${d.error}`;
    const cellDiffs = (d.diffs || []).filter((x) => x.x !== undefined).map((x) => `(${x.x},${x.y}) expected ${x.expected} got ${x.got}`).join("; ");
    const fieldDiffs = (d.diffs || []).filter((x) => x.field).map((x) => `${x.field}: expected ${JSON.stringify(x.expected)} got ${JSON.stringify(x.got)}`).join("; ");
    return `Episode ${f.id} FAILS at step ${d.step} (after ${d.action}):
  observed: ${d.expectedGrid}
  yours:    ${d.gotGrid}
  ${cellDiffs ? "cell diffs: " + cellDiffs : ""}${fieldDiffs ? "  " + fieldDiffs : ""}`;
  }).join("\n\n");
}

export async function run2048() {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_2048`;
  const rec = new Recorder(RUNS_DIR, id, { env: "env_B", envKind: "numgrid", track: "famous2048", game: "game2048", title: "2048", model: MODEL, driver: DRIVER });
  updateIndex(RUNS_DIR);
  console.log(`run ${id} — driver=${DRIVER} model=${MODEL}`);

  rec.event("phase", { name: "explore", text: "Probing the unknown environment…" });
  let episodes = [], nextSeed = 5000, nextId = 0;
  for (const [w, h, n] of [[3, 3, 5], [4, 4, 5]]) for (let k = 0; k < n; k++) episodes.push(playEpisode({ id: `E${nextId++}`, w, h, seed: nextSeed++, rec }));
  rec.event("explore_summary", { episodes: episodes.length, totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0) });
  console.log(`explored ${episodes.length} episodes, ${episodes.reduce((a, e) => a + e.actions.length, 0)} steps`);

  let code = null, report = null, converged = false, version = 0;
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const failing = new Set((report?.episodes || []).filter((e) => !e.ok).map((e) => e.id));
    const prompt = version === 0
      ? `${contract2048()}\n\n${episodesBlock2048(episodes)}\n\n## Task\nWork out the full mechanism and write the model. Fit every episode exactly.`
      : `${contract2048()}\n\n## Your previous model (${report.passed}/${report.passed + report.failed} episodes correct)\n\`\`\`js\n${code}\n\`\`\`\n\n## Refutations\n${failText(report)}\n\n${episodesBlock2048(episodes, failing)}\n\n## Task\nDiagnose the refutations, revise minimally, update discoveries, output the full corrected model.`;
    rec.event("llm_call", { iter, purpose: version === 0 ? "synthesize" : "revise", promptChars: prompt.length, promptText: prompt });
    console.log(`iter ${iter}: calling LLM (${prompt.length} chars)…`);
    let text, ms, stopReason, blocks;
    try { ({ text, ms, stopReason, blocks } = await complete({ system: SYSTEM, prompt, purpose: "2048_synthesize" })); }
    catch (e) {
      console.error(`LLM call failed: ${e.message}`); rec.event("llm_error", { iter, error: String(e.message).slice(0, 300) });
      await new Promise((r) => setTimeout(r, 5000)); continue;
    }
    const candidate = extractCode(text);
    if (!candidate || !candidate.trim() || !/const\s+model/.test(candidate)) {
      rec.saveFile(`raw_response_iter${iter}.txt`, text || "(empty)");
      rec.event("llm_error", { iter, error: "empty or malformed response — retrying", rawChars: (text || "").length, stopReason, blocks, ms });
      console.log(`iter ${iter}: empty/malformed response (stop=${stopReason}), retrying`);
      continue;
    }
    code = candidate; version++;
    rec.event("llm_result", { iter, ms, chars: text.length });
    rec.event("hypothesis", { version, narration: extractNarration(text) || "(revised the model)", code });
    console.log(`iter ${iter}: v${version} (${ms}ms) — ${extractNarration(text) || ""}`);

    report = await verify2048({ code, episodes });
    rec.event("verify", {
      version, ok: report.ok, passed: report.passed, failed: report.failed, loadError: report.loadError,
      episodes: (report.episodes || []).map((e) => ({ id: e.id, ok: e.ok, failStep: e.failStep })),
      firstFailure: (report.episodes || []).find((e) => !e.ok)?.detail || null,
      discoveries: report.discoveries || [], smoke: report.smoke,
    });
    console.log(`iter ${iter}: verify ${report.passed}/${report.passed + report.failed}${report.loadError ? " loadError: " + String(report.loadError).slice(0, 120) : ""}`);

    if (report.ok) {
      rec.event("phase", { name: "challenge", text: "Model explains all data. Probing with fresh games to break it…" });
      const fresh = [];
      for (let k = 0; k < 3; k++) fresh.push(playEpisode({ id: `E${nextId++}`, w: k === 0 ? 3 : 4, h: k === 0 ? 3 : 4, seed: nextSeed++, rec }));
      const freshReport = await verify2048({ code, episodes: fresh });
      rec.event("verify_fresh", { version, ok: freshReport.ok, passed: freshReport.passed, failed: freshReport.failed, smoke: freshReport.smoke });
      episodes = episodes.concat(fresh);
      if (freshReport.ok) {
        converged = true;
        rec.event("converged", { version, episodes: episodes.length, totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0), discoveries: report.discoveries || [] });
        console.log(`CONVERGED at v${version}`);
        break;
      }
      rec.event("refuted_by_fresh", { version, firstFailure: freshReport.episodes.find((e) => !e.ok)?.detail || null });
      report = await verify2048({ code, episodes });
      console.log(`fresh games refuted v${version} — continuing.`);
    }
  }

  if (code) rec.saveFile("model_final.js", code);
  rec.finalize({ converged, versions: version, episodes: episodes.length, totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0), discoveries: report?.discoveries || [] });
  updateIndex(RUNS_DIR);
  return { id, converged, version };
}
