import { ARM_Y, CATCH, PIN_HALF, STEP } from './constants';
import { createGuide, updateGuide, type Guide } from './guidance';
import type { Mode } from './modes';
import { judge, pinPos, type Outcome } from './outcome';
import { createShip, physStep, type ShipState } from './physics';
import { Vector3 } from 'three';
import { ARM_TOP, SiteWorld } from './world';

const GUIDE_PERIOD = 0.1; // s of sim time between flight-computer updates
export const SPEEDS = [1, 0.5, 0.25] as const;

/**
 * Owns one flight: fixed-step physics, the flight computer, contact checks and game speed.
 * Rendering and UI read from it; they never change the physics directly.
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

  private acc = 0;
  private guideClock = 0;
  private pin = new Vector3();

  constructor(mode: Mode) {
    this.mode = mode;
    this.ship = createShip(mode.propellant);
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

  /** One fixed physics step plus contact checks and (periodically) the flight computer. */
  step() {
    if (this.outcome) return;
    const s = this.ship;
    const hits = physStep(s, STEP, { law: this.mode.law, wind: this.mode.wind }, this.world);
    if (s.prop <= 0) s.thr = 0;
    const out = judge(s, hits, this.mode.limits);
    if (out) {
      this.outcome = out;
      s.thr = 0;
      if (out.kind === 'caught') s.pos.y += ARM_TOP + PIN_HALF - pinPos(s, this.pin).y; // rest the pins on the arms
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

  /** Runs the flight computer now. Also drives the throttle in modes where it owns it. */
  runGuide() {
    const needed = this.mode.guides || this.mode.autoThrottle;
    if (!needed) return;
    updateGuide(this.ship, this.guide);
    if (this.mode.autoThrottle) this.ship.thr = this.guide.throttle ?? 0;
  }

  /** Release the Rapier world (WebAssembly memory). */
  dispose() {
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
