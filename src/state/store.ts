import { create } from 'zustand';
import { MODES, type ModeId } from '../sim/modes';
import type { Outcome } from '../sim/outcome';
import { Simulation } from '../sim/simulation';

export const CAMERAS = ['Chase', 'Tracking', 'Aft flap', 'Engine bay', 'Tower'] as const;
export type Screen = 'menu' | 'flying' | 'ended';

const savedMode = (): ModeId => {
  try {
    const m = localStorage.getItem('catchMode');
    if (m && m in MODES) return m as ModeId;
  } catch { /* storage unavailable */ }
  return 'cadet';
};

interface GameState {
  screen: Screen;
  modeId: ModeId;
  /** The current flight. Mutable, read every frame; React only re-renders on the fields above/below. */
  sim: Simulation;
  camera: number;
  outcome: Outcome | null;
  start: (mode?: ModeId) => void;
  openMenu: () => void;
  finish: (o: Outcome) => void;
  setCamera: (i: number) => void;
}

export const useGame = create<GameState>((set, get) => ({
  screen: 'menu',
  modeId: savedMode(),
  sim: new Simulation(MODES[savedMode()]),
  camera: 0,
  outcome: null,
  start: (mode) => {
    const modeId = mode ?? get().modeId;
    try { localStorage.setItem('catchMode', modeId); } catch { /* ignore */ }
    const sim = new Simulation(MODES[modeId]);
    sim.running = true;
    sim.runGuide();
    set({ modeId, sim, screen: 'flying', outcome: null });
  },
  openMenu: () => {
    get().sim.running = false;
    set({ screen: 'menu' });
  },
  finish: (outcome) => set({ outcome, screen: 'ended' }),
  setCamera: (i) => set({ camera: (i + CAMERAS.length) % CAMERAS.length }),
}));
