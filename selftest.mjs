// Self-test of the ride physics without a browser:   node game/selftest.mjs
// - a key-pressing rider gets through all gates of both lanes and finishes in a plausible time
// - replaying the recorded inputs gives exactly the same run (deterministic)
// - riding straight down misses a gate, so the run is invalid
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTrack, start, step, DT } from './physics.js';
import { pilot } from './autopilot.js';

const file = process.argv[2] || new URL('./tracks/ruhpolding_A2.json', import.meta.url);
const track = makeTrack(JSON.parse(readFileSync(file)));

function run(lane, keys) {                       // keys: function(state) or recorded Int8Array
  const s = start(track, lane), rec = [];
  let vmax = 0;
  while (!s.finished && s.t < 120) {
    const [e, w] = typeof keys === 'function' ? keys(s) : [keys[s.steps * 2] | 0, keys[s.steps * 2 + 1] | 0];
    rec.push(e, w); step(track, s, e, w); vmax = Math.max(vmax, s.v);
  }
  return { s, rec: Int8Array.from(rec), vmax };
}

for (const lane of [0, 1]) {
  const L = track.lanes[lane], a = run(lane, pilot(track, lane));
  assert.equal(a.s.fail, null, `${L.color}: ${a.s.fail}`);
  assert.equal(a.s.gate, L.gates.length);
  assert.ok(a.s.time > 15 && a.s.time < 60, `${L.color}: time ${a.s.time}`);
  const b = run(lane, a.rec);
  assert.equal(b.s.time, a.s.time); assert.equal(b.s.x, a.s.x); assert.equal(b.s.y, a.s.y); assert.equal(b.s.steps, a.s.steps);
  console.log(`${L.color}: ${L.gates.length} Tore, ${a.s.time.toFixed(3)} s, max ${(a.vmax * 3.6).toFixed(0)} km/h, ` +
              `Wiederholung identisch (${a.s.steps} Schritte à ${(DT * 1000).toFixed(2)} ms)`);
}
const straight = run(0, () => [0, 0]);
assert.match(straight.s.fail, /Tor \d+ verpasst/);
console.log(`geradeaus: ${straight.s.fail} -> ungültig\nselftest ok`);
