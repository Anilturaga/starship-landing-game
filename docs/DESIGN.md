# Catch the Ship: design

A browser game about bringing Starship's upper stage ("Ship", V3) back from a belly-flop descent and setting it into the launch tower's catch arms. The goal is to feel like the real vehicle: realistic mass, thrust and propellant, the real control surfaces, and a flight computer that helps without flying for you.

This document records what was decided and why. The `prototype/` HTML file that these decisions were tested in is linked from the README.

## Scope

| Decision | Choice | Why |
| --- | --- | --- |
| Vehicle | Ship (upper stage), V3 look | The booster is out of scope for now. |
| Landing | Tower catch on the chopsticks | SpaceX's plan for Ship, and the hardest, most distinctive ending. |
| Flight segment | Belly-flop → flip → landing burn → catch | Fits a 1–2 minute mobile session. The current build starts at 2.6 km; the target is 10–15 km (see Roadmap). |
| Platform | Browser, mobile first, desktop keyboard | Zero install, shareable by link. |

## Stack

- **Vite + React 19 + TypeScript.**
- **React Three Fiber + drei** for rendering. Declarative scene, with drei's environment lighting and helpers keeping the code small.
- **Zustand** for game state: screen, mode, camera and outcome. Per-frame data (telemetry, cues) is read straight from the simulation object, never pushed through React state at frame rate.
- **Own flight model** in `src/sim/` (plain TypeScript, no rendering imports beyond three's math types). It runs headless, so the whole game can be tested in Node.
- **Vitest** for the flight tests.

### Physics engine: why not Rapier yet

Rapier was the planned rigid-body engine (it beat Havok on determinism, snapshot/restore and renderer independence). In practice, everything that makes this game feel real is a force we compute ourselves: thrust and gimbal, flap and body aerodynamics, propellant mass, and the flight computer. The only contacts are the pins on the arms, the tower, the mount, the ground and the water, and simple geometric checks cover those well.

So the first build uses a small fixed-step 6-DOF integrator (`physStep`, 120 Hz) and keeps Rapier for when contact physics becomes the point: pins sliding on the arm rails, the vehicle tipping in the arms, or debris. The simulation API (`Simulation.step`) was shaped so that swap only touches `src/sim/`.

## Flight model (`src/sim/physics.ts`)

Body frame: +Y nose, +Z the tiled belly, +X completes the set. Units are SI.

| Quantity | Value | Note |
| --- | --- | --- |
| Length, diameter | 52 m, 9 m | V3 approximations |
| Dry mass | 110 t | approximation |
| Landing propellant | 45 t / 34 t by mode | the fuel is the clock |
| Sea-level Raptor | 2.6 MN, Isp 330 s, 40–100% throttle, ±15° gimbal | ×3 |
| Spin-up / shutdown | 1.5 s / 0.35 s | relights are not instant |
| Air density | 1.225 · e^(−h/8500) | exponential atmosphere |

Forces each step:

- **Crossflow drag.** The hull is treated as a cylinder in crossflow, plus extra area from extended flaps. This produces the belly-flop's terminal speed of about 85 m/s. Tilting the nose turns some of that drag sideways, which is how the Ship glides.
- **Axial drag** along the body.
- **Thrust** along the body axis, plus the gimbal's side-force.
- **Gravity** on the current mass. Mass drops as propellant burns, and the moments of inertia follow it.

Attitude control blends three effectors, sharing out the requested torque among them:

- **Flaps**, whose authority scales with dynamic pressure. Four electric flaps are the main control in the belly-flop. They change drag at each corner, and the actuators move at a limited rate.
- **Engine gimbal**, whose authority scales with thrust. This is what flips the vehicle.
- **RCS**, a small constant torque. It is also always on to hold roll.

**Engines.** Throttle 0 means off, and anything above zero lights the engines. The flight computer picks how many engines (1–3) are needed for the thrust asked for. This mirrors the real vehicle shutting engines down late in the burn, because three Raptors at minimum throttle cannot hover.

**Fly-by-wire.** With fly-by-wire, the stick commands a turn rate (up to 20°/s) and the computer holds attitude. Without it, the stick commands torque directly. All modes currently use fly-by-wire.

## Controls

Mobile layout (the "one stick" option):

- **Left thumb: stick.** Pitch forward/back, lateral left/right. It drives the flaps during the fall and the gimbal once the engines are lit.
- **Right thumb: throttle slider.** Zone marks show where the second and third engines come in.
- **Bottom centre:** camera, speed (1× / ½× / ¼×) and menu.

Keyboard: WASD stick, Shift/X throttle, Space engines off/on, C or 1–5 cameras, T slow motion, R restart, Esc menu.

## Flight computer (`src/sim/guidance.ts`)

The flight computer runs five times a second. It suggests a stick position and a throttle setting; it never moves your controls, except for the throttle in Cadet.

| Phase | Goal | Cue |
| --- | --- | --- |
| Glide | Arrive above 1.2 km about 120 m short of the tower | Steer the nose at the target; pitch down to glide, up to brake |
| Light | Start the engines | Throttle about 15% |
| Flip | Stand the Ship up without being thrown forward | Rotate toward vertical, leaning back against sideways drift; more throttle only if needed to stop in time |
| Descend | Follow a descent-rate profile (√(4h), at least 1 m/s) and close the gap | Tilt toward the catch axis (up to ~20°); throttle for the descent profile |

**Abort.** If a catch becomes impossible, the computer latches an abort:
- It aborts when there isn't enough Δv to stop, the tower is out of glide range, or the Ship is too far from the tower too low.
- It diverts to the Gulf if the water is within reach, otherwise to open ground at least 320 m from the tower.
- An ocean divert slows the descent to buy time.

**Presentation.** Text callouts were tried and dropped; players follow the shapes:
- A blue ring on the stick, mirrored in a small scope above it so the thumb never hides it.
- A blue mark on the throttle, with ▲ / ▼ / ● arrows above it.
- Cues are smoothed so they glide rather than jump.
- During an abort, a short red tag explains why and the cues turn red.

**Test.** `tests/flight.test.ts` flies a whole descent by doing exactly what the cues say. It must catch the Ship in Cadet and Pilot, and the two abort scenarios must end in the ocean and on open ground respectively.

## Modes

| | You control | Flight computer | Conditions |
| --- | --- | --- | --- |
| Cadet | Stick | Runs the throttle, shows stick cues | Calm air, 45 t, relaxed limits, auto slow-mo near the tower |
| Pilot | Stick + throttle | Cues for both | Light breeze, 34 t, standard limits, auto slow-mo |
| Expert | Everything | Nothing | Gusty, 34 t, standard limits |

Catch limits:
- **Standard:** under 3 m/s down, under 2 m/s sideways, within 2.5 m of centre, under 6° of tilt.
- **Relaxed:** 4.5 m/s, 3 m/s, 3.5 m, 9°.

**Slow motion.** Auto slow-mo eases to ½× once the Ship is upright, within 90 m of the tower and less than 220 m above the arms. Touching the speed control turns it off for that flight.

## Cameras

Drag anywhere to orbit (chase) or look around (other cameras), pinch or scroll to zoom, and double-tap to reset.

1. **Chase** (default): orbits the Ship and auto-frames the tower until you drag.
2. **Tracking:** a ground long-lens camera that keeps the Ship a constant size.
3. **Aft flap:** onboard, looking along the hull at the aft flap.
4. **Engine bay:** onboard, inside the skirt looking past the Raptors.
5. **Tower:** on the arms looking up.

## HUD

Webcast-inspired and deliberately sparse:
- Speed and altitude dials.
- Propellant in tonnes, with a bar and Δv remaining. Δv is the figure flight dynamics teams use; the webcast itself shows tank levels.
- Engine status and tilt.
- Height above the arms and offset from centre, shown in modes with guidance.

There is no mission clock or phase timeline; the propellant is the clock. No SpaceX logos or wordmarks are used.

## Outcomes

| Outcome | When |
| --- | --- |
| Caught | Pins reach the arms within limits |
| Struck the arms / tower / mount | Contact outside limits |
| Landed off target | Upright and slow, on the ground |
| Aborted to ocean | Any contact with the water |
| Vehicle lost | Anything else |

Losses report whether the site is safe (more than 150 m from the tower).

## Visuals

- **Ship:** built procedurally to match the V3 reference render, with a brushed steel side, a hex-tile belly, four hinged flaps, three sea-level and three vacuum Raptors, and catch pins.
- **Plumes:** a custom shader with shock diamonds, which lengthens as the air thins.
- **Lighting:** a low sun with shadows that follow the Ship, a sky dome baked into reflections, and fog for haze.
- **Site:** a lattice tower with chopsticks, the launch mount, a tank farm, buildings, a second tower, a sand strip and an animated Gulf.

## Roadmap

1. **Start higher.** Start at 10–15 km, with time compression in the quiet part of the fall.
2. **Realism pass on assets.** Real sky photos (HDRI) and terrain textures from CC0 libraries (Poly Haven, ambientCG), a better tower model, and RCS puffs.
3. **Sound.** Wind roar that scales with dynamic pressure, Raptor ignition and rumble, and arm contact.
4. **Rapier for the catch.** Pins on the arm rails and tipping.
5. **Replays and ghost runs.** Deterministic stepping is already in place; this needs input recording.
6. **Performance.** Split the 345 kB gzipped bundle, add a quality setting for low-end phones, and lazy-load the scene behind the menu.
7. **Open questions.** Scoring beyond pass/fail (propellant left, precision)? Daily-challenge seeds for wind?
