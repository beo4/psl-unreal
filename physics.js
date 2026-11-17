// Ride physics. No DOM, no rendering, no clock: the state changes only through step() with two
// integer inputs, so the same input list always gives the same run (recording, ghost, self-test).
// Units: metres, seconds, radians; x east, y north. Heading 0 = east, counter-clockwise.
//
// Model (carving as in Jentschura & Fahrbach, "Physics of Skiing: The Ideal-Carving Equation",
// arXiv physics/0310086, simplified to the horizontal plane):
// - The tilted edge cuts an arc whose radius is geometry, not speed: R = SIDECUT * cos(edge angle).
//   The board turns along that arc.
// - The velocity is a vector of its own. The edge pushes sideways as hard as needed to keep the rider
//   on the arc, but only up to its grip. Beyond that the board slips: it drifts wide, and because the
//   edge then pushes against the motion, it brakes. A board across the motion is a hockey stop.
// - Gravity pulls down the fall line with both parts, along and across the board.
// - A flat board has little side hold and swings into its direction of travel.
// NOT calibrated against real run times. All tuning sits in P.

export const DT = 1 / 120;

export const P = {
  G: 9.81,
  V0: 3.0,            // m/s push out of the start gate
  MAX_EDGE: 70 * Math.PI / 180,   // edge angle at full input
  EDGE_RATE: 6,       // input units per second the edge can change (full left -> full right in 1/3 s)
  SIDECUT: 9,         // m sidecut radius; carved radius = SIDECUT * cos(edge angle)
  ENGAGE: 20 * Math.PI / 180,     // edge angle from which the edge is fully in the snow; below, turn and hold fade out
  GRIP: 2.8,          // g of side hold of a fully engaged edge, neutral weight
  GRIP_W: 0.6,        // g more (weight forward) or less (weight back)
  FLAT_HOLD: 0.15,    // share of the grip a flat board still has sideways
  SLIP_TAU: 0.08,     // s in which a holding edge removes side slip
  ALIGN: 3.0,         // 1/s, how fast a flat board swings into its direction of travel
  MU: 0.05,           // snow friction, neutral weight
  MU_W: 0.03,         // more friction with weight forward, less with weight back
  CARVE: 0.05,        // extra friction per g of edge load
  DRAG: 0.006,        // air drag, 1/m
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
  const poly = json.corridor;                              // outer boundary of the course (both lanes)
  const inCourse = (x, y) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
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
  return { json, ground, inCourse, lanes, h, grid: g };
}

/** State at the start gate of a lane. heading = where the board points, (vx, vy) = where the rider moves. */
export function start(track, lane) {
  const L = track.lanes[lane];
  return { lane, x: L.start[0], y: L.start[1], heading: L.heading0, vx: L.dir[0] * P.V0, vy: L.dir[1] * P.V0, v: P.V0,
           edge: 0, weight: 0, slip: 0, load: 0, t: 0, steps: 0, gate: 0, fail: null, finished: false, time: null, f: -1 };
}

/** One time step. e8, w8: integers -127..127 (edge: + = right; weight: + = forward). */
export function step(track, s, e8, w8) {
  const L = track.lanes[s.lane];
  const run = !s.finished;
  const eIn = run ? clamp(e8, -127, 127) / 127 : 0;
  s.weight = run ? clamp(w8, -127, 127) / 127 : 0;
  s.edge += clamp(eIn - s.edge, -P.EDGE_RATE * DT, P.EDGE_RATE * DT);

  const bx = Math.cos(s.heading), by = Math.sin(s.heading), nx = -by, ny = bx;       // board axis, and its left
  const vLong = s.vx * bx + s.vy * by, vLat = s.vx * nx + s.vy * ny, speed = Math.hypot(s.vx, s.vy);

  // gravity along the snow, as horizontal acceleration: down the fall line
  const hx = (track.ground(s.x + 0.5, s.y) - track.ground(s.x - 0.5, s.y)), hy = (track.ground(s.x, s.y + 0.5) - track.ground(s.x, s.y - 0.5));
  const tilt = 1 + hx * hx + hy * hy, gx = -P.G * hx / tilt, gy = -P.G * hy / tilt, cos = 1 / Math.sqrt(tilt);

  // the edge: carved arc from the geometry, turning the board
  const phi = Math.abs(s.edge) * P.MAX_EDGE, engage = Math.min(1, phi / P.ENGAGE);
  const yaw = -Math.sign(s.edge) * engage / (P.SIDECUT * Math.cos(phi)) * vLong;       // rad/s
  let ax = gx, ay = gy;
  if (run) {
    // side force of the edge: what keeps the rider on the arc, cancels the side pull of the slope and removes slip, up to the grip
    const grip = P.G * (P.GRIP + P.GRIP_W * s.weight) * (P.FLAT_HOLD + (1 - P.FLAT_HOLD) * engage);
    const need = yaw * vLong - (gx * nx + gy * ny) - vLat / P.SLIP_TAU;
    const side = clamp(need, -grip, grip);
    s.load = Math.abs(side) / P.G; s.slip = vLat;
    ax += side * nx; ay += side * ny;
    s.heading += yaw * DT;
    if (speed > 0.3) {                                         // a flat board swings into its direction of travel
      let d = Math.atan2(s.vy, s.vx) - s.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      s.heading += clamp(d, -1, 1) * P.ALIGN * (1 - engage) * Math.min(1, speed / 2) * DT;
    }
    s.vx += ax * DT; s.vy += ay * DT;
    // snow friction and air drag take speed away, they never push the rider backwards
    const v1 = Math.hypot(s.vx, s.vy);
    const lose = (P.G * cos * (P.MU + P.MU_W * s.weight + P.CARVE * s.load) + P.DRAG * v1 * v1) * DT;
    const k = v1 > lose ? (v1 - lose) / v1 : 0;
    s.vx *= k; s.vy *= k;
  } else {                                                     // after the finish: brake to a stop, board along the motion
    const nv = Math.max(speed - P.BRAKE * DT, 0), k = speed > 1e-6 ? nv / speed : 0;
    s.vx *= k; s.vy *= k;
  }
  s.v = Math.hypot(s.vx, s.vy);
  s.x += s.vx * DT; s.y += s.vy * DT;
  s.t += DT; s.steps++;
  if (!run) return s;


  // gates: when the rider passes the height of the next stubby, he must be on the side away from the long pole.
  // A gate fault or leaving the course ends the run at once (out, no time).
  const p = [s.x, s.y], prog = dot(sub(p, L.start), L.dir);
  while (s.gate < L.gates.length && prog >= L.gates[s.gate].s) {
    const q = L.gates[s.gate];
    if (dot(sub(p, q.turn), q.side) < -P.GATE_TOL) { s.fail = `Torfehler an Tor ${s.gate + 1}`; s.finished = true; return s; }
    s.gate++;
  }
  // finish: crossing the own half of the finish line, time interpolated inside the step
  const rel = sub(p, L.finish.a), f = dot(rel, L.finish.n);
  if (f >= 0 && s.f < 0) {
    const u = dot(rel, L.finish.dir);
    s.finished = true;
    if (u < 0 || u > L.finish.len || s.gate < L.gates.length) s.fail = 'Ziel verfehlt'; else s.time = s.t - DT * f / (f - s.f);
  }
  s.f = f;
  // outer boundary: the corridor polygon ends exactly on the start and finish line, so the first and last metre are not checked
  if (!s.finished && prog > 1 && f < -1 && !track.inCourse(s.x, s.y)) { s.fail = 'Piste verlassen'; s.finished = true; }
  return s;
}
