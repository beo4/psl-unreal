// Input: two values, edge (-1 left .. +1 right) and weight (-1 back .. +1 forward), from whichever
// source is active: phone tilt sensors, else keyboard, else a finger dragged on the screen.
// read() returns them as integers -127..127, which is all the physics ever sees.

const D = Math.PI / 180, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createInput(target) {
  // tuning knobs for the real device, kept in localStorage
  const cfg = { steerDeg: 25, weightDeg: 20, flipSteer: false, flipWeight: false };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('psl-input') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('psl-input', JSON.stringify(cfg)); } catch {} };

  // --- keyboard: arrows or WASD
  const keys = new Set();
  const MAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'f', KeyW: 'f', ArrowDown: 'b', KeyS: 'b' };
  addEventListener('keydown', (e) => { if (MAP[e.code]) { keys.add(MAP[e.code]); e.preventDefault(); } });
  addEventListener('keyup', (e) => { if (MAP[e.code]) keys.delete(MAP[e.code]); });
  addEventListener('blur', () => keys.clear());

  // --- touch / mouse drag: distance from where the finger went down, 90 px = full
  let drag = null;
  target.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 }; });
  target.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { drag.x = (e.clientX - drag.x0) / 90; drag.y = (drag.y0 - e.clientY) / 90; } });
  const up = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);

  // --- tilt sensor. Phone held in landscape with both hands, screen towards the rider.
  // From beta/gamma we take the direction of gravity in screen axes; that works for every way of
  // holding the phone and has no jumps like the raw angles have in landscape.
  const sen = { on: false, last: 0, hz: 0, n: 0, t0: 0, roll: 0, pitch: 0, roll0: 0, pitch0: 0, cal: true };
  function onOrientation(ev) {
    if (ev.beta == null || ev.gamma == null) return;
    const now = performance.now();
    sen.n++; if (now - sen.t0 >= 1000) { sen.hz = Math.round(sen.n * 1000 / (now - sen.t0)); sen.n = 0; sen.t0 = now; }
    sen.last = now;
    const b = ev.beta * D, g = ev.gamma * D;
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);   // "down" in device axes (x right, y top, z out of the screen)
    const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    let r = dx, u = dy;                                           // "down" along screen right / screen up
    if (ang === 90) { r = -dy; u = dx; } else if (ang === 270 || ang === -90) { r = dy; u = -dx; } else if (ang === 180) { r = -dx; u = -dy; }
    sen.roll = Math.atan2(r, Math.max(-u, 0.25));                 // steering-wheel angle, + = right side down
    sen.pitch = Math.asin(clamp(-dz, -1, 1));                     // 0 = upright, 90 deg = flat on the table; more = top edge away = forward
    if (sen.cal) { sen.roll0 = sen.roll; sen.pitch0 = sen.pitch; sen.cal = false; }
  }
  const sensorLive = () => sen.on && performance.now() - sen.last < 500;

  return {
    cfg, save,
    /** Must be called from a tap (iOS asks the user once). Returns 'ok' or the reason why not. */
    async enableSensor() {
      if (sen.on) return 'ok';
      if (typeof DeviceOrientationEvent === 'undefined') return 'kein Lagesensor';
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        let r; try { r = await DeviceOrientationEvent.requestPermission(); } catch (e) { return 'Freigabe nicht möglich (' + e.message + ')'; }
        if (r !== 'granted') return 'Sensor-Freigabe abgelehnt';
      }
      addEventListener('deviceorientation', onOrientation); sen.on = true; sen.t0 = performance.now();
      return 'ok';
    },
    /** Take the way the phone is held right now as neutral. */
    calibrate() { sen.cal = true; },
    /** [edge, weight] as integers -127..127. */
    read() {
      let e = 0, w = 0;
      if (keys.size) { e = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0); w = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0); }
      else if (sensorLive()) {
        e = (sen.roll - sen.roll0) / (cfg.steerDeg * D) * (cfg.flipSteer ? -1 : 1);
        w = (sen.pitch - sen.pitch0) / (cfg.weightDeg * D) * (cfg.flipWeight ? -1 : 1);
      } else if (drag) { e = drag.x; w = drag.y; }
      return [Math.round(clamp(e, -1, 1) * 127), Math.round(clamp(w, -1, 1) * 127)];
    },
    /** Text for the HUD: source, measured sensor rate, raw angles against the neutral position. */
    status() {
      if (keys.size) return 'Tastatur';
      if (sensorLive()) return `Sensor ${sen.hz} Hz · Kante ${((sen.roll - sen.roll0) / D).toFixed(0)}° · Gewicht ${((sen.pitch - sen.pitch0) / D).toFixed(0)}°`;
      return sen.on ? 'Sensor freigegeben, aber keine Daten · Tastatur/Finger' : 'Tastatur/Finger';
    },
  };
}
