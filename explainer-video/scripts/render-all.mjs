// Renders the whole video in parallel segments, then muxes the voiceover.
//   node scripts/render-all.mjs [workers]
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
const ROOT = new URL("..", import.meta.url).pathname;
const N = Number(process.argv[2] || 3), TOTAL = 3600;
fs.mkdirSync(ROOT + "out", { recursive: true });
const run = (args) => new Promise((res, rej) => { const p = spawn("node", args, { cwd: ROOT, stdio: "inherit" }); p.on("close", (c) => (c ? rej(new Error("worker failed " + c)) : res())); });
const segs = [...Array(N)].map((_, i) => ({ from: Math.round((TOTAL * i) / N), to: Math.round((TOTAL * (i + 1)) / N), file: `build/seg_${i}.mp4` }));
const t0 = Date.now();
await Promise.all(segs.map((s) => run(["scripts/render.mjs", "video", s.from, s.to, s.file])));
fs.writeFileSync(ROOT + "build/segs.txt", segs.map((s) => `file '${ROOT}${s.file}'`).join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "build/segs.txt", "-i", "build/vo.wav",
  "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,apad", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
  "-t", "120", "-movflags", "+faststart", "out/trump-crypto-explainer.mp4"], { cwd: ROOT, stdio: "inherit" });
console.log(`ALL DONE in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
