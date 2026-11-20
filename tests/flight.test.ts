import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/world';
import { MODES, type ModeId } from '../src/sim/modes';
import { Simulation } from '../src/sim/simulation';
import { tiltDeg } from '../src/sim/outcome';
import { deltaVLeft } from '../src/sim/physics';

beforeAll(() => initPhysics());

/** Flies a whole descent by doing exactly what the flight computer's cues say. */
function flyByCues(modeId: ModeId, setup?: (sim: Simulation) => void) {
  // fly with cues even in modes that hide them, so every mode is checked against the same pilot
  const sim = new Simulation({ ...MODES[modeId], guides: true });
  setup?.(sim);
  sim.running = true;
  sim.runGuide();
  for (let i = 0; i < 120 * 150 && !sim.outcome; i++) {
    const g = sim.guide;
    sim.setStick(g.stick?.x ?? 0, g.stick?.y ?? 0);
    if (g.throttle != null) sim.setThrottle(g.throttle);
    sim.step();
  }
  return sim;
}

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
  it.each(['cadet', 'pilot'] as const)('catches the Ship in %s mode', (mode) => {
    const sim = flyByCues(mode);
    expect(sim.outcome?.kind, sim.outcome?.why).toBe('caught');
  });

  it('diverts to the ocean when the tower is out of reach near the coast', () => {
    const sim = flyByCues('pilot', (s) => { s.ship.pos.x = 1250; s.ship.pos.z = -500; });
    expect(sim.guide.abort?.mode).toBe('ocean');
    expect(sim.outcome?.kind).toBe('ocean');
    expect(sim.outcome?.siteSafe).toBe(true);
  });

  it('sets down clear of the tower when the ocean is out of reach too', () => {
    const sim = flyByCues('pilot', (s) => { s.ship.pos.x = -700; s.ship.pos.z = 300; });
    expect(sim.guide.abort?.mode).toBe('clear');
    expect(sim.outcome?.kind).not.toBe('caught');
    expect(sim.outcome?.siteSafe).toBe(true);
  });
});
