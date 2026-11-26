import fc from 'fast-check';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { beforeAll, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { flightMachine, within, type Measured } from '../src/sim/flight';
import { MODES } from '../src/sim/modes';
import { tiltDeg } from '../src/sim/outcome';
import { Simulation } from '../src/sim/simulation';
import { initPhysics, type Hit } from '../src/sim/world';

/**
 * Property tests: a rule, checked on hundreds of inputs fast-check picks at random (and shrinks to the simplest
 * failing one). Fixed seeds, so every run tries the same inputs.
 */
beforeAll(() => initPhysics());

/**
 * A Cadet Ship 800 m up with its engines running that stood upright, then tipped `tilt`° over toward `lean`°
 * (0 = its belly, 180 = its back): past 60° the flight machine puts it back into the flip.
 */
function tippedShip(tilt: number, lean: number) {
  const sim = new Simulation(MODES.cadet);
  const s = sim.ship;
  s.q.setFromRotationMatrix( // upright, belly toward -x
    new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)));
  s.pos.set(250, 800, 0); s.vel.set(-10, -40, 0);
  s.spool = 1; s.thr = 0.3; s.prop = 25000;
  sim.step(); // the flight machine sees it upright
  const r = (lean * Math.PI) / 180;
  const axis = new Vector3(0, 1, 0).cross(new Vector3(-Math.cos(r), 0, Math.sin(r))).normalize();
  s.q.premultiply(new Quaternion().setFromAxisAngle(axis, (tilt * Math.PI) / 180));
  s.w.set(0, 0, 0);
  sim.runGuide(); // first cue now; then the flight computer runs ten times a second as the sim steps
  return sim;
}

it('B3: following the flip cue stands a tipped-over Ship back up, whichever way it tipped', () => {
  fc.assert(fc.property(fc.integer({ min: 61, max: 85 }), fc.integer({ min: 0, max: 359 }), (tilt, lean) => {
    const sim = tippedShip(tilt, lean);
    for (let i = 0; i < 120 * 3 && !sim.outcome; i++) {
      const c = sim.guide.stick ?? { x: 0, y: 0 };
      sim.setStick(c.x, c.y);
      sim.step();
    }
    const end = tiltDeg(sim.ship);
    sim.dispose();
    return end < tilt;
  }), { numRuns: 100, seed: 42 });
});

it('B5: the arms verdict: caught only within limits, and "one arm" only when nothing else was wrong', () => {
  const limits = MODES.pilot.limits;
  const contact = fc.constantFrom<Hit>('arms', 'arm-open');
  fc.assert(fc.property(contact, fc.double({ min: 0, max: 40, noNaN: true }), fc.double({ min: 0, max: 6, noNaN: true }),
    fc.double({ min: 0, max: 8, noNaN: true }), fc.double({ min: 0, max: 20, noNaN: true }), (hit, descent, sideways, offset, tilt) => {
      const a = createActor(flightMachine, { input: { limits } }).start();
      const m: Measured = {
        hits: new Set([hit]), prop: 10_000, q: 0, qSide: 0, speed: Math.hypot(descent, sideways),
        offset, descent, sideways, tilt, inOcean: false, overArms: true, aboveArms: 0,
      };
      a.send({ type: 'STEP', m });
      expect(a.getSnapshot().value.outcome).toEqual(!within(m, limits) ? { crash: 'armsOverLimit' } : hit === 'arms' ? 'caught' : { crash: 'armOpen' });
    }), { numRuns: 500, seed: 7 });
});
