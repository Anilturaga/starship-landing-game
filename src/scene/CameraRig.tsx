import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { ARM_Y, CATCH } from '../sim/constants';
import { useGame } from '../state/store';
import { view } from '../state/view';

const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
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
const TOWER_POS = new Vector3(25, ARM_Y + 2, -9);

/**
 * Drives the single scene camera from the selected viewpoint:
 * 0 chase (drag to orbit), 1 ground tracking, 2 aft flap, 3 engine bay, 4 tower.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tmp = useMemo(() => ({ q: new Quaternion(), v: new Vector3(), lastSim: null as unknown }), []);

  useFrame(() => {
    const { sim, camera: idx } = useGame.getState();
    const s = sim.ship;
    if (tmp.lastSim !== sim) { tmp.lastSim = sim; view.reset(); }
    let fov = 50;

    if (idx === 0) {
      const o = view.orbit;
      if (o.auto) {
        const away = tmp.v.set(s.pos.x - CATCH.x, 0, s.pos.z - CATCH.z);
        if (away.lengthSq() < 1) away.set(1, 0, 0.4);
        const target = Math.atan2(away.x, away.z) + 0.55;
        o.yaw += wrap(target - o.yaw) * (s.t < 0.05 ? 1 : 0.03);
      }
      const cp = Math.cos(o.pitch);
      camera.position.set(
        s.pos.x + Math.sin(o.yaw) * cp * o.dist,
        Math.max(3, s.pos.y + Math.sin(o.pitch) * o.dist),
        s.pos.z + Math.cos(o.yaw) * cp * o.dist,
      );
      camera.lookAt(s.pos);
    } else if (idx === 2 || idx === 3) {
      const cam = idx === 2 ? AFT_FLAP : ENGINE_BAY;
      camera.position.copy(cam.p).applyQuaternion(s.q).add(s.pos);
      camera.quaternion.copy(s.q).multiply(cam.q)
        .multiply(tmp.q.setFromAxisAngle(Y, view.look.yaw))
        .multiply(tmp.q.setFromAxisAngle(X, view.look.pitch));
      fov = cam.fov;
    } else {
      camera.position.copy(idx === 1 ? TRACKING_POS : TOWER_POS);
      camera.lookAt(s.pos);
      camera.rotateY(view.look.yaw);
      camera.rotateX(view.look.pitch);
      fov = idx === 1 ? clamp((2 * Math.atan(70 / camera.position.distanceTo(s.pos)) * 180) / Math.PI, 1.2, 40) : 58;
    }
    fov = clamp(fov * view.zoom, 0.8, 110);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  });
  return null;
}
