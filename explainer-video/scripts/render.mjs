// Renders frames of src/index.html in headless Chromium.
//   node scripts/render.mjs stills 0.5 12 40          -> build/stills/t_<sec>.jpg
//   node scripts/render.mjs video <from> <to> <out>   -> H.264 segment (no audio)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/src/index.html`;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(url);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const grab = async (f) => Buffer.from((await page.evaluate((i) => window.renderFrame(i), f)).split(",")[1], "base64");

const [mode, ...args] = process.argv.slice(2);
if (mode === "stills") {
  fs.mkdirSync(path.join(ROOT, "build/stills"), { recursive: true });
  for (const s of args) {
    const t0 = Date.now(); const buf = await grab(Math.round(Number(s) * 30));
    fs.writeFileSync(path.join(ROOT, `build/stills/t_${s}.jpg`), buf);
    console.log(`t=${s}s rendered in ${Date.now() - t0} ms`);
  }
} else if (mode === "video") {
  const total = await page.evaluate(() => window.TOTAL_FRAMES);
  const from = Number(args[0]), to = Math.min(Number(args[1]), total), out = args[2];
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "30", "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "30", out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const buf = await grab(f);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - from) % 150 === 0) console.log(`[${out}] frame ${f}/${to} (${((Date.now() - t0) / 1000 / Math.max(1, f - from)).toFixed(2)} s/frame)`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
  console.log(`[${out}] done in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
await browser.close(); server.close();
