import { useEffect, useRef, useState } from 'react';
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
function useCameraDrag() {
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const lastTap = useRef(0);
  const zoom = (f: number) => {
    if (useGame.getState().camera === 0) view.orbit.dist = clamp(view.orbit.dist * f, 25, 600);
    else view.zoom = clamp(view.zoom * f, 0.3, 1.5);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.current.size === 1) {
        if (e.timeStamp - lastTap.current < 300) view.reset();
        lastTap.current = e.timeStamp;
      }
      if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pinch.current = Math.hypot(a.x - b.x, a.y - b.y); }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = ptrs.current.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.current.size === 2) {
        const [a, b] = [...ptrs.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.current > 0) zoom(pinch.current / d);
        pinch.current = d;
        return;
      }
      if (useGame.getState().camera === 0) {
        view.orbit.auto = false;
        view.orbit.yaw -= dx * 0.006;
        view.orbit.pitch = clamp(view.orbit.pitch + dy * 0.005, -0.6, 1.4);
      } else {
        view.look.yaw = clamp(view.look.yaw - dx * 0.004, -1.4, 1.4);
        view.look.pitch = clamp(view.look.pitch - dy * 0.004, -0.9, 0.9);
      }
    },
    onPointerUp: (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = 0; },
    onPointerCancel: (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = 0; },
    onWheel: (e: React.WheelEvent) => zoom(Math.exp(e.deltaY * 0.001)),
  };
}

export default function App() {
  useKeyboard();
  const drag = useCameraDrag();
  const screen = useGame((s) => s.screen);
  const camera = useGame((s) => s.camera);
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (screen !== 'flying') return;
    setHint(true);
    const t = setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(t);
  }, [screen]);
  return (
    <>
      <div className="stage" {...drag} onPointerDownCapture={() => setHint(false)}>
        <GameScene />
      </div>
      <div className={`vig${camera === 2 || camera === 3 ? ' on' : ''}`} />
      <Hud />
      <div className={`hint${hint ? '' : ' off'}`}>Drag to look around · double-tap to reset</div>
      {screen !== 'menu' && <Controls />}
      {screen === 'menu' && <Menu />}
      {screen === 'ended' && <EndCard />}
    </>
  );
}
