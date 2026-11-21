import { Vector3 } from 'three';

/** Camera look state changed by dragging. Mutated directly by input handlers, read every frame. */
export const view = {
  orbit: { yaw: 0, pitch: 0.22, dist: 120, auto: true, reseat: true },
  look: { yaw: 0, pitch: 0 },
  zoom: 1,
  /** The rendered camera's right and up vectors, and its level forward direction (written each frame, for the HUD). */
  cam: { right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), fwd: new Vector3(0, 0, -1) },
  reset() {
    this.orbit.auto = true;
    this.orbit.reseat = true;
    this.orbit.dist = 120;
    this.look.yaw = this.look.pitch = 0;
    this.zoom = 1;
  },
};
