// Scripted mechanic checks that drive the real Game API.
import { Game } from '../src/game.ts';
import { MAP_W } from '../src/dungeon.ts';
import { T, DIRS, type Enemy, type Obj } from '../src/types.ts';
import { Screen } from '../src/term.ts';
import { render } from '../src/render.ts';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  } else console.log('ok  ', msg);
};

function fresh(seed = 99, depth = 1): Game {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  if (depth > 1) g.enterFloor(depth);
  g.enemies = [];
  return g;
}

/** Put the player in an open spot inside the start room with a lone enemy beside them. */
function duel(g: Game, def: string): Enemy {
  const p = g.player;
  const r = g.floor.rooms.find((rm) => rm.kind === 'start')!;
  p.x = r.x + 1;
  p.y = r.y + 1;
  g.floor.objects = g.floor.objects.filter((o) => !(Math.abs(o.x - p.x) <= 2 && Math.abs(o.y - p.y) <= 2));
  const e = g.makeEnemy(def, p.x + 1, p.y, false);
  e.state = 'chase';
  e.aware = true;
  e.cd = 0;
  g.enemies = [e];
  p.face = { x: 1, y: 0 };
  return e;
}

function runUntil(g: Game, pred: () => boolean, max = 400): boolean {
  for (let i = 0; i < max; i++) {
    if (pred()) return true;
    g.update();
  }
  return pred();
}

// ---------------------------------------------------------------- telegraph hits if you stand still
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  ok(g.teles.length === 1 && g.teles[0].tiles[0].x === g.player.x, 'hollow telegraphs the player tile');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp < hp0, `standing still gets you hit (${hp0} -> ${Math.round(g.player.hp)})`);
}

// ---------------------------------------------------------------- stepping out of a telegraph dodges
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  g.input('left', '');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp === hp0, 'stepping off the red tile avoids the hit');
}

// ---------------------------------------------------------------- roll i-frames
{
  const g = fresh();
  const e = duel(g, 'hollow');
  const hp0 = g.player.hp;
  runUntil(g, () => e.state === 'windup');
  runUntil(g, () => g.teles[0]?.t === 3);
  g.player.face = { x: 0, y: 1 };
  g.input('roll', '');
  runUntil(g, () => e.state === 'recover');
  ok(g.player.hp === hp0, 'rolling late through the attack avoids damage');
}

// ---------------------------------------------------------------- parry + riposte
{
  const g = fresh();
  const e = duel(g, 'hollow');
  runUntil(g, () => e.state === 'windup');
  runUntil(g, () => g.teles[0]?.t === 3);
  g.input('parry', '');
  runUntil(g, () => e.state !== 'windup', 20);
  ok(e.state === 'stagger' && e.riposte > 0, 'well-timed parry staggers the enemy and opens a riposte');
  const hpBefore = e.hp;
  runUntil(g, () => !g.player.act, 30);
  g.input('attack', '');
  runUntil(g, () => e.hp < hpBefore || e.dead, 20);
  ok(e.dead || hpBefore - e.hp > 25, `riposte hits hard (${hpBefore} -> ${e.dead ? 'dead' : e.hp})`);
}

// ---------------------------------------------------------------- backstab on unaware enemy
{
  const g = fresh();
  const e = duel(g, 'knight');
  e.state = 'idle';
  e.aware = false;
  e.face = { x: 1, y: 0 }; // facing away from player
  const hp0 = e.hp;
  g.input('attack', '');
  runUntil(g, () => e.hp < hp0, 10);
  ok(hp0 - e.hp >= 20, `backstab on unaware knight deals big damage (${hp0 - e.hp})`);
}

// ---------------------------------------------------------------- knight shield
{
  const g = fresh(5, 3);
  const e = duel(g, 'knight');
  e.face = { x: -1, y: 0 }; // facing the player
  e.state = 'recover';
  e.t = 100;
  const hp0 = e.hp;
  g.player.eq.weapon!.dmgMin = g.player.eq.weapon!.dmgMax = 20;
  g.input('attack', '');
  runUntil(g, () => e.hp < hp0, 10);
  ok(hp0 - e.hp <= 10, `knight shield blocks most frontal damage (${hp0 - e.hp} of ~20)`);
}

// ---------------------------------------------------------------- heavy breaks cracked walls
{
  let tested = false;
  for (let s = 1; s < 40 && !tested; s++) {
    const g = fresh(s);
    const f = g.floor;
    if (!f.secretRoom) continue;
    for (let i = 0; i < f.tiles.length && !tested; i++) {
      if (f.tiles[i] !== T.CRACKED) continue;
      const cx = i % MAP_W, cy = (i / MAP_W) | 0;
      for (const d of DIRS) {
        const px = cx - d.x, py = cy - d.y;
        if (f.tiles[py * MAP_W + px] !== T.FLOOR || f.roomAt[py * MAP_W + px] >= 0) continue;
        g.player.x = px;
        g.player.y = py;
        g.player.face = { x: d.x, y: d.y };
        g.input('heavy', '');
        runUntil(g, () => f.tiles[i] !== T.CRACKED, 20);
        ok(f.tiles[i] === T.FLOOR, 'heavy attack breaks a cracked wall into a secret room');
        tested = true;
        break;
      }
    }
  }
  ok(tested, 'found a cracked wall to test');
}

// ---------------------------------------------------------------- puzzles solved through gameplay
function solveOn(g: Game): string[] {
  const f = g.floor;
  const solved: string[] = [];
  for (const pz of f.puzzles) {
    if (pz.kind === 'braziers') {
      for (const idx of pz.order) {
        const b = f.objects.find((o) => o.kind === 'brazier' && o.puzzle === pz.id && o.idx === idx)!;
        g.lightBrazier(b);
      }
    } else if (pz.kind === 'lights') {
      // brute-force a pressing pattern (2^9 or 2^16) then step on those runes
      const runes = f.objects.filter((o) => o.kind === 'rune' && o.puzzle === pz.id).sort((a, b) => a.idx! - b.idx!);
      const n = pz.n;
      const N = n * n;
      let pattern = -1;
      for (let m = 0; m < 1 << N && pattern < 0; m++) {
        const lit = runes.map((r) => r.lit);
        for (let i = 0; i < N; i++) {
          if (!(m & (1 << i))) continue;
          const x = i % n, y = (i / n) | 0;
          const fl = (j: number) => (lit[j] = !lit[j]);
          fl(i);
          if (x > 0) fl(i - 1);
          if (x < n - 1) fl(i + 1);
          if (y > 0) fl(i - n);
          if (y < n - 1) fl(i + n);
        }
        if (lit.every(Boolean)) pattern = m;
      }
      for (let i = 0; i < N; i++) if (pattern & (1 << i)) g.stepRune(runes[i]);
    } else {
      // sokoban: teleport-push using BFS over pushes
      solveSokobanInGame(g, pz.id);
    }
    if (pz.solved) solved.push(pz.kind);
  }
  return solved;
}

function solveSokobanInGame(g: Game, pid: number): void {
  const f = g.floor;
  const pz = f.puzzles[pid];
  const boulders = () => f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pid);
  // simple search over boulder configurations; player position is ignored (teleport), the
  // generator guarantees a legal push sequence exists, so a pure push-search will find one.
  type S = { pos: [number, number][]; path: [number, number][] };
  const key = (pos: [number, number][]) => pos.map((p) => p.join(',')).sort().join('|');
  const start: S = { pos: boulders().map((b) => [b.x, b.y]), path: [] };
  const seen = new Set([key(start.pos)]);
  const q = [start];
  const r = pz.room;
  const free = (x: number, y: number, pos: [number, number][]) =>
    x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && f.tiles[y * MAP_W + x] === T.FLOOR &&
    !f.noBoulder[y * MAP_W + x] && !pos.some((p) => p[0] === x && p[1] === y) &&
    !f.objects.some((o) => o.x === x && o.y === y && (o.kind === 'tablet'));
  while (q.length) {
    const s = q.shift()!;
    if (pz.plates.every((pl) => s.pos.some((p) => p[0] === pl.x && p[1] === pl.y))) {
      for (const [bi, di] of s.path) {
        const b = boulders().sort((a, c) => a.id - c.id)[bi];
        const d = DIRS[di];
        g.player.x = b.x - d.x;
        g.player.y = b.y - d.y;
        g.enemies = [];
        g.tryMove(d);
      }
      return;
    }
    if (seen.size > 200000) return;
    s.pos.forEach((p, bi) => {
      DIRS.forEach((d, di) => {
        const tx = p[0] + d.x, ty = p[1] + d.y, px = p[0] - d.x, py = p[1] - d.y;
        if (!free(tx, ty, s.pos)) return;
        if (f.tiles[py * MAP_W + px] === T.WALL || s.pos.some((o) => o[0] === px && o[1] === py)) return;
        const np = s.pos.map((o, k) => (k === bi ? [tx, ty] : o)) as [number, number][];
        const k = key(np);
        if (seen.has(k)) return;
        seen.add(k);
        q.push({ pos: np, path: [...s.path, [bi, di]] });
      });
    });
  }
}

{
  const tally: Record<string, number> = {};
  let floors = 0, keyFlows = 0;
  for (let s = 1; s <= 25; s++) {
    const g = fresh(s * 13);
    floors++;
    const f = g.floor;
    const kinds = solveOn(g);
    for (const k of kinds) tally[k] = (tally[k] ?? 0) + 1;
    if (kinds.length !== f.puzzles.length) ok(false, `seed ${s}: solved ${kinds.join(',')} of ${f.puzzles.map((p) => p.kind).join(',')}`);
    // open the key chest, take the key, open the door, take the stairs
    const chest = f.objects.find((o: Obj) => o.kind === 'chest' && o.loot === 'key');
    if (!chest) continue;
    const spot = DIRS.map((d) => ({ x: chest.x + d.x, y: chest.y + d.y })).find((v) => g.isWalkTile(f.tiles[v.y * MAP_W + v.x]) && !g.blockObjAt(v.x, v.y))!;
    g.player.x = spot.x;
    g.player.y = spot.y;
    g.openChest(chest);
    if (g.player.keys !== 1) continue;
    const ld = f.lockedDoor;
    const outside = DIRS.map((d) => ({ x: ld.x + d.x, y: ld.y + d.y, d })).find((v) => f.roomAt[v.y * MAP_W + v.x] !== f.exitRoom.id && g.isWalkTile(f.tiles[v.y * MAP_W + v.x]))!;
    g.player.x = outside.x;
    g.player.y = outside.y;
    g.tryMove({ x: -outside.d.x, y: -outside.d.y });
    if (f.tiles[ld.y * MAP_W + ld.x] !== T.OPEN) continue;
    const ex = f.exitRoom;
    g.player.x = ex.x + (ex.w >> 1);
    g.player.y = ex.y + (ex.h >> 1) - 1;
    g.tryMove({ x: 0, y: 1 });
    if (g.mode === 'read' && g.modal?.kind === 'stairs') g.input('enter', '');
    if (g.depth === 2) keyFlows++;
  }
  ok(Object.keys(tally).length === 3, `all three puzzle types solved in-game: ${JSON.stringify(tally)}`);
  ok(keyFlows === floors, `puzzle -> key chest -> locked door -> stairs works (${keyFlows}/${floors})`);
}

// ---------------------------------------------------------------- boss fight end to end
for (const depth of [3, 6, 9]) {
  const g = fresh(77, depth);
  g.spawnEnemies();
  const f = g.floor;
  const boss = g.enemies.find((e) => e.boss)!;
  const r = f.bossRoom!;
  g.enemies = [boss];
  g.player.x = r.x + 1;
  g.player.y = r.y + 1;
  g.onPlayerEnter();
  ok(g.bossActive && f.tiles[f.lockedDoor.y * MAP_W + f.lockedDoor.x] === T.FOG, `depth ${depth}: entering the arena wakes ${boss.name} and seals the fog gate`);
  let attacks = 0, phased = false;
  const seenKinds = new Set<string>();
  for (let t = 0; t < 4000 && !boss.dead; t++) {
    g.player.hp = g.stats.maxHp;
    if (boss.state === 'windup') seenKinds.add(String(g.teles.length));
    if (boss.state === 'windup' && boss.t > 0) attacks++;
    if (t % 40 === 0) g.hurtEnemy(boss, boss.maxHp * 0.03, 4, { fromPlayer: true });
    if (boss.phase) phased = true;
    g.update();
    if (g.mode !== 'play') g.mode = 'play';
  }
  ok(boss.dead && phased, `depth ${depth}: boss enters phase 2 and can be killed`);
  ok(f.tiles.includes(T.STAIRS) && f.pickups.some((p) => p.item?.rarity === 3), `depth ${depth}: boss death opens stairs and drops a legendary`);
  const s = new Screen();
  s.resize(120, 34);
  render(g, s);
}

// ---------------------------------------------------------------- death drops a bloodstain, reclaim works
{
  const g = fresh();
  g.player.ashes = 321;
  const at = { x: g.player.x, y: g.player.y };
  g.hurtPlayer(9999, {});
  ok(g.mode === 'dead', 'lethal damage kills the player');
  for (let i = 0; i < 120; i++) g.update();
  ok(g.mode === 'play' && g.player.ashes === 0, 'respawn at bonfire with ashes lost');
  g.player.x = at.x - 1;
  g.player.y = at.y;
  g.tryMove({ x: 1, y: 0 });
  ok(g.player.ashes === 321, 'walking onto the bloodstain reclaims ashes');
}

// ---------------------------------------------------------------- combat snapshot
{
  const g = fresh(31, 2);
  const e = duel(g, 'cultist');
  e.x += 2;
  const k = g.makeEnemy('hollow', g.player.x, g.player.y + 1, true);
  k.state = 'chase';
  k.aware = true;
  g.enemies.push(k);
  runUntil(g, () => g.teles.length >= 2, 200);
  const s = new Screen();
  s.resize(120, 34);
  render(g, s);
  const rows = s.dump().split('\n');
  const py = rows.findIndex((r) => r.includes('@'));
  console.log(rows.slice(Math.max(0, py - 6), py + 7).map((r) => r.slice(0, 88)).join('\n'));
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('MECHANICS OK');
