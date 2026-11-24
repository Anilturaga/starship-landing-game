import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  BufferAttribute, ClampToEdgeWrapping, DataTexture, FloatType, RedFormat, Color, MeshStandardMaterial, Path, PlaneGeometry, Shape, ShapeGeometry, SRGBColorSpace,
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
 * The Gulf beach (game x) at a game z, traced from the imagery (scripts/terrain.py), held at its ends beyond.
 * Across the border, where there is no imagery, it continues the trend of the coast at the river mouth.
 */
export function coastX(z: number) {
  const c = meta.coast, f = Math.min(c.x.length - 1, Math.max(0, (z - c.z0) / c.dz));
  const i = Math.min(c.x.length - 2, Math.floor(f));
  return c.x[i] + (c.x[i + 1] - c.x[i]) * (f - i);
}
const COAST = new DataTexture(new Float32Array(meta.coast.x), meta.coast.x.length, 1, RedFormat, FloatType);
COAST.needsUpdate = true;

/**
 * Real ground from USGS data (public domain, see scripts/terrain.py):
 * - centre 2 km: lidar heights (dunes), 1 m imagery with 0.3 m imagery over the pad, plus fine detail
 *   near the camera so it still reads as ground from a few metres up;
 * - rings out to 6 km, 35 km and a fog-hidden apron, flat. Rings never overlap, so nothing z-fights.
 * The Gulf is one water surface over all of it (see Ocean).
 */
const [CX, CZ] = meta.centre;
const DETAIL = 7; // m per detail-texture repeat
/** NAIP's pale flats read lilac under the dusk sky; a touch of warmth corrects it. */
const WARM = new Color(1.0, 0.9, 0.78);

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

/** Imagery material for the centre: the pad imagery over the mid imagery, and detail that fades with distance. */
function centreMaterial(mid: Texture, pad: Texture, rough: Texture, detail: Texture) {
  const m = new MeshStandardMaterial({ color: WARM, map: mid, roughnessMap: rough, roughness: 1, metalness: 0, envMapIntensity: 0.35 });
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
        float near = 1.0 - smoothstep(40.0, 400.0, length(vViewPosition));
        float d = texture2D(uDetail, vMapUv * uDetailRepeat).r * 0.65 + texture2D(uDetail, vMapUv * uDetailRepeat * 0.13).r * 0.35;
        sampledDiffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * d, near * 0.5); // grain finer than the imagery, near the camera
        diffuseColor *= sampledDiffuseColor;`);
  };
  return m;
}

function Ring({ outer, inner, uvSize, map, rough }: { outer: number; inner: number; uvSize: number; map: Texture; rough: Texture }) {
  const geo = useMemo(() => ring(outer, inner, uvSize), [outer, inner, uvSize]);
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color={WARM} map={map} roughnessMap={rough} roughness={1} metalness={0} envMapIntensity={0.35} />
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
      (x > coastX(z) ? sea : land).toArray(col, i * 3);
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

/**
 * The Gulf: one water surface over all the imagery rings, so the sea has one colour and one sheen everywhere
 * (each ring's photographed water differed, which showed as patches). It shows where the rings' sea masks say
 * there is water, fades out over the surf near the beach so the imagery's breakers show through, and reflects
 * the sky and the low sun.
 */
function Ocean({ mask, waves }: { mask: Texture; waves: Texture }) {
  const SIZE = 160_000; // the camera sees 80 km
  const ripples = useMemo(() => {
    const r = waves.clone();
    r.repeat.setScalar(SIZE / 60);
    return r;
  }, [waves]);
  useFrame(({ clock }) => ripples.offset.set(clock.elapsedTime * 0.012, clock.elapsedTime * 0.007));
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({
      color: new Color(0.012, 0.04, 0.05), roughness: 0.2, metalness: 0, normalMap: ripples, normalScale: new Vector2(0.1, 0.1),
      transparent: true, envMapIntensity: 0.65,
    });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        uMid: { value: mask }, uCoast: { value: COAST }, uCoastZ: { value: new Vector2(meta.coast.z0, meta.coast.dz) },
        uSite: { value: new Vector2(CX, CZ) }, uMidSize: { value: meta.mid },
        uShore: { value: new Vector2(meta.shore.x, meta.shore.slope) },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWorld; uniform sampler2D uMid, uCoast; uniform vec2 uSite, uShore, uCoastZ; uniform float uMidSize;
          float seaIn(sampler2D t, vec2 d, float size) {
            return clamp((1.0 - texture2D(t, vec2(d.x, -d.y) / size + 0.5).g) / 0.62, 0.0, 1.0);
          }
          float coastX(float z) {
            int n = textureSize(uCoast, 0).x;
            float f = clamp((z - uCoastZ.x) / uCoastZ.y, 0.0, float(n - 1));
            int i = min(int(f), n - 2);
            return mix(texelFetch(uCoast, ivec2(i, 0), 0).r, texelFetch(uCoast, ivec2(i + 1, 0), 0).r, f - float(i));
          }`)
        // two layers of ripples at different scales and angles, so the pattern never visibly repeats
        .replace('#include <normal_fragment_maps>', /* glsl */ `
          vec2 ruv = vNormalMapUv;
          vec3 n1 = texture2D(normalMap, ruv).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, mat2(0.8, -0.6, 0.6, 0.8) * ruv * 0.29 + vec2(0.37, 0.11)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(normalMap, mat2(-0.5, 0.87, -0.87, -0.5) * ruv * 2.3).xyz * 2.0 - 1.0;
          vec2 slope = (n1.xy * 0.45 + n2.xy + n3.xy * 0.5) * normalScale;
          normal = normalize(mat3(viewMatrix) * vec3(slope.x, 1.0, -slope.y)); // the plane lies flat: local z is world up`)
        // the ground imagery lies 0.3 m below: far away that is too little depth to keep it from showing through
        .replace('#include <logdepthbuf_fragment>', '#include <logdepthbuf_fragment>\n#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\n gl_FragDepth -= 4e-5;\n#endif')
        // light scattered back up out of the murky Gulf water: from overhead there is little sky to reflect,
        // and without it the sea reads as a black void
        .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          totalEmissiveRadiance += vec3(0.05, 0.062, 0.06) * abs(dot(normalize(vViewPosition), upV));`)
        .replace('#include <alphamap_fragment>', /* glsl */ `
          vec2 d = vWorld.xz - uSite;
          float a = max(abs(d.x), abs(d.y));
          // the Gulf: east of the traced beach; in the centre, the lidar shoreline and the water the imagery shows
          float sea = smoothstep(0.0, 18.0, vWorld.x - coastX(vWorld.z));
          if (a < uMidSize * 0.5) {
            float past = vWorld.x - (uShore.x + uShore.y * vWorld.z);
            sea = mix(sea, seaIn(uMid, d, uMidSize) * smoothstep(0.0, 18.0, past), smoothstep(uMidSize * 0.5, uMidSize * 0.5 - 150.0, a));
          }
          if (sea < 0.02) discard;
          diffuseColor.a = smoothstep(0.2, 0.95, sea);`);
    };
    return m;
  }, [mask, ripples]);
  return (
    <mesh material={mat} position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[SIZE, SIZE, 64, 64]} />
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
  const grid = useMemo(() => heightGrid(height.image as HTMLImageElement), [height]);
  const material = useMemo(() => centreMaterial(mid, pad, midRough, detail), [mid, pad, midRough, detail]);
  return (
    <group>
      {/* the centre receives shadows: the Ship's and the tower's fall on it near the pad */}
      <mesh geometry={grid} material={material} position={[CX, 0, CZ]} rotation={[-Math.PI / 2, 0, 0]} />
      <Ring outer={meta.near} inner={meta.mid} uvSize={meta.near} map={near} rough={nearRough} />
      <Ring outer={meta.far} inner={meta.near} uvSize={meta.far} map={far} rough={farRough} />
      <Apron />
      <Ocean mask={midRough} waves={waves} />
    </group>
  );
}
