import { Vector3 } from 'three';
import { ARM_Y, CATCH, shoreX } from '../sim/constants';
import type { Simulation } from '../sim/simulation';

/**
 * Procedural sound, all synthesised with Web Audio (no recordings):
 *
 * - Raptors: a deep rumble, a mid roar and the crackle of supersonic exhaust, scaled by thrust.
 * - Air: the hull's rush heard from outside, and wind on the microphone when the camera moves with the Ship.
 * - Shore: surf and breeze near the ground. Tower: the arms' drives, and the clang when they meet the pins.
 * - A sonic boom as the flight begins (see below), ignition thumps and the crash.
 *
 * Sound made at the Ship or the tower reaches the camera at 343 m/s: it goes through a delay of distance/c,
 * so from the tracking camera 2 km away the engines light seconds after the flame does, and as that delay
 * shrinks or grows the pitch shifts (Doppler) on its own. Distance also lowers the level and, as air absorbs
 * high frequencies, takes the edge off.
 *
 * The sonic boom: the Ship re-enters at Mach 25 and slows through Mach 1 some 20 km up, minutes before this
 * flight starts at 2.6 km (it is subsonic throughout the game, about Mach 0.25). The shock it trailed while
 * supersonic sweeps the ground around Starbase about then, heard as a double "ba-boom" from the nose and tail
 * shocks, as for Super Heavy's returns. The game starts as it arrives.
 */
const C = 343;
const MAX_DELAY = 20;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function noise(ctx: BaseAudioContext, seconds: number, kind: 'white' | 'brown' | 'crackle') {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b = 0, hit = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'brown') { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
      else {
        // crackle: sparse sharp pops of random size over a faint hiss
        if (Math.random() < 0.0012) hit = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
        d[i] = hit + w * 0.04;
        hit *= 0.86;
      }
    }
    // fade the loop seam
    const f = Math.min(2000, n / 4);
    for (let i = 0; i < f; i++) { const k = i / f; d[n - 1 - i] = d[n - 1 - i] * k + d[i] * (1 - k); }
  }
  return buf;
}

/** One emitter in the world: its sounds go through the propagation delay, distance level and air absorption. */
class Emitter {
  input: GainNode;
  private delay: DelayNode;
  private level: GainNode;
  private air: BiquadFilterNode;
  private first = true;
  constructor(private ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain();
    this.delay = ctx.createDelay(MAX_DELAY);
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.level = ctx.createGain();
    this.input.connect(this.delay).connect(this.air).connect(this.level).connect(out);
  }
  /** `ref`: distance at which the level is 1. */
  place(dist: number, ref: number) {
    const t = this.ctx.currentTime, delay = clamp(dist / C, 0, MAX_DELAY - 0.1);
    // a jump (camera switch) is set at once; motion glides, which is what gives the Doppler shift
    if (this.first || Math.abs(this.delay.delayTime.value - delay) > 0.4) this.delay.delayTime.setValueAtTime(delay, t);
    else this.delay.delayTime.setTargetAtTime(delay, t, 0.08);
    this.first = false;
    this.level.gain.setTargetAtTime(clamp(ref / Math.max(dist, 1), 0, 1.4), t, 0.08);
    this.air.frequency.setTargetAtTime(clamp(22000 * Math.exp(-dist / 900), 900, 20000), t, 0.1);
  }
}

function loop(ctx: AudioContext, buf: AudioBuffer, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(0, Math.random() * buf.duration);
  return s;
}
function filter(ctx: AudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}
function gain(ctx: AudioContext, v = 0) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

class Sound {
  muted = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ship!: Emitter;
  private tower!: Emitter;
  private buf!: { white: AudioBuffer; brown: AudioBuffer; crackle: AudioBuffer };
  private n!: {
    rumble: GainNode; roar: GainNode; crackle: GainNode; roarF: BiquadFilterNode;
    aero: GainNode; aeroF: BiquadFilterNode; wind: GainNode; windF: BiquadFilterNode;
    surf: GainNode; breeze: GainNode; drive: GainNode;
  };
  private last = { sim: null as Simulation | null, spool: 0, closed: [false, false], outcome: false, armFace: [0, 0], cam: new Vector3(), camSpeed: 0, boomAt: -1 };

  constructor() {
    try { this.muted = localStorage.getItem('catchMuted') === '1'; } catch { /* storage unavailable */ }
    const go = () => { this.start(); };
    addEventListener('pointerdown', go, { capture: true });
    addEventListener('keydown', go, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem('catchMuted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Audio may only start from a user gesture. */
  private start() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.buf = { white: noise(ctx, 3, 'white'), brown: noise(ctx, 4, 'brown'), crackle: noise(ctx, 2.3, 'crackle') };
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    this.master = gain(ctx, this.muted ? 0 : 0.9);
    this.master.connect(comp).connect(ctx.destination);
    this.ship = new Emitter(ctx, this.master);
    this.tower = new Emitter(ctx, this.master);

    // Raptors: rumble (brown noise, low), roar (band of white noise), crackle
    const rumble = gain(ctx), roar = gain(ctx), crackle = gain(ctx);
    loop(ctx, this.buf.brown).connect(filter(ctx, 'lowpass', 140)).connect(rumble).connect(this.ship.input);
    const roarF = filter(ctx, 'bandpass', 520, 0.5);
    loop(ctx, this.buf.white).connect(roarF).connect(roar).connect(this.ship.input);
    loop(ctx, this.buf.crackle).connect(filter(ctx, 'highpass', 300)).connect(crackle).connect(this.ship.input);
    // the air rushing past the hull, heard from outside
    const aero = gain(ctx), aeroF = filter(ctx, 'bandpass', 380, 0.6);
    loop(ctx, this.buf.white, 0.93).connect(aeroF).connect(aero).connect(this.ship.input);
    // wind on the microphone (not delayed: it is at the camera)
    const wind = gain(ctx), windF = filter(ctx, 'lowpass', 600, 1.2);
    loop(ctx, this.buf.brown, 1.7).connect(windF).connect(wind).connect(this.master);
    // shore: surf swelling and breaking every several seconds, and a light breeze
    const surf = gain(ctx), swell = gain(ctx, 0.55);
    loop(ctx, this.buf.brown, 0.6).connect(filter(ctx, 'lowpass', 900)).connect(swell).connect(surf).connect(this.master);
    const lfo = ctx.createOscillator(), lfoG = gain(ctx, 0.45);
    lfo.frequency.value = 0.13;
    lfo.connect(lfoG).connect(swell.gain);
    lfo.start();
    const breeze = gain(ctx);
    loop(ctx, this.buf.white, 0.5).connect(filter(ctx, 'bandpass', 1400, 0.4)).connect(breeze).connect(this.master);
    // the arms' drives at the tower: a low hydraulic hum with a whine
    const drive = gain(ctx);
    const hum = ctx.createOscillator(), whine = ctx.createOscillator();
    hum.type = 'sawtooth'; hum.frequency.value = 58;
    whine.type = 'triangle'; whine.frequency.value = 410;
    const hw = gain(ctx, 0.12);
    hum.connect(filter(ctx, 'lowpass', 300)).connect(drive);
    whine.connect(hw).connect(drive);
    loop(ctx, this.buf.brown, 2.2).connect(filter(ctx, 'bandpass', 220, 1)).connect(drive);
    drive.connect(this.tower.input);
    hum.start(); whine.start();

    this.n = { rumble, roar, crackle, roarF, aero, aeroF, wind, windF, surf, breeze, drive };
  }

  /** A one-shot through an emitter (or straight to the microphone). */
  private shot(dest: AudioNode, buf: AudioBuffer, at: number, vol: number, f: number, decay: number, type: BiquadFilterType = 'lowpass', rate = 1) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = gain(ctx);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.setTargetAtTime(0, at + 0.01, decay);
    s.connect(filter(ctx, type, f)).connect(g).connect(dest);
    s.start(at, Math.random());
    s.stop(at + decay * 8 + 0.1);
  }

  /** Metal on metal: inharmonic partials ringing down, with a thud. */
  private clang(dest: AudioNode, at: number, vol: number, base: number) {
    const ctx = this.ctx!;
    for (const [m, a, d] of [[1, 1, 1.6], [2.76, 0.6, 1.1], [5.4, 0.35, 0.7], [8.93, 0.2, 0.45], [1.5, 0.4, 2.2]]) {
      const o = ctx.createOscillator(), g = gain(ctx);
      o.frequency.value = base * m * (1 + (Math.random() - 0.5) * 0.01);
      g.gain.setValueAtTime(vol * a * 0.25, at);
      g.gain.setTargetAtTime(0, at, d / 4);
      o.connect(g).connect(dest);
      o.start(at);
      o.stop(at + d * 2);
    }
    this.shot(dest, this.buf.brown, at, vol * 1.2, 160, 0.25);
  }

  /** The double boom of the nose and tail shocks, softened by distance, and its rumble off the ground. */
  private boom(at: number) {
    const ctx = this.ctx!;
    const len = 0.12, n = Math.floor(ctx.sampleRate * len);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = 1 - (2 * i) / n; // N-wave: a jump up, a ramp down, a jump back
    for (const [dt, v] of [[0, 1], [0.21, 0.85]]) {
      const s = ctx.createBufferSource(), g = gain(ctx, v * 0.9);
      s.buffer = b;
      s.connect(filter(ctx, 'lowpass', 1400)).connect(g).connect(this.master);
      s.start(at + dt);
    }
    this.shot(this.master, this.buf.brown, at + 0.05, 1.3, 90, 0.9);
    this.shot(this.master, this.buf.brown, at + 0.3, 0.7, 60, 1.6);
  }

  /** Called every frame with the rendered camera. */
  update(sim: Simulation, cam: Vector3, dt: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || dt <= 0) return;
    const t = ctx.currentTime, L = this.last, n = this.n, s = sim.ship;
    const live = sim.running && !sim.outcome;
    const newFlight = L.sim !== sim;

    // camera speed through the air, for wind on the microphone
    const cs = newFlight ? 0 : L.cam.distanceTo(cam) / dt;
    L.cam.copy(cam);
    L.camSpeed += (Math.min(cs, 400) - L.camSpeed) * Math.min(1, dt * 4);

    const dShip = cam.distanceTo(s.pos);
    this.ship.place(dShip, 90);
    const towerP = new Vector3(CATCH.x, ARM_Y, CATCH.z);
    this.tower.place(cam.distanceTo(towerP), 40);

    // Raptors
    const lit = live && s.spool > 0 ? s.engines * s.spool * Math.max(s.thr, 0.15) : 0;
    const k = lit / 3;
    n.rumble.gain.setTargetAtTime(1.6 * Math.sqrt(k), t, 0.06);
    n.roar.gain.setTargetAtTime(0.5 * k, t, 0.06);
    n.crackle.gain.setTargetAtTime(0.55 * Math.pow(k, 1.4), t, 0.06);
    n.roarF.frequency.setTargetAtTime(380 + 500 * k, t, 0.1);
    if (live && s.spool > 0 && L.spool === 0) this.shot(this.ship.input, this.buf.brown, t, 2.2, 260, 0.18);
    L.spool = live ? s.spool : 0;

    // air
    const v = live ? s.vel.length() : 0, q = Math.pow(v / 100, 2);
    n.aero.gain.setTargetAtTime(clamp(0.8 * q, 0, 1.4), t, 0.15);
    n.aeroF.frequency.setTargetAtTime(250 + v * 3, t, 0.2);
    const w = Math.pow(L.camSpeed / 100, 2);
    n.wind.gain.setTargetAtTime(clamp(0.5 * w, 0, 1), t, 0.15);
    n.windF.frequency.setTargetAtTime(300 + L.camSpeed * 6, t, 0.2);

    // shore: louder low down and near the beach
    const low = clamp(1 - cam.y / 250, 0, 1);
    n.surf.gain.setTargetAtTime(0.5 * low * clamp(1 - Math.abs(cam.x - shoreX(cam.z)) / 1500, 0.15, 1), t, 0.3);
    n.breeze.gain.setTargetAtTime(0.05 + 0.08 * low, t, 0.3);

    // the arms: drives while they move, a clang as each closes, a heavy one on the catch
    const arms = sim.world.arms;
    const moving = !newFlight && arms.face.some((f, i) => Math.abs(f - L.armFace[i]) > 1e-4);
    n.drive.gain.setTargetAtTime(moving ? 0.35 : 0, t, 0.12);
    arms.closed.forEach((c, i) => { if (c && !L.closed[i] && !newFlight) this.clang(this.tower.input, t, 0.6, 140 + i * 9); });
    L.closed = [...arms.closed];
    L.armFace = [...arms.face];

    // outcome
    if (sim.outcome && !L.outcome && !newFlight) {
      const o = sim.outcome.kind;
      if (o === 'caught') this.clang(this.tower.input, t, 1.2, 70);
      else if (o === 'crash' || o === 'ground') {
        this.shot(this.ship.input, this.buf.brown, t, 5, 120, 1.4);
        this.shot(this.ship.input, this.buf.white, t, 1.6, 1800, 0.35);
        this.shot(this.ship.input, this.buf.crackle, t + 0.05, 1.2, 900, 0.9, 'lowpass', 0.6);
      } else if (o === 'ocean') this.shot(this.ship.input, this.buf.white, t, 1.4, 700, 0.8);
    }
    L.outcome = !!sim.outcome;

    // the sonic boom arrives a moment into each flight
    if (newFlight) L.boomAt = -1;
    if (sim.running && L.boomAt < 0 && s.t > 0.8 && s.t < 3) { L.boomAt = t; this.boom(t); }
    L.sim = sim;
  }
}

export const audio = new Sound();
