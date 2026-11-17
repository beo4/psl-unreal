// Ride physics. No DOM, no rendering, no clock: the state changes only through step() with two
// integer inputs, so the same input list always gives the same run (recording, ghost, self-test).
// Units: metres, seconds, radians; x east, y north. Heading 0 = east, counter-clockwise.
// NOT calibrated against real run times. All tuning sits in P.

export const DT = 1 / 120;

export const P = {
  G: 9.81,
  V0: 3.0,            // m/s push out of the start gate
  MAX_EDGE: 73 * Math.PI / 180,   // edge angle at full input
  EDGE_RATE: 6,       // input units per second the edge can change (full left -> full right in 1/3 s)
  SIDECUT: 9,         // m, tightest carve = SIDECUT * cos(edge)
  GRIP: 2.6,          // g of lateral grip with neutral weight
  GRIP_W: 0.6,        // g more (weight forward) or less (weight back)
  MU: 0.05,           // snow friction, neutral weight
  MU_W: 0.03,         // more friction with weight forward, less with weight back
  CARVE: 0.05,        // extra friction per g of lateral load
  SKID: 0.6,          // braking per m/s^2 of lateral demand the edge cannot hold
  DRAG: 0.006,        // air drag, 1/m
  V_MIN: 1.0,         // m/s, the rider never stops completely before the finish
  GATE_TOL: 0.25,     // m the line may cut inside the stubby (board and body are not points)
  BRAKE: 4.0,         // m/s^2 after the finish
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (a) => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l]; };

/** Turn the exported JSON into what step() needs: ground(x, y) and per-lane gate geometry. */
export function makeTrack(json) {
  const g = json.grid, h = Float32Array.from(g.h_cm, (v) => (v + g.z_base_cm) / 100);
  const ground = (x, y) => {
    const fx = clamp(x - g.x0, 0, g.nx - 1.001), fy = clamp(y - g.y0, 0, g.ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, o = j * g.nx + i;
    return (h[o] * (1 - u) + h[o + 1] * u) * (1 - v) + (h[o + g.nx] * (1 - u) + h[o + g.nx + 1] * u) * v;
  };
  const inside = (x, y) => x > g.x0 + 1 && x < g.x0 + g.nx - 2 && y > g.y0 + 1 && y < g.y0 + g.ny - 2;
  const lanes = json.lanes.map((l) => {
    const [fa, fb] = l.finish, mid = [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2];
    const dir = unit(sub(mid, l.start));                     // downhill axis of the lane
    const fdir = unit(sub(fb, fa));
    let fn = [-fdir[1], fdir[0]]; if (dot(fn, dir) < 0) fn = [-fn[0], -fn[1]];   // finish-line normal, downhill
    return {
      color: l.color, start: l.start, dir, heading0: Math.atan2(dir[1], dir[0]),
      finish: { a: fa, dir: fdir, len: Math.hypot(fb[0] - fa[0], fb[1] - fa[1]), n: fn, mid },
      gates: l.gates.map((q) => ({ turn: q.turn, outer: q.outer, s: dot(sub(q.turn, l.start), dir), side: unit(sub(q.turn, q.outer)) })),
    };
  });
  return { json, ground, inside, lanes, h, grid: g };
}

/** State at the start gate of a lane. */
export function start(track, lane) {
  const L = track.lanes[lane];
  return { lane, x: L.start[0], y: L.start[1], heading: L.heading0, v: P.V0, edge: 0, weight: 0, slope: 0, skid: 0,
           t: 0, steps: 0, gate: 0, fail: null, finished: false, time: null, f: -1 };
}

/** One time step. e8, w8: integers -127..127 (edge: + = right; weight: + = forward). */
export function step(track, s, e8, w8) {
  const L = track.lanes[s.lane];
  const run = !s.finished;
  const eIn = run ? clamp(e8, -127, 127) / 127 : 0;
  s.weight = run ? clamp(w8, -127, 127) / 127 : 0;
  s.edge += clamp(eIn - s.edge, -P.EDGE_RATE * DT, P.EDGE_RATE * DT);

  // turn: lateral acceleration from the edge angle, limited by grip; radius from that and the speed
  const phi = Math.abs(s.edge) * P.MAX_EDGE;
  const want = P.G * Math.tan(phi);
  const lat = Math.min(want, P.G * (P.GRIP + P.GRIP_W * s.weight));
  s.skid = want - lat;
  const v = Math.max(s.v, P.V_MIN);
  const kappa = Math.min(lat / (v * v), Math.sin(phi) / (P.SIDECUT * Math.cos(phi)));   // ponytail: lateral pull of the slope ignored (no side slip); add when traverses matter
  s.heading -= Math.sign(s.edge) * kappa * s.v * DT;

  // speed along the board: gravity on the slope, snow friction, air drag, skid
  const cx = Math.cos(s.heading), cy = Math.sin(s.heading);
  s.slope = track.ground(s.x + cx * 0.5, s.y + cy * 0.5) - track.ground(s.x - cx * 0.5, s.y - cy * 0.5);   // dz per m
  const cos = 1 / Math.sqrt(1 + s.slope * s.slope);
  const mu = P.MU + P.MU_W * s.weight + P.CARVE * lat / P.G;
  const a = run ? P.G * cos * (-s.slope - mu) - P.DRAG * s.v * s.v - P.SKID * s.skid : -P.BRAKE;
  s.v = Math.max(s.v + a * DT, run ? P.V_MIN : 0);
  s.x += cx * s.v * cos * DT; s.y += cy * s.v * cos * DT;
  s.t += DT; s.steps++;
  if (!run) return s;

  // gates: when the rider passes the height of the next stubby, he must be on the side away from the long pole
  const p = [s.x, s.y], prog = dot(sub(p, L.start), L.dir);
  while (s.gate < L.gates.length && prog >= L.gates[s.gate].s) {
    const q = L.gates[s.gate];
    if (dot(sub(p, q.turn), q.side) < -P.GATE_TOL && !s.fail) s.fail = `Tor ${s.gate + 1} verpasst`;
    s.gate++;
  }
  // finish: crossing the own half of the finish line, time interpolated inside the step
  const rel = sub(p, L.finish.a), f = dot(rel, L.finish.n);
  if (f >= 0 && s.f < 0) {
    const u = dot(rel, L.finish.dir);
    if ((u < 0 || u > L.finish.len || s.gate < L.gates.length) && !s.fail) s.fail = 'Ziel verfehlt';
    s.finished = true; s.time = s.t - DT * f / (f - s.f);
  }
  s.f = f;
  if (!track.inside(s.x, s.y)) { s.fail = s.fail || 'Piste verlassen'; s.finished = true; s.v = 0; }
  return s;
}
