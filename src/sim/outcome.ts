import { Vector3 } from 'three';
import { ARM_REACH, ARMS, CATCH, HALF, PIN_OFFSET, RADIUS, shoreX } from './constants';
import type { Measured } from './flight';
import type { CatchLimits } from './modes';
import { bodyAxes, type ShipState } from './physics';
import { ARM_TOP, type Hit } from './world';

export type OutcomeKind = 'caught' | 'crash' | 'ground' | 'ocean';

export interface Outcome {
  kind: OutcomeKind;
  /** The flight machine's outcome state, e.g. 'crash.tower.mast' (flight.ts). */
  cause: string;
  why: string;
  /** Distance of the pins from the catch axis, m. */
  offset: number;
  descent: number; // m/s
  sideways: number; // m/s
  tilt: number; // deg
  propellant: number; // kg left
  time: number; // s
  /** The vehicle came down well away from the tower and pad. */
  siteSafe: boolean;
}

const ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const pin = new Vector3();

export function tiltDeg(s: ShipState) {
  const A = bodyAxes(s.q, ax).y;
  return (Math.acos(Math.min(1, Math.max(-1, A.y))) * 180) / Math.PI;
}

/** Pin position (where the ship rests on the arms). */
export function pinPos(s: ShipState, out = new Vector3()) {
  return out.copy(s.pos).addScaledVector(bodyAxes(s.q, ax).y, PIN_OFFSET);
}
export function basePos(s: ShipState, out = new Vector3()) {
  return out.copy(s.pos).addScaledVector(bodyAxes(s.q, ax).y, -HALF);
}

/** What the physics measured this step, for the flight machine to decide on (flight.ts). */
export function measure(s: ShipState, hits: ReadonlySet<Hit>): Measured {
  pinPos(s, pin);
  return {
    hits,
    prop: s.prop,
    q: s.qbar,
    qSide: s.qbarSide,
    speed: s.vel.length(),
    offset: Math.hypot(pin.x - CATCH.x, pin.z - CATCH.z),
    descent: -s.vel.y,
    sideways: Math.hypot(s.vel.x, s.vel.z),
    tilt: tiltDeg(s),
    inOcean: s.pos.x > shoreX(s.pos.z),
    overArms: pin.x > ARM_REACH.x0 + RADIUS && pin.x < ARM_REACH.x1 + 1 && Math.abs(pin.z) < ARMS.open - ARMS.clear,
    aboveArms: pin.y - ARM_TOP,
  };
}

/** What the end card says for each way a flight can end (the flight machine's outcome states). */
const WHY: Record<string, (m: Measured, l: CatchLimits) => string> = {
  'caught': () => 'The Ship settled onto the arms within limits.',
  'ground': () => 'The Ship touched down upright, but on the ground instead of in the arms.',
  'ocean.soft': () => 'Soft splashdown in the Gulf. The Ship is lost, but the tower and pad are safe.',
  'ocean.hard': (m) => `The Ship hit the water at ${m.speed.toFixed(0)} m/s. It is lost, but the tower and pad are safe.`,
  'crash.tower.mast': () => 'The Ship hit the tower.',
  'crash.tower.carriage': () => 'The Ship hit the carriage that carries the arms.',
  'crash.tower.qdArm': () => 'The Ship hit the quick-disconnect arm high on the tower.',
  'crash.hullArm': () => 'The hull struck a chopstick. Line the Ship up between the arms before coming down.',
  'crash.armOpen': () => 'The Ship came down on one arm before both arms had closed around it.',
  'crash.armsOverLimit': (m, l) => {
    const r: string[] = [];
    if (m.descent >= l.vs) r.push(`coming down at ${m.descent.toFixed(1)} m/s`);
    if (m.sideways >= l.hs) r.push(`moving sideways at ${m.sideways.toFixed(1)} m/s`);
    if (m.offset >= l.off) r.push(`${m.offset.toFixed(1)} m off centre`);
    if (m.tilt >= l.tilt) r.push(`tilted ${m.tilt.toFixed(0)}°`);
    return `The Ship struck the arms: ${r.join(', ')}.`;
  },
  'crash.mount': () => 'The Ship dropped past the arms onto the launch mount.',
  'crash.surface': (m) => `The Ship hit the ground at ${m.speed.toFixed(0)} m/s.`,
  'crash.breakup.overspeed': (m) => `The Ship broke up: at ${m.speed.toFixed(0)} m/s the air load was more than the structure can take.`,
  'crash.breakup.broadside': (m) => `The Ship broke up: it turned broadside to the airflow at ${m.speed.toFixed(0)} m/s.`,
};

/**
 * The end of the flight, from the outcome state the flight machine reached (e.g. 'crash.tower.mast') and the
 * measurements it ended on. `dry`: the tanks had run dry.
 */
export function outcomeOf(cause: string, m: Measured, limits: CatchLimits, time: number, dry: boolean): Outcome {
  const kind = cause.split('.')[0] as OutcomeKind;
  const why = WHY[cause](m, limits) + (dry && kind !== 'caught' ? ' The tanks had run dry.' : '');
  return {
    kind, cause, why, offset: m.offset, descent: m.descent, sideways: m.sideways, tilt: m.tilt,
    propellant: m.prop, time, siteSafe: kind === 'caught' || kind === 'ocean' || m.offset > 150,
  };
}
