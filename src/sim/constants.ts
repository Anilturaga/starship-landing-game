/**
 * Vehicle and launch-site constants. SI units throughout (m, kg, N, s).
 * Numbers are public approximations for Starship V3 (the upper stage, "Ship"), tuned for play where noted.
 */
export const G0 = 9.80665;

// Vehicle geometry
export const LENGTH = 52; // m
export const RADIUS = 4.5; // m
export const HALF = LENGTH / 2;
/** Catch pins, measured from the vehicle centre along the body axis. */
export const PIN_OFFSET = 14;

// Mass and propulsion
export const DRY_MASS = 110_000; // kg (approximation)
export const RAPTOR_THRUST = 2.6e6; // N, one sea-level Raptor at 100%
export const RAPTOR_ISP = 330; // s, sea level
export const RAPTOR_MDOT = RAPTOR_THRUST / (RAPTOR_ISP * G0); // kg/s at 100%
export const SL_ENGINES = 3;
export const MIN_THROTTLE = 0.4; // per engine
export const GIMBAL_MAX = (15 * Math.PI) / 180;
export const SPIN_UP_S = 1.5;
export const SPIN_DOWN_S = 0.35;
/** Throttle requests at or below this are "engines off". */
export const THROTTLE_OFF = 0.03;

// Attitude control
export const RCS_TORQUE = 8e5; // N·m, small constant authority
export const FLAP_GAIN = 4500; // m³, flap torque per pascal of dynamic pressure (tuned)
export const MAX_RATE = 0.35; // rad/s commanded by full stick with fly-by-wire
export const FLAP_RATE = 1.2; // rad/s actuator slew limit

// Atmosphere
export const RHO0 = 1.225;
export const SCALE_HEIGHT = 8500;

// Site layout (tower at the origin, Gulf to +x)
export const ARM_Y = 72; // top surface of the chopsticks
export const CATCH = { x: 14, z: 0 }; // catch axis between the arms
export const TOWER = { x: -5.5, width: 9, height: 146 };
export const ARM_REACH = { x0: -1, x1: 25, halfGap: 5.9 };
export const MOUNT = { radius: 11, top: 27 };
export const SHORE_X = 1300;

// Simulation
export const STEP = 1 / 120;
export const FLIP_ALT = 1200; // where the flight computer lights the engines
export const START = { pos: [430, 2600, -140], vel: [-16, -74, 5], yaw: 0.2 } as const;
