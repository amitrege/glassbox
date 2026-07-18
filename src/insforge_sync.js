/* GLASSBOX — push local runs/ artifacts to an InsForge backend
 *
 * Reads runs/index.json plus every run directory and mirrors them:
 *   - table  `runs`          one row per run (run_id, title, game, track,
 *                            converged, meta json) — upserted, safe to re-run
 *   - bucket `glassbox-runs` object key "<runId>/<filename>" for each artifact
 *                            (meta.json, events.jsonl, model_final.js,
 *                            game_learned.txt, clone.html, …) plus a mirror of
 *                            runs/index.json at the bucket root
 *
 * Config: env INSFORGE_BASE_URL + INSFORGE_API_KEY, or .env.insforge file
 * (loaded via loadConfig from src/insforge_provision.js).
 *
 * InsForge REST endpoints used (verified against docs.insforge.dev):
 *   POST /api/database/records/{table}
 *        body = JSON ARRAY of rows;
 *        upsert via "Prefer: resolution=merge-duplicates,return=representation"
 *        (merges on the run_id UNIQUE constraint)
 *        docs: docs.insforge.dev/sdks/rest/database.md
 *   PUT  /api/storage/buckets/{bucket}/objects/{key}
 *        multipart/form-data, field name "file"; overwrites existing keys
 *        docs: docs.insforge.dev/api-reference/client/upload-object.md
 *   DELETE /api/storage/buckets/{bucket}/objects/{key}  (fallback if a PUT
 *        conflicts) — docs: docs.insforge.dev/api-reference/client/delete-object.md
 *   Admin auth header: "x-api-key: <API key>"
 *
 * Usage:  node src/insforge_sync.js          # sync everything
 *         node src/insforge_sync.js <runId>  # sync a single run
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, api, BUCKET } from "./insforge_provision.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS_DIR = join(ROOT, "runs");

const MIME = {
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".js": "text/javascript",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png"
};
const mimeOf = f => MIME[f.slice(f.lastIndexOf("."))] || "application/octet-stream";

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

async function uploadFile(cfg, key, bytes, contentType) {
  const put = () => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), key.split("/").pop());
    return api(cfg, "PUT", `/api/storage/buckets/${BUCKET}/objects/${encodeKey(key)}`, form);
  };
  let r = await put();
  if (r.status === 409) {                    // key exists and backend refused overwrite
    await api(cfg, "DELETE", `/api/storage/buckets/${BUCKET}/objects/${encodeKey(key)}`);
    r = await put();
  }
  if (!r.ok) throw new Error(`upload ${key}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  return bytes.length;
}

async function upsertRunRows(cfg, metas) {
  const rows = metas.map(m => ({
    run_id: String(m.id),
    title: m.title ?? null,
    game: m.game ?? null,
    track: m.track ?? null,
    converged: m.converged === true,
    meta: m
  }));
  const r = await api(cfg, "POST", "/api/database/records/runs", rows,
    { "Prefer": "resolution=merge-duplicates,return=representation" });
  if (!r.ok) {
    const hint = r.status === 404
      ? "  (table missing? run: node src/insforge_provision.js)" : "";
    throw new Error(`upsert runs rows: HTTP ${r.status} ${r.text.slice(0, 300)}${hint}`);
  }
  const n = Array.isArray(r.json) ? r.json.length : rows.length;
  console.log(`  upserted ${n} row(s) into table runs`);
}

async function syncRunFiles(cfg, runId) {
  const dir = join(RUNS_DIR, runId);
  const files = readdirSync(dir).filter(f => {
    try { return statSync(join(dir, f)).isFile(); } catch { return false; }
  });
  for (const f of files) {
    const bytes = readFileSync(join(dir, f));
    const size = await uploadFile(cfg, `${runId}/${f}`, bytes, mimeOf(f));
    console.log(`  uploaded ${runId}/${f} (${(size / 1024).toFixed(1)} kB)`);
  }
  return files.length;
}

async function main() {
  const cfg = loadConfig();
  const only = process.argv[2] || null;

  let index;
  try {
    index = JSON.parse(readFileSync(join(RUNS_DIR, "index.json"), "utf8"));
  } catch (e) {
    console.error(`cannot read runs/index.json: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(index)) {
    console.error("runs/index.json is not an array");
    process.exit(1);
  }
  const metas = only ? index.filter(m => m.id === only) : index;
  if (metas.length === 0) {
    console.error(only ? `run "${only}" not found in runs/index.json` : "no runs to sync");
    process.exit(1);
  }

  console.log(`syncing ${metas.length} run(s) to ${cfg.baseUrl} (bucket ${BUCKET})`);

  console.log("runs table:");
  await upsertRunRows(cfg, metas);

  let fileCount = 0;
  for (const m of metas) {
    console.log(`run ${m.id}:`);
    fileCount += await syncRunFiles(cfg, String(m.id));
  }

  // mirror the gallery index at the bucket root (fallback path for datasource.js)
  const idxBytes = readFileSync(join(RUNS_DIR, "index.json"));
  await uploadFile(cfg, "index.json", idxBytes, "application/json");
  console.log(`  uploaded index.json (${(idxBytes.length / 1024).toFixed(1)} kB)`);
  fileCount += 1;

  console.log(`\ndone: ${metas.length} run row(s), ${fileCount} file(s) pushed to InsForge.`);
}

await main();
