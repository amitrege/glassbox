// Headless PuzzleScript adapter (philschatz/puzzlescript engine).
// The agent sees only token grids: cell = sorted sprite names minus Background,
// joined "+" ("." if empty), cells joined "|", rows joined "/".
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Parser, GameEngine, EmptyGameEngineHandler, INPUT_BUTTON } = require("puzzlescript");

export const BUTTONS = {
  UP: INPUT_BUTTON.UP, DOWN: INPUT_BUTTON.DOWN,
  LEFT: INPUT_BUTTON.LEFT, RIGHT: INPUT_BUTTON.RIGHT, ACTION: INPUT_BUTTON.ACTION,
};
export const ACTION_NAMES = ["UP", "DOWN", "LEFT", "RIGHT", "ACTION"];

export function makeEngine(source, level = 0) {
  const { data } = Parser.parse(source);
  const engine = new GameEngine(data, new EmptyGameEngineHandler());
  engine.setLevel(level, null);
  return engine;
}

export function observe(engine) {
  const cells = engine.getCurrentLevelCells();
  return cells
    .map((row) =>
      row
        .map((c) => {
          const names = c.getSprites().map((s) => s.getName()).filter((n) => n.toLowerCase() !== "background").sort();
          return names.length ? names.join("+") : ".";
        })
        .join("|")
    )
    .join("/");
}

export function spriteNames(engine) {
  const names = new Set();
  for (const row of engine.getCurrentLevelCells())
    for (const c of row) for (const s of c.getSprites()) names.add(s.getName());
  return [...names].sort();
}

export async function act(engine, actionName) {
  engine.press(BUTTONS[actionName]);
  const r = await engine.tick();
  return { solved: Boolean(r.didWinGame || r.didLevelChange) };
}

// Replay an action list on a fresh engine; returns per-step obs + solved flags.
export async function replay(source, actions, level = 0) {
  const engine = makeEngine(source, level);
  const obs = [observe(engine)];
  const solved = [false];
  for (const a of actions) {
    const r = await act(engine, a);
    obs.push(observe(engine));
    solved.push(r.solved);
    if (r.solved) break;
  }
  return { obs, solved };
}

// BFS for a shortest winning action sequence using engine snapshots.
export async function bfsSolve(source, { level = 0, maxMs = 60000, maxStates = 120000, buttons = ["UP", "DOWN", "LEFT", "RIGHT"] } = {}) {
  const engine = makeEngine(source, level);
  const start = JSON.stringify(engine.saveSnapshotToJSON());
  const seen = new Set([start]);
  let frontier = [{ snap: start, path: [] }];
  const t0 = Date.now();
  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      for (const b of buttons) {
        if (Date.now() - t0 > maxMs || seen.size > maxStates) return { solution: null, states: seen.size, ms: Date.now() - t0, exhausted: false };
        engine.loadSnapshotFromJSON(JSON.parse(node.snap));
        engine.press(BUTTONS[b]);
        const r = await engine.tick();
        if (r.didWinGame || r.didLevelChange) return { solution: [...node.path, b], states: seen.size, ms: Date.now() - t0 };
        const s = JSON.stringify(engine.saveSnapshotToJSON());
        if (!seen.has(s)) { seen.add(s); next.push({ snap: s, path: [...node.path, b] }); }
      }
    }
    frontier = next;
  }
  return { solution: null, states: seen.size, ms: Date.now() - t0, exhausted: true };
}
