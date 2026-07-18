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
  fs.writeFileSync(outPath, html);
  return outPath;
}

if (process.argv[2]) {
  const runDir = process.argv[2];
  const src = fs.readFileSync(path.join(runDir, "game_learned.txt"), "utf8");
  console.log(exportStandalone(src, path.join(runDir, "clone.html")));
}
