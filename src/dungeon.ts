// Floor generation: "rooms and mazes", lock-and-key, secret rooms, and verified-solvable puzzles.
import { RNG } from './rng.ts';
import { T, DIRS, type Floor, type Room, type Obj, type Puzzle, type Vec, type Spawn } from './types.ts';
import { ENEMIES, ACT_NAMES, ACT_BOSS, BRAZIER_COLORS, ghostMessage } from './data.ts';

export const MAP_W = 79;
export const MAP_H = 43;

export function actOf(depth: number): number {
  return Math.floor((depth - 1) / 3) % 3;
}
export function isBossDepth(depth: number): boolean {
  return depth % 3 === 0;
}

export function generateFloor(depth: number, seed: number): Floor {
  for (let a = 0; a < 200; a++) {
    const f = tryGen(depth, (seed + a * 7919) >>> 0);
    if (f) return f;
  }
  throw new Error('Dungeon generation failed');
}

interface Conn {
  x: number;
  y: number;
  a: number;
  b: number;
  leaf: number;
}

function tryGen(depth: number, seed: number): Floor | null {
  const rng = new RNG(seed);
  const W = MAP_W, H = MAP_H;
  const N = W * H;
  const tiles = new Uint8Array(N);
  const region = new Int32Array(N).fill(-1);
  const rooms: Room[] = [];
  const boss = isBossDepth(depth);
  const act = actOf(depth);

  const place = (w: number, h: number, tries: number): Room | null => {
    for (let t = 0; t < tries; t++) {
      const x = 1 + 2 * rng.int(0, (W - 2 - w) >> 1);
      const y = 1 + 2 * rng.int(0, (H - 2 - h) >> 1);
      let ok = true;
      for (const r of rooms) {
        if (x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const room: Room = { id: rooms.length, x, y, w, h, kind: 'normal' };
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          tiles[yy * W + xx] = T.FLOOR;
          region[yy * W + xx] = room.id;
        }
      rooms.push(room);
      return room;
    }
    return null;
  };

  const bigIdx: number[] = [];
  if (boss) {
    if (!place(17, 13, 200)) return null;
  }
  for (let k = 0; k < 2; k++) {
    const r = place(rng.pick([9, 11]), rng.pick([7, 9]), 80);
    if (r) bigIdx.push(r.id);
  }
  for (let t = 0; t < 400 && rooms.length < 14; t++) place(rng.pick([5, 5, 7, 7, 9]), rng.pick([5, 5, 7]), 1);
  if (rooms.length < 7) return null;

  // ---- maze fill
  let regionCount = rooms.length;
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      if (tiles[y * W + x] !== T.WALL) continue;
      const reg = regionCount++;
      const stack: number[] = [y * W + x];
      tiles[y * W + x] = T.FLOOR;
      region[y * W + x] = reg;
      let last = -1;
      while (stack.length) {
        const c = stack[stack.length - 1];
        const cx = c % W, cy = (c / W) | 0;
        const opts: number[] = [];
        for (let d = 0; d < 4; d++) {
          const nx = cx + DIRS[d].x * 2, ny = cy + DIRS[d].y * 2;
          if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
          if (tiles[ny * W + nx] === T.WALL) opts.push(d);
        }
        if (!opts.length) {
          stack.pop();
          last = -1;
          continue;
        }
        const d = last >= 0 && opts.includes(last) && rng.next() > 0.45 ? last : rng.pick(opts);
        const mi = (cy + DIRS[d].y) * W + cx + DIRS[d].x;
        const ni = (cy + DIRS[d].y * 2) * W + cx + DIRS[d].x * 2;
        tiles[mi] = T.FLOOR;
        region[mi] = reg;
        tiles[ni] = T.FLOOR;
        region[ni] = reg;
        stack.push(ni);
        last = d;
      }
    }
  }

  // ---- special rooms
  const roomCenter = (r: Room): Vec => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
  const bossIdx = boss ? 0 : -1;
  const small = rooms.filter((r) => r.id !== bossIdx && !bigIdx.includes(r.id));
  if (small.length < 3) return null;
  const startRoom = rng.pick(small);
  const sc = roomCenter(startRoom);
  let exitRoom: Room;
  if (boss) exitRoom = rooms[0];
  else {
    const cands = small.filter((r) => r !== startRoom);
    cands.sort((a, b) => {
      const ca = roomCenter(a), cb = roomCenter(b);
      return (cb.x - sc.x) ** 2 + (cb.y - sc.y) ** 2 - ((ca.x - sc.x) ** 2 + (ca.y - sc.y) ** 2);
    });
    exitRoom = cands[rng.int(0, Math.min(1, cands.length - 1))];
  }
  let secretRoom: Room | null = null;
  if (rng.chance(0.7)) {
    const cands = small.filter((r) => r !== startRoom && r !== exitRoom && r.w * r.h <= 35);
    if (cands.length) secretRoom = rng.pick(cands);
  }
  const exitIdx = exitRoom.id, secretIdx = secretRoom ? secretRoom.id : -1;
  const isLeaf = (r: number) => r === exitIdx || r === secretIdx;

  // ---- connectors + spanning tree
  const conns: Conn[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.WALL) continue;
      const regs: number[] = [];
      for (const d of DIRS) {
        const r = region[(y + d.y) * W + x + d.x];
        if (r >= 0 && !regs.includes(r)) regs.push(r);
      }
      if (regs.length === 2) conns.push({ x, y, a: regs[0], b: regs[1], leaf: -1 });
    }
  }
  rng.shuffle(conns);
  const parent = new Int32Array(regionCount);
  for (let i = 0; i < regionCount; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const leafDone = new Set<number>();
  const accepted: Conn[] = [];
  const nearAccepted = (c: Conn) => accepted.some((o) => Math.abs(o.x - c.x) <= 2 && Math.abs(o.y - c.y) <= 2);
  for (const c of conns) {
    const la = isLeaf(c.a), lb = isLeaf(c.b);
    if (la && lb) continue;
    if (la || lb) {
      const leaf = la ? c.a : c.b;
      if (leafDone.has(leaf)) continue;
      // leaves attach to corridors, not other rooms, so the locked door reads clearly
      const other = la ? c.b : c.a;
      if (other < rooms.length && rng.chance(0.7)) continue;
      leafDone.add(leaf);
      parent[find(c.a)] = find(c.b);
      c.leaf = leaf;
      accepted.push(c);
      continue;
    }
    if (find(c.a) !== find(c.b)) {
      parent[find(c.a)] = find(c.b);
      accepted.push(c);
    } else if (rng.chance(0.03) && !nearAccepted(c)) accepted.push(c);
  }
  const root = find(0);
  for (let r = 1; r < regionCount; r++) if (find(r) !== root) return null;
  if (!leafDone.has(exitIdx)) return null;

  let lockedDoor: Vec = { x: 0, y: 0 };
  for (const c of accepted) {
    const i = c.y * W + c.x;
    if (c.leaf === exitIdx) {
      tiles[i] = T.LOCKED;
      lockedDoor = { x: c.x, y: c.y };
    } else if (c.leaf === secretIdx && secretIdx >= 0) tiles[i] = T.CRACKED;
    else if (c.a < rooms.length || c.b < rooms.length) tiles[i] = T.DOOR;
    else tiles[i] = T.FLOOR;
  }

  // ---- prune dead ends (keep a few for maze flavor)
  const roomAt = new Int16Array(N).fill(-1);
  for (const r of rooms)
    for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) roomAt[yy * W + xx] = r.id;
  const deadEnd = (i: number): boolean => {
    const t = tiles[i];
    if (t === T.WALL || t === T.LOCKED || t === T.CRACKED || roomAt[i] >= 0) return false;
    let n = 0;
    if (tiles[i - 1] !== T.WALL) n++;
    if (tiles[i + 1] !== T.WALL) n++;
    if (tiles[i - W] !== T.WALL) n++;
    if (tiles[i + W] !== T.WALL) n++;
    return n <= 1;
  };
  const keep = new Uint8Array(N);
  for (let i = W; i < N - W; i++) if (deadEnd(i) && tiles[i] === T.FLOOR && rng.chance(0.12)) keep[i] = 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = W; i < N - W; i++) {
      if (!keep[i] && deadEnd(i)) {
        tiles[i] = T.WALL;
        changed = true;
      }
    }
  }

  const noBoulder = new Uint8Array(N);
  for (let i = W; i < N - W; i++) {
    const t = tiles[i];
    if (t === T.DOOR || t === T.LOCKED || t === T.CRACKED || (t === T.FLOOR && roomAt[i] < 0)) {
      for (const d of DIRS) {
        const j = i + d.y * W + d.x;
        if (roomAt[j] >= 0) noBoulder[j] = 1;
      }
    }
  }

  startRoom.kind = 'start';
  exitRoom.kind = boss ? 'boss' : 'exit';
  if (secretRoom) secretRoom.kind = 'secret';

  const f: Floor = {
    depth, act, w: W, h: H, tiles, seen: new Uint8Array(N), decal: new Uint8Array(N), roomAt, noBoulder,
    rooms, objects: [], pickups: [], spawns: [], puzzles: [],
    start: { x: sc.x, y: sc.y + 1 }, bonfire: sc, exitRoom, bossRoom: boss ? exitRoom : null,
    bossId: boss ? ACT_BOSS[act] : null, lockedDoor, secretRoom, name: ACT_NAMES[act],
  };
  let oid = 1;
  const addObj = (o: Omit<Obj, 'id'>): Obj => {
    const ob = { id: oid++, ...o } as Obj;
    f.objects.push(ob);
    return ob;
  };
  const objAt = (x: number, y: number) => f.objects.find((o) => o.x === x && o.y === y);
  const isFreeFloor = (x: number, y: number) =>
    tiles[y * W + x] === T.FLOOR && !objAt(x, y) && !(x === f.start.x && y === f.start.y);

  addObj({ kind: 'bonfire', x: sc.x, y: sc.y });
  if (!boss) {
    const ec = roomCenter(exitRoom);
    tiles[ec.y * W + ec.x] = T.STAIRS;
  }

  // ---- puzzles
  const candidates = rooms
    .filter((r) => r.kind === 'normal')
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const kinds = rng.shuffle(['sokoban', 'lights', 'braziers'] as const);
  let keyPlaced = false;
  let puzzleCount = 0;
  const wantTreasurePuzzle = rng.chance(0.75);
  for (const room of candidates) {
    if (puzzleCount >= (wantTreasurePuzzle ? 2 : 1)) break;
    const reward = keyPlaced ? 'treasure' : 'key';
    for (let k = 0; k < kinds.length; k++) {
      const kind = kinds[(puzzleCount + k) % kinds.length];
      const pz: Puzzle = {
        id: f.puzzles.length, kind, room, reward, solved: false, plates: [], boulderStart: [], n: 0,
        order: [], progress: 0, riddle: [],
      };
      let ok = false;
      if (kind === 'sokoban') ok = genSokoban(f, rng, pz, addObj);
      else if (kind === 'lights') ok = genLights(f, rng, pz, addObj);
      else ok = genBraziers(f, rng, pz, addObj);
      if (ok) {
        f.puzzles.push(pz);
        room.kind = 'puzzle';
        puzzleCount++;
        if (reward === 'key') keyPlaced = true;
        break;
      }
    }
  }

  const normalRooms = () => rooms.filter((r) => r.kind === 'normal');
  const randomCellIn = (r: Room, avoidNoBoulder = true): Vec | null => {
    for (let t = 0; t < 40; t++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (avoidNoBoulder && noBoulder[y * W + x]) continue;
      if (isFreeFloor(x, y)) return { x, y };
    }
    return null;
  };

  const spawns: Spawn[] = [];
  if (!keyPlaced) {
    // fallback: a guarded key chest
    const nr = normalRooms();
    if (!nr.length) return null;
    const r = rng.pick(nr);
    const c = roomCenter(r);
    if (!isFreeFloor(c.x, c.y)) return null;
    addObj({ kind: 'chest', x: c.x, y: c.y, loot: 'key' });
    const pool = enemyPool(act, depth);
    const guard = randomCellIn(r);
    if (guard) spawns.push({ def: rng.weighted(pool), x: guard.x, y: guard.y, elite: true });
  }

  // ---- secret room loot
  if (secretRoom) {
    const c = roomCenter(secretRoom);
    addObj({ kind: 'chest', x: c.x, y: c.y, loot: 'treasure' });
    for (let k = 0; k < 2; k++) {
      const p = randomCellIn(secretRoom);
      if (p) addObj({ kind: 'urn', x: p.x, y: p.y });
    }
    if (rng.chance(0.6)) {
      const p = randomCellIn(secretRoom);
      if (p) f.pickups.push({ x: p.x, y: p.y, kind: 'tallow' });
    }
    // a hint from the dead near the cracked wall
    for (const c2 of accepted) {
      if (c2.leaf !== secretIdx) continue;
      for (const d of DIRS) {
        const x = c2.x + d.x, y = c2.y + d.y;
        if (roomAt[y * W + x] < 0 && isFreeFloor(x, y) && rng.chance(0.75)) {
          addObj({ kind: 'message', x, y, text: rng.pick(['Hidden path ahead', 'Try heavy attack', 'Could this be a hidden path?', 'A cracked wall... break it']) });
          break;
        }
      }
    }
  }

  // ---- chests, urns, messages, traps
  const chestCount = 1 + (rng.chance(0.5) ? 1 : 0);
  for (let k = 0; k < chestCount; k++) {
    const nr = normalRooms();
    if (!nr.length) break;
    const p = randomCellIn(rng.pick(nr));
    if (p) addObj({ kind: 'chest', x: p.x, y: p.y, loot: 'normal' });
  }
  const corridorCells: Vec[] = [];
  const deadEnds: Vec[] = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.FLOOR || roomAt[i] >= 0) continue;
      corridorCells.push({ x, y });
      let n = 0;
      for (const d of DIRS) if (tiles[i + d.y * W + d.x] !== T.WALL) n++;
      if (n === 1) deadEnds.push({ x, y });
    }
  const urnCount = rng.int(6, 10);
  for (let k = 0; k < urnCount; k++) {
    if (deadEnds.length && rng.chance(0.35)) {
      const p = rng.pick(deadEnds);
      if (isFreeFloor(p.x, p.y)) addObj({ kind: 'urn', x: p.x, y: p.y });
      continue;
    }
    const nr = rooms.filter((r) => r.kind === 'normal' || r.kind === 'start' || r.kind === 'exit');
    const r = rng.pick(nr);
    // urns hug walls
    for (let t = 0; t < 20; t++) {
      const x = rng.pick([r.x, r.x + r.w - 1, rng.int(r.x, r.x + r.w - 1)]);
      const y = rng.pick([r.y, r.y + r.h - 1, rng.int(r.y, r.y + r.h - 1)]);
      if (noBoulder[y * W + x] || !isFreeFloor(x, y)) continue;
      if (Math.abs(x - sc.x) <= 1 && Math.abs(y - sc.y) <= 1) continue;
      addObj({ kind: 'urn', x, y });
      break;
    }
  }
  const msgCount = rng.int(3, 5);
  for (let k = 0; k < msgCount; k++) {
    const p = rng.chance(0.5) && corridorCells.length ? rng.pick(corridorCells) : randomCellIn(rng.pick(rooms), false);
    if (p && isFreeFloor(p.x, p.y)) addObj({ kind: 'message', x: p.x, y: p.y, text: ghostMessage(rng) });
  }
  if (depth >= 2) {
    const n = rng.int(3, 7);
    for (let k = 0; k < n && corridorCells.length; k++) {
      const p = rng.pick(corridorCells);
      if (isFreeFloor(p.x, p.y) && (p.x - sc.x) ** 2 + (p.y - sc.y) ** 2 > 36)
        addObj({ kind: 'spikes', x: p.x, y: p.y, off: rng.int(0, 79) });
    }
  }

  // ---- enemies
  const pool = enemyPool(act, depth);
  const total = Math.min(28, 6 + Math.round(depth * 1.6));
  let elites = 0;
  const occupied = new Set<number>();
  const farFromStart = (p: Vec) => (p.x - sc.x) ** 2 + (p.y - sc.y) ** 2 > 100;
  let guard = 0;
  while (spawns.length < total && guard++ < 400) {
    const def = rng.weighted(pool);
    const ed = ENEMIES[def];
    let at: Vec | null;
    if (rng.chance(0.25) && corridorCells.length) at = rng.pick(corridorCells);
    else {
      const rs = rooms.filter((r) => r.kind !== 'start' && r.kind !== 'boss' && r.kind !== 'secret');
      at = randomCellIn(rng.pick(rs), false);
    }
    if (!at || !isFreeFloor(at.x, at.y) || !farFromStart(at) || occupied.has(at.y * W + at.x)) continue;
    const elite = depth >= 2 && elites < 2 && !ed.pack && rng.chance(0.09);
    if (elite) elites++;
    spawns.push({ def, x: at.x, y: at.y, elite });
    occupied.add(at.y * W + at.x);
    if (ed.pack) {
      const extra = rng.int(ed.pack[0], ed.pack[1]) - 1;
      for (let k = 0; k < extra; k++) {
        for (let t = 0; t < 10; t++) {
          const x = at.x + rng.int(-2, 2), y = at.y + rng.int(-2, 2);
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          if (!isFreeFloor(x, y) || occupied.has(y * W + x)) continue;
          spawns.push({ def, x, y, elite: false });
          occupied.add(y * W + x);
          break;
        }
      }
    }
  }
  f.spawns = spawns;
  return f;
}

function enemyPool(act: number, depth: number): [string, number][] {
  const pool: [string, number][] = [];
  for (const d of Object.values(ENEMIES)) {
    if (d.id === 'maggot' && act !== 1) continue;
    if (d.acts.includes(act) && d.minDepth <= depth) pool.push([d.id, d.weight]);
  }
  return pool;
}

type AddObj = (o: Omit<Obj, 'id'>) => Obj;

function interiorCells(r: Room): Vec[] {
  const out: Vec[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

// ------------------------------------------------------------------ sokoban
function genSokoban(f: Floor, rng: RNG, pz: Puzzle, addObj: AddObj): boolean {
  const r = pz.room;
  if (r.w < 7 || r.h < 5) return false;
  const lw = r.w, lh = r.h, n = lw * lh;
  const W = f.w;
  const noB = new Uint8Array(n);
  for (let ly = 0; ly < lh; ly++)
    for (let lx = 0; lx < lw; lx++) noB[ly * lw + lx] = f.noBoulder[(r.y + ly) * W + r.x + lx];
  const doorCells: number[] = [];
  for (let i = 0; i < n; i++) if (noB[i]) doorCells.push(i);
  if (!doorCells.length) return false;
  const depthHard = f.depth >= 4;
  const nb = depthHard && n >= 63 ? 3 : 2;
  const minPushes = f.depth <= 2 ? 5 : depthHard ? 9 : 7;
  for (let attempt = 0; attempt < 40; attempt++) {
    const open = new Uint8Array(n).fill(1);
    const taken = new Set<number>();
    const pickCell = (filter: (i: number) => boolean): number => {
      for (let t = 0; t < 60; t++) {
        const i = rng.int(0, n - 1);
        if (!taken.has(i) && open[i] && !noB[i] && filter(i)) return i;
      }
      return -1;
    };
    const border = (i: number) => {
      const x = i % lw, y = (i / lw) | 0;
      return x === 0 || y === 0 || x === lw - 1 || y === lh - 1;
    };
    // pillars
    const pillars: number[] = [];
    const np = rng.int(1, 4);
    for (let k = 0; k < np; k++) {
      const i = pickCell(() => true);
      if (i < 0) continue;
      open[i] = 0;
      pillars.push(i);
    }
    const tablet = pickCell(border);
    if (tablet < 0) continue;
    open[tablet] = 0;
    const start = doorCells[0];
    if (!open[start]) continue;
    // every open cell must be reachable (no sealed pockets)
    const reach = flood(lw, lh, open, new Uint8Array(n), start);
    let openCount = 0, reachCount = 0;
    for (let i = 0; i < n; i++) if (open[i]) {
      openCount++;
      if (reach[i]) reachCount++;
    }
    if (reachCount !== openCount) continue;
    // plates first, then pull the stones backwards off them: always solvable by construction
    const plates: number[] = [];
    for (let k = 0; k < nb; k++) {
      const p = pickCell(() => true);
      if (p < 0) break;
      taken.add(p);
      plates.push(p);
    }
    if (plates.length !== nb) continue;
    const boulders = plates.slice();
    const bm = new Uint8Array(n);
    for (const b of boulders) bm[b] = 1;
    let pl = start;
    const pulls = rng.int(25, 50);
    let done = 0, lastB = 0, lastD = DIRS[0];
    for (let k = 0; k < 500 && done < pulls; k++) {
      const reachNow = flood(lw, lh, open, bm, pl);
      const keepGoing = done > 0 && rng.chance(0.65);
      const bi = keepGoing ? lastB : rng.int(0, nb - 1);
      const b = boulders[bi];
      const d = keepGoing ? lastD : rng.pick(DIRS);
      const bx = b % lw, by = (b / lw) | 0;
      const px = bx + d.x, py = by + d.y; // player stands here, then steps back to (px+d)
      const qx = px + d.x, qy = py + d.y;
      if (px < 0 || py < 0 || qx < 0 || qy < 0 || px >= lw || qx >= lw || py >= lh || qy >= lh) continue;
      const pi = py * lw + px, qi = qy * lw + qx;
      if (!reachNow[pi] || !open[qi] || bm[qi] || noB[pi]) continue;
      bm[b] = 0;
      bm[pi] = 1;
      boulders[bi] = pi;
      pl = qi;
      done++;
      lastB = bi;
      lastD = d;
    }
    if (boulders.some((b) => plates.includes(b))) continue;
    // the player enters from the door: it must connect to where the reverse walk left them
    if (!flood(lw, lh, open, bm, start)[pl]) continue;
    // difficulty: minimum total stone-to-scale distance (a true lower bound on pushes)
    const res = minMatching(boulders, plates, lw);
    if (res < minPushes) continue;
    // commit
    for (const i of pillars) f.tiles[(r.y + ((i / lw) | 0)) * W + r.x + (i % lw)] = T.WALL;
    const g = (i: number): Vec => ({ x: r.x + (i % lw), y: r.y + ((i / lw) | 0) });
    const tv = g(tablet);
    addObj({ kind: 'tablet', x: tv.x, y: tv.y, puzzle: pz.id, text: 'soko' });
    for (const i of plates) {
      const v = g(i);
      pz.plates.push(v);
      addObj({ kind: 'plate', x: v.x, y: v.y, puzzle: pz.id });
    }
    for (const i of boulders) {
      const v = g(i);
      pz.boulderStart.push(v);
      addObj({ kind: 'boulder', x: v.x, y: v.y, puzzle: pz.id });
    }
    pz.riddle = [
      'THE SCALES OF THE DEAD',
      '',
      'Here the dead were weighed before burial.',
      'Lay the stones upon the scales,',
      'and the scales will pay what is owed.',
      '',
      'Stones can only be pushed, never pulled.',
      `(The puzzle needs at least ${res} pushes.)`,
    ];
    return true;
  }
  return false;
}

function minMatching(bs: number[], ps: number[], lw: number): number {
  const md = (a: number, b: number) => Math.abs((a % lw) - (b % lw)) + Math.abs(((a / lw) | 0) - ((b / lw) | 0));
  let best = Infinity;
  const perm = (i: number, used: number, acc: number): void => {
    if (acc >= best) return;
    if (i === bs.length) {
      best = acc;
      return;
    }
    for (let j = 0; j < ps.length; j++) if (!(used & (1 << j))) perm(i + 1, used | (1 << j), acc + md(bs[i], ps[j]));
  };
  perm(0, 0, 0);
  return best;
}

function flood(lw: number, lh: number, open: Uint8Array, block: Uint8Array, start: number): Uint8Array {
  const n = lw * lh;
  const seen = new Uint8Array(n);
  const st = [start];
  seen[start] = 1;
  while (st.length) {
    const c = st.pop()!;
    const x = c % lw, y = (c / lw) | 0;
    if (x > 0) push(c - 1);
    if (x < lw - 1) push(c + 1);
    if (y > 0) push(c - lw);
    if (y < lh - 1) push(c + lw);
  }
  function push(i: number) {
    if (!seen[i] && open[i] && !block[i]) {
      seen[i] = 1;
      st.push(i);
    }
  }
  return seen;
}

/**
 * BFS over push-states. Returns the minimum number of pushes, -1 if proven unsolvable,
 * or (when the state cap is hit) a lower bound: the BFS depth already fully ruled out.
 */
export function solveSokoban(
  lw: number, lh: number, open: Uint8Array, noB: Uint8Array,
  boulders: number[], plates: number[], start: number, cap: number,
): number {
  const n = lw * lh;
  const plateSet = new Uint8Array(n);
  for (const p of plates) plateSet[p] = 1;
  const goal = (bs: number[]) => bs.every((b) => plateSet[b]);
  const init = [...boulders].sort((a, b) => a - b);
  if (goal(init)) return 0;
  // corner deadlocks: a stone pushed into a corner that is not a scale can never move again
  const blockedAt = (x: number, y: number) => x < 0 || y < 0 || x >= lw || y >= lh || !open[y * lw + x];
  const dead = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!open[i] || plateSet[i]) continue;
    const x = i % lw, y = (i / lw) | 0;
    const v = blockedAt(x, y - 1) || blockedAt(x, y + 1);
    const h = blockedAt(x - 1, y) || blockedAt(x + 1, y);
    if (v && h) dead[i] = 1;
  }
  const queue: { bs: number[]; p: number; d: number }[] = [{ bs: init, p: start, d: 0 }];
  const seen = new Set<number>();
  const pushed = new Set<number>();
  const bmask = new Uint8Array(n);
  let head = 0;
  while (head < queue.length) {
    if (head > cap) return Math.max(0, queue[head].d - 1);
    const s = queue[head++];
    for (const b of s.bs) bmask[b] = 1;
    const reach = flood(lw, lh, open, bmask, s.p);
    let minIdx = n;
    for (let i = 0; i < n; i++) if (reach[i]) { minIdx = i; break; }
    let key = minIdx;
    for (const b of s.bs) key = key * n + b;
    if (seen.has(key)) {
      for (const b of s.bs) bmask[b] = 0;
      continue;
    }
    seen.add(key);
    for (let bi = 0; bi < s.bs.length; bi++) {
      const b = s.bs[bi];
      const bx = b % lw, by = (b / lw) | 0;
      for (const d of DIRS) {
        const px = bx - d.x, py = by - d.y, tx = bx + d.x, ty = by + d.y;
        if (px < 0 || py < 0 || px >= lw || py >= lh || tx < 0 || ty < 0 || tx >= lw || ty >= lh) continue;
        const pi = py * lw + px, ti = ty * lw + tx;
        if (!reach[pi] || !open[ti] || noB[ti] || bmask[ti] || dead[ti]) continue;
        const nbs = s.bs.slice();
        nbs[bi] = ti;
        nbs.sort((a, c) => a - c);
        if (goal(nbs)) {
          for (const bb of s.bs) bmask[bb] = 0;
          return s.d + 1;
        }
        let pk = b;
        for (const x of nbs) pk = pk * n + x;
        if (pushed.has(pk)) continue;
        pushed.add(pk);
        queue.push({ bs: nbs, p: b, d: s.d + 1 });
      }
    }
    for (const b of s.bs) bmask[b] = 0;
  }
  return -1;
}

// ------------------------------------------------------------------ lights out
function genLights(f: Floor, rng: RNG, pz: Puzzle, addObj: AddObj): boolean {
  const r = pz.room;
  const n = f.depth >= 4 && r.w >= 9 && r.h >= 9 ? 4 : 3;
  if (r.w < 2 * n + 1 || r.h < 2 * n + 1) return false;
  const ox = r.x + ((r.w - (2 * n - 1)) >> 1);
  const oy = r.y + ((r.h - (2 * n - 1)) >> 1);
  const lit: boolean[] = new Array(n * n).fill(true);
  const press = (i: number) => {
    const x = i % n, y = (i / n) | 0;
    lit[i] = !lit[i];
    if (x > 0) lit[i - 1] = !lit[i - 1];
    if (x < n - 1) lit[i + 1] = !lit[i + 1];
    if (y > 0) lit[i - n] = !lit[i - n];
    if (y < n - 1) lit[i + n] = !lit[i + n];
  };
  const presses = rng.shuffle([...Array(n * n).keys()]).slice(0, rng.int(n, n + 2));
  for (const i of presses) press(i);
  if (lit.every(Boolean)) press(0);
  for (let i = 0; i < n * n; i++) {
    addObj({ kind: 'rune', x: ox + 2 * (i % n), y: oy + 2 * ((i / n) | 0), idx: i, lit: lit[i], puzzle: pz.id });
  }
  pz.n = n;
  // tablet in a corner that isn't by a door
  const corners: Vec[] = [
    { x: r.x, y: r.y }, { x: r.x + r.w - 1, y: r.y }, { x: r.x, y: r.y + r.h - 1 }, { x: r.x + r.w - 1, y: r.y + r.h - 1 },
  ];
  const tc = corners.find((c) => !f.noBoulder[c.y * f.w + c.x]);
  if (tc) addObj({ kind: 'tablet', x: tc.x, y: tc.y, puzzle: pz.id, text: 'lights' });
  pz.riddle = [
    'THE WAKING STONES',
    '',
    'The runes remember the hands that lit them.',
    'Tread upon a stone and it wakes, or sleeps,',
    'and so do its kin: north, south, east and west.',
    '',
    'Wake them all, and the way will open.',
  ];
  return true;
}

// ------------------------------------------------------------------ braziers
function genBraziers(f: Floor, rng: RNG, pz: Puzzle, addObj: AddObj): boolean {
  const r = pz.room;
  if (r.w < 5 || r.h < 5) return false;
  const k = f.depth <= 3 ? 3 : f.depth <= 6 ? 4 : 5;
  const W = f.w;
  const perim = interiorCells(r).filter((c) => {
    if (f.noBoulder[c.y * W + c.x]) return false;
    return c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1;
  });
  rng.shuffle(perim);
  const chosen: Vec[] = [];
  for (const c of perim) {
    if (chosen.length >= k) break;
    if (chosen.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) < 3)) continue;
    chosen.push(c);
  }
  if (chosen.length < k) return false;
  const center = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
  if (f.noBoulder[center.y * W + center.x]) return false;
  const colors = rng.shuffle(BRAZIER_COLORS.slice()).slice(0, k);
  chosen.forEach((c, i) =>
    addObj({ kind: 'brazier', x: c.x, y: c.y, idx: i, color: colors[i].color, cname: colors[i].name, lit: false, puzzle: pz.id }),
  );
  pz.order = rng.shuffle([...Array(k).keys()]);
  addObj({ kind: 'tablet', x: center.x, y: center.y, puzzle: pz.id, text: 'braziers' });
  const lines = pz.order.map((ci, i) => {
    const clue = colors[ci].clue;
    if (i === 0) return `First, ${clue}.`;
    if (i === k - 1) return `Last, ${clue}.`;
    return `Then, ${clue}.`;
  });
  pz.riddle = [
    'THE PYRES OF PENANCE',
    '',
    'Here they burned the faithless, one sin at a time.',
    'Feed the flames as the dying fed them:',
    '',
    ...lines,
    '',
    'Err, and the dark will answer.',
  ];
  return true;
}
