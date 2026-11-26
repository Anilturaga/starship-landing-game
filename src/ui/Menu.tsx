import { MODES, type ModeId } from '../sim/modes';
import { Crosshair, GraduationCap, Play, SteeringWheel, type Icon } from '@phosphor-icons/react';
import { useGame } from '../state/store';

const ICONS: Record<ModeId, Icon> = { cadet: GraduationCap, pilot: SteeringWheel, expert: Crosshair };

export function Menu() {
  const modeId = useGame((s) => s.modeId);
  const start = useGame((s) => s.start);
  const paused = useGame((s) => s.screen === 'paused');
  const resume = useGame((s) => s.resume);
  return (
    <div className="card" role="dialog" aria-labelledby="menu-title">
      <h1 id="menu-title">Starship Landing Game</h1>
      <p>Bring Ship down from 2.6 km and set it into the tower's arms before the propellant runs out.</p>
      {paused && <div className="btns"><button className="go" onClick={resume}><Play weight="bold" /> Resume flight</button></div>}
      <div className="modes">
        {(Object.keys(MODES) as ModeId[]).map((id) => {
          const I = ICONS[id];
          return (
          <button key={id} className="mode" aria-pressed={id === modeId} onClick={() => start(id)}>
            <b><I size={18} weight="bold" /> {MODES[id].name}</b>
            <span>{MODES[id].desc}</span>
          </button>
          );
        })}
      </div>
      <details className="how">
        <summary>How to fly</summary>
        <ul>
          <li><b>The stick sets the attitude.</b> Where your thumb is, is how the Ship leans. Let go and it holds steady. (Expert: the stick sets a turn rate instead.)</li>
          <li><b>Glide:</b> push forward to tilt the nose down and glide toward the tower, pull back to slow down, and push sideways to turn.</li>
          <li><b>Flip:</b> at about 1.2 km the Raptors light. Pull back and hold to swing the Ship upright; let go to stop the rotation.</li>
          <li><b>Settle:</b> lean toward the tower with small stick movements, and throttle against the fall. Near the arms, creep down slowly until lined up.</li>
          <li><b>Cues:</b> line up the white dot inside the blue ring in the scope above the stick. On the throttle, the blue line is the suggested setting. Cues turn red on an abort.</li>
          <li><b>Camera:</b> drag the screen to look around, pinch or scroll to zoom, tap the target button to recenter.</li>
        </ul>
        <div className="keys">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> stick</span>
          <span><kbd>Shift</kbd>/<kbd>X</kbd> throttle</span>
          <span><kbd>Space</kbd> engines off / on</span>
          <span><kbd>C</kbd> camera</span>
          <span><kbd>T</kbd> slow motion</span>
          <span><kbd>R</kbd> restart</span>
          <span><kbd>Esc</kbd> pause</span>
        </div>
      </details>
      <p className="credit">Ground imagery and elevation: USGS The National Map (public domain).</p>
    </div>
  );
}
