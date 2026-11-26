# Design

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
- **Rapier** (`@dimforge/rapier3d-compat`) integrates the Ship as a rigid body and detects contacts.
- **Own force model** in `src/sim/` (plain TypeScript): aerodynamics, Raptors, gimbal, flaps and RCS. Nothing off the shelf models a belly-flopping rocket, so this part is bespoke. It runs headless, so whole flights are tested in Node.
- **drei** `<Environment>` bakes the sky into reflections. drei's stock `<Sky>` was tried and dropped, because it couldn't produce the deep blue of the reference photos.
- **@use-gesture** for camera drag, pinch and wheel; **Phosphor** for icons.
- **vite-plugin-singlefile**: `npm run build:html` writes one self-contained `dist-html/index.html` (JS, CSS and Rapier's WebAssembly inlined). That file is what gets published for testing.
- **Vitest** for the flight tests.

The rule: use a library wherever one fits, and write code only for what is specific to Starship.

### Physics: what Rapier does and what we do

Rapier owns integration (mass, inertia, gravity, forces and torques to motion) and collision detection. Each step, `physStep` computes the forces, and `SiteWorld.step` hands them to Rapier, steps the world and reads the body back. The Ship's colliders are sensors: a hull cylinder that touches the tower, mount and surface, and a pin bar that touches only a catch zone on top of the arms (collision groups keep them apart). `judge()` turns what they touch into an outcome. Mass and inertia are updated every step as propellant burns.

The game state (`ShipState`) stays the source of truth and is written into the body each step, so tests and the flight computer can move the Ship freely. Real contact response (pins sliding on the rails, tipping in the arms) is the next step: make the colliders solid instead of sensors.

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

Forces each step (Rapier integrates them):

- **Crossflow drag.** The hull is treated as a cylinder in crossflow, plus extra area from extended flaps. This produces the belly-flop's terminal speed of about 85 m/s. Tilting the nose turns some of that drag sideways, which is how the Ship glides.
- **Axial drag** along the body.
- **Thrust** along the body axis, plus the gimbal's side-force.
- **Gravity** on the current mass. Mass drops as propellant burns, and the moments of inertia follow it.

Attitude control blends three effectors, sharing out the requested torque among them:

- **Flaps**, whose authority scales with dynamic pressure. Four electric flaps are the main control in the belly-flop. They change drag at each corner, and the actuators move at a limited rate.
- **Engine gimbal**, whose authority scales with thrust. This is what flips the vehicle.
- **RCS**, a small constant torque. It also controls roll: held through the belly-flop and flip, and once upright, turning the catch pins in line with the arms (in every mode: the player has no roll control).

**Engines.** Throttle 0 means off, and anything above zero lights the engines. The flight computer picks how many engines (1–3) are needed for the thrust asked for. This mirrors the real vehicle shutting engines down late in the burn, because three Raptors at minimum throttle cannot hover.

**Fly-by-wire laws** (`src/sim/control.ts`):

- **Attitude** (Cadet, Pilot): the stick position *is* the attitude you want, and letting go holds it. It flies against a latched reference:
  - **Belly:** pitch stick sets the nose angle, ±25° from level. Lateral stick turns the heading.
  - **Flip:** latched once the engines are lit and the nose is coming up. Pull back to keep rotating; let go to hold.
  - **Upright:** below 20° of tilt. The stick sets the lean, up to 20°, toward the belly (forward) or the sides.
- **Rate** (Expert): the stick sets a turn rate, up to 20°/s, and the computer holds whatever attitude you stop at.

The first build used rate command everywhere. Playtesting showed it can't be followed reliably. The cue depended on the current attitude, so a player reacting about half a second late chased it and overshot. The cue also saturated in the stick's corners, outside its round travel.

## Controls

Mobile layout (the "one stick" option):

- **Left thumb: stick.** Pitch forward/back, lateral left/right. It drives the flaps during the fall and the gimbal once the engines are lit.
- **Right thumb: throttle slider.** Zone marks show where the second and third engines come in.
- **Bottom centre:** camera, speed (1× / ½× / ¼×) and menu.

Keyboard: WASD stick, Shift/X throttle, Space engines off/on, C or 1–5 cameras, T slow motion, R restart, Esc pause.

## Flight computer (`src/sim/guidance.ts`)

The flight computer runs ten times a second. It suggests a stick position and a throttle in the terms of the attitude law, so a cue is a place to put your thumb, not a correction to chase. It never moves your controls, except the throttle in Cadet.

**Built for human reaction time.**
- **Lead:** cues are computed for where the Ship will be 0.4 s from now. Velocity is led from the current thrust, not from measured acceleration, which would feed the throttle back into itself.
- **Reach:** cues stay inside 85% of the stick's round travel.
- **Gains:** they are low enough that a ~0.7 s total delay (reaction plus thumb) stays stable.

| Phase | Goal | Cue |
| --- | --- | --- |
| Glide | Point the nose at the catch, and arrive at flip altitude about 260 m out | Lateral stick to turn, pitch stick to glide or brake |
| Light | Start the engines | Throttle about 15% |
| Flip | Stand the Ship up | Hold the stick back; minimum thrust until the nose is past 45°, so the burn doesn't throw the Ship forward |
| Descend | Close the gap and follow a descent profile | Lean toward the target; descent rate √(4h), easing to ~1 m/s; within 60 m of the arms, creep until lined up |

The approach distance matters. The flip carries the Ship forward and braking takes room, so the glide stops well short: if it doesn't, the Ship overshoots into the tower.

**Abort.** If a catch becomes impossible, the computer latches an abort:
- **When:** there isn't enough Δv to stop; the tower is out of reach of the glide plus what the upright descent can still cover; or it's out of reach of the remaining descent once upright.
- **Where:** the Gulf if the water is within reach, otherwise open ground at least 320 m from the tower.
- **Ocean divert:** slows the descent to buy time.

**Presentation.**
- **Stick:** a blue ring on the stick, mirrored in a scope above it so the thumb never hides it.
- **Throttle:** a blue mark, with up and down arrows above it.
- **Abort:** a short red tag, and the cues turn red.

**Tests** (`tests/flight.test.ts`, `tests/pilot.ts`). A simulated player flies whole descents. It sees each cue 0.45 s late, moves its thumb with a 0.25 s lag, and has hand tremor.
- **Catches:** it must land the Ship in the arms in every one of 10 seeded runs in both Cadet and Pilot. A perfect follower must also land it.
- **Cues:** every cue must stay inside the stick's travel.
- **Aborts:** the two abort scenarios must end in the ocean and on open ground.
- **Slower player:** tuning used a slower, shakier player too (0.7 s, double tremor), which still catches about two times in three.

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

- **Ship:** built procedurally to match the V3 reference render:
  - a brushed steel side and a hex-tile belly;
  - four hinged flaps, three sea-level and three vacuum Raptors, and catch pins.
  - Engine-bay parts sit 0.5 m inside the skin. Parts closer than that, seen edge-on, poked through as flickering dots.
- **Ground:** real USGS data of Boca Chica, all public domain (`scripts/terrain.py`):
  - **NAIP orthoimagery (2024–25), in nested patches:**
    - 0.3 m per pixel over the pad (600 m);
    - 1 m over the centre 2 km;
    - 3 m out to 6 km;
    - 17 m out to 35 km;
    - then plain land/sea colours to the horizon.
  - **Seams:** each patch fades into the one around it, and the patches never overlap.
  - **Pad location:** the tower base is placed from the imagery itself. In the orthophoto the 146 m tower appears to lie flat, with its shadow, because of relief displacement. That flattened image is painted out, since the 3D tower stands there.
  - **Height:** lidar elevation (3DEP) raises the dunes and ridges in the centre 2 km. Heights are relative to the pad, flattened around it, held at zero at sea, and faded out at the patch edge.
  - **Close range:** a fine detail texture fades in within a few hundred metres, so the ground still reads as ground from a few metres up.
  - **Water:** the Gulf is glossy and rippling.
  - **Shoreline:** fitted from the lidar, where the colour of the near-shore water is unreliable. It is about 394 m east of the tower and runs slightly east going south. The physics uses it.
  - **Gaps:** where NAIP has no coverage (offshore, and south of the Rio Grande), the script fills with open-water colour, or mirrors the neighbouring land across the gap's edge, which leaves no seam.
- **Sky:** a small gradient shader tuned to the reference photos:
  - deep blue overhead, paler toward the horizon;
  - a bright sun 38° up;
  - cirrus streaks projected onto a high layer.
  - The same sky without clouds is baked into reflections.
  - Hull and ground take only a little of that blue: steel at metalness 0.6, and the ground slightly warmed, so neither reads blue or lilac.
- **Tower:** Starbase Pad A, modelled from Wikimedia Commons photos:
  - a 146 m galvanised lattice in about 9 m modules, with corner columns, X-bracing, mid columns and a stair core;
  - a concrete base, and a top platform with a lightning mast;
  - black truss chopsticks on a carriage, and the Ship quick-disconnect arm swung back.
  - Everything is instanced beams.
- **Plumes:** a custom shader with shock diamonds, which lengthens as the air thins.
- **Lighting:**
  - the sun's shadow box follows the Ship in whole texels, so edges don't shimmer;
  - light haze, with fog matched to the sky's horizon colour.

## Roadmap

1. **Start higher.** Start at 10–15 km, with time compression in the quiet part of the fall.
2. **Realism pass, continued.** Current-day imagery of the pad itself (the USGS photos predate the finished site), site buildings from OpenStreetMap, and RCS puffs.
3. **Sound.** Wind roar that scales with dynamic pressure, Raptor ignition and rumble, and arm contact.
4. **Solid catch contacts.** Rapier is in; make the pin and arm colliders solid so the Ship slides on the rails and can tip.
5. **Replays and ghost runs.** Deterministic stepping is already in place; this needs input recording.
6. **Performance.** The single-file build is 5.6 MB (2 MB gzipped), mostly Rapier's inlined WebAssembly. Add a quality setting for low-end phones.
7. **Open questions.** Scoring beyond pass/fail (propellant left, precision)? Daily-challenge seeds for wind?
