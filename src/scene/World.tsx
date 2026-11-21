import { useMemo } from 'react';
import { CapsuleGeometry, ClampToEdgeWrapping, MeshStandardMaterial } from 'three';
import { CATCH } from '../sim/constants';
import { concreteTexture } from './textures';
import { Terrain } from './Terrain';
import { CatchTower } from './Tower';

const tankMat = new MeshStandardMaterial({ color: 0xdfe1e2, metalness: 0.25, roughness: 0.55 });

/** The Pad A tank farm, placed from the NAIP imagery: long horizontal tanks and two rows of big capsule tanks. */
function TankFarm() {
  const long = [[-26, 2.6], [-20, 2.6], [-14, 2.6], [-8, 2.6], [3, 3.6], [12, 3.6]] as const;
  const capsule = new CapsuleGeometry(6, 66, 8, 32);
  return (
    <group>
      {long.map(([x, r]) => (
        <mesh key={x} material={tankMat} position={[x, r + 0.6, -101]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <capsuleGeometry args={[r, 50 - 2 * r, 6, 24]} />
        </mesh>
      ))}
      {[-113, -99].map((z) => (
        <mesh key={z} geometry={capsule} material={tankMat} position={[85, 6.6, z]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/**
 * Concrete footing under the tower and the mount only; the pad around it is the 0.3 m survey imagery (the rest of
 * the real site is sand there). A thin slab, so it never sits coplanar with the ground.
 */
const FOOT = { x0: -17, x1: 29, z0: -15, z1: 15 };
function Footing() {
  const mat = useMemo(() => {
    const w = FOOT.x1 - FOOT.x0, h = FOOT.z1 - FOOT.z0;
    const map = concreteTexture(w, h, CATCH.x - FOOT.x0, CATCH.z - FOOT.z0);
    map.wrapS = map.wrapT = ClampToEdgeWrapping;
    return new MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  }, []);
  return (
    <mesh position={[(FOOT.x0 + FOOT.x1) / 2, 0.2, (FOOT.z0 + FOOT.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow>
      <planeGeometry args={[FOOT.x1 - FOOT.x0, FOOT.z1 - FOOT.z0]} />
    </mesh>
  );
}

export function World() {
  return (
    <>
      <Terrain />
      <Footing />
      <CatchTower />
      <TankFarm />
    </>
  );
}
