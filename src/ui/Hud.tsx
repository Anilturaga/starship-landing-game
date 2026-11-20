import { ARM_Y, CATCH, DRY_MASS, G0 } from '../sim/constants';
import { basePos, pinPos, tiltDeg } from '../sim/outcome';
import { deltaVLeft } from '../sim/physics';
import { useGame } from '../state/store';
import { useTicker } from './useTicker';
import { Vector3 } from 'three';

const v1 = new Vector3(), v2 = new Vector3();

function telemetry() {
  const sim = useGame.getState().sim;
  const s = sim.ship;
  const base = basePos(s, v1), pin = pinPos(s, v2);
  return {
    speed: s.vel.length() * 3.6,
    alt: Math.max(0, base.y),
    armsAbove: pin.y - ARM_Y,
    offset: Math.hypot(pin.x - CATCH.x, pin.z - CATCH.z),
    prop: s.prop,
    propFrac: s.prop / sim.mode.propellant,
    dv: deltaVLeft(s.prop),
    engines: s.spool > 0 ? s.engines : 0,
    spooling: s.spool > 0 && s.spool < 1,
    tilt: tiltDeg(s),
    tw: s.thrust / ((DRY_MASS + s.prop) * G0),
    guides: sim.mode.guides,
  };
}

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

/** Webcast-style telemetry: speed and altitude dials, propellant, engine status, tilt. */
export function Hud() {
  const t = useTicker(telemetry);
  const altKm = t.alt >= 1000;
  const propClass = t.propFrac < 0.15 ? 'prop crit' : t.propFrac < 0.35 ? 'prop warn' : 'prop';
  return (
    <div className="top">
      <div className="left">
        <div className="grow">
          <Gauge value={Math.round(t.speed).toString()} frac={t.speed / 400} unit="KM/H" />
          <Gauge value={altKm ? (t.alt / 1000).toFixed(2) : Math.round(t.alt).toString()} frac={t.alt / 3000} unit={altKm ? 'KM' : 'M'} />
        </div>
        {t.guides && (
          <div className="nav">Arms <b>{t.armsAbove.toFixed(0)} m</b> · Offset <b>{t.offset.toFixed(1)} m</b></div>
        )}
      </div>
      <div className="right">
        <div className={propClass}>
          <div className="prow"><span>PROP</span><span>TONNES</span></div>
          <div className="big"><b>{(t.prop / 1000).toFixed(1)}</b></div>
          <div className="bar"><i style={{ width: `${(t.propFrac * 100).toFixed(1)}%` }} /></div>
          <div className="prow"><span>ΔV LEFT</span><b>{Math.round(t.dv)} m/s</b></div>
        </div>
        <div className="side">
          <svg viewBox="-32 -32 64 64" className="eng" role="img" aria-label={`${t.engines} Raptors lit`}>
            {[0, 1, 2].map((i) => {
              const a = ((i * 120 - 90) * Math.PI) / 180;
              return <circle key={`v${i}`} cx={Math.cos(a) * 21} cy={Math.sin(a) * 21} r="8" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="1.2" />;
            })}
            {[0, 1, 2].map((i) => {
              const a = ((i * 120 + 90) * Math.PI) / 180;
              const on = i < t.engines;
              return <circle key={`s${i}`} cx={Math.cos(a) * 9} cy={Math.sin(a) * 9} r="5.5" stroke="#f3f5f7" strokeWidth="1.4" fill={on ? (t.spooling ? 'rgba(255,178,74,.8)' : '#f3f5f7') : 'none'} />;
            })}
          </svg>
          <div className="att" aria-label="Tilt from vertical"><span>TILT</span><b>{t.tilt.toFixed(0)}°</b></div>
        </div>
      </div>
    </div>
  );
}
