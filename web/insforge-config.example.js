/* GLASSBOX — optional InsForge backend config (browser side)
 *
 * SETUP (one time):
 *   1. Create a project at https://insforge.dev (or self-host — see README-INSFORGE.md).
 *   2. Copy this file to web/insforge-config.js   (that filename is .gitignored).
 *   3. Fill in your project's base URL and PUBLIC anon key below.
 *      The anon key is the non-secret client identifier ("anon" role) —
 *      docs: https://docs.insforge.dev/api-reference/admin/get-anon-key
 *      NEVER put the admin API key in this file; that one stays in .env.insforge.
 *   4. Pages that include insforge-config.js + datasource.js will then read runs
 *      from InsForge, and web/submit.html will accept game submissions.
 *
 * If web/insforge-config.js does not exist, everything keeps working from the
 * local ../runs/ files. Delete the file (or this window.INSFORGE assignment)
 * to switch back at any time.
 */
window.INSFORGE = {
  // Your InsForge project URL, e.g. "https://your-app.insforge.app"
  // (or "http://localhost:7130" for a self-hosted instance)
  baseUrl: "https://YOUR-APP.insforge.app",

  // Public anon key (safe to ship to browsers)
  anonKey: "PASTE-ANON-KEY-HERE",

  // Storage bucket that src/insforge_sync.js fills with run artifacts
  bucket: "glassbox-runs"
};
