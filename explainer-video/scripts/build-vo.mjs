// Synthesizes the narration with Kokoro-82M (local ONNX) and writes:
//   build/vo.wav        full voiceover, 24 kHz mono 16-bit
//   build/timeline.json beat/sentence times and named cue times for the renderer
// Text is written in spoken form (numbers as words). [cue] markers set event times.
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
import fs from "node:fs";
import { BEATS } from "./narration.mjs";

env.cacheDir = new URL("../models/", import.meta.url).pathname;
const OUT = new URL("../build/", import.meta.url).pathname;
const VOICE = process.env.VOICE || "af_heart";
const TARGET_SPEECH_END = Number(process.env.TARGET_END || 116.5); // seconds; leaves room for the end slate
const LEAD_IN = 0.35, SENT_GAP = 0.2, BEAT_GAP = 0.5;



function parse(s) {
  const cues = []; let text = "";
  for (const part of s.split(/(\[[a-z]+\])/)) {
    const m = part.match(/^\[([a-z]+)\]$/);
    if (m) cues.push({ name: m[1], at: text.length }); else text += part;
  }
  return { text, cues };
}
// Weight of the text before a char index, as a proxy for elapsed speech time.
function weight(str) {
  let w = 0;
  for (const ch of str) w += /[a-z0-9']/i.test(ch) ? 1 : /[,:;]/.test(ch) ? 4 : /[.?!]/.test(ch) ? 3 : ch === " " ? 0.6 : 0.3;
  return w;
}
function trim(samples, sr) {
  const thr = 0.008, pad = Math.round(0.03 * sr);
  let a = 0, b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < thr) a++;
  while (b > a && Math.abs(samples[b]) < thr) b--;
  return samples.subarray(Math.max(0, a - pad), Math.min(samples.length, b + pad));
}

const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });

async function synth(speed) {
  const clips = []; let sr = 24000;
  for (const [bi, beat] of BEATS.entries())
    for (const [si, s] of beat.entries()) {
      const { text, cues } = parse(s);
      const audio = await tts.generate(text, { voice: VOICE, speed });
      sr = audio.sampling_rate;
      clips.push({ bi, si, text, cues, samples: trim(audio.audio, sr) });
    }
  return { clips, sr };
}
function layout(clips, sr) {
  let t = LEAD_IN; const out = [];
  for (const c of clips) {
    if (out.length) t += c.si === 0 ? BEAT_GAP : SENT_GAP;
    const dur = c.samples.length / sr;
    out.push({ ...c, start: t, dur }); t += dur;
  }
  return { items: out, end: t };
}

let speed = 1.0;
let { clips, sr } = await synth(speed);
let { items, end } = layout(clips, sr);
console.log(`speed ${speed}: speech ends at ${end.toFixed(2)}s`);
const gaps = LEAD_IN + items.reduce((g, c, i) => g + (i ? (c.si === 0 ? BEAT_GAP : SENT_GAP) : 0), 0);
const want = (end - gaps) / (TARGET_SPEECH_END - gaps);
if (Math.abs(want - 1) > 0.02) {
  speed = Math.round(Math.min(1.15, Math.max(0.85, want)) * 100) / 100;
  ({ clips, sr } = await synth(speed));
  ({ items, end } = layout(clips, sr));
  console.log(`speed ${speed}: speech ends at ${end.toFixed(2)}s`);
}

// Assemble audio
const total = new Float32Array(Math.ceil((end + 0.1) * sr));
for (const c of items) total.set(c.samples, Math.round(c.start * sr));
const pcm = Buffer.alloc(total.length * 2);
for (let i = 0; i < total.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(total[i] * 32767))), i * 2);
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sr, 24);
hdr.writeUInt32LE(sr * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "vo.wav", Buffer.concat([hdr, pcm]));

// Timeline: cues are named "<beat>.<name>", e.g. "3.cap"
const beats = BEATS.map((_, bi) => {
  const s = items.filter((c) => c.bi === bi);
  return { start: s[0].start, end: s.at(-1).start + s.at(-1).dur };
});
const cues = {};
for (const c of items) {
  const W = weight(c.text);
  for (const q of c.cues) cues[`${c.bi + 1}.${q.name}`] = +(c.start + (weight(c.text.slice(0, q.at)) / W) * c.dur).toFixed(3);
}
const timeline = {
  voice: VOICE, speed, speechEnd: +end.toFixed(3), beats,
  sentences: items.map((c) => ({ beat: c.bi + 1, text: c.text, start: +c.start.toFixed(3), end: +(c.start + c.dur).toFixed(3) })),
  cues,
};
fs.writeFileSync(OUT + "timeline.json", JSON.stringify(timeline, null, 1));
console.log(beats.map((b, i) => `beat ${i + 1}: ${b.start.toFixed(2)}–${b.end.toFixed(2)}`).join("\n"));
