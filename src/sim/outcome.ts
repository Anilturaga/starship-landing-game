import { Vector3 } from 'three';
import { CATCH, HALF, PIN_OFFSET, SHORE_X } from './constants';
import type { CatchLimits } from './modes';
import { bodyAxes, type ShipState } from './physics';
import type { Hit } from './world';

export type OutcomeKind = 'caught' | 'crash' | 'ground' | 'ocean';

export interface Outcome {
  kind: OutcomeKind;
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

/** Turns what Rapier reports the Ship touching into the end of the flight (or null to keep flying). */
export function judge(s: ShipState, hits: ReadonlySet<Hit>, limits: CatchLimits): Outcome | null {
  if (!hits.size) return null;
  pinPos(s, pin);
  const tilt = tiltDeg(s);
  const offset = Math.hypot(pin.x - CATCH.x, pin.z - CATCH.z);
  const descent = -s.vel.y, sideways = Math.hypot(s.vel.x, s.vel.z);
  const end = (kind: OutcomeKind, why: string): Outcome => ({
    kind, why, offset, descent, sideways, tilt, propellant: s.prop, time: s.t,
    siteSafe: kind === 'caught' || kind === 'ocean' || offset > 150,
  });

  if (hits.has('tower')) return end('crash', 'The Ship hit the tower.');
  if (hits.has('arms')) {
    if (offset < limits.off && descent < limits.vs && sideways < limits.hs && tilt < limits.tilt) {
      return end('caught', 'The Ship settled onto the arms within limits.');
    }
    const r: string[] = [];
    if (descent >= limits.vs) r.push(`coming down at ${descent.toFixed(1)} m/s`);
    if (sideways >= limits.hs) r.push(`moving sideways at ${sideways.toFixed(1)} m/s`);
    if (offset >= limits.off) r.push(`${offset.toFixed(1)} m off centre`);
    if (tilt >= limits.tilt) r.push(`tilted ${tilt.toFixed(0)}°`);
    return end('crash', `The Ship struck the arms: ${r.join(', ')}.`);
  }
  if (hits.has('mount')) return end('crash', 'The Ship hit the launch mount.');

  const speed = s.vel.length();
  if (s.pos.x > SHORE_X) {
    return end('ocean', descent < 6
      ? 'Soft splashdown in the Gulf. The Ship is lost, but the tower and pad are safe.'
      : `The Ship hit the water at ${speed.toFixed(0)} m/s. It is lost, but the tower and pad are safe.`);
  }
  if (tilt < 10 && speed < 4) return end('ground', 'The Ship touched down upright, but on the ground instead of in the arms.');
  return end('crash', `The Ship hit the ground at ${speed.toFixed(0)} m/s.`);
}
