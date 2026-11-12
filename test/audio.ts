// Renders every sound and music track and checks they are sane (no NaN, no silence, no clipping).
import { SFX, MUSIC } from '../src/audio/sounds.ts';
import { SR } from '../src/audio/synth.ts';

let failures = 0;
const t0 = Date.now();
for (const [kind, table] of [['sfx', SFX], ['music', MUSIC]] as const) {
  for (const [name, gen] of Object.entries(table)) {
    const t = Date.now();
    const b = gen();
    let peak = 0, rms = 0, bad = 0;
    for (const v of b) {
      if (!Number.isFinite(v)) bad++;
      peak = Math.max(peak, Math.abs(v));
      rms += v * v;
    }
    rms = Math.sqrt(rms / b.length);
    const ok = bad === 0 && peak > 0.05 && peak <= 1;
    if (!ok) failures++;
    if (kind === 'music' || !ok)
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${kind} ${name.padEnd(10)} ${(b.length / SR).toFixed(1)}s peak ${peak.toFixed(2)} rms ${rms.toFixed(3)} (${Date.now() - t}ms)`);
  }
}
// seamless loop check: music start and end samples should be close
for (const [name, gen] of Object.entries(MUSIC)) {
  const b = gen();
  const jump = Math.abs(b[0] - b[b.length - 1]);
  if (jump > 0.15) { failures++; console.log(`FAIL loop seam ${name}: jump ${jump.toFixed(3)}`); }
}
console.log(`${Object.keys(SFX).length} sfx + ${Object.keys(MUSIC).length} tracks rendered in ${Date.now() - t0}ms`);
if (failures) { console.error(`${failures} audio failure(s)`); process.exit(1); }
console.log('AUDIO OK');
