/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { flipBurn, flipCue } from '../src/sim/guidance';
import { rng } from './pilot';

/**
 * The Lean proofs (verification/Guidance.lean) are about a copy of two TypeScript rules. This checks the copy
 * still matches: Lean checks its proofs, then answers random cases, and every answer must match the TypeScript.
 * Skipped where Lean is not installed (set LEAN to its path, or put `lean` on PATH).
 */
const LEAN = process.env.LEAN ?? 'lean';
const hasLean = spawnSync(LEAN, ['--version']).status === 0;

it.skipIf(!hasLean)('the Lean model of the flip rules agrees with the TypeScript on 4000 random cases', () => {
  const { u } = rng(2024);
  const int = (a: number, b: number) => a + Math.floor(u() * (b - a + 1));
  const cases: string[] = [], want: string[] = [];
  const sign = (v: number) => String(Math.sign(v) + 0);
  for (let i = 0; i < 2000; i++) {
    const vs = int(-60, 60), h = int(1, 400), tilt = int(0, 90), spun = int(0, 1), lit = int(0, 1);
    cases.push(`b ${vs} ${h} ${tilt} ${spun} ${lit}`);
    want.push(flipBurn(vs, h, tilt, spun === 1, lit === 1));
    const bxY = int(-1000, 1000), bzY = int(-1000, 1000), c = flipCue(bxY, bzY);
    cases.push(`c ${bxY} ${bzY}`);
    want.push(`${sign(c.x)} ${sign(c.y)}`);
  }
  const r = spawnSync(LEAN, ['--run', 'verification/Guidance.lean'], { input: cases.join('\n') + '\n', encoding: 'utf8' });
  expect(r.status, r.stderr + r.stdout).toBe(0);
  expect(r.stdout).not.toMatch(/sorry|error|warning/); // every proof complete
  expect(r.stdout.trim().split('\n')).toEqual(want);
}, 120_000);
