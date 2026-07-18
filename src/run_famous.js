import { runMinesweeper } from "./agent.js";
const variant = process.argv[2] || "classic";
const cfg = variant === "twisted"
  ? { label: "minesweeper_twisted", neighborhood: "knight", torus: true, lite: true, title: "Definitely Not Minesweeper" }
  : variant === "knight"
  ? { label: "minesweeper_knight", neighborhood: "knight", title: "Minesweeper\u2026 or is it?" }
  : { label: "minesweeper", neighborhood: "n8", title: "Minesweeper" };
const res = await runMinesweeper(cfg);
console.log(JSON.stringify(res));
process.exit(0);
