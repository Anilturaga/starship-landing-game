import { useGesture } from '@use-gesture/react';
import { useEffect, useRef } from 'react';
import { GameScene } from './scene/GameScene';
import { input, toggleEngines } from './state/input';
import { useGame } from './state/store';
import { view } from './state/view';
import { Controls } from './ui/Controls';
import { EndCard } from './ui/EndCard';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const HELD = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyX', 'ControlLeft', 'ControlRight'];

function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = useGame.getState();
      if (HELD.includes(e.code)) { input.keys.add(e.code); e.preventDefault(); return; }
      if (e.repeat) return;
      if (e.code === 'Escape') g.openMenu();
      else if (e.code === 'Space') { e.preventDefault(); if (g.screen === 'flying') toggleEngines(g.sim); else g.start(); }
      else if (e.code === 'KeyC') g.setCamera(g.camera + 1);
      else if (/^Digit[1-5]$/.test(e.code)) g.setCamera(+e.code.slice(5) - 1);
      else if (e.code === 'KeyT') g.sim.cycleSpeed();
      else if (e.code === 'KeyR') g.start();
    };
    const up = (e: KeyboardEvent) => input.keys.delete(e.code);
    const blur = () => input.keys.clear();
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);
}

/** Drag to orbit (chase) or look around (other cameras); pinch or wheel to zoom; double-tap to reset. */
function useCameraGestures() {
  const lastTap = useRef(0);
  const zoom = (f: number) => {
    if (useGame.getState().camera <= 1) view.orbit.dist = clamp(view.orbit.dist * f, 25, 600);
    else view.zoom = clamp(view.zoom * f, 0.3, 1.5);
  };
  return useGesture(
    {
      onDrag: ({ delta: [dx, dy], tap, pinching, timeStamp }) => {
        if (tap) {
          if (timeStamp - lastTap.current < 300) view.reset();
          lastTap.current = timeStamp;
          return;
        }
        if (pinching) return;
        if (useGame.getState().camera === 0) {
          view.orbit.auto = false;
          view.orbit.yaw -= dx * 0.006;
          view.orbit.pitch = clamp(view.orbit.pitch + dy * 0.005, -0.6, 1.55);
        } else {
          view.look.yaw = clamp(view.look.yaw - dx * 0.004, -1.4, 1.4);
          view.look.pitch = clamp(view.look.pitch - dy * 0.004, -0.9, 0.9);
        }
      },
      onPinch: ({ delta: [ds] }) => zoom(Math.exp(-ds)),
      onWheel: ({ delta: [, dy] }) => zoom(Math.exp(dy * 0.001)),
    },
    { drag: { filterTaps: true } },
  );
}

export default function App() {
  useKeyboard();
  const gestures = useCameraGestures();
  const screen = useGame((s) => s.screen);
  const camera = useGame((s) => s.camera);
  return (
    <>
      <div className="stage" {...gestures()}>
        <GameScene />
      </div>
      <div className={`vig${camera === 2 || camera === 3 ? ' on' : ''}`} />
      <Hud />
      {screen !== 'menu' && <Controls />}
      {screen === 'menu' && <Menu />}
      {screen === 'ended' && <EndCard />}
    </>
  );
}
