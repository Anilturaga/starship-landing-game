import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { ARM_REACH, ARM_Y, ARMS, CATCH, G0, HALF, MOUNT, PIN_HALF, PIN_OFFSET, PIN_REACH, RADIUS, STEP, TOWER } from './constants';

let ready: Promise<void> | null = null;
/** Rapier ships as WebAssembly; call once before creating a Simulation. */
export const initPhysics = () => (ready ??= RAPIER.init());

/**
 * What the Ship touched in a step. The tower: its `mast`, the arm `carriage` and the Ship `qd-arm`
 * (quick-disconnect). `arms`: a pin came down on a chopstick with both arms closed under the pins;
 * `arm-open`: a pin came down on one arm while the other was still open; `hull-arm`: the hull struck a chopstick.
 */
export type Hit = 'mast' | 'carriage' | 'qd-arm' | 'arms' | 'arm-open' | 'hull-arm' | 'mount' | 'surface';
type Fixed = Exclude<Hit, 'arms' | 'arm-open' | 'hull-arm'> | 'arm';
/** What the chopsticks are doing, as decided by the flight machine (flight.ts). */
export type ArmCommand = 'open' | 'closing' | 'holding';

// collision groups: (membership << 16) | filter
const SHIP = 1, STRUCT = 2;
const group = (member: number, filter: number) => (member << 16) | filter;
const C = () => RAPIER.ColliderDesc;

const ZERO = { x: 0, y: 0, z: 0 }, IDENT = { x: 0, y: 0, z: 0, w: 1 };
const qInv = new Quaternion(), wv = new Vector3(), axis = new Vector3();

/** Top of the chopsticks' rails, where the pins rest. */
export const ARM_TOP = ARM_Y + 0.3;

/** One chopstick as a convex hull: its inner face at z = 0, extending outward along `side`. */
function armShape(side: number) {
  const { x0, x1 } = ARM_REACH, d = ARMS.depth * side;
  const bottom = (x: number) => ARM_Y - 6.9 + ((x - x0) / (x1 - x0)) * 4.5;
  const pts: number[] = [];
  for (const z of [0, d]) {
    pts.push(x0, ARM_TOP, z, x1, ARM_TOP, z, x1, ARM_Y - 1.2, z, x1 - 2, bottom(x1 - 2), z, x0, bottom(x0), z);
  }
  return C().convexHull(new Float32Array(pts))!;
}

/** The chopsticks: signed z of each arm's inner face (index 0: -z arm, 1: +z arm) and whether it has closed. */
export interface Arms { face: [number, number]; closed: [boolean, boolean] }

/**
 * Rapier world for one flight: integrates the Ship as a rigid body and reports what it touches.
 * The Ship's colliders are sensors, so contacts end the flight instead of bouncing it.
 * Every visible structure has a collider, so nothing can pass through anything.
 */
export class SiteWorld {
  private world = new RAPIER.World({ x: 0, y: -G0, z: 0 });
  private body: RAPIER.RigidBody;
  private hull: RAPIER.Collider;
  private pins: RAPIER.Collider[];
  private armCol: RAPIER.Collider[] = [];
  private kinds = new Map<number, Fixed>();
  readonly hits = new Set<Hit>();
  readonly arms: Arms = { face: [-ARMS.open, ARMS.open], closed: [false, false] };

  constructor() {
    const w = this.world;
    w.timestep = STEP;
    const fixed = (d: RAPIER.ColliderDesc, kind: Fixed) => {
      const c = w.createCollider(d.setCollisionGroups(group(STRUCT, SHIP)));
      this.kinds.set(c.handle, kind);
      return c;
    };
    const { x: tx, width: tw, height: th } = TOWER;
    fixed(C().cuboid(tw / 2, th / 2 + 1, tw / 2).setTranslation(tx, th / 2 + 1, 0), 'mast');
    fixed(C().cuboid(tw / 2 + 1.8, 5.5, tw / 2 + 1.8).setTranslation(tx, ARM_Y - 4, 0), 'carriage');
    fixed(C().cuboid(1.5, 2, 7).setTranslation(tx + 2.5, 114.5, -tw / 2 - 7.5), 'qd-arm');
    fixed(C().cylinder(MOUNT.top / 2, MOUNT.radius).setTranslation(CATCH.x, MOUNT.top / 2, CATCH.z), 'mount');
    fixed(C().cuboid(40000, 50, 40000).setTranslation(0, -50, 0), 'surface');
    for (const side of [-1, 1]) this.armCol.push(fixed(armShape(side), 'arm'));
    this.placeArms();

    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false));
    const sensor = (d: RAPIER.ColliderDesc) => w.createCollider(d.setSensor(true).setDensity(0).setCollisionGroups(group(SHIP, STRUCT)), this.body);
    this.hull = sensor(C().cylinder(HALF, RADIUS));
    // body x points along world z (toward the arms) when the Ship is upright
    this.pins = [-1, 1].map((side) => sensor(C().cuboid((PIN_REACH - RADIUS) / 2 + 0.3, PIN_HALF, 0.65).setTranslation(side * ((PIN_REACH + RADIUS) / 2 - 0.15), PIN_OFFSET, 0)));
  }

  private placeArms() {
    this.armCol.forEach((c, i) => c.setTranslation({ x: 0, y: 0, z: this.arms.face[i] }));
  }

  /**
   * Moves the chopsticks one step toward what `cmd` asks: wait open, close around the hull below the pins
   * (stopping short of it), or hold where they are once the pins are level with them.
   */
  moveArms(s: { pos: Vector3; q: Quaternion }, cmd: ArmCommand) {
    axis.set(0, 1, 0).applyQuaternion(s.q);
    // where the hull's axis crosses the top and bottom of the arms: they close around the body below the pins
    const at = (y: number) => s.pos.z + axis.z * Math.max(-HALF, Math.min(PIN_OFFSET, (y - s.pos.y) / Math.max(0.2, axis.y)));
    const zTop = at(ARM_TOP), zBot = at(ARM_Y - 7);
    const a = this.arms, step = ARMS.speed * STEP;
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const hull = side > 0 ? Math.max(zTop, zBot) : Math.min(zTop, zBot);
      const want = cmd === 'closing' ? hull + side * ARMS.clear : cmd === 'holding' ? a.face[i] : side * ARMS.open;
      a.face[i] += Math.max(-step, Math.min(step, want - a.face[i]));
      a.closed[i] = cmd === 'closing' && Math.abs(want - a.face[i]) < 0.1;
    }
    this.placeArms();
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
    let onArm = false;
    this.world.intersectionPairsWith(this.hull, (c) => {
      const k = this.kinds.get(c.handle);
      if (k) this.hits.add(k === 'arm' ? 'hull-arm' : k);
    });
    for (const p of this.pins) {
      this.world.intersectionPairsWith(p, (c) => {
        const k = this.kinds.get(c.handle);
        if (k === 'arm') onArm = true;
        else if (k) this.hits.add(k);
      });
    }
    if (onArm) this.hits.add(this.arms.closed[0] && this.arms.closed[1] ? 'arms' : 'arm-open');
    return this.hits;
  }

  free() {
    this.world.free();
  }
}
