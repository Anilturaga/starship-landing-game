import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  AdditiveBlending, BackSide, BoxGeometry, CircleGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, RingGeometry,
  LatheGeometry, Mesh, MeshStandardMaterial, PointLight, ShaderMaterial, Shape, Sprite, SpriteMaterial, Vector2,
  type BufferGeometry, type Material,
} from 'three';
import { HALF, PIN_OFFSET, RADIUS as R } from '../sim/constants';
import { airDensity, FLAPS } from '../sim/physics';
import { useGame } from '../state/store';
import { glowTexture, steelRoughness, tileTexture } from './textures';

const D2R = Math.PI / 180;

const plumeVS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying float vF;
void main(){
  vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.);
  vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const plumeFS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float k, t; varying vec2 vUv; varying float vF;
void main(){
  #include <logdepthbuf_fragment>
  float v = 1. - vUv.y; float core = pow(1.-v, 1.5);
  float dia = .7 + .3*sin(v*42. - t*24.);                       // shock diamonds
  vec3 c = mix(vec3(1.,.45,.14), vec3(.8,.86,1.), pow(1.-v, 6.));  // blue-white core, orange tail
  float a = core * pow(vF, 1.3) * k * mix(1., dia, pow(1.-v, 2.));
  gl_FragColor = vec4(c*a*1.7, a);
}`;

interface ShipParts {
  root: Group;
  flaps: Group[];
  engines: { g: Group; mat: ShaderMaterial; plume: Mesh; glow: Sprite }[];
  light: PointLight;
}

function mesh(g: BufferGeometry, m: Material, shadow = true) {
  const o = new Mesh(g, m);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

function bell(exitRadius: number, len: number) {
  const p: Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    p.push(new Vector2(exitRadius * (0.3 + 0.7 * t ** 0.7), -t * len));
  }
  return new LatheGeometry(p, 28);
}

function flapGeometry(len: number, w: number) {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(w, len * 0.1); s.lineTo(w, len * 0.72); s.lineTo(0, len); s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
  g.translate(0, 0, -0.15);
  return g;
}

/** Procedural V3 Ship: steel leeward side, black tiled belly, four flaps, 3 sea-level + 3 vacuum Raptors. */
function buildShip(): ShipParts {
  const root = new Group();
  const steel = new MeshStandardMaterial({ color: 0xc9c9c6, metalness: 0.6, roughness: 0.55, roughnessMap: steelRoughness(), envMapIntensity: 0.3 });
  const tiles = new MeshStandardMaterial({ map: tileTexture(), metalness: 0.05, roughness: 0.82 });
  const dark = new MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.15, roughness: 0.8, side: DoubleSide });
  const pinMat = new MeshStandardMaterial({ color: 0x8d9298, metalness: 0.75, roughness: 0.4 });
  const bellMat = new MeshStandardMaterial({ color: 0x6b625a, metalness: 0.9, roughness: 0.38, side: DoubleSide });

  // barrel and nose, split so the tiles face body +Z (the belly)
  const barrel = 39;
  const nose: Vector2[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    nose.push(new Vector2(Math.max(0.001, R * Math.cos((t * Math.PI) / 2) ** 0.62), t * 13));
  }
  for (const [m, start] of [[tiles, -Math.PI / 2], [steel, Math.PI / 2]] as const) {
    const b = mesh(new CylinderGeometry(R, R, barrel, 64, 1, true, start, Math.PI), m);
    b.position.y = -HALF + barrel / 2;
    root.add(b);
    const n = mesh(new LatheGeometry(nose, 32, start, Math.PI), m);
    n.position.y = 13;
    root.add(n);
  }
  // Engine bay, kept well inside the skin: parts within a few cm of the hull, seen edge-on,
  // poke through it as flickering dark dots (depth interpolation error on grazing triangles).
  const BAY = R - 0.5;
  const bayMat = new MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.6, roughness: 0.6, side: BackSide });
  const liner = mesh(new CylinderGeometry(BAY, BAY, 5.2, 48, 1, true), bayMat, false);
  liner.position.y = -HALF + 2.6;
  const facing = new MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.15, roughness: 0.8 });
  const dome = mesh(new CircleGeometry(BAY, 48), facing, false); // faces down, into the bay
  dome.rotation.x = Math.PI / 2;
  dome.position.y = -HALF + 5.2;
  const rim = mesh(new RingGeometry(BAY, R, 64), facing, false); // closes the skirt between skin and bay
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -HALF;
  root.add(liner, dome, rim);
  for (const s of [-1, 1]) {
    const p = mesh(new BoxGeometry(1.4, 0.9, 1.3), pinMat);
    p.position.set(s * (R + 0.4), PIN_OFFSET, 0);
    root.add(p);
  }

  // flaps: pivot (taper) -> hinge (deflection) -> mesh, in FLAPS order
  const fwdGeo = flapGeometry(7.6, 3.3), aftGeo = flapGeometry(12.5, 4.6);
  const flaps = FLAPS.map(({ side, fwd }) => {
    const pivot = new Group();
    if (fwd) { pivot.position.set(side * 3.95, 14.2, -1.3); pivot.rotation.z = -side * 0.16; }
    else pivot.position.set(side * R, -25.6, -0.6);
    const hinge = new Group();
    const m = mesh(fwd ? fwdGeo : aftGeo, dark);
    m.scale.x = side;
    hinge.add(m);
    pivot.add(hinge);
    root.add(pivot);
    return hinge;
  });

  // engines
  const glow = glowTexture();
  const engines = [0, 1, 2].map((i) => {
    const a = (60 + i * 120) * D2R;
    const g = new Group();
    g.position.set(Math.cos(a) * 1.4, -23.4, Math.sin(a) * 1.4);
    const head = mesh(new CylinderGeometry(0.42, 0.5, 1.1, 12), dark);
    head.position.y = 0.55;
    g.add(head, mesh(bell(0.66, 1.75), bellMat));
    const mat = new ShaderMaterial({ uniforms: { k: { value: 0 }, t: { value: 0 } }, vertexShader: plumeVS, fragmentShader: plumeFS, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    const pg = new CylinderGeometry(0.62, 0.14, 1, 20, 1, true);
    pg.translate(0, -0.5, 0);
    const plume = new Mesh(pg, mat);
    plume.position.y = -1.75;
    plume.frustumCulled = false;
    const sprite = new Sprite(new SpriteMaterial({ map: glow, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    sprite.position.y = -2.4;
    g.add(plume, sprite);
    root.add(g);
    return { g, mat, plume, glow: sprite };
  });
  for (let i = 0; i < 3; i++) {
    const a = i * 120 * D2R;
    const g = new Group();
    g.position.set(Math.cos(a) * 3.15, -23, Math.sin(a) * 3.15);
    const head = mesh(new CylinderGeometry(0.5, 0.55, 1, 12), dark);
    head.position.y = 0.5;
    g.add(head, mesh(bell(1.12, 2.75), bellMat));
    root.add(g);
  }
  const light = new PointLight(0xffa860, 0, 160, 2);
  light.position.y = -30;
  root.add(light);
  return { root, flaps, engines, light };
}

export function Ship() {
  const parts = useMemo(buildShip, []);
  const boom = useMemo(() => new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })), []);
  const boomLight = useMemo(() => new PointLight(0xff8a3c, 0, 600, 2), []);
  const boomState = useMemo(() => ({ t: -1, sim: null as unknown }), []);

  useFrame(({ clock }) => {
    const sim = useGame.getState().sim;
    const s = sim.ship;
    const { root, flaps, engines, light } = parts;
    root.position.copy(s.pos);
    root.quaternion.copy(s.q);
    flaps.forEach((h, i) => { h.rotation.y = FLAPS[i].side * s.flaps[i]; });

    const out = sim.outcome;
    const burning = s.spool > 0 && !out;
    const rho = airDensity(s.pos.y);
    engines.forEach((e, i) => {
      e.g.rotation.set(s.gimbal.x, 0, s.gimbal.z);
      const k = burning && i < s.engines ? s.spool * (0.9 + 0.1 * Math.random()) : 0;
      e.mat.uniforms.k.value = k;
      e.mat.uniforms.t.value = clock.elapsedTime;
      const len = (16 + 20 * s.perEngine) * (1 + (1 - rho / 1.225) * 1.5); // plume expands as air thins
      e.plume.scale.set(1 + 0.25 * s.perEngine, len, 1 + 0.25 * s.perEngine);
      e.plume.visible = k > 0;
      (e.glow.material as SpriteMaterial).opacity = k * 0.9;
      e.glow.scale.setScalar(5 + 4 * s.perEngine);
    });
    light.intensity = burning ? s.spool * s.engines * 9000 : 0;

    // explosion or splash when the flight ends badly
    const lost = out && out.kind !== 'caught' && out.kind !== 'ground';
    if (lost && boomState.sim !== sim) {
      boomState.sim = sim;
      boomState.t = 0;
      boom.position.copy(s.pos);
      (boom.material as SpriteMaterial).color.set(out.kind === 'ocean' ? 0xcfe6ff : 0xffffff);
    }
    if (!out) boomState.sim = null;
    root.visible = !(out && out.kind === 'crash');
    if (boomState.t >= 0) {
      boomState.t += 1 / 60;
      const t = boomState.t;
      boom.scale.setScalar(20 + t * 90);
      (boom.material as SpriteMaterial).opacity = Math.max(0, 1 - t / 1.6);
      boomLight.position.copy(boom.position);
      boomLight.intensity = Math.max(0, 1.3e6 * (1 - t / 1.6));
      if (t > 1.6) boomState.t = -1;
    }
  });

  return (
    <>
      <primitive object={parts.root} />
      <primitive object={boom} />
      <primitive object={boomLight} />
    </>
  );
}
