// Headless test harness: world progression gates, dungeon tool-gating, puzzle solvability, bot fuzzing.
import { solveSokoban } from '../src/dungeon.ts';
import { Game, BLOCKING, HOOK_RANGE } from '../src/game.ts';
import { Screen } from '../src/term.ts';
import { render } from '../src/render.ts';
import { T, DIRS, TOOLS, type Floor, type Vec, type ToolId } from '../src/types.ts';
import { DUNGEONS, NPCS } from '../src/story.ts';
import { PIT } from '../src/world.ts';
import { makeItem } from '../src/loot.ts';

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error('FAIL:', msg);
}
function check(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

/** Flood fill of where a player could walk given a set of tools (hook = gap jumps up to HOOK_RANGE). */
function reach(f: Floor, from: Vec, tools: Set<ToolId>, o: { bridge?: boolean; keys?: boolean } = {}): Uint8Array {
  const W = f.w, H = f.h;
  const block = new Uint8Array(W * H);
  for (const ob of f.objects) if ((BLOCKING.has(ob.kind) && ob.kind !== 'boulder') || (ob.kind === 'deco' && ob.block)) block[ob.y * W + ob.x] = 1;
  for (const n of f.npcs) block[n.y * W + n.x] = 1;
  const pass = (t: number) =>
    t === T.FLOOR || t === T.OPEN || t === T.DOOR || t === T.STAIRS || t === T.BRIDGE || t === T.ENTRANCE || t === T.UPSTAIRS || t === T.CRACKED ||
    (t === T.RUBBLE && tools.has('spade')) || (t === T.THORNS && tools.has('lantern')) || (t === T.PHANTOM && tools.has('bell')) ||
    (t === T.BROKEN && !!o.bridge) || (t === T.LOCKED && !!o.keys);
  const seen = new Uint8Array(W * H);
  const st = [from.y * W + from.x];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!;
    const cx = c % W, cy = (c / W) | 0;
    for (const d of DIRS) {
      const n = c + d.y * W + d.x;
      if (!seen[n] && pass(f.tiles[n]) && !block[n]) {
        seen[n] = 1;
        st.push(n);
      }
      if (tools.has('hook')) {
        let gaps = 0;
        for (let s = 1; s <= HOOK_RANGE; s++) {
          const x = cx + d.x * s, y = cy + d.y * s;
          if (x < 0 || y < 0 || x >= W || y >= H) break;
          const t = f.tiles[y * W + x];
          if (t === T.CHASM) {
            gaps++;
            continue;
          }
          const j = y * W + x;
          if (gaps > 0 && pass(t) && t !== T.ENTRANCE && !block[j] && !seen[j]) {
            seen[j] = 1;
            st.push(j);
          }
          break;
        }
      }
    }
  }
  return seen;
}
const at = (f: Floor, r: Uint8Array, x: number, y: number) => r[y * f.w + x] === 1;
const nearAny = (f: Floor, r: Uint8Array, x: number, y: number) => at(f, r, x, y) || DIRS.some((d) => at(f, r, x + d.x, y + d.y));

function freshGame(seed: number, tools: ToolId[] = []): Game {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  g.mode = 'play';
  g.player.tools = tools.slice();
  g.floors.clear();
  return g;
}

// ===================================================================== 1. the overworld's progression gates
{
  const t0 = Date.now();
  for (const seed of [1, 2, 3, 77, 4242]) {
    const g = freshGame(seed);
    const w = g.getFloor('world');
    const start = w.start;
    const ent = (d: number) => w.entrances.find((e) => e.dungeon === d)!;
    const R = (tools: ToolId[], bridge = false) => reach(w, start, new Set(tools), { bridge });
    const none = R([]);
    for (const n of w.npcs) check(nearAny(w, none, n.x, n.y), `seed ${seed}: NPC ${n.id} unreachable from start`);
    const hutChest = w.objects.find((o) => o.loot === 'tool:spade')!;
    check(nearAny(w, none, hutChest.x, hutChest.y), `seed ${seed}: the spade chest is unreachable`);
    check(nearAny(w, none, 64, 19), `seed ${seed}: cemetery bonfire unreachable`);
    check(!at(w, none, ent(0).x, ent(0).y), `seed ${seed}: Ossuary reachable without the spade`);
    check(at(w, R(['spade']), ent(0).x, ent(0).y), `seed ${seed}: Ossuary unreachable WITH the spade`);
    check(!at(w, R(['spade', 'lantern']), ent(1).x, ent(1).y), `seed ${seed}: Rotwood reachable without the bridge`);
    check(!at(w, R(['spade'], true), ent(1).x, ent(1).y), `seed ${seed}: Rotwood reachable without the lantern`);
    check(at(w, R(['spade', 'lantern'], true), ent(1).x, ent(1).y), `seed ${seed}: Rotwood unreachable with bridge + lantern`);
    check(!at(w, R(['spade', 'lantern'], true), ent(2).x, ent(2).y), `seed ${seed}: Chapel reachable without the hook`);
    check(at(w, R(['spade', 'lantern', 'hook'], true), ent(2).x, ent(2).y), `seed ${seed}: Chapel unreachable with the hook`);
    check(!at(w, R(['spade', 'lantern', 'hook'], true), ent(3).x, ent(3).y), `seed ${seed}: the Pit reachable without the bell`);
    check(at(w, R(['spade', 'lantern', 'hook', 'bell'], true), ent(3).x, ent(3).y), `seed ${seed}: the Pit unreachable with the bell`);
    check(w.puzzles.length === 3, `seed ${seed}: world has ${w.puzzles.length}/3 puzzles`);
    const all = R(['spade', 'lantern', 'hook', 'bell'], true);
    for (const o of w.objects.filter((ob) => ob.kind === 'chest')) check(nearAny(w, all, o.x, o.y), `seed ${seed}: world chest at ${o.x},${o.y} unreachable`);
    check(Math.hypot(ent(3).x - PIT.x, ent(3).y - PIT.y) < 1, 'pit entrance misplaced');
  }
  console.log(`world gates OK (${Date.now() - t0}ms)`);
}

// ===================================================================== 2. dungeons: keys, tools, gates, stashes
{
  const t0 = Date.now();
  let floors = 0;
  const kinds: Record<string, number> = {};
  const themes = new Set<string>();
  for (let seed = 1; seed <= 25; seed++) {
    DUNGEONS.forEach((def, d) => {
      def.floors.forEach((plan, lv) => {
        // spade from the start, plus every tool earned before this floor
        const owned: ToolId[] = TOOLS.slice(0, Math.min(4, d + 1 + lv));
        const g = freshGame(seed * 131 + d, owned);
        const f = g.getFloor(`d${d}f${lv}`);
        floors++;
        for (const pz of f.puzzles) kinds[pz.kind] = (kinds[pz.kind] ?? 0) + 1;
        for (const r of f.rooms) if (r.theme) themes.add(r.theme);
        const tools = new Set<ToolId>(owned);
        const keyPz = f.puzzles.find((p) => p.reward === 'key');
        const keyChest = f.objects.find((o) => o.kind === 'chest' && o.loot?.startsWith('key'));
        check(!!keyPz || !!keyChest, `d${d}f${lv} s${seed}: no key source`);
        const keyReachable = (r: Uint8Array) => {
          if (keyPz) {
            const rm = keyPz.room;
            for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) if (at(f, r, x, y)) return true;
            return false;
          }
          return nearAny(f, r, keyChest!.x, keyChest!.y);
        };
        if (plan.keyGate) {
          const without = new Set(tools);
          without.delete(plan.keyGate);
          check(!keyReachable(reach(f, f.start, without)), `d${d}f${lv} s${seed}: key reachable WITHOUT the ${plan.keyGate}`);
        }
        const withAll = reach(f, f.start, tools);
        check(keyReachable(withAll), `d${d}f${lv} s${seed}: key unreachable with tools [${[...tools]}]`);
        if (plan.toolReward) {
          const gives = keyPz ? keyPz.tool === plan.toolReward : keyChest?.loot === `key+${plan.toolReward}`;
          check(gives, `d${d}f${lv} s${seed}: the ${plan.toolReward} is not in the key reward`);
        }
        const ld = f.lockedDoor;
        check(nearAny(f, withAll, ld.x, ld.y), `d${d}f${lv} s${seed}: locked door unreachable`);
        const ex = f.exitRoom!;
        const unlocked = reach(f, f.start, tools, { keys: true });
        let exitOk = false;
        for (let y = ex.y; y < ex.y + ex.h; y++) for (let x = ex.x; x < ex.x + ex.w; x++) if (at(f, unlocked, x, y)) exitOk = true;
        check(exitOk, `d${d}f${lv} s${seed}: exit room unreachable with key`);
        check(!!plan.boss === !!f.bossRoom, `d${d}f${lv}: boss room mismatch`);
        for (const s of plan.stash) check(f.pickups.some((p) => p.id === s.id), `d${d}f${lv} s${seed}: stash ${s.id} missing`);
      });
    });
  }
  console.log(`dungeons OK: ${floors} floors in ${Date.now() - t0}ms; puzzles`, kinds, `themes used: ${themes.size}`);
}

// ===================================================================== 3. sokoban solvability (exact search)
{
  let checked = 0;
  for (let seed = 1; seed <= 40 && checked < 30; seed++) {
    const g = freshGame(seed * 7, ['spade', 'lantern', 'hook', 'bell']);
    for (const key of ['world', 'd0f0', 'd1f0', 'd2f1']) {
      const f = g.getFloor(key);
      for (const pz of f.puzzles) {
        if (pz.kind !== 'sokoban') continue;
        const r = pz.room, lw = r.w, lh = r.h, n = lw * lh;
        const open = new Uint8Array(n), noB = new Uint8Array(n);
        const loc = (x: number, y: number) => (y - r.y) * lw + (x - r.x);
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) {
            open[loc(x, y)] = f.tiles[y * f.w + x] === T.FLOOR && !f.objects.some((o) => o.kind === 'tablet' && o.x === x && o.y === y) ? 1 : 0;
            noB[loc(x, y)] = f.noBoulder[y * f.w + x];
          }
        let start = -1;
        for (let i = 0; i < n; i++) if (noB[i] && open[i]) { start = i; break; }
        const bs = f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id).map((o) => loc(o.x, o.y));
        const res = solveSokoban(lw, lh, open, noB, bs, pz.plates.map((p) => loc(p.x, p.y)), start, 300000);
        checked++;
        check(res !== -1, `${key} seed ${seed}: sokoban proven UNSOLVABLE`);
        check(res !== 0, `${key} seed ${seed}: sokoban starts solved`);
      }
    }
  }
  console.log(`sokoban: ${checked} puzzles checked, none unsolvable`);
}

// ===================================================================== 4. bot fuzz across the whole game
function runBot(seed: number, ticks: number): void {
  const g = new Game(seed);
  g.saveEnabled = false;
  g.newGame();
  const keys = ['up', 'down', 'left', 'right', 'attack', 'heavy', 'roll', 'parry', 'flask', 'interact', 'tool', 'skill1', 'skill2', 'skill3'];
  const route = ['world', 'd0f0', 'd0f1', 'world', 'd1f0', 'd1f1', 'd2f0', 'd2f1', 'world', 'd3f0', 'd3f1'];
  let leg = 0;
  const screen = new Screen();
  screen.resize(120, 34);
  let frames = 0, talks = 0, endings = 0;
  for (let t = 0; t < ticks; t++) {
    switch (g.mode) {
      case 'dead': g.input('enter', ''); break;
      case 'bonfire': g.input(t % 4 ? 'esc' : 'enter', ''); break;
      case 'travel': g.input(t % 2 ? 'esc' : 'enter', ''); break;
      case 'read': g.input('esc', ''); break;
      case 'dialog': g.input('enter', ''); break;
      case 'shop': g.input(['down', 'enter', 'esc'][t % 3], ''); break;
      case 'journal': g.input(['right', 'down', 'esc'][t % 3], ''); break;
      case 'talents': g.input(['right', 'down', 'enter', 'esc'][t % 4], String(1 + (t % 3))); break;
      case 'ending': g.input(t % 2 ? 'enter' : '', '1'); break;
      case 'map': case 'help': case 'confirmQuit': g.input('esc', 'n'); break;
      case 'title':
        endings++;
        g.newGame();
        break;
      case 'inv':
        g.input('down', '');
        g.input('enter', '');
        if (t % 7 === 0) g.input('', 'x');
        g.input('esc', '');
        break;
    }
    if (t % 1100 === 1099 && g.mode !== 'dead') g.mode = 'play';
    if (g.mode === 'play') {
      const p = g.player;
      const adj = DIRS.find((d) => g.enemyAt(p.x + d.x, p.y + d.y));
      if (adj && t % 3 === 0) g.input(['up', 'right', 'down', 'left'][DIRS.indexOf(adj)], '');
      else if (t % 2 === 0) g.input(keys[(Math.random() * keys.length) | 0], '');
      if (t % 97 === 0) g.input('', String(1 + (((t / 97) | 0) % 4)));
      if (t % 500 === 0) g.input('inv', '');
      if (t % 700 === 0) g.input('journal', '');
      if (t === 2000) for (const tl of TOOLS) if (!p.tools.includes(tl)) p.tools.push(tl);
      // build-swapping: every path's actives get exercised over a run
      const builds = [
        ['gravebolt', 'raise', 'corpse', 'leech', 'bonearmor', 'harvest'],
        ['volley', 'pin', 'disengage', 'blackarrow', 'deadeye', 'patience'],
        ['smoke', 'step', 'shadow', 'twin', 'venom', 'cull'],
        ['shield', 'bash', 'warcry', 'iron', 'parrymaster', 'laststand'],
      ];
      if (t % 1500 === 600) {
        const bld = builds[((t / 1500) | 0) % 4];
        p.talents = bld.slice();
        p.slots = bld.filter((id) => !['leech', 'deadeye', 'patience', 'shadow', 'twin', 'venom', 'cull', 'iron', 'parrymaster', 'laststand'].includes(id)).slice(0, 3);
        p.cds = {};
        g.recalc();
        if (bld[0] === 'volley') {
          p.eq.weapon = makeItem(g.rng, 4, 1, 'weapon', 'bow');
          g.recalc();
        }
      }
      if (t % 900 === 450) g.input('talents', '');
      if (t % 300 === 150 && g.floor.kind === 'world') {
        const n = g.floor.npcs[((t / 300) | 0) % g.floor.npcs.length];
        p.x = n.x;
        p.y = n.y + 1;
        if (g.blockObjAt(p.x, p.y) || g.isOpaque(p.x, p.y)) p.y = n.y - 1;
        g.talkTo(NPCS[n.id]);
        talks++;
      }
      if (t % 1100 === 1099) {
        leg = (leg + 1) % route.length;
        g.modal = null;
        g.dialog = null;
        g.enterLocation(route[leg]);
        const f = g.floor;
        if (f.bossRoom && f.bossId && !g.bossDead(f.bossId)) {
          p.x = f.bossRoom.x + 1;
          p.y = f.bossRoom.y + 1;
          g.onPlayerEnter();
        }
      }
      if (g.bossActive && t % 40 === 0) {
        const b = g.enemies.find((e) => e.boss);
        if (b) g.hurtEnemy(b, b.maxHp * 0.07, 5, { fromPlayer: true });
      }
      if (t % 250 === 0 || g.bossActive) p.hp = g.stats.maxHp;
    }
    g.update();
    if (process.env.BOTTRACE && (t % 200 === 0 || t % 1100 > 1096 || t % 1100 < 4)) {
      const b = g.enemies.find((e) => e.boss);
      console.log(t, g.floor.key, g.mode, 'boss', g.bossActive, b ? Math.round(b.hp) : '-', 'at', g.player.x, g.player.y);
    }
    if (t % 5 === 0) {
      render(g, screen);
      screen.flush();
      frames++;
    }
  }
  const bosses = ['warden', 'mother', 'choir', 'king'].filter((b) => g.bossDead(b)).length;
  console.log(`bot ${seed}: at ${g.floor.key}, level ${g.player.level}, deaths ${g.deaths}, kills ${g.kills}, bosses ${bosses}/4, full playthroughs ${endings}, talks ${talks}, quests ${JSON.stringify(g.quests)}, frames ${frames}`);
}

const t1 = Date.now();
if (process.env.BOTTRACE) {
  runBot(11, 3400);
  process.exit(0);
}
for (const s of [11, 22]) {
  try {
    runBot(s, 14000);
  } catch (e) {
    fail(`bot ${s} crashed: ${(e as Error).stack}`);
  }
}
console.log(`bot fuzz done in ${Date.now() - t1}ms`);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('ALL OK');
