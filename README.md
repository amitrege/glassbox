# GLASSBOX

**It plays a game it has never seen, figures out the rules by experimenting, and hands you back the rules as code — verified against every observation.**

An AI agent (Claude Opus 4.8) probes an unknown environment, writes an executable model of it (JavaScript for grid games, actual PuzzleScript source for tile games), and a verifier replays the model against the full interaction log. Any mismatched cell is a refutation, fed back as a counterexample. The loop repeats until the model survives fresh, unseen games — and in the PuzzleScript track, until the agent **solves the real game using a plan computed entirely inside its own reconstruction**.

## What's in the box

- `src/agent.js` — the learning loop: probe → hypothesize (LLM writes code) → verify by exact replay → refute → repeat.
- `src/envs/minesweeper.js` — the real environment (classic, plus a **knight's-move variant** that looks like Minesweeper but isn't — prior knowledge actively misleads, so the agent must do real science).
- `src/verify_child.js` — the exact-replay verifier (isolated process; reconstructs hidden state from end-of-game reveals, replays every action, compares every cell).
- `src/ps/` — the PuzzleScript track: the agent emits complete PuzzleScript source, verified by compiling and replaying in the real engine; on success it BFS-plans a win inside its own learned game and executes the plan on the real one, frame-predicted.
- `web/` — the viewer: watch any run replay (board + evolving code + refutations + discoveries), and **play the AI's reconstructions**.
- `runs/` — recorded runs. Everything is static: `events.jsonl` (the full learning log), `model_final.js` / `game_learned.txt` (the learned artifact), `clone.html` (playable single-file export of a learned PuzzleScript game).

## Run it

```bash
npm install
# put ANTHROPIC_API_KEY in .env (or have `claude` CLI installed — it falls back to that)
node src/run_famous.js            # classic Minesweeper
node src/run_famous.js knight     # the misleading variant (digits count knight-move cells)
node src/run_ps.js sokoban_basic  # PuzzleScript track (needs ../research/PuzzleScript checkout)
# view
python3 -m http.server 8123       # then open http://localhost:8123/web/
```

`GLASSBOX_LLM=mock` runs the loop with canned responses (no tokens) for plumbing tests. `GLASSBOX_MODEL` overrides the model.

## Honesty notes (read before demoing)

- The agent is never told what game it is playing; prompts are game-name-free and observation-only (from v2 runs onward the full prompt text is logged in `events.jsonl` so you can audit this). But frontier models **recognize** classic games from logs — the classic Minesweeper run converged in one shot, narrating "This is standard Minesweeper", and the knight run narrated "This is knight-move Minesweeper". Recognition is exactly why the mutated variants exist: whatever the model recalls or guesses, **the verifier only passes exact behavioral reproduction of this specific environment**, including deviations (toroidal wrap, double-counted wrapped offsets) no published variant has.
- **Exploration is a scripted probe policy** (randomized plus deliberate edge-case probes); the LLM's job is theory-making, not action selection. The exception is the PuzzleScript endgame, where the decisive experiment — which action sequence to run on the real game — comes from search inside the model's own learned rules. Closing the loop on LLM-chosen probes is the natural next step.
- PuzzleScript object names (Wall, Crate…) leak semantics, like sprites do for a human player. The *rules* are still learned from evidence — the verifier only passes exact behavioral reproduction.
- In the Sokoban run, no exploration attempt ever won: the win condition was an explicit guess (stated as such in discoveries) and was **confirmed experimentally** — the plan computed in the learned game won the real game, matching every predicted frame up to and including the winning move (the post-win frame is out of scope: the real cartridge advances to a level the model never saw), in exactly the true optimal number of moves.
- Mine **placement** in brand-new games (play pages) is the model's guess — exact replay verifies reactions to actions, not hidden placement. The real environment is first-click-safe; the learned models don't all encode that.
- Everything under `runs/` is append-only during a run; the verifier is fixed harness code the model never writes. The original environments in `src/envs/` are ordinary hand-written code — it's the *reconstructions* that are entirely AI-written.

## Deploy

The demo site is fully static (`web/` + `runs/`). Any static host works:

```bash
# e.g. Netlify/GitHub Pages: publish the repo root; entry point is /web/
```

New runs are created offline by the scripts above and committed as data.
