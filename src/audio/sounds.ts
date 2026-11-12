// Sound design: every effect and music track is generated procedurally.
import { SR, buf, tone, pluck, bell, kick, snare, tom, hat, organ, reverb, normalize, declick, mtof, srand, rnd } from './synth.ts';

type Gen = () => Float32Array;

const fin = (b: Float32Array, peak = 0.8, wet = 0.15): Float32Array =>
  declick(normalize(wet > 0 ? reverb(b, wet) : b, peak));

function thud(b: Float32Array, t: number, f = 120, amp = 0.9, dec = 0.08): void {
  tone(b, t, 0.3, f, { sweep: 0.35, sweepTime: 0.1, decay: dec, amp });
}
function chord(b: Float32Array, t: number, notes: number[], dur: number, o: Parameters<typeof tone>[4], wrap = false): void {
  for (const n of notes) tone(b, t, dur, mtof(n), o, wrap);
}

// ============================================================================ sound effects
export const SFX: Record<string, Gen> = {
  swing: () => {
    const b = buf(0.22);
    tone(b, 0, 0.1, 0, { wave: 'noise', attack: 0.03, lp: 700, lpEnd: 3500, decay: 0.07, amp: 0.7 });
    return fin(b, 0.45, 0.05);
  },
  heavy: () => {
    const b = buf(0.5);
    tone(b, 0, 0.25, 0, { wave: 'noise', attack: 0.1, lp: 300, lpEnd: 2200, decay: 0.14, amp: 0.8 });
    tone(b, 0.05, 0.3, 110, { sweep: 0.45, decay: 0.15, amp: 0.35 });
    return fin(b, 0.6, 0.1);
  },
  hit: () => {
    const b = buf(0.3);
    thud(b, 0, 150, 0.9, 0.07);
    tone(b, 0, 0.05, 0, { wave: 'noise', lp: 2600, decay: 0.025, amp: 0.6 });
    tone(b, 0.01, 0.12, 320, { wave: 'saw', sweep: 0.25, lp: 900, decay: 0.05, amp: 0.3 });
    return fin(b, 0.75, 0.08);
  },
  crit: () => {
    const b = buf(0.6);
    thud(b, 0, 160, 1, 0.08);
    tone(b, 0, 0.06, 0, { wave: 'noise', lp: 4000, decay: 0.03, amp: 0.7 });
    bell(b, 0.01, 1250, 0.5, 0.25, 2.1, 2);
    return fin(b, 0.85, 0.15);
  },
  stab: () => {
    const b = buf(1.2);
    tone(b, 0, 0.25, 0, { wave: 'noise', lp: 1800, lpEnd: 300, decay: 0.15, amp: 0.8 });
    thud(b, 0, 110, 1, 0.2);
    tone(b, 0.02, 0.3, 260, { wave: 'saw', sweep: 0.3, lp: 700, decay: 0.12, amp: 0.4 });
    bell(b, 0.05, 220, 1.1, 0.2, 1.06, 1.5);
    bell(b, 0.05, 233, 1.1, 0.18, 1.06, 1.5);
    return fin(b, 0.95, 0.35);
  },
  clank: () => {
    const b = buf(0.4);
    bell(b, 0, 880, 0.3, 0.4, 2.76, 2.5);
    bell(b, 0, 1370, 0.2, 0.2, 1.5, 1.5);
    tone(b, 0, 0.02, 0, { wave: 'noise', lp: 6000, decay: 0.01, amp: 0.5 });
    return fin(b, 0.6, 0.12);
  },
  parry: () => {
    const b = buf(1.3);
    bell(b, 0, 1760, 1.2, 0.45, 1.41, 4);
    bell(b, 0, 2640, 0.8, 0.25, 2.0, 2);
    bell(b, 0.005, 880, 1.0, 0.2, 1.0, 1);
    tone(b, 0, 0.02, 0, { wave: 'noise', lp: 8000, decay: 0.008, amp: 0.7 });
    return fin(b, 0.85, 0.4);
  },
  roll: () => {
    const b = buf(0.4);
    tone(b, 0, 0.15, 0, { wave: 'noise', attack: 0.06, lp: 600, decay: 0.1, amp: 0.6 });
    thud(b, 0.14, 80, 0.5, 0.06);
    return fin(b, 0.4, 0.05);
  },
  hurt: () => {
    const b = buf(0.45);
    tone(b, 0, 0.2, 200, { wave: 'saw', sweep: 0.5, lp: 1100, decay: 0.12, amp: 0.45, vib: 25, vibDepth: 0.03 });
    thud(b, 0, 100, 0.8, 0.08);
    tone(b, 0, 0.05, 0, { wave: 'noise', lp: 2000, decay: 0.03, amp: 0.4 });
    return fin(b, 0.75, 0.1);
  },
  death: () => {
    const b = buf(5.5);
    tone(b, 0, 2.2, 220, { wave: 'saw', sweep: 0.25, lp: 700, lpEnd: 200, attack: 0.02, amp: 0.3, release: 1 });
    tone(b, 0, 3.5, 55, { wave: 'saw', lp: 260, attack: 0.3, amp: 0.25, release: 1.5 });
    tone(b, 0, 3.5, 41.2, { amp: 0.35, attack: 0.3, release: 1.5 });
    bell(b, 0.6, 110, 4.5, 0.35, 1.4, 2.5);
    bell(b, 0.6, 164.8, 4, 0.15, 1.4, 2);
    return fin(b, 0.9, 0.55);
  },
  kill: () => {
    const b = buf(0.8);
    tone(b, 0, 0.3, 0, { wave: 'noise', lp: 1400, lpEnd: 250, decay: 0.15, amp: 0.7 });
    thud(b, 0, 90, 0.8, 0.2);
    tone(b, 0.12, 0.4, 0, { wave: 'noise', attack: 0.1, lp: 3500, decay: 0.2, amp: 0.15 });
    return fin(b, 0.7, 0.2);
  },
  warn: () => {
    const b = buf(0.2);
    tone(b, 0, 0.08, 640, { sweep: 1.5, decay: 0.05, amp: 0.4, wave: 'tri' });
    tone(b, 0, 0.02, 0, { wave: 'noise', lp: 7000, decay: 0.01, amp: 0.15 });
    return fin(b, 0.22, 0.1);
  },
  bosswarn: () => {
    const b = buf(0.8);
    tone(b, 0, 0.35, 73.4, { wave: 'saw', lp: 450, attack: 0.04, amp: 0.4, release: 0.3 });
    tone(b, 0, 0.35, 36.7, { amp: 0.6, attack: 0.04, release: 0.3 });
    return fin(b, 0.55, 0.25);
  },
  arrow: () => {
    const b = buf(0.35);
    pluck(b, 0, 300, 0.25, 0.6, 0.99);
    tone(b, 0.02, 0.08, 0, { wave: 'noise', lp: 3000, decay: 0.05, amp: 0.3 });
    return fin(b, 0.5, 0.08);
  },
  fire: () => {
    srand(7);
    const b = buf(0.9);
    tone(b, 0, 0.4, 0, { wave: 'noise', attack: 0.1, lp: 700, lpEnd: 2600, decay: 0.3, amp: 0.7 });
    for (let k = 0; k < 14; k++) tone(b, rnd() * 0.7, 0.01, 0, { wave: 'noise', lp: 5000, decay: 0.006, amp: 0.5 });
    return fin(b, 0.6, 0.15);
  },
  boom: () => {
    const b = buf(1.4);
    tone(b, 0, 0.6, 0, { wave: 'noise', lp: 700, lpEnd: 120, decay: 0.35, amp: 1 });
    tone(b, 0, 0.8, 60, { sweep: 0.4, decay: 0.4, amp: 1 });
    return fin(b, 0.95, 0.35);
  },
  crumble: () => {
    srand(11);
    const b = buf(1.2);
    tone(b, 0, 0.4, 0, { wave: 'noise', lp: 500, lpEnd: 150, decay: 0.25, amp: 0.9 });
    thud(b, 0, 70, 0.8, 0.25);
    for (let k = 0; k < 18; k++) thud(b, 0.1 + rnd() * 0.8, 200 + rnd() * 400, 0.2, 0.02);
    return fin(b, 0.85, 0.3);
  },
  loot: () => {
    const b = buf(0.6);
    bell(b, 0, 880, 0.4, 0.3, 2, 1);
    bell(b, 0.07, 1318.5, 0.45, 0.25, 2, 1);
    return fin(b, 0.4, 0.25);
  },
  rare: () => {
    const b = buf(1.1);
    [74, 77, 81, 86].forEach((n, i) => bell(b, i * 0.07, mtof(n), 0.8, 0.25, 2, 1.2));
    return fin(b, 0.55, 0.35);
  },
  legendary: () => {
    const b = buf(2.8);
    [62, 69, 74, 77, 81, 86, 89].forEach((n, i) => bell(b, i * 0.06, mtof(n), 2, 0.2, 2, 1.5));
    chord(b, 0.1, [50, 57, 62, 65], 1.4, { wave: 'saw', detune: 9, lp: 1200, attack: 0.3, release: 1, amp: 0.08 });
    return fin(b, 0.7, 0.5);
  },
  ashes: () => {
    const b = buf(0.25);
    tone(b, 0, 0.05, 1760, { decay: 0.04, amp: 0.5 });
    tone(b, 0.04, 0.05, 2349, { decay: 0.04, amp: 0.4 });
    return fin(b, 0.18, 0.2);
  },
  key: () => {
    const b = buf(0.8);
    bell(b, 0, 1500, 0.4, 0.3, 3.1, 2);
    bell(b, 0.09, 2000, 0.4, 0.25, 3.1, 2);
    bell(b, 0.18, 2500, 0.5, 0.25, 3.1, 2);
    return fin(b, 0.5, 0.3);
  },
  unlock: () => {
    const b = buf(1.1);
    thud(b, 0, 110, 0.9, 0.1);
    tone(b, 0, 0.05, 0, { wave: 'noise', lp: 1500, decay: 0.03, amp: 0.6 });
    tone(b, 0.15, 0.6, 85, { wave: 'saw', sweep: 1.7, lp: 650, vib: 9, vibDepth: 0.04, amp: 0.3, attack: 0.05, release: 0.15 });
    thud(b, 0.85, 70, 0.6, 0.1);
    return fin(b, 0.7, 0.3);
  },
  locked: () => {
    const b = buf(0.45);
    for (let k = 0; k < 3; k++) {
      bell(b, k * 0.08, 600 + k * 40, 0.15, 0.3, 2.7, 2);
      thud(b, k * 0.08, 200, 0.3, 0.02);
    }
    return fin(b, 0.45, 0.1);
  },
  door: () => {
    const b = buf(0.6);
    tone(b, 0, 0.35, 110, { wave: 'saw', sweep: 1.5, lp: 700, vib: 11, vibDepth: 0.05, amp: 0.25, attack: 0.04, release: 0.08 });
    thud(b, 0.36, 90, 0.4, 0.06);
    return fin(b, 0.35, 0.2);
  },
  chest: () => {
    const b = buf(1.1);
    tone(b, 0, 0.4, 95, { wave: 'saw', sweep: 1.6, lp: 600, vib: 8, vibDepth: 0.05, amp: 0.3, attack: 0.03 });
    bell(b, 0.4, 660, 0.6, 0.25, 2, 1);
    bell(b, 0.48, 990, 0.6, 0.22, 2, 1);
    return fin(b, 0.55, 0.3);
  },
  urn: () => {
    srand(3);
    const b = buf(0.6);
    for (let k = 0; k < 9; k++) {
      const t = rnd() * 0.18;
      tone(b, t, 0.02, 0, { wave: 'noise', lp: 6000, decay: 0.012, amp: 0.6 });
      bell(b, t, 2000 + rnd() * 2500, 0.15, 0.1, 3.3, 1);
    }
    thud(b, 0, 180, 0.4, 0.03);
    return fin(b, 0.55, 0.15);
  },
  rune: () => {
    const b = buf(0.6);
    bell(b, 0, 1046.5, 0.5, 0.35, 3, 1);
    bell(b, 0.02, 1568, 0.4, 0.15, 3, 1);
    return fin(b, 0.35, 0.35);
  },
  brazier: () => {
    const b = buf(1);
    tone(b, 0, 0.45, 0, { wave: 'noise', attack: 0.04, lp: 250, lpEnd: 1600, decay: 0.3, amp: 0.9 });
    tone(b, 0, 0.4, 70, { decay: 0.2, amp: 0.6 });
    return fin(b, 0.6, 0.25);
  },
  wrong: () => {
    const b = buf(1.2);
    chord(b, 0, [33, 34], 0.6, { wave: 'saw', lp: 700, amp: 0.3, release: 0.5 });
    thud(b, 0, 60, 0.9, 0.3);
    return fin(b, 0.75, 0.35);
  },
  push: () => {
    const b = buf(0.45);
    tone(b, 0, 0.35, 0, { wave: 'noise', lp: 260, amp: 0.9, attack: 0.03, release: 0.08 });
    tone(b, 0, 0.35, 48, { wave: 'saw', lp: 220, vib: 18, vibDepth: 0.08, amp: 0.4, release: 0.08 });
    return fin(b, 0.5, 0.1);
  },
  plate: () => {
    const b = buf(0.5);
    thud(b, 0, 300, 0.6, 0.04);
    tone(b, 0.05, 0.25, 98, { wave: 'saw', lp: 400, decay: 0.12, amp: 0.3 });
    bell(b, 0.02, 520, 0.3, 0.15, 1.5, 1);
    return fin(b, 0.5, 0.2);
  },
  solved: () => {
    const b = buf(2.6);
    [62, 65, 69, 72, 74, 77, 81].forEach((n, i) => bell(b, i * 0.09, mtof(n), 0.9, 0.22, 2, 1.1));
    chord(b, 0.63, [74, 81, 86], 1.2, { amp: 0.08, attack: 0.05, release: 0.9 });
    chord(b, 0.63, [50, 57], 1.2, { wave: 'saw', lp: 900, amp: 0.1, attack: 0.05, release: 0.9 });
    return fin(b, 0.6, 0.45);
  },
  drink: () => {
    const b = buf(0.8);
    for (let k = 0; k < 3; k++) {
      tone(b, k * 0.2, 0.08, 180, { sweep: 2, decay: 0.06, amp: 0.5 });
      tone(b, k * 0.2 + 0.02, 0.05, 0, { wave: 'noise', lp: 900, decay: 0.03, amp: 0.15 });
    }
    bell(b, 0.62, 1174.7, 0.4, 0.12, 2, 1);
    return fin(b, 0.45, 0.15);
  },
  rest: () => {
    srand(5);
    const b = buf(3);
    chord(b, 0, [50, 57, 62, 64, 69], 1.6, { wave: 'saw', detune: 7, lp: 900, attack: 0.7, release: 1.2, amp: 0.08 });
    for (let k = 0; k < 30; k++) tone(b, rnd() * 2.5, 0.01, 0, { wave: 'noise', lp: 4000, decay: 0.005, amp: 0.25 });
    return fin(b, 0.5, 0.45);
  },
  levelup: () => {
    const b = buf(2.2);
    [50, 57, 62, 66, 69, 74].forEach((n, i) => bell(b, i * 0.08, mtof(n + 12), 1.2, 0.2, 2, 1));
    chord(b, 0, [50, 57, 62, 66], 1.2, { wave: 'saw', detune: 8, lp: 1400, attack: 0.3, release: 0.8, amp: 0.08 });
    return fin(b, 0.6, 0.45);
  },
  descend: () => {
    const b = buf(2.4);
    tone(b, 0, 1.3, 0, { wave: 'noise', attack: 0.3, lp: 2200, lpEnd: 150, amp: 0.7, release: 0.5 });
    tone(b, 0, 1.6, 110, { sweep: 0.35, amp: 0.5, attack: 0.2, release: 0.5 });
    return fin(b, 0.6, 0.5);
  },
  bossintro: () => {
    const b = buf(4.5);
    tone(b, 0, 0.8, 0, { wave: 'noise', lp: 600, lpEnd: 100, decay: 0.5, amp: 1 });
    tone(b, 0, 1, 55, { sweep: 0.5, decay: 0.6, amp: 1 });
    chord(b, 0.2, [36, 43, 48, 51], 2.2, { wave: 'saw', detune: 10, lp: 420, attack: 0.25, release: 1.4, amp: 0.2 });
    bell(b, 0.2, 65.4, 4, 0.3, 1.4, 2);
    return fin(b, 0.95, 0.5);
  },
  roar: () => {
    const b = buf(2);
    tone(b, 0, 1.1, 0, { wave: 'noise', attack: 0.1, lp: 300, lpEnd: 1300, amp: 0.8, release: 0.4 });
    tone(b, 0, 1.1, 85, { wave: 'saw', sweep: 0.7, lp: 900, vib: 28, vibDepth: 0.12, amp: 0.5, attack: 0.1, release: 0.4 });
    tone(b, 0, 1.1, 60, { wave: 'square', sweep: 0.7, lp: 500, vib: 31, vibDepth: 0.1, amp: 0.3, attack: 0.1, release: 0.4 });
    return fin(b, 0.95, 0.4);
  },
  victory: () => {
    const b = buf(6);
    tone(b, 0, 0.5, 50, { sweep: 0.5, decay: 0.4, amp: 0.8 });
    chord(b, 0.05, [38, 45, 50, 57, 62, 66, 69], 3, { wave: 'saw', detune: 9, lp: 1300, attack: 0.4, release: 2.2, amp: 0.07 });
    [62, 66, 69, 74, 78, 81].forEach((n, i) => bell(b, 0.1 + i * 0.12, mtof(n), 3.5, 0.18, 2, 1.3));
    bell(b, 0.05, 73.4, 5, 0.25, 1.4, 2);
    return fin(b, 0.9, 0.6);
  },
  spikes: () => {
    const b = buf(0.35);
    tone(b, 0, 0.03, 0, { wave: 'noise', lp: 7000, decay: 0.015, amp: 0.8 });
    bell(b, 0, 2200, 0.25, 0.2, 2.9, 2);
    thud(b, 0, 250, 0.3, 0.02);
    return fin(b, 0.5, 0.12);
  },
  menu: () => {
    const b = buf(0.08);
    tone(b, 0, 0.03, 880, { decay: 0.02, amp: 0.5, wave: 'tri' });
    return fin(b, 0.15, 0);
  },
  select: () => {
    const b = buf(0.45);
    bell(b, 0, 659, 0.3, 0.3, 2, 1);
    bell(b, 0.08, 988, 0.35, 0.3, 2, 1);
    return fin(b, 0.35, 0.3);
  },
  reclaim: () => {
    const b = buf(1.5);
    tone(b, 0, 0.6, 220, { sweep: 2, attack: 0.4, release: 0.3, amp: 0.4 });
    [69, 74, 77].forEach((n, i) => bell(b, 0.4 + i * 0.08, mtof(n + 12), 0.8, 0.2, 2, 1));
    return fin(b, 0.55, 0.4);
  },
  dig: () => {
    srand(17);
    const b = buf(0.5);
    tone(b, 0, 0.12, 0, { wave: 'noise', lp: 900, lpEnd: 300, decay: 0.08, amp: 0.8 });
    thud(b, 0.02, 140, 0.6, 0.05);
    for (let k = 0; k < 6; k++) tone(b, 0.1 + rnd() * 0.25, 0.01, 0, { wave: 'noise', lp: 2500, decay: 0.01, amp: 0.25 });
    return fin(b, 0.55, 0.08);
  },
  hook: () => {
    srand(19);
    const b = buf(0.6);
    for (let k = 0; k < 10; k++) bell(b, k * 0.03, 1800 + rnd() * 900, 0.08, 0.15, 3.7, 1.5);
    bell(b, 0.32, 700, 0.25, 0.4, 2.76, 2.5);
    thud(b, 0.32, 180, 0.4, 0.03);
    return fin(b, 0.55, 0.1);
  },
  bell: () => {
    // the silent bell: a huge toll heard from inside your skull
    const b = buf(5);
    bell(b, 0, 98, 5, 0.5, 1.4, 3);
    bell(b, 0, 196.5, 4, 0.25, 2.76, 2);
    bell(b, 0, 293, 3, 0.12, 1.41, 1.5);
    tone(b, 0, 3.5, 49, { amp: 0.25, attack: 0.05, release: 1.4 });
    return fin(b, 0.85, 0.6);
  },
  page: () => {
    const b = buf(0.35);
    tone(b, 0, 0.2, 0, { wave: 'noise', attack: 0.04, lp: 4000, lpEnd: 1500, amp: 0.4, release: 0.08 });
    bell(b, 0.12, 1318, 0.25, 0.08, 2, 1);
    return fin(b, 0.3, 0.1);
  },
  talk: () => {
    const b = buf(0.12);
    tone(b, 0, 0.05, 220, { wave: 'tri', decay: 0.03, amp: 0.4, sweep: 0.8 });
    return fin(b, 0.16, 0);
  },
  buy: () => {
    srand(29);
    const b = buf(0.5);
    for (let k = 0; k < 5; k++) bell(b, k * 0.04, 2200 + rnd() * 1200, 0.15, 0.15, 3.1, 1);
    thud(b, 0.2, 260, 0.3, 0.03);
    return fin(b, 0.4, 0.15);
  },
  quest: () => {
    const b = buf(2.4);
    [57, 62, 65, 69].forEach((n, i) => bell(b, i * 0.14, mtof(n + 12), 1.4, 0.2, 2, 1));
    chord(b, 0.55, [50, 57, 62], 1.4, { wave: 'saw', detune: 7, lp: 900, attack: 0.3, release: 0.8, amp: 0.08 });
    return fin(b, 0.5, 0.45);
  },
  tallow: () => {
    const b = buf(1.8);
    [81, 86, 89, 93].forEach((n, i) => bell(b, i * 0.05, mtof(n), 1.3, 0.15, 2, 0.8));
    chord(b, 0, [62, 69, 74], 1, { attack: 0.3, release: 0.7, amp: 0.1 });
    return fin(b, 0.5, 0.5);
  },
};

// ============================================================================ music
// All tracks are seamless loops: notes wrap around the buffer end, and reverb is run twice.

const loopBuf = (bpm: number, beats: number) => ({ b: new Float32Array(Math.round((60 / bpm) * beats * SR)), beat: 60 / bpm });

function master(b: Float32Array, wet: number, peak: number): Float32Array {
  return normalize(reverb(b, wet, 0.86, 0.4, true), peak);
}

export const MUSIC: Record<string, Gen> = {
  // ---------------------------------------------------- title: slow lament in D minor
  title: () => {
    srand(101);
    const { b, beat } = loopBuf(60, 32);
    const prog = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
    prog.forEach((c, i) => {
      const t = i * 8 * beat;
      chord(b, t, c, 7.2 * beat, { wave: 'saw', detune: 8, lp: 650, attack: 2, release: 2.5, amp: 0.05 }, true);
      tone(b, t, 7.5 * beat, mtof(c[0] - 12), { attack: 1.5, release: 2, amp: 0.13 }, true);
      chord(b, t + beat, c.map((n) => n + 12), 6 * beat, { attack: 1.8, release: 2, amp: 0.025, vib: 5, vibDepth: 0.007 }, true);
    });
    const mel = [74, 72, 69, 70, 69, 65, 67, 69, 74, 77, 76, 74, 73, 74, 69, 0];
    mel.forEach((n, i) => n && bell(b, i * 2 * beat + 0.5 * beat, mtof(n), 3.5, 0.07, 1.41, 1.2, true));
    return master(b, 0.6, 0.55);
  },

  // ---------------------------------------------------- act 1: the Ossuary (D phrygian, plucked dread)
  act1: () => {
    srand(202);
    const { b, beat } = loopBuf(64, 64);
    const L = b.length / SR;
    tone(b, 0, L, mtof(38), { amp: 0.11, attack: 0.01, release: 0.01 }, true);
    tone(b, 0, L, mtof(45), { amp: 0.035, attack: 0.01, release: 0.01, vib: 0.2, vibDepth: 0.004 }, true);
    const prog = [[50, 53, 57], [51, 55, 58], [50, 53, 57], [48, 51, 55], [46, 50, 53], [51, 55, 58], [50, 53, 57], [45, 49, 52]];
    prog.forEach((c, i) => {
      const t = i * 8 * beat;
      chord(b, t, c, 7 * beat, { wave: 'saw', detune: 6, lp: 480, attack: 2.5, release: 3, amp: 0.035 }, true);
      for (let k = 0; k < 8; k++) {
        if (rnd() < 0.55) {
          const n = c[Math.floor(rnd() * 3)] + (rnd() < 0.3 ? 24 : 12);
          pluck(b, t + k * beat + (rnd() < 0.2 ? beat / 2 : 0), mtof(n), 2.5, 0.16, 0.997, true);
        }
      }
      if (i % 2 === 0) bell(b, t, mtof(c[0] + 24), 5, 0.045, 1.41, 1.5, true);
    });
    return master(b, 0.5, 0.5);
  },

  // ---------------------------------------------------- act 2: the Weeping Catacombs (C minor, water and choir)
  act2: () => {
    srand(303);
    const { b, beat } = loopBuf(52, 48);
    const L = b.length / SR;
    const bass = [36, 32, 29, 31];
    const chords = [[60, 63, 67], [56, 60, 63], [53, 56, 60], [55, 59, 62]];
    bass.forEach((n, i) => {
      const t = i * 12 * beat;
      tone(b, t, 11 * beat, mtof(n), { wave: 'saw', lp: 260, attack: 1.8, release: 2.5, amp: 0.16, vib: 4, vibDepth: 0.004 }, true);
      for (const c of chords[i]) tone(b, t + beat, 10 * beat, mtof(c), { attack: 2.5, release: 2.5, amp: 0.035, vib: 5.2, vibDepth: 0.008 }, true);
      for (const c of chords[i]) tone(b, t + 2 * beat, 9 * beat, mtof(c + 12), { attack: 3, release: 2.5, amp: 0.012, vib: 4.6, vibDepth: 0.01 }, true);
    });
    // drips
    for (let k = 0; k < Math.floor(L * 0.9); k++) {
      const t = rnd() * L;
      tone(b, t, 0.05, 1400 + rnd() * 1400, { sweep: 0.55, decay: 0.03, amp: 0.05 }, true);
    }
    for (let k = 0; k < 10; k++) pluck(b, rnd() * L, mtof([48, 51, 55, 58][Math.floor(rnd() * 4)]), 3, 0.1, 0.998, true);
    return master(b, 0.65, 0.5);
  },

  // ---------------------------------------------------- act 3: the Throne Below (E harmonic minor, cathedral organ)
  act3: () => {
    srand(404);
    const { b, beat } = loopBuf(50, 32);
    const prog = [[52, 55, 59], [48, 52, 55], [45, 48, 52], [47, 51, 54]];
    prog.forEach((c, i) => {
      const t = i * 8 * beat;
      for (const n of c) organ(b, t, 7.5 * beat, mtof(n), 0.035, true);
      organ(b, t, 7.5 * beat, mtof(c[0] - 24), 0.05, true);
      bell(b, t, mtof(40), 6, 0.06, 1.41, 2, true);
      bell(b, t + 4 * beat, mtof(52), 4, 0.03, 1.41, 2, true);
    });
    const mel = [71, 72, 71, 69, 67, 66, 64, 63, 64, 67, 71, 76, 75, 72, 71, 0];
    mel.forEach((n, i) => n && organ(b, i * 2 * beat, 1.8 * beat, mtof(n), 0.018, true));
    return master(b, 0.7, 0.5);
  },

  // ---------------------------------------------------- town: a broken music box in a dead square
  town: () => {
    srand(606);
    const { b, beat } = loopBuf(54, 32);
    const L = b.length / SR;
    tone(b, 0, L, mtof(45), { amp: 0.06, attack: 0.01, release: 0.01 }, true);
    const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]];
    prog.forEach((c, i) => {
      const t = i * 8 * beat;
      chord(b, t, c.map((n) => n - 12), 7.5 * beat, { wave: 'tri', lp: 700, attack: 1.5, release: 2, amp: 0.05 }, true);
      const mel = [c[2] + 12, c[1] + 12, c[0] + 12, c[1] + 12, c[2] + 12, c[2] + 24, c[1] + 12, 0];
      mel.forEach((n, k) => n && bell(b, t + k * beat, mtof(n) * (1 + (rnd() - 0.5) * 0.012), 2.2, 0.07, 3.0, 0.6, true));
    });
    for (let k = 0; k < 6; k++) tone(b, rnd() * L, 0.6, 0, { wave: 'noise', lp: 600, attack: 0.3, release: 0.5, amp: 0.03 }, true);
    return master(b, 0.55, 0.42);
  },

  // ---------------------------------------------------- wilds: wind across dead fields, a distant bell
  wilds: () => {
    srand(707);
    const { b, beat } = loopBuf(48, 32);
    const L = b.length / SR;
    for (let k = 0; k < 6; k++) {
      const t = (k / 6) * L;
      tone(b, t, L / 4, 0, { wave: 'noise', lp: 300 + rnd() * 500, attack: L / 9, release: L / 8, amp: 0.12 }, true);
    }
    tone(b, 0, L, mtof(38), { amp: 0.07, attack: 0.01, release: 0.01, vib: 0.1, vibDepth: 0.01 }, true);
    tone(b, 0, L, mtof(45), { amp: 0.03, attack: 0.01, release: 0.01, vib: 0.13, vibDepth: 0.01 }, true);
    for (let k = 0; k < 4; k++) bell(b, k * 8 * beat + 2 * beat, mtof([50, 53, 49, 50][k]), 6, 0.05, 1.41, 1.4, true);
    for (let k = 0; k < 7; k++) {
      const n = [62, 65, 64, 62, 60, 58, 57][k];
      pluck(b, (k * 4 + 1) * beat + rnd() * beat, mtof(n), 3, 0.08, 0.997, true);
    }
    return master(b, 0.55, 0.45);
  },

  // ---------------------------------------------------- abyss: a lullaby at the bottom of everything
  abyss: () => {
    srand(808);
    const { b, beat } = loopBuf(44, 32);
    const L = b.length / SR;
    tone(b, 0, L, mtof(28), { amp: 0.16, attack: 0.01, release: 0.01, vib: 0.07, vibDepth: 0.02 }, true);
    tone(b, 0, L, mtof(29), { amp: 0.06, attack: 0.01, release: 0.01 }, true);
    const lull = [64, 67, 69, 67, 64, 62, 60, 62, 64, 64, 62, 0, 60, 59, 57, 0];
    lull.forEach((n, i) => n && tone(b, i * 2 * beat, 1.6 * beat, mtof(n), { wave: 'tri', attack: 0.4, release: 1.2, amp: 0.035, vib: 5, vibDepth: 0.006 }, true));
    for (let k = 0; k < 8; k++) bell(b, k * 4 * beat, mtof(40 + (k % 2)), 6, 0.04, 1.06, 2, true);
    for (let k = 0; k < 12; k++) tone(b, rnd() * L, 1.5, 0, { wave: 'noise', lp: 200, attack: 0.6, release: 0.8, amp: 0.05 }, true);
    return master(b, 0.7, 0.5);
  },

  // ---------------------------------------------------- boss: war drums and dread (C minor, 140 bpm)
  boss: () => {
    srand(505);
    const { b, beat } = loopBuf(140, 64);
    const roots = [36, 32, 29, 31];
    const chords = [[60, 63, 67], [56, 60, 63], [53, 56, 60], [55, 59, 62]];
    const ost = [0, 0, 12, 0, 3, 0, 7, 6];
    for (let bar = 0; bar < 16; bar++) {
      const t = bar * 4 * beat;
      const sec = Math.floor(bar / 4);
      const root = roots[sec];
      for (const k of [0, 0.75, 2, 2.5]) kick(b, t + k * beat, 0.8, true);
      snare(b, t + beat, 0.35, true);
      snare(b, t + 3 * beat, 0.35, true);
      for (let e = 0; e < 8; e++) hat(b, t + e * 0.5 * beat, e % 2 ? 0.03 : 0.05, true);
      if (bar % 4 === 3) for (let s = 0; s < 8; s++) tom(b, t + 2 * beat + s * 0.25 * beat, s < 4 ? 110 : 82, 0.45, true);
      for (let e = 0; e < 8; e++) {
        const n = root + ost[e];
        tone(b, t + e * 0.5 * beat, 0.42 * beat, mtof(n), { wave: 'saw', lp: 520, decay: 0.18, amp: 0.2, release: 0.03 }, true);
      }
      for (const k of [1.5, 3.5]) for (const n of chords[sec]) tone(b, t + k * beat, 0.25 * beat, mtof(n), { wave: 'saw', detune: 12, lp: 1800, amp: 0.035, release: 0.05 }, true);
      if (bar % 4 === 0) {
        for (const n of [root + 12, root + 19]) tone(b, t, 15 * beat, mtof(n), { wave: 'saw', detune: 8, lp: 650, attack: 0.4, release: 0.8, amp: 0.06 }, true);
        if (bar >= 8) for (const n of chords[sec]) tone(b, t, 15 * beat, mtof(n + 12), { attack: 1, release: 1, amp: 0.025, vib: 5.5, vibDepth: 0.01 }, true);
      }
    }
    return master(b, 0.25, 0.6);
  },
};
