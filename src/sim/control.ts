import { Vector3 } from 'three';
import { MAX_RATE, MAX_TILT } from './constants';
import { bodyAxes, type ShipState } from './physics';

/**
 * Fly-by-wire control laws: turn the stick into the body rates the attitude controller should fly.
 *
 * - `attitude` (Cadet, Pilot): the stick position IS the attitude you want; let go and the Ship holds
 *   its reference attitude. Easy to follow a cue with: put your thumb where the cue is.
 *   - belly: pitch stick sets the nose angle (±25° from level), lateral stick turns the heading.
 *   - flip:  started by pulling back with the engines lit; pull to keep rotating, let go to hold.
 *   - upright: the stick sets the tilt (up to MAX_TILT) toward the belly (forward) or the sides.
 * - `rate` (Expert): the stick sets a turn rate and the computer holds whatever attitude you stop at.
 */
export type Law = 'attitude' | 'rate';
export type Reference = 'belly' | 'flip' | 'upright';

export const BELLY_PITCH = (25 * Math.PI) / 180;
const KP = 1.1; // attitude error to rate, 1/s

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const UP = new Vector3(0, 1, 0);
const N = new Vector3(), H = new Vector3(), AXIS = new Vector3(), T1 = new Vector3(), T2 = new Vector3();

/** Stick limited to the round gate of a thumbstick. */
export function inGate(x: number, y: number, r = 1) {
  const l = Math.hypot(x, y);
  return l > r ? { x: (x / l) * r, y: (y / l) * r } : { x, y };
}

/** Nose direction (world) for an upright tilt command, in the Ship's roll-held body frame. */
export function uprightNose(s: ShipState, x: number, y: number, out = new Vector3()) {
  const { x: BX, z: BZ } = bodyAxes(s.q, ax);
  const fwd = T1.set(BZ.x, 0, BZ.z), side = T2.set(BX.x, 0, BX.z);
  if (fwd.lengthSq() > 1e-6) fwd.normalize();
  if (side.lengthSq() > 1e-6) side.normalize();
  const g = inGate(x, y);
  const t = Math.tan(MAX_TILT);
  return out.copy(UP).addScaledVector(fwd, g.y * t).addScaledVector(side, g.x * t).normalize();
}

/** Desired body rates (x: pitch toward the belly, z: lateral) for the current stick. */
export function desiredRates(s: ShipState, law: Law, out = { x: 0, z: 0 }) {
  const { x: sx, y: sy } = inGate(s.inp.x, s.inp.y);
  if (law === 'rate' || s.ref === 'flip') {
    out.x = sy * MAX_RATE;
    out.z = sx * MAX_RATE * (s.ref === 'flip' ? 0.5 : 1);
    return out;
  }
  const { x: BX, y: A, z: BZ } = bodyAxes(s.q, ax);
  if (s.ref === 'belly') {
    // keep the current heading, set the nose angle from the pitch stick
    H.set(A.x, 0, A.z);
    if (H.lengthSq() < 1e-6) H.set(-BZ.x, 0, -BZ.z);
    H.normalize();
    const th = sy * BELLY_PITCH;
    N.copy(H).multiplyScalar(Math.cos(th)).addScaledVector(UP, -Math.sin(th));
  } else {
    uprightNose(s, sx, sy, N);
  }
  AXIS.crossVectors(A, N);
  const ang = Math.asin(clamp(AXIS.length(), 0, 1));
  const rate = Math.min(ang * KP, MAX_RATE);
  if (ang > 1e-6) AXIS.multiplyScalar(rate / AXIS.length());
  out.x = AXIS.dot(BX);
  out.z = AXIS.dot(BZ);
  if (s.ref === 'belly') out.z = clamp(out.z + sx * MAX_RATE * 0.6, -MAX_RATE, MAX_RATE);
  return out;
}
