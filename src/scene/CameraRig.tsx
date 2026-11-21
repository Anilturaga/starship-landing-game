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
const TOWER_POS = new Vector3(25, ARM_Y + 2, -9);

/**
 * Drives the single scene camera from the selected viewpoint:
 * 0 chase (drag to orbit), 1 ground tracking, 2 aft flap, 3 engine bay, 4 tower.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tmp = useMemo(() => ({ q: new Quaternion(), v: new Vector3(), a: new Vector3(), b: new Vector3(), lastSim: null as unknown }), []);

  useFrame((_, dt) => {
    const { sim, camera: idx } = useGame.getState();
    const s = sim.ship;
    if (tmp.lastSim !== sim) { tmp.lastSim = sim; view.reset(); }
    let fov = 50;

    if (idx === 0) {
      const o = view.orbit;
      // auto: open on the Ship alone, then pull back and rise until the landing site shows below it; near the
      // tower, swing to the open side of the arms so the tower never comes between the camera and the Ship
      const intro = smooth(1, 4.5, s.t);
      const hx = s.pos.x - CATCH.x, hz = s.pos.z - CATCH.z, hd = Math.hypot(hx, hz);
      const near = smooth(700, 220, s.pos.distanceTo(TOWER_TOP));
      if (o.auto) {
        const away = hd > 1 ? Math.atan2(hx, hz) : CATCH_YAW;
        const elev = Math.atan2(s.pos.y - ARM_Y, Math.max(hd, 1));
        const far = { yaw: away + 0.25, pitch: clamp(elev + 0.3, 0.05, 0.9) };
        const want = {
          yaw: far.yaw + wrap(CATCH_YAW - far.yaw) * near,
          pitch: 0.08 + ((far.pitch + (0.12 - far.pitch) * near) - 0.08) * intro,
        };
        const k = s.t < 0.05 ? 1 : 1 - Math.exp(-dt * 1.2);
        const kYaw = s.t < 0.05 ? 1 : k * (0.3 + 0.7 * intro);
        o.yaw += wrap(want.yaw - o.yaw) * kYaw;
        o.pitch += (want.pitch - o.pitch) * k;
      }
      // the opening shot fits the whole 50 m hull across the screen, however narrow (portrait phones)
      const halfW = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      const dist = o.auto ? Math.max(o.dist, (36 / Math.tan(halfW)) * (1 - intro)) : o.dist;
      const cp = Math.cos(o.pitch);
      camera.position.set(
        s.pos.x + Math.sin(o.yaw) * cp * dist,
        Math.max(3, s.pos.y + Math.sin(o.pitch) * dist),
        s.pos.z + Math.cos(o.yaw) * cp * dist,
      );
      if (o.auto) {
        // look between the Ship and the landing site, so both are in frame
        const m = intro * (0.4 * (1 - near) + 0.2 * near);
        const dS = tmp.a.subVectors(s.pos, camera.position).normalize();
        const dT = tmp.b.subVectors(TOWER_TOP, camera.position).normalize();
        camera.lookAt(tmp.v.copy(dS).lerp(dT, m).add(camera.position));
      } else camera.lookAt(s.pos);
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
