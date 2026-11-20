import { inGate } from '../src/sim/control';
import { STEP } from '../src/sim/constants';
import { MODES, type ModeId } from '../src/sim/modes';
import { Simulation } from '../src/sim/simulation';

/** A player: sees cues `delay` s late, moves their thumb with a `lag` s time constant, and trembles. */
export interface Human { delay: number; lag: number; tremor: number }
export const TYPICAL: Human = { delay: 0.45, lag: 0.25, tremor: 0.06 };
export const PERFECT: Human = { delay: 0, lag: STEP, tremor: 0 };

function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Flies a whole descent by following the flight computer's cues the way a person would. */
export function fly(modeId: ModeId, human: Human = PERFECT, seed = 1, setup?: (sim: Simulation) => void) {
  // fly with cues even in modes that hide them, so every mode is checked against the same pilot
  const sim = new Simulation({ ...MODES[modeId], guides: true });
  setup?.(sim);
  sim.running = true;
  sim.runGuide();
  const gauss = rng(seed);
  const seen: { t: number; x: number; y: number; thr: number }[] = [];
  let sx = 0, sy = 0, thr = 0, nx = 0, ny = 0;
  const a = Math.min(1, STEP / human.lag), ou = Math.sqrt(2 * STEP / 0.5);
  for (let i = 0; i < 120 * 150 && !sim.outcome; i++) {
    const g = sim.guide, t = sim.ship.t;
    seen.push({ t, x: g.stick?.x ?? 0, y: g.stick?.y ?? 0, thr: g.throttle ?? thr });
    while (seen.length > 1 && seen[1].t <= t - human.delay) seen.shift();
    const c = seen[0];
    sx += (c.x - sx) * a; sy += (c.y - sy) * a; thr += (c.thr - thr) * a;
    nx += -nx * STEP / 0.5 + human.tremor * ou * gauss();
    ny += -ny * STEP / 0.5 + human.tremor * ou * gauss();
    const p = inGate(sx + nx, sy + ny);
    sim.setStick(p.x, p.y);
    sim.setThrottle(thr + (human.tremor ? 0.3 * human.tremor * gauss() * Math.sqrt(STEP) : 0));
    sim.step();
  }
  return sim;
}
