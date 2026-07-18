// Parent-side wrapper: run verify_child.js with a hard timeout.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function verifyModel({ code, episodes, smoke = true, timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [path.join(__dirname, "verify_child.js")],
      { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout) => {
        if (err && !stdout) {
          return resolve({ ok: false, loadError: `verifier crashed or timed out: ${String(err.message).slice(0, 200)}`, episodes: [], passed: 0, failed: episodes.length });
        }
        try { resolve(JSON.parse(stdout.trim().split("\n").pop())); }
        catch { resolve({ ok: false, loadError: "verifier produced unparseable output", episodes: [], passed: 0, failed: episodes.length }); }
      }
    );
    child.stdin.write(JSON.stringify({ code, episodes, smoke }));
    child.stdin.end();
  });
}
