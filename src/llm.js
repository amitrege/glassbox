// LLM backend for the synthesizer. Three drivers:
//  - sdk:  official @anthropic-ai/sdk (used when ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set)
//  - cli:  `claude -p` headless (uses the user's existing Claude Code auth)
//  - mock: canned responses for plumbing tests (GLASSBOX_LLM=mock)
import { execFile } from "node:child_process";
import os from "node:os";

export const MODEL = process.env.GLASSBOX_MODEL || "claude-opus-4-8";

function pickDriver() {
  if (process.env.GLASSBOX_LLM) return process.env.GLASSBOX_LLM;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "sdk";
  return "cli";
}
export const DRIVER = pickDriver();

let _anthropic = null;
async function sdkComplete({ system, prompt, maxTokens }) {
  if (!_anthropic) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    _anthropic = new Anthropic();
  }
  const stream = _anthropic.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { text, stopReason: msg.stop_reason, blocks: msg.content.map((b) => b.type).join(",") };
}

function cliComplete({ system, prompt }) {
  const full = `${system}\n\n====\n\n${prompt}`;
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", "--model", MODEL],
      { cwd: os.tmpdir(), maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude cli failed: ${err.message}\n${stderr?.slice(0, 500)}`));
        resolve(stdout);
      }
    );
    child.stdin.write(full);
    child.stdin.end();
  });
}

let _mock = null;
async function mockComplete(args) {
  if (!_mock) _mock = (await import("./mock.js")).mockComplete;
  return _mock(args);
}

export async function complete({ system, prompt, maxTokens = 100000, purpose = "synthesize" }) {
  const t0 = Date.now();
  let text, extra = {};
  if (DRIVER === "sdk") { const r = await sdkComplete({ system, prompt, maxTokens }); text = r.text; extra = { stopReason: r.stopReason, blocks: r.blocks }; }
  else if (DRIVER === "mock") text = await mockComplete({ system, prompt, purpose });
  else text = await cliComplete({ system, prompt });
  return { text, ms: Date.now() - t0, ...extra };
}

// Extract the last fenced code block; fall back to the whole reply.
export function extractCode(text) {
  const fences = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  if (fences.length) return fences[fences.length - 1][1].trim();
  return text.trim();
}

export function extractNarration(text) {
  const m = text.match(/NARRATION:\s*(.+)/);
  return m ? m[1].trim() : null;
}
