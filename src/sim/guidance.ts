import { Vector3 } from 'three';
import {
  ARM_Y, CATCH, DRY_MASS, FLIP_ALT, G0, MAX_RATE, PIN_OFFSET, HALF, RAPTOR_THRUST, SHORE_X, SL_ENGINES, THROTTLE_OFF,
} from './constants';
import { bodyAxes, deltaVLeft, type ShipState } from './physics';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const MAX_THRUST = SL_ENGINES * RAPTOR_THRUST;

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
  /** Latched once the flip is complete, released if the Ship tips past 40°. */
  upright: boolean;
}

export const createGuide = (): Guide => ({ phase: 'glide', stick: null, throttle: null, abort: null, upright: false });

const ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const v = () => new Vector3();

/**
 * Updates `g` with the next suggested inputs. Called a few times a second.
 * The stick cue is a turn-rate command (it assumes fly-by-wire); `fbw=false` converts it to a torque cue.
 */
export function updateGuide(s: ShipState, g: Guide, fbw: boolean) {
  const { x: BX, y: A, z: BZ } = bodyAxes(s.q, ax);
  const pin = v().copy(s.pos).addScaledVector(A, PIN_OFFSET);
  const base = v().copy(s.pos).addScaledVector(A, -HALF);
  const tilt = (Math.acos(clamp(A.y, -1, 1)) * 180) / Math.PI;
  const alt = base.y;
  const vh = v().set(s.vel.x, 0, s.vel.z);
  const vs = -s.vel.y;
  const lit = s.thr > THROTTLE_OFF;
  const m = DRY_MASS + s.prop;

  if (g.upright && tilt > 40) g.upright = false;
  const belly = !g.upright && tilt > 45 && !lit;
  const dTower = Math.hypot(CATCH.x - pin.x, CATCH.z - pin.z);
  const hArm = pin.y - ARM_Y;

  // Is a catch still possible? If not, latch an abort: the Gulf if it is in reach, otherwise open ground.
  if (!g.abort) {
    const dvNeed = s.vel.length() + 9.81 * clamp(hArm / 15, 6, 40) * 0.8 + dTower * 0.04;
    const glide = (Math.max(0, alt - FLIP_ALT) / Math.max(vs, 1)) * 30 + 120;
    let why: string | null = null;
    if (deltaVLeft(s.prop) < dvNeed) why = 'Not enough propellant left to stop at the tower.';
    else if (belly && alt < FLIP_ALT + 900 && dTower > glide) why = 'The tower is out of glide range.';
    else if (g.upright && hArm < 350 && dTower > 160) why = 'Too far from the tower to reach it this low.';
    if (why) {
      const dOcean = Math.max(0, SHORE_X + 150 - pin.x);
      let reach: number;
      if (belly) reach = glide + 250;
      else { const t = Math.max(3, base.y / Math.max(vs, 4)); reach = Math.max(0, s.vel.x * t) + 0.5 * 2.5 * t * t; }
      g.abort = { why, mode: dOcean < reach ? 'ocean' : 'clear' };
    }
  }

  const ab = g.abort;
  let target = new Vector3(CATCH.x, 0, CATCH.z);
  if (ab?.mode === 'ocean') target = new Vector3(Math.max(SHORE_X + 450, pin.x + 60), 0, pin.z);
  else if (ab) {
    const away = v().set(pin.x - CATCH.x, 0, pin.z - CATCH.z);
    if (away.lengthSq() < 1) away.set(1, 0, 0);
    away.normalize();
    target = v().set(CATCH.x, 0, CATCH.z).addScaledVector(away, Math.max(320, dTower + 40));
  }
  const toT = v().set(target.x - pin.x, 0, target.z - pin.z);
  const d = toT.length();
  const dir = d > 0 ? toT.clone().divideScalar(d) : v();

  g.stick = null;
  g.throttle = null;

  // Rotate the nose toward world direction n.
  const stickToward = (n: Vector3) => {
    const axis = v().crossVectors(A, n);
    const k = 1.6 / MAX_RATE;
    g.stick = { x: clamp(axis.dot(BZ) * k, -1, 1), y: clamp(axis.dot(BX) * k, -1, 1) };
  };

  if (belly) {
    if (alt < FLIP_ALT + 60) {
      g.phase = 'light';
      g.throttle = 0.15;
      g.stick = { x: 0, y: 0 };
    } else {
      g.phase = 'glide';
      // aim the nose, then pitch down to glide (or up to brake) so we arrive ~120 m short of the target
      const l = Math.hypot(A.x, A.z) || 1;
      const ang = (Math.atan2((A.z * dir.x - A.x * dir.z) / l, (A.x * dir.x + A.z * dir.z) / l) * 180) / Math.PI;
      const tLeft = Math.max(1, (alt - FLIP_ALT) / Math.max(vs, 1));
      const need = clamp((d - (ab ? 0 : 120)) / tLeft, -15, 40);
      const cur = vh.dot(dir);
      const pitchDown = (Math.asin(clamp(-A.y, -1, 1)) * 180) / Math.PI;
      const pitchWanted = clamp(need * 0.6 + (need - cur) * 0.6, -25, 25);
      g.stick = { x: clamp(-ang / 12, -1, 1), y: clamp((pitchWanted - pitchDown) / 8, -1, 1) };
    }
  } else if (!g.upright) {
    g.phase = 'flip';
    if (!lit) g.throttle = 0.2;
    else {
      // swing upright, leaning back against sideways drift so the flip does not throw us forward
      const lean = vh.clone().multiplyScalar(-1 / 40);
      if (lean.length() > 0.35) lean.setLength(0.35);
      stickToward(v().set(lean.x, 1, lean.z).normalize());
      const h = Math.max(1, ab ? base.y : hArm);
      const aReq = (vs * vs) / (2 * h);
      g.throttle = aReq > 3 ? clamp(((aReq + G0) * m) / MAX_THRUST, 0.15, 1) : 0.15;
      if (tilt < 25) g.upright = true;
    }
  }

  if (g.upright) {
    g.phase = 'descend';
    const over = ab ? (ab.mode === 'ocean' ? pin.x > SHORE_X + 40 : d < 60) : false;
    const toOcean = ab?.mode === 'ocean' && !over;
    const h = ab ? base.y : hArm;
    let vt = h > 0 ? clamp(Math.sqrt(2 * 2 * h), 1, 60) : 0; // target descent rate
    if (toOcean) vt = clamp(Math.min(vt, h / Math.max(1, d / 22)), 2, 60); // slow down to buy time
    const ah = dir.clone().multiplyScalar(clamp(d * 0.25, 0, toOcean ? 28 : ab ? 14 : 9)).sub(vh).multiplyScalar(0.4);
    if (over) ah.copy(vh).multiplyScalar(-0.4);
    const cap = toOcean ? 5 : 3.4;
    if (ah.length() > cap) ah.setLength(cap);
    stickToward(v().set(ah.x / 9.81, 1, ah.z / 9.81).normalize());
    const aNeed = G0 + 2.5 * (vs - vt);
    g.throttle = clamp((aNeed * m) / Math.max(0.5, Math.cos((tilt * Math.PI) / 180)) / MAX_THRUST, 0.05, 1);
  }

  // without fly-by-wire the stick is raw torque: turn the rate cue into a torque cue
  if (!fbw && g.stick) {
    g.stick = {
      x: clamp((g.stick.x * MAX_RATE - s.w.z) * 4, -1, 1),
      y: clamp((g.stick.y * MAX_RATE - s.w.x) * 4, -1, 1),
    };
  }
}
