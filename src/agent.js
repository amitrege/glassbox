// The learning loop: probe → hypothesize (LLM writes code) → verify by exact
// replay → refute with counterexamples → repeat until the model survives fresh data.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Recorder, updateIndex } from "./recorder.js";
import { explorationPlan, playEpisode } from "./explore.js";
import { verifyModel } from "./verify.js";
import { complete, extractCode, extractNarration, MODEL, DRIVER } from "./llm.js";
import { SYSTEM, firstPrompt, revisePrompt } from "./prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(__dirname, "..", "runs");
const MAX_ITER = 8;

export async function runMinesweeper({ label = "minesweeper", neighborhood = "n8", torus = false, lite = false, title = "Minesweeper" } = {}) {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${label}`;
  const rec = new Recorder(RUNS_DIR, id, {
    env: "env_A", envKind: "grid", track: "famous", game: label,
    title, model: MODEL, driver: DRIVER,
  });
  updateIndex(RUNS_DIR);
  console.log(`run ${id} — driver=${DRIVER} model=${MODEL}`);

  rec.event("phase", { name: "explore", text: "Probing the unknown environment…" });
  let { episodes, nextId, nextSeed, wins, firstRevealSafe } = explorationPlan({ rec, neighborhood, torus, lite });
  console.log(`explored: ${episodes.length} episodes, ${wins} wins, firstRevealSafe=${firstRevealSafe.join("/")}`);

  let code = null, report = null, converged = false, version = 0;
  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const prompt = version === 0 ? firstPrompt(episodes) : revisePrompt(episodes, code, report);
    rec.event("llm_call", { iter, purpose: version === 0 ? "synthesize" : "revise", promptChars: prompt.length, promptText: prompt });
    console.log(`iter ${iter}: calling LLM (${prompt.length} chars)…`);
    let text, ms, stopReason, blocks;
    try {
      ({ text, ms, stopReason, blocks } = await complete({ system: SYSTEM, prompt, purpose: "synthesize" }));
    } catch (e) {
      console.error(`LLM call failed: ${e.message}`); rec.event("llm_error", { iter, error: String(e.message).slice(0, 300) });
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const candidate = extractCode(text);
    if (!candidate || !candidate.trim() || !/const\s+model/.test(candidate)) {
      rec.saveFile(`raw_response_iter${iter}.txt`, text || "(empty)");
      rec.event("llm_error", { iter, error: "empty or malformed response (no model code) — retrying", rawChars: (text || "").length, stopReason, blocks, ms });
      console.log(`iter ${iter}: empty/malformed LLM response (${(text||"").length} chars, stop=${stopReason}, blocks=${blocks}, ${ms}ms), retrying`);
      continue;
    }
    code = candidate;
    version++;
    const narration = extractNarration(text) || "(revised the model)";
    rec.event("llm_result", { iter, ms, chars: text.length });
    rec.event("hypothesis", { version, narration, code });
    console.log(`iter ${iter}: v${version} (${ms}ms) — ${narration}`);

    report = await verifyModel({ code, episodes });
    rec.event("verify", {
      version, ok: report.ok, passed: report.passed, failed: report.failed,
      loadError: report.loadError,
      episodes: report.episodes.map((e) => ({ id: e.id, ok: e.ok, failStep: e.failStep })),
      firstFailure: report.episodes.find((e) => !e.ok)?.detail || null,
      discoveries: report.discoveries || [],
      smoke: report.smoke,
    });
    console.log(`iter ${iter}: verify ${report.passed}/${report.passed + report.failed}${report.loadError ? " loadError: " + report.loadError : ""}`);

    if (report.ok) {
      // model explains everything seen — now try to break it with FRESH data
      rec.event("phase", { name: "challenge", text: "Model explains all data. Probing with fresh games to break it…" });
      const fresh = [];
      for (let k = 0; k < 3; k++) {
        const r = playEpisode({ id: `E${nextId++}`, w: 5 + k, h: 5, mines: 3 + k, seed: nextSeed++, rec, neighborhood, torus });
        if (r.finished) fresh.push(r.ep);
      }
      const freshReport = await verifyModel({ code, episodes: fresh, smoke: true });
      rec.event("verify_fresh", { version, ok: freshReport.ok, passed: freshReport.passed, failed: freshReport.failed, smoke: freshReport.smoke });
      episodes = episodes.concat(fresh);
      if (freshReport.ok) {
        converged = true;
        rec.event("converged", {
          version,
          episodes: episodes.length,
          totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0),
          discoveries: report.discoveries || [],
        });
        console.log(`CONVERGED at v${version}: survived ${fresh.length} fresh games unseen during learning.`);
        break;
      }
      report = freshReport.loadError ? freshReport : await verifyModel({ code, episodes });
      rec.event("refuted_by_fresh", { version, firstFailure: freshReport.episodes.find((e) => !e.ok)?.detail || null });
      console.log(`fresh games refuted v${version} — continuing.`);
    }
  }

  if (code) rec.saveFile("model_final.js", code);
  rec.finalize({
    converged, versions: version,
    episodes: episodes.length,
    totalSteps: episodes.reduce((a, e) => a + e.actions.length, 0),
    discoveries: report?.discoveries || [],
  });
  updateIndex(RUNS_DIR);
  return { id, converged, version, dir: rec.dir };
}
