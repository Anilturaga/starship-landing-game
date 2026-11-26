import { inGate } from '../src/sim/control';
import { STEP } from '../src/sim/constants';
import { MODES, type ModeId } from '../src/sim/modes';
import { Simulation } from '../src/sim/simulation';

/**
 * A player: sees cues `delay` s late, moves their thumb with a `lag` s time constant, and trembles. `slips` per
 * second, they make a mistake for a moment: a jab of the stick, letting go, or slamming it to the edge.
 */
export interface Human { delay: number; lag: number; tremor: number; slips?: number }
export const TYPICAL: Human = { delay: 0.45, lag: 0.25, tremor: 0.06 };
export const PERFECT: Human = { delay: 0, lag: STEP, tremor: 0 };

export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u()) };
}

/** Anyone from a perfect pilot to a poor one (mostly near typical), for fuzzing. */
export function randomHuman(seed: number): Human {
  const { u } = rng(seed ^ 0x5bd1e995);
  const k = u() ** 2; // 0 perfect … 1 poor, weighted toward the good end
  return { delay: k * 1.2, lag: 0.02 + k * 0.8, tremor: k * 0.3, slips: u() < 0.5 ? 0 : u() * 0.3 };
}

/** Flies a whole descent (up to 300 s) by following the flight computer's cues the way a person would. */
export function fly(modeId: ModeId, human: Human = PERFECT, seed = 1, setup?: (sim: Simulation) => void) {
  // fly with cues even in modes that hide them, so every mode is checked against the same pilot
  const sim = new Simulation({ ...MODES[modeId], guides: true });
  setup?.(sim);
  sim.running = true;
  sim.runGuide();
  const { u, gauss } = rng(seed);
  const seen: { t: number; x: number; y: number; thr: number }[] = [];
  let sx = 0, sy = 0, thr = 0, nx = 0, ny = 0;
  let slip: { until: number; x: number; y: number; thr: number } | null = null;
  const a = Math.min(1, STEP / human.lag), ou = Math.sqrt(2 * STEP / 0.5);
  for (let i = 0; i < 120 * 300 && !sim.outcome; i++) {
    const g = sim.guide, t = sim.ship.t;
    seen.push({ t, x: g.stick?.x ?? 0, y: g.stick?.y ?? 0, thr: g.throttle ?? thr });
    while (seen.length > 1 && seen[1].t <= t - human.delay) seen.shift();
    const c = seen[0];
    sx += (c.x - sx) * a; sy += (c.y - sy) * a; thr += (c.thr - thr) * a;
    nx += -nx * STEP / 0.5 + human.tremor * ou * gauss();
    ny += -ny * STEP / 0.5 + human.tremor * ou * gauss();
    if (slip && t > slip.until) slip = null;
    if (!slip && human.slips && u() < human.slips * STEP) {
      const k = u(), an = u() * 2 * Math.PI, r = k < 0.4 ? 0 : k < 0.7 ? 0.5 : 1.5; // let go, jab, or slam
      slip = { until: t + 0.2 + u() * 3, x: Math.cos(an) * r, y: Math.sin(an) * r, thr: k < 0.4 ? (u() < 0.5 ? 0 : -1) : u() };
    }
    const p = inGate(slip ? slip.x : sx + nx, slip ? slip.y : sy + ny);
    sim.setStick(p.x, p.y);
    sim.setThrottle(slip && slip.thr >= 0 ? slip.thr : thr + (human.tremor ? 0.3 * human.tremor * gauss() * Math.sqrt(STEP) : 0));
    sim.step();
  }
  return sim;
}
