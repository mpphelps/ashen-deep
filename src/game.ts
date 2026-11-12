// Core game state + simulation (20 ticks per second).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RNG, hash2 } from './rng.ts';
import {
  T, DIRS, DIRS8, SLOTS, TOOLS,
  type Vec, type Floor, type Obj, type Player, type Enemy, type Tele, type Projectile, type Field, type Fx, type Slot,
  type Puzzle, type ToolId, type Item, type Spawn,
} from './types.ts';
import { generateDungeon } from './dungeon.ts';
import { buildWorld, regionAt, START } from './world.ts';
import { ENEMIES, BOSSES, BOSS_GLYPH, ELITE_MODS, THEMES, MOVES, eliteName, DEATH_LINES, URN_LINES } from './data.ts';
import {
  makeItem, makeUnique, rollLoot, rollRarity, computeStats, weaponBase, scaleBonus, salvageValue, setUidFloor,
  RARITY_COLORS, RARITY_NAMES, INV_MAX, UNIQUES, type Stats, type Drop,
} from './loot.ts';
import { updateEnemy, updateBoss } from './ai.ts';
import { useSkill, tickSkills, skillDamageMult, shoot, resolveSkill, updateThrall, talentInput, respec } from './skills.ts';
import { computeFov } from './fov.ts';
import { DUNGEONS, NPCS, LORE, QUESTS, QUEST_ITEMS, TOOL_INFO, TOOL_TILE_NAME, type NpcDef, type Stash } from './story.ts';

export const BLOCKING = new Set(['chest', 'urn', 'brazier', 'boulder', 'tablet', 'bonfire', 'grave', 'lamp']);
const PARRY_TOTAL = 14;
const PARRY_WINDOW = 6;
export const HOOK_RANGE = 7;
const RESONANCE = 260;
const SAVE_PATH = path.join(os.homedir(), '.ashen-deep-save.json');

export type Mode =
  | 'title' | 'play' | 'inv' | 'bonfire' | 'read' | 'dead' | 'map' | 'help' | 'confirmQuit'
  | 'dialog' | 'shop' | 'journal' | 'travel' | 'ending' | 'talents';

export interface Msg {
  text: string;
  color: number;
  t: number;
}
export interface Banner {
  text: string;
  sub: string;
  color: number;
  t: number;
  max: number;
}
export interface Modal {
  title: string;
  lines: string[];
  kind: string; // read | soko | confirm
  puzzle?: Puzzle;
  onYes?: () => void;
}
export interface DialogState {
  npc: NpcDef;
  lines: string[];
  page: number;
  after?: () => void;
  shop?: string;
}
export interface JournalEntry {
  title: string;
  text: string;
  color: number;
  glyph?: string;
  group?: string;
  unknown?: boolean;
}
export interface ShopEntry {
  name: string;
  desc: string[];
  price: number;
  color: number;
  buy: () => void;
  soldOut?: boolean;
  item?: Item;
}

export function levelCost(level: number): number {
  return Math.round(60 * Math.pow(1.13, level - 1) + level * 8);
}

export function spaced(s: string): string {
  return s.toUpperCase().split('').join(' ');
}

function newPlayer(): Player {
  return {
    x: 0, y: 0, face: { x: 0, y: 1 }, hp: 100, sta: 80, staDelay: 0, level: 1, vig: 5, end: 5, str: 5, dex: 5,
    ashes: 0, flasks: 3, maxFlasks: 3, keys: 0, inv: [],
    eq: { weapon: null, helm: null, chest: null, ring: null, amulet: null },
    act: null, iframes: 0, moveCd: 0, flash: 0, poison: 0, burn: 0,
    tools: [], tool: -1, salts: 0, lastSafe: { x: 0, y: 0 },
    talents: [], talentPoints: 1, slots: [null, null, null], cds: {}, guard: false,
    buffs: { warcry: 0, bone: 0, boneT: 0, aim: 0 },
  };
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const BOSS_STORY: Record<string, { lore?: string; quest?: string }> = {
  warden: { lore: 'warden_book', quest: 'warden_chain' },
  mother: { lore: 'swaddle' },
  choir: { lore: 'tongue' },
  king: {},
};
export const WORLD_BONFIRE = { key: 'world', x: 61, y: 58 };

export class Game {
  mode: Mode = 'title';
  tick = 0;
  seed: number;
  rng: RNG;
  depth = 1;
  floor: Floor = null as unknown as Floor;
  floors = new Map<string, Floor>();
  player: Player = newPlayer();
  stats: Stats = computeStats(this.player, 0);
  enemies: Enemy[] = [];
  teles: Tele[] = [];
  projs: Projectile[] = [];
  fields: Field[] = [];
  fx: Fx[] = [];
  msgs: Msg[] = [];
  banner: Banner | null = null;
  modal: Modal | null = null;
  dialog: DialogState | null = null;
  shopId = '';
  shopSel = 0;
  journalTab = 0;
  journalSel = 0;
  talentCol = 0;
  talentRow = 0;
  travelSel = 0;
  vis: Float32Array = new Float32Array(1);
  fovMask: Uint8Array = new Uint8Array(1);
  dist: Int32Array = new Int32Array(1);
  bossActive = false;
  shake = 0;
  noise = 0;
  target: Enemy | null = null;
  targetT = 0;
  buf: { k: string; t: number } | null = null;
  invSel = 0;
  bonSel = 0;
  titleSel = 0;
  helpReturn: Mode = 'play';
  deadT = 0;
  deathLine = '';
  deaths = 0;
  kills = 0;
  lament = 0;
  quit = false;
  embers: { x: number; y: number; v: number; c: number }[] = [];
  nextId = 1;
  saveEnabled = true;
  lastGlance = 0;
  sounds: string[] = [];
  audioLabel = '';
  // ---- story state
  flags = new Set<string>();
  quests: Record<string, number> = {};
  questItems: Record<string, number> = {};
  lore: string[] = [];
  counters: Record<string, number> = {};
  floorKeys: Record<string, number> = {};
  respawnAt = { ...WORLD_BONFIRE };
  stain: { key: string; x: number; y: number; amount: number } | null = null;
  resonance = 0;
  regionName = '';
  endingStep = 0;
  endingChoice = '';
  pendingEnding = false;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rng = new RNG(hash2(this.seed, 0xabc));
  }

  // ================================================================ lifecycle
  newGame(): void {
    this.player = newPlayer();
    this.player.eq.weapon = makeItem(this.rng, 1, 0, 'weapon', 'sword');
    this.player.inv.push(makeItem(this.rng, 1, 0, 'chest'));
    this.recalc();
    this.player.hp = this.stats.maxHp;
    this.player.sta = this.stats.maxSta;
    this.deaths = 0;
    this.kills = 0;
    this.lament = 0;
    this.msgs = [];
    this.flags = new Set();
    this.quests = {};
    this.questItems = {};
    this.lore = [];
    this.counters = {};
    this.floorKeys = {};
    this.floors.clear();
    this.floor = null as unknown as Floor;
    this.stain = null;
    this.pendingEnding = false;
    this.respawnAt = { ...WORLD_BONFIRE };
    this.setFlag('fire:world:61,57');
    this.enterLocation('world', START);
    this.modal = {
      title: 'THE TITHE PIT',
      kind: 'read',
      lines: [
        'You wake at the bottom of the Pit with dirt in your mouth.',
        'You climb. It takes a long time. Your hands know how to climb out of a hole;',
        'they have done it before.',
        '',
        'At the top, the sky is the color of a bruise. It has not been day for a long time.',
        'South, behind a wall, there are lights. People.',
        '',
        'They will not be glad to see you.',
      ],
    };
    this.mode = 'read';
    this.log('You crawl out of the Pit. The town of Hollowmere lies south.', 0xd0a060);
    this.log('Press ? for controls. B opens your journal.', 0x8a8478);
  }

  recalc(): void {
    this.stats = computeStats(this.player, this.lament);
    if (this.player.hp > this.stats.maxHp) this.player.hp = this.stats.maxHp;
    if (this.player.sta > this.stats.maxSta) this.player.sta = this.stats.maxSta;
  }

  // ================================================================ story state API (used by story.ts)
  flag(f: string): boolean {
    if (f.startsWith('!')) return !this.flag(f.slice(1));
    if (f.startsWith('tool:')) return this.player.tools.includes(f.slice(5) as ToolId);
    return this.flags.has(f);
  }
  setFlag(f: string): void {
    this.flags.add(f);
    if (f === 'bridge') {
      // the bridge is mended in the live world too, not just on reload
      const w = this.floors.get('world');
      if (w) for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === T.BROKEN) w.tiles[i] = T.BRIDGE;
    }
  }
  quest(id: string): number {
    return this.quests[id] ?? 0;
  }
  setQuest(id: string, stage: number): void {
    const old = this.quest(id);
    if (stage <= old) return;
    this.quests[id] = stage;
    const q = QUESTS[id];
    const done = stage >= q.stages.length - 1;
    if (old === 0 && !done) this.log(`New quest: ${q.title}`, 0xffd060);
    else if (done) this.log(`Quest complete: ${q.title}`, 0xffd060);
    else this.log(`Quest updated: ${q.title}`, 0xffd060);
    this.sfx('page');
  }
  bossDead(id: string): boolean {
    return this.flags.has(`boss:${id}`);
  }
  hasQuestItem(id: string, n = 1): boolean {
    return (this.questItems[id] ?? 0) >= n;
  }
  questItemCount(id: string): number {
    return this.questItems[id] ?? 0;
  }
  takeQuestItem(id: string, n = 1): void {
    this.questItems[id] = Math.max(0, (this.questItems[id] ?? 0) - n);
  }
  giveQuestItem(id: string): void {
    this.questItems[id] = (this.questItems[id] ?? 0) + 1;
    this.log(`Obtained: ${QUEST_ITEMS[id]}`, 0xffe0a0);
    this.sfx('key');
  }
  giveLore(id: string): void {
    if (this.lore.includes(id)) return;
    this.lore.push(id);
    this.setFlag(`lore:${id}`);
    this.log(`Journal: "${LORE[id].title}"  (B to read)`, 0xe0c8a0);
    this.sfx('page');
  }
  giveUnique(id: string): void {
    const it = makeUnique(this.rng, id, Math.max(2, this.progressTier()));
    if (this.player.inv.length < INV_MAX) this.player.inv.push(it);
    else this.floor.pickups.push({ x: this.player.x, y: this.player.y, kind: 'item', item: it });
    this.log(`Received: ${it.name}`, RARITY_COLORS[3]);
  }
  giveTool(t: ToolId): void {
    const p = this.player;
    if (p.tools.includes(t)) return;
    p.tools.push(t);
    p.tool = TOOLS.indexOf(t);
    const info = TOOL_INFO[t];
    this.banner = { text: spaced(info.name), sub: 'a new tool', color: info.color, t: 60, max: 60 };
    this.sfx('legendary');
    this.recalc();
    this.modal = { title: info.name.toUpperCase(), kind: 'read', lines: [info.found, '', info.desc, '', `Select it with [${TOOLS.indexOf(t) + 1}], use it with [R].`] };
    this.mode = 'read';
  }
  progressTier(): number {
    return 1 + ['warden', 'mother', 'choir', 'king'].filter((b) => this.bossDead(b)).length * 2;
  }
  tierHere(): number {
    if (this.floor.kind === 'world') return regionAt(this.floor, this.player.x, this.player.y)?.tier || 1;
    return this.floor.depth;
  }

  // ================================================================ locations
  getFloor(key: string): Floor {
    const cached = this.floors.get(key);
    if (cached) return cached;
    let f: Floor;
    if (key === 'world') f = buildWorld(this.seed, { flag: (x) => this.flag(x) });
    else {
      const m = /^d(\d)f(\d)$/.exec(key)!;
      const d = +m[1], lv = +m[2];
      const def = DUNGEONS[d];
      f = generateDungeon(
        {
          key, dungeon: d, level: lv, name: def.name, biome: def.biome, tier: def.tiers[lv], plan: def.floors[lv],
          bossId: def.floors[lv].boss ? def.boss : null,
          hasTool: (t) => this.player.tools.includes(t),
          wantStash: (s: Stash) =>
            s.kind === 'lore' ? !this.lore.includes(s.id) : !this.hasQuestItem(s.id) && !(s.quest && this.quest(s.quest) >= QUESTS[s.quest].stages.length - 1),
        },
        hash2(this.seed, 100 + d * 10 + lv),
      );
      if (f.bossId && this.bossDead(f.bossId)) this.openArena(f);
    }
    this.applyPersistence(f);
    this.floors.set(key, f);
    return f;
  }

  /** Re-apply everything the player has permanently changed on this floor. */
  applyPersistence(f: Floor): void {
    const k = f.key;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        if (!this.flags.has(`clr:${k}:${x},${y}`)) continue;
        const i = y * f.w + x;
        f.tiles[i] = f.tiles[i] === T.LOCKED ? T.OPEN : T.FLOOR;
      }
    for (const o of f.objects) {
      if (o.kind === 'chest' && this.flags.has(`chest:${k}:${o.x},${o.y}`)) o.open = true;
      if (o.kind === 'grave' && this.flags.has(`grave:${k}:${o.x},${o.y}`)) o.dug = true;
    }
    for (const pz of f.puzzles) {
      if (!this.flags.has(`pz:${k}:${pz.id}`)) continue;
      pz.solved = true;
      if (pz.kind === 'sokoban') {
        f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id).forEach((b, i) => {
          b.x = pz.plates[i].x;
          b.y = pz.plates[i].y;
        });
      }
      for (const o of f.objects) if (o.puzzle === pz.id && (o.kind === 'rune' || o.kind === 'brazier')) o.lit = true;
      const c = this.rewardSpot(f, pz);
      if (c) f.objects.push({ id: 9000 + pz.id, kind: 'chest', x: c.x, y: c.y, loot: 'treasure', open: this.flags.has(`chest:${k}:${c.x},${c.y}`) });
    }
    f.pickups = f.pickups.filter((pk) => !(pk.kind === 'lore' && this.lore.includes(pk.id!)));
    if (this.stain && this.stain.key === k && !f.pickups.some((p) => p.stain))
      f.pickups.push({ x: this.stain.x, y: this.stain.y, kind: 'ashes', amount: this.stain.amount, stain: true });
  }

  openArena(f: Floor): void {
    const r = f.bossRoom!;
    f.tiles[f.lockedDoor.y * f.w + f.lockedDoor.x] = T.OPEN;
    f.tiles[(r.y + (r.h >> 1)) * f.w + r.x + (r.w >> 1)] = T.UPSTAIRS;
  }

  enterLocation(key: string, at?: Vec): void {
    if (this.floor) {
      this.floor.liveEnemies = this.enemies.filter((e) => !e.dead && !e.boss && !e.ally);
      this.floorKeys[this.floor.key] = this.player.keys;
      const fd = this.floor.lockedDoor;
      if (this.inBounds(fd.x, fd.y) && this.tileAt(fd.x, fd.y) === T.FOG) this.floor.tiles[this.idx(fd.x, fd.y)] = T.OPEN;
    }
    const f = this.getFloor(key);
    this.floor = f;
    const N = f.w * f.h;
    this.vis = new Float32Array(N);
    this.fovMask = new Uint8Array(N);
    this.dist = new Int32Array(N);
    const p = this.player;
    const pos = at ?? f.start;
    p.x = pos.x;
    p.y = pos.y;
    p.lastSafe = { ...pos };
    p.act = null;
    p.keys = this.floorKeys[key] ?? 0;
    this.depth = f.depth;
    this.teles = [];
    this.projs = [];
    this.fields = [];
    this.fx = [];
    this.bossActive = false;
    this.target = null;
    this.resonance = 0;
    if (f.needsRespawn || !f.liveEnemies) this.spawnEnemies();
    else {
      this.enemies = f.liveEnemies;
      this.addBossIfAlive();
    }
    f.needsRespawn = false;
    this.updateFov();
    if (f.kind === 'dungeon') {
      const def = DUNGEONS[f.dungeon];
      this.banner = { text: spaced(def.name), sub: `${['First', 'Second', 'Third'][f.level] ?? ''} descent${f.bossId && !this.bossDead(f.bossId) ? '  ·  something vast is waiting' : ''}`, color: 0xd8c8a8, t: 70, max: 70 };
      this.regionName = def.name;
    } else {
      this.regionName = '';
      this.checkRegion();
    }
    this.save();
  }

  checkRegion(): void {
    if (this.floor.kind !== 'world') return;
    const r = regionAt(this.floor, this.player.x, this.player.y);
    const name = r?.name ?? 'The Pale';
    if (name !== this.regionName) {
      const first = !this.flags.has(`region:${name}`);
      this.regionName = name;
      if (first || name === 'Hollowmere') this.banner = { text: spaced(name), sub: '', color: name === 'Hollowmere' ? 0xffc070 : 0xc8c0a8, t: 50, max: 50 };
      this.setFlag(`region:${name}`);
    }
  }

  spawnEnemies(): void {
    const f = this.floor;
    this.enemies = [];
    for (const s of f.spawns) {
      if (s.req && !this.flag(s.req)) continue;
      this.enemies.push(this.makeEnemyFromSpawn(s));
    }
    this.addBossIfAlive();
  }

  addBossIfAlive(): void {
    const f = this.floor;
    if (f.bossId && f.bossRoom && !this.bossDead(f.bossId) && !this.enemies.some((e) => e.boss)) {
      const r = f.bossRoom;
      this.enemies.push(this.makeBoss(f.bossId, r.x + (r.w >> 1), r.y + (r.h >> 1)));
    }
  }

  makeEnemyFromSpawn(s: Spawn): Enemy {
    const e = this.makeEnemy(s.def, s.x, s.y, s.elite, s.tier ?? this.floor.depth);
    if (s.name) {
      e.name = s.name;
      e.elite = e.elite ?? { mods: [] };
    }
    if (s.flag) e.flag = s.flag;
    return e;
  }

  makeEnemy(defId: string, x: number, y: number, elite: boolean, tier = this.depth): Enemy {
    const d = ENEMIES[defId];
    const sc = 1 + 0.3 * (tier - 1);
    const dsc = 1 + 0.18 * (tier - 1);
    const e: Enemy = {
      id: this.nextId++, def: defId, boss: null, name: d.name, x, y, size: 1,
      hp: Math.round(d.hp * sc), maxHp: Math.round(d.hp * sc), dmg: d.dmg * dsc, poise: d.poise, maxPoise: d.poise,
      speed: d.speed, state: 'idle', t: 0, cd: 0, moveT: this.rng.int(0, d.speed), face: { ...this.rng.pick(DIRS) },
      aware: false, lostT: 0, flash: 0, alertT: 0, burn: 0, bleed: 0, elite: null, combo: 0, phase: 0, riposte: 0,
      wmult: 1, birthCd: 0, dead: false, ashes: Math.round(d.ashes * (1 + 0.18 * (tier - 1))), tier, flag: null,
      ally: false, venom: 0, blind: 0,
    };
    if (elite) {
      const mods = this.rng.shuffle(ELITE_MODS.slice()).slice(0, this.rng.int(1, 2));
      e.elite = { mods };
      e.name = eliteName(this.rng);
      e.hp = e.maxHp = Math.round(e.maxHp * 2.4);
      e.dmg *= 1.25;
      e.ashes *= 4;
      if (mods.includes('frenzied')) {
        e.speed = Math.max(2, Math.round(e.speed * 0.6));
        e.wmult = 0.75;
      }
      if (mods.includes('stoneskin')) {
        e.hp = e.maxHp = Math.round(e.maxHp * 1.5);
        e.maxPoise = e.poise = e.maxPoise * 2;
      }
    }
    return e;
  }

  makeBoss(id: string, x: number, y: number): Enemy {
    const b = BOSSES[id];
    return {
      id: this.nextId++, def: 'hollow', boss: id, name: b.name, x, y, size: 3,
      hp: b.hp, maxHp: b.hp, dmg: b.dmg, poise: b.poise, maxPoise: b.poise,
      speed: b.speed, state: 'idle', t: 0, cd: 20, moveT: 0, face: { x: 0, y: 1 }, aware: true, lostT: 0, flash: 0,
      alertT: 0, burn: 0, bleed: 0, elite: null, combo: 0, phase: 0, riposte: 0, wmult: 1, birthCd: 60, dead: false,
      ashes: b.ashes, tier: this.floor.depth, flag: null, ally: false, venom: 0, blind: 0,
    };
  }

  // ================================================================ save / load
  save(): void {
    if (!this.saveEnabled || this.mode === 'title' || !this.floor) return;
    try {
      this.floorKeys[this.floor.key] = this.player.keys;
      const p = { ...this.player, act: null };
      fs.writeFileSync(
        SAVE_PATH,
        JSON.stringify({
          v: 2, seed: this.seed, player: p, deaths: this.deaths, kills: this.kills, flags: [...this.flags], quests: this.quests,
          questItems: this.questItems, lore: this.lore, counters: this.counters, floorKeys: this.floorKeys,
          respawn: this.respawnAt, stain: this.stain,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  static hasSave(): boolean {
    try {
      if (!fs.existsSync(SAVE_PATH)) return false;
      return JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8')).v === 2;
    } catch {
      return false;
    }
  }

  load(): boolean {
    try {
      const d = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
      if (d.v !== 2) return false;
      this.seed = d.seed >>> 0;
      this.rng = new RNG(hash2(this.seed, 0xabc + (d.kills ?? 0)));
      this.player = { ...newPlayer(), ...d.player, act: null };
      let maxUid = 0;
      for (const it of [...this.player.inv, ...SLOTS.map((s) => this.player.eq[s])]) if (it) maxUid = Math.max(maxUid, it.uid);
      setUidFloor(maxUid);
      this.deaths = d.deaths ?? 0;
      this.kills = d.kills ?? 0;
      this.flags = new Set(d.flags ?? []);
      this.quests = d.quests ?? {};
      this.questItems = d.questItems ?? {};
      this.lore = d.lore ?? [];
      this.counters = d.counters ?? {};
      this.floorKeys = d.floorKeys ?? {};
      this.respawnAt = d.respawn ?? { ...WORLD_BONFIRE };
      this.stain = d.stain ?? null;
      this.lament = 0;
      this.pendingEnding = false;
      this.msgs = [];
      this.floors.clear();
      this.floor = null as unknown as Floor;
      this.recalc();
      this.player.hp = this.stats.maxHp;
      this.player.flasks = this.player.maxFlasks;
      this.mode = 'play';
      this.enterLocation(this.respawnAt.key, { x: this.respawnAt.x, y: this.respawnAt.y });
      this.log('You rise from the ashes of your last rest.', 0xd0a060);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================ messaging / audio
  sfx(id: string): void {
    if (this.sounds.length < 24) this.sounds.push(id);
  }
  sfxAt(id: string, x: number, y: number): void {
    if (this.inBounds(x, y) && this.vis[this.idx(x, y)] > 0) this.sfx(id);
  }
  musicTrack(): string | null {
    if (this.mode === 'title' || (this.mode === 'help' && this.helpReturn === 'title')) return 'title';
    if (this.mode === 'dead') return null;
    if (this.mode === 'ending') return 'title';
    if (!this.floor) return 'title';
    if (this.bossActive) return 'boss';
    if (this.floor.kind === 'dungeon') return DUNGEONS[this.floor.dungeon].music;
    return regionAt(this.floor, this.player.x, this.player.y)?.music ?? 'wilds';
  }

  log(text: string, color = 0xc8c0b0): void {
    this.msgs.push({ text, color, t: this.tick });
    if (this.msgs.length > 80) this.msgs.shift();
  }

  addFx(x: number, y: number, ch: string, color: number, t = 4): void {
    this.fx.push({ x, y, ch, color, t });
  }

  // ================================================================ input
  input(key: string, raw: string): void {
    switch (this.mode) {
      case 'title': return this.titleInput(key);
      case 'play': {
        if (key === 'inv') { this.mode = 'inv'; this.invSel = 0; return; }
        if (key === 'map') { this.mode = 'map'; return; }
        if (key === 'help') { this.mode = 'help'; this.helpReturn = 'play'; return; }
        if (key === 'journal') { this.mode = 'journal'; this.journalSel = 0; return; }
        if (key === 'talents') { this.mode = 'talents'; return; }
        if (key === 'esc') { this.mode = 'confirmQuit'; return; }
        if (raw >= '1' && raw <= '4') {
          const t = TOOLS[+raw - 1];
          if (this.player.tools.includes(t)) {
            this.player.tool = +raw - 1;
            this.log(`${TOOL_INFO[t].name} in hand.`, TOOL_INFO[t].color);
            this.sfx('menu');
          }
          return;
        }
        if (['up', 'down', 'left', 'right', 'attack', 'heavy', 'roll', 'parry', 'flask', 'interact', 'tool', 'skill1', 'skill2', 'skill3'].includes(key))
          this.buf = { k: key, t: this.tick };
        return;
      }
      case 'inv': return this.invInput(key, raw);
      case 'bonfire': return this.bonfireInput(key);
      case 'travel': return this.travelInput(key);
      case 'dialog': return this.dialogInput(key);
      case 'shop': return this.shopInput(key);
      case 'journal': return this.journalInput(key);
      case 'ending': return this.endingInput(key, raw);
      case 'talents': return talentInput(this, key, raw);
      case 'read': {
        const m = this.modal;
        if (m?.kind === 'confirm') {
          if (key === 'enter' || key === 'interact' || raw === 'y') {
            this.modal = null;
            this.mode = 'play';
            m.onYes?.();
          } else if (key === 'esc' || raw === 'n') {
            this.modal = null;
            this.mode = 'play';
          }
          return;
        }
        if (raw === 'r' && m?.kind === 'soko' && m.puzzle) {
          this.resetSokoban(m.puzzle);
          this.modal = null;
          this.mode = 'play';
          return;
        }
        if (['esc', 'enter', 'interact', 'roll', 'attack'].includes(key)) {
          this.modal = null;
          this.mode = 'play';
        }
        return;
      }
      case 'map':
        this.mode = 'play';
        return;
      case 'help':
        this.mode = this.helpReturn;
        return;
      case 'dead':
        if (this.deadT > 45) this.respawn();
        return;
      case 'confirmQuit':
        if (raw === 'y') { this.save(); this.mode = 'title'; this.titleSel = 0; }
        else if (raw === 'n' || key === 'esc') this.mode = 'play';
        return;
    }
  }

  titleOptions(): string[] {
    const o: string[] = [];
    if (this.saveEnabled && Game.hasSave()) o.push('Continue');
    o.push('New Descent', 'How to Play', 'Quit');
    return o;
  }

  titleInput(key: string): void {
    const opts = this.titleOptions();
    if (key === 'up') { this.titleSel = (this.titleSel + opts.length - 1) % opts.length; this.sfx('menu'); }
    else if (key === 'down') { this.titleSel = (this.titleSel + 1) % opts.length; this.sfx('menu'); }
    else if (key === 'enter' || key === 'interact' || key === 'attack') {
      const o = opts[this.titleSel];
      this.sfx('select');
      if (o === 'Continue') { if (!this.load()) this.newGame(); }
      else if (o === 'New Descent') {
        this.seed = (Math.random() * 2 ** 32) >>> 0;
        this.rng = new RNG(hash2(this.seed, 0xabc));
        this.newGame();
      } else if (o === 'How to Play') { this.helpReturn = 'title'; this.mode = 'help'; }
      else if (o === 'Quit') this.quit = true;
    } else if (key === 'esc') this.quit = true;
  }

  invEntries(): ({ eq: Slot } | { bag: number })[] {
    const out: ({ eq: Slot } | { bag: number })[] = SLOTS.map((s) => ({ eq: s }));
    for (let i = 0; i < this.player.inv.length; i++) out.push({ bag: i });
    return out;
  }

  invInput(key: string, raw: string): void {
    const entries = this.invEntries();
    const p = this.player;
    if (key === 'esc' || key === 'inv') { this.mode = 'play'; return; }
    if (key === 'up') { this.invSel = (this.invSel + entries.length - 1) % entries.length; this.sfx('menu'); }
    else if (key === 'down') { this.invSel = (this.invSel + 1) % entries.length; this.sfx('menu'); }
    const sel = entries[this.invSel];
    if (!sel) return;
    if (key === 'enter' || key === 'interact') {
      if ('eq' in sel) {
        const it = p.eq[sel.eq];
        if (it && p.inv.length < INV_MAX) {
          p.inv.push(it);
          p.eq[sel.eq] = null;
          this.log(`You remove ${it.name}.`);
        }
      } else {
        const it = p.inv[sel.bag];
        const old = p.eq[it.slot];
        p.eq[it.slot] = it;
        if (old) p.inv.splice(sel.bag, 1, old);
        else p.inv.splice(sel.bag, 1);
        this.log(`You equip ${it.name}.`, RARITY_COLORS[it.rarity]);
        this.sfx('select');
      }
      this.recalc();
    } else if (raw === 'x' && 'bag' in sel) {
      const it = p.inv[sel.bag];
      const v = salvageValue(it);
      p.ashes += v;
      p.inv.splice(sel.bag, 1);
      this.log(`You grind ${it.name} into ${v} ashes.`, 0xb0a8ff);
      this.sfx('urn');
    }
    const n = this.invEntries().length;
    if (this.invSel >= n) this.invSel = n - 1;
  }

  bonfireOptions(): string[] {
    return ['Vigor', 'Endurance', 'Strength', 'Dexterity', 'Talents', 'Forget talents', 'Travel', 'Leave'];
  }

  bonfireInput(key: string): void {
    const p = this.player;
    const n = this.bonfireOptions().length;
    if (key === 'esc') { this.mode = 'play'; return; }
    if (key === 'up') { this.bonSel = (this.bonSel + n - 1) % n; this.sfx('menu'); }
    else if (key === 'down') { this.bonSel = (this.bonSel + 1) % n; this.sfx('menu'); }
    else if (key === 'enter' || key === 'interact') {
      if (this.bonSel === 7) { this.mode = 'play'; return; }
      if (this.bonSel === 6) { this.mode = 'travel'; this.travelSel = 0; return; }
      if (this.bonSel === 5) { respec(this); return; }
      if (this.bonSel === 4) { this.mode = 'talents'; return; }
      const cost = levelCost(p.level);
      if (p.ashes < cost) { this.log('You lack the ashes. The flame is unimpressed.', 0x8a8478); this.sfx('locked'); return; }
      p.ashes -= cost;
      p.level++;
      const attr = (['vig', 'end', 'str', 'dex'] as const)[this.bonSel];
      p[attr]++;
      this.recalc();
      p.hp = this.stats.maxHp;
      p.sta = this.stats.maxSta;
      p.talentPoints++;
      this.log(`You feel stronger. Level ${p.level}. +1 talent point (T).`, 0xffd080);
      this.sfx('levelup');
      this.save();
    }
  }

  /** Every bonfire the player has rested at. */
  travelTargets(): { key: string; x: number; y: number; name: string }[] {
    const out: { key: string; x: number; y: number; name: string }[] = [];
    for (const f of this.flags) {
      const m = /^fire:([^:]+):(\d+),(\d+)$/.exec(f);
      if (!m) continue;
      const key = m[1], x = +m[2], y = +m[3];
      let name: string;
      if (key === 'world') name = regionAt(this.getFloor('world'), x, y)?.name ?? 'The Pale';
      else {
        const d = /^d(\d)f(\d)$/.exec(key)!;
        name = `${DUNGEONS[+d[1]].name}, ${['first', 'second'][+d[2]]} descent`;
      }
      out.push({ key, x, y, name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  travelInput(key: string): void {
    const t = this.travelTargets();
    if (key === 'esc') { this.mode = 'bonfire'; return; }
    if (!t.length) return;
    if (key === 'up') { this.travelSel = (this.travelSel + t.length - 1) % t.length; this.sfx('menu'); }
    else if (key === 'down') { this.travelSel = (this.travelSel + 1) % t.length; this.sfx('menu'); }
    else if (key === 'enter' || key === 'interact') {
      const dst = t[this.travelSel];
      this.sfx('descend');
      this.mode = 'play';
      this.respawnAt = { key: dst.key, x: dst.x, y: dst.y + 1 };
      this.enterLocation(dst.key, { x: dst.x, y: dst.y + 1 });
      this.log('The flames fold you up and set you down somewhere else.', 0xffa040);
    }
  }

  // ---- dialog
  talkTo(npc: NpcDef): void {
    const d = npc.talk(this);
    this.dialog = { npc, lines: d.lines, page: 0, after: d.after, shop: d.shop };
    this.mode = 'dialog';
    this.buf = null;
    this.sfx('talk');
  }

  dialogInput(key: string): void {
    const d = this.dialog;
    if (!d) { this.mode = 'play'; return; }
    const close = () => {
      this.dialog = null;
      this.mode = 'play';
      d.after?.();
      if (d.shop && this.mode === 'play') this.openShop(d.shop);
      this.save();
    };
    if (key === 'esc') return close();
    if (['enter', 'interact', 'attack', 'roll', 'down', 'right'].includes(key)) {
      if (d.page < d.lines.length - 1) {
        d.page++;
        this.sfx('talk');
      } else close();
    }
  }

  // ---- shops
  openShop(id: string): void {
    this.shopId = id;
    this.shopSel = 0;
    this.mode = 'shop';
  }

  shopEntries(): ShopEntry[] {
    const p = this.player;
    if (this.shopId === 'pell') {
      const tallow = this.counters.pell_tallow ?? 0;
      return [
        {
          name: 'Rendered Tallow', color: 0xfff0b0, price: [500, 900, 1400][tallow] ?? 0, soldOut: tallow >= 3,
          desc: ['+1 flask charge, permanently.', '"Rendered from the finest. Don\'t ask the finest what."'],
          buy: () => {
            this.counters.pell_tallow = tallow + 1;
            p.maxFlasks++;
            p.flasks++;
          },
        },
        {
          name: 'Embalming Salts', color: 0xd0e0f0, price: [350, 700, 1100][p.salts] ?? 0, soldOut: p.salts >= 3,
          desc: ['Your flasks heal 12% more, permanently.', '"Same salts I used on you. Kept you lovely."'],
          buy: () => {
            p.salts++;
            this.recalc();
          },
        },
      ];
    }
    // Coyle: gear restocks whenever something big dies
    const b = ['warden', 'mother', 'choir', 'king'].filter((x) => this.bossDead(x)).length;
    const rng = new RNG(hash2(this.seed, 0xc0 + b));
    const disc = this.quest('ring') >= 2 ? 0.7 : 1;
    const out: ShopEntry[] = [];
    for (let i = 0; i < 6; i++) {
      const ilvl = 2 + b * 2;
      const r = i < 1 ? 0 : i < 4 ? 1 : 2;
      const it = makeItem(rng, ilvl, i === 5 && rollRarity(rng, ilvl, 50) >= 2 ? 2 : r);
      const sold = this.flags.has(`sold:${b}:${i}`);
      out.push({
        name: it.name, color: RARITY_COLORS[it.rarity], price: Math.round([60, 220, 650, 2400][it.rarity] * (1 + ilvl * 0.2) * disc),
        soldOut: sold, desc: [], item: it,
        buy: () => {
          this.setFlag(`sold:${b}:${i}`);
          const copy = { ...it, uid: makeItem(this.rng, 1, 0).uid };
          if (p.inv.length < INV_MAX) p.inv.push(copy);
          else this.floor.pickups.push({ x: p.x, y: p.y, kind: 'item', item: copy });
        },
      });
    }
    return out;
  }

  shopInput(key: string): void {
    const e = this.shopEntries();
    if (key === 'esc' || key === 'inv') { this.mode = 'play'; return; }
    if (key === 'up') { this.shopSel = (this.shopSel + e.length - 1) % e.length; this.sfx('menu'); }
    else if (key === 'down') { this.shopSel = (this.shopSel + 1) % e.length; this.sfx('menu'); }
    else if (key === 'enter' || key === 'interact') {
      const s = e[this.shopSel];
      if (!s || s.soldOut) { this.sfx('locked'); return; }
      if (this.player.ashes < s.price) {
        this.log('Not enough ashes.', 0x8a8478);
        this.sfx('locked');
        return;
      }
      this.player.ashes -= s.price;
      s.buy();
      this.log(`Bought: ${s.name}`, s.color);
      this.sfx('buy');
      this.save();
    }
  }

  // ---- journal
  journalEntries(): JournalEntry[] {
    if (this.journalTab === 0) {
      const out: { title: string; text: string; color: number }[] = [];
      for (const [id, q] of Object.entries(QUESTS)) {
        const st = this.quest(id);
        if (st === 0 && id !== 'main') continue;
        const done = st >= q.stages.length - 1;
        let text = q.stages[st] ?? '';
        if (id === 'hearts' && st === 1) text = `Bring Pell five Hollow Hearts, cut from Hollows, Ghouls and Flagellants. (${this.questItemCount('hollow_heart')}/5)`;
        out.push({ title: `${done ? '✓ ' : ''}${q.title}`, text: `${q.giver}.  ${text}`, color: done ? 0x6a6458 : 0xffd060 });
      }
      return out;
    }
    if (this.journalTab === 1) return this.lore.map((id) => ({ title: LORE[id].title, text: LORE[id].text, color: 0xe0c8a0 }));
    if (this.journalTab === 2) return this.bestiary();
    const tools = this.player.tools.map((t) => ({ title: TOOL_INFO[t].name, text: `${TOOL_INFO[t].found}  ${TOOL_INFO[t].desc}`, color: TOOL_INFO[t].color }));
    const items = Object.entries(this.questItems).filter(([, n]) => n > 0).map(([id, n]) => ({ title: `${QUEST_ITEMS[id]}${n > 1 ? ` x${n}` : ''}`, text: 'Someone in Hollowmere wants this.', color: 0xffe0a0 }));
    return [...tools, ...items];
  }

  journalInput(key: string): void {
    if (key === 'esc' || key === 'journal') { this.mode = 'play'; return; }
    if (key === 'left') { this.journalTab = (this.journalTab + 3) % 4; this.journalSel = 0; this.sfx('menu'); }
    else if (key === 'right') { this.journalTab = (this.journalTab + 1) % 4; this.journalSel = 0; this.sfx('menu'); }
    const n = this.journalEntries().length;
    if (!n) return;
    if (key === 'up') this.journalSel = (this.journalSel + n - 1) % n;
    else if (key === 'down') this.journalSel = (this.journalSel + 1) % n;
  }

  // ---- ending
  endingInput(key: string, raw: string): void {
    if (this.endingStep === 0) {
      if (raw === '1') this.endingChoice = 'crown';
      else if (raw === '2') this.endingChoice = 'bury';
      else return;
      this.endingStep = 1;
      this.sfx(this.endingChoice === 'crown' ? 'bossintro' : 'rest');
      this.setFlag(`ending:${this.endingChoice}`);
      this.save();
      return;
    }
    if (['enter', 'interact', 'esc'].includes(key)) {
      if (this.endingStep === 1) {
        this.endingStep = 2;
        return;
      }
      this.pendingEnding = false;
      this.mode = 'title';
      this.titleSel = 0;
    }
  }

  // ================================================================ main tick
  update(): void {
    this.tick++;
    if (this.banner && --this.banner.t <= 0) this.banner = null;
    if (this.mode === 'title' || this.mode === 'ending') {
      this.updateEmbers();
      return;
    }
    if (this.mode === 'dead') {
      this.deadT++;
      for (const fx of this.fx) fx.t--;
      this.fx = this.fx.filter((f) => f.t > 0);
      if (this.deadT > 110) this.respawn();
      return;
    }
    if (this.mode !== 'play') return;
    this.playTick();
  }

  updateEmbers(): void {
    if (this.embers.length < 60 && this.rng.chance(0.6))
      this.embers.push({ x: this.rng.next(), y: 1.05, v: 0.004 + this.rng.next() * 0.01, c: this.rng.next() });
    for (const e of this.embers) {
      e.y -= e.v;
      e.x += (this.rng.next() - 0.5) * 0.006;
    }
    this.embers = this.embers.filter((e) => e.y > -0.05);
  }

  playTick(): void {
    const p = this.player;
    if (p.moveCd > 0) p.moveCd--;
    if (p.iframes > 0) p.iframes--;
    if (p.flash > 0) p.flash--;
    if (this.shake > 0) this.shake--;
    if (this.noise > 0) this.noise--;
    if (this.targetT > 0 && --this.targetT <= 0) this.target = null;
    tickSkills(this);
    if (this.resonance > 0) {
      this.resonance--;
      if (this.resonance === 50) this.log("The bell's silence is fading...", 0xb0a8d0);
      if (this.resonance === 0) this.endResonance();
      if (this.mode !== 'play') return;
    }

    this.updatePlayerAction();
    if (this.mode !== 'play') return;
    this.processBuffered();
    if (this.mode !== 'play') return;

    if (p.staDelay > 0) p.staDelay--;
    else if (!p.act || p.act.kind === 'recover' || p.act.kind === 'drink' || p.act.kind === 'parry') {
      const mult = p.act?.kind === 'drink' || p.act?.kind === 'parry' ? 0.5 : 1;
      p.sta = Math.min(this.stats.maxSta, p.sta + this.stats.staRegen * mult);
    }

    this.computeDist();
    const list = this.enemies.slice();
    for (const e of list) {
      if (e.dead) continue;
      // the overworld is big: far-off enemies sleep
      if (this.floor.kind === 'world' && !e.aware && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) > 34) continue;
      if (e.ally) updateThrall(this, e);
      else if (e.boss) updateBoss(this, e);
      else updateEnemy(this, e);
      if (this.mode !== 'play') return;
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.updateTeles();
    if (this.mode !== 'play') return;
    this.updateProjs();
    this.updateFields();
    this.updateSpikes();
    this.updateStatus();
    if (this.mode !== 'play') return;
    for (const fx of this.fx) fx.t--;
    this.fx = this.fx.filter((f) => f.t > 0);
    this.updateFov();
    this.noticeCreatures();
    if (this.pendingEnding && !this.banner) {
      this.mode = 'ending';
      this.endingStep = 0;
    }
  }

  processBuffered(): void {
    const b = this.buf;
    if (!b) return;
    if (this.tick - b.t > 5) {
      this.buf = null;
      return;
    }
    const p = this.player;
    if (p.act) return;
    const di = ({ up: 0, right: 1, down: 2, left: 3 } as Record<string, number>)[b.k];
    if (di !== undefined) {
      if (p.moveCd > 0) return;
      this.buf = null;
      this.tryMove(DIRS[di]);
      return;
    }
    this.buf = null;
    switch (b.k) {
      case 'attack': this.startAttack(false); break;
      case 'heavy': this.startAttack(true); break;
      case 'roll': this.startRoll(); break;
      case 'parry': this.startParry(); break;
      case 'flask': this.drink(); break;
      case 'interact': this.interact(); break;
      case 'tool': this.useTool(); break;
      case 'skill1': useSkill(this, 0); break;
      case 'skill2': useSkill(this, 1); break;
      case 'skill3': useSkill(this, 2); break;
    }
  }

  // ================================================================ queries
  idx(x: number, y: number): number {
    return y * this.floor.w + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.floor.w && y < this.floor.h;
  }
  tileAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.floor.tiles[y * this.floor.w + x] : T.WALL;
  }
  isOpaque(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t === T.WALL || t === T.DOOR || t === T.LOCKED || t === T.CRACKED || t === T.FOG || t === T.RUBBLE || t === T.THORNS || t === T.TREE;
  }
  /** Walkable for the player. */
  isWalkTile(t: number): boolean {
    return (
      t === T.FLOOR || t === T.OPEN || t === T.DOOR || t === T.STAIRS || t === T.BRIDGE || t === T.ENTRANCE || t === T.UPSTAIRS ||
      (t === T.PHANTOM && this.resonance > 0)
    );
  }
  enemyWalk(t: number): boolean {
    return t === T.FLOOR || t === T.OPEN || t === T.DOOR || t === T.STAIRS || t === T.BRIDGE;
  }
  objAt(x: number, y: number): Obj | undefined {
    return this.floor.objects.find((o) => o.x === x && o.y === y);
  }
  blockObjAt(x: number, y: number): Obj | undefined {
    return this.floor.objects.find((o) => o.x === x && o.y === y && (BLOCKING.has(o.kind) || (o.kind === 'deco' && o.block)));
  }
  npcAt(x: number, y: number): NpcDef | undefined {
    const s = this.floor.npcs.find((n) => n.x === x && n.y === y);
    return s ? NPCS[s.id] : undefined;
  }
  enemyAt(x: number, y: number): Enemy | undefined {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.size === 1) {
        if (e.x === x && e.y === y) return e;
      } else if (Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1) return e;
    }
    return undefined;
  }
  canEnemyEnter(e: Enemy, x: number, y: number, phase = false): boolean {
    if (x <= 0 || y <= 0 || x >= this.floor.w - 1 || y >= this.floor.h - 1) return false;
    const t = this.tileAt(x, y);
    if (!phase && !this.enemyWalk(t)) return false;
    if (phase && (t === T.FOG || t === T.CHASM || t === T.WATER)) return false;
    if (x === this.player.x && y === this.player.y) return false;
    const o = this.enemyAt(x, y);
    if (o && o !== e) return false;
    if (this.blockObjAt(x, y) || this.npcAt(x, y)) return false;
    if (this.floor.kind === 'world' && regionAt(this.floor, x, y)?.name === 'Hollowmere') return false;
    return true;
  }
  moveEnemy(e: Enemy, x: number, y: number): void {
    if (this.tileAt(x, y) === T.DOOR) this.floor.tiles[this.idx(x, y)] = T.OPEN;
    e.x = x;
    e.y = y;
  }
  inRoom(x: number, y: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  }

  computeDist(): void {
    const f = this.floor;
    const d = this.dist;
    d.fill(1 << 30);
    const n = f.w * f.h;
    const q = new Int32Array(n);
    let h = 0, t = 0;
    const s = this.idx(this.player.x, this.player.y);
    d[s] = 0;
    q[t++] = s;
    const blocked = new Uint8Array(n);
    for (const o of f.objects) if (BLOCKING.has(o.kind) || (o.kind === 'deco' && o.block)) blocked[o.y * f.w + o.x] = 1;
    const maxD = f.kind === 'world' ? 45 : 1 << 30;
    while (h < t) {
      const c = q[h++];
      const nd = d[c] + 1;
      if (nd > maxD) continue;
      for (const nb of [c - 1, c + 1, c - f.w, c + f.w]) {
        if (nb < 0 || nb >= n || d[nb] <= nd) continue;
        if (!this.enemyWalk(f.tiles[nb]) || blocked[nb]) continue;
        d[nb] = nd;
        q[t++] = nb;
      }
    }
  }

  updateFov(): void {
    const f = this.floor, p = this.player;
    this.fovMask.fill(0);
    computeFov(f.w, f.h, (x, y) => this.isOpaque(x, y), p.x, p.y, f.fovR, this.fovMask);
    const ft = Math.floor(this.tick / 3);
    const flick = 1 + 0.05 * Math.sin(ft * 2.7) + 0.03 * Math.sin(ft * 6.9 + 1);
    const R = (p.tools.includes('lantern') ? 11 : 8.5) * flick;
    const sources: { x: number; y: number; r: number }[] = [];
    for (const o of f.objects) {
      if (o.kind === 'bonfire') sources.push({ x: o.x, y: o.y, r: 7 });
      else if (o.kind === 'lamp') sources.push({ x: o.x, y: o.y, r: 7 });
      else if (o.kind === 'brazier' && o.lit) sources.push({ x: o.x, y: o.y, r: 5 });
    }
    for (const fl of this.fields) if (fl.kind === 'fire' && (fl.x + fl.y) % 2 === 0) sources.push({ x: fl.x, y: fl.y, r: 3 });
    // Hollowmere's lamps and the great fire keep the town square half-lit
    const amb = f.kind === 'world' && regionAt(f, p.x, p.y)?.name === 'Hollowmere' ? 0.42 : f.ambient;
    const near = sources.filter((s) => Math.abs(s.x - p.x) < f.fovR + 8 && Math.abs(s.y - p.y) < f.fovR + 8);
    const x0 = Math.max(0, p.x - f.fovR), x1 = Math.min(f.w - 1, p.x + f.fovR);
    const y0 = Math.max(0, p.y - f.fovR), y1 = Math.min(f.h - 1, p.y + f.fovR);
    this.vis.fill(0);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * f.w + x;
        if (!this.fovMask[i]) continue;
        const d = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
        let l = d < R ? Math.pow(1 - d / R, 0.8) : 0;
        for (const s of near) {
          const ds = Math.sqrt((x - s.x) ** 2 + (y - s.y) ** 2);
          if (ds < s.r) l = Math.max(l, (1 - ds / s.r) * 0.9);
        }
        if (amb > 0) l = Math.max(l, amb * (1 - d / (f.fovR + 1)));
        if (l > 0.04) {
          this.vis[i] = Math.min(1, l);
          f.seen[i] = 1;
        }
      }
    }
  }

  // ================================================================ player actions
  tryMove(dir: Vec): void {
    const p = this.player;
    const f = this.floor;
    p.face = { x: dir.x, y: dir.y };
    const nx = p.x + dir.x, ny = p.y + dir.y;
    if (!this.inBounds(nx, ny)) return;
    const e = this.enemyAt(nx, ny);
    if (e && e.ally) {
      // swap places with your own thrall
      e.x = p.x;
      e.y = p.y;
      p.x = nx;
      p.y = ny;
      p.moveCd = 4;
      return;
    }
    if (e) {
      this.startAttack(false);
      return;
    }
    const npc = this.npcAt(nx, ny);
    if (npc) {
      p.moveCd = 4;
      this.talkTo(npc);
      return;
    }
    const ob = this.blockObjAt(nx, ny);
    if (ob) {
      p.moveCd = 3;
      if (ob.kind === 'boulder') {
        if (this.pushBoulder(ob, dir)) {
          this.sfx('push');
          p.x = nx;
          p.y = ny;
          this.onPlayerEnter();
          p.moveCd = 5;
        }
      } else this.useObject(ob);
      return;
    }
    const i = this.idx(nx, ny);
    const t = f.tiles[i];
    const hint = (msg: string) => {
      p.moveCd = 6;
      if (this.tick - this.lastGlance > 25) {
        this.log(msg, 0xb0a080);
        this.lastGlance = this.tick;
      }
    };
    switch (t) {
      case T.LOCKED:
        p.moveCd = 4;
        if (p.keys > 0) {
          p.keys--;
          this.clearTile(nx, ny, T.OPEN);
          this.log('The crypt key turns. The lock screams like something alive.', 0xffd060);
          this.sfx('unlock');
        } else {
          hint('A crypt-lock seals this door. Somewhere on this floor is its key.');
          this.sfx('locked');
        }
        return;
      case T.CRACKED: return hint('The wall here is cracked and weeping dust. A heavy blow might break it.');
      case T.FOG: return hint('A wall of grey fog. It will not let you leave.');
      case T.RUBBLE: return hint(p.tools.includes('spade') ? 'Rubble. Your spade could shift it. [R]' : 'Collapsed stone, packed hard. You would need a spade.');
      case T.THORNS: return hint(p.tools.includes('lantern') ? 'Black thorns, dry as paper. Burn them. [R]' : 'Black thorns, thick as wrists. Something would have to burn them.');
      case T.CHASM: return hint(p.tools.includes('hook') ? 'A sheer drop. Your hook could bite the far side. [R]' : 'A sheer drop into nothing. Too far to jump.');
      case T.PHANTOM:
        if (this.resonance > 0) break;
        return hint(p.tools.includes('bell') ? 'Mist hangs where a bridge should be. Ring the bell. [R]' : 'Mist hangs over the drop in the shape of a bridge. It will not hold you.');
      case T.WATER: return hint('Black water. Too deep, too cold, too full.');
      case T.BROKEN: return hint('The bridge is snapped in the middle. The dead pulled it down from underneath.');
      case T.FENCE: case T.TREE: case T.WALL: return;
    }
    if (t === T.DOOR) {
      f.tiles[i] = T.OPEN;
      this.sfx('door');
    }
    p.x = nx;
    p.y = ny;
    p.moveCd = p.guard ? 6 : 3;
    this.onPlayerEnter();
  }

  /** Change a tile permanently (survives reloads). */
  clearTile(x: number, y: number, to: number): void {
    this.floor.tiles[this.idx(x, y)] = to;
    this.setFlag(`clr:${this.floor.key}:${x},${y}`);
  }

  onPlayerEnter(): void {
    const p = this.player;
    const f = this.floor;
    const here = f.tiles[this.idx(p.x, p.y)];
    if (here !== T.PHANTOM) p.lastSafe = { x: p.x, y: p.y };
    for (let i = f.pickups.length - 1; i >= 0; i--) {
      const pk = f.pickups[i];
      if (pk.x !== p.x || pk.y !== p.y) continue;
      if (pk.kind === 'item' && pk.item) {
        if (p.inv.length >= INV_MAX) {
          this.log('Your pack is full. (I to manage; X salvages)', 0xa08070);
          continue;
        }
        p.inv.push(pk.item);
        const it = pk.item;
        this.sfx('loot');
        this.log(`Found: ${it.name}${it.rarity >= 2 ? ` (${RARITY_NAMES[it.rarity]} ${it.baseName})` : ''}`, RARITY_COLORS[it.rarity]);
      } else if (pk.kind === 'key') {
        p.keys++;
        this.sfx('key');
        this.log('You take the Crypt Key. It is warm, like a held hand.', 0xffd060);
      } else if (pk.kind === 'tallow') {
        this.sfx('tallow');
        if (p.maxFlasks < 12) {
          p.maxFlasks++;
          p.flasks++;
          this.log(`Sacred Tallow. Your flask swells: ${p.maxFlasks} charges.`, 0xf0e0a0);
        } else p.flasks = p.maxFlasks;
      } else if (pk.kind === 'ashes') {
        p.ashes += pk.amount ?? 0;
        this.sfx(pk.stain ? 'reclaim' : 'ashes');
        if (pk.stain) {
          this.log(`You reclaim your bloodstain: ${pk.amount} ashes.`, 0xff6060);
          this.stain = null;
        } else this.log(`+${pk.amount} ashes`, 0xb0a8ff);
      } else if (pk.kind === 'lore') this.giveLore(pk.id!);
      else if (pk.kind === 'quest') this.giveQuestItem(pk.id!);
      else if (pk.kind === 'tool') this.giveTool(pk.id as ToolId);
      f.pickups.splice(i, 1);
    }
    for (const o of f.objects) {
      if (o.x !== p.x || o.y !== p.y) continue;
      if (o.kind === 'rune') this.stepRune(o);
      else if (o.kind === 'message') this.log(`Scrawled in blood: "${o.text}"`, 0xe0a050);
    }
    if (f.kind === 'dungeon') {
      const ri = f.roomAt[this.idx(p.x, p.y)];
      const room = ri >= 0 ? f.rooms[ri] : null;
      if (room && room.theme && !room.visited) {
        room.visited = true;
        const th = THEMES[room.theme];
        if (th) {
          this.log(`${th.name}. ${th.text}`, 0xb8a8c8);
          if (!this.banner) this.banner = { text: th.name.toUpperCase(), sub: '', color: 0xb8a8c8, t: 35, max: 35 };
        }
      }
    }
    if (this.mode !== 'play') return;
    if (here === T.STAIRS) {
      this.confirm('STAIRS DOWN', ['Go deeper? The bonfire below will take you home.'], () => this.descend());
      return;
    }
    if (here === T.UPSTAIRS) {
      this.confirm('THE WAY UP', ['Climb back to the surface?'], () => this.leaveDungeon());
      return;
    }
    if (here === T.ENTRANCE) {
      const ent = f.entrances.find((en) => en.x === p.x && en.y === p.y);
      if (ent) {
        const def = DUNGEONS[ent.dungeon];
        this.confirm(def.name.toUpperCase(), [def.enter, '', 'Go down?'], () => this.enterLocation(`d${ent.dungeon}f0`));
      }
      return;
    }
    if (f.kind === 'world') this.checkRegion();
    if (f.bossRoom && f.bossId && !this.bossDead(f.bossId) && !this.bossActive && this.inRoom(p.x, p.y, f.bossRoom)) {
      const boss = this.enemies.find((e) => e.boss);
      if (boss) {
        this.bossActive = true;
        f.tiles[this.idx(f.lockedDoor.x, f.lockedDoor.y)] = T.FOG;
        const b = BOSSES[boss.boss!];
        this.banner = { text: spaced(b.name), sub: b.title, color: b.color, t: 60, max: 60 };
        this.log(b.intro, 0xd08060);
        this.sfx('bossintro');
        boss.state = 'chase';
        boss.cd = 30;
      }
    }
  }

  confirm(title: string, lines: string[], onYes: () => void): void {
    this.modal = { title, lines: [...lines, '', '[E/Enter] yes     [Esc] no'], kind: 'confirm', onYes };
    this.mode = 'read';
    this.buf = null;
  }

  descend(): void {
    const f = this.floor;
    this.log('You go deeper. The air grows thick and warm, like breath.', 0x9090c0);
    this.sfx('descend');
    this.enterLocation(`d${f.dungeon}f${f.level + 1}`);
  }

  leaveDungeon(): void {
    const d = this.floor.dungeon;
    const w = this.getFloor('world');
    const ent = w.entrances.find((e) => e.dungeon === d)!;
    this.sfx('descend');
    this.enterLocation('world', { x: ent.x, y: ent.y + 1 });
    this.log('You climb back up into the dusk.', 0x9090c0);
  }

  spendSta(n: number): void {
    this.player.sta = Math.max(-10, this.player.sta - n);
    this.player.staDelay = 14;
  }

  startAttack(heavy: boolean): void {
    const p = this.player;
    if (p.act) return;
    p.guard = false;
    if (p.sta <= 0) {
      this.log('Too exhausted to swing.', 0x808060);
      return;
    }
    const b = weaponBase(p.eq.weapon);
    const cost = b.sta * (heavy ? 1.6 : 1) * (1 - this.stats.staCost / 100);
    this.spendSta(cost);
    p.act = { kind: heavy ? 'heavy' : 'attack', t: heavy ? 7 : 2, dir: { ...p.face } };
    this.sfx(heavy ? 'heavy' : 'swing');
  }

  startRoll(): void {
    const p = this.player;
    if (p.act) return;
    p.guard = false;
    if (p.sta <= 0) {
      this.log('Too exhausted to roll.', 0x808060);
      return;
    }
    this.spendSta(22 * (1 - this.stats.rollCost / 100));
    p.act = { kind: 'roll', t: 6, dir: { ...p.face } };
    p.iframes = 6;
    this.sfx('roll');
  }

  startParry(): void {
    const p = this.player;
    if (p.act || p.sta <= 0) return;
    p.guard = false;
    this.spendSta(10);
    p.act = { kind: 'parry', t: PARRY_TOTAL, dir: { ...p.face } };
  }

  drink(): void {
    const p = this.player;
    if (p.act) return;
    if (p.flasks <= 0) {
      this.log('Your flask is dry. Rest at a bonfire.', 0x808060);
      return;
    }
    p.flasks--;
    p.act = { kind: 'drink', t: 16, dir: { ...p.face } };
    this.sfx('drink');
  }

  updatePlayerAction(): void {
    const p = this.player;
    const a = p.act;
    if (!a) return;
    a.t--;
    switch (a.kind) {
      case 'attack':
      case 'heavy':
        if (a.t <= 0) this.resolveAttack(a.kind === 'heavy', a.dir);
        break;
      case 'roll':
        if (a.t === 5 || a.t === 3) this.rollStep(a.dir);
        if (a.t <= 0) p.act = { kind: 'recover', t: 3, dir: a.dir };
        break;
      case 'parry':
        if (a.t <= 0) p.act = null;
        break;
      case 'drink':
        if (a.t <= 0) {
          const heal = Math.round(this.stats.maxHp * 0.45 * (1 + this.stats.flaskPct / 100));
          p.hp = Math.min(this.stats.maxHp, p.hp + heal);
          if (this.stats.uniques.has('mercy')) {
            p.poison = 0;
            p.burn = 0;
          }
          this.addFx(p.x, p.y - 1, `+${heal}`, 0x60ff80, 8);
          p.act = null;
        }
        break;
      case 'recover':
        if (a.t <= 0) p.act = null;
        break;
      case 'skill':
        if (a.t <= 0) resolveSkill(this, a.skill!, a.dir);
        break;
    }
  }

  rollStep(d: Vec): void {
    const p = this.player;
    const nx = p.x + d.x, ny = p.y + d.y;
    const t = this.tileAt(nx, ny);
    if (!this.isWalkTile(t) || t === T.ENTRANCE || t === T.UPSTAIRS || t === T.STAIRS) return;
    if (this.enemyAt(nx, ny) || this.blockObjAt(nx, ny) || this.npcAt(nx, ny)) return;
    if (t === T.DOOR) this.floor.tiles[this.idx(nx, ny)] = T.OPEN;
    p.x = nx;
    p.y = ny;
    this.onPlayerEnter();
  }

  // ================================================================ tools
  useTool(): void {
    const p = this.player;
    if (p.act) return;
    const t = p.tool >= 0 ? TOOLS[p.tool] : null;
    if (!t || !p.tools.includes(t)) {
      this.log(p.tools.length ? 'Choose a tool with 1-4.' : 'Your hands are empty. You used to carry a spade. Your hut is east of town.', 0x8a8478);
      return;
    }
    if (p.sta <= 0) {
      this.log('Too exhausted.', 0x808060);
      return;
    }
    switch (t) {
      case 'spade': return this.useSpade();
      case 'lantern': return this.useLantern();
      case 'hook': return this.useHook();
      case 'bell': return this.useBell();
    }
  }

  useSpade(): void {
    const p = this.player;
    const x = p.x + p.face.x, y = p.y + p.face.y;
    this.spendSta(12);
    p.act = { kind: 'recover', t: 10, dir: p.face };
    this.sfx('dig');
    if (this.tileAt(x, y) === T.RUBBLE) {
      this.clearTile(x, y, T.FLOOR);
      this.shake = 2;
      this.log('You dig. The stone gives. You were always good at this.', 0xb0a080);
      for (let k = 0; k < 4; k++) this.addFx(x + this.rng.int(-1, 1), y + this.rng.int(-1, 1), '∙', 0xa09080, 6);
      return;
    }
    const o = this.objAt(x, y);
    if (o?.kind === 'grave') {
      if (o.name?.startsWith('WREN')) {
        this.log('No. Not again. You put the spade down, and your hands shake for a long time.', 0xffe060);
        return;
      }
      if (o.dug) {
        this.log('Already dug. Already empty. Already yours.', 0x8a8478);
        return;
      }
      o.dug = true;
      this.setFlag(`grave:${this.floor.key}:${x},${y}`);
      const r = this.rng.next();
      if (r < 0.25) {
        this.log('You dig. Something digs back. It was not empty.', 0xff6050);
        const e = this.spawnEnemyNear('hollow', x, y, 1, 2);
        if (e) {
          e.aware = true;
          e.state = 'chase';
          e.cd = 8;
        }
      } else if (r < 0.7) {
        this.log('You dig. Grave goods: whatever the family could spare.', 0xc0a070);
        this.dropAt(x, y, rollLoot(this.rng, 'urn', this.tierHere(), this.stats.mf));
      } else this.log('You dig. Bones, a wedding band, nothing worth taking. You take it anyway, then put it back.', 0x8a8478);
      return;
    }
    this.log("You dig. Dirt. It is always just dirt, until it isn't.", 0x8a8478);
  }

  useLantern(): void {
    const p = this.player;
    this.spendSta(18);
    p.act = { kind: 'recover', t: 9, dir: p.face };
    this.sfx('fire');
    for (let s = 1; s <= 3; s++) {
      const x = p.x + p.face.x * s, y = p.y + p.face.y * s;
      const t = this.tileAt(x, y);
      if (t === T.THORNS) {
        this.clearTile(x, y, T.FLOOR);
        this.log('The thorns catch and shriek as they burn. The way is open.', 0xffa040);
        this.addField(x, y, 'fire', 30);
        return;
      }
      if (this.isOpaque(x, y)) return;
      this.addFx(x, y, '≈', [0xffb040, 0xff7020, 0xffd060][s % 3], 5);
      const e = this.enemyAt(x, y);
      if (e) {
        e.burn = 80;
        this.hurtEnemy(e, 6 + this.tierHere() * 2, 5, { fromPlayer: true });
        return;
      }
      const o = this.blockObjAt(x, y);
      if (o?.kind === 'brazier') {
        this.lightBrazier(o);
        return;
      }
      if (o) return;
    }
  }

  isGap(t: number): boolean {
    return t === T.CHASM;
  }

  useHook(): void {
    const p = this.player;
    const d = p.face;
    this.spendSta(15);
    p.act = { kind: 'recover', t: 10, dir: d };
    this.sfx('hook');
    let gaps = 0;
    for (let s = 1; s <= HOOK_RANGE; s++) {
      const x = p.x + d.x * s, y = p.y + d.y * s;
      const t = this.tileAt(x, y);
      this.addFx(x, y, d.x ? '─' : '│', 0xa0a8c0, 3);
      const e = this.enemyAt(x, y);
      if (e) {
        if (e.boss) {
          this.hurtEnemy(e, 5, 25, { fromPlayer: true });
          return;
        }
        const tx = p.x + d.x, ty = p.y + d.y;
        if (s > 1 && this.canEnemyEnter(e, tx, ty)) this.moveEnemy(e, tx, ty);
        this.hurtEnemy(e, 5, 40, { fromPlayer: true });
        if (!e.dead) this.log(`The hook bites into ${e.name} and drags it to you.`, 0xa0a8c0);
        return;
      }
      const o = this.blockObjAt(x, y);
      if (o) {
        if (o.kind === 'boulder') this.pullBoulder(o, s);
        else this.log('The hook bites, holds, and drags nothing.', 0x8a8478);
        return;
      }
      if (this.isGap(t)) {
        gaps++;
        continue;
      }
      if (this.isWalkTile(t) && t !== T.ENTRANCE) {
        if (gaps > 0) {
          if (this.npcAt(x, y)) return;
          p.x = x;
          p.y = y;
          p.iframes = 4;
          this.log('The hook bites the far edge. You haul yourself across the drop.', 0xa0a8c0);
          this.onPlayerEnter();
        } else this.log('The hook clatters on stone and bites nothing.', 0x8a8478);
        return;
      }
      if (t === T.WATER) {
        this.log('The hook sinks. There is nothing to bite out there.', 0x8a8478);
        return;
      }
      if (t === T.PHANTOM) {
        this.log('The chain passes through the mist and finds nothing to bite. Something else is needed here.', 0x8a8478);
        return;
      }
      this.log(gaps ? 'The hook strikes rock and slips.' : 'The hook strikes stone.', 0x8a8478);
      return;
    }
    this.log('The chain pays out to its end and falls short.', 0x8a8478);
  }

  pullBoulder(o: Obj, s: number): void {
    const f = this.floor;
    const p = this.player;
    const d = p.face;
    const pz = f.puzzles[o.puzzle!];
    if (pz.solved) return;
    const validStone = (x: number, y: number) =>
      this.inRoom(x, y, pz.room) && f.tiles[this.idx(x, y)] === T.FLOOR && !f.noBoulder[this.idx(x, y)] && !this.blockObjAt(x, y) && !this.enemyAt(x, y);
    if (s === 1) {
      // adjacent: step back and drag the stone into your place
      const bx = p.x - d.x, by = p.y - d.y;
      if (!this.isWalkTile(this.tileAt(bx, by)) || this.blockObjAt(bx, by) || this.enemyAt(bx, by) || !validStone(p.x, p.y)) {
        this.log('No room to haul it.', 0x8a8478);
        return;
      }
      o.x = p.x;
      o.y = p.y;
      p.x = bx;
      p.y = by;
    } else {
      const tx = o.x - d.x, ty = o.y - d.y;
      if (!validStone(tx, ty)) {
        this.log('The stone grinds but will not come.', 0x8a8478);
        return;
      }
      o.x = tx;
      o.y = ty;
    }
    this.sfx('push');
    this.checkSokoban(pz, o);
  }

  useBell(): void {
    const p = this.player;
    this.spendSta(25);
    p.act = { kind: 'recover', t: 12, dir: p.face };
    this.sfx('bell');
    const first = !this.flags.has('rang');
    this.setFlag('rang');
    this.resonance = RESONANCE;
    this.shake = 3;
    this.log(first ? 'You swing the bell. It makes no sound. Everything hears it anyway.' : 'You ring the silent bell.', 0xd0c8ff);
    let phantoms = 0;
    for (let y = p.y - 12; y <= p.y + 12; y++)
      for (let x = p.x - 12; x <= p.x + 12; x++) if (this.tileAt(x, y) === T.PHANTOM) phantoms++;
    if (phantoms) this.log('The mist over the drop thickens, and holds its shape.', 0xd0c8ff);
    for (const e of this.enemies) {
      if (e.boss || Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) > 10) continue;
      if (e.def === 'wraith' || e.def === 'choirling') {
        this.staggerEnemy(e, 70);
        this.addFx(e.x, e.y - 1, '♫', 0xd0c8ff, 10);
      }
    }
  }

  endResonance(): void {
    const p = this.player;
    if (this.tileAt(p.x, p.y) === T.PHANTOM) {
      this.log('The bridge forgets itself. You fall.', 0xff6060);
      p.x = p.lastSafe.x;
      p.y = p.lastSafe.y;
      this.sfx('boom');
      this.hurtPlayer(this.stats.maxHp * 0.25, { env: true, unavoidable: true });
    }
  }

  // ================================================================ combat
  attackTiles(pattern: string, x: number, y: number, f: Vec, heavy: boolean): Vec[] {
    const r = { x: -f.y, y: f.x };
    const at = (a: number, b: number): Vec => ({ x: x + f.x * a + r.x * b, y: y + f.y * a + r.y * b });
    switch (pattern) {
      case 'front1': return [at(1, 0)];
      case 'arc3': return heavy ? [at(1, 0), at(1, 1), at(1, -1), at(2, 0)] : [at(1, 0), at(1, 1), at(1, -1)];
      case 'line2': {
        const out = [at(1, 0)];
        if (!this.isOpaque(out[0].x, out[0].y)) {
          out.push(at(2, 0));
          if (heavy && !this.isOpaque(out[1].x, out[1].y)) out.push(at(3, 0));
        }
        return out;
      }
      case 'arc5': return [at(1, 0), at(1, 1), at(1, -1), at(0, 1), at(0, -1)];
      case 'ring8': return DIRS8.map((d) => ({ x: x + d.x, y: y + d.y }));
    }
    return [at(1, 0)];
  }

  resolveAttack(heavy: boolean, dir: Vec): void {
    const p = this.player;
    const b = weaponBase(p.eq.weapon);
    if (b.pattern === 'bow') {
      // a drawn heavy shot hits harder and passes through one body
      shoot(this, dir, { mult: heavy ? 1.8 : 1, pierce: heavy ? 1 : 0 });
      p.act = { kind: 'recover', t: Math.round(b.rec * (heavy ? 1.3 : 1)), dir };
      this.noise = 3;
      return;
    }
    const tiles = this.attackTiles(b.pattern, p.x, p.y, dir, heavy);
    const slash = dir.x !== 0 ? '|' : '─';
    const hit = new Set<Enemy>();
    for (const t of tiles) {
      if (!this.isOpaque(t.x, t.y)) this.addFx(t.x, t.y, heavy ? '#' : slash, heavy ? 0xffe0a0 : 0xffffff, heavy ? 3 : 2);
      const e = this.enemyAt(t.x, t.y);
      if (e && !e.ally) hit.add(e);
      const o = this.blockObjAt(t.x, t.y);
      if (o && o.kind === 'urn') this.breakUrn(o);
      if (heavy && this.tileAt(t.x, t.y) === T.CRACKED) {
        this.clearTile(t.x, t.y, T.FLOOR);
        this.shake = 4;
        this.log('The cracked wall bursts apart! A hidden passage.', 0xffd080);
        this.sfx('crumble');
        for (let k = 0; k < 4; k++) this.addFx(t.x + this.rng.int(-1, 1), t.y + this.rng.int(-1, 1), '∙', 0xa09080, 6);
      }
    }
    if (heavy && this.stats.uniques.has('mourning')) {
      for (const d of DIRS8) {
        const e = this.enemyAt(p.x + d.x, p.y + d.y);
        if (e && !e.ally) hit.add(e);
        this.addFx(p.x + d.x, p.y + d.y, '*', 0xff9040, 3);
      }
    }
    for (const e of hit) this.playerHit(e, heavy, b);
    if (b.id === 'dagger' && p.talents.includes('twin')) for (const e of hit) if (!e.dead) this.playerHit(e, heavy, b, 0.6);
    if (this.stats.uniques.has('tithe')) p.hp = Math.max(1, p.hp - Math.round(this.stats.maxHp * 0.02));
    if (this.stats.uniques.has('scourge') && hit.size) p.hp = Math.max(1, p.hp - hit.size);
    const rec = Math.round(b.rec * (heavy ? 1.4 : 1));
    p.act = { kind: 'recover', t: rec, dir };
    this.noise = 3;
  }

  playerHit(e: Enemy, heavy: boolean, b: ReturnType<typeof weaponBase>, extra = 1, forceCrit = false): void {
    const p = this.player;
    const st = this.stats;
    const it = p.eq.weapon;
    const lo = it ? it.dmgMin : b.dmg[0], hi = it ? it.dmgMax : b.dmg[1];
    let dmg = this.rng.int(lo, hi) + st.flatDmg;
    let mult = 1 + st.dmgPct / 100 + scaleBonus(b, p);
    if (st.uniques.has('grudge')) mult += 1 - p.hp / st.maxHp;
    if (heavy) mult *= 1.8;
    mult *= extra * skillDamageMult(this);
    dmg *= mult;
    let label = '';
    let crit = false;
    const lethe = st.uniques.has('lethe');
    if (e.riposte > 0 && !e.boss) {
      dmg *= (lethe ? 2 : 1) * (p.talents.includes('parrymaster') ? 4 : 3);
      label = 'RIPOSTE';
      e.riposte = 0;
    } else if (!e.boss && e.state === 'idle' && !e.aware) {
      dmg *= (lethe ? 2 : 1) * (p.talents.includes('shadow') ? 3.5 : 2.5);
      label = 'BACKSTAB';
    } else if (forceCrit || this.rng.chance(st.crit)) {
      dmg *= st.critMult;
      crit = true;
    }
    if (label && st.uniques.has('hunger')) p.hp = Math.min(st.maxHp, p.hp + st.maxHp * 0.25);
    if (crit && lethe) p.sta = Math.min(st.maxSta, p.sta + 8);
    const poise = (heavy ? 22 : 10) * b.poise;
    this.hurtEnemy(e, dmg, poise, { heavy, crit, label, fromPlayer: true });
  }

  hurtEnemy(
    e: Enemy, dmg: number, poise: number,
    o: { heavy?: boolean; crit?: boolean; label?: string; fromPlayer?: boolean } = {},
  ): void {
    if (e.dead || (e.ally && o.fromPlayer)) return;
    const p = this.player;
    if (o.fromPlayer && p.talents.includes('cull') && e.hp <= e.maxHp * 0.2) {
      if (!e.boss) {
        dmg = e.hp + 1;
        o.label = o.label || 'CULL';
      } else dmg *= 1.4;
    }
    if (o.fromPlayer && p.talents.includes('venom')) e.venom = 100;
    if (e.def === 'knight' && !e.boss && e.state !== 'stagger' && o.fromPlayer && !o.heavy && !o.label) {
      const tx = sign(p.x - e.x), ty = sign(p.y - e.y);
      if (tx === e.face.x && ty === e.face.y) {
        dmg *= 0.3;
        poise *= 0.5;
        if (this.tick - this.lastGlance > 40) {
          this.log('Your blow glances off its shield. Flank it, or strike heavy.', 0x9098b0);
          this.lastGlance = this.tick;
        }
        this.addFx(e.x, e.y, '!', 0xc0c8ff, 3);
        this.sfx('clank');
      }
    }
    if (e.boss && e.state === 'stagger') dmg *= 1.5;
    const d = Math.max(1, Math.round(dmg));
    e.hp -= d;
    e.flash = 3;
    if (o.fromPlayer) this.sfx(o.label ? 'stab' : o.crit ? 'crit' : 'hit');
    else this.sfxAt('hit', e.x, e.y);
    if (o.fromPlayer) {
      e.aware = true;
      if (e.state === 'idle') e.state = 'chase';
      this.target = e;
      this.targetT = 160;
      const st = this.stats;
      if (st.lifesteal > 0) p.hp = Math.min(st.maxHp, p.hp + (d * st.lifesteal) / 100);
      if (st.uniques.has('ember') || (st.burn > 0 && this.rng.chance(st.burn / 100))) e.burn = 60;
      if (st.bleed > 0) {
        e.bleed += st.bleed;
        if (e.bleed >= 100) {
          e.bleed = 0;
          const extra = Math.round(e.maxHp * (e.boss ? 0.08 : 0.2));
          e.hp -= extra;
          this.log(`HEMORRHAGE! ${e.name} bleeds for ${extra}.`, 0xff3030);
          this.bloodSpray(e.x, e.y, 6);
        }
      }
    }
    const col = o.label ? 0xff5050 : o.crit ? 0xffe040 : 0xffffff;
    const txt = o.label ? `${o.label} ${d}` : o.crit ? `${d}!` : `${d}`;
    this.addFx(e.x - (txt.length >> 1), e.y - (e.size > 1 ? 2 : 1), txt, col, o.label ? 12 : 7);
    if (o.label) this.log(`${o.label}! ${e.name} takes ${d}.`, 0xff7050);
    this.bloodSpray(e.x, e.y, o.heavy || o.crit ? 3 : 1);
    if (o.heavy) this.shake = Math.max(this.shake, 2);
    e.poise -= poise;
    if (e.poise <= 0 && e.hp > 0) {
      e.poise = e.maxPoise;
      this.staggerEnemy(e, e.boss ? 45 : 30);
      if (e.boss) this.log(`${e.name} staggers! Punish it!`, 0xffe060);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  staggerEnemy(e: Enemy, t: number): void {
    e.state = 'stagger';
    e.t = t;
    e.combo = 0;
    this.teles = this.teles.filter((tl) => tl.owner !== e || tl.persist);
  }

  bloodSpray(x: number, y: number, n: number): void {
    const f = this.floor;
    for (let k = 0; k < n; k++) {
      const bx = x + this.rng.int(-1, 1), by = y + this.rng.int(-1, 1);
      if (!this.inBounds(bx, by)) continue;
      const i = this.idx(bx, by);
      if ((f.tiles[i] === T.FLOOR || f.tiles[i] === T.OPEN) && f.decal[i] === 0) f.decal[i] = 1;
    }
  }

  killEnemy(e: Enemy, noExplode = false): void {
    if (e.dead) return;
    e.dead = true;
    if (e.ally) {
      this.addFx(e.x, e.y, '∙', 0x9ad0a0, 6);
      return;
    }
    if (this.player.talents.includes('leech')) this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.maxHp * 0.05);
    if (this.target === e) this.target = null;
    this.teles = this.teles.filter((tl) => tl.owner !== e || tl.persist);
    const p = this.player;
    const st = this.stats;
    const d = ENEMIES[e.def];
    let ashes = Math.round(e.ashes * (1 + st.ashFind / 100));
    if (st.uniques.has('cleaver') && d.hollow && !e.boss) ashes = Math.round(ashes * 1.5);
    p.ashes += ashes;
    this.kills++;
    const kid = `kill:${e.boss ?? e.def}`;
    this.counters[kid] = (this.counters[kid] ?? 0) + 1;
    const f = this.floor;
    const i = this.idx(e.x, e.y);
    if (f.tiles[i] === T.FLOOR || f.tiles[i] === T.OPEN) f.decal[i] = e.def === 'archer' || e.def === 'sentinel' ? 3 : 2;
    this.bloodSpray(e.x, e.y, 3);
    if (e.flag) this.setFlag(e.flag);
    if (e.flag === 'tomas_dead') {
      this.log('Little Tomas falls, and does not get up. His boots are very well made.', 0xd0b080);
      if (this.quest('harrow') >= 1) this.setQuest('harrow', 2);
    }
    if (e.boss) {
      this.onBossDefeated(e);
      return;
    }
    this.sfxAt('kill', e.x, e.y);
    this.addFx(e.x + 1, e.y, `+${ashes}`, 0xb0a8ff, 8);
    if (e.elite) this.log(`${e.name} is slain. +${ashes} ashes`, 0xffc040);
    this.dropAt(e.x, e.y, rollLoot(this.rng, e.elite ? 'elite' : d.loot, e.tier, st.mf));
    const heartsOut = this.questItemCount('hollow_heart') + this.floor.pickups.filter((pk) => pk.id === 'hollow_heart').length;
    if (d.hollow && this.quest('hearts') === 1 && heartsOut < 5 && this.rng.chance(0.35))
      this.floor.pickups.push({ x: e.x, y: e.y, kind: 'quest', id: 'hollow_heart' });
    if (st.uniques.has('ninth')) {
      p.sta = Math.min(st.maxSta, p.sta + 15);
      p.hp = Math.min(st.maxHp, p.hp + 5);
    }
    if (st.uniques.has('lament') && this.lament < 10) {
      this.lament++;
      this.recalc();
    }
    const mods = e.elite?.mods ?? [];
    if (!noExplode && (e.def === 'bloated' || mods.includes('vengeful'))) {
      const tiles: Vec[] = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.isOpaque(e.x + dx, e.y + dy)) tiles.push({ x: e.x + dx, y: e.y + dy });
      this.addTele({ tiles, t: 12, max: 12, dmg: e.dmg, owner: null, parryable: false, kind: 'blast', hitsEnemies: true, poison: e.def === 'bloated', persist: true });
      this.log('Its corpse swells. Get clear!', 0xd0c060);
    }
    if (mods.includes('molten')) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.addField(e.x + dx, e.y + dy, 'fire', 80);
    }
  }

  onBossDefeated(e: Enemy): void {
    const f = this.floor;
    const b = BOSSES[e.boss!];
    this.setFlag(`boss:${e.boss}`);
    this.bossActive = false;
    this.teles = [];
    this.projs = [];
    for (const o of this.enemies) if (o !== e && f.bossRoom && this.inRoom(o.x, o.y, f.bossRoom)) o.dead = true;
    this.openArena(f);
    const r = f.bossRoom!;
    const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
    if (this.player.x === c.x && this.player.y === c.y) {
      f.tiles[this.idx(c.x, c.y)] = T.FLOOR;
      f.tiles[this.idx(c.x, c.y + 2)] = T.UPSTAIRS;
    }
    this.banner = { text: 'V A N Q U I S H E D', sub: b.name, color: 0xffd060, t: 90, max: 90 };
    this.log(b.death, 0xffd080);
    this.log(`+${e.ashes} ashes.`, 0xb0a8ff);
    this.sfx('victory');
    this.shake = 10;
    const drops: Drop[] = rollLoot(this.rng, 'boss', f.depth, this.stats.mf);
    const owned = new Set<string>();
    for (const it of [...this.player.inv, ...SLOTS.map((s) => this.player.eq[s])]) if (it?.unique) owned.add(it.unique);
    const pool = UNIQUES.filter((u) => !u.questOnly && !owned.has(u.id));
    const u = this.rng.pick(pool.length ? pool : UNIQUES.filter((x) => !x.questOnly));
    drops.push({ kind: 'item', item: makeUnique(this.rng, u.id, f.depth) });
    drops.push({ kind: 'tallow' });
    this.dropAt(e.x, e.y, drops);
    const story = BOSS_STORY[e.boss!];
    if (story?.lore && !this.lore.includes(story.lore)) f.pickups.push({ x: c.x - 1, y: c.y - 1, kind: 'lore', id: story.lore });
    if (story?.quest && !this.hasQuestItem(story.quest) && this.quest('bridge') < 2) f.pickups.push({ x: c.x + 1, y: c.y - 1, kind: 'quest', id: story.quest });
    if (e.boss === 'king') {
      this.giveLore('crown');
      this.setQuest('main', 5);
      this.pendingEnding = true;
    } else this.log('A way up has opened in the arena.', 0xb0a8ff);
    this.save();
  }

  dropAt(x: number, y: number, drops: Drop[]): void {
    const f = this.floor;
    const spots: Vec[] = [];
    for (let r = 0; r <= 3 && spots.length < drops.length + 2; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const px = x + dx, py = y + dy;
          const t = this.tileAt(px, py);
          if (t !== T.FLOOR && t !== T.OPEN) continue;
          if (this.blockObjAt(px, py) || f.pickups.some((pk) => pk.x === px && pk.y === py)) continue;
          spots.push({ x: px, y: py });
        }
    }
    let si = 0;
    for (const d of drops) {
      const s = spots[si++] ?? { x, y };
      if (d.kind === 'item') f.pickups.push({ x: s.x, y: s.y, kind: 'item', item: d.item });
      else if (d.kind === 'ashes') f.pickups.push({ x: s.x, y: s.y, kind: 'ashes', amount: d.amount });
      else if (d.kind === 'tallow') f.pickups.push({ x: s.x, y: s.y, kind: 'tallow' });
      else if (d.kind === 'flask') {
        const p = this.player;
        if (p.flasks < p.maxFlasks) {
          p.flasks++;
          this.log('A thimble of holy water. +1 flask charge.', 0x80ff90);
        }
        si--;
      }
      if (d.kind === 'item' && d.item.rarity >= 2) {
        this.sfx(d.item.rarity === 3 ? 'legendary' : 'rare');
        this.addFx(s.x, s.y - 1, '↓', RARITY_COLORS[d.item.rarity], 20);
      }
    }
  }

  // ================================================================ damage to player
  hurtPlayer(
    dmg: number,
    o: { owner?: Enemy | null; parryable?: boolean; poison?: boolean; burn?: boolean; env?: boolean; unavoidable?: boolean; from?: Vec } = {},
  ): 'dodge' | 'parry' | 'hit' {
    const p = this.player;
    const st = this.stats;
    if (p.iframes > 0 && !o.unavoidable) {
      if (!o.env) this.addFx(p.x, p.y - 1, 'dodge', 0x9090a0, 5);
      return 'dodge';
    }
    const window = PARRY_WINDOW + (p.talents.includes('parrymaster') ? 3 : 0);
    if (p.act?.kind === 'parry' && p.act.t > PARRY_TOTAL - window - 1 && o.parryable && o.owner && !o.owner.boss) {
      this.staggerEnemy(o.owner, 50);
      o.owner.riposte = 50;
      this.log(`PARRY! ${o.owner.name} reels. Strike now for a riposte!`, 0x60e0ff);
      this.addFx(p.x, p.y - 1, 'PARRY', 0x60e0ff, 10);
      for (const d of DIRS8) this.addFx(p.x + d.x, p.y + d.y, '*', 0xc0f0ff, 3);
      p.act = null;
      this.sfx('parry');
      return 'parry';
    }
    if (o.burn && st.uniques.has('ember')) return 'hit';
    let d = dmg * (100 / (100 + st.armor));
    if (p.act?.kind === 'parry') d *= 1.15;
    if (p.talents.includes('laststand') && p.hp < st.maxHp * 0.3) d *= 0.65;
    // the shield: frontal blows are paid for in stamina instead of blood
    const from = o.from ?? (o.owner ? { x: o.owner.x, y: o.owner.y } : null);
    if (p.guard && from && !o.env && (from.x - p.x) * p.face.x + (from.y - p.y) * p.face.y > 0) {
      const blocked = d * (o.owner?.boss ? 0.5 : 0.75);
      if (p.sta >= blocked * 0.8) {
        d -= blocked;
        this.spendSta(blocked * 0.8);
        this.sfx('clank');
        this.addFx(p.x + p.face.x, p.y + p.face.y, ']', 0xd0a868, 4);
      } else {
        p.guard = false;
        p.act = { kind: 'recover', t: 18, dir: p.face };
        this.spendSta(p.sta);
        this.log('Your guard breaks!', 0xff8060);
      }
    }
    if (p.buffs.bone > 0) {
      const absorb = Math.min(p.buffs.bone, d);
      p.buffs.bone -= absorb;
      d -= absorb;
      if (p.buffs.bone <= 0) {
        p.buffs.boneT = 0;
        this.log('The bone armor shatters.', 0x9ad0a0);
      }
    }
    if (d < 0.5) {
      this.addFx(p.x, p.y - 1, 'blocked', 0xd0c8a0, 5);
      return 'hit';
    }
    const dd = Math.max(1, Math.round(d));
    p.hp -= dd;
    p.flash = 4;
    this.sfx('hurt');
    this.shake = Math.max(this.shake, dd > st.maxHp * 0.2 ? 5 : 2);
    this.addFx(p.x, p.y - 1, `-${dd}`, 0xff4040, 7);
    this.bloodSpray(p.x, p.y, 1);
    if (o.poison) p.poison = Math.max(p.poison, 80);
    if (o.burn) p.burn = Math.max(p.burn, 50);
    if (o.owner && !o.env) {
      if (st.thorns > 0) this.hurtEnemy(o.owner, (dd * st.thorns) / 100, 0, {});
      if (o.owner.elite?.mods.includes('vampiric')) o.owner.hp = Math.min(o.owner.maxHp, o.owner.hp + dd);
    }
    if (p.hp <= 0) this.die();
    return 'hit';
  }

  die(): void {
    const p = this.player;
    const f = this.floor;
    p.hp = 0;
    this.mode = 'dead';
    this.deadT = 0;
    this.deaths++;
    this.deathLine = this.rng.pick(DEATH_LINES);
    this.sfx('death');
    for (const fl of this.floors.values()) fl.pickups = fl.pickups.filter((pk) => !pk.stain);
    this.stain = null;
    if (p.ashes > 0) {
      const at = this.tileAt(p.x, p.y) === T.PHANTOM ? p.lastSafe : { x: p.x, y: p.y };
      f.pickups.push({ x: at.x, y: at.y, kind: 'ashes', amount: p.ashes, stain: true });
      this.stain = { key: f.key, x: at.x, y: at.y, amount: p.ashes };
      p.ashes = 0;
    }
    this.bloodSpray(p.x, p.y, 6);
  }

  respawn(): void {
    const p = this.player;
    this.lament = 0;
    this.recalc();
    p.hp = this.stats.maxHp;
    p.sta = this.stats.maxSta;
    p.flasks = p.maxFlasks;
    p.poison = 0;
    p.burn = 0;
    p.act = null;
    p.iframes = 0;
    for (const fl of this.floors.values()) {
      fl.needsRespawn = true;
      fl.liveEnemies = null;
    }
    this.enemies = [];
    this.mode = 'play';
    this.enterLocation(this.respawnAt.key, { x: this.respawnAt.x, y: this.respawnAt.y });
    this.log('You return to the flame. Your bloodstain waits where you fell.', 0xd08060);
  }

  rest(o: Obj): void {
    const p = this.player;
    this.lament = 0;
    this.recalc();
    p.hp = this.stats.maxHp;
    p.sta = this.stats.maxSta;
    p.flasks = p.maxFlasks;
    p.poison = 0;
    p.burn = 0;
    const f = this.floor;
    this.setFlag(`fire:${f.key}:${o.x},${o.y}`);
    this.respawnAt = { key: f.key, x: o.x, y: o.y + 1 };
    for (const fl of this.floors.values()) {
      if (fl === f) continue;
      fl.needsRespawn = true;
      fl.liveEnemies = null;
    }
    this.teles = [];
    this.projs = [];
    this.fields = [];
    this.bossActive = false;
    if (this.inBounds(f.lockedDoor.x, f.lockedDoor.y) && this.tileAt(f.lockedDoor.x, f.lockedDoor.y) === T.FOG) f.tiles[this.idx(f.lockedDoor.x, f.lockedDoor.y)] = T.OPEN;
    this.spawnEnemies();
    this.target = null;
    this.mode = 'bonfire';
    this.bonSel = 0;
    this.sfx('rest');
    this.log('You rest by the flame. Wounds close. Somewhere, the dead stand back up.', 0xffa040);
    this.save();
  }

  // ================================================================ interaction
  interact(): void {
    const p = this.player;
    const spots: Vec[] = [{ x: p.x + p.face.x, y: p.y + p.face.y }, ...DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })), ...DIRS8.map((d) => ({ x: p.x + d.x, y: p.y + d.y })), { x: p.x, y: p.y }];
    for (const s of spots) {
      const npc = this.npcAt(s.x, s.y);
      if (npc) {
        this.talkTo(npc);
        return;
      }
      const o = this.objAt(s.x, s.y);
      if (o && !['plate', 'spikes', 'rune', 'lamp'].includes(o.kind) && !(o.kind === 'chest' && o.open)) {
        this.useObject(o);
        return;
      }
    }
    this.log('Nothing here but dust and old bones.', 0x6a6458);
  }

  useObject(o: Obj): void {
    switch (o.kind) {
      case 'bonfire': this.rest(o); break;
      case 'chest': this.openChest(o); break;
      case 'brazier': this.lightBrazier(o); break;
      case 'tablet': {
        const pz = this.floor.puzzles[o.puzzle!];
        const lines = pz.riddle.slice(1);
        if (pz.kind === 'sokoban' && !pz.solved) lines.push('', '[R] Pray, and the stones return to where they began.');
        if (pz.solved) lines.push('', 'The inscription is quiet now. It has been answered.');
        this.modal = { title: pz.riddle[0], lines, kind: pz.kind === 'sokoban' ? 'soko' : 'read', puzzle: pz };
        this.mode = 'read';
        break;
      }
      case 'message': this.log(`Scrawled in blood: "${o.text}"`, 0xe0a050); break;
      case 'urn': this.log('A funeral urn. Strike it to see what the dead were buried with.', 0x8a8478); break;
      case 'boulder': this.log('A heavy stone. Walk into it to push.', 0x8a8478); break;
      case 'grave': {
        const wren = o.name?.startsWith('WREN');
        this.log(wren ? o.name! : o.dug ? 'An open grave. You did that.' : `${cap(o.name ?? 'a grave')}.${this.player.tools.includes('spade') ? ' Your spade could open it. [R]' : ''}`, wren ? 0xffe060 : 0x8a8478);
        break;
      }
      case 'deco': this.log(`${cap(o.name ?? 'something')}.`, 0x9a9488); break;
    }
  }

  openChest(o: Obj): void {
    if (o.open) return;
    o.open = true;
    this.setFlag(`chest:${this.floor.key}:${o.x},${o.y}`);
    const p = this.player;
    this.shake = 1;
    this.sfx('chest');
    const tier = this.tierHere();
    const loot = o.loot ?? 'normal';
    if (loot.startsWith('tool:')) {
      const t = loot.slice(5) as ToolId;
      if (!p.tools.includes(t)) this.giveTool(t);
      return;
    }
    if (loot.startsWith('key')) {
      this.log('The chest groans open. Inside, wrapped in a strip of skin: a Crypt Key.', 0xffd060);
      p.keys++;
      this.sfx('key');
      const tool = loot.split('+')[1] as ToolId | undefined;
      if (tool && !p.tools.includes(tool)) this.giveTool(tool);
      else this.dropAt(o.x, o.y, rollLoot(this.rng, 'chest', tier, this.stats.mf).slice(0, 1));
      return;
    }
    if (loot === 'treasure') {
      this.log('A reliquary chest. Gold light spills out.', 0xffc040);
      this.dropAt(o.x, o.y, rollLoot(this.rng, 'treasure', tier, this.stats.mf));
    } else {
      this.log('The chest opens with a sigh of old air.', 0xc0a070);
      this.dropAt(o.x, o.y, rollLoot(this.rng, 'chest', tier, this.stats.mf));
    }
  }

  breakUrn(o: Obj): void {
    const f = this.floor;
    f.objects.splice(f.objects.indexOf(o), 1);
    this.sfx('urn');
    if (this.rng.chance(0.35)) this.log(this.rng.pick(URN_LINES), 0x8a8478);
    for (let k = 0; k < 3; k++) this.addFx(o.x + this.rng.int(-1, 1), o.y + this.rng.int(-1, 1), '∙', 0xa07850, 5);
    f.decal[this.idx(o.x, o.y)] = 3;
    this.dropAt(o.x, o.y, rollLoot(this.rng, 'urn', this.tierHere(), this.stats.mf));
  }

  pushBoulder(o: Obj, d: Vec): boolean {
    const f = this.floor;
    const pz = f.puzzles[o.puzzle!];
    if (pz.solved) {
      this.log('The stone will not move. It has been weighed.', 0x8a8478);
      return false;
    }
    const tx = o.x + d.x, ty = o.y + d.y;
    const r = pz.room;
    if (!this.inRoom(tx, ty, r) || f.tiles[this.idx(tx, ty)] !== T.FLOOR || f.noBoulder[this.idx(tx, ty)] || this.blockObjAt(tx, ty) || this.enemyAt(tx, ty)) {
      this.log('The stone will not budge that way.', 0x8a8478);
      return false;
    }
    o.x = tx;
    o.y = ty;
    this.addFx(o.x - d.x, o.y - d.y, '∙', 0x8a8070, 3);
    this.checkSokoban(pz, o);
    return true;
  }

  checkSokoban(pz: Puzzle, moved: Obj): void {
    const f = this.floor;
    const solved = pz.plates.every((pl) => f.objects.some((b) => b.kind === 'boulder' && b.puzzle === pz.id && b.x === pl.x && b.y === pl.y));
    const onPlate = pz.plates.some((pl) => pl.x === moved.x && pl.y === moved.y);
    if (onPlate) this.sfx('plate');
    if (onPlate && !solved) this.log('The scale sinks with a deep, satisfied click.', 0xc0b890);
    if (solved) this.solvePuzzle(pz, 'The last scale sinks. Stone grinds against stone somewhere close.');
  }

  resetSokoban(pz: Puzzle): void {
    if (pz.solved) return;
    const f = this.floor;
    const bs = f.objects.filter((o) => o.kind === 'boulder' && o.puzzle === pz.id);
    const p = this.player;
    for (const s of pz.boulderStart) {
      if ((p.x === s.x && p.y === s.y) || this.enemyAt(s.x, s.y)) {
        this.log('Something stands where a stone must return. Move aside and pray again.', 0x8a8478);
        return;
      }
    }
    bs.forEach((b, i) => {
      b.x = pz.boulderStart[i].x;
      b.y = pz.boulderStart[i].y;
    });
    this.log('The stones shudder and drag themselves back to their places.', 0xb0a8c0);
  }

  stepRune(o: Obj): void {
    const f = this.floor;
    const pz = f.puzzles[o.puzzle!];
    if (pz.solved) return;
    const n = pz.n;
    const runes = f.objects.filter((r) => r.kind === 'rune' && r.puzzle === pz.id);
    const byIdx = (i: number) => runes.find((r) => r.idx === i);
    const i = o.idx!;
    const x = i % n, y = (i / n) | 0;
    const flip = (j: number) => {
      const r = byIdx(j);
      if (r) {
        r.lit = !r.lit;
        this.addFx(r.x, r.y, r.lit ? '♦' : '◊', r.lit ? 0xa0f0ff : 0x405060, 3);
      }
    };
    this.sfx('rune');
    flip(i);
    if (x > 0) flip(i - 1);
    if (x < n - 1) flip(i + 1);
    if (y > 0) flip(i - n);
    if (y < n - 1) flip(i + n);
    if (runes.every((r) => r.lit)) this.solvePuzzle(pz, 'Every rune blazes at once. The room exhales.');
  }

  lightBrazier(o: Obj): void {
    const f = this.floor;
    const pz = f.puzzles[o.puzzle!];
    if (o.lit) {
      this.log(`The ${o.cname} brazier already burns.`, 0x8a8478);
      return;
    }
    if (pz.solved) return;
    const want = pz.order[pz.progress];
    if (o.idx === want) {
      o.lit = true;
      pz.progress++;
      this.log(`The ${o.cname} brazier catches with a hungry roar.`, o.color);
      this.sfx('brazier');
      if (pz.progress >= pz.order.length) this.solvePuzzle(pz, 'The pyres burn as one. A shape rises from the ashes.');
    } else {
      for (const b of f.objects) if (b.kind === 'brazier' && b.puzzle === pz.id) b.lit = false;
      pz.progress = 0;
      this.log('The flames gutter and die. Something in the dark answers your mistake.', 0xff5040);
      this.sfx('wrong');
      this.shake = 4;
      const pool = f.kind === 'world' ? ['hollow', 'ghoul'] : ['hollow', 'ghoul', 'cultist'];
      for (let k = 0; k < 2; k++) {
        const e = this.spawnEnemyNear(this.rng.pick(pool), this.player.x, this.player.y, 3, 5);
        if (e) {
          e.aware = true;
          e.state = 'chase';
          e.cd = 10;
        }
      }
    }
  }

  rewardSpot(f: Floor, pz: Puzzle): Vec | null {
    const r = pz.room;
    const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
    let best: Vec | null = null;
    let bd = 1e9;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = y * f.w + x;
        if (f.tiles[i] !== T.FLOOR || f.noBoulder[i]) continue;
        if (f.objects.some((o) => o.x === x && o.y === y)) continue;
        const d = (x - c.x) ** 2 + (y - c.y) ** 2;
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
    return best;
  }

  solvePuzzle(pz: Puzzle, text: string): void {
    pz.solved = true;
    this.setFlag(`pz:${this.floor.key}:${pz.id}`);
    this.log(text, 0xffe0a0);
    this.sfx('solved');
    this.shake = 3;
    let best = this.rewardSpot(this.floor, pz);
    if (best && ((best.x === this.player.x && best.y === this.player.y) || this.enemyAt(best.x, best.y))) best = null;
    if (!best) best = { x: this.player.x, y: this.player.y };
    const loot = pz.reward === 'key' ? (pz.tool && !this.player.tools.includes(pz.tool) ? `key+${pz.tool}` : 'key') : 'treasure';
    this.floor.objects.push({ id: 9000 + pz.id, kind: 'chest', x: best.x, y: best.y, loot });
    this.addFx(best.x, best.y - 1, '↓', 0xffd060, 30);
    this.log(pz.reward === 'key' ? 'A chest rises from the floor. It smells of iron.' : 'A reliquary rises from the floor.', 0xffd060);
  }

  spawnEnemyNear(def: string, x: number, y: number, rmin: number, rmax: number): Enemy | null {
    for (let t = 0; t < 60; t++) {
      const px = x + this.rng.int(-rmax, rmax), py = y + this.rng.int(-rmax, rmax);
      if (Math.max(Math.abs(px - x), Math.abs(py - y)) < rmin) continue;
      if (!this.inBounds(px, py) || !this.enemyWalk(this.tileAt(px, py))) continue;
      if (this.enemyAt(px, py) || this.blockObjAt(px, py) || this.npcAt(px, py) || (px === this.player.x && py === this.player.y)) continue;
      const e = this.makeEnemy(def, px, py, false, this.tierHere());
      this.enemies.push(e);
      this.addFx(px, py, '*', 0xa060ff, 6);
      return e;
    }
    return null;
  }

  // ================================================================ world systems
  addTele(t: Tele): void {
    this.teles.push(t);
  }

  addField(x: number, y: number, kind: 'fire' | 'acid', t: number): void {
    if (!this.inBounds(x, y)) return;
    const tt = this.tileAt(x, y);
    if (!(tt === T.FLOOR || tt === T.OPEN || tt === T.BRIDGE)) return;
    const ex = this.fields.find((f) => f.x === x && f.y === y);
    if (ex) {
      ex.kind = kind;
      ex.t = Math.max(ex.t, t);
    } else this.fields.push({ x, y, kind, t });
  }

  spawnProjectile(x: number, y: number, tx: number, ty: number, speed: number, dmg: number, glyph: string, color: number): void {
    const dx = tx - x, dy = ty - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this.projs.push({ x, y, vx: (dx / len) * speed, vy: (dy / len) * speed, dmg, glyph, color, life: 80 });
  }

  updateTeles(): void {
    const p = this.player;
    const fire: Tele[] = [];
    for (const t of this.teles) {
      t.t--;
      if (t.t <= 0) fire.push(t);
    }
    if (!fire.length) return;
    this.teles = this.teles.filter((t) => t.t > 0);
    for (const t of fire) {
      if (t.owner && t.owner.dead && !t.persist) continue;
      if (t.dmg > 0) {
        if (t.tiles.some((v) => v.x === p.x && v.y === p.y)) {
          this.hurtPlayer(t.dmg, { owner: t.owner, parryable: t.parryable, poison: t.poison, burn: t.burn, from: t.owner ? { x: t.owner.x, y: t.owner.y } : undefined });
          if (this.mode !== 'play') return;
        }
        if (t.hitsEnemies) {
          for (const v of t.tiles) {
            const e = this.enemyAt(v.x, v.y);
            if (e && e !== t.owner && !e.boss) this.hurtEnemy(e, t.dmg, 20, {});
          }
        }
        if (t.kind === 'blast') {
          for (const v of t.tiles) this.addFx(v.x, v.y, '*', 0xd0d060, 3);
          if (t.tiles[0]) this.sfxAt('boom', t.tiles[0].x, t.tiles[0].y);
        }
      }
      t.onFire?.();
    }
  }

  updateProjs(): void {
    const p = this.player;
    for (const pr of this.projs) {
      for (let s = 0; s < 2 && pr.life > 0; s++) {
        pr.x += pr.vx / 2;
        pr.y += pr.vy / 2;
        const tx = Math.round(pr.x), ty = Math.round(pr.y);
        if (this.isOpaque(tx, ty) || this.blockObjAt(tx, ty)) {
          if (pr.friendly) {
            const o = this.blockObjAt(tx, ty);
            if (o?.kind === 'urn') this.breakUrn(o);
          }
          pr.life = 0;
          break;
        }
        if (pr.friendly) {
          const e = this.enemyAt(tx, ty);
          if (e && !e.ally && !pr.hits!.includes(e.id)) {
            pr.hits!.push(e.id);
            pr.onHit?.(e);
            if (--pr.pierce! < 0) pr.life = 0;
          }
          continue;
        }
        if (tx === p.x && ty === p.y) {
          const r = this.hurtPlayer(pr.dmg, { parryable: false, from: { x: pr.x - pr.vx * 6, y: pr.y - pr.vy * 6 } });
          if (r !== 'dodge') pr.life = 0;
          if (this.mode !== 'play') return;
        }
      }
      pr.life--;
    }
    this.projs = this.projs.filter((pr) => pr.life > 0);
  }

  updateFields(): void {
    const p = this.player;
    for (const fl of this.fields) fl.t--;
    this.fields = this.fields.filter((f) => f.t > 0);
    if (this.tick % 8 !== 0) return;
    for (const fl of this.fields) {
      if (fl.x === p.x && fl.y === p.y) {
        if (fl.kind === 'fire') this.hurtPlayer(4 + this.depth, { burn: true, env: true });
        else this.hurtPlayer(3 + this.depth, { poison: true, env: true });
        if (this.mode !== 'play') return;
      }
      const e = this.enemyAt(fl.x, fl.y);
      if (e && !e.boss) this.hurtEnemy(e, 5 + this.depth, 0, {});
    }
  }

  updateSpikes(): void {
    for (const o of this.floor.objects) {
      if (o.kind !== 'spikes') continue;
      const ph = (this.tick + (o.off ?? 0)) % 80;
      if (ph !== 66 && ph !== 74) continue;
      if (ph === 66) this.sfxAt('spikes', o.x, o.y);
      if (o.x === this.player.x && o.y === this.player.y) {
        this.hurtPlayer(8 + this.depth * 2, { env: true });
        if (ph === 66) this.log('Spikes punch up through your feet.', 0xff6050);
        if (this.mode !== 'play') return;
      }
      const e = this.enemyAt(o.x, o.y);
      if (e && !e.boss) this.hurtEnemy(e, 12 + this.depth * 3, 15, {});
    }
  }

  updateStatus(): void {
    if (this.tick % 10 !== 0) return;
    const p = this.player;
    if (p.poison > 0) {
      p.poison -= 10;
      p.hp -= 1 + Math.round(this.depth * 0.3);
      p.flash = 2;
    }
    if (p.burn > 0) {
      p.burn -= 10;
      p.hp -= 2 + Math.round(this.depth * 0.4);
      p.flash = 2;
    }
    if (p.hp <= 0) {
      this.die();
      return;
    }
    for (const e of this.enemies) {
      if (e.venom > 0 && !e.dead) {
        e.venom -= 10;
        this.hurtEnemy(e, e.maxHp * (e.boss ? 0.005 : 0.02), 0, {});
        this.addFx(e.x, e.y - 1, '~', 0x90e040, 3);
      }
      if (e.burn > 0 && !e.dead) {
        e.burn -= 10;
        this.hurtEnemy(e, 2 + e.maxHp * (e.boss ? 0.006 : 0.03), 0, {});
        this.addFx(e.x, e.y - 1, '^', 0xff8030, 3);
      }
    }
  }

  /** First sight of a creature writes it into the bestiary. */
  noticeCreatures(): void {
    if (this.tick % 5) return;
    for (const e of this.enemies) {
      if (e.dead || e.ally) continue;
      const id = e.boss ?? e.def;
      if (this.flags.has(`seen:${id}`) || this.vis[this.idx(e.x, e.y)] <= 0) continue;
      this.setFlag(`seen:${id}`);
      this.log(`Bestiary: ${e.boss ? BOSSES[id].name : ENEMIES[id].name} (B)`, 0x9a9488);
    }
  }

  bestiary(): JournalEntry[] {
    const out: JournalEntry[] = [];
    for (const d of Object.values(ENEMIES)) {
      if (!this.flags.has(`seen:${d.id}`)) continue;
      const moves = (MOVES[d.id] ?? []).map((m) => `• ${m}`).join('  ');
      out.push({ title: d.name, glyph: d.glyph, group: 'CREATURES', color: d.color, text: `${d.desc}  ${moves}  Killed: ${this.counters[`kill:${d.id}`] ?? 0}.` });
    }
    // the four bosses always have a place, even before you meet them
    DUNGEONS.forEach((dun) => {
      const b = BOSSES[dun.boss];
      if (!this.flags.has(`seen:${b.id}`)) {
        out.push({ title: '? ? ?', glyph: '?', group: 'BOSSES', color: 0x4a4438, unknown: true, text: `Something vast waits at the bottom of ${dun.name}. You have not seen it yet.` });
        return;
      }
      const moves = (MOVES[b.id] ?? []).map((m) => `• ${m}`).join('  ');
      out.push({
        title: b.name, glyph: BOSS_GLYPH[b.id], group: 'BOSSES', color: b.color,
        text: `${b.title}. ${b.intro}  ${moves}  ${this.bossDead(b.id) ? 'Destroyed.' : 'Still waiting for you.'}`,
      });
    });
    return out;
  }

  /** Creatures currently in view, grouped: for the sidebar's IN SIGHT legend. */
  inSight(): { glyph: string; name: string; color: number; n: number }[] {
    const m = new Map<string, { glyph: string; name: string; color: number; n: number }>();
    for (const e of this.enemies) {
      if (e.dead || this.vis[this.idx(e.x, e.y)] <= 0) continue;
      const key = e.ally ? 'thrall' : e.boss ?? (e.elite ? `elite:${e.id}` : e.def);
      const d = ENEMIES[e.def];
      const look = e.ally
        ? { glyph: 'z', name: 'Thrall', color: 0x90e0a0 }
        : e.boss
          ? { glyph: BOSS_GLYPH[e.boss], name: BOSSES[e.boss].name, color: BOSSES[e.boss].color }
          : { glyph: d.glyph, name: e.elite ? e.name : d.name, color: e.elite ? 0xffd040 : d.color };
      const cur = m.get(key);
      if (cur) cur.n++;
      else m.set(key, { ...look, n: 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }

  // ================================================================ UI helpers
  nearbyDescription(): string[] {
    const p = this.player;
    const out: string[] = [];
    const seen = new Set<Obj>();
    for (const d of [{ x: 0, y: 0 }, ...DIRS8]) {
      const x = p.x + d.x, y = p.y + d.y;
      const npc = this.npcAt(x, y);
      if (npc) out.push(`${npc.name}  [E] talk`);
      const o = this.objAt(x, y);
      if (o && !seen.has(o)) {
        seen.add(o);
        switch (o.kind) {
          case 'brazier': out.push(`Brazier of ${o.cname} (${o.lit ? 'burning' : 'cold'})`); break;
          case 'chest': out.push(o.open ? 'An empty chest' : 'A chest  [E] open'); break;
          case 'tablet': out.push('An inscription  [E] read'); break;
          case 'bonfire': out.push('Bonfire  [E] rest'); break;
          case 'urn': out.push('A funeral urn (strike it)'); break;
          case 'boulder': out.push('A heavy stone (push)'); break;
          case 'rune': out.push(`A rune stone (${o.lit ? 'awake' : 'asleep'})`); break;
          case 'plate': out.push('A stone scale'); break;
          case 'message': out.push(`"${o.text}"`); break;
          case 'spikes': out.push('Spike trap'); break;
          case 'grave': out.push(o.name?.startsWith('WREN') ? "Wren's grave" : o.dug ? 'An open grave' : 'A grave'); break;
          case 'deco': out.push(cap(o.name ?? '')); break;
        }
      }
      const t = this.tileAt(x, y);
      if (t === T.CRACKED) out.push('A cracked wall');
      if (t === T.LOCKED) out.push(p.keys ? 'Locked door (you have a key)' : 'Locked door (needs a key)');
      if (t === T.RUBBLE) out.push('Rubble');
      if (t === T.THORNS) out.push('Black thorns');
      if (t === T.CHASM) out.push('A sheer drop');
      if (t === T.PHANTOM) out.push('A phantom bridge');
      if (t === T.ENTRANCE) out.push('A way down');
    }
    return [...new Set(out)].slice(0, 3);
  }

  locationName(): string {
    if (this.floor.kind === 'dungeon') return `${DUNGEONS[this.floor.dungeon].name} ${'I'.repeat(this.floor.level + 1)}`;
    return this.regionName || 'The Pale';
  }

  objective(): string {
    return QUESTS.main.stages[this.quest('main')] ?? '';
  }

  toolGateName(t: ToolId): string {
    return TOOL_TILE_NAME[t];
  }
}
