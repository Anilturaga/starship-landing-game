# Catch the Ship

A browser game about flying Starship's upper stage back to the launch tower: belly-flop through the air, flip upright on the Raptors, and settle the Ship into the catch arms before the propellant runs out. It is built for phones first, and also works with a keyboard.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. Add `?debug` to expose the game store as `window.game` for automated checks.

## Check it

```bash
npm test
```

The tests fly complete descents headlessly. One pilot does exactly what the flight computer's cues say: it must catch the Ship in Cadet and Pilot modes, and abort safely (to the ocean, or clear of the tower) when a catch is impossible.

```bash
npm run build
```

To build one self-contained HTML file (everything inlined, opens straight from disk or as a hosted page):

```bash
npm run build:html
```

The output is `dist-html/index.html`.

## Layout

| Path | What |
| --- | --- |
| `src/sim/` | Force model, Rapier world (integration and contacts), flight computer and game speed. Runs in Node. |
| `src/scene/` | React Three Fiber scene: Ship, launch site, sky and cameras. |
| `src/ui/` | HUD, thumb controls, menus. |
| `src/state/` | Zustand store, input and camera-drag state. |
| `tests/` | Vitest flight tests. |
| `docs/DESIGN.md` | Design decisions and the reasoning behind them. |
| `prototype/` | The single-file prototype the design was settled in. |

## Controls

| Control | Touch | Keyboard |
| --- | --- | --- |
| Pitch / lateral | Left stick | W A S D |
| Throttle (0 = engines off) | Right slider | Shift up, X down, Space off/on |
| Camera | Cam button, or drag the view | C, 1–5 |
| Slow motion | Speed button | T |
| Restart / menu | ☰ | R / Esc |

This is a fan project. It is not affiliated with SpaceX and uses none of its logos or assets.
