import { ArrowDown, ArrowUp } from '@phosphor-icons/react';
import { Vector3 } from 'three';
import { ARM_REACH, ARM_Y, CATCH, RADIUS, TOWER } from '../sim/constants';
import { basePos, pinPos } from '../sim/outcome';
import { bodyAxes } from '../sim/physics';
import { useGame } from '../state/store';
import { view } from '../state/view';
import { useTicker } from './useTicker';

const v1 = new Vector3(), v2 = new Vector3(), v3 = new Vector3(), ax = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
const deg = (r: number) => (r * 180) / Math.PI;
/** Where the propellant settles, in the HUD's 2D frame (x right, y down); low-passed so it sloshes. */
const settle = { x: 0, y: 1 };

function telemetry() {
  const sim = useGame.getState().sim;
  const s = sim.ship, cam = view.cam;
  const base = basePos(s, v1), pin = pinPos(s, v2);
  const A = bodyAxes(s.q, ax).y;
  // the vehicle as the camera sees it: angle of its axis from screen-up, clockwise
  const att = deg(Math.atan2(A.dot(cam.right), A.dot(cam.up)));
  const tilt = deg(Math.acos(Math.min(1, Math.max(-1, A.y))));
  // propellant settles away from the specific force; in near free fall it just drifts
  const fx = s.accel.dot(cam.right), fy = s.accel.dot(cam.up), f = Math.hypot(fx, fy);
  if (f > 0.4) {
    const k = Math.min(1, f / 6) * 0.35;
    settle.x += (-fx / f - settle.x) * k;
    settle.y += (fy / f - settle.y) * k;
    const l = Math.hypot(settle.x, settle.y) || 1;
    settle.x /= l; settle.y /= l;
  }
  // horizontal motion and offset in the camera's level frame (x right, y away from the camera)
  const right = v3.set(-cam.fwd.z, 0, cam.fwd.x); // fwd rotated 90° clockwise seen from above
  const rel = { x: (pin.x - CATCH.x) * right.x + (pin.z - CATCH.z) * right.z, y: (pin.x - CATCH.x) * cam.fwd.x + (pin.z - CATCH.z) * cam.fwd.z };
  const vh = { x: s.vel.x * right.x + s.vel.z * right.z, y: s.vel.x * cam.fwd.x + s.vel.z * cam.fwd.z };
  const toLevel = (x: number, z: number) => ({ x: (x - CATCH.x) * right.x + (z - CATCH.z) * right.z, y: (x - CATCH.x) * cam.fwd.x + (z - CATCH.z) * cam.fwd.z });
  const armsAbove = pin.y - ARM_Y;
  return {
    speed: s.vel.length() * 3.6,
    alt: Math.max(0, base.y),
    vs: s.vel.y,
    hs: Math.hypot(s.vel.x, s.vel.z),
    hDir: deg(Math.atan2(vh.x, vh.y)),
    vh,
    rel,
    armsAbove,
    offset: Math.hypot(pin.x - CATCH.x, pin.z - CATCH.z),
    arms: sim.world.arms.face.map((z) => [toLevel(ARM_REACH.x0, z), toLevel(ARM_REACH.x1, z)]),
    tower: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toLevel(TOWER.x + (a * TOWER.width) / 2, (b * TOWER.width) / 2)),
    propFrac: s.prop / sim.mode.propellant,
    engines: s.spool > 0 ? s.engines : 0,
    spooling: s.spool > 0 && s.spool < 1,
    thr: s.thr,
    abort: sim.mode.guides && sim.running && !sim.outcome ? sim.guide.abort : null,
    att,
    tilt,
    settle: { ...settle },
    limits: sim.mode.limits,
  };
}
type T = ReturnType<typeof telemetry>;

function Gauge({ value, frac, unit }: { value: string; frac: number; unit: string }) {
  const f = Math.min(1, Math.max(0, frac));
  return (
    <div className="gauge">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2" pathLength={100} strokeDasharray="75 100" transform="rotate(135 40 40)" />
        <circle cx="40" cy="40" r="34" fill="none" stroke="#f3f5f7" strokeWidth="2.5" pathLength={100} strokeDasharray={`${(75 * f).toFixed(1)} 100`} transform="rotate(135 40 40)" />
      </svg>
      <div className="v"><b>{value}</b><small>{unit}</small></div>
    </div>
  );
}

/** Vertical and horizontal speed, each with the way it points (horizontal relative to the view). */
function Velocity({ t }: { t: T }) {
  const fast = t.armsAbove < 40 && -t.vs > t.limits.vs;
  return (
    <div className="vel">
      <span className={fast ? 'warn' : ''}>
        {t.vs <= 0 ? <ArrowDown weight="bold" /> : <ArrowUp weight="bold" />}
        <b>{Math.abs(t.vs).toFixed(1)}</b>
      </span>
      <span>
        <ArrowUp weight="bold" style={{ transform: `rotate(${t.hDir.toFixed(0)}deg)`, opacity: t.hs < 0.2 ? 0.3 : 1 }} />
        <b>{t.hs.toFixed(1)}</b>
      </span>
      <small>m/s</small>
    </div>
  );
}

// main tank inside the silhouette, nose up, in the gauge's frame
const TANK = { x0: -6.2, x1: 6.2, y0: -18, y1: 34 };
const TANK_POLY: [number, number][] = [[TANK.x0, TANK.y0], [TANK.x1, TANK.y0], [TANK.x1, TANK.y1], [TANK.x0, TANK.y1]];

/** Area of a polygon (shoelace). */
const area = (p: [number, number][]) => Math.abs(p.reduce((a, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return a + x * v - u * y; }, 0)) / 2;
/** The part of `p` where point·d ≥ c (Sutherland–Hodgman against one line). */
function clip(p: [number, number][], d: { x: number; y: number }, c: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const da = a[0] * d.x + a[1] * d.y - c, db = b[0] * d.x + b[1] * d.y - c;
    if (da >= 0) out.push(a);
    if (da * db < 0) { const k = da / (da - db); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
  }
  return out;
}
/** The liquid in the tank (rotated by `att`), settled toward `d` and filling `frac` of it. */
function liquid(att: number, d: { x: number; y: number }, frac: number) {
  const r = (att * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const poly = TANK_POLY.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
  const full = area(poly), dots = poly.map(([x, y]) => x * d.x + y * d.y);
  let lo = Math.min(...dots), hi = Math.max(...dots);
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (area(clip(poly, d, mid)) > frac * full) lo = mid; else hi = mid;
  }
  return clip(poly, d, (lo + hi) / 2);
}

/**
 * The Ship as the camera sees it, rotated to its attitude, with the propellant inside settling the way the
 * engines and the air push it: toward the engines under thrust, against the belly in the belly-flop.
 */
function ShipGauge({ t }: { t: T }) {
  const f = Math.max(0, Math.min(1, t.propFrac));
  const state = f < 0.15 ? 'crit' : f < 0.35 ? 'warn' : '';
  const liq = f > 0.002 ? liquid(t.att, t.settle, f) : [];
  return (
    <div className={`shipg ${state}`}>
      <svg viewBox="-46 -46 92 92" role="img" aria-label={`Propellant ${Math.round(f * 100)} percent, tilt ${t.tilt.toFixed(0)} degrees`}>
        <g transform={`rotate(${t.att.toFixed(1)})`}>
          <path className="hull" d="M-9,40 L-9,-24 C-9,-33 -4,-40 0,-43 C4,-40 9,-33 9,-24 L9,40 Z" />
          <path className="flap" d="M-9,24 L-14,28 L-14,40 L-9,40 Z M9,24 L14,28 L14,40 L9,40 Z M-8,-28 L-12,-24 L-12,-17 L-8.6,-18 Z M8,-28 L12,-24 L12,-17 L8.6,-18 Z" />
          <rect className="tank" x={TANK.x0} y={TANK.y0} width={TANK.x1 - TANK.x0} height={TANK.y1 - TANK.y0} rx="2" />
          <line className="dome" x1={TANK.x0} x2={TANK.x1} y1="6" y2="6" />
        </g>
        {liq.length > 2 && <polygon className="liq" points={liq.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')} />}
      </svg>
      <div className="shipt">
        <span><b>{Math.round(f * 100)}</b>%</span>
        <span>TILT <b>{t.tilt.toFixed(0)}°</b></span>
      </div>
    </div>
  );
}

/** The six Raptors seen from below: three vacuum engines outside, the three sea-level ones lit as they run. */
function Engines({ t }: { t: T }) {
  const lit = t.engines > 0;
  return (
    <div className="shipg engg">
      <svg viewBox="-46 -46 92 92" role="img" aria-label={`${t.engines} Raptors lit, throttle ${Math.round(t.thr * 100)} percent`}>
        <circle r="29" className="hull" />
        {[0, 1, 2].map((i) => {
          const a = ((i * 120 - 90) * Math.PI) / 180;
          return <circle key={`v${i}`} cx={Math.cos(a) * 18.5} cy={Math.sin(a) * 18.5} r="7.5" className="tank" />;
        })}
        {[0, 1, 2].map((i) => {
          const a = ((i * 120 + 90) * Math.PI) / 180;
          const on = i < t.engines;
          return <circle key={`s${i}`} cx={Math.cos(a) * 7.5} cy={Math.sin(a) * 7.5} r="5" className={on ? (t.spooling ? 'eng spool' : 'eng on') : 'eng'} />;
        })}
      </svg>
      <div className="shipt">
        <span><b>{t.engines}</b> ENG</span>
        <span>{lit && t.spooling ? 'SPIN-UP' : <><b>{lit ? Math.round(t.thr * 100) : 0}</b>%</>}</span>
      </div>
    </div>
  );
}

const RANGES = [25, 60, 150, 400, 1000, 2500, 6000];

/**
 * Approach radar, seen from above with the view's direction up: the tower, the arms (opening and closing),
 * the Ship's pins position at true size once close, and where it will be in three seconds.
 */
function Radar({ t }: { t: T }) {
  const range = RANGES.find((r) => t.offset < r * 0.8) ?? RANGES[RANGES.length - 1];
  const k = 42 / range;
  const P = (p: { x: number; y: number }) => [p.x * k, -p.y * k] as const;
  const [sx, sy] = P(t.rel);
  const lead = Math.min(46, Math.hypot(t.vh.x, t.vh.y) * 3 * k);
  const vl = Math.hypot(t.vh.x, t.vh.y) || 1;
  const ex = sx + (t.vh.x / vl) * lead, ey = sy - (t.vh.y / vl) * lead;
  const lined = t.offset < t.limits.off;
  const above = t.armsAbove;
  return (
    <div className={`radar${t.abort ? ' abort' : ''}`}>
      {t.abort && <div className="abortb" role="status" title={t.abort.why}>ABORT</div>}
      <svg viewBox="-50 -50 100 100" role="img" aria-label={`${t.offset.toFixed(0)} metres from the catch point`}>
        <defs><clipPath id="rclip"><circle r="46" /></clipPath></defs>
        <circle r="46" className="ring" />
        <circle r="23" className="ring half" />
        <g clipPath="url(#rclip)">
          <polygon className="towr" points={t.tower.map((p) => P(p).join(',')).join(' ')} />
          {t.arms.map(([a, b], i) => <line key={i} className="arm" x1={P(a)[0]} y1={P(a)[1]} x2={P(b)[0]} y2={P(b)[1]} />)}
          <line className="cross" x1="-4" x2="4" y1="0" y2="0" /><line className="cross" y1="-4" y2="4" x1="0" x2="0" />
          {lead > 2 && <line className="vec" x1={sx} y1={sy} x2={ex} y2={ey} />}
          <circle className={`me${lined ? ' ok' : ''}`} cx={sx} cy={sy} r={Math.max(2.4, RADIUS * k)} />
        </g>
        <text y="44" className="rng">{range >= 1000 ? `${range / 1000} km` : `${range} m`}</text>
      </svg>
      <div className="rcap">
        <span>ARMS <b>{above > 0 ? '+' : ''}{above >= 100 ? above.toFixed(0) : above.toFixed(1)}</b></span>
        <span>OFF <b>{t.offset >= 100 ? t.offset.toFixed(0) : t.offset.toFixed(1)}</b></span>
      </div>
    </div>
  );
}

/** Webcast-style telemetry: speed and altitude dials with velocity, an approach radar, the Ship and its engines. */
export function Hud() {
  const t = useTicker(telemetry);
  const altKm = t.alt >= 1000;
  return (
    <div className="top">
      <div className="left">
        <div className="grow">
          <Gauge value={Math.round(t.speed).toString()} frac={t.speed / 400} unit="KM/H" />
          <Gauge value={altKm ? (t.alt / 1000).toFixed(2) : Math.round(t.alt).toString()} frac={t.alt / 3000} unit={altKm ? 'KM' : 'M'} />
        </div>
        <Velocity t={t} />
      </div>
      <Radar t={t} />
      <div className="right">
        <ShipGauge t={t} />
        <Engines t={t} />
      </div>
    </div>
  );
}
