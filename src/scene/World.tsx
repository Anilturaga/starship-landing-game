import { CapsuleGeometry, MeshStandardMaterial } from 'three';
import { Terrain } from './Terrain';
import { CatchTower } from './Tower';

const concrete = new MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.95 });
const tankMat = new MeshStandardMaterial({ color: 0xe4e6e8, metalness: 0.6, roughness: 0.35 });

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

/** Concrete pad around the tower and mount: a slab, not a plane, so it never sits coplanar with the ground. */
function Apron() {
  return (
    <mesh position={[60, 0.25, -6]} material={concrete} receiveShadow>
      <boxGeometry args={[210, 0.5, 100]} />
    </mesh>
  );
}

export function World() {
  return (
    <>
      <Terrain />
      <Apron />
      <CatchTower />
      <TankFarm />
    </>
  );
}
