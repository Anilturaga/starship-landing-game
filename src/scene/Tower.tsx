import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, InstancedMesh, LatheGeometry, MeshStandardMaterial, Object3D, Vector2, Vector3, type Material } from 'three';
import { ARM_REACH, ARM_Y, CATCH, MOUNT, TOWER } from '../sim/constants';

/**
 * Starbase Pad A launch and catch tower, modelled from photos (Wikimedia Commons):
 * a galvanised-steel square tower in ~9 m modules (heavy corner columns, an X brace and a mid column
 * on every face, a dense stair/elevator core), on a concrete base, with a platform and lightning mast
 * on top. The black "chopsticks" are deep trusses on a carriage that rides the tower face; the
 * Ship quick-disconnect arm sits higher up, swung back along the tower.
 */
const steel = new MeshStandardMaterial({ color: 0x8b9298, metalness: 0.75, roughness: 0.55 });
const black = new MeshStandardMaterial({ color: 0x26282b, metalness: 0.5, roughness: 0.55 });
const core = new MeshStandardMaterial({ color: 0x4a4e53, metalness: 0.4, roughness: 0.7 });
const rail = new MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.8, roughness: 0.3 });
const concrete = new MeshStandardMaterial({ color: 0xa29f98, roughness: 0.92 });

/** [ax, ay, az, bx, by, bz, thickness] */
type Beam = [number, number, number, number, number, number, number];

/** All beams of one material as a single instanced mesh. */
function Beams({ beams, material }: { beams: Beam[]; material: Material }) {
  const ref = useRef<InstancedMesh>(null);
  const box = useMemo(() => new BoxGeometry(1, 1, 1), []);
  useLayoutEffect(() => {
    const o = new Object3D(), a = new Vector3(), b = new Vector3();
    beams.forEach(([ax, ay, az, bx, by, bz, t], i) => {
      a.set(ax, ay, az); b.set(bx, by, bz);
      o.position.copy(a).add(b).multiplyScalar(0.5);
      o.lookAt(b);
      o.scale.set(t, t, a.distanceTo(b) + t * 0.5);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
  }, [beams]);
  return <instancedMesh ref={ref} args={[box, material, beams.length]} castShadow receiveShadow />;
}

const BASE = 10; // concrete base height
const MOD = (TOWER.height - BASE) / 15;

function towerBeams(): Beam[] {
  const { x: cx, width: w, height: H } = TOWER;
  const h = w / 2;
  const out: Beam[] = [];
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [x, z] of corners) out.push([cx + x, BASE, z, cx + x, H, z, 1.5]);
  for (let k = 0; k <= 15; k++) {
    const y = BASE + k * MOD, ym = y + MOD / 2, y1 = y + MOD;
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      out.push([cx + ax, y, az, cx + bx, y, bz, 0.75]); // girder
      if (k === 15) continue;
      out.push([cx + ax, ym, az, cx + bx, ym, bz, 0.35]); // secondary
      out.push([cx + mx, y, mz, cx + mx, y1, mz, 0.5]); // mid column
      out.push([cx + ax, y, az, cx + mx, ym, mz, 0.45], [cx + mx, ym, mz, cx + bx, y1, bz, 0.45]); // X brace halves
      out.push([cx + bx, y, bz, cx + mx, ym, mz, 0.45], [cx + mx, ym, mz, cx + ax, y1, az, 0.45]);
    }
  }
  // top platform railing and the lightning mast
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
    out.push([cx + ax * 1.15, H + 2.2, az * 1.15, cx + bx * 1.15, H + 2.2, bz * 1.15, 0.15]);
  }
  out.push([cx + 2, H + 1, 2, cx + 2, H + 22, 2, 0.35]);
  return out;
}

/** One chopstick: a deep box truss, flat on top, its bottom chord rising toward the tip. */
function armBeams(side: number): Beam[] {
  const { x0, x1, halfGap } = ARM_REACH;
  const out: Beam[] = [];
  const zc = side * (halfGap + 0.9);
  const top = ARM_Y - 0.5;
  const bottomAt = (x: number) => ARM_Y - 6.5 + ((x - x0) / (x1 - x0)) * 4.5;
  for (const dz of [-0.7, 0.7]) {
    const z = zc + dz;
    out.push([x0, top, z, x1, top, z, 0.9], [x0, bottomAt(x0), z, x1 - 2, bottomAt(x1 - 2), z, 0.7]);
    for (let x = x0; x < x1 - 2.5; x += 3.2) {
      const xn = Math.min(x + 3.2, x1 - 2);
      out.push([x, top, z, x, bottomAt(x), z, 0.32], [x, top, z, xn, bottomAt(xn), z, 0.28]);
    }
  }
  for (let x = x0; x < x1; x += 3.2) out.push([x, top, zc - 0.7, x, top, zc + 0.7, 0.3]);
  out.push([x1, top, zc - 0.7, x1 - 2, bottomAt(x1 - 2), zc, 0.6]); // tip
  return out;
}

function carriageBeams(): Beam[] {
  const { x: cx, width: w } = TOWER;
  const h = w / 2 + 1.4, y0 = ARM_Y - 9, y1 = ARM_Y + 1;
  const out: Beam[] = [];
  const c = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [x, z] of c) out.push([cx + x, y0, z, cx + x, y1, z, 0.9]);
  for (const y of [y0, y1 - 0.5, (y0 + y1) / 2]) {
    for (let f = 0; f < 4; f++) out.push([cx + c[f][0], y, c[f][1], cx + c[(f + 1) % 4][0], y, c[(f + 1) % 4][1], 0.8]);
  }
  for (const s of [-1, 1]) out.push([cx + h, y0, s * h, cx + h, y1, s * (h - 4), 0.6]);
  return out;
}

/** Ship quick-disconnect arm, swung back along the tower's side for the catch. */
function qdBeams(): Beam[] {
  const { x: cx, width: w } = TOWER;
  const y = 116, z0 = -w / 2 - 0.5, z1 = z0 - 14, x = cx + 2.5;
  const out: Beam[] = [];
  for (const dy of [0, -3]) for (const dx of [-1, 1]) out.push([x + dx, y + dy, z0, x + dx, y + dy, z1, 0.5]);
  for (let z = z0; z > z1; z -= 2.8) out.push([x - 1, y, z, x + 1, y - 3, z, 0.25], [x - 1, y, z, x - 1, y - 3, z, 0.25], [x + 1, y, z, x + 1, y - 3, z, 0.25]);
  return out;
}

/** Orbital launch mount: a ring table on six legs (profile lathed). */
function mountRing() {
  const r0 = 6.5, r1 = MOUNT.radius - 1, y0 = MOUNT.top - 5, y1 = MOUNT.top;
  return new LatheGeometry([new Vector2(r0, y0), new Vector2(r1, y0), new Vector2(r1, y1), new Vector2(r0, y1), new Vector2(r0, y0)], 48);
}

export function CatchTower() {
  const t = useMemo(towerBeams, []);
  const arms = useMemo(() => [...armBeams(-1), ...armBeams(1), ...carriageBeams(), ...qdBeams()], []);
  const ring = useMemo(mountRing, []);
  const { x: cx, width: w, height: H } = TOWER;
  return (
    <group>
      <Beams beams={t} material={steel} />
      <Beams beams={arms} material={black} />
      <mesh material={core} position={[cx, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w * 0.32, H - 2, w * 0.32]} />
      </mesh>
      <mesh material={concrete} position={[cx, BASE / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 5, BASE, w + 5]} />
      </mesh>
      <mesh material={steel} position={[cx, H + 0.6, 0]} castShadow>
        <boxGeometry args={[w * 1.2, 1.2, w * 1.2]} />
      </mesh>
      <mesh material={core} position={[cx - 2, H + 3, -2]} castShadow>
        <boxGeometry args={[5, 4, 5]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={rail} position={[CATCH.x, ARM_Y + 0.1, s * (ARM_REACH.halfGap + 0.9)]} castShadow>
          <boxGeometry args={[7, 0.4, 2]} />
        </mesh>
      ))}
      <group position={[CATCH.x, 0, CATCH.z]}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          return (
            <mesh key={i} material={concrete} position={[Math.cos(a) * (MOUNT.radius - 2.5), (MOUNT.top - 5) / 2, Math.sin(a) * (MOUNT.radius - 2.5)]} rotation={[0, -a, 0]} castShadow receiveShadow>
              <boxGeometry args={[3.2, MOUNT.top - 5, 2.2]} />
            </mesh>
          );
        })}
        <mesh geometry={ring} material={steel} castShadow receiveShadow />
      </group>
    </group>
  );
}
