// A simple rider that only presses keys (left / right / none, forward / none), for the self-test and
// for checking the game in a browser without hands. Not part of the game itself.
import { P } from './physics.js';

const PASS = 1.3, LOOK = 0.45, DEAD = 0.05;   // m beside the stubby, s of look-ahead, edge needed before a key is pressed

/** Smooth line start -> around every stubby -> finish (centripetal Catmull-Rom, as in blender/riders.py). */
export function line(track, lane, stepM = 0.25) {
  const L = track.lanes[lane];
  let pts = [L.start, ...L.gates.map((q) => [q.turn[0] + q.side[0] * PASS, q.turn[1] + q.side[1] * PASS]), L.finish.mid];
  const ext = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  pts = [ext(pts[0], pts[1]), ...pts, ext(pts[pts.length - 1], pts[pts.length - 2])];
  const out = [], mix = (a, b, ta, tb, t) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = pts.slice(i - 1, i + 3), d = (a, b) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1]));
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), n = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / stepM));
    for (let k = 0; k < n; k++) {
      const t = t1 + (t2 - t1) * k / n;
      const a1 = mix(p0, p1, 0, t1, t), a2 = mix(p1, p2, t1, t2, t), a3 = mix(p2, p3, t2, t3, t);
      out.push(mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t));
    }
  }
  return out;
}

/** Returns keys(state) -> [edge, weight] as -127 / 0 / 127, chasing a point ahead on the line. */
export function pilot(track, lane) {
  const path = line(track, lane); let i = 0;
  return (s) => {
    const d2 = (k) => (path[k][0] - s.x) ** 2 + (path[k][1] - s.y) ** 2;
    while (i < path.length - 1 && d2(i + 1) <= d2(i)) i++;                 // nearest point, only forwards
    const look = Math.max(3, s.v * LOOK), j = Math.min(path.length - 1, i + Math.round(look / 0.25));
    const dx = path[j][0] - s.x, dy = path[j][1] - s.y, dist = Math.hypot(dx, dy) || 1;
    let al = Math.atan2(dy, dx) - s.heading; al = Math.atan2(Math.sin(al), Math.cos(al));
    const k = 2 * Math.sin(-al) / dist * P.SIDECUT;                        // wanted curvature (+ = right) times the sidecut radius
    const phi = Math.abs(k) <= 1 ? Math.abs(k) * P.ENGAGE : Math.max(P.ENGAGE, Math.acos(Math.min(1, 1 / Math.abs(k))));
    const want = Math.sign(k) * Math.min(1, phi / P.MAX_EDGE);              // edge that carves that curve
    // keys only: press towards the wanted edge, let go when past it
    const key = want >= 0 ? (s.edge < want ? 1 : 0) : (s.edge > want ? -1 : 0);
    return [Math.abs(want) > DEAD ? key * 127 : 0, s.load > 1.2 ? 127 : 0];
  };
}
