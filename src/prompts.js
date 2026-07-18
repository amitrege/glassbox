// Prompt construction for the synthesizer. Deliberately never names the game —
// the agent gets observations, an action space, and a contract. Nothing else.

export const SYSTEM = `You are GLASSBOX, an AI scientist that reverse-engineers unknown environments by writing executable models of them.

Your beliefs are not prose — they are code. You will be shown interaction logs from an unknown grid environment and must produce a JavaScript model that reproduces every logged observation EXACTLY. A verifier replays your model against the full log; any mismatch is a refutation and you will be shown pointed counterexamples.

Rules of the craft:
- Fit ALL the data, not most of it. One wrong cell is a refutation.
- Prefer the simplest mechanism that explains everything. If you need a special case, say so in discoveries and treat it as a hypothesis to re-examine.
- State discoveries as falsifiable claims with evidence counts, e.g. "revealed digits equal the count of adjacent hidden-marked cells (checked 214/214 cells)".
- Pure JavaScript, no imports, no Math.random (an rng function is provided where randomness is allowed), no console output.

Output format, exactly:
NARRATION: <one sentence, plain language, what you concluded or changed this round>
Then a single fenced code block defining \`const model = {...}\`.`;

export function contract() {
  return `## Model contract

Your code block must define \`const model\` with:

- \`discoveries\`: array of strings — your current verified/claimed findings with evidence counts.
- \`reconstructHidden(finalGrid)\` → 2D array of booleans (h rows × w cols). Given the LAST observation grid of a finished episode (a 2D array of single-character strings), return which cells were the hidden special cells. (Inspect the final grids in the log to work out how they are exposed at the end.)
- \`init(w, h, hiddenCount, hiddenGrid, rng)\` → state. If \`hiddenGrid\` (2D booleans) is provided, the hidden cells are exactly those. If \`hiddenGrid\` is null (a brand-new game), place them yourself according to whatever placement rule the data supports, using \`rng()\` (returns float in [0,1)) as the only randomness source.
- \`step(state, action)\` → state. Actions are \`{type: "reveal"|"flag", x, y}\` (x = column, y = row, 0-indexed from top-left).
- \`observe(state)\` → \`{grid: [[char]], vars: {counter: number}, status: "playing"|"won"|"lost"}\` matching the logged observation format exactly.

The verifier, for each finished episode: takes your reconstructHidden of the final grid, calls init with it, then replays the logged actions through step, comparing observe() to every logged observation (grid, status, counter). Exact match required.`;
}

export function episodesBlock(episodes, { failingIds = new Set(), maxChars = 45000 } = {}) {
  const fmt = (ep) => {
    const lines = [`### Episode ${ep.id} — ${ep.w}x${ep.h}, hiddenCount=${ep.hiddenCount}`];
    lines.push(`obs0 (status=${ep.statuses[0]}, counter=${ep.counters[0]}):  ${ep.obs[0]}`);
    for (let i = 0; i < ep.actions.length; i++) {
      const a = ep.actions[i];
      lines.push(`${a.type}(${a.x},${a.y}) -> (status=${ep.statuses[i + 1]}, counter=${ep.counters[i + 1]})  ${ep.obs[i + 1]}`);
    }
    return lines.join("\n");
  };
  const ordered = [...episodes].sort((a, b) => (failingIds.has(b.id) ? 1 : 0) - (failingIds.has(a.id) ? 1 : 0));
  const parts = [];
  let used = 0, skipped = 0;
  for (const ep of ordered) {
    const s = fmt(ep);
    if (used + s.length > maxChars && parts.length > 4) { skipped++; continue; }
    parts.push(s); used += s.length;
  }
  if (skipped) parts.push(`(…${skipped} additional passing episodes omitted for length — your model must still fit them)`);
  return `## Interaction log\nGrids are rows joined by "/" reading top to bottom; each character is one cell.\nObservation characters seen in the data: keep their meaning consistent with the log.\n\n${parts.join("\n\n")}`;
}

export function firstPrompt(episodes) {
  return `${contract()}

${episodesBlock(episodes)}

## Task
Study the log like a scientist: what do the characters mean, what does each action do, when does status change, what is "counter", how are the hidden cells exposed in final grids, and is there anything statistically suspicious about where hidden cells never appear? Then write the model. Fit every episode exactly.`;
}

export function revisePrompt(episodes, prevCode, report) {
  const failingIds = new Set(report.episodes.filter((e) => !e.ok).map((e) => e.id));
  const fails = report.episodes.filter((e) => !e.ok).slice(0, 3);
  const failText = report.loadError
    ? `Your code failed to load/run: ${report.loadError}`
    : fails.map((f) => {
        const d = f.detail || {};
        if (d.error) return `Episode ${f.id}: your model threw: ${d.error}${d.stack ? `\n  at ${d.stack}` : ""}`;
        const cellDiffs = (d.diffs || []).filter((x) => x.x !== undefined).map((x) => `(${x.x},${x.y}) expected '${x.expected}' got '${x.got}'`).join("; ");
        const fieldDiffs = (d.diffs || []).filter((x) => x.field).map((x) => `${x.field}: expected ${JSON.stringify(x.expected)} got ${JSON.stringify(x.got)}`).join("; ");
        return `Episode ${f.id} FAILS at step ${d.step} (after ${typeof d.action === "object" ? `${d.action.type}(${d.action.x},${d.action.y})` : d.action}):
  expected: ${d.expectedGrid}   (status=${d.expectedStatus}, counter=${d.expectedCounter})
  yours:    ${d.gotGrid}   (status=${d.gotStatus}, counter=${d.gotCounter})
  ${cellDiffs ? "cell diffs: " + cellDiffs : ""}${fieldDiffs ? "  field diffs: " + fieldDiffs : ""}`;
      }).join("\n\n");

  return `${contract()}

## Your previous model (${report.passed}/${report.passed + report.failed} episodes correct)
\`\`\`js
${prevCode}
\`\`\`

## Refutations
${failText}

${episodesBlock(episodes, { failingIds })}

## Task
Diagnose WHY the counterexamples refute your model — the bug may be one level deeper than the symptom. Revise minimally, update discoveries (drop refuted claims, note what the counterexample taught you), and output the full corrected model.`;
}
