import { Matrix4, Quaternion, Vector3 } from 'three';
import type { SiteWorld } from './world';
import { desiredRates, updateReference, type Law, type Reference } from './control';
import {
  DRY_MASS, FLAP_GAIN, FLAP_RATE, G0, GIMBAL_MAX, HALF, LENGTH, MIN_THROTTLE, RADIUS,
  RAPTOR_MDOT, RAPTOR_THRUST, RCS_TORQUE, RHO0, SCALE_HEIGHT, SL_ENGINES, SPIN_DOWN_S, SPIN_UP_S,
  START, THROTTLE_OFF,
} from './constants';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The four flaps in a fixed order: side -1 = body -X, side +1 = body +X. */
export const FLAPS = [
  { side: -1, fwd: true },
  { side: -1, fwd: false },
  { side: 1, fwd: true },
  { side: 1, fwd: false },
] as const;
const FLAP_NEUTRAL = 0.55; // rad folded toward the leeward side
const FLAP_STOWED = 1.15;
const FLAP_FOLD_MAX = 1.35;

/**
 * Body frame: +Y is the nose, +Z is the windward (tiled) belly, +X completes a right-handed set.
 * Positive rotation about body X pitches the nose toward the belly.
 */
export interface ShipState {
  pos: Vector3; // centre of the vehicle, world m
  vel: Vector3;
  q: Quaternion; // body -> world
  w: Vector3; // angular velocity, body frame, rad/s
  t: number; // sim time, s
  prop: number; // propellant, kg
  /** Requested throttle 0..1 of all three sea-level Raptors. 0 = engines off. */
  thr: number;
  /** Stick, -1..1. x = lateral (right +), y = pitch (forward/nose-down +). */
  inp: { x: number; y: number };
  spool: number; // 0..1 engine spin-up
  /** Which attitude the fly-by-wire flies the stick against (latched: belly → flip → upright). */
  ref: Reference;
  flaps: number[]; // fold angle per FLAPS entry, rad
  // Derived each step (read by HUD, visuals and guidance)
  engines: number; // lit engine count
  perEngine: number; // throttle per lit engine
  thrust: number; // N
  gimbal: { x: number; z: number }; // rad, for visuals
  ctrl: { x: number; z: number }; // fraction of available torque used
  flapAuthority: number; // N·m
  gimbalAuthority: number; // N·m
}

export interface Env {
  law: Law;
  wind: [number, number, number];
}

export function createShip(propellant: number): ShipState {
  const q = new Quaternion().setFromRotationMatrix(
    // nose toward -x, belly down: body X -> +z, body Y -> -x, body Z -> -y
    new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(-1, 0, 0), new Vector3(0, -1, 0)),
  );
  q.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), START.yaw));
  return {
    pos: new Vector3(...START.pos),
    vel: new Vector3(...START.vel),
    q,
    w: new Vector3(),
    t: 0,
    prop: propellant,
    thr: 0,
    inp: { x: 0, y: 0 },
    spool: 0,
    ref: 'belly',
    flaps: FLAPS.map(() => FLAP_NEUTRAL),
    engines: 0,
    perEngine: 0,
    thrust: 0,
    gimbal: { x: 0, z: 0 },
    ctrl: { x: 0, z: 0 },
    flapAuthority: 0,
    gimbalAuthority: 0,
  };
}

export const airDensity = (y: number) => RHO0 * Math.exp(-Math.max(0, y) / SCALE_HEIGHT);
export const deltaVLeft = (prop: number, isp = 330) => isp * G0 * Math.log((DRY_MASS + prop) / DRY_MASS);

/** Body axes in world space. */
export function bodyAxes(q: Quaternion, out = { x: new Vector3(), y: new Vector3(), z: new Vector3() }) {
  out.x.set(1, 0, 0).applyQuaternion(q);
  out.y.set(0, 1, 0).applyQuaternion(q);
  out.z.set(0, 0, 1).applyQuaternion(q);
  return out;
}

export function windAt(t: number, wind: Env['wind'], out = new Vector3()) {
  // blows from +z toward -z, with two slow gust components
  return out.set(0, 0, -(wind[0] + wind[1] * Math.sin(t * 0.31) + wind[2] * Math.sin(t * 1.73)));
}

const ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const VR = new Vector3(), VP = new Vector3(), F = new Vector3(), W = new Vector3();
const TQ = new Vector3(), INERTIA = new Vector3(), RATES = { x: 0, z: 0 };

/**
 * Advance one fixed step: compute the bespoke forces (aero, Raptors, gimbal, flaps, RCS) and let
 * Rapier integrate them. Mutates `s` and returns what the Ship is touching.
 */
export function physStep(s: ShipState, dt: number, env: Env, world: SiteWorld) {
  s.t += dt;
  const { x: BX, y: A, z: BZ } = bodyAxes(s.q, ax);
  const m = DRY_MASS + s.prop;
  const rho = airDensity(s.pos.y);

  // --- aerodynamics: a cylinder in crossflow (belly-flop) plus small axial drag
  windAt(s.t, env.wind, W);
  VR.copy(s.vel).sub(W);
  const va = VR.dot(A);
  VP.copy(VR).addScaledVector(A, -va);
  const vpm = VP.length();
  const flapExt = s.flaps.reduce((a, d) => a + (1 - d / 1.4), 0) / s.flaps.length;
  F.set(0, 0, 0); // gravity is applied by Rapier
  F.addScaledVector(VP, -0.5 * rho * 0.8 * (2 * RADIUS * LENGTH + 60 * flapExt) * vpm);
  F.addScaledVector(A, -0.5 * rho * 0.45 * Math.PI * RADIUS * RADIUS * Math.abs(va) * va);

  // --- Raptors: zero throttle = off; the flight computer chooses the engine count
  const on = s.thr > THROTTLE_OFF && s.prop > 0;
  s.spool = on ? Math.min(1, s.spool + dt / SPIN_UP_S) : Math.max(0, s.spool - dt / SPIN_DOWN_S);
  const req = s.thr * SL_ENGINES;
  let n = clamp(Math.ceil(req - 1e-6), 1, SL_ENGINES);
  let per = Math.max(MIN_THROTTLE, req / n);
  if (s.spool <= 0) { n = 0; per = 0; }
  const T = n * per * RAPTOR_THRUST * s.spool;
  s.engines = n; s.perEngine = per; s.thrust = T;
  s.prop = Math.max(0, s.prop - n * per * RAPTOR_MDOT * s.spool * dt);

  // --- attitude control: flaps (scale with dynamic pressure) + gimbal (scales with thrust) + RCS
  const qd = 0.5 * rho * vpm * vpm;
  const aF = qd * FLAP_GAIN;
  const aG = T * Math.sin(GIMBAL_MAX) * HALF;
  const avail = aF + aG + RCS_TORQUE;
  const Ip = m * (LENGTH * LENGTH / 12 + RADIUS * RADIUS / 4);
  const Ir = (m * RADIUS * RADIUS) / 2;
  updateReference(s, (Math.acos(clamp(A.y, -1, 1)) * 180) / Math.PI);
  const r = desiredRates(s, env.law, RATES);
  const tx = clamp(Ip * 3 * (r.x - s.w.x), -avail, avail);
  const tz = clamp(Ip * 3 * (r.z - s.w.z), -avail, avail);
  const rollLim = RCS_TORQUE + aF * 0.3;
  const ty = clamp(Ir * 3 * -s.w.y, -rollLim, rollLim); // roll is always held
  const ux = tx / avail, uz = tz / avail;
  s.ctrl.x = ux; s.ctrl.z = uz; s.flapAuthority = aF; s.gimbalAuthority = aG;

  // gimbal side-force that produces the gimbal share of the torque (engines sit HALF below centre)
  const fz = -(ux * aG) / HALF, fx = (uz * aG) / HALF;
  F.addScaledVector(A, T).addScaledVector(BZ, fz).addScaledVector(BX, fx);
  s.gimbal.x = T > 0 ? Math.asin(clamp(fz / T, -1, 1)) : 0;
  s.gimbal.z = T > 0 ? -Math.asin(clamp(fx / T, -1, 1)) : 0;

  // flap actuators chase their commanded fold angle at a limited rate
  const stow = s.spool > 0 && aF < aG;
  for (let i = 0; i < FLAPS.length; i++) {
    const f = FLAPS[i];
    const e = (f.fwd ? -ux : ux) + f.side * uz * (f.fwd ? 1 : -1) * 0.6;
    const target = clamp(stow ? FLAP_STOWED : FLAP_NEUTRAL - 0.5 * e, 0.02, FLAP_FOLD_MAX);
    s.flaps[i] += clamp(target - s.flaps[i], -FLAP_RATE * dt, FLAP_RATE * dt);
  }

  // --- hand the forces to Rapier (aerodynamic rate damping from crossflow goes in the torque)
  const kd = rho * 0.8 * 2 * RADIUS * vpm * (LENGTH ** 3 / 12);
  TQ.set(tx - kd * s.w.x, ty, tz - kd * s.w.z).applyQuaternion(s.q);
  return world.step(s, F, TQ, m, INERTIA.set(Ip, Ir, Ip));
}
