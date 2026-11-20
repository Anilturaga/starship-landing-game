import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useMemo, useRef } from 'react';
import { Color, DirectionalLight, Quaternion, Vector3 } from 'three';
import { applyInput } from '../state/input';
import { useGame } from '../state/store';
import { CameraRig } from './CameraRig';
import { Ship } from './Ship';
import { HORIZON, Sky, SUN_DIR } from './Sky';
import { World } from './World';

/** The physical sky is bright, so the camera exposes down and the lights compensate. */
const EXPOSURE = 0.45;

/** Advances the simulation every frame and ends the flight a moment after an outcome. */
function SimDriver() {
  const endTimer = useRef(0);
  useFrame((_, dt) => {
    const { sim, screen, finish } = useGame.getState();
    applyInput(sim, dt);
    sim.update(dt);
    if (sim.outcome && screen === 'flying') {
      endTimer.current += dt;
      const wait = sim.outcome.kind === 'crash' ? 1.5 : 1.0;
      if (endTimer.current > wait) { endTimer.current = 0; finish(sim.outcome); }
    } else endTimer.current = 0;
  });
  return null;
}

const SHADOW_HALF = 70, SHADOW_RES = 2048, TEXEL = (2 * SHADOW_HALF) / SHADOW_RES;
const fromLight = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), SUN_DIR);
const toLight = fromLight.clone().invert();
const snapped = new Vector3();

/** Sun with a shadow box that follows the Ship. */
function Sun() {
  const ref = useRef<DirectionalLight>(null);
  useFrame(() => {
    const s = useGame.getState().sim.ship;
    const l = ref.current!;
    // follow the Ship in whole shadow-map texels, so shadow edges do not shimmer as it moves
    snapped.copy(s.pos).applyQuaternion(toLight);
    snapped.x = Math.round(snapped.x / TEXEL) * TEXEL;
    snapped.y = Math.round(snapped.y / TEXEL) * TEXEL;
    snapped.applyQuaternion(fromLight);
    l.position.copy(snapped).addScaledVector(SUN_DIR, 600);
    l.target.position.copy(snapped);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={ref} color={0xfff0d8} intensity={2.6 / EXPOSURE} castShadow
      shadow-mapSize={[SHADOW_RES, SHADOW_RES]} shadow-bias={-0.0003} shadow-normalBias={0.04}
      shadow-camera-left={-SHADOW_HALF} shadow-camera-right={SHADOW_HALF} shadow-camera-top={SHADOW_HALF} shadow-camera-bottom={-SHADOW_HALF}
      shadow-camera-near={1} shadow-camera-far={1400}
    />
  );
}

export function GameScene() {
  const fog = useMemo(() => new Color(...HORIZON), []);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance', toneMappingExposure: EXPOSURE }}
      camera={{ fov: 50, near: 0.05, far: 80000, position: [600, 2600, -100] }}
    >
      <SimDriver />
      <fogExp2 attach="fog" args={[fog, 0.000085]} />
      <Sky />
      <Sun />
      <hemisphereLight args={[0xbcd4f0, 0x4d4636, 0.35 / EXPOSURE]} />
      <Suspense fallback={null}>
        <World />
      </Suspense>
      <Ship />
      <CameraRig />
    </Canvas>
  );
}
