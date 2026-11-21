import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
env.cacheDir = new URL("../models/", import.meta.url).pathname;
const t0 = Date.now();
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "fp32", device: "cpu" });
console.log("loaded in", (Date.now()-t0)/1000, "s");
const text = "How do you make two point three billion dollars in crypto while you're president? Reuters followed the money.";
for (const voice of ["af_heart", "am_michael"]) {
  const t1 = Date.now();
  const audio = await tts.generate(text, { voice });
  await audio.save(`build/test_${voice}.wav`);
  console.log(voice, "dur", (audio.audio.length/audio.sampling_rate).toFixed(2), "s; gen", (Date.now()-t1)/1000, "s");
}
