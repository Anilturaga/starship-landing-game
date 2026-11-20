import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initPhysics } from './sim/world';
import './ui/styles.css';

// Rapier is WebAssembly: load it before the store creates the first flight
initPhysics().then(async () => {
  const [{ default: App }, { useGame }, { view }] = await Promise.all([import('./App'), import('./state/store'), import('./state/view')]);
  // ?debug exposes the game store and camera state for automated browser checks
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { game: useGame, view });
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
});
