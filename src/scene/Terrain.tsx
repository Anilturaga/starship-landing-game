import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  BufferAttribute, ClampToEdgeWrapping, Color, MeshStandardMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, SRGBColorSpace,
  Vector2, type Texture,
} from 'three';
import farUrl from '../assets/terrain-far.jpg';
import farRoughUrl from '../assets/terrain-far-rough.png';
import heightUrl from '../assets/terrain-height.png';
import midUrl from '../assets/terrain-mid.jpg';
import midRoughUrl from '../assets/terrain-mid-rough.png';
import nearUrl from '../assets/terrain-near.jpg';
import nearRoughUrl from '../assets/terrain-near-rough.png';
import padUrl from '../assets/terrain-pad.jpg';
import meta from '../assets/terrain.json';
import { detailNoise, waterNormals } from './textures';

/**
 * Real ground from USGS data (public domain, see scripts/terrain.py):
 * - centre 2 km: lidar heights (dunes), 1 m imagery with 0.3 m imagery over the pad, plus fine detail
 *   near the camera so it still reads as ground from a few metres up;
 * - rings out to 6 km, 35 km and a fog-hidden apron, flat. Rings never overlap, so nothing z-fights.
 * The Gulf is glossy (roughness from a sea mask) and ripples.
 */
const [CX, CZ] = meta.centre;
const WAVE = 45; // m per ripple-texture repeat
const DETAIL = 7; // m per detail-texture repeat
const NORMAL = new Vector2(0.18, 0.18);
/** NAIP's pale flats read slightly lilac under a deep blue sky; a touch of warmth corrects it. */
const WARM = new Color(1.05, 1.0, 0.92);

/** Square ring in ground coordinates (x east, y north) with UVs spanning `uvSize` metres around the site. */
function ring(outer: number, inner: number, uvSize: number) {
  const sq = (h: number, P: typeof Shape | typeof Path) => {
    const p = new P();
    p.moveTo(CX - h, -CZ - h); p.lineTo(CX + h, -CZ - h); p.lineTo(CX + h, -CZ + h); p.lineTo(CX - h, -CZ + h); p.closePath();
    return p;
  };
  const shape = sq(outer / 2, Shape) as Shape;
  shape.holes.push(sq(inner / 2, Path) as Path);
  const g = new ShapeGeometry(shape);
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - CX) / uvSize + 0.5;
    uv[i * 2 + 1] = (pos.getY(i) + CZ) / uvSize + 0.5;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

/** The centre: a grid displaced by the lidar heights. */
function heightGrid(img: HTMLImageElement) {
  const n = meta.height.size;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, n, n).data;
  const g = new PlaneGeometry(meta.mid, meta.mid, n - 1, n - 1);
  const pos = g.attributes.position;
  // PlaneGeometry rows run north to south, as the image does
  for (let i = 0; i < pos.count; i++) pos.setZ(i, px[i * 4] * meta.height.scale);
  g.computeVertexNormals();
  return g;
}

function useRipples(waves: Texture, uvSize: number) {
  const t = useMemo(() => {
    const r = waves.clone();
    r.repeat.setScalar(uvSize / WAVE);
    return r;
  }, [waves, uvSize]);
  useFrame(({ clock }) => t.offset.set(clock.elapsedTime * 0.0006 * (uvSize / WAVE), clock.elapsedTime * 0.0003 * (uvSize / WAVE)));
  return t;
}

/** Imagery material for the centre: the pad imagery over the mid imagery, and detail that fades with distance. */
function centreMaterial(mid: Texture, pad: Texture, rough: Texture, ripples: Texture, detail: Texture) {
  const m = new MeshStandardMaterial({ color: WARM, map: mid, roughnessMap: rough, roughness: 1, metalness: 0, normalMap: ripples, normalScale: NORMAL, envMapIntensity: 0.35 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPad = { value: pad };
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uPadScale = { value: meta.mid / meta.pad };
    sh.uniforms.uDetailRepeat = { value: meta.mid / DETAIL };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uPad, uDetail; uniform float uPadScale, uDetailRepeat;')
      .replace('#include <map_fragment>', /* glsl */ `
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec2 puv = (vMapUv - 0.5) * uPadScale + 0.5;
        vec2 e = smoothstep(0.0, 0.08, puv) * smoothstep(0.0, 0.08, 1.0 - puv);
        sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(uPad, clamp(puv, 0.0, 1.0)), e.x * e.y);
        float near = 1.0 - smoothstep(120.0, 900.0, length(vViewPosition));
        float d = texture2D(uDetail, vMapUv * uDetailRepeat).r * 0.65 + texture2D(uDetail, vMapUv * uDetailRepeat * 0.13).r * 0.35;
        sampledDiffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * d, near * 0.7);
        diffuseColor *= sampledDiffuseColor;`);
  };
  return m;
}

function Ring({ outer, inner, uvSize, map, rough, waves }: { outer: number; inner: number; uvSize: number; map: Texture; rough: Texture; waves: Texture }) {
  const geo = useMemo(() => ring(outer, inner, uvSize), [outer, inner, uvSize]);
  const ripples = useRipples(waves, uvSize);
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={WARM} map={map} roughnessMap={rough} roughness={1} metalness={0} normalMap={ripples} normalScale={NORMAL} envMapIntensity={0.35} />
    </mesh>
  );
}

/**
 * Beyond the imagery, out to the horizon: plain land and sea colours, a little below the rings so they
 * cover it. (Stretching the imagery's edge pixels showed as streaks once the haze was thinned.)
 */
function Apron() {
  const geo = useMemo(() => {
    const g = new PlaneGeometry(400_000, 400_000, 100, 100);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    const land = new Color().setRGB(...(meta.apron.land.map((v) => v / 255) as [number, number, number]), SRGBColorSpace);
    const sea = new Color().setRGB(...(meta.apron.sea.map((v) => v / 255) as [number, number, number]), SRGBColorSpace);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
      (x > meta.shore.x + meta.shore.slope * Math.max(-20000, Math.min(20000, z)) ? sea : land).toArray(col, i * 3);
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[0, -3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
    </mesh>
  );
}

export function Terrain() {
  const tex = useTexture([padUrl, midUrl, nearUrl, farUrl, midRoughUrl, nearRoughUrl, farRoughUrl, heightUrl]);
  const [pad, mid, near, far, midRough, nearRough, farRough, height] = tex;
  useMemo(() => {
    for (const t of [pad, mid, near, far]) t.colorSpace = SRGBColorSpace;
    for (const t of tex) { t.wrapS = t.wrapT = ClampToEdgeWrapping; t.anisotropy = 8; }
  }, [tex]); // eslint-disable-line react-hooks/exhaustive-deps
  const waves = useMemo(waterNormals, []);
  const detail = useMemo(detailNoise, []);
  const centreRipples = useRipples(waves, meta.mid);
  const grid = useMemo(() => heightGrid(height.image as HTMLImageElement), [height]);
  const material = useMemo(() => centreMaterial(mid, pad, midRough, centreRipples, detail), [mid, pad, midRough, centreRipples, detail]);
  return (
    <group>
      {/* the centre receives shadows: the Ship's and the tower's fall on it near the pad */}
      <mesh geometry={grid} material={material} position={[CX, 0, CZ]} rotation={[-Math.PI / 2, 0, 0]} />
      <Ring outer={meta.near} inner={meta.mid} uvSize={meta.near} map={near} rough={nearRough} waves={waves} />
      <Ring outer={meta.far} inner={meta.near} uvSize={meta.far} map={far} rough={farRough} waves={waves} />
      <Apron />
    </group>
  );
}
