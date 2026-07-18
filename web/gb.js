/* GLASSBOX — shared viewer utilities (no frameworks, no build step) */
"use strict";

/* ---------- misc ---------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function qparam(name) {
  return new URLSearchParams(location.search).get(name);
}

function fmtInt(n) {
  return (n == null || isNaN(n)) ? "–" : Number(n).toLocaleString("en-US");
}

function actionLabel(a) {
  if (a == null) return "observe";
  if (typeof a === "string") return a;
  if (a.type != null && a.x != null && a.y != null) return `${a.type}(${a.x},${a.y})`;
  if (a.type != null) return String(a.type);
  try { return JSON.stringify(a); } catch (e) { return "action"; }
}

/* visible error trap — pages include <div id="jserr"></div> */
window.addEventListener("error", ev => {
  const el = document.getElementById("jserr");
  if (!el) return;
  el.classList.add("on");
  el.textContent = "script error: " + (ev.message || ev.error || "unknown") +
    (ev.filename ? `  (${ev.filename.split("/").pop()}:${ev.lineno})` : "");
});

/* ---------- observation parsing ---------- */
/* Char mode (famous track): rows joined by "/", one char per cell: # F 0-8 * !
   Token mode (PuzzleScript): cells are name tokens joined by "|" within rows.
   Tolerant: any row containing "|" or characters outside the char alphabet
   switches that board to token mode. */

const CHAR_ALPHABET = /^[#F0-8*!.\s]+$/;

function parseObs(obs) {
  if (obs == null) return null;
  if (Array.isArray(obs)) {
    // already a grid (e.g. from model.observe): rows of arrays or strings
    return {
      rows: obs.map(r => Array.isArray(r) ? r.map(String) : String(r).split("")),
      mode: "char",
    };
  }
  const raw = String(obs).split("/");
  if (raw.length && raw.every(r => /^\d+(,\d+)*$/.test(r))) {
    return { rows: raw.map(r => r.split(",")), mode: "num" };
  }
  const tokenMode = raw.some(r => r.includes("|") || (r.length > 1 && !CHAR_ALPHABET.test(r)));
  return {
    rows: raw.map(r => tokenMode ? r.split("|") : r.split("")),
    mode: tokenMode ? "token" : "char",
  };
}

/* ---------- board rendering ---------- */

const MS_PAL = {
  hidden: "#b4bbc4",
  hiddenLight: "#e9edf2",
  hiddenDark: "#737b86",
  revealed: "#9fa6b0",
  gridLine: "#828994",
  boom: "#d92b23",
  flag: "#d61f1f",
  mine: "#14161a",
  digits: {
    "1": "#1f45d8", "2": "#177f17", "3": "#d61f1f", "4": "#131e8c",
    "5": "#8c1616", "6": "#127f7f", "7": "#1c1f24", "8": "#5a5f66",
  },
};

function tokenColor(tok) {
  let h = 5381;
  for (let i = 0; i < tok.length; i++) h = ((h << 5) + h + tok.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const sat = 38 + (h >> 9) % 22;      // 38–59
  const lit = 26 + (h >> 13) % 12;     // 26–37
  return { bg: `hsl(${hue},${sat}%,${lit}%)`, fg: `hsl(${hue},30%,82%)` };
}

function tokenAbbrev(tok) {
  const parts = String(tok).split("+").filter(Boolean);
  if (parts.length > 1) return parts.map(p => p[0]).join("").slice(0, 3).toUpperCase();
  const p = parts[0] || "?";
  return p.length <= 2 ? p : p.slice(0, 2);
}

function drawCharCell(ctx, px, py, s, ch) {
  const P = MS_PAL;
  const bev = Math.max(2, Math.round(s * 0.11));
  const cx = px + s / 2, cy = py + s / 2;

  const raised = () => {
    ctx.fillStyle = P.hidden;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = P.hiddenLight;
    ctx.fillRect(px, py, s, bev);
    ctx.fillRect(px, py, bev, s);
    ctx.fillStyle = P.hiddenDark;
    ctx.fillRect(px, py + s - bev, s, bev);
    ctx.fillRect(px + s - bev, py, bev, s);
    // corner miters
    ctx.fillStyle = P.hidden;
    ctx.beginPath(); ctx.moveTo(px + s - bev, py); ctx.lineTo(px + s, py); ctx.lineTo(px + s - bev, py + bev); ctx.fill();
    ctx.beginPath(); ctx.moveTo(px, py + s - bev); ctx.lineTo(px, py + s); ctx.lineTo(px + bev, py + s - bev); ctx.fill();
  };
  const flat = (bg) => {
    ctx.fillStyle = bg;
    ctx.fillRect(px, py, s, s);
    ctx.strokeStyle = P.gridLine;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  };
  const mine = () => {
    const r = s * 0.26;
    ctx.strokeStyle = P.mine;
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    for (let k = 0; k < 4; k++) {
      const ang = k * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * r * 1.45, cy - Math.sin(ang) * r * 1.45);
      ctx.lineTo(cx + Math.cos(ang) * r * 1.45, cy + Math.sin(ang) * r * 1.45);
      ctx.stroke();
    }
    ctx.fillStyle = P.mine;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(cx - r * 0.45, cy - r * 0.5, Math.max(1.5, s * 0.09), Math.max(1.5, s * 0.09));
  };

  if (ch === "#") { raised(); return; }
  if (ch === "F") {
    raised();
    const poleW = Math.max(1.5, s * 0.06);
    ctx.fillStyle = "#23262b";
    ctx.fillRect(cx - poleW / 2 + s * 0.06, py + s * 0.2, poleW, s * 0.5);        // pole
    ctx.fillRect(px + s * 0.28, py + s * 0.68, s * 0.44, Math.max(2, s * 0.09)); // base
    ctx.fillStyle = P.flag;                                                       // pennant
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.09, py + s * 0.18);
    ctx.lineTo(cx + s * 0.09, py + s * 0.46);
    ctx.lineTo(cx - s * 0.26, py + s * 0.32);
    ctx.closePath(); ctx.fill();
    return;
  }
  if (ch === "!") { flat(P.boom); mine(); return; }
  if (ch === "*") { flat(P.revealed); mine(); return; }
  if (ch >= "0" && ch <= "8") {
    flat(P.revealed);
    if (ch !== "0") {
      ctx.fillStyle = P.digits[ch] || "#1c1f24";
      ctx.font = `700 ${Math.round(s * 0.6)}px ${'ui-monospace, "SF Mono", Menlo, monospace'}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, cx, cy + s * 0.04);
    }
    return;
  }
  // unknown char — dark cell with the raw glyph, never crash
  flat("#2a2f3a");
  ctx.fillStyle = "#8b949e";
  ctx.font = `${Math.round(s * 0.5)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(ch).slice(0, 1), cx, cy);
}

const NUM_SHADES = ["#171b22","#20262f","#28303c","#5b4623","#6d4f22","#7d4a28","#8a3f2a","#7a6a2c","#8a7a26","#96812b","#a08a2f","#a8922f"];
function drawNumCell(ctx, px, py, s, val) {
  const v = Number(val) || 0;
  const shade = v === 0 ? NUM_SHADES[0] : NUM_SHADES[Math.min(NUM_SHADES.length - 1, Math.round(Math.log2(v)))];
  ctx.fillStyle = shade;
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = "#232833"; ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  if (v !== 0) {
    ctx.fillStyle = "#e6edf3";
    const fs = String(v).length >= 4 ? 0.30 : String(v).length === 3 ? 0.36 : 0.44;
    ctx.font = `700 ${Math.round(s * fs)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(v), px + s / 2, py + s / 2 + 1);
  }
}

function drawTokenCell(ctx, px, py, s, tok) {
  const t = String(tok);
  if (t === "" || t === "." || t.toLowerCase() === "background" || t.toLowerCase() === "empty") {
    ctx.fillStyle = "#171b22";
    ctx.fillRect(px, py, s, s);
    ctx.strokeStyle = "#232833"; ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    return;
  }
  const c = tokenColor(t);
  ctx.fillStyle = c.bg;
  ctx.fillRect(px, py, s, s);
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  ctx.fillStyle = c.fg;
  ctx.font = `600 ${Math.round(s * 0.34)}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tokenAbbrev(t), px + s / 2, py + s / 2 + 1);
}

/* Renders obs onto canvas; sizes canvas to fit opts.maxW/maxH (CSS px).
   Returns {cell, w, h} or null. */
function drawBoard(canvas, obs, opts = {}) {
  const parsed = parseObs(obs);
  if (!parsed || !parsed.rows.length) return null;
  const rows = parsed.rows;
  const h = rows.length;
  const w = Math.max(1, ...rows.map(r => r.length));

  let cell;
  if (opts.cell) {
    cell = opts.cell;
  } else {
    const maxW = opts.maxW || (canvas.parentElement ? canvas.parentElement.clientWidth - 20 : 400);
    const maxH = opts.maxH || 400;
    cell = Math.floor(Math.min(maxW / w, maxH / h));
  }
  cell = Math.max(opts.minCell || 10, Math.min(cell, opts.maxCell || 56));

  const cssW = w * cell, cssH = h * cell;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (parsed.mode === "char") drawCharCell(ctx, x * cell, y * cell, cell, rows[y][x]);
      else if (parsed.mode === "num") drawNumCell(ctx, x * cell, y * cell, cell, rows[y][x]);
      else drawTokenCell(ctx, x * cell, y * cell, cell, rows[y][x]);
    }
  }
  updateBoardLegend(canvas, parsed, cssW);
  return { cell, w, h, mode: parsed.mode };
}

/* Auto-generated legend for token boards: one chip per distinct token in the
   current frame (swatch in the cell's color + abbreviated label + full name).
   Char boards (minesweeper) need no legend — any stale legend is removed. */
function isBgToken(t) {
  const l = String(t).toLowerCase();
  return t === "" || t === "." || l === "background" || l === "empty";
}

function updateBoardLegend(canvas, parsed, cssW) {
  const parent = canvas.parentElement;
  if (!parent) return;
  let el = parent.querySelector(".boardlegend");
  if (!parsed || parsed.mode !== "token") {
    if (el) el.remove();
    return;
  }
  const seen = [], have = new Set();
  for (const row of parsed.rows) {
    for (const tok of row) {
      const t = String(tok);
      if (!have.has(t)) { have.add(t); seen.push(t); }
    }
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "boardlegend";
    parent.appendChild(el);
  }
  const key = seen.join("") + "" + cssW;
  if (el.dataset.k === key) return;             // unchanged frame vocabulary
  el.dataset.k = key;
  el.style.width = cssW + "px";
  el.innerHTML = seen.map(t => {
    if (isBgToken(t)) {
      return `<span class="lg"><span class="sw" style="background:#171b22;color:#3d434d;border-color:#232833">·</span><span class="nm">background</span></span>`;
    }
    const c = tokenColor(t);
    return `<span class="lg"><span class="sw" style="background:${c.bg};color:${c.fg}">${esc(tokenAbbrev(t))}</span><span class="nm">${esc(t)}</span></span>`;
  }).join("");
}

/* ---------- minimal, muted JS syntax highlight (line-based) ---------- */

const GB_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|this|typeof|in|of|null|true|false|undefined|class)\b/g;

function highlightLine(line) {
  // split out comments and strings first, then keyword-tint the rest
  const re = /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  let out = "", last = 0, m;
  const plain = (txt) =>
    esc(txt).replace(GB_KEYWORDS, '<span class="kw">$1</span>')
            .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="num">$1</span>');
  while ((m = re.exec(line)) !== null) {
    out += plain(line.slice(last, m.index));
    const cls = m[0].startsWith("//") ? "cm" : "str";
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  out += plain(line.slice(last));
  return out;
}
