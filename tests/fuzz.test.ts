/// <reference types="node" />
import { beforeAll, expect, it } from 'vitest';
import type { ModeId } from '../src/sim/modes';
import { WHY } from '../src/sim/outcome';
import { initPhysics } from '../src/sim/world';
import { fly, randomHuman } from './pilot';

/**
 * Fuzzing: fly many descents with random pilots, from perfect to poor, and check rules that must hold on
 * every step of every flight, whoever flies. Cadet and Pilot only: the pilots follow the flight computer's
 * cues, which Expert does not have. Every flight is reproducible from its seed.
 * A quick run is part of the tests; for a long one: FUZZ_FLIGHTS=3000 npx vitest run tests/fuzz.test.ts
 */
const FLIGHTS = Number(process.env.FUZZ_FLIGHTS ?? 30);

beforeAll(() => initPhysics());

/** Every way the flight machine can end a flight ('crash.tower.mast', …). */
const OUTCOMES = Object.keys(WHY);

it(`${FLIGHTS} random pilots: every rule holds on every step`, () => {
  const broken = new Map<string, number>(); // 'seed 12 cadet: rule' → first time it broke
  const seen = new Map<string, number>();
  for (let seed = 1; seed <= FLIGHTS; seed++) {
    const mode = (['cadet', 'pilot'] as ModeId[])[seed % 2];
    let t = 0;
    const fail = (rule: string) => { const k = `seed ${seed} ${mode}: ${rule}`; if (!broken.has(k)) broken.set(k, t); };
    let firstAbort: string | null = null, prop = Infinity;
    const sim = fly(mode, randomHuman(seed), seed, (sim) => {
      const step = sim.step.bind(sim);
      sim.step = () => {
        step();
        const s = sim.ship, g = sim.guide;
        t = s.t;
        if (![s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.w.x, s.w.y, s.w.z, s.prop, s.thr, s.spool].every(Number.isFinite)) fail('a number is NaN or infinite');
        if (s.prop < 0) fail('negative propellant');
        if (s.prop > prop) fail('propellant went up');
        prop = s.prop;
        if (s.thr < 0 || s.thr > 1 || s.spool < 0 || s.spool > 1) fail('throttle or spool outside 0..1');
        if (Math.abs(s.q.length() - 1) > 1e-6) fail('orientation is not a unit quaternion');
        if (s.vel.length() > 600) fail('faster than 600 m/s');
        if ((g.phase === 'flip' || g.phase === 'light') && s.vel.y > 5 && (g.throttle ?? 0) > 0) fail('thrust cued while climbing in the flip');
        const ab = g.abort ? `${g.abort.mode}: ${g.abort.why}` : null;
        if (firstAbort && ab !== firstAbort) fail('an abort was changed or taken back');
        firstAbort ??= ab;
      };
    });
    const o = sim.outcome;
    if (!o) fail('the flight did not end within 300 s');
    else seen.set(o.cause, (seen.get(o.cause) ?? 0) + 1);
    sim.dispose();
  }
  if (process.env.FUZZ_FLIGHTS) {
    const counts = [...seen].sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${String(n).padStart(5)}  ${c}`);
    process.stdout.write(`\nOutcomes:\n${counts.join('\n')}\nNever reached: ${OUTCOMES.filter((c) => !seen.has(c)).join(', ') || 'none'}\n`);
  }
  expect([...broken].map(([k, at]) => `${k} (t=${at.toFixed(2)} s)`)).toEqual([]);
}, FLIGHTS * 4000);
