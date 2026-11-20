import { Environment, Sky as DreiSky } from '@react-three/drei';
import { Vector3 } from 'three';

/** Low late-afternoon sun over the Gulf. */
export const SUN_DIR = new Vector3().setFromSphericalCoords(1, ((90 - 17) * Math.PI) / 180, (225 * Math.PI) / 180);
/** Horizon haze colour (linear), shared with the fog. */
export const HORIZON: [number, number, number] = [0.58, 0.61, 0.64];

const sky = <DreiSky distance={60000} sunPosition={SUN_DIR} turbidity={8} rayleigh={2.5} mieCoefficient={0.004} mieDirectionalG={0.86} />;

/** Physically based (Preetham) sky, also baked into reflections. */
export function Sky() {
  return (
    <>
      {sky}
      <Environment frames={1} resolution={256}>{sky}</Environment>
    </>
  );
}
