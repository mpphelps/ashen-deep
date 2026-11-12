// Scripted checks that drive the real Game API through combat and the whole story path.
import { Game } from '../src/game.ts';
import { T, DIRS, type Enemy, type Obj, type Vec, type Floor } from '../src/types.ts';
import { Screen } from '../src/term.ts';
import { render } from '../src/render.ts';
import { NPCS, QUESTS } from '../src/story.ts';
import { PIT } from '../src/world.ts';
import { talentList, respec, useSkill } from '../src/skills.ts';

/** Cast immediately, as if the key were pressed with nothing else going on. */
function useSkillNow(g: Game, slot: number): void {
  g.player.act = null;
  g.player.sta = 200;
  useSkill(g, slot);
}

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  } else console.log('ok  ', msg);
};

function fresh(seed = 99): Game {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  g.mode = 'play';
  g.modal = null;
  return g;
}
const tick = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) g.update();
};
function runUntil(g: Game, pred: () => boolean, max = 400): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    g.update();
  }
  return pred();
}
/** Talk to an NPC and click through every page. */
function talk(g: Game, id: string): string[] {
  g.talkTo(NPCS[id]);
  const lines = g.dialog!.lines.slice();
  for (let i = 0; i < 20 && g.mode === 'dialog'; i++) g.input('enter', '');
  if (g.mode === 'shop') g.input('esc', '');
  return lines;
}
function stand(g: Game, x: number, y: number, face: Vec): void {
  g.player.x = x;
  g.player.y = y;
  g.player.face = face;
  g.player.act = null;
}
function closeModal(g: Game): void {
  if (g.mode === 'read') g.input('esc', '');
}
function confirmModal(g: Game): void {
  if (g.mode === 'read' && g.modal?.kind === 'confirm') g.input('enter', '');
}
function useTool(g: Game, tool: string): void {
  g.player.tool = ['spade', 'lantern', 'hook', 'bell'].indexOf(tool);
  g.player.act = null;
  g.player.sta = 100;
  g.useTool();
  closeModal(g);
}
/** Put the player in a cleared spot in a dungeon start room with a single enemy beside them. */
function duel(g: Game, def: string, key = 'd0f0'): Enemy {
  g.enterLocation(key);
  const f = g.floor;
  const r = f.rooms.find((rm) => rm.kind === 'start')!;
  const p = g.player;
  stand(g, r.x + 1, r.y + r.h - 2, { x: 1, y: 0 });
  f.objects = f.objects.filter((o) => Math.abs(o.x - p.x) > 2 || Math.abs(o.y - p.y) > 2);
  const e = g.makeEnemy(def, p.x + 1, p.y, false, 2);
  e.state = 'chase';
  e.aware = true;
  e.cd = 0;
  g.enemies = [e];
  return e;
}

// ===================================================================== combat fundamentals
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  ok(g.teles.length === 1 && g.teles[0].tiles[0].x === g.player.x, 'enemies telegraph the tile they will hit');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp < hp0, 'standing in the red gets you hurt');
}
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  g.input('left', '');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp === hp0, 'stepping off the red tile avoids the hit');
}
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  runUntil(g, () => g.teles[0]?.t === 3);
  g.player.face = { x: 0, y: -1 };
  g.input('roll', '');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp === hp0, 'a late roll passes through the attack');
}
{
  const g = fresh();
  const e = duel(g, 'hollow');
  runUntil(g, () => e.state === 'windup');
  runUntil(g, () => g.teles[0]?.t === 3);
  g.input('parry', '');
  runUntil(g, () => e.state !== 'windup', 20);
  ok(e.state === 'stagger' && e.riposte > 0, 'a timed parry staggers and opens a riposte');
  const hpBefore = e.hp;
  runUntil(g, () => !g.player.act, 30);
  g.input('attack', '');
  runUntil(g, () => e.hp < hpBefore || e.dead, 20);
  ok(e.dead || hpBefore - e.hp > 25, 'the riposte hits hard');
}
{
  const g = fresh();
  const e = duel(g, 'knight');
  e.state = 'idle';
  e.aware = false;
  e.face = { x: 1, y: 0 };
  const hp0 = e.hp;
  g.input('attack', '');
  runUntil(g, () => e.hp < hp0, 10);
  ok(hp0 - e.hp >= 20, `backstab on an unaware knight (${hp0 - e.hp})`);
}

// ===================================================================== the story path, start to finish
const g = fresh(4242);
const W = () => g.getFloor('world');
{
  const w = W();
  ok(g.floor.key === 'world' && g.player.x === w.start.x, 'a new game starts on the rim of the Pit');
  talk(g, 'sallow');
  ok(g.quest('main') === 1, 'Sallow gives the main quest');
  talk(g, 'gudrun');
  ok(g.quest('bridge') === 1, 'Gudrun asks for the Warden\'s chain');
  talk(g, 'harrow');
  ok(g.quest('harrow') === 1, 'Harrow asks you to put down his son');
  talk(g, 'pell');
  ok(g.quest('hearts') === 1, 'Pell wants hearts');
  // the spade in the hut
  const chest = w.objects.find((o) => o.loot === 'tool:spade')!;
  stand(g, chest.x, chest.y + 1, { x: 0, y: -1 });
  g.openChest(chest);
  closeModal(g);
  ok(g.player.tools.includes('spade'), 'the spade is in your old hut');
  // Wren's grave refuses the spade
  const wren = w.objects.find((o) => o.kind === 'grave' && o.name?.startsWith('WREN'))!;
  stand(g, wren.x, wren.y - 1, { x: 0, y: 1 });
  useTool(g, 'spade');
  ok(!wren.dug && g.msgs.at(-1)!.text.includes('Not again'), "you will not dig up Wren's grave again");
  // dig the Ossuary rubble
  stand(g, 61, 11, { x: 0, y: -1 });
  ok(g.tileAt(61, 10) === T.RUBBLE, 'the Ossuary is choked with rubble');
  useTool(g, 'spade');
  ok(g.tileAt(61, 10) === T.FLOOR, 'the spade clears it');
  g.floors.delete('world');
  ok(g.getFloor('world').tiles[10 * 120 + 61] === T.FLOOR, 'cleared rubble stays cleared after the world is rebuilt');
  g.enterLocation('world', { x: 61, y: 11 });
  // Little Tomas
  const tomas = g.enemies.find((e) => e.name === 'Little Tomas')!;
  ok(!!tomas, 'Little Tomas wanders the cemetery');
  g.hurtEnemy(tomas, 9999, 0, { fromPlayer: true });
  ok(g.quest('harrow') === 2, 'killing Tomas advances Harrow\'s quest');
  talk(g, 'harrow');
  ok(g.quest('harrow') === 3 && g.player.inv.some((i) => i.unique === 'oath'), "Harrow gives you his sword");
}

/** Solve every puzzle on the current floor through game actions, then take the key and the stairs. */
function clearFloor(): void {
  const f = g.floor;
  for (const pz of f.puzzles) {
    if (pz.solved) continue;
    if (pz.kind === 'braziers') {
      for (const idx of pz.order) g.lightBrazier(f.objects.find((o) => o.kind === 'brazier' && o.puzzle === pz.id && o.idx === idx)!);
    } else if (pz.kind === 'lights') {
      const runes = f.objects.filter((o) => o.kind === 'rune' && o.puzzle === pz.id).sort((a, b) => a.idx! - b.idx!);
      const n = pz.n, N = n * n;
      for (let m = 0; m < 1 << N; m++) {
        const lit = runes.map((r) => r.lit);
        for (let i = 0; i < N; i++) {
          if (!(m & (1 << i))) continue;
          const x = i % n, y = (i / n) | 0;
          for (const j of [i, x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) if (j >= 0) lit[j] = !lit[j];
        }
        if (lit.every(Boolean)) {
          for (let i = 0; i < N; i++) if (m & (1 << i)) g.stepRune(runes[i]);
          break;
        }
      }
    } else {
      // collapse the sokoban the cheap way: the solver test already proves solvability
      const bs = f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id);
      bs.forEach((b, i) => {
        b.x = pz.plates[i].x;
        b.y = pz.plates[i].y;
      });
      g.checkSokoban(pz, bs[0]);
    }
    closeModal(g);
  }
  for (const c of f.objects.filter((o) => o.kind === 'chest' && !o.open && o.loot?.startsWith('key'))) {
    g.openChest(c);
    closeModal(g);
  }
}
function unlockAndDescend(): void {
  const f = g.floor;
  const ld = f.lockedDoor;
  const out = DIRS.map((d) => ({ x: ld.x + d.x, y: ld.y + d.y, d })).find((v) => f.roomAt[v.y * f.w + v.x] !== f.exitRoom!.id && g.isWalkTile(f.tiles[v.y * f.w + v.x]))!;
  stand(g, out.x, out.y, { x: -out.d.x, y: -out.d.y });
  g.tryMove({ x: -out.d.x, y: -out.d.y });
}
function killBoss(): Enemy {
  const f = g.floor;
  const r = f.bossRoom!;
  stand(g, r.x + 1, r.y + 1, { x: 1, y: 0 });
  g.onPlayerEnter();
  const boss = g.enemies.find((e) => e.boss)!;
  let phased = false;
  for (let t = 0; t < 6000 && !boss.dead; t++) {
    g.player.hp = g.stats.maxHp;
    if (t % 40 === 0) g.hurtEnemy(boss, boss.maxHp * 0.04, 4, { fromPlayer: true });
    if (boss.phase) phased = true;
    g.update();
    if (g.mode === 'dead') g.respawn();
    if (g.mode !== 'play' && g.mode !== 'ending') g.mode = 'play';
    if (g.mode === 'ending') break;
  }
  ok(phased && boss.dead, `${boss.name}: telegraphs, phase two, and death`);
  return boss;
}
function grabStory(): void {
  for (const pk of g.floor.pickups.filter((p) => p.kind === 'lore' || p.kind === 'quest' || p.kind === 'tool')) {
    stand(g, pk.x, pk.y, g.player.face);
    g.onPlayerEnter();
    closeModal(g);
  }
}

// ---------------------------------------------------------------- the Ossuary
{
  stand(g, 61, 7, { x: 0, y: -1 });
  g.tryMove({ x: 0, y: -1 });
  confirmModal(g);
  ok(g.floor.key === 'd0f0', 'the entrance leads down into the Ossuary');
  const themed = g.floor.rooms.filter((r) => r.theme).length;
  ok(themed >= 3, `the Ossuary has themed rooms (${themed})`);
  grabStory();
  ok(g.hasQuestItem('agnes_ring'), "Agnes's ring is in the hall of sarcophagi");
  clearFloor();
  ok(g.player.tools.includes('lantern') && g.player.keys === 1, 'the first floor\'s puzzle yields the key and the Lantern');
  unlockAndDescend();
  ok(g.tileAt(g.floor.lockedDoor.x, g.floor.lockedDoor.y) === T.OPEN, 'the key opens the crypt-lock');
  const ex = g.floor.exitRoom!;
  stand(g, ex.x + (ex.w >> 1), ex.y + (ex.h >> 1) - 1, { x: 0, y: 1 });
  g.tryMove({ x: 0, y: 1 });
  confirmModal(g);
  ok(g.floor.key === 'd0f1', 'the stairs lead to the second floor');
  // the key vault is behind thorns
  const f = g.floor;
  let thorn: Vec | null = null;
  for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] === T.THORNS) thorn = { x: i % f.w, y: (i / f.w) | 0 };
  ok(!!thorn, 'the second floor gates its key behind thorns');
  const side = DIRS.find((d) => g.isWalkTile(g.tileAt(thorn!.x + d.x, thorn!.y + d.y)) && f.roomAt[(thorn!.y + d.y) * f.w + thorn!.x + d.x] < 0) ?? DIRS.find((d) => g.isWalkTile(g.tileAt(thorn!.x + d.x, thorn!.y + d.y)))!;
  stand(g, thorn!.x + side.x, thorn!.y + side.y, { x: -side.x, y: -side.y });
  useTool(g, 'lantern');
  ok(g.tileAt(thorn!.x, thorn!.y) === T.FLOOR, 'the lantern burns the thorns away');
  grabStory();
  ok(g.lore.includes('ribbon'), 'the yellow ribbon waits in the Small Ossuary');
  clearFloor();
  unlockAndDescend();
  killBoss();
  grabStory();
  ok(g.hasQuestItem('warden_chain') && g.lore.includes('warden_book'), 'the Warden drops his chain and his burial book');
  g.player.x = g.floor.bossRoom!.x + (g.floor.bossRoom!.w >> 1);
  g.player.y = g.floor.bossRoom!.y + (g.floor.bossRoom!.h >> 1) - 1;
  g.tryMove({ x: 0, y: 1 });
  confirmModal(g);
  ok(g.floor.key === 'world', 'the way up returns you to the surface');
}

// ---------------------------------------------------------------- back in town: bridge, ring
{
  talk(g, 'sallow');
  ok(g.quest('main') === 2, 'Sallow sends you to the Rotwood');
  talk(g, 'gudrun');
  ok(g.quest('bridge') === 2 && W().tiles.includes(T.BRIDGE) && !W().tiles.includes(T.BROKEN), 'Gudrun mends the bridge, live, in the world');
  talk(g, 'coyle');
  ok(g.quest('ring') === 2, 'Coyle gets Agnes\'s ring back');
  // buy from Pell
  g.player.ashes = 5000;
  const flasks = g.player.maxFlasks;
  g.openShop('pell');
  g.input('enter', '');
  g.input('esc', '');
  ok(g.player.maxFlasks === flasks + 1 && g.player.ashes === 4500, 'Pell sells rendered tallow');
}

// ---------------------------------------------------------------- the Rotwood thorns, the gorge, the bell
{
  const w = W();
  let thorn: Vec | null = null;
  for (let y = 51; y <= 53 && !thorn; y++) for (let x = 20; x < 40; x++) if (w.tiles[y * w.w + x] === T.THORNS) { thorn = { x, y }; break; }
  stand(g, thorn!.x + 2, thorn!.y, { x: -1, y: 0 });
  useTool(g, 'lantern');
  useTool(g, 'lantern');
  ok(w.tiles[thorn!.y * w.w + thorn!.x] === T.FLOOR && w.tiles[thorn!.y * w.w + thorn!.x - 1] === T.FLOOR, 'the lantern burns through the Rotwood thorns');
  // fast-forward the Rotwood with the hook given
  g.player.tools.push('hook');
  // cross the gorge at its narrowest
  let gx = -1;
  for (let x = 85; x < 110; x++) if (w.tiles[19 * w.w + x] === T.CHASM) { gx = x; break; }
  stand(g, gx - 1, 19, { x: 1, y: 0 });
  useTool(g, 'hook');
  ok(g.player.x > gx + 3, `the chain hook hauls you across the gorge (landed at x=${g.player.x})`);
  // the Pit needs the bell
  stand(g, PIT.x, PIT.y + PIT.r + 1, { x: 0, y: -1 });
  useTool(g, 'hook');
  ok(g.player.y === PIT.y + PIT.r + 1, 'the hook cannot reach the bottom of the Pit');
  g.player.tools.push('bell');
  useTool(g, 'bell');
  ok(g.resonance > 0, 'the bell resonates');
  for (let i = 0; i < 8; i++) {
    g.player.moveCd = 0;
    g.tryMove({ x: 0, y: -1 });
    closeModal(g);
  }
  ok(g.player.y < PIT.y + PIT.r, 'the phantom stair holds while the bell resonates');
  // let the resonance lapse mid-bridge: you fall
  const hp = g.player.hp;
  g.player.x = PIT.x;
  g.player.y = PIT.y + 5;
  g.player.lastSafe = { x: PIT.x, y: PIT.y + PIT.r + 1 };
  g.resonance = 1;
  g.player.iframes = 0;
  tick(g, 2);
  ok(g.player.hp < hp && g.player.y === PIT.y + PIT.r + 1, 'when the silence fades you fall and climb back out');
}

// ---------------------------------------------------------------- the last two bosses and the ending
{
  g.enterLocation('d2f1');
  killBoss();
  ok(g.bossDead('choir'), 'the Choir is silenced');
  g.enterLocation('d3f1');
  killBoss();
  ok(g.pendingEnding && g.quest('main') === 5, 'the Hollow King falls and the ending begins');
  runUntil(g, () => g.mode === 'ending', 200);
  g.input('', '2');
  ok(g.endingChoice === 'bury' && g.flags.has('ending:bury'), 'you can choose to bury her');
  const s = new Screen();
  s.resize(120, 34);
  render(g, s);
  ok(s.dump().includes("THE GRAVEDIGGER'S REST".split('').join(' ')), 'the ending is rendered');
}

// ---------------------------------------------------------------- death, bloodstains, respawn at the last flame
{
  const h = fresh(5);
  h.player.ashes = 321;
  h.enterLocation('world', { x: 57, y: 44 });
  const at = { x: h.player.x, y: h.player.y };
  h.hurtPlayer(9999, { unavoidable: true });
  ok(h.mode === 'dead', 'lethal damage kills you');
  tick(h, 120);
  ok(h.mode === 'play' && h.player.ashes === 0 && h.player.y === 58, 'you wake at the town flame with nothing');
  h.player.x = at.x - 1;
  h.player.y = at.y;
  h.tryMove({ x: 1, y: 0 });
  ok(h.player.ashes === 321, 'walking onto your bloodstain gets it back');
}

// ---------------------------------------------------------------- talents
{
  const learn = (h: Game, id: string): boolean => {
    const cols = talentList();
    h.mode = 'talents';
    h.talentCol = cols.findIndex((c) => c.some((t) => t.id === id));
    h.talentRow = cols[h.talentCol].findIndex((t) => t.id === id);
    h.input('enter', '');
    h.mode = 'play';
    return h.player.talents.includes(id);
  };
  const arena = (h: Game, def = 'hollow', dist = 1): Enemy => {
    const e = duel(h, def);
    e.x = h.player.x + dist;
    if (e.x !== h.player.x + 1) for (let k = 1; k <= dist; k++) h.floor.objects = h.floor.objects.filter((o) => !(o.x === h.player.x + k && o.y === h.player.y));
    h.player.face = { x: 1, y: 0 };
    return e;
  };

  const h = fresh(21);
  ok(h.player.talentPoints === 1, 'you start with one talent point and no talents');
  h.player.talentPoints = 20;
  ok(!learn(h, 'raise'), 'tier II is locked until two points are spent in its path');
  ok(learn(h, 'gravebolt') && learn(h, 'leech') && learn(h, 'raise'), 'spending two points in a path opens tier II');
  ok(h.player.slots[0] === 'gravebolt' && h.player.slots[1] === 'raise', 'learned actives bind themselves to U / O');

  // grave bolt: costs blood, hits at range, goes on cooldown
  let e = arena(h, 'hollow', 4);
  e.state = 'recover';
  e.t = 999;
  const hp0 = h.player.hp, ehp = e.hp;
  h.input('skill1', '');
  tick(h, 12);
  ok(h.player.hp < hp0 && e.hp < ehp && (h.player.cds.gravebolt ?? 0) > 0, `Grave Bolt costs blood (${hp0 - h.player.hp}), hits at range (${ehp - e.hp}), then cools down`);

  // raise the dead from a corpse; the thrall fights for you
  const f = h.floor;
  f.decal[(h.player.y - 1) * f.w + h.player.x] = 2;
  h.updateFov();
  h.player.cds = {};
  useSkillNow(h, 1);
  const thrall = h.enemies.find((x) => x.ally);
  ok(!!thrall, 'Raise the Dead turns a corpse into a thrall');
  const before = e.hp;
  for (let i = 0; i < 300 && !e.dead && e.hp === before; i++) {
    e.state = 'recover';
    e.t = 999;
    h.player.hp = h.stats.maxHp;
    h.update();
  }
  ok(e.hp < before || e.dead, 'the thrall attacks your enemies');
  ok(!h.enemies.some((x) => x.ally && x === h.target), 'you never target your own thrall');

  // ranger: an old bow, volleys
  const r = fresh(22);
  r.player.talentPoints = 20;
  learn(r, 'volley');
  const bow = r.player.inv.find((i) => i.base === 'bow');
  ok(!!bow, 'learning a Ranger talent hands you your old bow');
  e = arena(r, 'hollow', 3);
  e.state = 'recover';
  e.t = 999;
  useSkillNow(r, 0);
  ok(r.projs.length === 0, 'Volley needs a bow in your hands');
  r.player.eq.weapon = bow!;
  r.recalc();
  r.player.cds = {};
  useSkillNow(r, 0);
  ok(r.projs.filter((pr) => pr.friendly).length === 3, 'Volley looses three arrows');
  const eh = e.hp;
  tick(r, 15);
  ok(e.hp < eh, 'arrows hit at range');
  r.player.act = null;
  r.player.cds = {};
  const e2hp = e.hp;
  r.input('attack', '');
  tick(r, 15);
  ok(e.hp < e2hp || e.dead, 'a bow\'s basic attack shoots too');

  // cutpurse: smoke makes enemies lose you; the next hit is a backstab
  const c = fresh(23);
  c.player.talentPoints = 20;
  learn(c, 'shadow');
  learn(c, 'smoke');
  e = arena(c, 'knight', 1);
  ok(e.aware, 'the knight knows you are there');
  useSkillNow(c, 0);
  ok(e.state === 'idle' && !e.aware, 'Smoke Vial makes nearby enemies lose you');
  c.player.act = null;
  const kh = e.hp;
  c.input('attack', '');
  tick(c, 4);
  ok(c.msgs.some((m) => m.text.startsWith('BACKSTAB')) && kh - e.hp > 30, `...and the next blow is a backstab (${kh - e.hp})`);
  learn(c, 'twin');
  learn(c, 'step');
  ok(learn(c, 'venom'), 'four points in a path open tier III');
  ok(learn(c, 'cull'), 'the capstone costs two points');
  e.hp = e.maxHp * 0.15;
  c.player.act = null;
  c.input('attack', '');
  tick(c, 4);
  ok(e.dead, 'Cull finishes a weakened enemy outright');

  // disgraced: the shield takes most of a frontal blow, in stamina
  const d = fresh(24);
  d.player.talentPoints = 20;
  learn(d, 'shield');
  learn(d, 'iron');
  ok(d.stats.armor >= 10, 'Old Wounds adds armor');
  e = arena(d, 'hollow', 1);
  useSkillNow(d, 0);
  ok(d.player.guard, 'Raise Shield lifts your guard');
  const hpA = d.player.hp, staA = d.player.sta;
  d.hurtPlayer(40, { owner: e, parryable: true });
  ok(hpA - d.player.hp <= 12 && d.player.sta < staA, `a frontal blow mostly lands on the shield (${hpA - d.player.hp} HP, ${Math.round(staA - d.player.sta)} stamina)`);
  const hpB = d.player.hp;
  d.hurtPlayer(40, { from: { x: d.player.x - 3, y: d.player.y } });
  ok(hpB - d.player.hp > 20, 'blows from behind ignore the shield');
  learn(d, 'bash');
  d.player.guard = false;
  d.player.act = null;
  d.player.cds = {};
  e.state = 'chase';
  useSkillNow(d, 1);
  ok((e.state as string) === 'stagger', 'Shield Bash staggers');

  // respec
  const pts = d.player.talentPoints, spent = d.player.talents.length;
  d.player.ashes = 99999;
  respec(d);
  ok(d.player.talents.length === 0 && d.player.talentPoints === pts + spent, 'forgetting at a bonfire returns every point, for ashes');
}

// ---------------------------------------------------------------- the bestiary
{
  const h = fresh(31);
  ok(h.bestiary().length === 0, 'the bestiary starts empty');
  const e = duel(h, 'ghoul');
  h.updateFov();
  tick(h, 6);
  const entry = h.bestiary().find((b) => b.title === 'Ghoul');
  ok(!!entry && entry.text.includes('Lunge') && entry.text.includes('Killed: 0'), 'seeing a ghoul writes it into the bestiary, moves and all');
  ok(!h.bestiary().some((b) => b.title === 'Crypt Knight'), 'creatures you have not met stay hidden');
  h.hurtEnemy(e, 9999, 0, { fromPlayer: true });
  ok(h.bestiary().find((b) => b.title === 'Ghoul')!.text.includes('Killed: 1'), 'kills are counted');
  h.enterLocation('d0f1');
  const boss = h.enemies.find((x) => x.boss)!;
  h.player.x = boss.x;
  h.player.y = boss.y + 3;
  h.updateFov();
  h.setFlag('seen:warden');
  ok(h.bestiary().some((b) => b.title.includes('The Flayed Warden') && b.text.includes('Charge')), 'bosses get entries with their phase-two moves');
}

// ---------------------------------------------------------------- render every screen once
{
  const h = fresh(8);
  const s = new Screen();
  s.resize(120, 34);
  for (const m of ['play', 'inv', 'bonfire', 'travel', 'map', 'help', 'journal', 'confirmQuit', 'talents'] as const) {
    h.mode = m;
    render(h, s);
  }
  h.talkTo(NPCS.coyle);
  render(h, s);
  h.mode = 'play';
  h.openShop('coyle');
  render(h, s);
  ok(true, 'every screen renders without error');
  h.mode = 'play';
  h.enterLocation('world', { x: 61, y: 54 });
  render(h, s);
  const rows = s.dump().split('\n');
  const py = rows.findIndex((r) => r.includes('@'));
  console.log(rows.slice(Math.max(0, py - 9), py + 6).map((r) => r.slice(0, 90)).join('\n'));
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('MECHANICS OK');
