// Browser entry point: the same game core, drawn with sprites (world) and pixel text (interface).
import { Game } from '../game.ts';
import { Screen } from '../term.ts';
import { render, SW, LH } from '../render.ts';
import { KEYMAP, MOVE_KEYS } from '../keys.ts';
import { setSaveStore } from '../platform.ts';
import { TOOLS } from '../types.ts';
import { NPCS } from '../story.ts';
import { SpriteRenderer } from './sprite-renderer.ts';
import { WebAudio, AUDIO_MODE_NAMES } from './webaudio.ts';

const CW = 10, CH = 20; // text cell size in CSS pixels
const FONT = "16px 'Cascadia Mono', Consolas, 'Courier New', monospace";

setSaveStore({
  read: () => {
    try {
      return localStorage.getItem('ashen-deep-save');
    } catch {
      return null;
    }
  },
  write: (d) => {
    try {
      localStorage.setItem('ashen-deep-save', d);
    } catch {
      /* private mode: no saves */
    }
  },
});

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game((Math.random() * 2 ** 32) >>> 0);
game.webBuild = true;
const screen = new Screen();
const sprites = new SpriteRenderer();
const audio = new WebAudio();
game.audioLabel = AUDIO_MODE_NAMES[audio.mode];

// ------------------------------------------------------------------ the text layer (HUD, menus, title)
const ui = document.createElement('canvas');
const uctx = ui.getContext('2d')!;
let dpr = 1;
let prev: { ch: string[]; fg: Int32Array; bg: Int32Array; ly: Uint8Array } | null = null;
const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  const cols = Math.max(80, Math.floor(window.innerWidth / CW));
  const rows = Math.max(24, Math.floor(window.innerHeight / CH));
  canvas.width = cols * CW * dpr;
  canvas.height = rows * CH * dpr;
  canvas.style.width = `${cols * CW}px`;
  canvas.style.height = `${rows * CH}px`;
  ui.width = canvas.width;
  ui.height = canvas.height;
  screen.resize(cols, rows);
  prev = null;
}

function paintText(): void {
  const s = screen;
  const n = s.w * s.h;
  if (!prev || prev.ch.length !== n) prev = { ch: new Array(n).fill(''), fg: new Int32Array(n).fill(-1), bg: new Int32Array(n).fill(-1), ly: new Uint8Array(n).fill(9) };
  uctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  uctx.font = FONT;
  uctx.textAlign = 'center';
  uctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const ch = s.ch[i], fg = s.fg[i], bg = s.bg[i], ly = s.layers[i];
    if (prev.ch[i] === ch && prev.fg[i] === fg && prev.bg[i] === bg && prev.ly[i] === ly) continue;
    prev.ch[i] = ch;
    prev.fg[i] = fg;
    prev.bg[i] = bg;
    prev.ly[i] = ly;
    const x = (i % s.w) * CW, y = Math.floor(i / s.w) * CH;
    uctx.clearRect(x, y, CW, CH);
    // in the game world, everything that isn't interface is transparent: the sprites show through
    const worldMode = game.mode !== 'title' && game.mode !== 'ending' && !(game.mode === 'help' && game.helpReturn === 'title');
    if (worldMode && ly !== 0) continue;
    uctx.fillStyle = hex(bg);
    uctx.fillRect(x, y, CW, CH);
    if (ch === ' ') continue;
    uctx.fillStyle = hex(fg);
    if (ch === '█') uctx.fillRect(x, y, CW, CH);
    else if (ch === '▀') uctx.fillRect(x, y, CW, CH / 2);
    else if (ch === '▌') uctx.fillRect(x, y, CW / 2, CH);
    else uctx.fillText(ch, x + CW / 2, y + CH / 2 + 1);
  }
}

// ------------------------------------------------------------------ input
const ALIAS: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'esc', Enter: 'enter', Tab: 'inv' };
const held: string[] = [];
let dirty = true;

window.addEventListener('keydown', (e) => {
  audio.unlock(game.musicTrack());
  let name: string, raw: string;
  if (ALIAS[e.key]) {
    name = ALIAS[e.key];
    raw = e.key === 'Tab' ? '\t' : '';
  } else if (e.key.length === 1) {
    raw = e.key.toLowerCase();
    name = KEYMAP[raw] ?? raw;
  } else return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  e.preventDefault();
  if (raw === 'n' && game.mode !== 'confirmQuit' && game.mode !== 'read' && game.mode !== 'title') {
    game.audioLabel = AUDIO_MODE_NAMES[audio.cycleMode()];
    game.log(`Audio: ${game.audioLabel}`, 0x8a8478);
    dirty = true;
    return;
  }
  if (MOVE_KEYS.has(name) && game.mode === 'play') {
    // movement repeats from the game loop while held: no OS key-repeat delay
    if (e.repeat) return;
    const k = held.indexOf(name);
    if (k >= 0) held.splice(k, 1);
    held.push(name);
  }
  game.input(name, raw);
  dirty = true;
});
window.addEventListener('keyup', (e) => {
  const name = ALIAS[e.key] ?? KEYMAP[e.key.toLowerCase()];
  const k = held.indexOf(name);
  if (k >= 0) held.splice(k, 1);
});
window.addEventListener('blur', () => (held.length = 0));
window.addEventListener('resize', () => {
  resize();
  dirty = true;
});
canvas.addEventListener('mousedown', () => audio.unlock(game.musicTrack()));

// ------------------------------------------------------------------ debug start parameters (for screenshots/tests)
//   ?play            start a new game, skip the intro
//   &at=world:61,14  go somewhere            &tools=all      every tool
//   &level=12        level and talent points  &seed=123      fixed run seed
const q = new URLSearchParams(location.search);
if (q.has('seed')) game.seed = +q.get('seed')! >>> 0;
if (q.has('play')) {
  game.saveEnabled = false;
  game.newGame();
  game.modal = null;
  game.mode = 'play';
  if (q.get('tools') === 'all') game.player.tools = [...TOOLS];
  if (q.has('level')) {
    game.player.level = +q.get('level')!;
    game.player.talentPoints = +q.get('level')!;
  }
  const at = q.get('at');
  if (at) {
    const [key, xy] = at.split(':');
    const [x, y] = xy ? xy.split(',').map(Number) : [undefined, undefined];
    game.enterLocation(key, x !== undefined ? { x, y: y! } : undefined);
  }
  if (q.has('arena') && game.floor.bossRoom) {
    const r = game.floor.bossRoom;
    game.player.x = r.x + 3;
    game.player.y = r.y + 3;
    game.onPlayerEnter();
    const b = game.enemies.find((e) => e.boss);
    if (b) b.cd = 0;
  }
  if (q.has('talk')) game.talkTo(NPCS[q.get('talk')!]);
  if (q.has('menu')) game.mode = q.get('menu') as typeof game.mode;
  game.banner = null;
}

// ------------------------------------------------------------------ loop
resize();
let acc = 0;
let lastT = performance.now();
function frame(now: number): void {
  acc += Math.min(250, now - lastT);
  lastT = now;
  while (acc >= 50) {
    acc -= 50;
    if (game.mode === 'play' && held.length) game.input(held[held.length - 1], '');
    game.update();
    for (const id of game.sounds) audio.play(id);
    game.sounds.length = 0;
    audio.setMusic(game.musicTrack());
    if (game.quit) {
      game.quit = false;
      game.mode = 'title';
    }
    dirty = true;
  }
  if (dirty) {
    render(game, screen);
    paintText();
    dirty = false;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#070606';
  ctx.fillRect(0, 0, screen.w * CW, screen.h * CH);
  const inWorld = game.floor && game.mode !== 'title' && game.mode !== 'ending' && !(game.mode === 'help' && game.helpReturn === 'title');
  if (inWorld) {
    const vw = (screen.w - SW) * CW, vh = (screen.h - LH) * CH;
    try {
      sprites.draw(ctx, game, 0, 0, vw, vh, now);
    } catch (err) {
      // never let a drawing bug freeze the game; report it where it can be seen
      const msg = (err as Error).stack ?? String(err);
      if (document.title.indexOf('!') < 0) document.title = `The Ashen Deep ! ${msg.slice(0, 300)}`;
      console.error(err);
    }
    if (game.mode === 'dead') {
      ctx.fillStyle = `rgba(0,0,0,${0.7 * Math.min(1, game.deadT / 30)})`;
      ctx.fillRect(0, 0, vw, vh);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ui, 0, 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { game: Game }).game = game;
