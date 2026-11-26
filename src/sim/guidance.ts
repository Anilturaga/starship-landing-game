import { Vector3 } from 'three';
import {
  ARM_REACH, ARM_Y, ARMS, CATCH, DRY_MASS, ENGINE_OUT_PROP, FLIP_ALT, G0, HALF, MAX_TILT, PIN_OFFSET, RADIUS, RAPTOR_THRUST, shoreX, SL_ENGINES, THROTTLE_OFF,
} from './constants';
import { BELLY_PITCH, inGate } from './control';
import type { GuideTick } from './flight';
import { bodyAxes, deltaVLeft, type ShipState } from './physics';

/**
 * The flight computer. It suggests a stick position and a throttle in the terms of the `attitude`
 * fly-by-wire law (control.ts), so a cue is a place to put your thumb, not a correction to chase.
 *
 * Cues are computed for where the Ship will be LEAD seconds from now, which covers a player's
 * reaction time, and stay inside GATE of the stick's round travel so they are always reachable.
 * tests/flight.test.ts flies whole descents with a simulated human (delay, lag, tremor) to keep it honest.
 */
export const LEAD = 0.4; // s
const GATE = 0.85;
/**
 * The glide points the nose at the catch and arrives at flip altitude this far out: the flip carries the
 * Ship forward and the braking takes room, and both should happen short of the tower.
 */
const ENTRY = 260;
/** Sideways distance the upright descent can cover from the flip down (see the upright rule in assess). */
/** Hull length below the pins. */
const HULL_BELOW = HALF + PIN_OFFSET;
const UPRIGHT_REACH = 7 * (Math.sqrt(FLIP_ALT - ARM_Y) + 15);
const MAX_THRUST = SL_ENGINES * RAPTOR_THRUST;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const deg = (r: number) => (r * 180) / Math.PI;

export type GuidePhase = 'glide' | 'light' | 'flip' | 'descend';
export interface Abort {
  why: string;
  /** Head for the Gulf, or set down on open ground away from the tower. */
  mode: 'ocean' | 'clear';
}

/** The flight computer's suggestion. null = no cue for that control. */
export interface Guide {
  phase: GuidePhase;
  stick: { x: number; y: number } | null;
  throttle: number | null;
  abort: Abort | null;
}

export const createGuide = (): Guide => ({ phase: 'glide', stick: null, throttle: null, abort: null });

/** What the computer looks at, predicted LEAD seconds ahead. */
export interface View {
  A: Vector3; BX: Vector3; BZ: Vector3;
  pin: Vector3; base: Vector3; vel: Vector3; vh: Vector3;
  vs: number; tilt: number; alt: number; hArm: number; mass: number; lit: boolean;
}

const ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };

function look(s: ShipState): View {
  const { x: BX, y: A, z: BZ } = bodyAxes(s.q, ax);
  // Lead by LEAD seconds: positions from velocity, velocity from the current thrust and gravity
  // (not from measured acceleration, which would feed the throttle back into itself).
  const mass = DRY_MASS + s.prop;
  const pos = s.pos.clone().addScaledVector(s.vel, LEAD);
  const pin = pos.clone().addScaledVector(A, PIN_OFFSET);
  const base = pos.clone().addScaledVector(A, -HALF);
  const vel = s.vel.clone().addScaledVector(A, (s.thrust / mass) * LEAD);
  vel.y -= G0 * LEAD;
  const vh = new Vector3(vel.x, 0, vel.z);
  return {
    A, BX, BZ, pin, base, vel, vh,
    vs: -vel.y,
    tilt: deg(Math.acos(clamp(A.y, -1, 1))),
    alt: base.y,
    hArm: pin.y - ARM_Y,
    mass,
    lit: s.thr > THROTTLE_OFF,
  };
}

/** Whether a catch is still possible, and if not, where to go instead: the Gulf if in reach, otherwise open ground. */
function assess(s: ShipState, v: View, belly: boolean): Abort | null {
  const dTower = Math.hypot(CATCH.x - v.pin.x, CATCH.z - v.pin.z);
  const dvNeed = v.vel.length() + 9.81 * clamp(v.hArm / 15, 6, 40) * 0.8 + dTower * 0.04;
  const glide = (Math.max(0, v.alt - FLIP_ALT) / Math.max(v.vs, 1)) * 30 + 120;
  let why: string | null = null;
  if (deltaVLeft(s.prop) < dvNeed) why = 'Not enough propellant left to stop at the tower.';
  // the glide, plus what the upright descent can still cover after the flip
  else if (belly && v.alt < FLIP_ALT + 900 && dTower > glide + UPRIGHT_REACH) why = 'The tower is out of glide range.';
  // upright: time left on the descent profile (dh/dt = 2√h gives √h seconds) plus the creep near the arms,
  // flown at the 7 m/s approach speed
  else if (s.ref === 'upright' && dTower > 20 + 7 * (Math.sqrt(Math.max(0, v.hArm)) + 15)) why = 'Too far from the tower to reach it this low.';
  if (!why) return null;
  const dOcean = Math.max(0, shoreX(v.pin.z) + 150 - v.pin.x);
  let reach: number;
  if (belly) reach = glide + 250;
  else { const t = Math.max(3, v.base.y / Math.max(v.vs, 4)); reach = Math.max(0, v.vel.x * t) + 0.5 * 2.5 * t * t; }
  return { why, mode: dOcean < reach ? 'ocean' : 'clear' };
}

/** Lined up between the open arms, where the hull can go below their top without touching them. */
const inCorridor = (p: Vector3) => Math.abs(p.z - CATCH.z) < ARMS.open - RADIUS - 1.5;

/** Where to go: the catch axis, or an abort site. */
function targetOf(v: View, g: Guide) {
  const ab = g.abort;
  const t = new Vector3(CATCH.x, 0, CATCH.z);
  // low and beside the arms: line up out past their tips first, then move in between them
  if (!ab && v.hArm < HULL_BELOW + 12 && !inCorridor(v.pin)) t.set(ARM_REACH.x1 + RADIUS + 10, 0, CATCH.z);
  if (ab?.mode === 'ocean') t.set(Math.max(shoreX(v.pin.z) + 450, v.pin.x + 60), 0, v.pin.z);
  else if (ab) {
    const away = new Vector3(v.pin.x - CATCH.x, 0, v.pin.z - CATCH.z);
    if (away.lengthSq() < 1) away.set(1, 0, 0);
    const dTower = away.length();
    t.addScaledVector(away.normalize(), Math.max(320, dTower + 40));
  }
  const to = new Vector3(t.x - v.pin.x, 0, t.z - v.pin.z);
  const d = to.length();
  return { d, dir: d > 0 ? to.divideScalar(d) : to };
}

/** Belly-flop: aim the nose, pitch down to glide or up to brake, to arrive ~120 m short of the target. */
function glide(v: View, g: Guide, d: number, dir: Vector3) {
  const l = Math.hypot(v.A.x, v.A.z) || 1;
  const heading = deg(Math.atan2((v.A.z * dir.x - v.A.x * dir.z) / l, (v.A.x * dir.x + v.A.z * dir.z) / l));
  const tLeft = Math.max(1, (v.alt - FLIP_ALT) / Math.max(v.vs, 1));
  const need = clamp((d - (g.abort ? 0 : ENTRY)) / tLeft, -15, 40);
  const pitch = clamp(need * 0.6 + (need - v.vh.dot(dir)) * 0.6, -25, 25);
  return { x: -heading / 35, y: pitch / deg(BELLY_PITCH) };
}

/** Upright: lean toward the target (small-angle: tilt = horizontal acceleration / g), descend on a profile. */
function descend(v: View, g: Guide, d: number, dir: Vector3) {
  const ab = g.abort;
  const over = ab ? (ab.mode === 'ocean' ? v.pin.x > shoreX(v.pin.z) + 40 : d < 60) : false;
  const toOcean = ab?.mode === 'ocean' && !over;
  const h = ab ? v.base.y : v.hArm;
  // target descent rate: 2 m/s² braking profile, easing to ~1 m/s for the last metres onto the arms
  let vt = h > 0 ? clamp(Math.min(Math.sqrt(4 * h), 1 + 0.25 * h), 1, 60) : 0;
  // close to the arms, creep down until lined up and steady, as a pilot would
  // in the last 2 m, more than 2 m off centre, it hovers instead (creeping lower would set it down past the
  // limit) until lined up or the tanks are down to the engine-out reserve
  const hover = h <= 2 && d >= 2 && v.mass - DRY_MASS > ENGINE_OUT_PROP;
  if (!ab && h < 60 && (d > 1.5 || v.vh.length() > 1.2)) vt = Math.min(vt, hover ? 0 : 0.3 + Math.max(0, h - 10) * 0.1);
  // the hull hangs 40 m below the pins: keep it above the arms until it is in the corridor between them
  if (!ab && !inCorridor(v.pin) && d < 90) vt = Math.min(vt, h > HULL_BELOW + 7 ? Math.sqrt(2.5 * (h - HULL_BELOW - 7)) : -1);
  if (toOcean) vt = clamp(Math.min(vt, h / Math.max(1, d / 22)), 2, 60); // slow down to buy time
  const ah = dir.clone().multiplyScalar(clamp(d * 0.18, 0, toOcean ? 28 : ab ? 14 : 7)).sub(v.vh).multiplyScalar(0.35);
  if (over) ah.copy(v.vh).multiplyScalar(-0.4);
  const fwd = new Vector3(v.BZ.x, 0, v.BZ.z).normalize(), side = new Vector3(v.BX.x, 0, v.BX.z).normalize();
  const k = 1 / (G0 * Math.tan(MAX_TILT));
  const aNeed = G0 + 1.5 * (v.vs - vt); // gentle enough for a player's reaction time
  return {
    stick: { x: ah.dot(side) * k, y: ah.dot(fwd) * k },
    throttle: clamp((aNeed * v.mass) / Math.max(0.5, Math.cos((v.tilt * Math.PI) / 180)) / MAX_THRUST, 0.05, 1),
  };
}

/**
 * The flip burn, from the descent rate `vs` (m/s, + falling), the height `h` (m, at least 1) to stop in, and
 * whether the engines are `lit`: off while climbing (even minimum thrust lifts a nearly empty Ship, so only
 * cutting the engines stops a climb), and once off, until falling faster than 5 m/s (so they cut and relight seconds apart, not every step);
 * braking harder than minimum when needing more than 3 m/s² to stop (vs²/2h > 3), spun up and with the nose
 * well up (tilt < 45°, or the burn would push the Ship forward); else minimum.
 * Proved to cut the engines whenever climbing, and to brake only while falling: verification/Guidance.lean.
 */
export function flipBurn(vs: number, h: number, tilt: number, spun: boolean, lit: boolean): 'off' | 'min' | 'brake' {
  if (vs < -1 || (!lit && vs < 5)) return 'off';
  return (vs * vs) / (2 * h) > 3 && spun && tilt < 45 ? 'brake' : 'min';
}

/**
 * The flip cue: turn whichever way raises the nose, from how much the side (`bxY`) and the belly (`bzY`) point up.
 * From the belly-flop that is straight back; tipped over from upright it can be any direction.
 * Proved to raise the nose whichever way the Ship leans: verification/Guidance.lean.
 */
export function flipCue(bxY: number, bzY: number) {
  const n = Math.hypot(bxY, bzY) || 1;
  return { x: (-GATE * bxY) / n, y: (GATE * bzY) / n };
}

/**
 * What the flight computer sees on one of its ticks (ten a second): what the flight machine (flight.ts) needs
 * to decide its phase and whether to abort, and the view `steer` works the cues out from.
 */
export function observe(s: ShipState): { tick: GuideTick; view: View } {
  const v = look(s);
  return {
    view: v,
    tick: {
      upright: s.ref === 'upright',
      lit: v.lit,
      spun: v.lit && s.spool > 0.3,
      low: v.alt < FLIP_ALT + 60,
      lost: assess(s, v, s.ref === 'belly' && !v.lit),
    },
  };
}

/** Sets the cues in `g` for the phase and abort the flight machine decided. */
export function steer(v: View, g: Guide) {
  const { d, dir } = targetOf(v, g);
  let stick: { x: number; y: number };
  g.throttle = null;
  if (g.phase === 'descend') {
    const r = descend(v, g, d, dir);
    stick = r.stick;
    g.throttle = r.throttle;
  } else if (g.phase === 'glide') {
    stick = glide(v, g, d, dir);
  } else {
    // light the Raptors, then swing the Ship upright
    const spun = g.phase === 'flip';
    stick = spun ? flipCue(v.BX.y, v.BZ.y) : { x: 0, y: 0 };
    const h = Math.max(1, g.abort ? v.base.y : v.hArm);
    const burn = flipBurn(v.vs, h, v.tilt, spun, v.lit);
    g.throttle = burn === 'off' ? 0 : burn === 'min' ? 0.15 : clamp((((v.vs * v.vs) / (2 * h) + G0) * v.mass) / MAX_THRUST, 0.15, 1);
  }
  g.stick = inGate(stick.x, stick.y, GATE);
}
