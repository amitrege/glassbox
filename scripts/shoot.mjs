import puppeteer from "puppeteer-core";
const [url, out, sel, w = "1440", h = "900"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h });
await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
if (sel && sel !== "-") {
  await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ behavior: "instant", block: "start" }), sel);
  await new Promise(r => setTimeout(r, 1200));
}
const dbg = await page.evaluate(() => ({
  scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight,
  sections: [...document.querySelectorAll("section.moment")].map(s => ({ id: s.id, top: Math.round(s.getBoundingClientRect().top), h: Math.round(s.getBoundingClientRect().height) })),
  jserr: document.getElementById("jserr")?.textContent || "",
  tiles: document.querySelectorAll("a.tile").length,
}));
console.log(JSON.stringify(dbg));
await page.screenshot({ path: out });
await browser.close();
