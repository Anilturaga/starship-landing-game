import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/world';
import { MODES } from '../src/sim/modes';
import { fly, PERFECT, TYPICAL } from './pilot';
import { Simulation } from '../src/sim/simulation';
import { tiltDeg } from '../src/sim/outcome';
import { deltaVLeft } from '../src/sim/physics';

beforeAll(() => initPhysics());

describe('flight model', () => {
  it('falls belly-first at a realistic terminal speed', () => {
    const sim = new Simulation(MODES.cadet);
    for (let i = 0; i < 120 * 10; i++) sim.step();
    expect(-sim.ship.vel.y).toBeGreaterThan(75);
    expect(-sim.ship.vel.y).toBeLessThan(95);
    expect(tiltDeg(sim.ship)).toBeGreaterThan(80);
  });

  it('burns propellant only while the engines run', () => {
    const sim = new Simulation(MODES.pilot);
    const p0 = sim.ship.prop;
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.ship.prop).toBe(p0);
    sim.setThrottle(0.5);
    for (let i = 0; i < 120 * 3; i++) sim.step();
    expect(sim.ship.prop).toBeLessThan(p0);
    expect(sim.ship.engines).toBe(2); // 50% of three engines needs two
  });

  it('zero throttle shuts the engines down', () => {
    const sim = new Simulation(MODES.pilot);
    sim.setThrottle(0.3);
    for (let i = 0; i < 120 * 2; i++) sim.step();
    expect(sim.ship.thrust).toBeGreaterThan(0);
    sim.setThrottle(0);
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.ship.thrust).toBe(0);
  });

  it('detects hitting the tower through Rapier colliders', () => {
    const sim = new Simulation(MODES.pilot);
    sim.ship.pos.set(-5.5, 200, 0);
    for (let i = 0; i < 120 * 10 && !sim.outcome; i++) sim.step();
    expect(sim.outcome?.why).toBe('The Ship hit the tower.');
  });

  it('reports delta-v that shrinks with propellant', () => {
    expect(deltaVLeft(34_000)).toBeGreaterThan(deltaVLeft(10_000));
    expect(deltaVLeft(0)).toBe(0);
  });
});

describe('following the flight computer', () => {
  it.each(['cadet', 'pilot'] as const)('a perfect follower catches the Ship in %s mode', (mode) => {
    const sim = fly(mode, PERFECT);
    expect(sim.outcome?.kind, sim.outcome?.why).toBe('caught');
  });

  // a person sees the cue ~0.45 s late, moves their thumb with a lag, and trembles
  it.each(['cadet', 'pilot'] as const)('a typical player catches the Ship in %s mode, every time', (mode) => {
    const missed: string[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const o = fly(mode, TYPICAL, seed).outcome;
      if (o?.kind !== 'caught') missed.push(`seed ${seed}: ${o?.why}`);
    }
    expect(missed).toEqual([]);
  });

  it('keeps every stick cue inside the stick travel', () => {
    let worst = 0;
    fly('pilot', TYPICAL, 1, (sim) => {
      const step = sim.step.bind(sim);
      sim.step = () => { step(); const c = sim.guide.stick; if (c) worst = Math.max(worst, Math.hypot(c.x, c.y)); };
    });
    expect(worst).toBeLessThanOrEqual(0.851);
  });

  it('diverts to the ocean when the tower is out of reach near the coast', () => {
    const sim = fly('pilot', PERFECT, 1, (s) => { s.ship.pos.x = 1250; s.ship.pos.z = -500; });
    expect(sim.guide.abort?.mode).toBe('ocean');
    expect(sim.outcome?.kind).toBe('ocean');
    expect(sim.outcome?.siteSafe).toBe(true);
  });

  it('sets down clear of the tower when the ocean is out of reach too', () => {
    const sim = fly('pilot', PERFECT, 1, (s) => { s.ship.pos.x = -700; s.ship.pos.z = 300; });
    expect(sim.guide.abort?.mode).toBe('clear');
    expect(sim.outcome?.kind).not.toBe('caught');
    expect(sim.outcome?.siteSafe).toBe(true);
  });
});
