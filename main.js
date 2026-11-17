// Game shell: loads a track file, draws it with three.js, feeds the two input values into the
// physics in fixed steps, records the run and replays the best one as a ghost.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { makeTrack, start, step, DT, P } from './physics.js';
import { createInput } from './input.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);                       // the data is z-up
const $ = (id) => document.getElementById(id);
const COLORS = { red: 0xd8222a, blue: 0x1e5fd0 };
const trackId = new URLSearchParams(location.search).get('track') || 'ruhpolding_A2_spiel';
const other = trackId.endsWith('_spiel') ? trackId.slice(0, -6) : trackId + '_spiel';   // planned course <-> easier game course

const json = await (await fetch(`tracks/${trackId}.json`)).json();
const track = makeTrack(json);
const input = createInput($('view'));
$('credit').textContent = `Geodaten: ${json.source} · ${json.name}${json.id.endsWith('_spiel') ? '' : ' · Planungsstand'} · Fahrphysik nicht kalibriert`;

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db8d1);
scene.fog = new THREE.Fog(0x9db8d1, 120, 520);
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0xb0b6c0, 2.4));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(1, -0.4, 0.7); scene.add(sun);
const camera = new THREE.PerspectiveCamera(72, 1, 0.3, 900);
const Z = (x, y) => track.ground(x, y);
const V = (x, y, dz = 0) => new THREE.Vector3(x, y, Z(x, y) + dz);

{ // terrain: 1 m grid, piste (inside the corridor) brighter than the rest, fine noise so speed is visible
  const g = track.grid, pos = new Float32Array(g.nx * g.ny * 3), col = new Float32Array(g.nx * g.ny * 3), uv = new Float32Array(g.nx * g.ny * 2);
  for (let j = 0, k = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++, k++) {
    const x = g.x0 + i, y = g.y0 + j, s = track.inCourse(x, y) ? 1 : 0.8;
    pos.set([x, y, track.h[k]], k * 3); col.set([s, s, s * 1.03], k * 3); uv.set([x / 6, y / 6], k * 2);
  }
  const idx = new Uint32Array((g.nx - 1) * (g.ny - 1) * 6);
  for (let j = 0, n = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) { const a = j * g.nx + i, b = a + 1, c = a + g.nx, d = c + 1; idx.set([a, b, c, b, d, c], n); n += 6; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const cx = cv.getContext('2d');
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const v = 222 + Math.random() * 33 - (y % 16 < 2 ? 22 : 0); cx.fillStyle = `rgb(${v},${v},${v})`; cx.fillRect(x, y, 1, 1); }
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: tex })));
}
{ // outer boundary of the course as a net, 1 m high, along the corridor polygon
  const c = json.corridor, pos = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length], za = Z(...a), zb = Z(...b);
    pos.push(a[0], a[1], za, b[0], b[1], zb, b[0], b[1], zb + 1, a[0], a[1], za, b[0], b[1], zb + 1, a[0], a[1], za + 1);
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf07a12, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
}
{ // trees from trees.csv
  const cone = new THREE.ConeGeometry(0.22, 1, 7).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const m = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0x24402c }), json.trees.length), o = new THREE.Object3D();
  json.trees.forEach(([x, y, h], i) => { o.position.copy(V(x, y)); o.scale.set(h, h, h); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  scene.add(m);
}
{ // gates, start and finish
  const pole = (x, y, h, r, color) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color })); m.position.copy(V(x, y, h / 2)); scene.add(m); };
  const stripe = (a, b, color, dz, w) => { const A = V(...a, dz), B = V(...b, dz), m = new THREE.Mesh(new THREE.BoxGeometry(A.distanceTo(B), w, 0.04), new THREE.MeshBasicMaterial({ color })); m.position.copy(A).lerp(B, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), B.sub(A).normalize()); scene.add(m); };
  for (const L of track.lanes) {
    const color = COLORS[L.color];
    for (const q of L.gates) {
      pole(q.turn[0], q.turn[1], 0.45, 0.05, color); pole(q.outer[0], q.outer[1], 1.8, 0.03, color);
      const t = V(...q.turn, 0.42), o = V(...q.outer);                // flag: tip down at the stubby, long edge at the long pole
      const geo = new THREE.BufferGeometry().setFromPoints([t, o.clone().setZ(o.z + 1.75), o.clone().setZ(o.z + 0.95)]);
      scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));
    }
    const px = -L.dir[1] * 0.6, py = L.dir[0] * 0.6;                  // start gate: two posts across the lane at the start point
    pole(L.start[0] + px, L.start[1] + py, 1.1, 0.05, color); pole(L.start[0] - px, L.start[1] - py, 1.1, 0.05, color);
    const [a, b] = [L.finish.a, [L.finish.a[0] + L.finish.dir[0] * L.finish.len, L.finish.a[1] + L.finish.dir[1] * L.finish.len]];
    stripe(a, b, color, 0.05, 0.35); pole(...a, 2.5, 0.06, color); pole(...b, 2.5, 0.06, color);
  }
}
function makeRider(color, ghost) {
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, transparent: ghost, opacity: ghost ? 0.4 : 1 });
  const g = new THREE.Group(), add = (geo, c, x, z) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, 0, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(1.65, 0.22, 0.03), 0x111111, 0, 0.02);
  add(new THREE.CylinderGeometry(0.17, 0.13, 0.75, 10).rotateX(Math.PI / 2), 0x222226, 0, 0.42);    // legs
  add(new THREE.CylinderGeometry(0.2, 0.18, 0.55, 10).rotateX(Math.PI / 2), color, 0.05, 1.0);       // bib in the lane colour
  add(new THREE.SphereGeometry(0.13, 12, 8), 0xcccccc, 0.1, 1.42);
  scene.add(g); return g;
}
const basis = new THREE.Matrix4(), vF = new THREE.Vector3(), vN = new THREE.Vector3(), vL = new THREE.Vector3(), vU = new THREE.Vector3();
function place(obj, s) {                                         // board on the snow, leaning into the turn
  const e = 0.5;
  vN.set(Z(s.x - e, s.y) - Z(s.x + e, s.y), Z(s.x, s.y - e) - Z(s.x, s.y + e), 2 * e).normalize();
  vF.set(Math.cos(s.heading), Math.sin(s.heading), 0); vF.addScaledVector(vN, -vF.dot(vN)).normalize();
  vL.crossVectors(vN, vF);
  const lean = s.edge * P.MAX_EDGE * 0.8;
  vU.copy(vN).multiplyScalar(Math.cos(lean)).addScaledVector(vL, -Math.sin(lean));
  vL.crossVectors(vU, vF);
  obj.position.set(s.x, s.y, Z(s.x, s.y) + 0.02);
  obj.quaternion.setFromRotationMatrix(basis.makeBasis(vF, vL, vU));
}

// ---------- game state ----------
const KEY = `psl-best-${json.id}`;
let lane = 0, view = 'chase', mode = 'menu', count = 0, acc = 0, last = 0;
let me = start(track, lane), camH = me.heading, rec = [], best = loadBest(), ghost = null;
const riders = track.lanes.map((L) => makeRider(COLORS[L.color], false));
const ghosts = track.lanes.map((L) => makeRider(COLORS[L.color], true));

function replay(b) { const s = start(track, b.lane); for (let i = 0; !s.finished && i < b.rec.length / 2; i++) step(track, s, b.rec[2 * i], b.rec[2 * i + 1]); return s; }
function loadBest() {                                            // only kept if it still replays to the same time (physics unchanged)
  try {
    const o = JSON.parse(localStorage.getItem(KEY)); if (!o) return null;
    const b = { lane: o.lane, time: o.time, rec: Int8Array.from(atob(o.rec), (c) => c.charCodeAt(0) << 24 >> 24) };
    const s = replay(b); return s.finished && !s.fail && s.time === b.time ? b : null;
  } catch { return null; }
}
function saveBest() { try { localStorage.setItem(KEY, JSON.stringify({ lane: best.lane, time: best.time, rec: btoa(String.fromCharCode(...new Uint8Array(best.rec.buffer))) })); } catch {} }

function menu(title, text, button = 'Start') { mode = 'menu'; $('oTitle').textContent = title; $('oText').textContent = text; $('go').textContent = button; $('overlay').style.display = 'flex'; }
function begin() {
  me = start(track, lane); rec = []; camH = me.heading; acc = 0;
  ghost = best ? { s: start(track, best.lane), i: 0, rec: best.rec, lane: best.lane } : null;
  $('overlay').style.display = 'none'; $('fail').textContent = ''; mode = 'count'; count = 3;
}
function finish() {
  mode = 'done';
  const valid = !me.fail, was = best && best.time;
  if (valid && (!best || me.time < best.time)) { best = { lane, time: me.time, rec: Int8Array.from(rec) }; saveBest(); }
  const t = me.time == null ? '' : me.time.toFixed(2) + ' s';
  const text = !valid ? me.fail + (best ? `\nBestzeit ${best.time.toFixed(2)} s` : '')
    : was ? `${t}\n${me.time < was ? 'Neue Bestzeit' : 'Geist war schneller'}: ${(me.time - was >= 0 ? '+' : '') + (me.time - was).toFixed(2)} s gegen ${was.toFixed(2)} s`
    : `${t}\nErste gültige Zeit. Der nächste Lauf geht gegen diesen Lauf als Geist.`;
  setTimeout(() => { if (mode === 'done') menu(valid ? 'Im Ziel' : 'Ausgeschieden', text + '\nSpur wechseln: Knopf „Spur“ (Geist bleibt auf seiner Spur).', 'Nochmal'); }, 1200);
}
function tick() {
  if (mode === 'count') { count -= DT; if (count <= 0) { input.calibrate(); mode = 'run'; } return; }
  if (mode !== 'run' && mode !== 'done') return;
  const [e, w] = input.read();
  if (!me.finished) rec.push(e, w);
  step(track, me, e, w);
  if (ghost) { step(track, ghost.s, ghost.rec[2 * ghost.i] | 0, ghost.rec[2 * ghost.i + 1] | 0); ghost.i++; }
  if (me.fail && !$('fail').textContent) $('fail').textContent = `Ausgeschieden: ${me.fail}`;
  if (me.finished && mode === 'run') finish();
}

// ---------- drawing ----------
function draw(dt) {
  const w = innerWidth, h = innerHeight;
  if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  riders.forEach((r, i) => { r.visible = i === lane && view === 'chase'; });
  ghosts.forEach((r, i) => { r.visible = !!ghost && i === ghost.lane; });
  place(riders[lane], me); if (ghost) place(ghosts[ghost.lane], ghost.s);
  let d = me.heading - camH; d = Math.atan2(Math.sin(d), Math.cos(d)); camH += d * (1 - Math.exp(-dt * (view === 'ego' ? 14 : 6)));
  const fx = Math.cos(camH), fy = Math.sin(camH), z = Z(me.x, me.y);
  if (view === 'ego') {
    const lean = me.edge * P.MAX_EDGE * 0.35;                    // the horizon tilts a little with the edge
    camera.position.set(me.x, me.y, z + 1.55);
    camera.up.set(fy * Math.sin(lean), -fx * Math.sin(lean), Math.cos(lean));
    camera.lookAt(me.x + fx * 12, me.y + fy * 12, Z(me.x + fx * 12, me.y + fy * 12) + 1.0);
  } else {
    const bx = me.x - fx * 7, by = me.y - fy * 7;
    camera.position.set(bx, by, Math.max(Z(bx, by) + 1, z + 3.2)); camera.up.set(0, 0, 1);
    camera.lookAt(me.x + fx * 6, me.y + fy * 6, Z(me.x + fx * 6, me.y + fy * 6) + 0.8);
  }
  renderer.render(scene, camera);
  $('time').textContent = (me.time ?? me.t).toFixed(2);
  $('speed').textContent = `${(me.v * 3.6).toFixed(0)} km/h` + (Math.abs(me.slip) > 0.6 ? ' · rutscht' : '');
  $('gate').textContent = `Tor ${Math.min(me.gate + 1, track.lanes[lane].gates.length)}/${track.lanes[lane].gates.length} · ${track.lanes[lane].color === 'red' ? 'Rot' : 'Blau'}` + (best ? ` · Best ${best.time.toFixed(2)}` : '');
  $('sensor').textContent = input.status();
  $('count').style.display = mode === 'count' ? 'flex' : 'none';
  if (mode === 'count') $('count').textContent = Math.ceil(count);
}
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
  for (acc += dt; acc >= DT; acc -= DT) tick();                  // physics in fixed steps, independent of the frame rate
  draw(dt); requestAnimationFrame(frame);
}

// ---------- buttons ----------
$('go').onclick = async () => {
  const r = await input.enableSensor();                          // iOS: permission prompt, needs this tap
  if (r !== 'ok' && matchMedia('(pointer: coarse)').matches) $('sensor').textContent = r;
  navigator.wakeLock?.request('screen').catch(() => {});
  begin();
};
$('bView').onclick = () => { view = view === 'chase' ? 'ego' : 'chase'; };
$('bLane').onclick = () => { lane = 1 - lane; begin(); };
$('bRestart').onclick = begin;
$('bTrack').textContent = other.endsWith('_spiel') ? 'Spielkurs' : 'Originalkurs';
$('bTrack').onclick = () => { location.search = '?track=' + other; };
$('bSet').onclick = () => { const s = $('settings').style; s.display = s.display === 'block' ? 'none' : 'block'; };
$('bClear').onclick = () => { best = null; ghost = null; try { localStorage.removeItem(KEY); } catch {} };
for (const [id, key, out] of [['sSteer', 'steerDeg', 'sSteerV'], ['sWeight', 'weightDeg', 'sWeightV']]) {
  $(id).value = input.cfg[key]; $(out).textContent = input.cfg[key];
  $(id).oninput = () => { input.cfg[key] = +$(id).value; $(out).textContent = $(id).value; input.save(); };
}
for (const [id, key] of [['sFlipS', 'flipSteer'], ['sFlipW', 'flipWeight']]) { $(id).checked = input.cfg[key]; $(id).onchange = () => { input.cfg[key] = $(id).checked; input.save(); }; }
addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (mode === 'menu') $('go').click(); } if (e.code === 'KeyV') $('bView').click(); if (e.code === 'KeyR') begin(); });

menu('Parallelslalom ' + json.name,
  'Handy quer mit beiden Händen halten: links/rechts kippen lenkt, vor/zurück neigen verlagert das Gewicht ' +
  '(vorn: mehr Grip, hinten: schneller). Die Kante bestimmt den Bogen; zu schnell für den Bogen rutscht das Brett und bremst. Am Rechner: Pfeiltasten, V = Ansicht, R = Neustart.\n' +
  'Am Stubby außen vorbei, auf der Seite ohne lange Stange. Torfehler oder Verlassen der Piste (oranges Netz) = ausgeschieden. Nach „Start“ das Handy bis zum Ende des Countdowns ruhig in Grundstellung halten.');
window.game = { get me() { return me; }, get mode() { return mode; }, get best() { return best; }, track, input };   // for checks from the console
requestAnimationFrame(frame);
