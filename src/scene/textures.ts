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
