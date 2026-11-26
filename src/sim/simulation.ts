import { Vector3 } from 'three';
import { createActor } from 'xstate';
import { ARM_Y, CATCH, PIN_HALF, SL_ENGINES, STEP } from './constants';
import { attitudeMachine, computerMachine, flightMachine } from './flight';
import { createGuide, observe, steer, type Guide } from './guidance';
import type { Mode } from './modes';
import { measure, outcomeOf, pinPos, type Outcome } from './outcome';
import { createShip, physStep, type Env, type ShipState } from './physics';
import { ARM_TOP, SiteWorld } from './world';

/** The deepest active state, as a dotted path (e.g. 'crash.tower.mast'). */
function leaf(v: unknown): string {
  if (typeof v === 'string') return v;
  const [k, sub] = Object.entries(v as Record<string, unknown>)[0];
  return `${k}.${leaf(sub)}`;
}

const GUIDE_PERIOD = 0.1; // s of sim time between flight-computer updates
export const SPEEDS = [1, 0.5, 0.25] as const;

/**
 * Owns one flight: fixed-step physics, the machines that take every discrete decision (flight.ts),
 * the flight computer's cues and game speed. Rendering and UI read from it; they never change the physics directly.
 */
export class Simulation {
  readonly mode: Mode;
  ship: ShipState;
  /** Rapier world: integrates the Ship and detects contacts. Needs initPhysics() first. */
  readonly world = new SiteWorld();
  guide: Guide = createGuide();
  outcome: Outcome | null = null;
  running = false;

  /** Manual speed choice index into SPEEDS. */
  speedIndex = 0;
  /** The player touched the speed control this flight, so auto slow-mo stays off. */
  speedTouched = false;
  autoSlow = false;
  timeScale = 1;

  /** The machines that take every discrete decision of this flight (flight.ts); no computer in Expert. */
  readonly attitude = createActor(attitudeMachine).start();
  readonly computer;
  readonly flight;
  private env: Env;
  private acc = 0;
  private guideClock = 0;
  private pin = new Vector3();

  constructor(mode: Mode) {
    this.mode = mode;
    this.ship = createShip(mode.propellant);
    this.computer = mode.guides || mode.autoThrottle ? createActor(computerMachine).start() : null;
    this.flight = createActor(flightMachine, { input: { limits: mode.limits } }).start();
    this.env = {
      law: mode.law,
      wind: mode.wind,
      attitude: (tilt, lit) => {
        this.attitude.send({ type: 'ATTITUDE', tilt, lit });
        return this.attitude.getSnapshot().value;
      },
    };
  }

  /** Throttle the player asks for; ignored when the flight computer owns the throttle. */
  setThrottle(v: number) {
    if (!this.mode.autoThrottle) this.ship.thr = Math.min(1, Math.max(0, v));
  }
  setStick(x: number, y: number) {
    this.ship.inp.x = Math.max(-1, Math.min(1, x));
    this.ship.inp.y = Math.max(-1, Math.min(1, y));
  }
  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
    this.speedTouched = true;
  }

  /** One fixed physics step; the flight machine then decides on what it measured. */
  step() {
    if (this.outcome) return;
    const s = this.ship;
    this.world.moveArms(s, this.flight.getSnapshot().value.arms);
    const m = measure(s, physStep(s, STEP, this.env, this.world));
    this.flight.send({ type: 'STEP', m });
    const { propulsion, outcome } = this.flight.getSnapshot().value;
    // guidance still sizes its throttle for three engines: with one out, the most it gets is two thirds
    s.available = propulsion === 'nominal' ? SL_ENGINES : SL_ENGINES - 1;
    if (propulsion === 'starved') s.thr = 0;
    if (outcome !== 'flying') {
      const cause = leaf(outcome);
      this.outcome = outcomeOf(cause, m, this.mode.limits, s.t, propulsion === 'starved');
      s.thr = 0;
      if (cause === 'caught') s.pos.y += ARM_TOP + PIN_HALF - pinPos(s, this.pin).y; // rest the pins on the arms
      s.vel.set(0, 0, 0);
      s.w.set(0, 0, 0);
      return;
    }
    this.guideClock += STEP;
    if (this.guideClock >= GUIDE_PERIOD) {
      this.guideClock = 0;
      this.runGuide();
    }
  }

  /** Runs the flight computer now: its machine decides the phase and any abort, then it works out the cues. */
  runGuide() {
    if (!this.computer) return; // Expert: no flight computer
    const { tick, view } = observe(this.ship);
    this.computer.send({ type: 'GUIDE', tick });
    const { value, context } = this.computer.getSnapshot();
    const g = this.guide;
    g.phase = value.phase;
    g.abort = value.abort === 'none' ? null : { mode: value.abort, why: context.why! };
    steer(view, g);
    if (this.mode.autoThrottle) this.ship.thr = g.throttle ?? 0;
  }

  /** Stop the machines and release the Rapier world (WebAssembly memory). */
  dispose() {
    this.attitude.stop();
    this.computer?.stop();
    this.flight.stop();
    this.world.free();
  }

  /** Advance by real elapsed time (seconds), honouring slow motion. */
  update(realDt: number) {
    const dt = Math.min(0.1, realDt);
    this.updateTimeScale(dt);
    if (!this.running || this.outcome) { this.acc = 0; return; }
    this.acc += dt * this.timeScale;
    while (this.acc >= STEP && !this.outcome) {
      this.step();
      this.acc -= STEP;
    }
  }

  private updateTimeScale(dt: number) {
    const s = this.ship;
    const pin = pinPos(s, this.pin);
    const dTower = Math.hypot(pin.x - CATCH.x, pin.z - CATCH.z);
    this.autoSlow = this.mode.autoSlowMo && !this.speedTouched && this.ship.ref === 'upright' && !this.guide.abort
      && pin.y - ARM_Y < 220 && dTower < 90 && !this.outcome;
    const want = this.autoSlow ? 0.5 : SPEEDS[this.speedIndex];
    this.timeScale += (want - this.timeScale) * Math.min(1, dt * 3);
  }
}
