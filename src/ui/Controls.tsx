import { useCallback, useRef, useState } from 'react';
import { CAMERAS, useGame } from '../state/store';
import { input } from '../state/input';
import { useTicker } from './useTicker';
import { GpsFix, List, SpeakerSimpleHigh, SpeakerSimpleSlash, Timer, VideoCamera } from '@phosphor-icons/react';
import { view } from '../state/view';
import { audio } from '../audio/audio';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Smoothed copy of the flight computer's cue, so the blue markers glide instead of jumping. */
const cue = { x: 0, y: 0, thr: 0, has: false };

function readControls() {
  const sim = useGame.getState().sim;
  const g = sim.guide, s = sim.ship;
  const show = sim.mode.guides && sim.running && !sim.outcome;
  if (show && g.stick) {
    const k = cue.has ? 0.25 : 1;
    cue.x += (g.stick.x - cue.x) * k;
    cue.y += (g.stick.y - cue.y) * k;
    if (g.throttle != null) cue.thr += (g.throttle - cue.thr) * k;
    cue.has = true;
  } else cue.has = false;
  return {
    show,
    stickCue: show && !!g.stick,
    thrCue: show && g.throttle != null && !sim.mode.autoThrottle,
    cue: { ...cue },
    abort: show ? g.abort : null,
    stick: { ...s.inp },
    thr: s.thr,
    auto: sim.mode.autoThrottle,
    moved: !view.orbit.auto || Math.abs(view.orbit.dist - 120) > 1 || view.look.yaw !== 0 || view.look.pitch !== 0 || view.zoom !== 1,
    muted: audio.muted,
    speed: sim.autoSlow ? '½× auto' : sim.timeScale > 0.75 ? '1×' : sim.timeScale > 0.375 ? '½×' : '¼×',
  };
}

function Stick({ c }: { c: ReturnType<typeof readControls> }) {
  const abort = !!c.abort;
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    const r = el.current!.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2.4);
    let y = (e.clientY - r.top - r.height / 2) / (r.height / 2.4);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    input.touch.x = x;
    input.touch.y = -y;
    setKnob({ x, y });
  };
  const release = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    id.current = null;
    input.touch.x = input.touch.y = 0;
    setKnob({ x: 0, y: 0 });
  };
  return (
    <div
      ref={el} className={`stick${abort ? ' abort' : ''}`} aria-label="Pitch and lateral stick"
      onPointerDown={(e) => { id.current = e.pointerId; el.current!.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move} onPointerUp={release} onPointerCancel={release}
    >
      {c.stickCue && <div className="ghost" style={{ transform: `translate(${c.cue.x * 36}px,${-c.cue.y * 36}px)` }} />}
      <div className="knob" style={{ transform: `translate(${knob.x * 36}px,${knob.y * 36}px)` }} />
    </div>
  );
}

function Throttle({ c }: { c: ReturnType<typeof readControls> }) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const move = (e: React.PointerEvent) => {
    if (e.pointerId !== id.current) return;
    const r = el.current!.getBoundingClientRect();
    useGame.getState().sim.setThrottle(clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
  };
  return (
    <div
      ref={el} className={`thr${c.auto ? ' auto' : ''}`} aria-label="Throttle"
      onPointerDown={(e) => { if (c.auto) return; id.current = e.pointerId; el.current!.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={move} onPointerUp={() => (id.current = null)} onPointerCancel={() => (id.current = null)}
    >
      <div className="fill" style={{ height: `calc(${c.thr * 100}% - 6px)` }} />
      {c.thrCue && <div className={`tghost${c.abort ? ' abort' : ''}`} style={{ bottom: `${c.cue.thr * 100}%` }} />}
      <div className="z" style={{ bottom: '33.3%' }} /><div className="z" style={{ bottom: '66.6%' }} />
      <span className="zl" style={{ bottom: '-2%' }}>OFF</span>
      <span className="zl" style={{ bottom: '18%' }}>1</span>
      <span className="zl" style={{ bottom: '50%' }}>2</span>
      <span className="zl" style={{ bottom: '83%' }}>3</span>
      {c.auto && <div className="cap lbl">AUTO</div>}
    </div>
  );
}

/** Mirror of the stick cue, above the stick where the thumb doesn't cover it. */
function Scope({ c }: { c: ReturnType<typeof readControls> }) {
  if (!c.stickCue) return null;
  const ok = Math.hypot(c.cue.x - c.stick.x, c.cue.y - c.stick.y) < 0.18;
  return (
    <div className={`scope${ok ? ' ok' : ''}${c.abort ? ' abort' : ''}`} aria-hidden="true">
      <i className="sg" style={{ transform: `translate(${c.cue.x * 21}px,${-c.cue.y * 21}px)` }} />
      <i className="sk" style={{ transform: `translate(${c.stick.x * 21}px,${-c.stick.y * 21}px)` }} />
    </div>
  );
}

export function Controls() {
  const read = useCallback(readControls, []);
  const c = useTicker(read, 30);
  const camera = useGame((s) => s.camera);
  const setCamera = useGame((s) => s.setCamera);
  const openMenu = useGame((s) => s.openMenu);
  return (
    <>
      <Stick c={c} />
      <Scope c={c} />
      <Throttle c={c} />
      <div className="chips">
        {c.moved && <button className="chip recenter" onClick={() => view.reset()} aria-label="Recenter the camera"><GpsFix size={18} weight="bold" /></button>}
        <button className="chip" onClick={() => setCamera(camera + 1)} aria-label="Next camera"><VideoCamera size={16} /><b>{CAMERAS[camera]}</b></button>
        <button className="chip" onClick={() => useGame.getState().sim.cycleSpeed()} aria-label="Game speed"><Timer size={16} /><b>{c.speed}</b></button>
        <button className="chip" onClick={() => audio.setMuted(!audio.muted)} aria-label={c.muted ? 'Sound on' : 'Mute'}>
          {c.muted ? <SpeakerSimpleSlash size={16} /> : <SpeakerSimpleHigh size={16} />}
        </button>
        <button className="chip" onClick={openMenu} aria-label="Menu"><List size={16} weight="bold" /></button>
      </div>
    </>
  );
}
