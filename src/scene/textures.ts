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

/** Coastal scrub and sand. */
export const groundTexture = () =>
  canvasTexture(256, 256, (x, w, h) => {
    x.fillStyle = '#6a6446';
    x.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const r = 1 + Math.random() * 5;
      x.fillStyle = Math.random() < 0.55
        ? `rgba(66,76,46,${0.25 + Math.random() * 0.35})`
        : `rgba(158,146,110,${0.2 + Math.random() * 0.3})`;
      x.beginPath();
      x.arc(Math.random() * w, Math.random() * h, r, 0, TAU);
      x.fill();
    }
  }, { repeat: [260, 260], srgb: true });

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
