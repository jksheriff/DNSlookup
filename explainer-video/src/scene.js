// Desk-world explainer: toon-shaded three.js scene, deterministic per frame.
// window.renderFrame(frameIndex) -> JPEG data URL of the composited 1080x1920 frame.
import * as THREE from "three";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const W = 1080, H = 1920, FPS = 30, DURATION = 120;
const TL = await (await fetch("/build/timeline.json")).json();
await Promise.all([document.fonts.load('100px "Archivo Black"'), document.fonts.load('bold 40px "Courier Prime"')]);

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u); return u * u * u * (u * (u * 6 - 15) + 10); };
const outCubic = (u) => 1 - Math.pow(1 - clamp(u), 3);
const inCubic = (u) => Math.pow(clamp(u), 3);
const outBack = (u) => { u = clamp(u); const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const prog = (t, t0, d) => clamp((t - t0) / d);
const C = (k) => { const v = TL.cues[k]; if (v === undefined) throw new Error("missing cue " + k); return v; };
const BT = (i) => TL.beats[i - 1];
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const INK = "#1d1f22";

const GRAD = new THREE.DataTexture(new Uint8Array([105, 185, 255]), 3, 1, THREE.RedFormat);
GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
const matCache = new Map();
function mat(color, map = null, opts = {}) {
  const key = map ? null : color + JSON.stringify(opts);
  if (key && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial({ color, gradientMap: GRAD, map, ...opts });
  if (opts.noOutline) { delete m.noOutline; m.userData.outlineParameters = { visible: false }; }
  if (key) matCache.set(key, m);
  return m;
}
function mesh(geo, m, cast = true, recv = true) { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = recv; return o; }
function rbox(w, h, d, color, r = 0.025) { return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05)), mat(color)); }
function cyl(rt, rb, h, color, seg = 32) { return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color)); }
function group(...kids) { const g = new THREE.Group(); kids.forEach((k) => k && g.add(k)); return g; }
function at(o, x, y, z) { o.position.set(x, y, z); return o; }
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.redraw = (fn) => { fn(g, w, h); t.needsUpdate = true; };
  return t;
}
function wrap(g, text, maxW) {
  const out = []; let line = "";
  for (const word of text.split(" ")) { const tryL = line ? line + " " + word : word; if (g.measureText(tryL).width > maxW && line) { out.push(line); line = word; } else line = tryL; }
  if (line) out.push(line); return out;
}
function fitFont(g, text, family, maxSize, maxW) { let s = maxSize; g.font = `${s}px ${family}`; while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = `${s}px ${family}`; } return s; }
// Thin box with a textured front face, so the ink outline works on flat props.
function plate(tex, w, h, d = 0.014, edge = 0xf4f1ea) {
  const e = mat(edge), f = mat(0xffffff, tex);
  return mesh(new THREE.BoxGeometry(w, h, d), [e, e, e, e, f, e]);
}

// ---------- note cards & tags ----------
const PXU = 700; // canvas px per world unit for notes
function noteTex(kind, lines, w, h) {
  return canvasTex(Math.round(w * PXU), Math.round(h * PXU), (g, cw, ch) => {
    if (kind === "tag") {
      g.fillStyle = "#d9b37c"; g.fillRect(0, 0, cw, ch);
      g.strokeStyle = "#8a6a3c"; g.setLineDash([10, 8]); g.lineWidth = 4; g.strokeRect(14, 14, cw - 28, ch - 28); g.setLineDash([]);
      g.fillStyle = "#f2e6cf"; g.beginPath(); g.arc(40, ch / 2, 16, 0, 7); g.fill(); g.strokeStyle = "#8a6a3c"; g.lineWidth = 5; g.stroke();
      g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "middle";
      const x0 = 78, maxW = cw - x0 - 26;
      g.font = 'bold 30px "Courier Prime"'; g.fillText(lines[0], x0, ch * 0.3);
      const s = fitFont(g, lines[1], '"Archivo Black"', 54, maxW); g.fillText(lines[1], x0, ch * 0.64);
    } else if (kind === "card") {
      g.fillStyle = "#fbfaf5"; g.fillRect(0, 0, cw, ch);
      g.strokeStyle = "#9cc3e6"; g.lineWidth = 2; for (let y = 96; y < ch; y += 44) { g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); }
      g.strokeStyle = "#e88a8a"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 72); g.lineTo(cw, 72); g.stroke();
      g.fillStyle = "#c62f2f"; g.textBaseline = "middle"; g.textAlign = "left";
      fitFont(g, lines[0], '"Archivo Black"', 40, cw - 48); g.fillText(lines[0], 24, 40);
      g.fillStyle = INK; g.font = 'bold 40px "Courier Prime"';
      let y = 122; for (const L of lines.slice(1)) for (const l of wrap(g, L, cw - 48)) { g.fillText(l, 24, y); y += 44; }
    } else if (kind === "sign") {
      const [bg, fg] = lines.colors || ["#2e3a46", "#ffffff"];
      g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
      g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
      const rows = lines.length, lh = ch / rows;
      lines.forEach((L, i) => { const s = fitFont(g, L, '"Archivo Black"', Math.min(lh * 0.62, 120), cw * 0.88); g.fillText(L, cw / 2, lh * (i + 0.53)); });
    }
  });
}
// A note standing in a small wooden holder; pops up at time t0.
const pops = [];
function note(kind, lines, w, h, x, y, z, t0, { holder = true, ry = 0, rx = -0.08, parent = null } = {}) {
  const card = plate(noteTex(kind, lines, w, h), w, h, 0.012, kind === "tag" ? 0xc9a066 : 0xf4f1ea);
  card.position.y = h / 2 + (holder ? 0.035 : 0);
  const g = group(card);
  if (holder) g.add(at(rbox(Math.min(0.22, w * 0.5), 0.05, 0.08, 0x9b6b3d, 0.012), 0, 0.025, 0));
  g.rotation.set(rx, ry, 0); at(g, x, y, z);
  (parent || scene).add(g);
  pops.push({ g, t0, kind });
  return g;
}
function updatePops(t) {
  for (const p of pops) {
    const u = prog(t, p.t0, 0.42);
    const s = u <= 0 ? 0.0001 : outBack(u);
    p.g.scale.setScalar(s); p.g.visible = u > 0;
    p.g.children[0].rotation.z = (1 - outCubic(u)) * 0.25;
  }
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0058, defaultColor: [0.09, 0.09, 0.1], defaultAlpha: 1 });
const scene = new THREE.Scene();
scene.background = new THREE.Color("#a8e2c6");
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
scene.add(new THREE.AmbientLight(0xffffff, 1.15));
const sun = new THREE.DirectionalLight(0xfff6e8, 2.1);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 40 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------- the set ----------
{
  const wall = mesh(new THREE.PlaneGeometry(90, 30), mat("#a8e2c6", null, { noOutline: true }), false, true);
  at(wall, 20, 6, -2.02); scene.add(wall);
  // pegboard panels
  const peg = canvasTex(256, 256, (g) => { g.fillStyle = "#94d4b5"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#5f9f83"; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(32 + i * 64, 32 + j * 64, 7, 0, 7); g.fill(); } });
  peg.wrapS = peg.wrapT = THREE.RepeatWrapping;
  for (const [x0, x1] of [[-3, 8.2], [10.4, 18.2], [19.0, 26.8], [27.6, 35.0], [35.8, 41]]) {
    const w = x1 - x0, t = peg.clone(); t.needsUpdate = true; t.repeat.set(w * 2.2, 4.6 * 2.2);
    const e = mat("#94d4b5"), f = mat(0xffffff, t);
    const p = mesh(new THREE.BoxGeometry(w, 4.6, 0.05), [e, e, e, e, f, e], false, true);
    at(p, (x0 + x1) / 2, 3.45, -1.97); scene.add(p);
  }
  // hooks
  for (const x of [-1.5, 1.7, 3.6, 9.0, 12.6, 21.3, 23.2, 30.0, 31.6, 39.2]) {
    const h = cyl(0.018, 0.018, 0.22, "#6d7782", 8); h.rotation.x = Math.PI / 2; at(h, x, 4.9 + (x % 2) * 0.3, -1.86); scene.add(h);
  }
  // desk
  const tile = canvasTex(256, 256, (g) => { g.fillStyle = "#f7fbff"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#8fc1ea"; g.fillRect(6, 6, 116, 116); g.fillRect(134, 6, 116, 116); g.fillRect(6, 134, 116, 116); g.fillRect(134, 134, 116, 116); g.fillStyle = "#9fcbef"; g.fillRect(14, 14, 40, 10); g.fillRect(142, 142, 40, 10); });
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set(48 / 0.5, 4 / 0.5);
  const dside = mat("#7fb2dc"), dtop = mat(0xffffff, tile);
  const desk = mesh(new THREE.BoxGeometry(48, 0.3, 4), [dside, dside, dtop, dside, dside, dside], false, true);
  at(desk, 20, -0.15, 0); scene.add(desk);
  const woodTex = canvasTex(512, 64, (g) => { g.fillStyle = "#c98b54"; g.fillRect(0, 0, 512, 64); g.strokeStyle = "#b47a46"; g.lineWidth = 3; for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(0, 8 + i * 6); g.bezierCurveTo(170, 4 + i * 7, 340, 12 + i * 5, 512, 6 + i * 7); g.stroke(); } });
  woodTex.wrapS = THREE.RepeatWrapping; woodTex.repeat.set(30, 1);
  const edge = mesh(new RoundedBoxGeometry(48, 0.34, 0.26, 3, 0.1), mat(0xffffff, woodTex), true, true);
  at(edge, 20, -0.12, 2.06); scene.add(edge);
  for (const x of [-3.2, 8.5, 18.6, 27.2, 35.4, 43.5]) { const l = rbox(0.32, 4.3, 0.32, "#b87d4b", 0.06); at(l, x, -2.4, 1.6); scene.add(l); }
  // floor
  const plank = canvasTex(512, 512, (g) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#ead2a8" : "#e4c99b"; g.fillRect(0, i * 64, 512, 64); g.fillStyle = "#cfb084"; g.fillRect(0, i * 64, 512, 3); g.fillRect(((i * 197) % 512), i * 64, 3, 64); } });
  plank.wrapS = plank.wrapT = THREE.RepeatWrapping; plank.repeat.set(30, 8);
  const floor = mesh(new THREE.PlaneGeometry(90, 24), mat(0xffffff, plank, { noOutline: true }), false, true);
  floor.rotation.x = -Math.PI / 2; at(floor, 20, -4.55, 8); scene.add(floor);
}

// ---------- coins ----------
function coinFace(bg, ring, text, fg) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = ring; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 106, 0, 7); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 88, 0, 7); g.stroke();
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    fitFont(g, text, '"Archivo Black"', 64, 150); g.save(); g.translate(128, 128); g.rotate(-Math.PI / 2); g.fillText(text, 0, 4); g.restore();
  });
}
const COIN = {
  trump: { side: "#d9a032", face: coinFace("#f4c64f", "#c48a1c", "$TRUMP", "#9a6a0c") },
  usd1: { side: "#93c9a1", face: coinFace("#c6ecd0", "#4f9b68", "USD1", "#2c6e45") },
  wlfi: { side: "#2f57b0", face: coinFace("#4277db", "#dfe6ee", "WLFI", "#ffffff") },
};
const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.055, 40);
const coinMats = (k) => [mat(COIN[k].side), mat(0xffffff, COIN[k].face), mat(0xffffff, COIN[k].face)];
function coin(kind = "trump", r = 0.2) { const m = mesh(coinGeo, coinMats(kind)); m.scale.set(r / 0.2, 1 * (r / 0.2) ** 0.5, r / 0.2); return m; }

// A pile of coin towers that grows coin by coin between t0 and t1.
function coinPile(cx, cz, towers, t0, t1, { pre = 0, kind = "trump", scatter = 8 } = {}) {
  const list = [];
  towers.forEach(([dx, dz, n]) => { for (let i = 0; i < n; i++) list.push({ x: cx + dx + (rnd() - 0.5) * 0.025, z: cz + dz + (rnd() - 0.5) * 0.025, y: 0.0275 + i * 0.055, ry: rnd() * 6, tilt: 0, lvl: i }); });
  for (let i = 0; i < scatter; i++) { const a = rnd() * 6.28, r = 0.45 + rnd() * 0.35; list.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r * 0.7, y: 0.03, ry: rnd() * 6, tilt: (rnd() - 0.5) * 0.25, lvl: 0 }); }
  list.sort((a, b) => a.lvl - b.lvl || rnd() - 0.5);
  const N = list.length, pn = Math.floor(N * pre);
  list.forEach((c, i) => { c.ts = i < pn ? -99 : t0 + (t1 - t0) * Math.pow((i - pn) / Math.max(1, N - pn), 0.75); });
  const im = new THREE.InstancedMesh(coinGeo, coinMats(kind), N); im.castShadow = im.receiveShadow = true;
  im.frustumCulled = false; scene.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  return {
    im, list,
    update(t) {
      list.forEach((c, i) => {
        const u = prog(t, c.ts, 0.24);
        if (u <= 0) s.set(0, 0, 0); else s.set(1, 1, 1);
        const fall = 1.4 * (1 - u * u) + (u >= 1 ? 0 : 0) + Math.max(0, Math.sin(prog(t, c.ts + 0.24, 0.12) * Math.PI)) * 0.025;
        p.set(c.x, c.y + fall, c.z); e.set(c.tilt, c.ry + (1 - u) * 2, c.tilt * 0.5); q.setFromEuler(e);
        m4.compose(p, q, s); im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    },
  };
}
const updaters = [];

// ===== Station 1 · hook pile (x=0) =====
const pile1 = coinPile(0, 0.15, [[0, 0, 22], [-0.42, 0.05, 15], [0.42, 0.02, 18], [-0.2, 0.42, 9], [0.24, 0.42, 11], [-0.62, 0.42, 5], [0.62, 0.4, 7], [0.02, -0.38, 17], [-0.4, -0.36, 12], [0.44, -0.34, 10]], 0.15, BT(1).end - 0.3, { scatter: 10 });
updaters.push((t) => pile1.update(t));
note("tag", ["SOURCE:", "REUTERS"], 0.62, 0.26, 0.55, 0.0, 0.95, C("1.reuters"), { ry: -0.15 });

// ===== Station 2 · calendar, coin press, easel (x≈4.2–6.2) =====
const calFace = (lines) => canvasTex(512, 512, (g) => {
  g.fillStyle = "#fffdf7"; g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#d64545"; g.fillRect(0, 0, 512, 120);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; fitFont(g, lines.head, '"Archivo Black"', 64, 470); g.fillText(lines.head, 256, 62);
  g.fillStyle = INK; g.font = 'bold 34px "Courier Prime"';
  for (let d = 1; d <= 31; d++) { const c = (d + lines.off - 1) % 7, r = Math.floor((d + lines.off - 1) / 7); g.fillText(String(d), 44 + c * 70, 160 + r * 58); }
  if (lines.circle) { const d = lines.circle, c = (d + lines.off - 1) % 7, r = Math.floor((d + lines.off - 1) / 7); g.strokeStyle = "#d64545"; g.lineWidth = 7; g.beginPath(); g.ellipse(44 + c * 70, 160 + r * 58, 34, 27, -0.15, 0, 7); g.stroke(); g.fillStyle = "#d64545"; fitFont(g, "INAUGURATION", '"Archivo Black"', 44, 470); g.fillText("INAUGURATION", 256, 482); }
});
const calendar = new THREE.Group(); at(calendar, 4.15, 0, 0.55); scene.add(calendar);
{
  const back = rbox(0.98, 1.0, 0.05, "#3a4651", 0.02); at(back, 0, 0.52, -0.06); calendar.add(back);
  const rings = cyl(0.022, 0.022, 0.86, "#aeb7c0", 8); rings.rotation.z = Math.PI / 2; at(rings, 0, 1.02, 0.0); calendar.add(rings);
  const jan = plate(calFace({ head: "JANUARY 2025", off: 3, circle: 20 }), 0.9, 0.9, 0.01, 0xfffdf7); at(jan, 0, 0.53, -0.025); calendar.add(jan);
  const pivot = new THREE.Group(); at(pivot, 0, 0.99, 0.0); calendar.add(pivot);
  const dec = plate(calFace({ head: "DECEMBER 2024", off: 0 }), 0.9, 0.9, 0.01, 0xfffdf7); at(dec, 0, -0.46, 0.0); pivot.add(dec);
  calendar.rotation.x = -0.18; calendar.rotation.y = 0.12;
  updaters.push((t) => { const a = smooth(prog(t, C("2.calendar") - 0.1, 0.6)) * Math.PI * 1.5; pivot.rotation.x = -a; dec.visible = a < Math.PI * 1.25; });
}
const press = new THREE.Group(); at(press, 5.35, 0, 0.15); scene.add(press);
let ram, bigCoin;
{
  press.add(at(rbox(0.8, 0.14, 0.55, "#56626e"), 0, 0.07, 0));
  for (const x of [-0.32, 0.32]) press.add(at(cyl(0.035, 0.035, 1.05, "#8a96a3", 12), x, 0.6, -0.1));
  press.add(at(rbox(0.8, 0.14, 0.24, "#56626e"), 0, 1.14, -0.1));
  ram = group(at(cyl(0.05, 0.05, 0.5, "#aab4bf", 12), 0, 0.25, 0), at(cyl(0.2, 0.2, 0.1, "#3e4852"), 0, 0, 0));
  at(ram, 0, 0.62, -0.1); press.add(ram);
  bigCoin = coin("trump", 0.34); scene.add(bigCoin);
  updaters.push((t) => {
    const tp = C("2.press");
    const down = smooth(prog(t, tp - 0.25, 0.18)) - smooth(prog(t, tp + 0.08, 0.3));
    ram.position.y = 0.62 - down * 0.37;
    const u = prog(t, tp + 0.12, 0.5), v = smooth(prog(t, tp + 0.4, 1.0));
    bigCoin.visible = u > 0; const sc = Math.max(0.001, outBack(u));
    bigCoin.scale.set(sc * 1.7, sc * 1.3, sc * 1.7);
    // pops out of the press, stands up to face the camera, glides forward
    bigCoin.position.set(5.35 + v * 0.05, 0.2 + v * 0.42 + Math.sin(t * 2.4) * 0.02 * v, 0.05 + v * 0.95);
    bigCoin.rotation.set(v * Math.PI / 2, 0, Math.sin(t * 1.6) * 0.06 * v);
  });
}
// easel chart: rises at "soars", crashes at "ninety-seven percent"
const chartTex = canvasTex(640, 480, () => {});
let chartKey = "";
function drawChart(rise, crash) {
  const key = rise.toFixed(3) + crash.toFixed(3); if (key === chartKey) return; chartKey = key;
  chartTex.redraw((g, w, h) => {
    g.fillStyle = "#fffdf7"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c9d3dc"; g.lineWidth = 2; for (let y = 120; y < h - 40; y += 70) { g.beginPath(); g.moveTo(50, y); g.lineTo(w - 30, y); g.stroke(); }
    g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.moveTo(50, 70); g.lineTo(50, h - 50); g.lineTo(w - 30, h - 50); g.stroke();
    g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "middle"; g.font = '40px "Archivo Black"'; g.fillText("$TRUMP", 74, 52);
    const pts = []; const N = 40;
    for (let i = 0; i <= N; i++) { const x = i / N; const y = x < 0.25 ? 0.05 + x * 0.1 : 0.075 + Math.pow((x - 0.25) / 0.75, 2.2) * 0.85 + Math.sin(i * 1.7) * 0.015; pts.push([x, y]); }
    const shown = Math.floor(rise * N);
    const X = (x) => 60 + x * (w - 230), Y = (y) => h - 60 - y * (h - 150);
    g.lineJoin = "round"; g.lineCap = "round";
    if (shown > 0) {
      g.strokeStyle = "#1e9e5a"; g.lineWidth = 10; g.beginPath();
      for (let i = 0; i <= shown; i++) i ? g.lineTo(X(pts[i][0]), Y(pts[i][1])) : g.moveTo(X(pts[i][0]), Y(pts[i][1]));
      g.stroke();
    }
    if (rise >= 1) {
      const px = X(1), py = Y(pts[N][1]);
      g.fillStyle = "#1e9e5a"; g.font = '30px "Archivo Black"'; g.fillText("PEAK", px - 50, py - 34);
      if (crash > 0) {
        const ex = px + crash * 120, ey = py + (Y(0.03) - py) * Math.min(1, crash * 1.25);
        g.strokeStyle = "#e63946"; g.lineWidth = 10; g.beginPath(); g.moveTo(px, py); g.lineTo(ex, ey); g.stroke();
      }
    }
  });
}
{
  const easel = new THREE.Group(); at(easel, 6.25, 0, -0.95); scene.add(easel);
  for (const [x, rz] of [[-0.48, 0.1], [0.48, -0.1]]) { const l = rbox(0.06, 2.0, 0.06, "#b07a48", 0.02); at(l, x, 0.98, 0.05); l.rotation.z = rz; easel.add(l); }
  const lb = rbox(0.06, 2.0, 0.06, "#b07a48", 0.02); at(lb, 0, 0.95, -0.42); lb.rotation.x = 0.4; easel.add(lb);
  easel.add(at(rbox(1.25, 0.06, 0.14, "#b07a48", 0.02), 0, 0.68, 0.1));
  const board = plate(chartTex, 1.3, 0.97, 0.03, 0xf0ebe0); at(board, 0, 1.2, 0.08); board.rotation.x = -0.08; easel.add(board);
  updaters.push((t) => drawChart(smooth(prog(t, C("2.soar") - 0.35, 1.3)), smooth(prog(t, C("3.cap") - 0.2, 0.7))));
}

// ===== Station 3 · who won, who lost (x≈6.9) =====
const sackGeo = new THREE.LatheGeometry([[0, 0], [0.2, 0.01], [0.3, 0.1], [0.32, 0.25], [0.27, 0.42], [0.13, 0.55], [0.09, 0.6], [0.14, 0.68], [0.17, 0.72], [0.12, 0.73], [0, 0.71]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
const sack = group(mesh(sackGeo, mat("#c9a36b")), at(mesh(new THREE.TorusGeometry(0.095, 0.022, 8, 20), mat("#7b5a33")), 0, 0.6, 0));
sack.children[1].rotation.x = Math.PI / 2; at(sack, 7.5, 0, 0.35); scene.add(sack);
const sackDollar = plate(canvasTex(128, 128, (g) => { g.fillStyle = "#c9a36b"; g.fillRect(0, 0, 128, 128); g.fillStyle = "#6b4e2b"; g.font = '100px "Archivo Black"'; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 64, 70); }), 0.2, 0.2, 0.01, 0xc9a36b);
at(sackDollar, 0, 0.27, 0.31); sack.add(sackDollar);
const pile3 = coinPile(6.85, 0.45, [[0, 0, 9], [-0.3, 0.1, 7], [0.28, 0.1, 6]], -99, -98, { scatter: 3 });
pile3.update(0);
const hoppers = [...Array(7)].map(() => { const c = coin("trump"); scene.add(c); return c; });
updaters.push((t) => {
  const t0 = C("3.sack");
  hoppers.forEach((c, i) => {
    const u = prog(t, t0 - 0.1 + i * 0.16, 0.42);
    c.visible = u > 0 && u < 1;
    const a = [6.85 + (i % 3 - 1) * 0.29, 0.45 + (i % 3) * 0.06], b = [7.5, 0.35];
    c.position.set(lerp(a[0], b[0], u), 0.52 + Math.sin(u * Math.PI) * 0.75 + u * 0.2, lerp(0.45, b[1], u));
    c.rotation.set(u * 9, 0, u * 4);
  });
  const catchPulse = [...Array(7)].reduce((s, _, i) => s + Math.max(0, Math.sin(prog(t, t0 + 0.32 + i * 0.16, 0.18) * Math.PI)), 0);
  sack.scale.set(1 + catchPulse * 0.06, 1 - catchPulse * 0.05, 1 + catchPulse * 0.06);
});
note("tag", ["FAMILY:", "~$616M"], 0.56, 0.26, 7.45, 0, 1.0, C("3.sack") + 0.4, { ry: -0.15 });
// piggy bank (faces +x), splits in two at "Buyers lost"
const piggy = new THREE.Group(); at(piggy, 6.3, 0, 0.85); piggy.scale.setScalar(0.85); scene.add(piggy);
const pigL = new THREE.Group(), pigR = new THREE.Group(); piggy.add(pigL, pigR);
{
  const pink = "#f3a7b9";
  const halfGeo = (start) => new THREE.SphereGeometry(0.27, 28, 18, start, Math.PI);
  const hl = mesh(halfGeo(Math.PI), mat(pink)), hr = mesh(halfGeo(0), mat(pink));
  for (const h of [hl, hr]) { h.scale.set(1.25, 0.95, 1); h.position.y = 0.33; }
  pigL.add(hl); pigR.add(hr);
  const snout = cyl(0.09, 0.1, 0.1, "#ee93a8"); snout.rotation.z = Math.PI / 2; at(snout, 0.37, 0.33, 0); pigR.add(snout);
  for (const z of [-0.12, 0.12]) { const e = mesh(new THREE.ConeGeometry(0.06, 0.12, 12), mat(pink)); at(e, 0.18, 0.6, z); pigR.add(e); const eye = mesh(new THREE.SphereGeometry(0.022, 8, 8), mat(INK)); at(eye, 0.28, 0.42, z * 0.85); pigR.add(eye); }
  for (const [x, z, s] of [[-0.18, -0.12, pigL], [-0.18, 0.12, pigL], [0.18, -0.12, pigR], [0.18, 0.12, pigR]]) s.add(at(cyl(0.045, 0.05, 0.12, "#ee93a8", 12), x, 0.06, z));
  const tail = mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12, 4.5), mat("#ee93a8")); at(tail, -0.36, 0.38, 0); pigL.add(tail);
  piggy.rotation.y = -0.45;
  updaters.push((t) => {
    const u = outCubic(prog(t, C("3.piggy"), 0.5)), shake = Math.sin(t * 50) * 0.04 * (1 - prog(t, C("3.piggy") - 0.25, 0.25)) * (t > C("3.piggy") - 0.25 ? 1 : 0);
    pigL.position.x = -u * 0.2; pigL.rotation.z = u * 0.55; pigR.position.x = u * 0.2; pigR.rotation.z = -u * 0.45; pigL.position.y = pigR.position.y = -u * 0.04;
    piggy.rotation.z = shake;
  });
}
note("tag", ["BUYERS LOST:", "$700M+"], 0.6, 0.26, 6.35, 0, 1.45, C("3.piggy") + 0.3, { ry: 0.1 });
note("card", ["REUTERS", "analysis"], 0.46, 0.28, 5.92, 1.62, -0.78, C("3.reuters"), { holder: false, rx: -0.08, ry: 0.05 });

// ===== Station 4 · dinner for 220 (x≈12) =====
{
  const T = new THREE.Group(); at(T, 12.0, 0, 0); scene.add(T);
  T.add(at(rbox(0.95, 0.06, 3.3, "#fbf7ee", 0.02), 0, 0.42, -0.15));
  T.add(at(rbox(1.0, 0.18, 3.35, "#e9e2d2", 0.02), 0, 0.34, -0.15));
  for (const [x, z] of [[-0.4, -1.7], [0.4, -1.7], [-0.4, 1.4], [0.4, 1.4]]) T.add(at(rbox(0.06, 0.4, 0.06, "#8b5a34", 0.01), x, 0.2, z));
  for (let i = 0; i < 10; i++) {
    const z = 1.3 - i * 0.31;
    for (const side of [-1, 1]) {
      const ch = group(at(rbox(0.2, 0.04, 0.2, "#c0392b", 0.01), 0, 0.24, 0), at(rbox(0.04, 0.3, 0.2, "#c0392b", 0.01), side * 0.1, 0.38, 0));
      for (const [lx, lz] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) ch.add(at(rbox(0.025, 0.22, 0.025, "#7a2a20", 0.008), lx, 0.11, lz));
      at(ch, side * 0.62, 0, z); T.add(ch);
      const plateM = cyl(0.1, 0.08, 0.02, "#ffffff", 20); at(plateM, side * 0.3, 0.46, z); T.add(plateM);
      const pc = coin("trump", 0.06); pc.rotation.x = Math.PI / 2 - 0.3; at(pc, side * 0.3, 0.52, z - 0.1); T.add(pc);
    }
  }
  for (const z of [0.9, -0.1, -1.1]) { const cnd = group(at(cyl(0.03, 0.04, 0.22, "#f7f1e1", 10), 0, 0.56, 0), at(mesh(new THREE.ConeGeometry(0.025, 0.06, 8), mat("#ffb84d")), 0, 0.7, 0)); at(cnd, 0, 0, z); T.add(cnd); }
  // golf green + flag
  const green = mesh(new THREE.CylinderGeometry(0.42, 0.45, 0.025, 32), mat("#5fbf5f")); at(green, 13.0, 0.0125, -0.55); scene.add(green);
  const hole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), mat(INK)); at(hole, 13.07, 0.02, -0.6); scene.add(hole);
  const pole = cyl(0.012, 0.012, 1.0, "#ffffff", 8); at(pole, 13.07, 0.5, -0.6); scene.add(pole);
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.34, -0.11); fs.lineTo(0, -0.22); fs.lineTo(0, 0);
  const flag = mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.012, bevelEnabled: false }), mat("#e63946")); at(flag, 13.08, 0.98, -0.6); scene.add(flag);
  updaters.push((t) => { flag.rotation.y = Math.sin(t * 2.2) * 0.25; });
  const ball = mesh(new THREE.SphereGeometry(0.045, 16, 12), mat("#ffffff")); at(ball, 12.82, 0.07, -0.3); scene.add(ball);
  note("sign", Object.assign(["TOP 220 HOLDERS", "VIRGINIA GOLF CLUB · MAY 2025"], { colors: ["#2e3a46", "#ffffff"] }), 0.8, 0.28, 11.85, 0, 1.72, -1, { rx: -0.22, ry: 0.1 });
}
// alarm clock that rings on "personal time"
const clock = new THREE.Group(); at(clock, 12.0, 0.45, 1.12); clock.scale.setScalar(0.85); scene.add(clock);
{
  const face = canvasTex(256, 256, (g) => { g.fillStyle = "#fffdf7"; g.fillRect(0, 0, 256, 256); g.strokeStyle = INK; g.lineWidth = 8; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.beginPath(); g.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); g.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); g.stroke(); } g.lineWidth = 10; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 60); g.stroke(); g.beginPath(); g.moveTo(128, 128); g.lineTo(180, 128); g.stroke(); });
  const body = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 32), [mat("#e74c3c"), mat(0xffffff, face), mat("#e74c3c")]);
  body.rotation.x = Math.PI / 2; at(body, 0, 0.27, 0); clock.add(body);
  for (const x of [-0.11, 0.11]) { const b = mesh(new THREE.SphereGeometry(0.07, 16, 10, 0, 6.283, 0, Math.PI / 2), mat("#f1c40f")); at(b, x, 0.42, -0.01); b.rotation.z = -x * 3; clock.add(b); }
  for (const x of [-0.1, 0.1]) clock.add(at(cyl(0.02, 0.025, 0.12, INK, 8), x, 0.06, 0));
  clock.rotation.y = 0.1;
  updaters.push((t) => { const a = t - C("4.clock"); clock.rotation.z = a > 0 && a < 1.0 ? Math.sin(a * 70) * 0.12 * (1 - a) : 0; clock.position.y = 0.45 + (a > 0 && a < 1 ? Math.abs(Math.sin(a * 35)) * 0.03 : 0); });
}
note("card", ["WHITE HOUSE:", "“personal time”"], 0.56, 0.32, 12.58, 0, 1.3, C("4.wh"), { ry: -0.2 });

// ===== Station 5 · World Liberty on the pegboard shelf (x≈16) =====
{
  const sh = rbox(3.2, 0.07, 0.8, "#c98b54", 0.02); at(sh, 16.0, 2.8, -1.58); scene.add(sh);
  for (const x of [14.7, 17.3]) { const br = rbox(0.06, 0.4, 0.5, "#8a96a3", 0.01); at(br, x, 2.58, -1.7); scene.add(br); }
  const token = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 48), coinMats("wlfi"));
  const tokG = group(token); token.rotation.x = Math.PI / 2; at(tokG, 16.0, 3.42, -1.5); scene.add(tokG);
  const stand = group(at(cyl(0.18, 0.22, 0.06, "#7c8894"), 0, 0, 0), at(cyl(0.03, 0.03, 0.2, "#7c8894", 10), 0, 0.1, 0)); at(stand, 16.0, 2.86, -1.5); scene.add(stand);
  updaters.push((t) => { tokG.rotation.y = t * 1.1; tokG.position.y = 3.42 + Math.sin(t * 2) * 0.02; });
  // sales counter
  const ctr = canvasTex(512, 256, () => {});
  let last = "";
  const counter = group(rbox(0.72, 0.5, 0.3, "#2e3a46", 0.03), at(plate(ctr, 0.62, 0.38, 0.01, 0x1b2630), 0, 0.0, 0.156));
  at(counter, 15.22, 3.09, -1.45); counter.rotation.y = 0.15; scene.add(counter);
  updaters.push((t) => {
    const u = outCubic(prog(t, C("5.counter") - 0.2, 1.3));
    const s = `$${(1.4 * u).toFixed(1)}B${u >= 1 ? "+" : ""}`; if (s === last) return; last = s;
    ctr.redraw((g, w, h) => { g.fillStyle = "#1b2630"; g.fillRect(0, 0, w, h); g.fillStyle = "#6ff0a7"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '120px "Archivo Black"'; g.fillText(s, w / 2, 118); g.font = 'bold 44px "Courier Prime"'; g.fillText("TOKEN SALES", w / 2, 216); });
  });
  // 75 / 25 pie on the pegboard; the 75% wedge drops into the company box
  const wedge = (a0, a1, color) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.absarc(0, 0, 0.42, a0, a1, false); s.lineTo(0, 0); return mesh(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false, curveSegments: 40 }), mat(color)); };
  const big = wedge(Math.PI / 2, Math.PI / 2 + Math.PI * 1.5, "#f4c64f"), small = wedge(0, Math.PI / 2, "#b9c3cc");
  const lbl = (txt, c) => plate(canvasTex(256, 128, (g) => { g.fillStyle = c; g.fillRect(0, 0, 256, 128); g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '84px "Archivo Black"'; g.fillText(txt, 128, 68); }), 0.26, 0.13, 0.005, 0xffffff);
  big.add(at(lbl("75%", "#f4c64f"), -0.12, -0.12, 0.065)); small.add(at(lbl("25%", "#b9c3cc"), 0.19, 0.19, 0.065));
  const pie = group(big, small); at(pie, 16.78, 4.5, -1.9); scene.add(pie);
  const box = group(rbox(0.66, 0.44, 0.42, "#c99b62", 0.03), at(plate(noteTex("sign", Object.assign(["TRUMP-", "CONTROLLED CO."], { colors: ["#f6efe2", INK] }), 0.58, 0.3), 0.58, 0.3, 0.006, 0xf6efe2), 0, 0, 0.215));
  at(box, 16.78, 3.06, -1.45); box.rotation.y = -0.12; scene.add(box);
  updaters.push((t) => {
    const t0 = C("5.cap"), u = smooth(prog(t, t0 - 0.1, 0.35)), v = inCubic(prog(t, t0 + 0.25, 0.55)), w = prog(t, t0 + 0.8, 0.1);
    big.position.set(0, -v * 1.35, u * 0.35);
    big.scale.setScalar(Math.max(0.001, 1 - v * 0.55 - w * 0.45)); big.visible = w < 1;
    const land = Math.max(0, Math.sin(prog(t, t0 + 0.8, 0.22) * Math.PI));
    box.scale.set(1 + land * 0.08, 1 - land * 0.1, 1 + land * 0.08);
  });
  // source tag hanging from a pegboard hook
  const tg = note("tag", ["SOURCE:", "WORLD LIBERTY DISCLOSURES"], 0.82, 0.27, 15.3, 4.2, -1.8, C("5.cap") + 0.35, { holder: false, rx: 0 });
  const string = cyl(0.004, 0.004, 0.42, "#6b5132", 4); at(string, -0.3, 0.42, 0); string.rotation.z = 0.5; tg.add(string);
}

// ===== Station 6/7 · Abu Dhabi skyline, truck, Binance, pardon (x≈19–26) =====
const winTex = (bg, fg) => canvasTex(128, 256, (g) => { g.fillStyle = bg; g.fillRect(0, 0, 128, 256); g.fillStyle = fg; for (let y = 10; y < 256; y += 26) for (let x = 10; x < 128; x += 30) g.fillRect(x, y, 18, 14); });
{
  const plinth = rbox(1.8, 0.24, 1.15, "#c9b48a", 0.03); at(plinth, 20.0, 0.12, -0.1); scene.add(plinth);
  note("sign", Object.assign(["ABU DHABI · MGX"], { colors: ["#f6efe2", INK] }), 1.2, 0.15, 20.0, 0.045, 0.49, -1, { holder: false, rx: 0 });
  const towers = [[-0.62, 0.24, 0.65, "#e7d3a8"], [-0.33, 0.26, 1.1, "#9fc9d6"], [-0.03, 0.2, 1.6, "#dccaa0"], [0.27, 0.3, 0.9, "#b6d7e0"], [0.58, 0.22, 0.55, "#e3cfa0"]];
  towers.forEach(([dx, w, h, c], i) => {
    const e = mat(c), f = mat(0xffffff, winTex(c, i % 2 ? "#6f98a8" : "#b89b68"));
    const tw = mesh(new THREE.BoxGeometry(w, h, w), [e, e, e, e, f, e]); at(tw, 20 + dx, 0.24 + h / 2, -0.25 + (i % 2) * 0.18); scene.add(tw);
  });
  const spire = mesh(new THREE.ConeGeometry(0.06, 0.5, 12), mat("#dccaa0")); at(spire, 19.97, 2.09, -0.25); scene.add(spire);
  for (const [dx, dz, s] of [[-0.5, 0.3, 0.3], [0.45, 0.32, 0.24]]) { const d = mesh(new THREE.SphereGeometry(s, 20, 12), mat("#e8c98f")); d.scale.y = 0.35; at(d, 20 + dx, 0.24, dz); scene.add(d); }
  // Binance toy building
  const bw = mat("#eef0f3"), bf = mat(0xffffff, winTex("#eef0f3", "#7d8a98"));
  const bld = mesh(new THREE.BoxGeometry(0.95, 1.6, 0.85), [bw, bw, bw, bw, bf, bw]); at(bld, 24.7, 0.8, -0.45); scene.add(bld);
  const roof = plate(noteTex("sign", Object.assign(["BINANCE"], { colors: ["#2e3a46", "#ffffff"] }), 1.05, 0.26), 1.05, 0.26, 0.05, 0x2e3a46); at(roof, 24.7, 1.73, -0.05); scene.add(roof);
  scene.add(at(rbox(0.32, 0.4, 0.04, "#7d8a98", 0.01), 24.7, 0.2, -0.01));
}
// toy truck carrying USD1
const truck = new THREE.Group(); scene.add(truck);
const wheels = [];
{
  truck.add(at(rbox(0.34, 0.3, 0.38, "#e4572e", 0.05), 0.42, 0.25, 0));
  truck.add(at(plate(canvasTex(64, 64, (g) => { g.fillStyle = "#bfe3f5"; g.fillRect(0, 0, 64, 64); }), 0.22, 0.12, 0.01, 0xbfe3f5), 0.42, 0.32, 0.192));
  truck.add(at(rbox(0.8, 0.08, 0.4, "#7a8794", 0.02), 0.02, 0.13, 0));
  for (const [x, z] of [[-0.25, -0.2], [-0.25, 0.2], [0.4, -0.2], [0.4, 0.2]]) { const wg = new THREE.Group(); const wh = cyl(0.085, 0.085, 0.06, INK, 18); wh.rotation.x = Math.PI / 2; wg.add(wh); at(wg, x, 0.085, z); truck.add(wg); wheels.push(wg); }
  for (let i = 0; i < 7; i++) { const c = coin("usd1", 0.15); at(c, -0.12 + (i % 2) * 0.02, 0.2 + Math.floor(i / 1) * 0.04, 0); c.rotation.y = i; truck.add(c); }
  const sign = plate(noteTex("sign", Object.assign(["$2B"], { colors: ["#f6efe2", "#2c6e45"] }), 0.3, 0.16), 0.3, 0.16, 0.01, 0xf6efe2);
  at(sign, -0.12, 0.62, 0.02); truck.add(sign); truck.add(at(cyl(0.008, 0.008, 0.2, "#6d7782", 6), -0.12, 0.5, 0));
  updaters.push((t) => {
    const u = smooth(prog(t, C("6.truck") - 0.1, C("6.arrive") + 0.25 - C("6.truck")));
    const x = lerp(21.05, 23.8, u); at(truck, x, 0, 1.0);
    wheels.forEach((w) => (w.rotation.z = -(x - 21.05) / 0.085));
    truck.rotation.z = Math.sin(t * 30) * 0.008 * (u > 0 && u < 1 ? 1 : 0);
  });
}
note("card", ["BINANCE:", "MGX chose USD1"], 0.6, 0.34, 24.7, 0.62, 0.02, C("6.bcard"), { holder: false, rx: 0 });
// pardon document + rubber stamp
const doc = new THREE.Group(); scene.add(doc);
{
  const tex = canvasTex(512, 700, (g, w, h) => {
    g.fillStyle = "#f6ecd2"; g.fillRect(0, 0, w, h); g.strokeStyle = "#b9a376"; g.lineWidth = 6; g.strokeRect(22, 22, w - 44, h - 44);
    g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '86px "Archivo Black"'; g.fillText("PARDON", w / 2, 110);
    g.font = 'bold 44px "Courier Prime"'; g.fillText("CZ", w / 2, 210); g.fillText("Binance founder", w / 2, 262); g.fillText("OCT 2025", w / 2, 330);
    g.font = 'bold 30px "Courier Prime"'; g.fillStyle = "#5b4a2c"; g.fillText("had pleaded guilty to an", w / 2, 430); g.fillText("anti-money-laundering", w / 2, 468); g.fillText("violation", w / 2, 506);
    g.strokeStyle = "#5b4a2c"; g.lineWidth = 3; g.beginPath(); g.moveTo(120, 620); g.lineTo(392, 620); g.stroke();
  });
  const paper = plate(tex, 0.62, 0.85, 0.01, 0xf6ecd2); at(paper, 0, 0.47, 0); doc.add(paper);
  for (const y of [0.05, 0.9]) { const r = cyl(0.04, 0.04, 0.7, "#d8c08a", 16); r.rotation.z = Math.PI / 2; at(r, 0, y, -0.01); doc.add(r); }
  const mark = plate(canvasTex(512, 180, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "rgba(246,236,210,1)"; g.fillRect(0, 0, w, h); g.strokeStyle = "#d62828"; g.lineWidth = 14; g.strokeRect(12, 12, w - 24, h - 24); g.fillStyle = "#d62828"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '92px "Archivo Black"'; g.fillText("PARDONED", w / 2, h / 2 + 6); }), 0.56, 0.2, 0.004, 0xf6ecd2);
  at(mark, 0, 0.36, 0.012); mark.rotation.z = 0.12; doc.add(mark);
  const stamp = group(at(rbox(0.3, 0.08, 0.2, "#c0392b", 0.02), 0, 0, 0), at(cyl(0.04, 0.05, 0.22, "#8b5a34", 12), 0, 0.15, 0), at(mesh(new THREE.SphereGeometry(0.075, 16, 12), mat("#8b5a34")), 0, 0.3, 0));
  scene.add(stamp);
  updaters.push((t) => {
    const ts = C("6.scroll"), tc = C("6.cap");
    const u = outBack(prog(t, ts - 0.1, 0.55));
    at(doc, lerp(26.9, 25.2, u), 0.02, 1.0); doc.rotation.set(-0.55, -0.12, 0);
    const hit = smooth(prog(t, tc - 0.28, 0.22)) - smooth(prog(t, tc + 0.12, 0.35));
    const lift = 0.9 - hit * 0.78;
    // stamp descends along the document normal
    const n = new THREE.Vector3(0, Math.cos(0.55), Math.sin(0.55));
    stamp.position.set(25.2 + 0.02, 0.02 + 0.36 * Math.cos(0.55) + n.y * lift, 1.0 - 0.36 * Math.sin(0.55) + n.z * lift);
    stamp.rotation.set(-0.55 + Math.PI / 2 - Math.PI / 2, 0, 0); stamp.rotation.x = -0.55 + 0; stamp.visible = t > ts && t < tc + 1.6;
    const m = prog(t, tc - 0.05, 0.12); mark.visible = m > 0; mark.scale.setScalar(m > 0 ? lerp(1.4, 1, outCubic(m)) : 0.001);
  });
}
// station 7 props: crowned bag into the World Liberty box, AI chips crate
{
  const box = group(rbox(0.62, 0.42, 0.5, "#3d6fd8", 0.03), at(plate(noteTex("sign", Object.assign(["WORLD LIBERTY", "STAKE"], { colors: ["#3d6fd8", "#ffffff"] }), 0.54, 0.28), 0.54, 0.28, 0.006, 0x3d6fd8), 0, 0, 0.256));
  at(box, 19.15, 0.21, 0.85); box.rotation.y = 0.25; scene.add(box);
  const bag = group(mesh(sackGeo, mat("#e0c58f")));
  const crown = group(at(cyl(0.11, 0.1, 0.07, "#f4c64f", 20), 0, 0, 0));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283, sp = mesh(new THREE.ConeGeometry(0.026, 0.09, 8), mat("#f4c64f")); at(sp, Math.cos(a) * 0.09, 0.07, Math.sin(a) * 0.09); crown.add(sp); }
  at(crown, 0, 0.77, 0); bag.add(crown);
  const btag = plate(noteTex("sign", Object.assign(["$500M"], { colors: ["#f6efe2", INK] }), 0.32, 0.15), 0.32, 0.15, 0.006, 0xf6efe2); at(btag, 0.0, 0.3, 0.33); bag.add(btag);
  scene.add(bag);
  const crate = group(rbox(0.55, 0.36, 0.4, "#b98b57", 0.02), at(plate(canvasTex(384, 256, (g, w, h) => { g.fillStyle = "#b98b57"; g.fillRect(0, 0, w, h); g.strokeStyle = "#8a6239"; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = "#2b2b2b"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '76px "Archivo Black"'; g.fillText("AI CHIPS", w / 2, 100); for (let i = 0; i < 4; i++) { const x = 70 + i * 80; g.fillRect(x, 160, 44, 44); g.fillStyle = "#b98b57"; g.fillRect(x + 12, 172, 20, 20); g.fillStyle = "#2b2b2b"; } }), 0.5, 0.33, 0.006, 0xb98b57), 0, 0, 0.205));
  scene.add(crate);
  updaters.push((t) => {
    const tb = C("7.cap"), u = inCubic(prog(t, tb - 0.45, 0.5)), sink = smooth(prog(t, tb + 0.05, 0.35));
    bag.visible = t > tb - 0.5 && sink < 1;
    at(bag, 19.15, lerp(2.6, 0.32, u) - sink * 0.45, 0.85); bag.rotation.y = 0.25 + (1 - u) * 0.6;
    const land = Math.max(0, Math.sin(prog(t, tb + 0.03, 0.25) * Math.PI));
    box.scale.set(1 + land * 0.09, 1 - land * 0.12, 1 + land * 0.09);
    const c = outCubic(prog(t, C("7.chips") - 0.1, 0.9));
    crate.visible = t > C("7.chips") - 0.15; at(crate, lerp(22.4, 20.85, c), 0.18, 1.0); crate.rotation.y = -0.2 + (1 - c) * 0.3;
  });
}
note("tag", ["SOURCE:", "WALL STREET JOURNAL"], 0.72, 0.26, 19.45, 0, 1.55, C("7.wsj") + 0.2, { ry: 0.15 });
note("card", ["WHITE HOUSE:", "his children run the businesses"], 0.66, 0.42, 20.55, 0.24, 0.32, C("7.wh"), { ry: -0.12, holder: true });

// ===== Station 8 · adding it up (x≈29) =====
const pile8 = coinPile(29, -0.1, [[0, 0, 40], [-0.42, 0.05, 31], [0.42, 0.02, 34], [-0.2, 0.42, 24], [0.24, 0.42, 27], [-0.64, 0.4, 15], [0.66, 0.38, 18], [0.02, -0.4, 36], [-0.4, -0.38, 22], [0.44, -0.36, 25]], BT(8).start - 0.4, BT(8).start + 2.2, { pre: 0.45, scatter: 14 });
updaters.push((t) => { if (t > BT(7).end - 1) pile8.update(t); });
pile8.update(0);
const clipTex = canvasTex(512, 680, () => {});
let clipKey = "";
{
  const board = group(rbox(0.66, 0.9, 0.03, "#a87a4a", 0.03), at(plate(clipTex, 0.58, 0.77, 0.006, 0xfffdf7), 0, -0.03, 0.02), at(rbox(0.26, 0.1, 0.06, "#aab4bf", 0.02), 0, 0.42, 0.03));
  at(board, 29.95, 0.44, 1.0); board.rotation.set(-0.38, -0.25, 0); scene.add(board);
  updaters.push((t) => {
    const hl = smooth(prog(t, C("8.clip") + 0.2, 0.7)); const key = hl.toFixed(2); if (key === clipKey) return; clipKey = key;
    clipTex.redraw((g, w, h) => {
      g.fillStyle = "#fffdf7"; g.fillRect(0, 0, w, h);
      g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "middle"; fitFont(g, "FINANCIAL DISCLOSURE", '"Archivo Black"', 44, w - 60); g.fillText("FINANCIAL DISCLOSURE", 30, 60);
      g.font = 'bold 32px "Courier Prime"'; g.fillText("Annual report · 2025", 30, 110);
      g.strokeStyle = "#c9d3dc"; g.lineWidth = 3; for (let y = 170; y < 640; y += 52) { g.beginPath(); g.moveTo(30, y); g.lineTo(w - 30, y); g.stroke(); }
      g.fillStyle = "#e7e7e7"; for (const y of [190, 242, 294, 450, 502, 554]) g.fillRect(30, y - 12, 160 + ((y * 7) % 200), 22);
      g.fillStyle = "#ffe066"; g.fillRect(24, 352, (w - 48) * hl, 72);
      g.fillStyle = INK; g.font = '40px "Archivo Black"'; g.fillText("CRYPTO: > $1 BILLION", 34, 390);
    });
  });
}
note("tag", ["SOURCE:", "REUTERS"], 0.62, 0.26, 28.1, 0, 1.15, C("8.reuters"), { ry: 0.2 });
// field of investors on the floor
{
  const pts = [[0, 0], [0.11, 0], [0.11, 0.03], [0.08, 0.05], [0.055, 0.16], [0.045, 0.22], [0.075, 0.235], [0.075, 0.255], [0.045, 0.27]];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push([Math.cos(a) * 0.065, 0.335 + Math.sin(a) * 0.065]); }
  const pawnGeo = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), 18);
  const rows = 16, cols = 26, N = rows * cols;
  const im = new THREE.InstancedMesh(pawnGeo, mat("#a3acb6"), N); im.castShadow = true; im.receiveShadow = true; scene.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const seeds = [...Array(N)].map(() => [rnd(), rnd(), rnd()]);
  im.visible = false;
  updaters.push((t) => {
    im.visible = t > BT(8).start && t < BT(9).start + 2;
    if (!im.visible) return;
    const t0 = C("8.cap");
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, [a, b, d] = seeds[i];
      const droop = smooth(prog(t, t0 + a * 0.6, 0.4));
      p.set(29 - 2.9 + c * 0.23 + (b - 0.5) * 0.06, -4.55, 2.75 + r * 0.24 + (a - 0.5) * 0.06);
      e.set(droop * (0.35 + d * 0.15), (b - 0.5) * 0.5, (a - 0.5) * droop * 0.2); q.setFromEuler(e);
      m4.compose(p, q, s); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  note("sign", Object.assign(["~1 MILLION INVESTORS"], { colors: ["#f6efe2", INK] }), 1.3, 0.24, 29, -4.55, 6.75, C("8.pawns") + 0.4, { rx: -0.35 });
}

// ===== Station 9 · the balance scale (x≈33) =====
let beam;
const hangers = [];
{
  const brass = "#d4a64a";
  const S = new THREE.Group(); at(S, 33, 0, -0.1); scene.add(S);
  S.add(at(cyl(0.34, 0.4, 0.09, brass), 0, 0.045, 0));
  S.add(at(cyl(0.04, 0.05, 1.6, brass, 14), 0, 0.85, 0));
  S.add(at(mesh(new THREE.SphereGeometry(0.07, 16, 12), mat(brass)), 0, 1.68, 0));
  beam = new THREE.Group(); at(beam, 0, 1.62, 0); S.add(beam);
  const bar = rbox(1.5, 0.05, 0.05, brass, 0.02); beam.add(bar);
  for (const side of [-1, 1]) {
    const hg = new THREE.Group(); at(hg, side * 0.72, 0, 0); beam.add(hg);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * 6.283; const st = cyl(0.005, 0.005, 0.72, "#7a6a4a", 4); const dx = Math.cos(a) * 0.16, dz = Math.sin(a) * 0.16; at(st, dx / 2, -0.36, dz / 2); st.rotation.set(dz * 0.6, 0, -dx * 0.6); hg.add(st); }
    hg.add(at(cyl(0.34, 0.3, 0.04, brass), 0, -0.73, 0));
    hangers.push(hg);
  }
  // pan contents
  const items = [
    { side: 0, kind: "card", lines: ["CRITICS:", "corruption?"], key: "9.critics", x: 0, w: 0.5, h: 0.32 },
    { side: 1, kind: "card", lines: ["WHITE HOUSE:", "no conflicts"], key: "9.wh", x: -0.13, z: -0.1, w: 0.46, h: 0.3 },
    { side: 1, kind: "book", key: "9.exempt", x: 0.16, z: -0.12 },
    { side: 1, kind: "chart", key: "9.markets", x: 0.04, z: 0.14 },
  ];
  const drops = [];
  for (const it of items) {
    let o;
    if (it.kind === "card") { o = group(plate(noteTex("card", it.lines, it.w, it.h), it.w, it.h, 0.012)); o.children[0].position.y = it.h / 2; }
    else if (it.kind === "book") {
      const cover = noteTex("sign", Object.assign(["PRESIDENTS", "EXEMPT"], { colors: ["#7b2d26", "#f6efe2"] }), 0.34, 0.44);
      o = group(at(mesh(new THREE.BoxGeometry(0.34, 0.44, 0.09), [mat("#f6efe2"), mat("#7b2d26"), mat("#7b2d26"), mat("#7b2d26"), mat(0xffffff, cover), mat("#7b2d26")]), 0, 0.22, 0));
      o.children[0].rotation.x = -0.12;
    } else {
      const ct = canvasTex(256, 200, (g, w, h) => { g.fillStyle = "#fffdf7"; g.fillRect(0, 0, w, h); g.strokeStyle = "#1e9e5a"; g.lineWidth = 12; g.lineJoin = "round"; g.beginPath(); g.moveTo(24, 160); g.lineTo(90, 120); g.lineTo(140, 135); g.lineTo(220, 50); g.stroke(); g.beginPath(); g.moveTo(190, 46); g.lineTo(224, 46); g.lineTo(224, 80); g.stroke(); g.fillStyle = INK; g.font = '36px "Archivo Black"'; g.textAlign = "center"; g.fillText("MARKETS", w / 2, 190); });
      o = group(at(plate(ct, 0.3, 0.24, 0.012), 0, 0.12, 0));
    }
    at(o, it.x, -0.71, it.z ?? 0.02); hangers[it.side].add(o); drops.push({ o, t0: C(it.key) - 0.25 });
  }
  note("card", ["WHITE HOUSE", "statements"], 0.5, 0.28, 33.55, 0, 1.35, C("9.wh") + 0.2, { ry: -0.25 });
  // damped beam: + tips the left pan down
  const steps = [["9.critics", 0.3], ["9.wh", -0.17], ["9.exempt", -0.12], ["9.markets", -0.06]];
  updaters.push((t) => {
    let a = 0;
    for (const [k, d] of steps) { const dt = t - C(k); if (dt > 0) a += d * (1 - Math.exp(-3.2 * dt) * Math.cos(6.5 * dt)); }
    beam.rotation.z = a;
    hangers.forEach((h) => (h.rotation.z = -a));
    for (const d of drops) { const u = prog(t, d.t0, 0.3); d.o.visible = u > 0; d.o.position.y = -0.71 + (1 - u * u) * 0.9; }
  });
}

// ===== Station 10 · Capitol, probe, receipts (x≈37.5) =====
let receipt, receiptTex;
{
  const cream = "#f1ebdd";
  const D = new THREE.Group(); at(D, 37.65, 0, -0.75); scene.add(D);
  D.add(at(rbox(2.0, 0.34, 0.75, cream, 0.03), 0, 0.17, 0));
  D.add(at(rbox(1.0, 0.12, 0.4, "#e2d9c4", 0.02), 0, 0.06, 0.48));
  const colGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.38, 8);
  const cols = new THREE.InstancedMesh(colGeo, mat(cream), 20); cols.castShadow = true;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 20; i++) { const a = (i / 20) * 6.283; m4.makeTranslation(Math.cos(a) * 0.45, 0.53, Math.sin(a) * 0.45); cols.setMatrixAt(i, m4); }
  D.add(cols);
  D.add(at(cyl(0.4, 0.4, 0.38, "#e8e0cd"), 0, 0.53, 0));
  D.add(at(cyl(0.5, 0.5, 0.05, cream), 0, 0.745, 0));
  D.add(at(mesh(new THREE.SphereGeometry(0.42, 32, 16, 0, 6.283, 0, Math.PI / 2), mat(cream)), 0, 0.77, 0));
  D.add(at(cyl(0.07, 0.08, 0.16, cream, 14), 0, 1.27, 0));
  D.add(at(mesh(new THREE.ConeGeometry(0.06, 0.14, 12), mat(cream)), 0, 1.42, 0));
  // probe folder
  const folder = group(plate(noteTex("card", ["PROBE:", "World Liberty", "foreign money"], 0.62, 0.46), 0.62, 0.46, 0.03, 0xe8c77a));
  folder.children[0].position.y = 0.25; scene.add(folder);
  // sinking coins
  const sinkers = ["trump", "wlfi", "trump", "trump", "wlfi"].map((k, i) => { const c = coin(k, 0.17); scene.add(c); return { c, i }; });
  // receipt printer
  const pr = group(rbox(0.48, 0.3, 0.36, "#8e99a4", 0.04), at(rbox(0.36, 0.03, 0.06, INK, 0.01), 0, 0.15, 0.02));
  at(pr, 38.3, 0.15, 0.75); scene.add(pr);
  receiptTex = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = "#fbf8f0"; g.fillRect(0, 0, w, h); g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = '34px "Archivo Black"'; g.fillText("CONGRESS", w / 2, 60); g.font = 'bold 26px "Courier Prime"'; g.fillText("RECEIPTS REQUESTED", w / 2, 104);
    g.textAlign = "left"; const rows = ["WORLD LIBERTY", "FOREIGN MONEY", "$TRUMP COIN", "USD1 DEALS"];
    rows.forEach((r, i) => { g.fillText(r, 20, 190 + i * 70); g.textAlign = "right"; g.fillText("?", w - 20, 190 + i * 70); g.textAlign = "left"; });
    g.setLineDash([8, 8]); g.strokeStyle = INK; g.lineWidth = 3; g.beginPath(); g.moveTo(16, 480); g.lineTo(w - 16, 480); g.stroke(); g.setLineDash([]);
    g.font = '30px "Archivo Black"'; g.fillText("TOTAL", 20, 530); g.textAlign = "right"; g.fillText("???", w - 20, 530);
    g.textAlign = "center"; g.font = 'bold 24px "Courier Prime"'; for (let i = 0; i < 6; i++) g.fillText("· · · · · · · · ·", w / 2, 620 + i * 60);
  });
  const SEG = 60, RW = 0.3, RL = 1.7;
  const geo = new THREE.PlaneGeometry(RW, RL, 1, SEG);
  receipt = mesh(geo, new THREE.MeshToonMaterial({ color: 0xffffff, map: receiptTex, gradientMap: GRAD, side: THREE.DoubleSide }), true, true);
  receipt.material.userData.outlineParameters = { visible: false };
  receipt.frustumCulled = false; scene.add(receipt);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  updaters.push((t) => {
    // folder slides in from the left
    const fu = outBack(prog(t, C("10.probe") - 0.15, 0.6));
    folder.visible = fu > 0; at(folder, lerp(35.6, 37.15, fu), 0.0, 1.2); folder.rotation.set(-0.3, 0.12, 0);
    // coins at all-time lows sink into the tiles
    for (const { c, i } of sinkers) {
      const s = smooth(prog(t, C("10.lows") + i * 0.1, 0.9));
      c.visible = t > BT(9).end && s < 1;
      c.rotation.set(Math.PI / 2 - 0.25, 0, (i - 2) * 0.12 + Math.sin(t * 9 + i) * 0.05 * s);
      at(c, 36.35 + (i % 3) * 0.24, 0.17 - s * 0.42, 0.55 + Math.floor(i / 3) * 0.32);
    }
    // receipt prints and curls
    const L = RL * outCubic(prog(t, C("10.cap") - 0.1, 1.6));
    receipt.visible = L > 0.01;
    for (let j = 0; j <= SEG; j++) {
      const sAlong = (j / SEG) * RL; // 0 = tip, RL = tail (inside printer)
      const s = L - sAlong; // distance out of the slot
      let x = 0, y, z;
      if (s <= 0) { y = 0.29 + s * 0.02; z = 0; }
      else { const k = Math.max(0, s - 0.45); const ang = k * k * 2.2; y = 0.3 + Math.min(s, 0.45) + (k > 0 ? Math.sin(Math.min(ang, 3)) / Math.max(0.01, 2.2 * k) * k : 0); z = k > 0 ? -(1 - Math.cos(Math.min(ang, 3))) * 0.25 * k : 0; }
      for (const side of [0, 1]) {
        const idx = j * 2 + side; pos.setXYZ(idx, 38.3 + (side ? RW / 2 : -RW / 2), y, 0.77 + z);
        uv.setXY(idx, side, 1 - Math.max(0, Math.min(1, sAlong / RL)));
      }
    }
    pos.needsUpdate = true; uv.needsUpdate = true; geo.computeVertexNormals();
  });
}

// ---------- camera path ----------
const V = (a) => new THREE.Vector3(...a);
const K = [
  { t: 0, d: 0, p: [0, 2.3, 5.2], q: [0, 0.5, 0] },
  { t: BT(1).end + 0.2, d: BT(1).end, p: [0, 2.35, 4.45], q: [0, 0.62, 0] },
  { t: BT(2).start + 0.9, d: 1.3, p: [4.55, 1.6, 4.5], q: [4.55, 0.78, 0] },
  { t: C("2.press") + 0.55, d: 1.25, p: [5.6, 1.75, 4.75], q: [5.6, 0.88, 0] },
  { t: BT(3).start + 0.9, d: 1.3, p: [6.8, 2.1, 6.1], q: [6.8, 0.85, 0] },
  { t: BT(4).start + 1.0, d: 1.5, p: [12.35, 1.3, 5.0], q: [12.1, 0.38, 0] },
  { t: BT(5).start + 1.1, d: 1.6, p: [16, 3.8, 4.7], q: [16, 3.62, -1.5] },
  { t: BT(6).start + 1.0, d: 1.6, p: [20.3, 2.0, 5.5], q: [20.3, 0.82, 0] },
  { t: C("6.arrive") + 0.35, d: C("6.arrive") + 0.35 - C("6.truck"), p: [24.0, 2.0, 5.5], q: [24.0, 0.82, 0] },
  { t: C("6.scroll") + 0.8, d: 1.0, p: [24.9, 1.85, 5.2], q: [24.9, 0.85, 0.35] },
  { t: BT(7).start + 1.0, d: 1.4, p: [20.0, 2.05, 5.95], q: [20.0, 0.8, 0.2] },
  { t: BT(8).start + 1.0, d: 1.5, p: [29, 2.45, 7.0], q: [29, 1.25, 0] },
  { t: C("8.pawns") + 0.3, d: 1.4, p: [29, -2.1, 9.6], q: [29, -4.35, 4.6] },
  { t: BT(9).start + 1.2, d: 1.6, p: [33, 1.75, 6.5], q: [33, 1.0, 0] },
  { t: BT(10).start + 1.1, d: 1.5, p: [37.35, 1.95, 5.4], q: [37.35, 0.8, 0.25] },
  { t: C("10.receipt") + 2.3, d: 2.2, p: [35.8, 5.2, 13.5], q: [35.2, 1.6, 0] },
].map((k) => ({ ...k, p: V(k.p), q: V(k.q) }));
const camP = new THREE.Vector3(), camQ = new THREE.Vector3();
function placeCamera(t) {
  camP.copy(K[0].p); camQ.copy(K[0].q);
  for (let i = 1; i < K.length; i++) {
    const k = K[i], u = smooth(prog(t, k.t - k.d, k.d));
    if (u <= 0) break;
    const arc = Math.sin(u * Math.PI) * Math.min(0.25, k.p.distanceTo(K[i - 1].p) * 0.04);
    camP.lerpVectors(K[i - 1].p, k.p, u); camP.y += arc; camQ.lerpVectors(K[i - 1].q, k.q, u);
    if (u < 1) break;
  }
  // gentle orbit during the defense beat
  const ob = prog(t, BT(9).start + 1.2, BT(9).end - BT(9).start - 0.4);
  if (ob > 0 && ob < 1) { const a = Math.sin(ob * Math.PI) * 0.2; const d = camP.clone().sub(camQ); d.applyAxisAngle(new THREE.Vector3(0, 1, 0), a); camP.copy(camQ).add(d); }
  camP.x += Math.sin(t * 0.47) * 0.035; camP.y += Math.sin(t * 0.31 + 1) * 0.025;
  camera.position.copy(camP); camera.lookAt(camQ);
  sun.target.position.copy(camQ); sun.position.copy(camQ).add(new THREE.Vector3(-3.5, 7, 6));
}

// ---------- 2D compositing: grain, vignette, captions, end slate ----------
const out = document.getElementById("out"), og = out.getContext("2d");
const grains = [0, 1, 2].map(() => { const c = document.createElement("canvas"); c.width = 540; c.height = 960; const g = c.getContext("2d"); const id = g.createImageData(540, 960); for (let i = 0; i < id.data.length; i += 4) { const v = 200 + Math.random() * 55; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); return c; });
const vign = document.createElement("canvas"); vign.width = W; vign.height = H;
{ const g = vign.getContext("2d"); const r = g.createRadialGradient(W / 2, H * 0.52, H * 0.3, W / 2, H * 0.52, H * 0.75); r.addColorStop(0, "rgba(0,0,0,0)"); r.addColorStop(1, "rgba(20,30,25,0.28)"); g.fillStyle = r; g.fillRect(0, 0, W, H); }
const RED = "#e63946", BLACK = "#141414";
const CAPS = [["$2.3 billion", RED], ["$TRUMP coin", BLACK], ["-97%", RED], ["dinner for 220", BLACK], ["75% cut", RED], ["pardoned", RED], ["$500 million", BLACK], ["investors lost", BLACK], ["legal?", BLACK], ["lawyer up", RED]]
  .map(([text, color], i) => ({ text, color, t0: C(`${i + 1}.cap`), t1: i < 9 ? BT(i + 1).end + 0.3 : DURATION + 1 }));
function drawCaption(t) {
  for (const c of CAPS) {
    if (t < c.t0 || t > c.t1 + 0.2) continue;
    const u = (t - c.t0) * FPS; // frames since pop
    let s = u < 4 ? lerp(0.6, 1.08, u / 4) : u < 8 ? lerp(1.08, 1.0, (u - 4) / 4) : 1, a = 1;
    const o = (t - c.t1) / 0.2; if (o > 0) { s *= 1 - o * 0.3; a = 1 - o; }
    og.save(); og.translate(W / 2, 330); og.scale(s, s); og.rotate(-0.025); og.globalAlpha = clamp(a);
    const size = fitFont(og, c.text, '"Archivo Black"', 170, 930);
    og.textAlign = "center"; og.textBaseline = "middle"; og.lineJoin = "round";
    og.fillStyle = "rgba(20,20,20,0.9)"; og.fillText(c.text, 7, 11);
    og.lineWidth = size * 0.2; og.strokeStyle = "#ffffff"; og.strokeText(c.text, 0, 0);
    og.fillStyle = c.color; og.fillText(c.text, 0, 0);
    og.restore();
  }
}
const SLATE_T = Math.max(C("10.receipt") + 0.9, TL.speechEnd - 0.6);
function drawSlate(t) {
  const u = outCubic(prog(t, SLATE_T, 0.6)); if (u <= 0) return;
  const h = 560, y = H - (h + 90) * u;
  og.save(); og.translate(0, y); og.rotate(-0.01);
  og.fillStyle = "rgba(20,20,20,0.85)"; og.fillRect(58, 14, W - 116, h);
  og.fillStyle = "#fbf8f0"; og.fillRect(50, 0, W - 116, h); og.strokeStyle = "#141414"; og.lineWidth = 6; og.strokeRect(50, 0, W - 116, h);
  og.fillStyle = BLACK; og.textAlign = "left"; og.textBaseline = "top"; og.font = '58px "Archivo Black"';
  let yy = 44; for (const l of wrap(og, "How the Trump family made billions from crypto", W - 200)) { og.fillText(l, 92, yy); yy += 68; }
  og.font = 'bold 31px "Courier Prime"'; og.fillStyle = "#333"; yy += 18;
  for (const l of wrap(og, "Corruption claims are allegations by critics; the White House denies any conflicts of interest.", W - 200)) { og.fillText(l, 92, yy); yy += 38; }
  yy += 18; og.fillStyle = "#c62f2f"; og.font = '30px "Archivo Black"'; og.fillText("SOURCES", 92, yy); yy += 44;
  og.fillStyle = "#333"; og.font = 'bold 28px "Courier Prime"';
  for (const l of wrap(og, "Reuters · The Wall Street Journal · 2025 presidential financial disclosure · White House statements · Binance · World Liberty Financial", W - 200)) { og.fillText(l, 92, yy); yy += 34; }
  og.restore();
}

function update(t) {
  updatePops(t);
  for (const f of updaters) f(t);
  placeCamera(t);
}
window.renderFrame = (frame) => {
  const t = frame / FPS;
  update(t);
  effect.render(scene, camera);
  og.globalCompositeOperation = "source-over"; og.globalAlpha = 1;
  og.drawImage(renderer.domElement, 0, 0);
  og.globalCompositeOperation = "multiply"; og.globalAlpha = 0.5; og.drawImage(grains[Math.floor(t * 12) % 3], 0, 0, W, H);
  og.globalAlpha = 1; og.drawImage(vign, 0, 0);
  og.globalCompositeOperation = "source-over";
  drawCaption(t); drawSlate(t);
  return out.toDataURL("image/jpeg", 0.93);
};
window.TOTAL_FRAMES = Math.round(DURATION * FPS);
window.ready = true;
