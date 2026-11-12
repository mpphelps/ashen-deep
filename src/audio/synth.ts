// Tiny offline synthesizer: oscillators, plucked strings, FM bells, drums, Schroeder reverb, WAV export.
export const SR = 22050;

let seed = 1;
export function srand(s: number): void {
  seed = s >>> 0 || 1;
}
export function rnd(): number {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const buf = (sec: number): Float32Array => new Float32Array(Math.ceil(sec * SR));

export type Wave = 'sine' | 'tri' | 'saw' | 'square' | 'noise';
export interface ToneOpts {
  wave?: Wave;
  amp?: number;
  attack?: number;
  release?: number;
  decay?: number; // exponential decay time constant
  sweep?: number; // frequency multiplier reached by end of sweepTime
  sweepTime?: number;
  vib?: number; // vibrato rate Hz
  vibDepth?: number;
  lp?: number; // one-pole lowpass cutoff
  lpEnd?: number; // cutoff at end (exponential glide)
  detune?: number; // cents, adds a second oscillator
}

function osc(w: Wave, ph: number): number {
  switch (w) {
    case 'sine': return Math.sin(2 * Math.PI * ph);
    case 'tri': return 1 - 4 * Math.abs(ph - 0.5);
    case 'saw': return 2 * ph - 1;
    case 'square': return ph < 0.5 ? 0.8 : -0.8;
    case 'noise': return rnd() * 2 - 1;
  }
}

const lpCoef = (fc: number): number => 1 - Math.exp((-2 * Math.PI * Math.min(fc, SR * 0.45)) / SR);

/** Adds a note into `out` starting at t0 seconds. With wrap=true the note wraps around (seamless loops). */
export function tone(out: Float32Array, t0: number, dur: number, freq: number, o: ToneOpts = {}, wrap = false): void {
  const len = out.length;
  const att = o.attack ?? 0.005;
  const rel = o.release ?? 0.02;
  const amp = o.amp ?? 0.3;
  const wave = o.wave ?? 'sine';
  const total = dur + rel;
  const n = Math.ceil(total * SR);
  const s0 = Math.round(t0 * SR);
  const det = o.detune ? Math.pow(2, o.detune / 1200) : 0;
  const sweepT = o.sweepTime ?? total;
  let ph = rnd(), ph2 = rnd(), y = 0;
  let a = o.lp ? lpCoef(o.lp) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = freq;
    if (o.sweep) f = freq * Math.pow(o.sweep, Math.min(1, t / sweepT));
    if (o.vib) f *= 1 + (o.vibDepth ?? 0.005) * Math.sin(2 * Math.PI * o.vib * t);
    ph += f / SR;
    ph -= Math.floor(ph);
    let v = osc(wave, ph);
    if (det) {
      ph2 += (f * det) / SR;
      ph2 -= Math.floor(ph2);
      v = (v + osc(wave, ph2)) * 0.5;
    }
    if (o.lp) {
      if (o.lpEnd && (i & 31) === 0) a = lpCoef(o.lp * Math.pow(o.lpEnd / o.lp, t / total));
      y += a * (v - y);
      v = y;
    }
    let env = t < att ? t / att : 1;
    if (o.decay) env *= Math.exp(-t / o.decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / rel);
    let idx = s0 + i;
    if (wrap) idx %= len;
    else if (idx >= len) break;
    if (idx >= 0) out[idx] += v * env * amp;
  }
}

/** Karplus-Strong plucked string. */
export function pluck(out: Float32Array, t0: number, freq: number, dur: number, amp: number, damp = 0.996, wrap = false): void {
  const N = Math.max(2, Math.round(SR / freq));
  const ring = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += 0.5 * (rnd() * 2 - 1 - lp);
    ring[i] = lp;
  }
  const n = Math.ceil(dur * SR);
  const s0 = Math.round(t0 * SR);
  const len = out.length;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a0 = ring[k], b0 = ring[(k + 1) % N];
    ring[k] = (a0 + b0) * 0.5 * damp;
    k = (k + 1) % N;
    const fade = i > n - 1000 ? (n - i) / 1000 : 1;
    let idx = s0 + i;
    if (wrap) idx %= len;
    else if (idx >= len) break;
    out[idx] += a0 * amp * fade;
  }
}

/** FM bell / metallic strike. */
export function bell(out: Float32Array, t0: number, f: number, dur: number, amp: number, ratio = 1.41, index = 3, wrap = false): void {
  const n = Math.ceil(dur * SR);
  const s0 = Math.round(t0 * SR);
  const len = out.length;
  const dec = dur * 0.3;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t / dec) * Math.min(1, t * 400);
    const m = Math.sin(2 * Math.PI * f * ratio * t) * index * env;
    const v = Math.sin(2 * Math.PI * f * t + m) * env;
    let idx = s0 + i;
    if (wrap) idx %= len;
    else if (idx >= len) break;
    out[idx] += v * amp;
  }
}

export function kick(out: Float32Array, t0: number, amp = 0.9, wrap = false): void {
  tone(out, t0, 0.35, 120, { sweep: 0.3, sweepTime: 0.12, decay: 0.12, amp }, wrap);
  tone(out, t0, 0.01, 0, { wave: 'noise', amp: amp * 0.3, lp: 3000, release: 0.01 }, wrap);
}
export function snare(out: Float32Array, t0: number, amp = 0.4, wrap = false): void {
  tone(out, t0, 0.2, 0, { wave: 'noise', decay: 0.06, lp: 4500, amp }, wrap);
  tone(out, t0, 0.12, 190, { decay: 0.04, amp: amp * 0.6, sweep: 0.7 }, wrap);
}
export function tom(out: Float32Array, t0: number, f: number, amp = 0.6, wrap = false): void {
  tone(out, t0, 0.5, f, { sweep: 0.55, sweepTime: 0.3, decay: 0.16, amp }, wrap);
  tone(out, t0, 0.05, 0, { wave: 'noise', decay: 0.02, lp: 1200, amp: amp * 0.25 }, wrap);
}
export function hat(out: Float32Array, t0: number, amp = 0.05, wrap = false): void {
  // highpassed-ish: noise minus its lowpass
  const n = Math.ceil(0.05 * SR);
  const s0 = Math.round(t0 * SR);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd() * 2 - 1;
    y += 0.3 * (x - y);
    let idx = s0 + i;
    if (wrap) idx %= out.length;
    else if (idx >= out.length) break;
    out[idx] += (x - y) * amp * Math.exp(-i / (0.012 * SR));
  }
}

/** Organ: additive sine partials. */
export function organ(out: Float32Array, t0: number, dur: number, f: number, amp: number, wrap = false): void {
  const parts: [number, number][] = [[1, 1], [2, 0.5], [3, 0.28], [4, 0.18], [6, 0.08]];
  for (const [h, a] of parts) tone(out, t0, dur, f * h, { amp: amp * a, attack: 0.25, release: 0.8, vib: 4.5, vibDepth: 0.002 }, wrap);
}

/** Schroeder/Freeverb-style reverb. loop=true makes the tail wrap seamlessly. */
export function reverb(dry: Float32Array, wet: number, room = 0.84, damp = 0.35, loop = false): Float32Array {
  const combD = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => Math.round((d * SR) / 44100));
  const apD = [556, 441, 341].map((d) => Math.round((d * SR) / 44100));
  const combs = combD.map((d) => ({ b: new Float32Array(d), i: 0, f: 0 }));
  const aps = apD.map((d) => ({ b: new Float32Array(d), i: 0 }));
  const L = dry.length;
  const out = new Float32Array(L);
  const passes = loop ? 2 : 1;
  const g = wet * 0.22;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < L; i++) {
      const x = dry[i] * 0.5;
      let s = 0;
      for (const c of combs) {
        const y = c.b[c.i];
        c.f = y * (1 - damp) + c.f * damp;
        c.b[c.i] = x + c.f * room;
        c.i = (c.i + 1) % c.b.length;
        s += y;
      }
      for (const a of aps) {
        const bo = a.b[a.i];
        a.b[a.i] = s + bo * 0.5;
        a.i = (a.i + 1) % a.b.length;
        s = bo - s;
      }
      if (pass === passes - 1) out[i] = dry[i] + s * g;
    }
  }
  return out;
}

export function normalize(b: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < b.length; i++) {
    if (!Number.isFinite(b[i])) b[i] = 0;
    m = Math.max(m, Math.abs(b[i]));
  }
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < b.length; i++) b[i] *= k;
  }
  return b;
}

/** Fade the very start/end of one-shot sounds to avoid clicks. */
export function declick(b: Float32Array): Float32Array {
  const n = Math.min(200, b.length >> 2);
  for (let i = 0; i < n; i++) {
    b[b.length - 1 - i] *= i / n;
  }
  return b;
}

export function toWav(b: Float32Array): Buffer {
  const data = Buffer.alloc(b.length * 2);
  for (let i = 0; i < b.length; i++) {
    const v = Math.max(-1, Math.min(1, b[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * Make a loop sound like a decaying recording: tape wow & flutter (whole cycles per loop, so it stays
 * seamless), hiss, crackle, and a dulled top end.
 */
export function decrepit(b: Float32Array, amount = 1): Float32Array {
  const L = b.length;
  const secs = L / SR;
  const wowF = Math.max(1, Math.round(0.3 * secs)) / secs;
  const flutF = Math.max(1, Math.round(6.3 * secs)) / secs;
  const aw = (0.0045 * amount * SR) / (2 * Math.PI * wowF);
  const af = (0.0009 * amount * SR) / (2 * Math.PI * flutF);
  const out = new Float32Array(L);
  for (let i = 0; i < L; i++) {
    const t = i / SR;
    let pos = i + aw * Math.sin(2 * Math.PI * wowF * t) + af * Math.sin(2 * Math.PI * flutF * t);
    pos = ((pos % L) + L) % L;
    const i0 = Math.floor(pos), fr = pos - i0;
    out[i] = b[i0] * (1 - fr) + b[(i0 + 1) % L] * fr;
  }
  let h = 0;
  for (let i = 0; i < L; i++) {
    h += 0.25 * (rnd() * 2 - 1 - h);
    out[i] += h * 0.012 * amount;
    if (rnd() < 0.00035 * amount) {
      const a = (0.04 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1);
      for (let k = 0; k < 24; k++) out[(i + k) % L] += a * Math.exp(-k / 4);
    }
  }
  const c = 1 - Math.exp((-2 * Math.PI * 4200) / SR);
  let y = 0;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < L; i++) {
      y += c * (out[i] - y);
      if (pass === 1) out[i] = y;
    }
  return out;
}
