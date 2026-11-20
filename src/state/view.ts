/** Camera look state changed by dragging. Mutated directly by input handlers, read every frame. */
export const view = {
  orbit: { yaw: 0, pitch: 0.08, dist: 105, auto: true },
  look: { yaw: 0, pitch: 0 },
  zoom: 1,
  reset() {
    this.orbit.auto = true;
    this.orbit.pitch = 0.08;
    this.orbit.dist = 105;
    this.look.yaw = this.look.pitch = 0;
    this.zoom = 1;
  },
};
