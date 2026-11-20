import { MODES, type ModeId } from '../sim/modes';
import { Crosshair, GraduationCap, SteeringWheel, type Icon } from '@phosphor-icons/react';
import { useGame } from '../state/store';

const ICONS: Record<ModeId, Icon> = { cadet: GraduationCap, pilot: SteeringWheel, expert: Crosshair };

export function Menu() {
  const modeId = useGame((s) => s.modeId);
  const start = useGame((s) => s.start);
  return (
    <div className="card" role="dialog" aria-labelledby="menu-title">
      <h1 id="menu-title">Catch the Ship</h1>
      <p>Bring Ship down from 2.6 km and set it into the tower's arms before the propellant runs out.</p>
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
          <li><b>Cues:</b> line up the white dot inside the blue ring in the scope above the stick. Above the throttle, an up caret means push up, a down caret pull down, a dot hold.</li>
          <li><b>Camera:</b> drag the screen to look around, pinch or scroll to zoom, double-tap to reset.</li>
        </ul>
        <div className="keys">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> stick · <kbd>Shift</kbd>/<kbd>X</kbd> throttle · <kbd>Space</kbd> engines off / on ·{' '}
          <kbd>C</kbd> camera · <kbd>T</kbd> slow motion · <kbd>R</kbd> restart · <kbd>Esc</kbd> menu
        </div>
      </details>
      <p className="credit">Ground imagery: USGS National Map (public domain).</p>
    </div>
  );
}
