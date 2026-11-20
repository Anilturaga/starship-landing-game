import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  BufferAttribute, ClampToEdgeWrapping, Path, Shape, ShapeGeometry, SRGBColorSpace, Vector2, type Texture,
} from 'three';
import farUrl from '../assets/terrain-far.jpg';
import nearUrl from '../assets/terrain-near.jpg';
import nearRoughUrl from '../assets/terrain-near-rough.png';
import farRoughUrl from '../assets/terrain-rough.png';
import meta from '../assets/terrain.json';
import { waterNormals } from './textures';

/**
 * Real ground: USGS aerial imagery of Boca Chica (public domain, see scripts/terrain.py).
 * A 4.4 km detailed patch sits inside a 35 km patch, which sits inside a fog-hidden apron that
 * stretches the far image's edges. Patches are rings around each other, so nothing overlaps and
 * nothing can z-fight. The Gulf is glossy (roughness map from a sea mask) and ripples.
 */
const [CX, CZ] = meta.near.centre;
const NEAR = meta.near.size, FAR = meta.far.size, APRON = 400_000;
const WAVE = 45; // m per ripple-texture repeat

/** Square ring in ground coordinates (x east, y north), with UVs mapping `uvSize` metres centred on the site. */
function ring(outer: number, inner: number, uvSize: number) {
  const sq = (h: number, P: typeof Shape | typeof Path) => {
    const p = new P();
    p.moveTo(CX - h, -CZ - h); p.lineTo(CX + h, -CZ - h); p.lineTo(CX + h, -CZ + h); p.lineTo(CX - h, -CZ + h); p.closePath();
    return p;
  };
  const shape = sq(outer / 2, Shape) as Shape;
  if (inner > 0) shape.holes.push(sq(inner / 2, Path) as Path);
  const g = new ShapeGeometry(shape);
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - CX) / uvSize + 0.5;
    uv[i * 2 + 1] = (pos.getY(i) + CZ) / uvSize + 0.5;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

function Patch({ outer, inner, uvSize, map, rough, waves }: { outer: number; inner: number; uvSize: number; map: Texture; rough: Texture; waves: Texture }) {
  const geo = useMemo(() => ring(outer, inner, uvSize), [outer, inner, uvSize]);
  const ripples = useMemo(() => {
    const t = waves.clone();
    t.repeat.setScalar(uvSize / WAVE);
    return t;
  }, [waves, uvSize]);
  useFrame(({ clock }) => ripples.offset.set(clock.elapsedTime * 0.0006 * (uvSize / WAVE), clock.elapsedTime * 0.0003 * (uvSize / WAVE)));
  return (
    // no shadows on the terrain: with the sun 17° up, the shadow volume's long footprint shows as a dark,
    // acne-striped band across the ground; the Ship's shadow falls on the pad and tower instead
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial map={map} roughnessMap={rough} roughness={1} metalness={0} normalMap={ripples} normalScale={NORMAL} envMapIntensity={0.9} />
    </mesh>
  );
}
const NORMAL = new Vector2(0.18, 0.18);

export function Terrain() {
  const [near, far, nearRough, farRough] = useTexture([nearUrl, farUrl, nearRoughUrl, farRoughUrl]);
  useMemo(() => {
    for (const t of [near, far]) t.colorSpace = SRGBColorSpace;
    for (const t of [near, far, nearRough, farRough]) { t.wrapS = t.wrapT = ClampToEdgeWrapping; t.anisotropy = 8; }
  }, [near, far, nearRough, farRough]);
  const waves = useMemo(waterNormals, []);
  return (
    <group>
      <Patch outer={NEAR} inner={0} uvSize={NEAR} map={near} rough={nearRough} waves={waves} />
      <Patch outer={FAR} inner={NEAR} uvSize={FAR} map={far} rough={farRough} waves={waves} />
      <Patch outer={APRON} inner={FAR} uvSize={FAR} map={far} rough={farRough} waves={waves} />
    </group>
  );
}
