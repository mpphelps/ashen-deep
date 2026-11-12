// Entry point: raw keyboard input + 20 FPS game loop.
import { Game } from './game.ts';
import { Screen } from './term.ts';
import { render } from './render.ts';
import { Audio, ensureCache, AUDIO_MODE_NAMES } from './audio/audio.ts';

const out = process.stdout;
const stdin = process.stdin;

if (!stdin.isTTY || !out.isTTY) {
  console.error('The Ashen Deep must be run in an interactive terminal.');
  process.exit(1);
}

const game = new Game((Math.random() * 2 ** 32) >>> 0);
const screen = new Screen();

// ---- audio: synthesize the WAV cache on first run, then start the platform player
const audio = new Audio();
if (!process.argv.includes('--no-audio')) {
  if (ensureCache((msg) => console.log(msg))) audio.start();
  if (process.argv.includes('--mute')) audio.mode = 2;
}
game.audioLabel = AUDIO_MODE_NAMES[audio.mode];

const KEYMAP: Record<string, string> = {
  w: 'up', s: 'down', a: 'left', d: 'right',
  j: 'attack', x: 'attack', k: 'heavy', c: 'heavy',
  ' ': 'roll', q: 'parry', l: 'parry', f: 'flask', e: 'interact',
  i: 'inv', '\t': 'inv', m: 'map', '?': 'help', h: 'help',
  '\r': 'enter', '\n': 'enter',
};

function parseKeys(data: string): [string, string][] {
  const keys: [string, string][] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === '\x03') {
      keys.push(['ctrl-c', '']);
      i++;
      continue;
    }
    if (c === '\x1b') {
      const n = data[i + 1];
      if (n === '[' || n === 'O') {
        let j = i + 2;
        while (j < data.length && /[0-9;]/.test(data[j])) j++;
        const fin = data[j];
        const arrows: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left' };
        if (fin && arrows[fin]) keys.push([arrows[fin], '']);
        i = j + 1;
        continue;
      }
      keys.push(['esc', '']);
      i++;
      continue;
    }
    const raw = c.toLowerCase();
    keys.push([KEYMAP[raw] ?? raw, raw]);
    i++;
  }
  return keys;
}

let cleaned = false;
function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  audio.close();
  try {
    stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
  out.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l');
}

function quit(code = 0): void {
  if (game.mode !== 'title') game.save();
  cleanup();
  process.exit(code);
}

process.on('uncaughtException', (err) => {
  cleanup();
  console.error('The Deep collapsed:', err);
  process.exit(1);
});
process.on('SIGINT', () => quit());

out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J');
stdin.setRawMode(true);
stdin.setEncoding('utf8');
stdin.resume();
stdin.on('data', (data: string) => {
  for (const [k, raw] of parseKeys(data)) {
    if (k === 'ctrl-c') return quit();
    if (raw === 'n' && game.mode !== 'confirmQuit' && game.mode !== 'read') {
      game.audioLabel = AUDIO_MODE_NAMES[audio.cycleMode()];
      game.log(`Audio: ${game.audioLabel}`, 0x8a8478);
      continue;
    }
    game.input(k, raw);
  }
});
out.on('resize', () => {
  screen.full = true;
});

function frame(): void {
  const w = out.columns || 120, h = out.rows || 34;
  if (w !== screen.w || h !== screen.h) {
    screen.resize(w, h);
    out.write('\x1b[2J');
  }
  game.update();
  if (game.quit) return quit();
  for (const id of game.sounds) audio.play(id);
  game.sounds.length = 0;
  audio.music(game.musicTrack());
  render(game, screen);
  const s = screen.flush();
  if (s) out.write(s);
}

setInterval(frame, 50);
frame();
