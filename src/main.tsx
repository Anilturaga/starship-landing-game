import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initPhysics } from './sim/world';
import './ui/styles.css';

// Rapier is WebAssembly: load it before the store creates the first flight
initPhysics().then(async () => {
  const [{ default: App }, { useGame }] = await Promise.all([import('./App'), import('./state/store')]);
  // ?debug exposes the game store for automated browser checks
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { game: typeof useGame }).game = useGame;
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
});
