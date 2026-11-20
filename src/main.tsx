import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useGame } from './state/store';
import './ui/styles.css';

// ?debug exposes the game store for automated browser checks
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { game: typeof useGame }).game = useGame;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
