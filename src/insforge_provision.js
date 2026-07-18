/* GLASSBOX — one-command InsForge provisioning (idempotent)
 *
 * Creates the backend objects the integration needs:
 *   - table  `runs`         (one row per recorded run; gallery index)
 *   - table  `submissions`  ("submit a game" queue, written by web/submit.html)
 *   - bucket `glassbox-runs` (public; holds every run's artifact files)
 *
 * Config (either works):
 *   env  INSFORGE_BASE_URL=https://your-app.insforge.app  INSFORGE_API_KEY=...
 *   file .env.insforge in the repo root with those two KEY=VALUE lines
 *
 * InsForge REST endpoints used (verified against docs.insforge.dev):
 *   POST /api/database/tables   {tableName, columns:[{name,type,nullable,unique}], rlsEnabled}
 *        column types: string|datetime|integer|float|boolean|uuid|json|file
 *        docs: docs.insforge.dev/api-reference/admin/create-table.md
 *   POST /api/storage/buckets   {bucketName, isPublic}
 *        docs: docs.insforge.dev/api-reference/admin/create-new-bucket.md
 *   Admin auth header: "x-api-key: <API key>"
 *
 * Usage:  node src/insforge_provision.js
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUCKET = "glassbox-runs";

export function loadConfig() {
  let baseUrl = process.env.INSFORGE_BASE_URL;
  let apiKey = process.env.INSFORGE_API_KEY;
  if (!baseUrl || !apiKey) {
    try {
      const raw = readFileSync(join(ROOT, ".env.insforge"), "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "INSFORGE_BASE_URL" && !baseUrl) baseUrl = val;
        if (m[1] === "INSFORGE_API_KEY" && !apiKey) apiKey = val;
      }
    } catch { /* no .env.insforge — env vars were the only chance */ }
  }
  if (!baseUrl || !apiKey) {
    console.error(
      "InsForge is not configured.\n" +
      "Set INSFORGE_BASE_URL and INSFORGE_API_KEY in the environment, or create\n" +
      ".env.insforge in the repo root:\n\n" +
      "  INSFORGE_BASE_URL=https://your-app.insforge.app\n" +
      "  INSFORGE_API_KEY=ik_...   (project API key — keep secret)\n\n" +
      "See README-INSFORGE.md for the full one-time setup.");
    process.exit(1);
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export async function api(cfg, method, path, body, extraHeaders = {}) {
  const headers = { "x-api-key": cfg.apiKey, ...extraHeaders };
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(cfg.baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined
        : body instanceof FormData ? body
        : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, ok: res.ok, json, text };
}

/* treat "already exists" as success so the script is safely re-runnable */
function settle(label, r, existsCodes = ["ALREADY_EXISTS", "DUPLICATE", "EXISTS"]) {
  if (r.ok) { console.log(`  created ${label}`); return true; }
  const errCode = (r.json && (r.json.error || r.json.code)) || "";
  if (r.status === 409 || existsCodes.some(c => String(errCode).toUpperCase().includes(c))) {
    console.log(`  ${label} already exists — ok`);
    return true;
  }
  console.error(`  FAILED ${label}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return false;
}

const RUNS_TABLE = {
  tableName: "runs",
  columns: [
    { columnName: "run_id",    type: "string",  isNullable: false, isUnique: true },
    { columnName: "title",     type: "string",  isNullable: true,  isUnique: false },
    { columnName: "game",      type: "string",  isNullable: true,  isUnique: false },
    { columnName: "track",     type: "string",  isNullable: true,  isUnique: false },
    { columnName: "converged", type: "boolean", isNullable: true,  isUnique: false },
    { columnName: "meta",      type: "json",    isNullable: true,  isUnique: false }
  ],
  rlsEnabled: false
};

const SUBMISSIONS_TABLE = {
  tableName: "submissions",
  columns: [
    { columnName: "name",    type: "string", isNullable: true,  isUnique: false },  // optional submitter name
    { columnName: "kind",    type: "string", isNullable: false, isUnique: false }, // "puzzlescript" | "rule-mutation"
    { columnName: "content", type: "string", isNullable: false, isUnique: false }  // the source / idea text
  ],
  rlsEnabled: false
};

export async function provision(cfg) {
  console.log(`provisioning InsForge backend at ${cfg.baseUrl}`);
  let allOk = true;
  allOk = settle("table runs",
    await api(cfg, "POST", "/api/database/tables", RUNS_TABLE)) && allOk;
  allOk = settle("table submissions",
    await api(cfg, "POST", "/api/database/tables", SUBMISSIONS_TABLE)) && allOk;
  allOk = settle(`bucket ${BUCKET} (public)`,
    await api(cfg, "POST", "/api/storage/buckets", { bucketName: BUCKET, isPublic: true })) && allOk;
  return allOk;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const ok = await provision(loadConfig());
  if (ok) {
    console.log("\ndone. next: node src/insforge_sync.js  (pushes runs/ into the backend)");
  } else {
    console.error("\nprovisioning finished with errors — see above.");
    process.exit(1);
  }
}
