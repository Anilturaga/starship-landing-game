import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CATCH, PIN_OFFSET } from '../src/sim/constants';
import { MODES } from '../src/sim/modes';
import { pinPos, tiltDeg } from '../src/sim/outcome';
import { Simulation } from '../src/sim/simulation';
import { ARM_TOP, initPhysics } from '../src/sim/world';
import { fly, PERFECT } from './pilot';

/** Each bug found by fuzzing and review, replayed: the flight that showed it now goes right. */
beforeAll(() => initPhysics());

/** A perfect Cadet pilot, except that `own` overrides the stick when it returns something. */
function flyWith(own: (sim: Simulation) => { x: number; y: number } | null) {
  return fly('cadet', PERFECT, 1, (sim) => {
    const set = sim.setStick.bind(sim);
    sim.setStick = (x, y) => { const o = own(sim); set(o?.x ?? x, o?.y ?? y); };
  });
}

describe('replayed bugs', () => {
  it('B1: letting go mid-flip never sends the Ship climbing on its engines', () => {
    let from = 0, top = 0;
    const sim = flyWith((sim) => {
      const s = sim.ship;
      if (!from && s.ref === 'flip' && tiltDeg(s) < 50) from = s.pos.y;
      if (from) top = Math.max(top, s.pos.y);
      return from ? { x: 0, y: 0 } : null;
    });
    expect(sim.outcome).not.toBeNull();
    expect(top - from).toBeLessThan(50); // before: climbed 2 km on full, then minimum, thrust
  });

  it('B2: arriving with the pins turned off the arms, the Ship rolls them in line and is caught', () => {
    const sim = flyWith((sim) => (sim.ship.t < 10 ? { x: 1, y: 0 } : null));
    expect(sim.outcome?.cause).toBe('caught'); // before: "came down on one arm", within every limit
  });

  it('B4: over the arms but off centre, the Ship hovers until lined up instead of creeping onto them', () => {
    const sim = new Simulation(MODES.pilot);
    const s = sim.ship;
    s.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // upright, pins along the arms
    s.pos.set(CATCH.x + 3, ARM_TOP + 0.8 - PIN_OFFSET, 0); // pins 0.8 m above the arms, 3 m off centre,
    s.vel.set(0.5, 0, 0); // and drifting away,
    s.spool = 1; s.thr = 0.3; // engines running
    sim.runGuide();
    for (let i = 0; i < 120 * 20 && !sim.outcome; i++) {
      const g = sim.guide;
      sim.setStick(g.stick?.x ?? 0, g.stick?.y ?? 0);
      sim.setThrottle(g.throttle ?? 0);
      sim.step();
    }
    if (sim.outcome) expect(sim.outcome.cause).toBe('caught'); // before: struck the arms 3 m off
    else expect(pinPos(s).y).toBeGreaterThan(ARM_TOP); // or still hovering above them
  });

  it('Q2: the flight computer runs ten times a second', () => {
    const sim = new Simulation(MODES.cadet);
    let runs = 0;
    const run = sim.runGuide.bind(sim);
    sim.runGuide = () => { runs++; run(); };
    for (let i = 0; i < 120 * 10; i++) sim.step();
    expect(runs).toBe(100); // before: 92, every 13 steps
  });
});
