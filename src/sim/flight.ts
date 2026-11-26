import { assign, setup } from 'xstate';
import { BREAKUP_Q, BREAKUP_Q_BROADSIDE, ENGINE_OUT_PROP } from './constants';
import type { Abort } from './guidance';
import type { CatchLimits } from './modes';
import type { Hit } from './world';

/**
 * Every discrete decision of a flight, as XState machines. The physics measures, the machines decide:
 * Simulation sends them what the physics measured and reads back what they decided. Three machines, each fed
 * at its own rate, because no decision needs another machine's event (one parallel machine was 23% slower):
 *
 * - attitudeMachine (every step, mid-physics): which attitude the fly-by-wire flies the stick against
 * - computerMachine (ten times a second, not in Expert): what the flight computer is doing, and whether it has
 *   given up on the catch
 * - flightMachine (every step, after physics): propellant feed, chopsticks, and how the flight ended
 */

/** The flip starts once the engines are lit and the nose is coming up; it is upright below 20°, tipped over above 60°. */
export const attitudeMachine = setup({
  types: { events: {} as { type: 'ATTITUDE'; tilt: number; lit: boolean } },
  guards: {
    flipStarted: ({ event }) => event.lit && event.tilt < 78,
    nearlyUpright: ({ event }) => event.tilt < 20,
    tippedOver: ({ event }) => event.tilt > 60,
  },
}).createMachine({
  id: 'attitude',
  initial: 'belly',
  states: {
    belly: { on: { ATTITUDE: [{ guard: 'nearlyUpright', target: 'upright' }, { guard: 'flipStarted', target: 'flip' }] } },
    flip: { on: { ATTITUDE: { guard: 'nearlyUpright', target: 'upright' } } },
    upright: { on: { ATTITUDE: { guard: 'tippedOver', target: 'flip' } } },
  },
});

/** What the flight computer sees on one of its ticks. */
export interface GuideTick {
  upright: boolean;
  /** Engines requested on, and spun up enough to steer with. */
  lit: boolean;
  spun: boolean;
  /** Low enough to light the engines regardless. */
  low: boolean;
  /** The catch is no longer possible, and where to go instead (null: still possible). */
  lost: Abort | null;
}

export const computerMachine = setup({
  types: { context: {} as { why: string | null }, events: {} as { type: 'GUIDE'; tick: GuideTick } },
  guards: {
    upright: ({ event }) => event.tick.upright,
    spun: ({ event }) => (event.tick.lit || event.tick.low) && event.tick.spun,
    lighting: ({ event }) => event.tick.lit || event.tick.low,
    lostToOcean: ({ event }) => event.tick.lost?.mode === 'ocean',
    lostToClear: ({ event }) => event.tick.lost?.mode === 'clear',
  },
  actions: { latch: assign({ why: ({ event }) => event.tick.lost?.why ?? null }) },
}).createMachine({
  id: 'computer',
  type: 'parallel',
  context: { why: null },
  states: {
    // re-decided on every tick from what the Ship is doing
    phase: {
      initial: 'glide',
      on: {
        GUIDE: [
          { guard: 'upright', target: '.descend' },
          { guard: 'spun', target: '.flip' },
          { guard: 'lighting', target: '.light' },
          { target: '.glide' },
        ],
      },
      states: { glide: {}, light: {}, flip: {}, descend: {} },
    },
    // once given up, never taken back
    abort: {
      initial: 'none',
      states: {
        none: {
          on: {
            GUIDE: [
              { guard: 'lostToOcean', target: 'ocean', actions: 'latch' },
              { guard: 'lostToClear', target: 'clear', actions: 'latch' },
            ],
          },
        },
        ocean: {},
        clear: {},
      },
    },
  },
});

/** What the physics measured in a step, for the decisions taken after it. */
export interface Measured {
  hits: ReadonlySet<Hit>;
  prop: number; // kg
  /** Dynamic pressure on the whole vehicle, and on its side (the crossflow the belly-flop is built for), Pa. */
  q: number;
  qSide: number;
  speed: number; // m/s
  /** Pins' distance from the catch axis (m), descent rate and sideways speed (m/s), tilt from vertical (deg). */
  offset: number;
  descent: number;
  sideways: number;
  tilt: number;
  inOcean: boolean;
  /** The arms' view of the Ship: its pins are over the arms, this far (m) above their top. */
  overArms: boolean;
  aboveArms: number;
}

export const within = (m: Measured, l: CatchLimits) => m.offset < l.off && m.descent < l.vs && m.sideways < l.hs && m.tilt < l.tilt;
type Args = { context: { limits: CatchLimits }; event: { m: Measured } };
const on = (f: (m: Measured, l: CatchLimits) => boolean) => ({ context, event }: Args) => f(event.m, context.limits);
const hit = (h: Hit) => on((m) => m.hits.has(h));
const touchedDown = (f: (m: Measured) => boolean) => on((m) => m.hits.has('surface') && f(m));

export const flightMachine = setup({
  types: { context: {} as { limits: CatchLimits }, events: {} as { type: 'STEP'; m: Measured }, input: {} as { limits: CatchLimits } },
  guards: {
    // propellant feed: near empty the header tanks can no longer feed all three engines
    low: on((m) => m.prop < ENGINE_OUT_PROP),
    dry: on((m) => m.prop <= 0),
    // arms: close once the pins are over them and just above; hold (never close onto the hull) once level
    closeArms: on((m) => m.overArms && m.aboveArms > 0.2 && m.aboveArms < 30),
    holdArms: on((m) => m.overArms && m.aboveArms <= 0.2),
    leftArms: on((m) => !m.overArms || m.aboveArms >= 30),
    // outcome, in order of precedence
    mast: hit('mast'),
    carriage: hit('carriage'),
    qdArm: hit('qd-arm'),
    hullArm: hit('hull-arm'),
    armOpen: on((m, l) => m.hits.has('arm-open') && within(m, l)), // only when nothing else was wrong
    caught: on((m, l) => m.hits.has('arms') && within(m, l)),
    armsOverLimit: on((m) => m.hits.has('arms') || m.hits.has('arm-open')),
    mount: hit('mount'),
    softSplash: touchedDown((m) => m.inOcean && m.descent < 6),
    hardSplash: touchedDown((m) => m.inOcean),
    setDown: touchedDown((m) => m.tilt < 10 && m.speed < 4),
    surface: hit('surface'),
    overspeed: on((m) => m.q > BREAKUP_Q),
    broadside: on((m) => m.qSide > BREAKUP_Q_BROADSIDE),
  },
}).createMachine({
  id: 'flight',
  type: 'parallel',
  context: ({ input }) => input,
  states: {
    // the tanks: one engine starves first near empty; dry stops them all (physics also stops at zero)
    propulsion: {
      initial: 'nominal',
      states: {
        nominal: { on: { STEP: [{ guard: 'dry', target: 'starved' }, { guard: 'low', target: 'engineOut' }] } },
        engineOut: { on: { STEP: { guard: 'dry', target: 'starved' } } },
        starved: {},
      },
    },
    // (transitions only out of the current state: re-entering it every step costs a quarter of the sim's speed)
    arms: {
      initial: 'open',
      states: {
        open: { on: { STEP: [{ guard: 'closeArms', target: 'closing' }, { guard: 'holdArms', target: 'holding' }] } },
        closing: { on: { STEP: [{ guard: 'holdArms', target: 'holding' }, { guard: 'leftArms', target: 'open' }] } },
        holding: { on: { STEP: [{ guard: 'closeArms', target: 'closing' }, { guard: 'leftArms', target: 'open' }] } },
      },
    },
    outcome: {
      initial: 'flying',
      states: {
        flying: {
          on: {
            STEP: [
              { guard: 'mast', target: 'crash.tower.mast' },
              { guard: 'carriage', target: 'crash.tower.carriage' },
              { guard: 'qdArm', target: 'crash.tower.qdArm' },
              { guard: 'hullArm', target: 'crash.hullArm' },
              { guard: 'armOpen', target: 'crash.armOpen' },
              { guard: 'caught', target: 'caught' },
              { guard: 'armsOverLimit', target: 'crash.armsOverLimit' },
              { guard: 'mount', target: 'crash.mount' },
              { guard: 'softSplash', target: 'ocean.soft' },
              { guard: 'hardSplash', target: 'ocean.hard' },
              { guard: 'setDown', target: 'ground' },
              { guard: 'surface', target: 'crash.surface' },
              { guard: 'overspeed', target: 'crash.breakup.overspeed' },
              { guard: 'broadside', target: 'crash.breakup.broadside' },
            ],
          },
        },
        caught: {},
        ground: {},
        ocean: { initial: 'soft', states: { soft: {}, hard: {} } },
        crash: {
          initial: 'surface',
          states: {
            tower: { initial: 'mast', states: { mast: {}, carriage: {}, qdArm: {} } },
            hullArm: {}, armOpen: {}, armsOverLimit: {}, mount: {}, surface: {},
            breakup: { initial: 'overspeed', states: { overspeed: {}, broadside: {} } },
          },
        },
      },
    },
  },
});
