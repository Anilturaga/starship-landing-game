/-
  Two rules of the flight computer's flip (src/sim/guidance.ts), copied in whole numbers and proved for every
  possible input. `lean --run verification/Guidance.lean` checks the proofs, then answers cases read from stdin,
  so tests/lean.test.ts can check this copy still agrees with the TypeScript.

  What is proved is about the rules, not the physics: the B1 theorems pin down what flipBurn decides (they are
  short because the rule is); the B3 theorem shows the cue turns the nose up for every lean, given the flip law's
  rates (control.ts), which nothing here checks against the code. The property test in tests/properties.test.ts
  checks the same cue in the real simulation.
-/

inductive Burn | off | min | brake deriving DecidableEq

/-- `flipBurn`: off while climbing faster than 1 m/s, and once off, until falling faster than 5 m/s; harder
  than minimum when needing more than 3 m/s² to stop `h` m lower (vs²/2h > 3, i.e. vs² > 6h), spun up, with
  the nose well up (tilt < 45°); otherwise minimum. -/
def flipBurn (vs h tilt : Int) (spun lit : Bool) : Burn :=
  if vs < -1 ∨ (lit = false ∧ vs < 5) then .off
  else if vs * vs > 6 * h ∧ spun = true ∧ tilt < 45 then .brake
  else .min

/-- B1: climbing, the engines are cut. Whatever else is true: no thrust at all can feed a climb. -/
theorem cuts_engines_while_climbing (vs h tilt : Int) (spun lit : Bool) (climbing : vs < -1) :
    flipBurn vs h tilt spun lit = .off := by
  simp [flipBurn, climbing]

/-- B1: the burn only ever brakes while the Ship is falling (with at least 1 m to stop in, as the caller
  ensures). Not written into the rule: climbing at up to 1 m/s is not cut, but needs too little braking. -/
theorem brakes_only_while_falling (vs h tilt : Int) (spun lit : Bool) (room : h ≥ 1)
    (b : flipBurn vs h tilt spun lit = .brake) : vs > 0 := by
  unfold flipBurn at b
  split at b
  · contradiction
  · rename_i notOff
    split at b
    · rename_i brakes
      -- not cut, so vs ≥ -1; if also vs ≤ 0, then vs is -1 or 0, and vs² ≤ 1 < 6 ≤ 6h: no braking
      have notClimbing : ¬ vs < -1 := fun c => notOff (Or.inl c)
      have needs := brakes.1
      by_cases falling : vs > 0
      · exact falling
      · have : vs = -1 ∨ vs = 0 := by omega
        rcases this with rfl | rfl <;> omega
    · contradiction

/-- How fast the nose rises (×2/MAX_RATE) for stick (sx, sy): the stick pitches at full rate and yaws at half
  (control.ts), and the side and belly point up by bxY and bzY. Positive: getting more upright. -/
def noseRise (sx sy bxY bzY : Int) : Int := 2 * sy * bzY - sx * bxY

/-- `flipCue` points the stick along (−bxY, bzY), scaled by a positive number (GATE / length). -/
def flipCue (bxY bzY : Int) : Int × Int := (-bxY, bzY)

/-- B3: following the flip cue raises the nose whichever way the Ship leans, as long as it leans at all. -/
theorem cue_raises_nose (bxY bzY : Int) (tipped : bxY ≠ 0 ∨ bzY ≠ 0) :
    noseRise (flipCue bxY bzY).1 (flipCue bxY bzY).2 bxY bzY > 0 := by
  simp only [noseRise, flipCue]
  -- the nose rises at 2·bzY² + bxY²: a sum of squares, positive unless both are zero
  have sq : ∀ a : Int, a ≠ 0 → a * a > 0 := fun a ha => by
    rcases Int.lt_or_gt_of_ne ha with neg | pos
    · exact Int.mul_pos_of_neg_of_neg neg neg
    · exact Int.mul_pos pos pos
  have nn : ∀ a : Int, a * a ≥ 0 := fun a => by
    by_cases ha : a = 0
    · simp [ha]
    · exact Int.le_of_lt (sq a ha)
  have : 2 * bzY * bzY - -bxY * bxY = 2 * (bzY * bzY) + bxY * bxY := by
    rw [Int.neg_mul, Int.sub_neg, Int.mul_assoc]
  rw [this]
  rcases tipped with hx | hz
  · have := sq bxY hx; have := nn bzY; omega
  · have := sq bzY hz; have := nn bxY; omega

/-- Answers cases on stdin: `b vs h tilt spun lit` → flipBurn (off/min/brake); `c bxY bzY` → signs of the cue. -/
def main : IO Unit := do
  let stdin ← IO.getStdin
  repeat
    let line ← stdin.getLine
    if line.isEmpty then break
    match (line.trim.splitOn " ").map String.toInt? with
    | [_, some vs, some h, some tilt, some spun, some lit] =>
      IO.println (match flipBurn vs h tilt (spun == 1) (lit == 1) with | .off => "off" | .min => "min" | .brake => "brake")
    | [_, some bxY, some bzY] =>
      let (x, y) := flipCue bxY bzY
      IO.println s!"{x.sign} {y.sign}"
    | _ => pure ()
