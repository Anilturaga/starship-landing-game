import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ARM_Y, CATCH } from '../sim/constants';
import { useGame } from '../state/store';
import { view } from '../state/view';

const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Chase view for the catch: from the open, east side of the arms, a little south, so the tower is behind the Ship. */
const CATCH_YAW = Math.atan2(1, 0.45);
const TOWER_TOP = new Vector3(CATCH.x, ARM_Y, CATCH.z);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** A camera fixed to the hull, defined in body coordinates. */
function onboard(pos: [number, number, number], look: [number, number, number], up: [number, number, number], fov: number) {
  const p = new Vector3(...pos);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(p, new Vector3(...look), new Vector3(...up)));
  return { p, q, fov };
}
const c60 = Math.cos(Math.PI / 3), s60 = Math.sin(Math.PI / 3);
const AFT_FLAP = onboard([4.95, -5, -2.3], [6.6, -24, -1.2], [0, 0, -1], 70);
const ENGINE_BAY = onboard([c60 * 3.7, -21.6, s60 * 3.7], [-1.2, -34, -2], [c60, 0, s60], 105);
const TRACKING_POS = new Vector3(1650, 9, 1250);
/** Ground camera for the catch: on a mast east-south-east of the arms, looking at them past their open side. */
const PAD_POS = new Vector3(300, 45, 170);

/**
 * Drives the single scene camera from the selected preset (modelled on the usual sets in flight and space games
 * and on SpaceX webcasts):
 *
 * 0 Chase: an orbit camera around the Ship that keeps the horizon level and stays where you leave it, like
 *   Kerbal Space Program's Free view. It starts behind the Ship with the landing site ahead; drag to orbit.
 * 1 Target: behind the Ship on the line from the catch, a little above, so the Ship and the landing site are
 *   both in frame; near the tower it settles on the open side of the arms. Drag to offset it.
 * 2 Onboard: the aft-flap camera, 3 Engines: the engine-bay camera (webcast views; drag to look around).
 * 4 Ground: the long-lens tracking camera, cutting to a camera on the sand beside the pad for the catch.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tmp = useMemo(() => ({ q: new Quaternion(), v: new Vector3(), a: new Vector3(), b: new Vector3(), lastSim: null as unknown, padCut: false, tYaw: 0, tPitch: 0.3 }), []);

  useFrame((_, dt) => {
    const { sim, camera: idx } = useGame.getState();
    const s = sim.ship;
    if (tmp.lastSim !== sim) { tmp.lastSim = sim; view.reset(); tmp.padCut = false; }
    let fov = 50;
    const hx = s.pos.x - CATCH.x, hz = s.pos.z - CATCH.z, hd = Math.hypot(hx, hz);
    const awayYaw = hd > 1 ? Math.atan2(hx, hz) : CATCH_YAW;
    const orbitAt = (yaw: number, pitch: number, dist: number) => {
      const cp = Math.cos(pitch);
      camera.position.set(s.pos.x + Math.sin(yaw) * cp * dist, Math.max(3, s.pos.y + Math.sin(pitch) * dist), s.pos.z + Math.cos(yaw) * cp * dist);
    };

    if (idx === 0) {
      const o = view.orbit;
      // placed once (at the start and on recenter): behind the Ship, the landing site ahead of the camera
      if (o.reseat) { o.yaw = awayYaw + 0.35; o.pitch = 0.22; o.reseat = false; }
      orbitAt(o.yaw, o.pitch, o.dist);
      camera.lookAt(s.pos);
    } else if (idx === 1) {
      const near = smooth(700, 220, s.pos.distanceTo(TOWER_TOP));
      const elev = Math.atan2(s.pos.y - ARM_Y, Math.max(hd, 1));
      const farYaw = awayYaw + 0.25, farPitch = clamp(elev + 0.28, 0.05, 0.9);
      const wantYaw = farYaw + wrap(CATCH_YAW - farYaw) * near + view.look.yaw;
      const wantPitch = clamp(farPitch + (0.12 - farPitch) * near - view.look.pitch, -0.3, 1.3);
      const k = s.t < 0.05 ? 1 : 1 - Math.exp(-dt * 1.5);
      tmp.tYaw += wrap(wantYaw - tmp.tYaw) * k;
      tmp.tPitch += (wantPitch - tmp.tPitch) * k;
      orbitAt(tmp.tYaw, tmp.tPitch, view.orbit.dist);
      // look between the Ship and the landing site, so both are in frame
      const m = 0.4 * (1 - near) + 0.2 * near;
      const dS = tmp.a.subVectors(s.pos, camera.position).normalize();
      const dT = tmp.b.subVectors(TOWER_TOP, camera.position).normalize();
      camera.lookAt(tmp.v.copy(dS).lerp(dT, m).add(camera.position));
    } else if (idx === 2 || idx === 3) {
      const cam = idx === 2 ? AFT_FLAP : ENGINE_BAY;
      camera.position.copy(cam.p).applyQuaternion(s.q).add(s.pos);
      camera.quaternion.copy(s.q).multiply(cam.q)
        .multiply(tmp.q.setFromAxisAngle(Y, view.look.yaw))
        .multiply(tmp.q.setFromAxisAngle(X, view.look.pitch));
      fov = cam.fov;
    } else {
      // cut to the pad camera once the Ship is close, back to tracking if it goes away again
      const d = s.pos.distanceTo(TOWER_TOP);
      if (d < 450) tmp.padCut = true; else if (d > 650) tmp.padCut = false;
      camera.position.copy(tmp.padCut ? PAD_POS : TRACKING_POS);
      camera.lookAt(s.pos);
      camera.rotateY(view.look.yaw);
      camera.rotateX(view.look.pitch);
      // a long lens that keeps the Ship about the same size in frame
      const span = tmp.padCut ? 110 : 70;
      fov = clamp((2 * Math.atan(span / camera.position.distanceTo(s.pos)) * 180) / Math.PI, 1.2, 60);
    }
    fov = clamp(fov * view.zoom, 0.8, 110);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  });
  return null;
}
