# Crypto explainer video: build

Builds a 2:00 vertical video (1080×1920, 30 fps) from `SCRIPT.md`. The scene is
a toon-shaded three.js desk world rendered in headless Chromium. The narration
is an AI voice from Kokoro-82M, an open-source model that runs locally.

## Pipeline

| Step | Command | Output |
|------|---------|--------|
| 1. Install | `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install` | `node_modules/` |
| 2. Voiceover | `NODE_USE_ENV_PROXY=1 node scripts/build-vo.mjs` | `build/vo.wav`, `build/timeline.json` |
| 3. Check and align | `NODE_USE_ENV_PROXY=1 node scripts/asr-check.mjs` | `build/asr.txt`; cue times snapped to the spoken words |
| 4. Preview stills | `node scripts/render.mjs stills 5 30 60` | `build/stills/t_<sec>.jpg` |
| 5. Render | `node scripts/render-all.mjs 3` | `out/trump-crypto-explainer.mp4` |

- **Step 2:** the first run downloads the Kokoro model (about 310 MB) from
  Hugging Face. It needs `huggingface.co` and its CDN hosts to be reachable.
- **Step 3:** this runs Whisper over the audio, one beat at a time, and writes
  what it heard next to the script so you can check it.
- **Step 5:** this renders 3 parallel segments, joins them, adds the voiceover
  and normalizes loudness to −14 LUFS.

## Files

- `scripts/narration.mjs`: the narration in spoken form, with numbers written
  as words. `[cue]` markers name the moments that trigger animations and
  captions. Edit the wording here, then rerun steps 2, 3 and 5.
- `src/scene.js`: the set, the ten stations, the camera path, the captions, the
  paper grain and the end slate. Every frame is a pure function of time, so the
  segments can render in parallel.
- `SCRIPT.md`: the narration as written, the shot list and the fact-check
  notes.

## Changing the voice

Set `VOICE=am_michael` (or any other Kokoro voice) when running step 2.
`af_heart` is the default.
