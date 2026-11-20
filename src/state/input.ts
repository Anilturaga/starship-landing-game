import type { Simulation } from '../sim/simulation';

/** Raw player input, written by touch/mouse/keyboard handlers and applied to the sim each frame. */
export const input = {
  touch: { x: 0, y: 0 },
  keys: new Set<string>(),
  /** Remembered throttle for the Space toggle. */
  lastThrottle: 0.3,
};

const has = (...codes: string[]) => codes.some((c) => input.keys.has(c));

export function applyInput(sim: Simulation, dt: number) {
  const kx = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
  const ky = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
  sim.setStick(input.touch.x + kx, input.touch.y + ky);
  const kt = (has('ShiftLeft', 'ShiftRight') ? 1 : 0) - (has('KeyX', 'ControlLeft', 'ControlRight') ? 1 : 0);
  if (kt) sim.setThrottle(sim.ship.thr + kt * 0.6 * dt);
}

/** Space: cut the engines, or relight at the last setting. */
export function toggleEngines(sim: Simulation) {
  if (sim.mode.autoThrottle || sim.outcome || !sim.running) return;
  if (sim.ship.thr > 0.03) { input.lastThrottle = sim.ship.thr; sim.setThrottle(0); }
  else sim.setThrottle(Math.max(input.lastThrottle, 0.15));
}
