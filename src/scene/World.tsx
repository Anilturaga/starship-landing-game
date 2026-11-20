import { MeshStandardMaterial } from 'three';
import { Terrain } from './Terrain';
import { CatchTower } from './Tower';

const concrete = new MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.95 });
const tankMat = new MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.32 });

function Site() {
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => {
        const h = 20 + (i % 3) * 5;
        return (
          <mesh key={i} material={tankMat} position={[-150 + (i % 4) * 11, h / 2, -95 + Math.floor(i / 4) * 12]} castShadow receiveShadow>
            <cylinderGeometry args={[4, 4, h, 24]} />
          </mesh>
        );
      })}
      {[0, 1, 2].map((i) => (
        <mesh key={i} material={tankMat} position={[-140, 3, -60 + i * 7]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[2.6, 2.6, 24, 20]} />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete apron around the pad: a slab, not a plane, so it never sits coplanar with the ground. */
function Apron() {
  return (
    <mesh position={[0, 0.2, 0]} material={concrete} receiveShadow>
      <boxGeometry args={[130, 0.4, 110]} />
    </mesh>
  );
}

export function World() {
  return (
    <>
      <Terrain />
      <Apron />
      <CatchTower />
      <Site />
    </>
  );
}
