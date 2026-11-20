import { useGame } from '../state/store';

const TITLES = { caught: 'Caught', ground: 'Landed off target', ocean: 'Aborted to ocean', crash: 'Vehicle lost' } as const;

export function EndCard() {
  const o = useGame((s) => s.outcome);
  const sim = useGame((s) => s.sim);
  const start = useGame((s) => s.start);
  const openMenu = useGame((s) => s.openMenu);
  if (!o) return null;
  const L = sim.mode.limits;
  let why = o.why;
  if (o.kind === 'crash' || o.kind === 'ground') {
    why += o.siteSafe ? ' It came down well clear of the tower, so the site is safe.' : ' The tower and pad took damage.';
  }
  const Stat = ({ label, value, ok }: { label: string; value: string; ok?: boolean }) => (
    <div><span>{label}</span><b className={ok === undefined ? '' : ok ? 'ok' : 'bad'}>{value}</b></div>
  );
  return (
    <div className="card" role="dialog" aria-labelledby="end-title">
      <h1 id="end-title">{TITLES[o.kind]}</h1>
      <p>{why}</p>
      <div className="stats">
        <Stat label="Descent rate" value={`${o.descent.toFixed(1)} m/s`} ok={o.descent < L.vs} />
        <Stat label="Sideways speed" value={`${o.sideways.toFixed(1)} m/s`} ok={o.sideways < L.hs} />
        <Stat label="Offset from centre" value={`${o.offset.toFixed(1)} m`} ok={o.offset < L.off} />
        <Stat label="Tilt" value={`${o.tilt.toFixed(1)}°`} ok={o.tilt < L.tilt} />
        <Stat label="Propellant left" value={`${(o.propellant / 1000).toFixed(1)} t`} />
        <Stat label="Flight time" value={`${o.time.toFixed(1)} s`} />
      </div>
      <div className="btns">
        <button className="go" onClick={() => start()}>Fly again</button>
        <button className="go alt" onClick={openMenu}>Change mode</button>
      </div>
    </div>
  );
}
