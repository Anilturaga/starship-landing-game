import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
const TAU = Math.PI * 2;

function canvasTexture(w: number, h: number, draw: Draw, opts: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  if (opts.repeat) t.repeat.set(...opts.repeat);
  if (opts.srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Black hexagonal heat-shield tiles, with the odd lighter replacement tile. */
export const tileTexture = () =>
  canvasTexture(1024, 1024, (x, w, h) => {
    x.fillStyle = '#08080a';
    x.fillRect(0, 0, w, h);
    const s = w / 48, hh = s * Math.sqrt(3);
    for (let c = -1; c <= w / (1.5 * s) + 1; c++) {
      for (let r = -1; r <= h / hh + 1; r++) {
        const cx = c * 1.5 * s, cy = r * hh + (c & 1 ? hh / 2 : 0);
        let v = 20 + Math.random() * 13;
        if (Math.random() < 0.01) v = 120 + Math.random() * 50;
        x.fillStyle = `rgb(${v | 0},${v | 0},${(v + 3) | 0})`;
        x.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k * Math.PI) / 3;
          x.lineTo(cx + (s - 1.3) * Math.cos(a), cy + (s - 1.3) * Math.sin(a));
        }
        x.fill();
      }
    }
  }, { repeat: [1.7, 4.6], srgb: true });

/** Brushed stainless roughness with a weld seam per ring. */
export const steelRoughness = () =>
  canvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#6c6c6c';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 70 + Math.random() * 90;
      x.strokeStyle = `rgba(${v},${v},${v},.22)`;
      x.beginPath();
      const px = Math.random() * w;
      x.moveTo(px, 0);
      x.lineTo(px + (Math.random() - 0.5) * 3, h);
      x.stroke();
    }
    x.fillStyle = '#2e2e2e';
    x.fillRect(0, 0, w, 3);
    x.fillStyle = '#a8a8a8';
    x.fillRect(0, 3, w, 2);
  }, { repeat: [6, 22] });

/** Tileable wave normal map. */
export const waterNormals = () =>
  canvasTexture(256, 256, (x, w, h) => {
    const img = x.createImageData(w, h);
    const F = (i: number, j: number) =>
      Math.sin((i * TAU * 3) / w + Math.sin((j * TAU * 2) / h) * 1.3) + 0.6 * Math.sin(((i + j) * TAU * 5) / w) +
      0.4 * Math.sin(((2 * i - j) * TAU * 7) / w) + 0.3 * Math.sin(((i - 3 * j) * TAU * 4) / w);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const dx = F(i + 1, j) - F(i - 1, j), dy = F(i, j + 1) - F(i, j - 1);
        const nx = -dx * 1.6, ny = -dy * 1.6, l = Math.hypot(nx, ny, 1), o = (j * w + i) * 4;
        img.data[o] = (nx / l * 0.5 + 0.5) * 255;
        img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255;
        img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
  }, { repeat: [500, 500] });

/** Tileable multi-octave value noise, for ground detail close to the camera. */
export const detailNoise = () =>
  canvasTexture(512, 512, (x, w, h) => {
    const img = x.createImageData(w, h);
    const grid = (n: number) => Array.from({ length: n * n }, () => Math.random());
    const octs = [8, 16, 32, 64, 128].map((n) => ({ n, g: grid(n) }));
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let v = 0, a = 0.5, tot = 0;
        for (const { n, g } of octs) {
          const fx = (i / w) * n, fy = (j / h) * n, x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = smooth(fx - x0), ty = smooth(fy - y0);
          const at = (cx: number, cy: number) => g[((cy % n) * n) + (cx % n)];
          const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx, bot = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
          v += (top * (1 - ty) + bot * ty) * a; tot += a; a *= 0.6;
        }
        const c = (v / tot) * 255, o = (j * w + i) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = c;
        img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
  });

/** Wispy high cirrus: streaks of stretched noise with soft alpha. */
export const cirrusTexture = () =>
  canvasTexture(1024, 1024, (x, w, h) => {
    x.clearRect(0, 0, w, h); // white wisps, the strength is in alpha
    for (let k = 0; k < 45; k++) {
      const cx = Math.random() * w, cy = Math.random() * h, len = 120 + Math.random() * 380, ang = -0.5 + Math.random() * 0.35;
      for (let s = 0; s < 40; s++) {
        const t = s / 40, px = cx + Math.cos(ang) * len * t + Math.sin(t * 9 + k) * 8, py = cy + Math.sin(ang) * len * t + Math.cos(t * 7) * 5;
        const r = 6 + 22 * Math.sin(t * Math.PI) * Math.random();
        for (const [ox, oy] of [[0, 0], [-w, 0], [w, 0], [0, -h], [0, h]]) {
          const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
          g.addColorStop(0, `rgba(255,255,255,${0.05 + Math.random() * 0.07})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g;
          x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
        }
      }
    }
  });

/** Soft radial glow for engine bloom and explosions. */
export const glowTexture = () =>
  canvasTexture(128, 128, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,240,215,1)');
    g.addColorStop(0.25, 'rgba(255,170,80,.6)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, w);
  });

/**
 * Concrete for the tower and mount footing (`w`×`h` metres, 20 px/m): weathered slabs with sawn joints every 6 m,
 * sand blown across it, tyre and rust stains, and soot from engine plumes, heaviest around the mount at (`mx`, `mz`)
 * in metres from the slab's corner.
 */
export const concreteTexture = (wm: number, hm: number, mx: number, mz: number) =>
  canvasTexture(Math.round(wm * 20), Math.round(hm * 20), (x, w, h) => {
    const k = w / wm;
    x.fillStyle = '#bdb8ad';
    x.fillRect(0, 0, w, h);
    // slab-to-slab tone, then mottling at several scales
    for (let i = 0; i * 6 < wm; i++) for (let j = 0; j * 6 < hm; j++) {
      const v = (Math.random() - 0.5) * 16;
      x.fillStyle = `rgba(${v > 0 ? '255,250,240' : '60,55,50'},${Math.abs(v) / 120})`;
      x.fillRect(i * 6 * k, j * 6 * k, 6 * k, 6 * k);
    }
    for (const [n, r0, r1, a] of [[900, 4, 30, 0.05], [5000, 1, 5, 0.06], [30000, 0.5, 1.5, 0.08]] as const) {
      for (let i = 0; i < n; i++) {
        const v = Math.random() < 0.5 ? '70,64,56' : '235,230,220';
        x.fillStyle = `rgba(${v},${Math.random() * a})`;
        x.beginPath();
        x.arc(Math.random() * w, Math.random() * h, r0 + Math.random() * (r1 - r0), 0, TAU);
        x.fill();
      }
    }
    // sand drifted in from the dunes, thicker at the edges
    for (let i = 0; i < 400; i++) {
      const edge = Math.random() < 0.5 ? Math.random() * 3 * k : h - Math.random() * 3 * k;
      x.fillStyle = `rgba(200,180,145,${Math.random() * 0.25})`;
      x.beginPath();
      x.ellipse(Math.random() * w, Math.random() < 0.7 ? edge : Math.random() * h, 8 + Math.random() * 40, 3 + Math.random() * 12, Math.random(), 0, TAU);
      x.fill();
    }
    // rust and fluid stains, tyre tracks
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(${Math.random() < 0.4 ? '120,80,50' : '50,48,45'},${0.05 + Math.random() * 0.12})`;
      x.beginPath();
      x.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 30, 3 + Math.random() * 20, Math.random() * TAU, 0, TAU);
      x.fill();
    }
    x.lineWidth = 0.35 * k;
    for (let i = 0; i < 8; i++) {
      x.strokeStyle = `rgba(40,38,35,${0.05 + Math.random() * 0.06})`;
      x.beginPath();
      const y0 = Math.random() * h;
      x.moveTo(0, y0);
      x.bezierCurveTo(w * 0.3, y0 + (Math.random() - 0.5) * h, w * 0.6, y0 + (Math.random() - 0.5) * h, w, y0 + (Math.random() - 0.5) * h * 0.5);
      x.stroke();
    }
    // soot: plume scorching radiating from the mount
    const g = x.createRadialGradient(mx * k, mz * k, 2 * k, mx * k, mz * k, 20 * k);
    g.addColorStop(0, 'rgba(25,22,20,0.75)');
    g.addColorStop(0.45, 'rgba(35,30,28,0.45)');
    g.addColorStop(1, 'rgba(40,36,32,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * TAU, r = (6 + Math.random() * 16) * k;
      x.strokeStyle = `rgba(20,18,16,${Math.random() * 0.12})`;
      x.lineWidth = (0.3 + Math.random() * 1.2) * k;
      x.beginPath();
      x.moveTo(mx * k + Math.cos(a) * 4 * k, mz * k + Math.sin(a) * 4 * k);
      x.lineTo(mx * k + Math.cos(a) * r, mz * k + Math.sin(a) * r);
      x.stroke();
    }
    // sawn joints
    x.strokeStyle = 'rgba(55,50,45,0.55)';
    x.lineWidth = Math.max(1, 0.03 * k);
    for (let i = 6; i < wm; i += 6) { x.beginPath(); x.moveTo(i * k, 0); x.lineTo(i * k, h); x.stroke(); }
    for (let j = 6; j < hm; j += 6) { x.beginPath(); x.moveTo(0, j * k); x.lineTo(w, j * k); x.stroke(); }
  }, { srgb: true });
