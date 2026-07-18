# GLASSBOX × InsForge — optional hosted data plane

[InsForge](https://insforge.dev) (open-source, Supabase-like) can host GLASSBOX's run
artifacts and a public **"submit a game" queue**, so the static site works without the
local `runs/` folder. It is strictly **optional**: when unconfigured, every page keeps
reading the local `../runs/…` files exactly as before — zero disruption.

What it adds:

| piece | what it does |
|---|---|
| `src/insforge_provision.js` | one command creates the backend objects: tables `runs` + `submissions`, public bucket `glassbox-runs` (idempotent — safe to re-run) |
| `src/insforge_sync.js` | pushes `runs/index.json` + every run directory into InsForge: one upserted row per run (`run_id`, `title`, `game`, `track`, `converged`, `meta` json) and every artifact file as object `<runId>/<file>` (re-run any time; overwrites) |
| `web/datasource.js` | defines `window.gbData` (`fetchRunIndex` / `fetchRunText` / `fetchRunJson` / `runFileUrl`); reads from InsForge when `web/insforge-config.js` exists, else falls back to local files — and also falls back per-call if the backend is unreachable |
| `web/submit.html` | public "give the agent a game it has never seen" form → inserts into the `submissions` table (a stored, moderated queue; nothing executes automatically). Shows a friendly explainer when the backend isn't configured |

## One-time setup

1. Create a project at [insforge.dev](https://insforge.dev) (or self-host: `git clone
   https://github.com/InsForge/InsForge && cd insforge && cp .env.example .env &&
   docker compose -f docker-compose.prod.yml up` → `http://localhost:7130`).
2. From the project dashboard grab the **base URL**, the secret **API key**, and the
   public **anon key**.
3. Server side — create `.env.insforge` in the repo root (gitignored):

   ```
   INSFORGE_BASE_URL=https://your-app.insforge.app
   INSFORGE_API_KEY=ik_...        # secret — never ships to the browser
   ```

4. Browser side — `cp web/insforge-config.example.js web/insforge-config.js`
   (gitignored) and fill in `baseUrl` + `anonKey`.
5. Provision, then sync:

   ```
   node src/insforge_provision.js
   node src/insforge_sync.js
   ```

Pages opt in by loading, before their own script:

```html
<script src="insforge-config.js"></script> <!-- optional; 404 is harmless -->
<script src="datasource.js"></script>
```

then using `gbData.fetchRunIndex()` / `gbData.fetchRunText(runId, file)` /
`gbData.runFileUrl(runId, file)` instead of hard-coded `../runs/…` fetches.

## API surface used (per docs.insforge.dev)

- `POST /api/database/tables`, `POST /api/storage/buckets` — provisioning (admin
  `x-api-key` header)
- `POST /api/database/records/{table}` with `Prefer: resolution=merge-duplicates` —
  PostgREST-style upsert of run rows; plain insert for submissions (anon `Bearer` key)
- `GET /api/database/records/runs?select=…&order=…` — gallery index
- `PUT|GET /api/storage/buckets/glassbox-runs/objects/{runId}/{file}` — artifact
  upload / public download

## Status & honest one-liner

Verified end-to-end against a local stand-in server implementing the documented
InsForge endpoints (provision → sync of all real runs → gallery + submit page in a
headless browser, byte-identical artifacts). Cloud verification pends real project keys.

For judges: *the site is static and works from flat files; plug in InsForge keys and
the same pages read runs from a hosted Postgres + object store, and visitors can queue
new games for the agent to learn — the backend is optional, inspectable, and never
executes submissions automatically.*
