import { run2048 } from "./agent2048.js";
const res = await run2048();
console.log(JSON.stringify(res));
process.exit(0);
