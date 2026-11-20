export type ModeId = 'cadet' | 'pilot' | 'expert';

export interface CatchLimits {
  /** max descent rate, m/s */ vs: number;
  /** max sideways speed, m/s */ hs: number;
  /** max distance of the pins from the catch axis, m */ off: number;
  /** max tilt from vertical, degrees */ tilt: number;
}

export interface Mode {
  id: ModeId;
  name: string;
  desc: string;
  /** Stick commands a turn rate and the computer holds attitude. */
  fbw: boolean;
  /** Show the flight computer's stick/throttle cues. */
  guides: boolean;
  /** Flight computer drives the throttle. */
  autoThrottle: boolean;
  /** Ease to half speed on the final approach. */
  autoSlowMo: boolean;
  /** Wind as [steady, slow gust, fast gust] amplitudes in m/s. */
  wind: [number, number, number];
  propellant: number; // kg at the start
  limits: CatchLimits;
}

const RELAXED: CatchLimits = { vs: 4.5, hs: 3, off: 3.5, tilt: 9 };
const STANDARD: CatchLimits = { vs: 3, hs: 2, off: 2.5, tilt: 6 };

export const MODES: Record<ModeId, Mode> = {
  cadet: {
    id: 'cadet',
    name: 'Cadet',
    desc: 'You steer. The flight computer runs the throttle, and blue cues show where to put the stick.',
    fbw: true, guides: true, autoThrottle: true, autoSlowMo: true,
    wind: [0, 0, 0], propellant: 45_000, limits: RELAXED,
  },
  pilot: {
    id: 'pilot',
    name: 'Pilot',
    desc: 'You steer and run the throttle, with the same blue cues for both.',
    fbw: true, guides: true, autoThrottle: false, autoSlowMo: true,
    wind: [4, 2, 1.3], propellant: 34_000, limits: STANDARD,
  },
  expert: {
    id: 'expert',
    name: 'Expert',
    desc: 'No cues and no slow motion, with gusty wind. Just you and the telemetry.',
    fbw: true, guides: false, autoThrottle: false, autoSlowMo: false,
    wind: [8, 4, 3], propellant: 34_000, limits: STANDARD,
  },
};
