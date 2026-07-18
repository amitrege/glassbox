import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPS } from "./ps/psagent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const game = process.argv[2] || "sokoban_basic";
const gameFile = path.resolve(__dirname, "../../research/PuzzleScript/src/demo", `${game}.txt`);
const res = await runPS({ gameFile, label: game, title: "Sokoban (learned from play)" });
console.log(JSON.stringify(res));
process.exit(0);
