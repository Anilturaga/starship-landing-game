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

/**
 * Direction from the Ship to the automatic chase camera. Far out it sits above the line from the landing site
 * through the Ship (tilted LIFT past it, and a little to one side), so looking down past the Ship it sees the tower
 * higher on the screen; it starts level behind the Ship and ends on the open side of the arms.
 */
const LIFT = 0.3, SIDE = 0.15;
function autoChaseDir(out: Vector3, ax: number, az: number, elev: number, intro: number, near: number) {
  const yaw = Math.atan2(ax, az) + SIDE;
  const up = elev + LIFT;
  const far = new Vector3(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up));
  const y0 = yaw + 0.2;
  const start = new Vector3(Math.sin(y0) * Math.cos(0.08), Math.sin(0.08), Math.cos(y0) * Math.cos(0.08));
  const cp = Math.cos(0.12);
  const end = new Vector3(Math.sin(CATCH_YAW) * cp, Math.sin(0.12), Math.cos(CATCH_YAW) * cp);
  return out.copy(start).lerp(far, intro).lerp(end, near).normalize();
}

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
 * 0 Chase (default): opens close on the Ship, then slowly pans out to show the landing site below it, and near
 *   the tower moves to the open side of the arms. Drag to orbit freely (like Kerbal Space Program's Free view);
 *   recenter hands it back to the automatic shot.
 * 1 Target: behind the Ship on the line from the catch, a little above, so the Ship and the landing site are
 *   both in frame; near the tower it settles on the open side of the arms. Drag to offset it.
 * 2 Onboard: the aft-flap camera, 3 Engines: the engine-bay camera (webcast views; drag to look around).
 * 4 Ground: the long-lens tracking camera, cutting to a camera on the sand beside the pad for the catch.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tmp = useMemo(() => ({ q: new Quaternion(), v: new Vector3(), a: new Vector3(), b: new Vector3(), lastSim: null as unknown, padCut: false, dir: new Vector3(), w: new Vector3(), tYaw: 0, tPitch: 0.3 }), []);

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
      // auto: open level behind the Ship, then slowly rise above it, on the far side from the landing site, until
      // the camera looks down past the Ship at the tower: the Ship sits low on the screen and the tower above it,
      // clear of the thumb controls. Close in, swing to the open side of the arms for the catch.
      const intro = smooth(1, 7, s.t);
      const near = smooth(700, 220, s.pos.distanceTo(TOWER_TOP));
      if (o.reseat) { o.yaw = awayYaw + 0.35; o.pitch = 0.08; o.reseat = false; tmp.dir.set(0, 0, 0); }
      if (o.auto) {
        const want = autoChaseDir(tmp.w, hx / Math.max(hd, 1), hz / Math.max(hd, 1), Math.atan2(s.pos.y - ARM_Y, Math.max(hd, 1)), intro, near);
        if (tmp.dir.lengthSq() < 0.5 || s.t < 0.05) tmp.dir.copy(want);
        else tmp.dir.lerp(want, 1 - Math.exp(-dt * 0.9)).normalize();
        o.yaw = Math.atan2(tmp.dir.x, tmp.dir.z);
        o.pitch = Math.asin(clamp(tmp.dir.y, -1, 1));
      }
      // the opening shot fits the whole 50 m hull across the screen, however narrow (portrait phones)
      const halfW = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      // and on the final approach it backs off enough to keep the tower in frame with the Ship until the catch
      const sep = s.pos.distanceTo(TOWER_TOP);
      const dist = o.auto ? Math.max(o.dist, (36 / Math.tan(halfW)) * (1 - intro), 1.4 * sep * near) : o.dist;
      orbitAt(o.yaw, o.pitch, dist);
      if (o.auto) {
        // pan from the Ship to take in the landing site as well
        const m = intro * (0.5 * (1 - near) + 0.4 * near);
        const dS = tmp.a.subVectors(s.pos, camera.position).normalize();
        const dT = tmp.b.subVectors(TOWER_TOP, camera.position).normalize();
        camera.lookAt(tmp.v.copy(dS).lerp(dT, m).add(camera.position));
      } else camera.lookAt(s.pos);
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
