import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, DirectionalLight } from 'three';
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

/** Sun with a shadow box that follows the Ship. */
function Sun() {
  const ref = useRef<DirectionalLight>(null);
  useFrame(() => {
    const s = useGame.getState().sim.ship;
    const l = ref.current!;
    l.position.copy(s.pos).addScaledVector(SUN_DIR, 600);
    l.target.position.copy(s.pos);
    l.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={ref} color={0xfff0d8} intensity={2.6 / EXPOSURE} castShadow
      shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
      shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={70} shadow-camera-bottom={-70}
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
      <World />
      <Ship />
      <CameraRig />
    </Canvas>
  );
}
