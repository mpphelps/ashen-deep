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
import { T, DIRS } from '../src/types.ts';
import { NPCS } from '../src/story.ts';

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
  g.mode = 'play';
  g.modal = null;
  g.msgs = [];
  return g;
}
function tick(g: Game, n: number): void {
  for (let i = 0; i < n; i++) g.update();
}
/** Stand at many walkable cells near the player to reveal the surroundings (maps, corridors). */
function explore(g: Game, steps: number, every = 3): void {
  const p = g.player;
  const ox = p.x, oy = p.y;
  g.computeDist();
  const W = g.floor.w;
  for (let i = 0; i < g.dist.length; i++) {
    if (g.dist[i] > steps || i % every) continue;
    p.x = i % W;
    p.y = (i / W) | 0;
    g.updateFov();
  }
  p.x = ox;
  p.y = oy;
  g.updateFov();
}

// ------------------------------------------------------------------ 1. title
{
  const g = new Game(1);
  g.saveEnabled = false;
  tick(g, 260);
  snap(g, '1-title');
}

// ------------------------------------------------------------------ 2. Hollowmere, and the welcome you get
{
  const g = game(4242);
  g.enterLocation('world', { x: 47, y: 55 });
  g.player.face = { x: 0, y: -1 };
  explore(g, 14, 2);
  g.banner = null;
  g.msgs = [];
  g.log('You crawl out of the Pit. The town of Hollowmere lies south.', 0xd0a060);
  g.log('Scrawled in blood: "Welcome home, Digger"', 0xe0a050);
  tick(g, 3);
  g.talkTo(NPCS.sallow);
  g.dialog!.page = 1;
  snap(g, '2-hollowmere');
}

// ------------------------------------------------------------------ 3. the cemetery
{
  const g = game(4242);
  g.player.tools = ['spade'];
  g.player.tool = 0;
  g.enterLocation('world', { x: 61, y: 14 });
  g.player.face = { x: 0, y: -1 };
  explore(g, 22, 2);
  const tomas = g.enemies.find((e) => e.name === 'Little Tomas');
  if (tomas) {
    g.target = tomas;
    g.targetT = 999;
  }
  for (const e of g.enemies) if (Math.abs(e.x - 61) < 14 && Math.abs(e.y - 12) < 8) { e.aware = true; e.state = 'chase'; }
  g.banner = null;
  g.log('Harrow: "He\'ll be by the old yew. He always liked the yew."', 0x8ab070);
  g.log('Rubble. Your spade could shift it. [R]', 0xb0a080);
  tick(g, 6);
  g.banner = null;
  snap(g, '3-cemetery');
}

// ------------------------------------------------------------------ 4. the Rotwood Hollow
{
  const g = game(31);
  g.player.tools = ['spade', 'lantern'];
  g.player.tool = 1;
  g.enterLocation('d1f0');
  const f = g.floor;
  const r = f.rooms.filter((rm) => rm.theme && rm.w >= 7).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const p = g.player;
  p.x = r.x + 2;
  p.y = r.y + (r.h >> 1);
  while (g.blockObjAt(p.x, p.y)) p.x++;
  g.enemies = [];
  const mk = (def: string, dx: number, dy: number, elite = false) => {
    if (g.blockObjAt(p.x + dx, p.y + dy) || g.isOpaque(p.x + dx, p.y + dy)) return;
    const e = g.makeEnemy(def, p.x + dx, p.y + dy, elite, 4);
    e.state = 'chase';
    e.aware = true;
    e.cd = 0;
    g.enemies.push(e);
  };
  mk('hound', 1, 0);
  mk('hound', 1, 1);
  mk('ghoul', 3, -1, true);
  mk('bloated', 4, 1);
  explore(g, 60);
  p.level = 9;
  p.eq.weapon = makeUnique(g.rng, 'lament', 5);
  g.recalc();
  p.face = { x: 1, y: 0 };
  g.onPlayerEnter();
  g.banner = null;
  for (let i = 0; i < 40 && g.teles.length < 2; i++) {
    g.update();
    p.hp = Math.max(p.hp, 120);
  }
  g.hurtEnemy(g.enemies[0], 40, 5, { fromPlayer: true, crit: true });
  g.banner = null;
  snap(g, '4-rotwood');
}

// ------------------------------------------------------------------ 5. the Choir
{
  const g = game(77);
  g.player.tools = ['spade', 'lantern', 'hook', 'bell'];
  g.player.tool = 3;
  g.enterLocation('d2f1');
  const f = g.floor;
  const r = f.bossRoom!;
  const boss = g.enemies.find((e) => e.boss)!;
  g.enemies = [boss];
  g.player.x = f.lockedDoor.x;
  g.player.y = f.lockedDoor.y;
  explore(g, 30);
  g.player.x = r.x + 4;
  g.player.y = r.y + 3;
  g.onPlayerEnter();
  g.banner = null;
  g.player.level = 14;
  g.player.eq.weapon = makeUnique(g.rng, 'oath', 6);
  g.recalc();
  g.player.hp = g.stats.maxHp * 0.6;
  boss.hp = boss.maxHp * 0.7;
  boss.cd = 0;
  for (let i = 0; i < 600; i++) {
    if (boss.state === 'chase') boss.cd = 0;
    g.update();
    g.player.hp = Math.max(g.player.hp, g.stats.maxHp * 0.55);
    if (g.teles.length >= 3 && g.teles[0].t < g.teles[0].max * 0.5) break;
  }
  g.banner = null;
  snap(g, '5-choir');
}

// ------------------------------------------------------------------ 6. the journal
{
  const g = game(9);
  for (const id of ['ledger', 'letter', 'ribbon', 'warden_book', 'receipt', 'drawing', 'psalter']) g.giveLore(id);
  g.setQuest('main', 3);
  g.setQuest('bridge', 2);
  g.setQuest('harrow', 3);
  g.setQuest('doll', 2);
  g.setQuest('psalter', 1);
  g.setQuest('hearts', 1);
  g.questItems.hollow_heart = 3;
  g.mode = 'journal';
  g.journalTab = 1;
  g.journalSel = 2;
  snap(g, '6-journal');
}

// ------------------------------------------------------------------ 7. the world map
{
  const g = game(4242);
  g.player.tools = ['spade', 'lantern', 'hook'];
  g.setFlag('bridge');
  g.floors.clear();
  g.enterLocation('world', { x: 61, y: 52 });
  g.floor.seen.fill(1);
  g.mode = 'map';
  snap(g, '7-map');
}
