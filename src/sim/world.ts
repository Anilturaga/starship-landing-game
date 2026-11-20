import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { ARM_REACH, ARM_Y, CATCH, G0, HALF, MOUNT, PIN_OFFSET, RADIUS, STEP, TOWER } from './constants';

let ready: Promise<void> | null = null;
/** Rapier ships as WebAssembly; call once before creating a Simulation. */
export const initPhysics = () => (ready ??= RAPIER.init());

/** What the Ship can touch. The surface is split into land and Gulf by the caller. */
export type Hit = 'tower' | 'arms' | 'mount' | 'surface';

// collision groups: (membership << 16) | filter
const HULL = 1, PINS = 2, STRUCT = 4, ZONE = 8;
const group = (member: number, filter: number) => (member << 16) | filter;
const C = () => RAPIER.ColliderDesc;

const ZERO = { x: 0, y: 0, z: 0 }, IDENT = { x: 0, y: 0, z: 0, w: 1 };
const qInv = new Quaternion(), wv = new Vector3();

/**
 * Rapier world for one flight: integrates the Ship as a rigid body and reports what it touches.
 * The Ship's colliders are sensors, so contacts end the flight instead of bouncing it.
 */
export class SiteWorld {
  private world = new RAPIER.World({ x: 0, y: -G0, z: 0 });
  private body: RAPIER.RigidBody;
  private hull: RAPIER.Collider;
  private pins: RAPIER.Collider;
  private kinds = new Map<number, Hit>();
  readonly hits = new Set<Hit>();

  constructor() {
    const w = this.world;
    w.timestep = STEP;
    const fixed = (d: RAPIER.ColliderDesc, kind: Hit, g: number) => this.kinds.set(w.createCollider(d.setCollisionGroups(g)).handle, kind);
    const solid = group(STRUCT, HULL);
    fixed(C().cuboid(TOWER.width / 2, TOWER.height / 2, TOWER.width / 2).setTranslation(TOWER.x, TOWER.height / 2, 0), 'tower', solid);
    fixed(C().cylinder(MOUNT.top / 2, MOUNT.radius).setTranslation(CATCH.x, MOUNT.top / 2, CATCH.z), 'mount', solid);
    fixed(C().cuboid(40000, 50, 40000).setTranslation(0, -50, 0), 'surface', solid);
    // the catch zone: a slab on top of the arms that only the pins can touch
    const armHalf = (ARM_REACH.x1 - ARM_REACH.x0) / 2 + RADIUS;
    fixed(C().cuboid(armHalf, 1.5, 8).setTranslation((ARM_REACH.x0 + ARM_REACH.x1) / 2, ARM_Y - 1.5, 0), 'arms', group(ZONE, PINS));

    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false));
    const sensor = (d: RAPIER.ColliderDesc, g: number) => w.createCollider(d.setSensor(true).setDensity(0).setCollisionGroups(g), this.body);
    this.hull = sensor(C().cylinder(HALF, RADIUS), group(HULL, STRUCT));
    this.pins = sensor(C().cuboid(RADIUS + 1.1, 0.45, 0.65).setTranslation(0, PIN_OFFSET, 0), group(PINS, ZONE));
  }

  /**
   * One step. `force` and `torque` are world-frame and exclude gravity, which Rapier applies to `mass`.
   * The ShipState stays the source of truth: it is written into the body, stepped, and read back.
   */
  step(
    s: { pos: Vector3; vel: Vector3; q: Quaternion; w: Vector3 },
    force: Vector3, torque: Vector3, mass: number, inertia: Vector3,
  ) {
    const b = this.body;
    b.setAdditionalMassProperties(mass, ZERO, inertia, IDENT, true);
    b.setTranslation(s.pos, true);
    b.setRotation(s.q, true);
    b.setLinvel(s.vel, true);
    b.setAngvel(wv.copy(s.w).applyQuaternion(s.q), true);
    b.resetForces(true);
    b.resetTorques(true);
    b.addForce(force, true);
    b.addTorque(torque, true);
    this.world.step();

    s.pos.copy(b.translation());
    s.q.copy(b.rotation()).normalize();
    s.vel.copy(b.linvel());
    s.w.copy(b.angvel()).applyQuaternion(qInv.copy(s.q).invert());

    this.hits.clear();
    const add = (c: RAPIER.Collider) => { const k = this.kinds.get(c.handle); if (k) this.hits.add(k); };
    this.world.intersectionPairsWith(this.hull, add);
    this.world.intersectionPairsWith(this.pins, add);
    return this.hits;
  }

  free() {
    this.world.free();
  }
}
