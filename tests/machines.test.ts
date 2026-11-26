import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { MODES } from '../src/sim/modes';
import { Simulation } from '../src/sim/simulation';
import { initPhysics } from '../src/sim/world';
import { flightMachine } from '../src/sim/flight';
import { screenMachine } from '../src/state/screen';
import { fly, PERFECT } from './pilot';

beforeAll(() => initPhysics());

/** Steps a flight until it ends (at most `seconds`), and returns how it ended. */
function run(sim: Simulation, seconds = 10) {
  for (let i = 0; i < 120 * seconds && !sim.outcome; i++) sim.step();
  return sim.outcome;
}

describe('flight machine: new ways a flight can end', () => {
  it('breaks up when the air load is too high at any attitude', () => {
    const sim = new Simulation(MODES.pilot);
    sim.ship.pos.set(400, 1500, 0);
    sim.ship.vel.set(0, -260, 0);
    expect(run(sim)?.cause).toBe('crash.breakup.overspeed');
  });

  it('breaks up broadside to the airflow well above belly-flop speed', () => {
    const sim = new Simulation(MODES.pilot); // starts belly-down: the fall is pure crossflow
    sim.ship.pos.set(400, 300, 0);
    sim.ship.vel.set(0, -150, 0);
    expect(run(sim)?.cause).toBe('crash.breakup.broadside');
  });

  it('a belly-flop falling all the way to the ground does not break up', () => {
    expect(run(new Simulation(MODES.pilot), 60)?.cause).toBe('crash.surface');
  });

  it('tells the arm carriage apart from the mast', () => {
    const sim = new Simulation(MODES.pilot);
    // upright, pins pointing along z (clear of the tower), drifting into the carriage just below the arms
    sim.ship.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    sim.ship.pos.set(6.5, 80, 0);
    sim.ship.vel.set(-3, 0, 0);
    expect(run(sim)?.cause).toBe('crash.tower.carriage');
  });

  it('tells the quick-disconnect arm apart from the mast', () => {
    const sim = new Simulation(MODES.pilot);
    sim.ship.q.identity();
    sim.ship.pos.set(-4.5, 114, -30);
    sim.ship.vel.set(0, 0, 4);
    expect(run(sim)?.cause).toBe('crash.tower.qdArm');
  });
});

describe('flight machine: propulsion', () => {
  it('loses one engine when the tanks run low, then all of them when dry, and falls', () => {
    const sim = new Simulation(MODES.pilot);
    sim.ship.prop = 2600;
    sim.setThrottle(1);
    const seen: string[] = [];
    for (let i = 0; i < 120 * 60 && !sim.outcome; i++) {
      const available = sim.ship.available; // decided after the previous step, used by this one
      sim.step();
      expect(sim.ship.engines).toBeLessThanOrEqual(available);
      expect(Number.isFinite(sim.ship.pos.y)).toBe(true);
      const p = sim.flight.getSnapshot().value.propulsion;
      if (seen.at(-1) !== p) seen.push(p);
    }
    expect(seen).toEqual(['nominal', 'engineOut', 'starved']);
    expect(sim.outcome?.why).toMatch(/The tanks had run dry\.$/);
  });
});

describe('flight machine: flight computer', () => {
  it('is off in Expert: no phase changes, no cues, never an abort', () => {
    const sim = new Simulation(MODES.expert);
    sim.runGuide();
    for (let i = 0; i < 120 * 20; i++) sim.step();
    expect(sim.computer).toBeNull();
    expect(sim.guide.stick).toBeNull();
  });

  it('walks glide → light → flip → descend on a catch, and the arms close then hold', () => {
    const phases: string[] = [], arms: string[] = [];
    fly('cadet', PERFECT, 1, (sim) => {
      const step = sim.step.bind(sim);
      sim.step = () => {
        step();
        const v = sim.flight.getSnapshot().value;
        if (phases.at(-1) !== sim.guide.phase) phases.push(sim.guide.phase);
        if (arms.at(-1) !== v.arms) arms.push(v.arms);
      };
    });
    expect(phases).toEqual(['glide', 'light', 'flip', 'descend']);
    expect(arms).toEqual(['open', 'closing']);
  });

  it('the arms hold where they are once the pins are level with them, and open when the Ship leaves', () => {
    const a = createActor(flightMachine, { input: { limits: MODES.pilot.limits } }).start();
    const at = (aboveArms: number, overArms = true) => {
      a.send({ type: 'STEP', m: { hits: new Set(), prop: 1e4, q: 0, qSide: 0, speed: 1, offset: 0, descent: 1, sideways: 0, tilt: 0, inOcean: false, overArms, aboveArms } });
      return a.getSnapshot().value.arms;
    };
    expect([at(50), at(10), at(0.1), at(10), at(10, false)]).toEqual(['open', 'closing', 'holding', 'closing', 'open']);
  });
});

describe('screen machine', () => {
  it('goes menu → flying → ended → flying → paused → flying → ended → menu', () => {
    const a = createActor(screenMachine).start();
    const seen = [a.getSnapshot().value];
    for (const type of ['FINISH', 'START', 'FINISH', 'START', 'MENU', 'RESUME', 'FINISH', 'MENU'] as const) {
      a.send({ type });
      seen.push(a.getSnapshot().value);
    }
    expect(seen).toEqual(['menu', 'menu', 'flying', 'ended', 'flying', 'paused', 'flying', 'ended', 'menu']);
  });
});

