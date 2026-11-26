import { createActor } from 'xstate';
import { create } from 'zustand';
import { MODES, type ModeId } from '../sim/modes';
import type { Outcome } from '../sim/outcome';
import { Simulation } from '../sim/simulation';
import { screenMachine } from './screen';

export const CAMERAS = ['Chase', 'Target', 'Onboard', 'Engines', 'Ground'] as const;
const screen = createActor(screenMachine).start();
export type Screen = ReturnType<typeof screen.getSnapshot>['value'];
/** The screen after an event, so the store can set it together with what changed (one update, not two). */
const next = (type: 'START' | 'MENU' | 'FINISH') => {
  screen.send({ type });
  return screen.getSnapshot().value;
};

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
    get().sim.dispose();
    const sim = new Simulation(MODES[modeId]);
    sim.running = true;
    sim.runGuide();
    set({ modeId, sim, outcome: null, screen: next('START') });
  },
  openMenu: () => {
    get().sim.running = false;
    set({ screen: next('MENU') });
  },
  finish: (outcome) => set({ outcome, screen: next('FINISH') }),
  setCamera: (i) => set({ camera: (i + CAMERAS.length) % CAMERAS.length }),
}));

