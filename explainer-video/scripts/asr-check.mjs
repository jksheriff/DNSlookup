// QA + cue refinement. Transcribes build/vo.wav beat by beat with Whisper (word
// timestamps), writes build/asr.txt for review, and snaps each cue in
// timeline.json to the start of the matching spoken word near its estimate.
import { pipeline, env } from "@huggingface/transformers";
import fs from "node:fs";
import { BEATS } from "./narration.mjs";

env.cacheDir = new URL("../models/", import.meta.url).pathname;
const B = new URL("../build/", import.meta.url).pathname;

const wav = fs.readFileSync(B + "vo.wav");
const sr = wav.readUInt32LE(24), n = (wav.length - 44) / 2;
const src = new Float32Array(n);
for (let i = 0; i < n; i++) src[i] = wav.readInt16LE(44 + i * 2) / 32768;
const resample = (a, b) => {
  const s = src.subarray(Math.max(0, Math.floor(a * sr)), Math.min(n, Math.ceil(b * sr)));
  const r = sr / 16000, o = new Float32Array(Math.floor(s.length / r));
  for (let i = 0; i < o.length; i++) { const x = i * r, k = Math.floor(x), f = x - k; o[i] = s[k] * (1 - f) + (s[k + 1] ?? 0) * f; }
  return o;
};

const tl = JSON.parse(fs.readFileSync(B + "timeline.json", "utf8"));
const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small.en_timestamped", { dtype: "fp32" });
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
let report = "", snapped = 0, kept = [];

for (const [bi, beat] of BEATS.entries()) {
  const { start, end } = tl.beats[bi];
  const a = Math.max(0, start - 0.15);
  const res = await asr(resample(a, end + 0.25), { return_timestamps: "word" });
  const words = res.chunks.map((c) => ({ w: c.text.trim(), t0: a + c.timestamp[0] }));
  report += `BEAT ${bi + 1}\n  script: ${beat.join(" ").replace(/\[[a-z]+\]/g, "")}\n  heard:  ${res.text.trim()}\n\n`;
  for (const s of beat)
    for (const m of s.matchAll(/\[([a-z]+)\]([A-Za-z0-9'-]+)/g)) {
      const key = `${bi + 1}.${m[1]}`, est = tl.cues[key], target = norm(m[2]);
      const c = words.filter((w) => Math.abs(w.t0 - est) < 1.5 && norm(w.w).length > 0 &&
        (norm(w.w).startsWith(target.slice(0, 3)) || target.startsWith(norm(w.w).slice(0, 3)) || /^\d/.test(norm(w.w)) && /^(two|six|seven|nine|five|one|twenty)/.test(target)));
      if (c.length) { tl.cues[key] = +c.reduce((x, y) => (Math.abs(x.t0 - est) <= Math.abs(y.t0 - est) ? x : y)).t0.toFixed(3); snapped++; }
      else kept.push(key);
    }
}
fs.writeFileSync(B + "asr.txt", report);
fs.writeFileSync(B + "timeline.json", JSON.stringify(tl, null, 1));
console.log(report);
console.log(`cues snapped: ${snapped}; kept estimate: ${kept.join(", ") || "none"}`);
