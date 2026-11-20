import { useEffect, useState } from 'react';

/** Re-renders at `hz` with the value `read()` returns. For HUD readouts that change every frame. */
export function useTicker<T>(read: () => T, hz = 15): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      if (t - last >= 1000 / hz) { last = t; setValue(read()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [read, hz]);
  return value;
}
