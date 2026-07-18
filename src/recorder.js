// Append-only run recorder. Every probe, hypothesis, verdict and narration goes to
// runs/<id>/events.jsonl — the viewer replays this file to show the whole learning run.
import fs from "node:fs";
import path from "node:path";

export class Recorder {
  constructor(runsDir, id, meta) {
    this.id = id;
    this.dir = path.join(runsDir, id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.file = path.join(this.dir, "events.jsonl");
    this.seq = 0;
    this.meta = { id, startedAt: new Date().toISOString(), ...meta };
    fs.writeFileSync(path.join(this.dir, "meta.json"), JSON.stringify(this.meta, null, 2));
    this.event("run_meta", this.meta);
  }
  event(type, data = {}) {
    const e = { seq: this.seq++, t: Date.now(), type, ...data };
    fs.appendFileSync(this.file, JSON.stringify(e) + "\n");
    return e;
  }
  saveFile(name, content) {
    fs.writeFileSync(path.join(this.dir, name), content);
  }
  finalize(extra = {}) {
    this.meta = { ...this.meta, finishedAt: new Date().toISOString(), ...extra };
    fs.writeFileSync(path.join(this.dir, "meta.json"), JSON.stringify(this.meta, null, 2));
    this.event("run_end", extra);
  }
}

// Maintain runs/index.json for the gallery.
export function updateIndex(runsDir) {
  const entries = [];
  for (const id of fs.readdirSync(runsDir)) {
    const metaPath = path.join(runsDir, id, "meta.json");
    if (fs.existsSync(metaPath)) {
      try { entries.push(JSON.parse(fs.readFileSync(metaPath, "utf8"))); } catch {}
    }
  }
  entries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  fs.writeFileSync(path.join(runsDir, "index.json"), JSON.stringify(entries, null, 2));
  return entries;
}
