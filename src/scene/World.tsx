import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, InstancedMesh, MeshStandardMaterial, Object3D, Vector2 } from 'three';
import { ARM_REACH, ARM_Y, CATCH, SHORE_X, TOWER } from '../sim/constants';
import { groundTexture, waterNormals } from './textures';

const towerMat = new MeshStandardMaterial({ color: 0x50545a, metalness: 0.65, roughness: 0.55 });
const armMat = new MeshStandardMaterial({ color: 0x8d9298, metalness: 0.75, roughness: 0.4 });
const concrete = new MeshStandardMaterial({ color: 0x9a9790, roughness: 0.92 });
const tankMat = new MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.85, roughness: 0.32 });
const buildingMat = new MeshStandardMaterial({ color: 0xb9bcbe, roughness: 0.7, metalness: 0.2 });
const railMat = new MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.8, roughness: 0.3 });

/** Square lattice tower: four columns plus horizontal and diagonal braces on every 9 m panel. */
function Lattice({ x, z, width, height, diagonals = true }: { x: number; z: number; width: number; height: number; diagonals?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const levels = Math.floor(height / 9);
  const count = levels * (diagonals ? 8 : 4);
  useLayoutEffect(() => {
    const d = new Object3D(), diag = Math.hypot(width, 9), ang = Math.atan2(9, width);
    let k = 0;
    const put = () => { d.updateMatrix(); ref.current!.setMatrixAt(k++, d.matrix); };
    for (let i = 0; i < levels; i++) {
      const y = i * 9 + 9, flip = i % 2 ? ang : -ang;
      for (const s of [-1, 1]) {
        d.position.set(x + (s * width) / 2, y, z); d.rotation.set(0, 0, 0); d.scale.set(0.45, 0.45, width); put();
        d.position.set(x, y, z + (s * width) / 2); d.rotation.set(0, 0, 0); d.scale.set(width, 0.45, 0.45); put();
        if (diagonals) {
          d.position.set(x + (s * width) / 2, y - 4.5, z); d.rotation.set(s * flip, 0, 0); d.scale.set(0.38, 0.38, diag); put();
          d.position.set(x, y - 4.5, z + (s * width) / 2); d.rotation.set(0, 0, s * flip); d.scale.set(diag, 0.38, 0.38); put();
        }
      }
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [x, z, width, levels, diagonals]);
  const box = useMemo(() => new BoxGeometry(1, 1, 1), []);
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} material={towerMat} position={[x + (sx * width) / 2, height / 2, z + (sz * width) / 2]} castShadow receiveShadow>
          <boxGeometry args={[1.3, height, 1.3]} />
        </mesh>
      )))}
      <instancedMesh ref={ref} args={[box, towerMat, count]} castShadow receiveShadow />
    </group>
  );
}

function CatchTower() {
  const armLen = ARM_REACH.x1 - ARM_REACH.x0;
  const armMid = (ARM_REACH.x0 + ARM_REACH.x1) / 2;
  return (
    <group>
      <Lattice x={TOWER.x} z={0} width={TOWER.width} height={TOWER.height} />
      <mesh material={towerMat} position={[TOWER.x, TOWER.height + 1.5, 0]} castShadow>
        <boxGeometry args={[TOWER.width + 3, 3, TOWER.width + 3]} />
      </mesh>
      <mesh material={towerMat} position={[TOWER.x, TOWER.height + 14, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.6, 22, 8]} />
      </mesh>
      {/* carriage and chopsticks */}
      <mesh material={armMat} position={[TOWER.x, ARM_Y - 3, 0]} castShadow receiveShadow>
        <boxGeometry args={[TOWER.width + 4, 10, TOWER.width + 4]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh material={armMat} position={[armMid, ARM_Y - 1.6, s * ARM_REACH.halfGap]} castShadow receiveShadow>
            <boxGeometry args={[armLen, 3.2, 1.6]} />
          </mesh>
          <mesh material={towerMat} position={[armMid - 2, ARM_Y - 4.5, s * ARM_REACH.halfGap]} rotation={[0, 0, 0.12]} castShadow>
            <boxGeometry args={[armLen - 4, 1, 1]} />
          </mesh>
          <mesh material={railMat} position={[CATCH.x, ARM_Y + 0.05, s * ARM_REACH.halfGap]} castShadow>
            <boxGeometry args={[5, 0.5, 2.2]} />
          </mesh>
        </group>
      ))}
      {/* launch mount */}
      <group position={[CATCH.x, 0, CATCH.z]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return (
            <mesh key={i} material={concrete} position={[Math.cos(a) * 9, 12, Math.sin(a) * 9]} castShadow receiveShadow>
              <cylinderGeometry args={[1.2, 1.5, 24, 10]} />
            </mesh>
          );
        })}
        <mesh material={armMat} position={[0, 25, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <torusGeometry args={[9, 1.9, 12, 48]} />
        </mesh>
      </group>
    </group>
  );
}

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
      {([[-700, -500, 70, 95, 48], [-820, -380, 55, 70, 40], [-260, 140, 30, 12, 20], [220, -180, 40, 10, 24]] as const).map(([x, z, w, h, d], i) => (
        <mesh key={i} material={buildingMat} position={[x, h / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      ))}
      <Lattice x={-380} z={520} width={TOWER.width} height={TOWER.height} diagonals={false} />
    </group>
  );
}

function Terrain() {
  const ground = useMemo(groundTexture, []);
  const water = useMemo(waterNormals, []);
  const normalScale = useMemo(() => new Vector2(0.35, 0.35), []);
  useFrame(({ clock }) => {
    water.offset.set(clock.elapsedTime * 0.004, clock.elapsedTime * 0.002);
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40000, 40000]} />
        <meshStandardMaterial map={ground} roughness={1} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SHORE_X - 120, 0.15, 0]} receiveShadow>
        <planeGeometry args={[240, 40000]} />
        <meshStandardMaterial color={0xcdb98e} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[SHORE_X + 15000, 0.3, 0]}>
        <planeGeometry args={[30000, 40000]} />
        <meshStandardMaterial color={0x0f2c38} roughness={0.08} metalness={0.1} normalMap={water} normalScale={normalScale} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]} material={concrete} receiveShadow>
        <planeGeometry args={[320, 260]} />
      </mesh>
    </group>
  );
}

export function World() {
  return (
    <>
      <Terrain />
      <CatchTower />
      <Site />
    </>
  );
}
