// Stages real game scenes through the Game API, renders them with the game's own renderer,
// and exports each frame buffer as HTML -> PNG (via headless Chrome/Edge).
//   node tools/screenshots.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Game } from '../src/game.ts';
import { Screen } from '../src/term.ts';
import { render } from '../src/render.ts';
import { makeItem, makeUnique } from '../src/loot.ts';
import { MAP_W } from '../src/dungeon.ts';
import { T, DIRS } from '../src/types.ts';

const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });
const COLS = 120, ROWS = 34;

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}
function esc(c: string): string {
  return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
}

function toHtml(s: Screen): string {
  // draw like a terminal: fixed cells on a canvas; full blocks become solid fills
  const cells: [string, string, string][] = [];
  for (let i = 0; i < s.w * s.h; i++) cells.push([s.ch[i], hex(s.fg[i]), hex(s.bg[i])]);
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#070606}</style>
<canvas id="c"></canvas><script>
const W=${s.w},H=${s.h},CW=10,CH=20,PAD=12,cells=${JSON.stringify(cells)};
const cv=document.getElementById('c');cv.width=W*CW+PAD*2;cv.height=H*CH+PAD*2;
const x=cv.getContext('2d');x.fillStyle='#070606';x.fillRect(0,0,cv.width,cv.height);
x.font="16px 'Cascadia Mono', Consolas, monospace";x.textBaseline='middle';x.textAlign='center';
cells.forEach(([ch,fg,bg],i)=>{const cx=PAD+(i%W)*CW,cy=PAD+Math.floor(i/W)*CH;
x.fillStyle=bg;x.fillRect(cx,cy,CW,CH);
if(ch==='█'){x.fillStyle=fg;x.fillRect(cx,cy,CW,CH);return;}
if(ch==='▀'){x.fillStyle=fg;x.fillRect(cx,cy,CW,CH/2);return;}
if(ch==='▌'){x.fillStyle=fg;x.fillRect(cx,cy,CW/2,CH);return;}
if(ch!==' '){x.fillStyle=fg;x.fillText(ch,cx+CW/2,cy+CH/2+1);}});
</script>`;
}

const browser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

function snap(g: Game, name: string): void {
  const s = new Screen();
  s.resize(COLS, ROWS);
  render(g, s);
  const html = path.join(OUT, `${name}.html`);
  fs.writeFileSync(html, toHtml(s));
  if (browser) {
    const png = path.join(OUT, `${name}.png`);
    spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--screenshot=${png}`, '--window-size=1224,704', 'file:///' + html.replace(/\\/g, '/'),
    ], { stdio: 'ignore' });
    fs.unlinkSync(html);
    console.log('wrote', png);
  } else console.log('wrote', html, '(no browser found for PNG)');
}

function game(seed: number): Game {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  g.msgs = [];
  return g;
}
function tick(g: Game, n: number): void {
  for (let i = 0; i < n; i++) g.update();
}
function reveal(g: Game, cells: { x: number; y: number }[]): void {
  const p = g.player;
  const ox = p.x, oy = p.y;
  for (const c of cells) {
    p.x = c.x;
    p.y = c.y;
    g.updateFov();
  }
  p.x = ox;
  p.y = oy;
  g.updateFov();
}
/** Walk outward from the player and reveal everything within `steps` (shows the maze, not just rooms). */
function explore(g: Game, steps: number): void {
  g.computeDist();
  const cells: { x: number; y: number }[] = [];
  for (let i = 0; i < g.dist.length; i++) if (g.dist[i] <= steps && i % 3 === 0) cells.push({ x: i % MAP_W, y: (i / MAP_W) | 0 });
  reveal(g, cells);
}
function roomCells(g: Game) {
  return g.floor.rooms.map((r) => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }));
}

// ------------------------------------------------------------------ 1. title
{
  const g = new Game(1);
  g.saveEnabled = false;
  for (let i = 0; i < 260; i++) g.update();
  snap(g, '1-title');
}

// ------------------------------------------------------------------ 2. exploring the ossuary
{
  const g = game(4242);
  const f = g.floor;
  // walk the corridors: reveal every room and some maze around the start
  explore(g, 70);
  g.enemies = g.enemies.filter((e) => Math.abs(e.x - g.player.x) > 6 || Math.abs(e.y - g.player.y) > 6);
  for (let i = 0; i < f.decal.length; i += 97) if (f.tiles[i] === T.FLOOR && g.vis[i] > 0) f.decal[i] = 1;
  g.player.ashes = 214;
  g.log('You wake in the cold. Something took your name. Go down, and take it back.', 0xd0a060);
  g.log('Scrawled in blood: "Strike from the dark. They never see it coming."', 0xe0a050);
  g.log('Found: Grief Fang (Rare Kris)', 0xffe04a);
  tick(g, 2);
  g.banner = null;
  snap(g, '2-explore');
}

// ------------------------------------------------------------------ 3. combat
{
  const g = game(31);
  g.enterFloor(5);
  g.msgs = [];
  const f = g.floor;
  const central = (rm: { x: number; y: number; w: number; h: number }) => Math.abs(rm.x + rm.w / 2 - 39) + Math.abs(rm.y + rm.h / 2 - 21);
  const r = f.rooms.filter((rm) => rm.kind !== 'boss' && rm.kind !== 'start' && rm.w >= 9 && rm.h >= 7).sort((a, b) => central(a) - central(b))[0];
  const p = g.player;
  p.x = r.x + 2;
  p.y = r.y + (r.h >> 1);
  f.objects = f.objects.filter((o) => !g.inRoom(o.x, o.y, r));
  g.enemies = [];
  const mk = (def: string, dx: number, dy: number, elite = false) => {
    const e = g.makeEnemy(def, p.x + dx, p.y + dy, elite);
    e.state = 'chase';
    e.aware = true;
    e.cd = 0;
    g.enemies.push(e);
    return e;
  };
  const ghoul = mk('ghoul', 1, 0);
  mk('flagellant', 0, 1, true);
  mk('cultist', 4, -1);
  mk('archer', 4, 2);
  explore(g, 90);
  for (let i = 0; i < f.decal.length; i += 53) if (f.tiles[i] === T.FLOOR && f.seen[i]) f.decal[i] = 1;
  f.decal[(p.y + 1) * MAP_W + p.x - 1] = 2;
  p.hp = 128;
  p.ashes = 1460;
  p.level = 6;
  p.eq.weapon = makeItem(g.rng, 5, 2, 'weapon', 'axe');
  g.recalc();
  p.face = { x: 1, y: 0 };
  tick(g, 6);
  g.hurtEnemy(ghoul, 31, 5, { fromPlayer: true, crit: true });
  g.log('Scrawled in blood: "If it glows red, get the hell out of the way."', 0xe0a050);
  g.log(`Found: ${p.eq.weapon!.name} (Rare ${p.eq.weapon!.baseName})`, 0xffe04a);
  for (let i = 0; i < 60 && g.teles.length < 3; i++) {
    g.update();
    p.hp = Math.max(p.hp, 90);
  }
  g.banner = null;
  snap(g, '3-combat');
}

// ------------------------------------------------------------------ 4. boss
{
  const g = game(77);
  g.enterFloor(3);
  g.msgs = [];
  const f = g.floor;
  const r = f.bossRoom!;
  const boss = g.enemies.find((e) => e.boss)!;
  g.enemies = [boss];
  g.player.x = f.lockedDoor.x;
  g.player.y = f.lockedDoor.y;
  explore(g, 40);
  g.player.x = r.x + 3;
  g.player.y = r.y + 2;
  g.onPlayerEnter();
  g.banner = null;
  g.player.level = 8;
  g.player.eq.weapon = makeUnique(g.rng, 'grudge', 3);
  g.recalc();
  g.player.hp = g.stats.maxHp * 0.55;
  boss.hp = boss.maxHp * 0.62;
  boss.cd = 0;
  for (let i = 0; i < 400; i++) {
    g.update();
    g.player.hp = Math.max(g.player.hp, g.stats.maxHp * 0.5);
    const t = g.teles[0];
    if (t && t.tiles.length > 12 && t.t < t.max * 0.5) break;
  }
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if ((x * 7 + y * 13) % 11 === 0) f.decal[y * MAP_W + x] = 1;
  g.msgs = [];
  g.log('It wears the skins of those who came before you. There is room for one more.', 0xd08060);
  g.log('Scrawled in blood: "Parry the slow ones. Run from the big ones."', 0xe0a050);
  g.banner = null;
  snap(g, '4-boss');
}

// ------------------------------------------------------------------ 5. puzzle
{
  let done = false;
  for (let seed = 1; seed < 200 && !done; seed++) {
    const g = game(seed);
    const f = g.floor;
    const pz = f.puzzles.find((p) => p.kind === 'braziers' && p.order.length === 3);
    if (!pz) continue;
    const r = pz.room;
    g.enemies = [];
    const tablet = f.objects.find((o) => o.kind === 'tablet' && o.puzzle === pz.id)!;
    const spot = DIRS.map((d) => ({ x: tablet.x + d.x, y: tablet.y + d.y })).find((v) => f.tiles[v.y * MAP_W + v.x] === T.FLOOR && !g.objAt(v.x, v.y))!;
    g.player.x = spot.x;
    g.player.y = spot.y;
    const first = f.objects.find((o) => o.kind === 'brazier' && o.puzzle === pz.id && o.idx === pz.order[0])!;
    g.lightBrazier(first);
    explore(g, 30);
    g.msgs = [];
    g.log('Scrawled in blood: "Read the stone first"', 0xe0a050);
    g.log(`The ${first.cname} brazier catches with a hungry roar.`, first.color);
    tick(g, 3);
    g.banner = null;
    g.useObject(tablet);
    snap(g, '5-puzzle');
    done = true;
  }
}

// ------------------------------------------------------------------ 6. inventory
{
  const g = game(9);
  g.enterFloor(6);
  const p = g.player;
  p.eq.weapon = makeItem(g.rng, 6, 2, 'weapon', 'sword');
  p.eq.helm = makeItem(g.rng, 5, 1, 'helm');
  p.eq.chest = makeItem(g.rng, 6, 2, 'chest');
  p.eq.ring = makeUnique(g.rng, 'ninth', 4);
  p.eq.amulet = makeItem(g.rng, 5, 1, 'amulet');
  p.inv = [
    makeUnique(g.rng, 'mourning', 6),
    makeItem(g.rng, 6, 2, 'weapon', 'spear'),
    makeItem(g.rng, 6, 1, 'helm'),
    makeItem(g.rng, 5, 0, 'chest'),
    makeItem(g.rng, 6, 2, 'ring'),
    makeItem(g.rng, 6, 1, 'weapon', 'dagger'),
    makeUnique(g.rng, 'crown', 6),
    makeItem(g.rng, 4, 0, 'weapon', 'mace'),
    makeItem(g.rng, 6, 1, 'amulet'),
  ];
  g.recalc();
  g.mode = 'inv';
  g.invSel = 5;
  g.banner = null;
  snap(g, '6-inventory');
}
