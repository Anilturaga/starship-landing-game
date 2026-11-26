# Verification

Three ways the game is checked beyond example tests, from cheapest to strongest.

| What | Where | Checks | Run |
|---|---|---|---|
| Fuzzing | `tests/fuzz.test.ts` | Rules that must hold on every step of every flight (no NaN, propellant never negative, an abort is never taken back, a catch only within limits, every flight ends), flown in Cadet and Pilot by random pilots from perfect to poor. Lists outcomes no flight reached. | `FUZZ_FLIGHTS=3000 npx vitest run tests/fuzz.test.ts` (30 run with the tests) |
| Property tests | `tests/properties.test.ts` | One rule on hundreds of inputs fast-check picks, shrunk to the simplest failing one: the flip cue stands the Ship up whichever way it leans (B3), the arms verdict (B5). | `npx vitest run tests/properties.test.ts` |
| Proofs | `verification/Guidance.lean` | Two flip rules, for every possible input: the burn is cut while climbing and only brakes while falling (B1: short, because the rule is), and the cue raises the nose whichever way the Ship leans (B3: a real proof, about the rule and the flip law's rates, not the physics). `tests/lean.test.ts` checks the Lean copy still agrees with the TypeScript. | `lean --run verification/Guidance.lean` (Lean 4.15, no libraries); `LEAN=/path/to/lean npx vitest run tests/lean.test.ts` |

Every discrete decision lives in one XState machine (`src/sim/flight.ts`), so a flight's state is a path through
it, and every flight replays exactly from its seed.
