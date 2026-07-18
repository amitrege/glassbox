/* GLASSBOX — pluggable run-data source (no frameworks, no build step)
 *
 * Defines window.gbData with four async-friendly helpers:
 *   fetchRunIndex()              -> Promise<Array<meta>>   (gallery index)
 *   fetchRunText(runId, file)    -> Promise<string>
 *   fetchRunJson(runId, file)    -> Promise<any>
 *   runFileUrl(runId, file)      -> string  (plain URL, usable in <a>/<iframe>)
 *
 * Data source selection:
 *   - If window.INSFORGE = { baseUrl, anonKey, bucket } exists (loaded from the
 *     optional web/insforge-config.js — see web/insforge-config.example.js),
 *     runs are read from an InsForge backend:
 *       index  -> GET  {baseUrl}/api/database/records/runs   (PostgREST-style
 *                 REST, "Authorization: Bearer <anonKey>")
 *                 docs: docs.insforge.dev/sdks/rest/database.md
 *       files  -> GET  {baseUrl}/api/storage/buckets/{bucket}/objects/{runId}/{file}
 *                 (public bucket, bytes served directly)
 *                 docs: docs.insforge.dev/api-reference/client/download-object.md
 *   - Otherwise (or on any InsForge failure) it falls back to the repository's
 *     local files under ../runs/… — identical behavior to the original pages.
 *
 * This file must never throw at load time when unconfigured.
 */
"use strict";
// treat an unedited config template as unconfigured
if (typeof window !== "undefined" && window.INSFORGE && /YOUR-APP|YOUR_PROJECT|example\.insforge/i.test(String(window.INSFORGE.baseUrl || ""))) { window.INSFORGE = undefined; }


(function () {
  var cfg = null;
  try {
    if (typeof window !== "undefined" &&
        window.INSFORGE &&
        typeof window.INSFORGE.baseUrl === "string" &&
        window.INSFORGE.baseUrl.length > 0) {
      cfg = {
        baseUrl: String(window.INSFORGE.baseUrl).replace(/\/+$/, ""),
        anonKey: String(window.INSFORGE.anonKey || ""),
        bucket:  String(window.INSFORGE.bucket || "glassbox-runs")
      };
    }
  } catch (e) { cfg = null; }

  var LOCAL_PREFIX = "../runs/";

  function authHeaders() {
    return cfg && cfg.anonKey ? { "Authorization": "Bearer " + cfg.anonKey } : {};
  }

  function encodeKey(runId, filename) {
    // object keys contain "/" as a real separator; encode each segment only
    return [runId, filename].map(encodeURIComponent).join("/");
  }

  function insforgeFileUrl(runId, filename) {
    return cfg.baseUrl + "/api/storage/buckets/" + encodeURIComponent(cfg.bucket) +
           "/objects/" + encodeKey(runId, filename);
  }

  function localFileUrl(runId, filename) {
    return LOCAL_PREFIX + encodeURIComponent(runId) + "/" + encodeURIComponent(filename);
  }

  async function fetchOk(url, opts) {
    var r = await fetch(url, opts || {});
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r;
  }

  async function localIndex() {
    var r = await fetchOk(LOCAL_PREFIX + "index.json", { cache: "no-store" });
    return r.json();
  }

  async function insforgeIndex() {
    // one row per run: meta jsonb column carries the full index entry
    var url = cfg.baseUrl + "/api/database/records/runs" +
              "?select=meta,run_id&order=run_id.desc&limit=500";
    var r = await fetchOk(url, { headers: authHeaders(), cache: "no-store" });
    var rows = await r.json();
    if (!Array.isArray(rows)) throw new Error("unexpected runs payload");
    var metas = rows
      .map(function (row) {
        var m = row.meta;
        if (typeof m === "string") { try { m = JSON.parse(m); } catch (e) { m = null; } }
        return m;
      })
      .filter(function (m) { return m && typeof m === "object" && m.id; });
    if (metas.length === 0) throw new Error("runs table is empty (run src/insforge_sync.js)");
    return metas;
  }

  async function insforgeIndexFromStorage() {
    // fallback mirror: sync also uploads runs/index.json to the bucket root
    var url = cfg.baseUrl + "/api/storage/buckets/" + encodeURIComponent(cfg.bucket) +
              "/objects/index.json";
    var r = await fetchOk(url, { headers: authHeaders(), cache: "no-store" });
    return r.json();
  }

  var gbData = {
    /* "insforge" when a config is present, else "local"; per-call fallback may
       still serve local data — see lastSource for what actually answered. */
    source: cfg ? "insforge" : "local",
    lastSource: null,
    config: cfg,

    fetchRunIndex: async function () {
      if (cfg) {
        try {
          var metas = await insforgeIndex();
          gbData.lastSource = "insforge";
          return metas;
        } catch (e1) {
          try {
            var metas2 = await insforgeIndexFromStorage();
            gbData.lastSource = "insforge";
            return metas2;
          } catch (e2) { /* fall through to local */ }
        }
      }
      var local = await localIndex();
      gbData.lastSource = "local";
      return local;
    },

    fetchRunText: async function (runId, filename) {
      if (cfg) {
        try {
          var r = await fetchOk(insforgeFileUrl(runId, filename),
                                { headers: authHeaders(), cache: "no-store" });
          gbData.lastSource = "insforge";
          return r.text();
        } catch (e) { /* fall through to local */ }
      }
      var lr = await fetchOk(localFileUrl(runId, filename), { cache: "no-store" });
      gbData.lastSource = "local";
      return lr.text();
    },

    fetchRunJson: async function (runId, filename) {
      var text = await gbData.fetchRunText(runId, filename);
      return JSON.parse(text);
    },

    runFileUrl: function (runId, filename) {
      return cfg ? insforgeFileUrl(runId, filename) : localFileUrl(runId, filename);
    }
  };

  window.gbData = gbData;
})();
