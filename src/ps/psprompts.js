// Prompts for the PuzzleScript track: the agent must emit a complete PuzzleScript
// game whose engine-level behavior exactly reproduces the recorded interaction log.

export const PS_SYSTEM = `You are GLASSBOX, an AI scientist that reverse-engineers unknown games by writing their source code.

You are interacting with an unknown tile-based game running on the PuzzleScript engine. You see only interaction logs: grids of object tokens, the actions pressed, and whether the level was solved. You must write a complete PuzzleScript program that reproduces every logged transition EXACTLY when replayed in the engine. A verifier compiles your source and replays the full log against it; any mismatched cell or mistimed win is a refutation and you will be shown pointed counterexamples.

Rules of the craft:
- Fit ALL the data. One wrong cell in one step is a refutation.
- Prefer the fewest, most general rules that explain everything.
- The log may contain no winning attempt. In that case propose the most plausible WINCONDITIONS consistent with the objects and dynamics — your guess will be tested by a real experiment (we will search YOUR game for a winning plan and execute it on the real game).
- Keep sprites trivial: a single color line per object is enough (no pixel art needed).

Output format, exactly:
NARRATION: <one sentence, plain language, what you concluded or changed>
DISCOVERIES:
- <falsifiable claim with evidence, one per line, 3-8 lines>
Then a single fenced code block containing the COMPLETE PuzzleScript source.`;

export function psContract(names) {
  return `## Contract

- Your OBJECTS section must define objects named EXACTLY: ${names.join(", ")} — plus Background. Same capitalization.
- Observation format used in the log and by the verifier: each cell is the objects present (Background omitted), sorted alphabetically, joined "+"; empty cells are "."; cells joined "|"; rows joined "/" reading top to bottom.
- Actions are the engine inputs UP, DOWN, LEFT, RIGHT, ACTION (arrow keys + X).
- Your LEVELS section must reconstruct the level exactly as it appears in obs0 of the log (define LEGEND characters as needed, including combination characters like "@ = Crate and Target" style if two objects share a cell).
- One level only. Include all required sections (OBJECTS, LEGEND, SOUNDS may be empty, COLLISIONLAYERS, RULES, WINCONDITIONS, LEVELS). Choose COLLISIONLAYERS from the evidence (which objects coexist in one cell vs never do).
- The verifier replays every attempt from level start: after each action, the token grid AND the solved-flag must match the log exactly.`;
}

export function attemptsBlock(attempts, { failingIds = new Set(), maxChars = 40000 } = {}) {
  const fmt = (at) => {
    const lines = [`### Attempt ${at.id}`];
    lines.push(`obs0: ${at.obs[0]}`);
    for (let i = 0; i < at.actions.length; i++) {
      lines.push(`${at.actions[i]} -> ${at.obs[i + 1]}${at.statuses[i + 1] === "solved" ? "   [LEVEL SOLVED]" : ""}`);
    }
    return lines.join("\n");
  };
  const ordered = [...attempts].sort((a, b) => (failingIds.has(b.id) ? 1 : 0) - (failingIds.has(a.id) ? 1 : 0));
  const parts = [];
  let used = 0, skipped = 0;
  for (const at of ordered) {
    const s = fmt(at);
    if (used + s.length > maxChars && parts.length > 3) { skipped++; continue; }
    parts.push(s); used += s.length;
  }
  if (skipped) parts.push(`(…${skipped} additional attempts omitted for length — your game must still fit them)`);
  return `## Interaction log\n\n${parts.join("\n\n")}`;
}

export function psFirstPrompt(attempts, names) {
  return `${psContract(names)}

${attemptsBlock(attempts, {})}

## Task
Work out the dynamics: what moves, what blocks, what pushes, what coexists in a cell, what ACTION does, and what could plausibly constitute winning. Then write the complete PuzzleScript source. Fit every attempt exactly.`;
}

export function psRevisePrompt(attempts, names, prevSource, report) {
  const failingIds = new Set(report.episodes.filter((e) => !e.ok).map((e) => e.id));
  const fails = report.episodes.filter((e) => !e.ok).slice(0, 3);
  const failText = report.loadError
    ? `Your source failed to compile:\n${report.loadError}`
    : fails.map((f) => {
        const d = f.detail || {};
        if (d.error) return `Attempt ${f.id}: verifier error: ${d.error}`;
        const rows = (d.rowDiffs || []).map((r) => `  row ${r.y}: expected  ${r.expected}\n         yours     ${r.got}`).join("\n");
        return `Attempt ${f.id} FAILS at step ${d.step} (after ${d.action}):${d.note ? "\n  " + d.note : ""}
${rows}${d.expectedStatus !== d.gotStatus ? `\n  solved-flag: expected ${d.expectedStatus}, yours ${d.gotStatus}` : ""}`;
      }).join("\n\n");

  return `${psContract(names)}

## Your previous source (${report.passed}/${report.passed + report.failed} attempts correct)
\`\`\`
${prevSource}
\`\`\`

## Refutations
${failText}

${attemptsBlock(attempts, { failingIds })}

## Task
Diagnose the refutations (rule order, missing rule, wrong collision layer, wrong win condition...), revise, and output the complete corrected source.`;
}
