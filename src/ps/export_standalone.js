// Build a single-file playable HTML of a learned PuzzleScript game using the
// vanilla engine's own standalone template (same mechanism as the editor's export).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../../../research/PuzzleScript/src/standalone_inlined.txt");

export function exportStandalone(gameSource, outPath) {
  let html = fs.readFileSync(TEMPLATE, "utf8");
  const title = (gameSource.match(/^title (.*)$/m)?.[1] || "Learned Game").trim();
  html = html.replace(/___BGCOLOR___/g, "black");
  html = html.replace(/___TEXTCOLOR___/g, "lightblue");
  html = html.replace(/__GAMETITLE__/g, title.replace(/[<>&"]/g, ""));
  html = html.replace(/__HOMEPAGE_STRIPPED_PROTOCOL__/g, "www.puzzlescript.net");
  html = html.replace(/__HOMEPAGE__/g, "https://www.puzzlescript.net");
  const lit = JSON.stringify(gameSource).replace(/\$/g, "$$$$");
  html = html.replace(/"__GAMEDAT__"/g, lit);
  // GLASSBOX banner: brand the artifact and route visitors back to the viewer.
  const banner = `
<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#0c0e12;color:#c9d1d9;border-bottom:1px solid #2a2f3a;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px 14px;display:flex;gap:14px;align-items:center">
  <a href="../../web/index.html" style="color:#3fb950;text-decoration:none">◼ GLASSBOX</a>
  <span>this game's source was <b style="color:#3fb950">written by an AI</b> that learned the rules by playing — arrows to move, X to act, R to restart</span>
  <a href="../../web/watch.html?run=__RUNID__" style="color:#8b949e;margin-left:auto;text-decoration:underline">watch it being learned</a>
</div>`;
  html = html.replace("<body", "<body style=\"padding-top:48px\"").replace(/(<body[^>]*>)/, `$1${banner}`);
  fs.writeFileSync(outPath, html);
  return outPath;
}

if (process.argv[2]) {
  const runDir = process.argv[2];
  const src = fs.readFileSync(path.join(runDir, "game_learned.txt"), "utf8");
  const out = exportStandalone(src, path.join(runDir, "clone.html"));
  const runId = path.basename(path.resolve(runDir));
  fs.writeFileSync(out, fs.readFileSync(out, "utf8").replace(/__RUNID__/g, runId));
  console.log(out);
}
