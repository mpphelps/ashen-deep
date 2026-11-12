// The overworld of the Pale: Hollowmere, the Pit, the cemetery, the Rotwood and the chapel highlands.
// Hand-designed and painted in code. Progress gates:
//   rubble (spade) -> Ossuary | broken bridge (quest) + thorns (lantern) -> Rotwood
//   gorge (chain hook) -> Chapel highlands | phantom stair (bell) -> the Throne Below
import { RNG, hash2 } from './rng.ts';
import { T, type Floor, type Room, type Puzzle, type Region, type Spawn, type Vec } from './types.ts';
import { emptyFloor, genSokoban, genLights, genBraziers, type AddObj } from './dungeon.ts';

export const WORLD_W = 120;
export const WORLD_H = 64;

export const G = { GRASS: 0, ROAD: 1, COBBLE: 2, MOSS: 3, STONE: 4, SOIL: 5, ASH: 6, INSIDE: 7, MUD: 8 } as const;

export const PIT = { x: 61, y: 33, r: 9 };
export const START: Vec = { x: 58, y: 44 };

export interface WorldState {
  flag: (f: string) => boolean;
}

export function buildWorld(seed: number, st: WorldState): Floor {
  const W = WORLD_W, H = WORLD_H;
  const f = emptyFloor('world', W, H);
  f.kind = 'world';
  f.biome = 'world';
  f.name = 'The Pale';
  f.ambient = 0.2;
  f.fovR = 30;
  f.depth = 1;
  const tiles = f.tiles, ground = f.ground;
  const rng = new RNG(hash2(seed, 0x5eed));
  const protect = new Uint8Array(W * H); // no random trees here
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
  const set = (x: number, y: number, t: number, g?: number) => {
    if (!inb(x, y)) return;
    tiles[y * W + x] = t;
    if (g !== undefined) ground[y * W + x] = g;
  };
  const get = (x: number, y: number) => (inb(x, y) ? tiles[y * W + x] : T.WALL);
  const prot = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) protect[y * W + x] = 1;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: number, g?: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t, g);
  };
  /** A walled building: walls on the border, `inside` ground within. */
  const building = (x0: number, y0: number, x1: number, y1: number, doors: Vec[], wall: number = T.WALL) => {
    fill(x0, y0, x1, y1, T.FLOOR, G.INSIDE);
    for (let x = x0; x <= x1; x++) {
      set(x, y0, wall);
      set(x, y1, wall);
    }
    for (let y = y0; y <= y1; y++) {
      set(x0, y, wall);
      set(x1, y, wall);
    }
    for (const d of doors) set(d.x, d.y, T.FLOOR, G.INSIDE);
    prot(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  };
  const road = (pts: Vec[], g: number = G.ROAD, width = 1) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
      let x = a.x, y = a.y;
      for (let guard = 0; guard < 400; guard++) {
        for (let w = 0; w < width; w++) {
          const px = x + (sy !== 0 ? w : 0), py = y + (sx !== 0 ? w : 0);
          const t = get(px, py);
          if (t === T.FLOOR || t === T.TREE) set(px, py, T.FLOOR, g);
          if (inb(px, py)) protect[py * W + px] = 1;
        }
        if (x === b.x && y === b.y) break;
        if (x !== b.x) x += sx;
        else y += sy;
      }
    }
  };
  let oid = 1;
  const addObj: AddObj = (o) => {
    const n = { id: oid++, ...o } as typeof f.objects[number];
    f.objects.push(n);
    return n;
  };
  const chest = (x: number, y: number, loot: string) => {
    addObj({ kind: 'chest', x, y, loot, open: st.flag(`chest:world:${x},${y}`) });
  };
  const bonfire = (x: number, y: number) => {
    addObj({ kind: 'bonfire', x, y });
    prot(x - 2, y - 2, x + 2, y + 2);
  };

  // ---------------------------------------------------------------- base terrain
  fill(0, 0, W - 1, H - 1, T.FLOOR, G.GRASS);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) set(x, y, T.WALL);

  // ---------------------------------------------------------------- the river (west)
  const riverC: number[] = [];
  for (let y = 0; y < H; y++) {
    const c = 35 + Math.round(2 * Math.sin(y / 6));
    riverC[y] = c;
    if (y >= 2 && y < H - 2) for (let x = c - 1; x <= c + 1; x++) set(x, y, T.WATER, G.MUD);
  }
  // Rotwood: everything west of a solid treeline
  for (let y = 2; y < H - 2; y++) {
    const c = riverC[y];
    for (let x = 2; x <= c - 2; x++) ground[y * W + x] = G.MOSS;
    for (let x = c - 8; x <= c - 2; x++) set(x, y, T.TREE, G.MOSS);
  }
  // bridge + thorns gate (rows 51..53)
  for (let y = 51; y <= 53; y++) {
    const c = riverC[y];
    for (let x = c - 8; x <= c - 2; x++) set(x, y, T.FLOOR, G.MUD);
    for (let x = c - 1; x <= c + 1; x++) set(x, y, st.flag('bridge') ? T.BRIDGE : T.BROKEN, G.MUD);
    for (const x of [c - 6, c - 5]) set(x, y, T.THORNS, G.MUD);
    prot(c - 9, y, c + 2, y);
  }
  // D2: the hollow tree
  building(7, 6, 13, 12, [{ x: 10, y: 12 }], T.TREE);
  set(10, 8, T.ENTRANCE, G.INSIDE);
  f.entrances.push({ x: 10, y: 8, dungeon: 1 });
  // sinkhole with a phantom path to its island (bell)
  const sink = { x: 14, y: 30, r: 9 };
  for (let y = sink.y - sink.r; y <= sink.y + sink.r; y++)
    for (let x = sink.x - sink.r; x <= sink.x + sink.r; x++) {
      const d = Math.hypot(x - sink.x, y - sink.y);
      if (d <= 1.5) set(x, y, T.FLOOR, G.ASH);
      else if (d <= sink.r) set(x, y, T.CHASM, G.ASH);
    }
  for (let y = sink.y - sink.r; y < sink.y - 1; y++) set(sink.x, y, T.PHANTOM, G.ASH);
  prot(sink.x - sink.r - 1, sink.y - sink.r - 1, sink.x + sink.r + 1, sink.y + sink.r + 1);
  chest(sink.x, sink.y, 'treasure');
  // thorn grove (lantern)
  building(15, 40, 21, 45, [], T.TREE);
  for (let y = 41; y <= 44; y++) for (let x = 16; x <= 20; x++) set(x, y, T.FLOOR, G.MOSS);
  set(18, 45, T.THORNS, G.MOSS);
  chest(18, 42, 'treasure');
  // stone circle (lights puzzle)
  building(3, 43, 13, 53, [{ x: 13, y: 48 }], T.WALL);
  fill(4, 44, 12, 52, T.FLOOR, G.MOSS);
  bonfire(20, 49);
  road([{ x: riverC[52] - 2, y: 52 }, { x: 20, y: 52 }, { x: 20, y: 46 }, { x: 24, y: 46 }, { x: 24, y: 15 }, { x: 10, y: 15 }, { x: 10, y: 13 }], G.MUD);
  road([{ x: 20, y: 52 }, { x: 14, y: 52 }, { x: 14, y: 48 }], G.MUD);

  // ---------------------------------------------------------------- the gorge (east)
  const gorge: number[] = [];
  for (let y = 2; y < H - 2; y++) {
    const g = 97 + Math.round(3 * Math.sin(y / 8));
    gorge[y] = g;
    const half = y >= 17 && y <= 21 ? 2 : 4;
    for (let x = g - half; x <= g + half; x++) set(x, y, T.CHASM, G.ASH);
    for (let x = g + half + 1; x < W - 2; x++) ground[y * W + x] = G.STONE;
  }
  // the Weeping Chapel (D3)
  building(102, 3, 114, 11, [{ x: 108, y: 11 }], T.WALL);
  set(108, 5, T.ENTRANCE, G.INSIDE);
  f.entrances.push({ x: 108, y: 5, dungeon: 2 });
  for (const x of [104, 106, 110, 112]) for (const y of [7, 9]) addObj({ kind: 'deco', x, y, glyph: '═', color: 0x7a5a3a, name: 'a rotten pew', block: true });
  bonfire(gorge[21] + 5, 23);
  road([{ x: gorge[19] + 3, y: 19 }, { x: 108, y: 19 }, { x: 108, y: 12 }], G.ROAD);
  // brazier shrine
  building(100, 42, 108, 49, [{ x: 104, y: 49 }], T.WALL);
  road([{ x: 108, y: 19 }, { x: 110, y: 19 }, { x: 110, y: 52 }, { x: 104, y: 52 }, { x: 104, y: 50 }], G.ROAD);
  // ruins
  for (let k = 0; k < 14; k++) {
    const x = rng.int(gorge[30] + 6, W - 4), y = rng.int(14, H - 5);
    if (protect[y * W + x]) continue;
    const len = rng.int(2, 5), horiz = rng.chance(0.5);
    for (let i = 0; i < len; i++) if (get(x + (horiz ? i : 0), y + (horiz ? 0 : i)) === T.FLOOR) set(x + (horiz ? i : 0), y + (horiz ? 0 : i), T.WALL);
  }

  // ---------------------------------------------------------------- the Pit (D4)
  for (let y = PIT.y - PIT.r - 2; y <= PIT.y + PIT.r + 2; y++)
    for (let x = PIT.x - PIT.r - 2; x <= PIT.x + PIT.r + 2; x++) {
      const d = Math.hypot(x - PIT.x, y - PIT.y);
      if (d <= 1.5) set(x, y, T.FLOOR, G.ASH);
      else if (d <= PIT.r) set(x, y, T.CHASM, G.ASH);
      else if (d <= PIT.r + 2.5) ground[y * W + x] = G.ASH;
    }
  prot(PIT.x - PIT.r - 3, PIT.y - PIT.r - 3, PIT.x + PIT.r + 3, PIT.y + PIT.r + 3);
  set(PIT.x, PIT.y, T.ENTRANCE, G.ASH);
  f.entrances.push({ x: PIT.x, y: PIT.y, dungeon: 3 });
  for (let y = PIT.y + 2; y <= PIT.y + PIT.r; y++) set(PIT.x, y, T.PHANTOM, G.ASH);

  // ---------------------------------------------------------------- Hollowmere (town)
  const TX0 = 42, TY0 = 46, TX1 = 80, TY1 = 61;
  fill(TX0, TY0, TX1, TY1, T.FLOOR, G.COBBLE);
  for (let x = TX0; x <= TX1; x++) {
    set(x, TY0, T.WALL);
    set(x, TY1, T.WALL);
  }
  for (let y = TY0; y <= TY1; y++) {
    set(TX0, y, T.WALL);
    set(TX1, y, T.WALL);
  }
  for (const g of [{ x: 60, y: TY0 }, { x: 61, y: TY0 }, { x: TX0, y: 52 }, { x: TX1, y: 56 }]) set(g.x, g.y, T.FLOOR, G.COBBLE);
  prot(TX0 - 1, TY0 - 1, TX1 + 1, TY1 + 1);
  building(44, 48, 51, 53, [{ x: 47, y: 53 }]); // Sallow
  building(53, 48, 58, 52, [{ x: 55, y: 52 }]); // Pell
  building(64, 48, 70, 52, [{ x: 67, y: 52 }]); // Coyle
  building(72, 48, 78, 53, [{ x: 75, y: 53 }]); // Ambrose's chapel-house
  building(44, 56, 50, 60, [{ x: 50, y: 58 }]); // Gudrun
  addObj({ kind: 'deco', x: 55, y: 50, glyph: '¿', color: 0xb07060, name: 'a meat hook', block: true });
  addObj({ kind: 'deco', x: 56, y: 49, glyph: '¿', color: 0xb07060, name: 'a meat hook', block: true });
  addObj({ kind: 'deco', x: 66, y: 49, glyph: 'Å', color: 0xc0b8a0, name: 'Agnes, in her chair. Her hair has been brushed.', block: true });
  addObj({ kind: 'deco', x: 68, y: 50, glyph: '/', color: 0x9090a0, name: 'a rack of salvaged blades', block: true });
  addObj({ kind: 'deco', x: 46, y: 50, glyph: 'Π', color: 0xc0b0c0, name: 'a bare altar', block: true });
  addObj({ kind: 'deco', x: 75, y: 50, glyph: '†', color: 0xa08070, name: 'a bloodied prayer stool', block: true });
  addObj({ kind: 'deco', x: 47, y: 58, glyph: '═', color: 0x8a6a40, name: 'a workbench', block: true });
  addObj({ kind: 'deco', x: 66, y: 57, glyph: 'O', color: 0x8a8a8a, name: 'the town well. Nobody draws from it anymore.', block: true });
  bonfire(61, 57);
  for (const p of [{ x: 59, y: 47 }, { x: 62, y: 47 }, { x: 43, y: 51 }, { x: 79, y: 55 }, { x: 54, y: 55 }, { x: 70, y: 55 }, { x: 61, y: 60 }])
    addObj({ kind: 'lamp', x: p.x, y: p.y });
  f.npcs.push(
    { id: 'harrow', x: 60, y: 47 },
    { id: 'sallow', x: 47, y: 54 },
    { id: 'pell', x: 55, y: 53 },
    { id: 'coyle', x: 67, y: 53 },
    { id: 'ambrose', x: 75, y: 54 },
    { id: 'gudrun', x: 51, y: 58 },
    { id: 'wick', x: 59, y: 57 },
    { id: 'mouse', x: 64, y: 59 },
  );

  // ---------------------------------------------------------------- the gravedigger's hut
  building(83, 52, 89, 57, [{ x: 86, y: 57 }]);
  chest(85, 54, 'tool:spade');
  if (!st.flag('lore:letter')) f.pickups.push({ x: 87, y: 54, kind: 'lore', id: 'letter' });
  addObj({ kind: 'grave', x: 86, y: 59, name: 'WREN. Fever. Age 7. The earth here has been turned over many times.' });
  road([{ x: TX1, y: 56 }, { x: 82, y: 56 }, { x: 82, y: 58 }, { x: 86, y: 58 }]);

  // ---------------------------------------------------------------- the cemetery
  const CX0 = 44, CY0 = 3, CX1 = 78, CY1 = 21;
  fill(CX0, CY0, CX1, CY1, T.FLOOR, G.SOIL);
  for (let x = CX0; x <= CX1; x++) {
    set(x, CY0, T.FENCE);
    set(x, CY1, T.FENCE);
  }
  for (let y = CY0; y <= CY1; y++) {
    set(CX0, y, T.FENCE);
    set(CX1, y, T.FENCE);
  }
  set(60, CY1, T.FLOOR, G.ROAD);
  set(61, CY1, T.FLOOR, G.ROAD);
  prot(CX0 - 1, CY0 - 1, CX1 + 1, CY1 + 1);
  // the mausoleum and the Ossuary stair (D1), choked with rubble
  building(56, 4, 66, 10, [], T.WALL);
  set(61, 6, T.ENTRANCE, G.INSIDE);
  f.entrances.push({ x: 61, y: 6, dungeon: 0 });
  set(61, 10, st.flag('clr:world:61,10') ? T.FLOOR : T.RUBBLE, G.INSIDE);
  // sunken garden (sokoban)
  building(45, 12, 56, 20, [{ x: 56, y: 16 }], T.WALL);
  // graves
  const yew = { x: 73, y: 12 };
  for (let y = 5; y <= 18; y += 3)
    for (let x = 46; x <= 76; x += 3) {
      if (x >= 44 && x <= 57 && y >= 11) continue; // garden
      if (x >= 55 && x <= 67 && y <= 11) continue; // mausoleum
      if (x >= 59 && x <= 62) continue; // path
      if (Math.abs(x - yew.x) <= 1 && Math.abs(y - yew.y) <= 1) continue;
      if (get(x, y) !== T.FLOOR) continue;
      addObj({ kind: 'grave', x, y, name: 'a weathered grave', dug: st.flag(`grave:world:${x},${y}`) });
    }
  set(yew.x, yew.y, T.TREE, G.SOIL);
  road([{ x: 60, y: CY1 }, { x: 60, y: 11 }, { x: 61, y: 11 }, { x: 61, y: CY1 }], G.ROAD);
  bonfire(64, 19);

  // ---------------------------------------------------------------- the east wilds
  // rubble cave (spade)
  building(84, 8, 90, 14, [], T.WALL);
  set(87, 14, st.flag('clr:world:87,14') ? T.FLOOR : T.RUBBLE, G.INSIDE);
  chest(87, 11, 'treasure');
  // a chasm pocket with an island (hook)
  const pocket = { x: 80, y: 30 };
  for (let y = pocket.y - 4; y <= pocket.y + 4; y++)
    for (let x = pocket.x - 4; x <= pocket.x + 4; x++) {
      const d = Math.hypot(x - pocket.x, y - pocket.y);
      if (d <= 1.5) set(x, y, T.FLOOR, G.ASH);
      else if (d <= 3.5) set(x, y, T.CHASM, G.ASH);
    }
  prot(pocket.x - 5, pocket.y - 5, pocket.x + 5, pocket.y + 5);
  chest(pocket.x + 1, pocket.y, 'treasure');

  // ---------------------------------------------------------------- roads
  road([{ x: 60, y: TY0 }, { x: 60, y: 44 }, { x: 49, y: 44 }, { x: 49, y: 23 }, { x: 60, y: 23 }, { x: 60, y: CY1 }]);
  road([{ x: 61, y: TY0 }, { x: 61, y: 44 }, { x: 73, y: 44 }, { x: 73, y: 23 }, { x: 61, y: 23 }]);
  road([{ x: TX0, y: 52 }, { x: riverC[52] + 2, y: 52 }]);
  road([{ x: 82, y: 56 }, { x: 82, y: 37 }, { x: 87, y: 37 }, { x: 87, y: 15 }]);
  road([{ x: 87, y: 19 }, { x: gorge[19] - 3, y: 19 }]);

  // ---------------------------------------------------------------- scattered dead trees
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (tiles[i] !== T.FLOOR || protect[i]) continue;
      const g = ground[i];
      const p = g === G.MOSS ? 0.16 : g === G.STONE ? 0.04 : g === G.GRASS ? 0.06 : 0;
      if (rng.chance(p)) set(x, y, T.TREE);
    }
  // keep paths clear of trees adjacent to roads? (roads are protected already)

  // ---------------------------------------------------------------- messages from the dead
  const msg = (x: number, y: number, text: string) => {
    if (get(x, y) === T.FLOOR) addObj({ kind: 'message', x, y, text });
  };
  msg(57, 45, 'Welcome home, Digger');
  msg(62, 22, 'The dead do not stay down here');
  msg(riverC[52] + 3, 51, 'Bridge out. Ask the woman with four fingers');
  msg(riverC[52] - 3, 53, 'If only I had fire...');
  msg(gorge[19] - 3, 18, 'Try something with reach');
  msg(PIT.x + 1, PIT.y + PIT.r + 1, 'Ring for the dead');
  msg(86, 15, 'A spade would do it');
  msg(sink.x + 1, sink.y - sink.r - 1, 'Something used to stand here. Ring for it');

  // ---------------------------------------------------------------- puzzles (persisted)
  const rooms: Room[] = [
    { id: 0, x: 46, y: 13, w: 10, h: 7, kind: 'puzzle' }, // sunken garden: sokoban
    { id: 1, x: 4, y: 44, w: 9, h: 9, kind: 'puzzle' }, // stone circle: lights
    { id: 2, x: 101, y: 43, w: 7, h: 6, kind: 'puzzle' }, // shrine: braziers
  ];
  f.rooms = rooms;
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) f.roomAt[y * W + x] = r.id;
  for (let i = W; i < W * H - W; i++) {
    if (tiles[i] === T.WALL || tiles[i] === T.FENCE || f.roomAt[i] >= 0) continue;
    for (const j of [i - 1, i + 1, i - W, i + W]) if (f.roomAt[j] >= 0) f.noBoulder[j] = 1;
  }
  const kinds = ['sokoban', 'lights', 'braziers'] as const;
  const tiers = [2, 4, 6];
  const prng = new RNG(hash2(seed, 0x9a221e));
  rooms.forEach((room, i) => {
    const solvedFlag = st.flag(`pz:world:${i}`);
    const pz: Puzzle = {
      id: f.puzzles.length, kind: kinds[i], room, reward: 'treasure', solved: false, plates: [], boulderStart: [], n: 0,
      order: [], progress: 0, riddle: [],
    };
    f.depth = tiers[i];
    let ok = false;
    for (let a = 0; a < 5 && !ok; a++)
      ok = kinds[i] === 'sokoban' ? genSokoban(f, prng, pz, addObj) : kinds[i] === 'lights' ? genLights(f, prng, pz, addObj) : genBraziers(f, prng, pz, addObj);
    f.puzzles.push(pz);
    if (solvedFlag) {
      pz.solved = true;
      // collapse the solved state: stones on scales, runes awake, pyres burning, reward taken
      if (pz.kind === 'sokoban') {
        const bs = f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id);
        bs.forEach((b, k) => {
          b.x = pz.plates[k].x;
          b.y = pz.plates[k].y;
        });
      }
      for (const o of f.objects) if (o.puzzle === pz.id && (o.kind === 'rune' || o.kind === 'brazier')) o.lit = true;
    }
  });
  f.depth = 1;

  // ---------------------------------------------------------------- regions, enemies
  f.regions = [
    { name: 'Hollowmere', x: TX0, y: TY0, w: TX1 - TX0 + 1, h: TY1 - TY0 + 1, tier: 0, music: 'town' },
    { name: 'The Cemetery', x: CX0, y: CY0, w: CX1 - CX0 + 1, h: CY1 - CY0 + 1, tier: 1, music: 'cemetery' },
    { name: 'The Tithe Pit', x: PIT.x - 13, y: PIT.y - 11, w: 27, h: 24, tier: 1, music: 'pit' },
    { name: 'The Rotwood', x: 0, y: 0, w: 34, h: H, tier: 3, music: 'forest' },
    { name: 'The Chapel Heights', x: 99, y: 0, w: W - 99, h: H, tier: 5, music: 'heights' },
    { name: 'The Pale', x: 0, y: 0, w: W, h: H, tier: 1, music: 'wilds' },
  ];
  const spawnRng = new RNG(hash2(seed, 0xe11e));
  const bonfires = f.objects.filter((o) => o.kind === 'bonfire');
  const spots = (r: Region): Vec[] => {
    const out: Vec[] = [];
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (!inb(x, y) || tiles[y * W + x] !== T.FLOOR || ground[y * W + x] === G.INSIDE || f.roomAt[y * W + x] >= 0) continue;
        if (x >= TX0 - 2 && x <= TX1 + 2 && y >= TY0 - 2) continue;
        if (bonfires.some((b) => Math.abs(b.x - x) <= 6 && Math.abs(b.y - y) <= 6)) continue;
        if (Math.abs(x - START.x) <= 6 && Math.abs(y - START.y) <= 5) continue;
        if (f.objects.some((o) => o.x === x && o.y === y)) continue;
        out.push({ x, y });
      }
    return spawnRng.shuffle(out);
  };
  const populate = (regionName: string, n: number, pool: [string, number][], tier: number, req?: string, inside?: (v: Vec) => boolean) => {
    const r = f.regions.find((q) => q.name === regionName)!;
    const cand = spots(r).filter((v) => !inside || inside(v));
    for (let k = 0; k < n && k < cand.length; k++) f.spawns.push({ def: spawnRng.weighted(pool), x: cand[k].x, y: cand[k].y, elite: spawnRng.chance(0.05), tier, req });
  };
  populate('The Cemetery', 12, [['hollow', 10], ['rat', 3], ['archer', 3]], 1);
  populate('The Rotwood', 18, [['ghoul', 6], ['maggot', 4], ['hound', 6], ['bloated', 3], ['rat', 3]], 3, undefined, (v) => v.x < riverC[v.y] - 8);
  populate('The Chapel Heights', 14, [['flagellant', 6], ['cultist', 4], ['knight', 3], ['choirling', 4], ['archer', 2]], 5, undefined, (v) => v.x > gorge[v.y] + 4);
  populate('The Pale', 8, [['rat', 5], ['hollow', 5], ['hound', 2]], 1, undefined, (v) => v.x > riverC[v.y] + 2 && v.x < gorge[v.y] - 4 && v.y > 22 && !(Math.hypot(v.x - PIT.x, v.y - PIT.y) < PIT.r + 3));
  populate('The Tithe Pit', 6, [['wraith', 1]], 7, 'tool:bell', (v) => Math.hypot(v.x - PIT.x, v.y - PIT.y) > PIT.r + 1);
  const tomas: Spawn = { def: 'hollow', x: yew.x - 1, y: yew.y + 1, elite: true, tier: 2, name: 'Little Tomas', flag: 'tomas_dead', req: '!tomas_dead' };
  f.spawns.push(tomas);

  // ---------------------------------------------------------------- apply persistent changes
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = tiles[y * W + x];
      if ((t === T.RUBBLE || t === T.THORNS) && st.flag(`clr:world:${x},${y}`)) tiles[y * W + x] = T.FLOOR;
    }
  f.start = { ...START };
  f.bonfire = { x: 61, y: 57 };
  return f;
}

export function regionAt(f: Floor, x: number, y: number): Region | null {
  for (const r of f.regions) if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r;
  return null;
}
