import { MODES, type ModeId } from '../sim/modes';
import { useGame } from '../state/store';

export function Menu() {
  const modeId = useGame((s) => s.modeId);
  const start = useGame((s) => s.start);
  return (
    <div className="card" role="dialog" aria-labelledby="menu-title">
      <h1 id="menu-title">Catch the Ship</h1>
      <p>Bring Ship down from 2.6 km and set it into the tower's arms before the propellant runs out.</p>
      <div className="modes">
        {(Object.keys(MODES) as ModeId[]).map((id) => (
          <button key={id} className="mode" aria-pressed={id === modeId} onClick={() => start(id)}>
            <b>{MODES[id].name}</b>
            <span>{MODES[id].desc}</span>
          </button>
        ))}
      </div>
      <details className="how">
        <summary>How to fly</summary>
        <ul>
          <li><b>Glide:</b> tilt the nose down to glide toward the tower, and up to slow down.</li>
          <li><b>Flip:</b> at about 1.2 km, light the Raptors with a little throttle and pull back to stand the Ship up.</li>
          <li><b>Settle:</b> throttle against the fall and nudge the stick to drift over the arms.</li>
          <li><b>Cues:</b> line up the white dot inside the blue ring in the scope above the stick. Above the throttle, ▲ means push up, ▼ pull down, ● hold.</li>
          <li><b>Camera:</b> drag the screen to look around, pinch or scroll to zoom, double-tap to reset.</li>
        </ul>
        <div className="keys">
          <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> stick · <kbd>Shift</kbd>/<kbd>X</kbd> throttle · <kbd>Space</kbd> engines off / on ·{' '}
          <kbd>C</kbd> camera · <kbd>T</kbd> slow motion · <kbd>R</kbd> restart · <kbd>Esc</kbd> menu
        </div>
      </details>
    </div>
  );
}
