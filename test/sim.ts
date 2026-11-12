// Headless test harness: validates floor generation and fuzzes the simulation with a bot.
import { generateFloor, isBossDepth, solveSokoban, MAP_W, MAP_H } from '../src/dungeon.ts';
import { Game } from '../src/game.ts';
import { Screen } from '../src/term.ts';
import { render } from '../src/render.ts';
import { T, DIRS } from '../src/types.ts';

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error('FAIL:', msg);
}

// ---------------------------------------------------------------- 1. generation
function reachable(f: ReturnType<typeof generateFloor>, from: { x: number; y: number }, through: number[]): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const st = [from.y * MAP_W + from.x];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!;
    for (const d of DIRS) {
      const n = c + d.y * MAP_W + d.x;
      if (seen[n]) continue;
      if (!through.includes(f.tiles[n])) continue;
      seen[n] = 1;
      st.push(n);
    }
  }
  return seen;
}

const t0 = Date.now();
let floors = 0;
const kinds: Record<string, number> = {};
for (let depth = 1; depth <= 12; depth++) {
  for (let seed = 1; seed <= 40; seed++) {
    const f = generateFloor(depth, seed * 7777 + depth);
    floors++;
    const walk = [T.FLOOR, T.DOOR, T.OPEN, T.STAIRS];
    const r = reachable(f, f.start, walk);
    // the locked door must be reachable without passing it
    const ld = f.lockedDoor;
    const adj = DIRS.some((d) => r[(ld.y + d.y) * MAP_W + ld.x + d.x]);
    if (!adj) fail(`depth ${depth} seed ${seed}: locked door unreachable`);
    // every puzzle room reachable
    for (const pz of f.puzzles) {
      kinds[pz.kind] = (kinds[pz.kind] ?? 0) + 1;
      const c = { x: pz.room.x + (pz.room.w >> 1), y: pz.room.y };
      let ok = false;
      for (let y = pz.room.y; y < pz.room.y + pz.room.h && !ok; y++)
        for (let x = pz.room.x; x < pz.room.x + pz.room.w; x++) if (r[y * MAP_W + x]) { ok = true; break; }
      if (!ok) fail(`depth ${depth} seed ${seed}: puzzle room ${pz.kind} unreachable (${c.x},${c.y})`);
      if (pz.room.kind !== 'puzzle') fail('puzzle room not tagged');
    }
    const keyPuzzle = f.puzzles.find((p) => p.reward === 'key');
    const keyChest = f.objects.find((o) => o.kind === 'chest' && o.loot === 'key');
    if (!keyPuzzle && !keyChest) fail(`depth ${depth} seed ${seed}: no key source`);
    if (keyChest && !r[keyChest.y * MAP_W + keyChest.x - 1] && !DIRS.some((d) => r[(keyChest.y + d.y) * MAP_W + keyChest.x + d.x]))
      fail(`depth ${depth} seed ${seed}: key chest unreachable`);
    // exit reachable once unlocked
    const r2 = reachable(f, f.start, [...walk, T.LOCKED]);
    const ex = f.exitRoom;
    const exc = { x: ex.x + (ex.w >> 1), y: ex.y + (ex.h >> 1) };
    if (!r2[exc.y * MAP_W + exc.x]) fail(`depth ${depth} seed ${seed}: exit unreachable even with key`);
    if (isBossDepth(depth) !== !!f.bossRoom) fail('boss room mismatch');
    if (f.secretRoom) {
      const r3 = reachable(f, f.start, [...walk, T.CRACKED]);
      const sc = { x: f.secretRoom.x, y: f.secretRoom.y };
      if (!r3[sc.y * MAP_W + sc.x]) fail(`depth ${depth} seed ${seed}: secret room unreachable via cracked wall`);
    }
  }
}
console.log(`generated ${floors} floors in ${Date.now() - t0}ms; puzzles:`, kinds);

// ---------------------------------------------------------------- 1b. sokoban solvability (exact BFS)
{
  let checked = 0;
  for (let depth = 1; depth <= 9 && checked < 40; depth++) {
    for (let seed = 1; seed <= 30 && checked < 40; seed++) {
      const f = generateFloor(depth, seed * 4242 + depth);
      for (const pz of f.puzzles) {
        if (pz.kind !== 'sokoban') continue;
        const r = pz.room, lw = r.w, lh = r.h, n = lw * lh;
        const open = new Uint8Array(n), noB = new Uint8Array(n);
        const loc = (x: number, y: number) => (y - r.y) * lw + (x - r.x);
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) {
            open[loc(x, y)] = f.tiles[y * MAP_W + x] === T.FLOOR && !f.objects.some((o) => o.kind === 'tablet' && o.x === x && o.y === y) ? 1 : 0;
            noB[loc(x, y)] = f.noBoulder[y * MAP_W + x];
          }
        let start = -1;
        for (let i = 0; i < n; i++) if (noB[i]) { start = i; break; }
        const bs = f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id).map((o) => loc(o.x, o.y));
        const ps = pz.plates.map((p) => loc(p.x, p.y));
        const res = solveSokoban(lw, lh, open, noB, bs, ps, start, 400000);
        checked++;
        if (res === -1) fail(`depth ${depth} seed ${seed}: sokoban proven UNSOLVABLE`);
        else if (res === 0) fail(`depth ${depth} seed ${seed}: sokoban starts solved`);
      }
    }
  }
  console.log(`sokoban checked ${checked} puzzles with exact search: none unsolvable`);
}

// ---------------------------------------------------------------- 2. bot fuzz
function runBot(seed: number, ticks: number): void {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  const keys = ['up', 'down', 'left', 'right', 'attack', 'heavy', 'roll', 'parry', 'flask', 'interact'];
  let lastDepth = 1;
  const screen = new Screen();
  screen.resize(120, 34);
  let frames = 0;
  for (let t = 0; t < ticks; t++) {
    if (g.mode === 'dead') g.input('enter', '');
    if (g.mode === 'bonfire') g.input(t % 3 ? 'enter' : 'esc', '');
    if (g.mode === 'read') g.input(g.modal?.kind === 'stairs' ? 'enter' : 'esc', '');
    if (g.mode === 'victory') g.input('enter', '');
    if (g.mode === 'inv') {
      g.input('down', '');
      g.input('enter', '');
      if (t % 7 === 0) g.input('', 'x');
      g.input('esc', '');
    }
    if (g.mode === 'play') {
      // bias toward attacking when enemies are adjacent; otherwise wander
      const adj = DIRS.find((d) => g.enemyAt(g.player.x + d.x, g.player.y + d.y));
      if (adj && t % 3 === 0) {
        const di = DIRS.indexOf(adj);
        g.input(['up', 'right', 'down', 'left'][di], '');
      } else if (t % 2 === 0) g.input(keys[(Math.random() * keys.length) | 0], '');
      if (t % 400 === 0) g.input('inv', '');
      // every so often, teleport the bot to the next interesting place to exercise floors and bosses
      if (t % 1500 === 1499) {
        const f = g.floor;
        if (f.bossRoom && !g.bossDefeated) {
          const r = f.bossRoom;
          g.player.x = r.x + 1;
          g.player.y = r.y + 1;
          g.onPlayerEnter();
        } else {
          const ex = f.exitRoom;
          g.player.x = ex.x + (ex.w >> 1);
          g.player.y = ex.y + (ex.h >> 1);
          if (f.tiles[g.player.y * MAP_W + g.player.x] === T.STAIRS) g.onPlayerEnter();
        }
      }
      if (g.bossActive && t % 50 === 0) {
        // cheat-damage the boss so fights resolve and exercise phases + death
        const b = g.enemies.find((e) => e.boss);
        if (b) g.hurtEnemy(b, b.maxHp * 0.08, 5, { fromPlayer: true });
      }
      if (t % 300 === 0) g.player.hp = g.stats.maxHp; // keep it alive sometimes
    }
    g.update();
    if (t % 5 === 0) {
      render(g, screen);
      screen.flush();
      frames++;
    }
    if (g.depth !== lastDepth) lastDepth = g.depth;
  }
  console.log(
    `bot seed ${seed}: depth ${g.depth}, level ${g.player.level}, deaths ${g.deaths}, kills ${g.kills}, items ${g.player.inv.length}, frames ${frames}`,
  );
}

const t1 = Date.now();
for (const s of [11, 22, 33]) {
  try {
    runBot(s, 30000);
  } catch (e) {
    fail(`bot ${s} crashed: ${(e as Error).stack}`);
  }
}
console.log(`bot fuzz done in ${Date.now() - t1}ms`);

// ---------------------------------------------------------------- 3. snapshot
{
  const g = new Game(1234);
  g.saveEnabled = false;
  g.newGame();
  for (let i = 0; i < 80; i++) g.update();
  const s = new Screen();
  s.resize(120, 34);
  render(g, s);
  console.log(s.dump());
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('ALL OK');
