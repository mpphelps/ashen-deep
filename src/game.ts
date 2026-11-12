// Core game state + simulation (20 ticks per second).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RNG, hash2 } from './rng.ts';
import {
  T, DIRS, DIRS8, SLOTS,
  type Vec, type Floor, type Obj, type Player, type Enemy, type Tele, type Projectile, type Field, type Fx, type Slot, type Puzzle,
} from './types.ts';
import { generateFloor, isBossDepth, MAP_W, MAP_H, actOf } from './dungeon.ts';
import { ENEMIES, BOSSES, ELITE_MODS, ELITE_MOD_NAMES, eliteName, DEATH_LINES, URN_LINES } from './data.ts';
import {
  makeItem, makeUnique, rollLoot, computeStats, weaponBase, scaleBonus, salvageValue, setUidFloor,
  RARITY_COLORS, RARITY_NAMES, INV_MAX, UNIQUES, type Stats, type Drop,
} from './loot.ts';
import { updateEnemy, updateBoss } from './ai.ts';
import { computeFov } from './fov.ts';

export const BLOCKING = new Set(['chest', 'urn', 'brazier', 'boulder', 'tablet', 'bonfire']);
const PARRY_TOTAL = 14;
const PARRY_WINDOW = 6;
const SAVE_PATH = path.join(os.homedir(), '.ashen-deep-save.json');

export type Mode = 'title' | 'play' | 'inv' | 'bonfire' | 'read' | 'dead' | 'map' | 'help' | 'victory' | 'confirmQuit';

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
  kind: string;
  puzzle?: Puzzle;
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
  };
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

export class Game {
  mode: Mode = 'title';
  tick = 0;
  seed: number;
  rng: RNG;
  depth = 1;
  floor: Floor = null as unknown as Floor;
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
  vis: Float32Array = new Float32Array(MAP_W * MAP_H);
  fovMask: Uint8Array = new Uint8Array(MAP_W * MAP_H);
  dist: Int32Array = new Int32Array(MAP_W * MAP_H);
  bossActive = false;
  bossDefeated = false;
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
  victoryPending = false;
  victorySeen = false;
  quit = false;
  embers: { x: number; y: number; v: number; c: number }[] = [];
  nextId = 1;
  saveEnabled = true;
  lastGlance = 0;
  sounds: string[] = [];
  audioLabel = '';

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
    this.victorySeen = false;
    this.msgs = [];
    this.enterFloor(1);
    this.mode = 'play';
    this.log('You wake in the cold. Something took your name. Go down, and take it back.', 0xd0a060);
    this.log('Press ? for controls. Rest at the bonfire (☼) to level up.', 0x8a8478);
  }

  recalc(): void {
    this.stats = computeStats(this.player, this.lament);
    if (this.player.hp > this.stats.maxHp) this.player.hp = this.stats.maxHp;
    if (this.player.sta > this.stats.maxSta) this.player.sta = this.stats.maxSta;
  }

  enterFloor(depth: number): void {
    this.depth = depth;
    this.floor = generateFloor(depth, hash2(this.seed, depth * 1013));
    const f = this.floor;
    const p = this.player;
    p.x = f.start.x;
    p.y = f.start.y;
    p.act = null;
    p.keys = 0;
    this.teles = [];
    this.projs = [];
    this.fields = [];
    this.fx = [];
    this.bossActive = false;
    this.bossDefeated = false;
    this.target = null;
    this.spawnEnemies();
    this.updateFov();
    const boss = isBossDepth(depth);
    this.banner = {
      text: spaced(f.name),
      sub: `Depth ${depth}${boss ? '  ·  something vast breathes below' : ''}`,
      color: [0xd8c8a8, 0x9ad0a8, 0xc8a0f0][f.act],
      t: 70,
      max: 70,
    };
    this.save();
  }

  spawnEnemies(): void {
    const f = this.floor;
    this.enemies = [];
    for (const s of f.spawns) this.enemies.push(this.makeEnemy(s.def, s.x, s.y, s.elite));
    if (f.bossId && f.bossRoom && !this.bossDefeated) {
      const r = f.bossRoom;
      this.enemies.push(this.makeBoss(f.bossId, r.x + (r.w >> 1), r.y + (r.h >> 1)));
    }
  }

  makeEnemy(defId: string, x: number, y: number, elite: boolean): Enemy {
    const d = ENEMIES[defId];
    const sc = 1 + 0.32 * (this.depth - 1);
    const dsc = 1 + 0.2 * (this.depth - 1);
    const e: Enemy = {
      id: this.nextId++, def: defId, boss: null, name: d.name, x, y, size: 1,
      hp: Math.round(d.hp * sc), maxHp: Math.round(d.hp * sc), dmg: d.dmg * dsc, poise: d.poise, maxPoise: d.poise,
      speed: d.speed, state: 'idle', t: 0, cd: 0, moveT: this.rng.int(0, d.speed), face: { ...this.rng.pick(DIRS) },
      aware: false, lostT: 0, flash: 0, alertT: 0, burn: 0, bleed: 0, elite: null, combo: 0, phase: 0, riposte: 0,
      wmult: 1, birthCd: 0, dead: false, ashes: Math.round(d.ashes * (1 + 0.18 * (this.depth - 1))),
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
    const cycle = Math.floor((this.depth - 1) / 9);
    const hpS = 1 + 0.7 * cycle, dS = 1 + 0.35 * cycle;
    return {
      id: this.nextId++, def: 'hollow', boss: id, name: b.name, x, y, size: 3,
      hp: Math.round(b.hp * hpS), maxHp: Math.round(b.hp * hpS), dmg: b.dmg * dS, poise: b.poise, maxPoise: b.poise,
      speed: b.speed, state: 'idle', t: 0, cd: 20, moveT: 0, face: { x: 0, y: 1 }, aware: true, lostT: 0, flash: 0,
      alertT: 0, burn: 0, bleed: 0, elite: null, combo: 0, phase: 0, riposte: 0, wmult: 1, birthCd: 60, dead: false,
      ashes: Math.round(b.ashes * (1 + cycle)),
    };
  }

  // ================================================================ save / load
  save(): void {
    if (!this.saveEnabled) return;
    try {
      const p = { ...this.player, act: null };
      fs.writeFileSync(
        SAVE_PATH,
        JSON.stringify({ v: 1, seed: this.seed, depth: this.depth, player: p, deaths: this.deaths, kills: this.kills, victorySeen: this.victorySeen }),
      );
    } catch {
      /* ignore */
    }
  }

  static hasSave(): boolean {
    try {
      return fs.existsSync(SAVE_PATH);
    } catch {
      return false;
    }
  }

  load(): boolean {
    try {
      const d = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
      this.seed = d.seed >>> 0;
      this.rng = new RNG(hash2(this.seed, 0xabc + d.depth));
      this.player = { ...newPlayer(), ...d.player, act: null };
      let maxUid = 0;
      for (const it of [...this.player.inv, ...SLOTS.map((s) => this.player.eq[s])]) if (it) maxUid = Math.max(maxUid, it.uid);
      setUidFloor(maxUid);
      this.deaths = d.deaths ?? 0;
      this.kills = d.kills ?? 0;
      this.victorySeen = !!d.victorySeen;
      this.lament = 0;
      this.msgs = [];
      this.recalc();
      this.player.hp = this.stats.maxHp;
      this.player.flasks = this.player.maxFlasks;
      this.enterFloor(d.depth);
      this.mode = 'play';
      this.log('You rise from the ashes of your last rest.', 0xd0a060);
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================ audio
  sfx(id: string): void {
    if (this.sounds.length < 24) this.sounds.push(id);
  }
  /** Only audible if the source is something the player can see. */
  sfxAt(id: string, x: number, y: number): void {
    if (this.inBounds(x, y) && this.vis[this.idx(x, y)] > 0) this.sfx(id);
  }
  musicTrack(): string | null {
    if (this.mode === 'title' || (this.mode === 'help' && this.helpReturn === 'title')) return 'title';
    if (this.mode === 'dead') return null;
    if (this.mode === 'victory') return 'title';
    if (!this.floor) return 'title';
    if (this.bossActive) return 'boss';
    return ['act1', 'act2', 'act3'][this.floor.act];
  }

  // ================================================================ messaging
  log(text: string, color = 0xc8c0b0): void {
    this.msgs.push({ text, color, t: this.tick });
    if (this.msgs.length > 60) this.msgs.shift();
  }

  addFx(x: number, y: number, ch: string, color: number, t = 4): void {
    this.fx.push({ x, y, ch, color, t });
  }

  // ================================================================ input
  input(key: string, raw: string): void {
    switch (this.mode) {
      case 'title': return this.titleInput(key);
      case 'play':
        if (key === 'inv') { this.mode = 'inv'; this.invSel = 0; return; }
        if (key === 'map') { this.mode = 'map'; return; }
        if (key === 'help') { this.mode = 'help'; this.helpReturn = 'play'; return; }
        if (key === 'esc') { this.mode = 'confirmQuit'; return; }
        if (['up', 'down', 'left', 'right', 'attack', 'heavy', 'roll', 'parry', 'flask', 'interact'].includes(key))
          this.buf = { k: key, t: this.tick };
        return;
      case 'inv': return this.invInput(key, raw);
      case 'bonfire': return this.bonfireInput(key);
      case 'read':
        if (this.modal?.kind === 'stairs') {
          if (key === 'enter' || key === 'interact' || raw === 'y') {
            this.modal = null;
            this.mode = 'play';
            this.descend();
          } else if (key === 'esc' || raw === 'n') {
            this.modal = null;
            this.mode = 'play';
          }
          return;
        }
        if (raw === 'r' && this.modal?.kind === 'soko' && this.modal.puzzle) {
          this.resetSokoban(this.modal.puzzle);
          this.modal = null;
          this.mode = 'play';
          return;
        }
        if (['esc', 'enter', 'interact', 'roll', 'attack'].includes(key)) { this.modal = null; this.mode = 'play'; }
        return;
      case 'map':
        this.mode = 'play';
        return;
      case 'help':
        this.mode = this.helpReturn;
        return;
      case 'dead':
        if (this.deadT > 45) this.respawn();
        return;
      case 'victory':
        if (key === 'enter' || key === 'interact' || key === 'esc') this.mode = 'play';
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

  bonfireInput(key: string): void {
    const p = this.player;
    if (key === 'esc') { this.mode = 'play'; return; }
    if (key === 'up') { this.bonSel = (this.bonSel + 4) % 5; this.sfx('menu'); }
    else if (key === 'down') { this.bonSel = (this.bonSel + 1) % 5; this.sfx('menu'); }
    else if (key === 'enter' || key === 'interact') {
      if (this.bonSel === 4) { this.mode = 'play'; return; }
      const cost = levelCost(p.level);
      if (p.ashes < cost) { this.log('You lack the ashes. The flame is unimpressed.', 0x8a8478); this.sfx('locked'); return; }
      p.ashes -= cost;
      p.level++;
      const attr = (['vig', 'end', 'str', 'dex'] as const)[this.bonSel];
      p[attr]++;
      this.recalc();
      p.hp = this.stats.maxHp;
      p.sta = this.stats.maxSta;
      this.log(`You feel stronger. Level ${p.level}.`, 0xffd080);
      this.sfx('levelup');
      this.save();
    }
  }

  // ================================================================ main tick
  update(): void {
    this.tick++;
    if (this.banner && --this.banner.t <= 0) this.banner = null;
    if (this.mode === 'title') {
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

    this.updatePlayerAction();
    if (this.mode !== 'play') return;
    this.processBuffered();
    if (this.mode !== 'play') return;

    // stamina
    if (p.staDelay > 0) p.staDelay--;
    else if (!p.act || p.act.kind === 'recover' || p.act.kind === 'drink' || p.act.kind === 'parry') {
      const mult = p.act?.kind === 'drink' || p.act?.kind === 'parry' ? 0.5 : 1;
      p.sta = Math.min(this.stats.maxSta, p.sta + this.stats.staRegen * mult);
    }

    this.computeDist();
    const list = this.enemies.slice();
    for (const e of list) {
      if (e.dead) continue;
      if (e.boss) updateBoss(this, e);
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
    if (this.victoryPending && !this.banner) {
      this.victoryPending = false;
      this.victorySeen = true;
      this.mode = 'victory';
      this.save();
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
    }
  }

  // ================================================================ queries
  idx(x: number, y: number): number {
    return y * MAP_W + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  }
  tileAt(x: number, y: number): number {
    return this.inBounds(x, y) ? this.floor.tiles[y * MAP_W + x] : T.WALL;
  }
  isOpaque(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t === T.WALL || t === T.DOOR || t === T.LOCKED || t === T.CRACKED || t === T.FOG;
  }
  isWalkTile(t: number): boolean {
    return t === T.FLOOR || t === T.OPEN || t === T.DOOR || t === T.STAIRS;
  }
  objAt(x: number, y: number): Obj | undefined {
    return this.floor.objects.find((o) => o.x === x && o.y === y);
  }
  blockObjAt(x: number, y: number): Obj | undefined {
    return this.floor.objects.find((o) => o.x === x && o.y === y && BLOCKING.has(o.kind));
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
    if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) return false;
    const t = this.tileAt(x, y);
    if (!phase && !this.isWalkTile(t)) return false;
    if (phase && t === T.FOG) return false;
    if (x === this.player.x && y === this.player.y) return false;
    const o = this.enemyAt(x, y);
    if (o && o !== e) return false;
    if (this.blockObjAt(x, y)) return false;
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
    const d = this.dist;
    d.fill(1 << 30);
    const q = new Int32Array(MAP_W * MAP_H);
    let h = 0, t = 0;
    const s = this.idx(this.player.x, this.player.y);
    d[s] = 0;
    q[t++] = s;
    const tiles = this.floor.tiles;
    const blocked = new Uint8Array(MAP_W * MAP_H);
    for (const o of this.floor.objects) if (BLOCKING.has(o.kind)) blocked[this.idx(o.x, o.y)] = 1;
    while (h < t) {
      const c = q[h++];
      const nd = d[c] + 1;
      const nb = [c - 1, c + 1, c - MAP_W, c + MAP_W];
      for (const n of nb) {
        if (n < 0 || n >= tiles.length || d[n] <= nd) continue;
        const tt = tiles[n];
        if (!(tt === T.FLOOR || tt === T.OPEN || tt === T.DOOR || tt === T.STAIRS) || blocked[n]) continue;
        d[n] = nd;
        q[t++] = n;
      }
    }
  }

  updateFov(): void {
    const f = this.floor, p = this.player;
    this.fovMask.fill(0);
    computeFov(MAP_W, MAP_H, (x, y) => this.isOpaque(x, y), p.x, p.y, 22, this.fovMask);
    const ft = Math.floor(this.tick / 3);
    const flick = 1 + 0.05 * Math.sin(ft * 2.7) + 0.03 * Math.sin(ft * 6.9 + 1);
    const R = 8.5 * flick;
    const sources: { x: number; y: number; r: number }[] = [];
    for (const o of f.objects) {
      if (o.kind === 'bonfire') sources.push({ x: o.x, y: o.y, r: 7 });
      else if (o.kind === 'brazier' && o.lit) sources.push({ x: o.x, y: o.y, r: 5 });
    }
    for (const fl of this.fields) if (fl.kind === 'fire' && (fl.x + fl.y) % 2 === 0) sources.push({ x: fl.x, y: fl.y, r: 3 });
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = y * MAP_W + x;
        if (!this.fovMask[i]) {
          this.vis[i] = 0;
          continue;
        }
        const d = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
        let l = d < R ? Math.pow(1 - d / R, 0.8) : 0;
        for (const s of sources) {
          const ds = Math.sqrt((x - s.x) ** 2 + (y - s.y) ** 2);
          if (ds < s.r) l = Math.max(l, (1 - ds / s.r) * 0.9);
        }
        if (l > 0.04) {
          this.vis[i] = Math.min(1, l);
          f.seen[i] = 1;
        } else this.vis[i] = 0;
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
    if (e) {
      this.startAttack(false);
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
    if (t === T.LOCKED) {
      p.moveCd = 4;
      if (p.keys > 0) {
        p.keys--;
        f.tiles[i] = T.OPEN;
        this.log('The crypt key turns. The lock screams like something alive.', 0xffd060);
        this.sfx('unlock');
      } else {
        this.log('A crypt-lock seals this door. Somewhere on this floor is its key.', 0xb0a080);
        this.sfx('locked');
      }
      return;
    }
    if (t === T.CRACKED) {
      p.moveCd = 4;
      this.log('The wall here is cracked and weeping dust. A heavy blow might break it.', 0xb0a080);
      return;
    }
    if (t === T.FOG) {
      p.moveCd = 4;
      this.log('A wall of grey fog. It will not let you leave.', 0xa0a0b0);
      return;
    }
    if (t === T.WALL) return;
    if (t === T.DOOR) {
      f.tiles[i] = T.OPEN;
      this.sfx('door');
    }
    p.x = nx;
    p.y = ny;
    p.moveCd = 3;
    this.onPlayerEnter();
  }

  onPlayerEnter(): void {
    const p = this.player;
    const f = this.floor;
    // pickups
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
        if (p.maxFlasks < 9) {
          p.maxFlasks++;
          p.flasks++;
          this.log(`Sacred Tallow. Your flask swells: ${p.maxFlasks} charges.`, 0xf0e0a0);
        } else {
          p.flasks = p.maxFlasks;
          this.log('Sacred Tallow. Your flask is already full to bursting.', 0xf0e0a0);
        }
      } else if (pk.kind === 'ashes') {
        p.ashes += pk.amount ?? 0;
        this.sfx(pk.stain ? 'reclaim' : 'ashes');
        if (pk.stain) this.log(`You reclaim your bloodstain: ${pk.amount} ashes.`, 0xff6060);
        else this.log(`+${pk.amount} ashes`, 0xb0a8ff);
      }
      f.pickups.splice(i, 1);
    }
    for (const o of f.objects) {
      if (o.x !== p.x || o.y !== p.y) continue;
      if (o.kind === 'rune') this.stepRune(o);
      else if (o.kind === 'message') this.log(`Scrawled in blood: "${o.text}"`, 0xe0a050);
    }
    if (f.tiles[this.idx(p.x, p.y)] === T.STAIRS) {
      const left = f.pickups.filter((pk) => pk.kind === 'item' && Math.abs(pk.x - p.x) <= 8 && Math.abs(pk.y - p.y) <= 8).length;
      this.modal = {
        title: 'STAIRS DOWN',
        lines: [
          `Descend to depth ${this.depth + 1}? There is no way back up.`,
          ...(left ? ['', `(${left} item${left > 1 ? 's' : ''} still lie${left > 1 ? '' : 's'} on the floor nearby.)`] : []),
          '',
          '[E/Enter] descend     [Esc] stay',
        ],
        kind: 'stairs',
      };
      this.mode = 'read';
      this.buf = null;
      return;
    }
    // boss arena
    if (f.bossRoom && !this.bossDefeated && !this.bossActive && this.inRoom(p.x, p.y, f.bossRoom)) {
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

  descend(): void {
    this.log('You descend. The air grows thick and warm, like breath.', 0x9090c0);
    this.sfx('descend');
    this.enterFloor(this.depth + 1);
  }

  spendSta(n: number): void {
    this.player.sta = Math.max(-10, this.player.sta - n);
    this.player.staDelay = 14;
  }

  startAttack(heavy: boolean): void {
    const p = this.player;
    if (p.act) return;
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
    if (p.sta <= 0) {
      this.log('Too exhausted to roll.', 0x808060);
      return;
    }
    this.spendSta(22 * (1 - this.stats.rollCost / 100));
    p.act = { kind: 'roll', t: 6, dir: { ...p.face } };
    this.sfx('roll');
    p.iframes = 6;
  }

  startParry(): void {
    const p = this.player;
    if (p.act) return;
    if (p.sta <= 0) return;
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
    }
  }

  rollStep(d: Vec): void {
    const p = this.player;
    const nx = p.x + d.x, ny = p.y + d.y;
    const t = this.tileAt(nx, ny);
    if (!this.isWalkTile(t) || this.enemyAt(nx, ny) || this.blockObjAt(nx, ny)) return;
    if (t === T.DOOR) this.floor.tiles[this.idx(nx, ny)] = T.OPEN;
    p.x = nx;
    p.y = ny;
    this.onPlayerEnter();
  }

  attackTiles(pattern: string, x: number, y: number, f: Vec, heavy: boolean): Vec[] {
    const r = { x: -f.y, y: f.x };
    const at = (a: number, b: number): Vec => ({ x: x + f.x * a + r.x * b, y: y + f.y * a + r.y * b });
    switch (pattern) {
      case 'front1': return heavy ? [at(1, 0)] : [at(1, 0)];
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
    const it = p.eq.weapon;
    const b = weaponBase(it);
    const tiles = this.attackTiles(b.pattern, p.x, p.y, dir, heavy);
    const slash = dir.x !== 0 ? '|' : '─';
    const hit = new Set<Enemy>();
    for (const t of tiles) {
      if (!this.isOpaque(t.x, t.y)) this.addFx(t.x, t.y, heavy ? '#' : slash, heavy ? 0xffe0a0 : 0xffffff, heavy ? 3 : 2);
      const e = this.enemyAt(t.x, t.y);
      if (e) hit.add(e);
      const o = this.blockObjAt(t.x, t.y);
      if (o && o.kind === 'urn') this.breakUrn(o);
      if (heavy && this.tileAt(t.x, t.y) === T.CRACKED) {
        this.floor.tiles[this.idx(t.x, t.y)] = T.FLOOR;
        this.shake = 4;
        this.log('The cracked wall bursts apart! A hidden passage.', 0xffd080);
        this.sfx('crumble');
        for (let k = 0; k < 4; k++) this.addFx(t.x + this.rng.int(-1, 1), t.y + this.rng.int(-1, 1), '∙', 0xa09080, 6);
      }
    }
    if (heavy && this.stats.uniques.has('mourning')) {
      for (const d of DIRS8) {
        const e = this.enemyAt(p.x + d.x, p.y + d.y);
        if (e) hit.add(e);
        this.addFx(p.x + d.x, p.y + d.y, '*', 0xff9040, 3);
      }
    }
    for (const e of hit) this.playerHit(e, heavy, b);
    if (this.stats.uniques.has('tithe')) p.hp = Math.max(1, p.hp - Math.round(this.stats.maxHp * 0.02));
    const rec = Math.round(b.rec * (heavy ? 1.4 : 1));
    p.act = { kind: 'recover', t: rec, dir };
    this.noise = 3;
  }

  playerHit(e: Enemy, heavy: boolean, b: ReturnType<typeof weaponBase>): void {
    const p = this.player;
    const st = this.stats;
    const it = p.eq.weapon;
    const lo = it ? it.dmgMin : b.dmg[0], hi = it ? it.dmgMax : b.dmg[1];
    let dmg = this.rng.int(lo, hi) + st.flatDmg;
    let mult = 1 + st.dmgPct / 100 + scaleBonus(b, p);
    if (st.uniques.has('grudge')) mult += (1 - p.hp / st.maxHp);
    if (heavy) mult *= 1.8;
    dmg *= mult;
    let label = '';
    let crit = false;
    const lethe = st.uniques.has('lethe');
    if (e.riposte > 0 && !e.boss) {
      dmg *= lethe ? 6 : 3;
      label = 'RIPOSTE';
      e.riposte = 0;
    } else if (!e.boss && e.state === 'idle' && !e.aware) {
      dmg *= lethe ? 5 : 2.5;
      label = 'BACKSTAB';
    } else if (this.rng.chance(st.crit)) {
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
    if (e.dead) return;
    const p = this.player;
    // crypt knight shield
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
      if (st.lifesteal > 0) p.hp = Math.min(st.maxHp, p.hp + d * st.lifesteal / 100);
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
      if (this.isWalkTile(f.tiles[i]) && f.decal[i] === 0) f.decal[i] = 1;
    }
  }

  killEnemy(e: Enemy, noExplode = false): void {
    if (e.dead) return;
    e.dead = true;
    if (this.target === e) this.target = null;
    this.teles = this.teles.filter((tl) => tl.owner !== e || tl.persist);
    const p = this.player;
    const st = this.stats;
    const ashes = Math.round(e.ashes * (1 + st.ashFind / 100));
    p.ashes += ashes;
    this.kills++;
    const f = this.floor;
    const i = this.idx(e.x, e.y);
    if (this.isWalkTile(f.tiles[i])) f.decal[i] = e.def === 'archer' || e.def === 'sentinel' ? 3 : 2;
    this.bloodSpray(e.x, e.y, 3);
    if (e.boss) {
      this.onBossDefeated(e);
      return;
    }
    this.sfxAt('kill', e.x, e.y);
    this.addFx(e.x + 1, e.y, `+${ashes}`, 0xb0a8ff, 8);
    if (e.elite) this.log(`${e.name} is slain. +${ashes} ashes`, 0xffc040);
    // drops
    const d = ENEMIES[e.def];
    const table = e.elite ? 'elite' : d.loot;
    this.dropAt(e.x, e.y, rollLoot(this.rng, table, this.depth, st.mf));
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
    this.bossDefeated = true;
    this.bossActive = false;
    this.teles = [];
    this.projs = [];
    for (const o of this.enemies) if (o !== e && f.bossRoom && this.inRoom(o.x, o.y, f.bossRoom)) o.dead = true;
    f.tiles[this.idx(f.lockedDoor.x, f.lockedDoor.y)] = T.OPEN;
    const r = f.bossRoom!;
    const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
    f.tiles[this.idx(c.x, c.y)] = T.STAIRS;
    if (this.player.x === c.x && this.player.y === c.y) f.tiles[this.idx(c.x, c.y + 2)] = T.STAIRS;
    this.banner = { text: 'V A N Q U I S H E D', sub: b.name, color: 0xffd060, t: 90, max: 90 };
    this.log(b.death, 0xffd080);
    this.sfx('victory');
    this.log(`+${e.ashes} ashes. Stairs have opened in the arena.`, 0xb0a8ff);
    this.shake = 10;
    const drops: Drop[] = rollLoot(this.rng, 'boss', this.depth, this.stats.mf);
    const owned = new Set<string>();
    for (const it of [...this.player.inv, ...SLOTS.map((s) => this.player.eq[s])]) if (it?.unique) owned.add(it.unique);
    const pool = UNIQUES.filter((u) => !owned.has(u.id));
    const u = this.rng.pick(pool.length ? pool : UNIQUES);
    drops.push({ kind: 'item', item: makeUnique(this.rng, u.id, this.depth) });
    drops.push({ kind: 'tallow' });
    this.dropAt(e.x, e.y, drops);
    if (e.boss === 'king' && !this.victorySeen) this.victoryPending = true;
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
      if (d.kind === 'item' && d.item.rarity >= 2) this.sfx(d.item.rarity === 3 ? 'legendary' : 'rare');
      if (d.kind === 'item' && d.item.rarity >= 2) this.addFx(s.x, s.y - 1, '↓', RARITY_COLORS[d.item.rarity], 20);
    }
  }

  // ================================================================ damage to player
  hurtPlayer(
    dmg: number,
    o: { owner?: Enemy | null; parryable?: boolean; poison?: boolean; burn?: boolean; env?: boolean } = {},
  ): 'dodge' | 'parry' | 'hit' {
    const p = this.player;
    const st = this.stats;
    if (p.iframes > 0) {
      if (!o.env) this.addFx(p.x, p.y - 1, 'dodge', 0x9090a0, 5);
      return 'dodge';
    }
    if (p.act?.kind === 'parry' && p.act.t > PARRY_TOTAL - PARRY_WINDOW - 1 && o.parryable && o.owner && !o.owner.boss) {
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
    if (p.act?.kind === 'parry') d *= 1.15; // whiffed parry: punished a little
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
      if (st.thorns > 0) this.hurtEnemy(o.owner, dd * st.thorns / 100, 0, {});
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
    for (let i = f.pickups.length - 1; i >= 0; i--) if (f.pickups[i].stain) f.pickups.splice(i, 1);
    if (p.ashes > 0) {
      f.pickups.push({ x: p.x, y: p.y, kind: 'ashes', amount: p.ashes, stain: true });
      p.ashes = 0;
    }
    this.bloodSpray(p.x, p.y, 6);
  }

  respawn(): void {
    const p = this.player;
    const f = this.floor;
    this.recalc();
    p.hp = this.stats.maxHp;
    p.sta = this.stats.maxSta;
    p.flasks = p.maxFlasks;
    p.poison = 0;
    p.burn = 0;
    p.act = null;
    p.iframes = 0;
    p.x = f.start.x;
    p.y = f.start.y;
    this.resetWorld();
    this.mode = 'play';
    this.log('You return to the bonfire. Your bloodstain waits where you fell.', 0xd08060);
  }

  resetWorld(): void {
    const f = this.floor;
    this.teles = [];
    this.projs = [];
    this.fields = [];
    this.bossActive = false;
    if (f.tiles[this.idx(f.lockedDoor.x, f.lockedDoor.y)] === T.FOG) f.tiles[this.idx(f.lockedDoor.x, f.lockedDoor.y)] = T.OPEN;
    this.spawnEnemies();
    this.target = null;
    if (this.lament) {
      this.lament = 0;
      this.recalc();
    }
    this.updateFov();
  }

  rest(): void {
    const p = this.player;
    this.recalc();
    p.hp = this.stats.maxHp;
    p.sta = this.stats.maxSta;
    p.flasks = p.maxFlasks;
    p.poison = 0;
    p.burn = 0;
    this.resetWorld();
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
      const o = this.objAt(s.x, s.y);
      if (o && o.kind !== 'plate' && o.kind !== 'spikes' && o.kind !== 'rune' && !(o.kind === 'chest' && o.open)) {
        this.useObject(o);
        return;
      }
    }
    this.log('Nothing here but dust and old bones.', 0x6a6458);
  }

  useObject(o: Obj): void {
    switch (o.kind) {
      case 'bonfire': this.rest(); break;
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
      case 'message':
        this.log(`Scrawled in blood: "${o.text}"`, 0xe0a050);
        break;
      case 'urn':
        this.log('A funeral urn. Strike it to see what the dead were buried with.', 0x8a8478);
        break;
      case 'boulder':
        this.log('A heavy stone. Walk into it to push.', 0x8a8478);
        break;
    }
  }

  openChest(o: Obj): void {
    if (o.open) return;
    o.open = true;
    const p = this.player;
    this.shake = 1;
    this.sfx('chest');
    if (o.loot === 'key') {
      this.log('The chest groans open. Inside, wrapped in a strip of skin: a Crypt Key.', 0xffd060);
      this.floor.pickups.push({ x: p.x, y: p.y, kind: 'key' });
      this.onPlayerEnter();
      this.dropAt(o.x, o.y, rollLoot(this.rng, 'chest', this.depth, this.stats.mf).slice(0, 1));
    } else if (o.loot === 'treasure') {
      this.log('A reliquary chest. Gold light spills out.', 0xffc040);
      this.dropAt(o.x, o.y, rollLoot(this.rng, 'treasure', this.depth, this.stats.mf));
    } else {
      this.log('The chest opens with a sigh of old air.', 0xc0a070);
      this.dropAt(o.x, o.y, rollLoot(this.rng, 'chest', this.depth, this.stats.mf));
    }
  }

  breakUrn(o: Obj): void {
    const f = this.floor;
    f.objects.splice(f.objects.indexOf(o), 1);
    this.sfx('urn');
    if (this.rng.chance(0.35)) this.log(this.rng.pick(URN_LINES), 0x8a8478);
    for (let k = 0; k < 3; k++) this.addFx(o.x + this.rng.int(-1, 1), o.y + this.rng.int(-1, 1), '∙', 0xa07850, 5);
    f.decal[this.idx(o.x, o.y)] = 3;
    this.dropAt(o.x, o.y, rollLoot(this.rng, 'urn', this.depth, this.stats.mf));
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
    const solved = pz.plates.every((pl) => f.objects.some((b) => b.kind === 'boulder' && b.puzzle === pz.id && b.x === pl.x && b.y === pl.y));
    const onPlate = pz.plates.some((pl) => pl.x === tx && pl.y === ty);
    if (onPlate) this.sfx('plate');
    if (onPlate && !solved) this.log('The scale sinks with a deep, satisfied click.', 0xc0b890);
    if (solved) this.solvePuzzle(pz, 'The last scale sinks. Stone grinds against stone somewhere close.');
    return true;
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
      const pool = ['hollow', 'ghoul', 'cultist'].filter((d) => ENEMIES[d].minDepth <= this.depth);
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

  solvePuzzle(pz: Puzzle, text: string): void {
    pz.solved = true;
    this.log(text, 0xffe0a0);
    this.sfx('solved');
    this.shake = 3;
    const r = pz.room;
    const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
    // find a free floor cell near the center for the reward chest
    let best: Vec | null = null;
    let bd = 1e9;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (this.tileAt(x, y) !== T.FLOOR || this.objAt(x, y) || this.enemyAt(x, y)) continue;
        if (x === this.player.x && y === this.player.y) continue;
        if (this.floor.noBoulder[this.idx(x, y)]) continue;
        const d = (x - c.x) ** 2 + (y - c.y) ** 2;
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
    if (!best) best = { x: this.player.x, y: this.player.y };
    this.floor.objects.push({ id: 9000 + pz.id, kind: 'chest', x: best.x, y: best.y, loot: pz.reward === 'key' ? 'key' : 'treasure' });
    this.addFx(best.x, best.y - 1, '↓', 0xffd060, 30);
    this.log(pz.reward === 'key' ? 'A chest rises from the floor. It smells of iron.' : 'A reliquary rises from the floor.', 0xffd060);
  }

  spawnEnemyNear(def: string, x: number, y: number, rmin: number, rmax: number): Enemy | null {
    for (let t = 0; t < 60; t++) {
      const px = x + this.rng.int(-rmax, rmax), py = y + this.rng.int(-rmax, rmax);
      if (Math.max(Math.abs(px - x), Math.abs(py - y)) < rmin) continue;
      if (!this.inBounds(px, py) || !this.isWalkTile(this.tileAt(px, py))) continue;
      if (this.enemyAt(px, py) || this.blockObjAt(px, py) || (px === this.player.x && py === this.player.y)) continue;
      const e = this.makeEnemy(def, px, py, false);
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
    if (!this.inBounds(x, y) || !this.isWalkTile(this.tileAt(x, y))) return;
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
          this.hurtPlayer(t.dmg, { owner: t.owner, parryable: t.parryable, poison: t.poison, burn: t.burn });
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
          pr.life = 0;
          break;
        }
        if (tx === p.x && ty === p.y) {
          const r = this.hurtPlayer(pr.dmg, { parryable: false });
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
      if (e.burn > 0 && !e.dead) {
        e.burn -= 10;
        this.hurtEnemy(e, 2 + e.maxHp * (e.boss ? 0.006 : 0.03), 0, {});
        this.addFx(e.x, e.y - 1, '^', 0xff8030, 3);
      }
    }
  }

  // ================================================================ helpers for UI
  nearbyDescription(): string[] {
    const p = this.player;
    const out: string[] = [];
    const seen = new Set<Obj>();
    for (const d of [{ x: 0, y: 0 }, ...DIRS8]) {
      const x = p.x + d.x, y = p.y + d.y;
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
        }
      }
      const t = this.tileAt(x, y);
      if (t === T.CRACKED) out.push('A cracked wall');
      if (t === T.LOCKED) out.push(p.keys ? 'Locked door (you have a key)' : 'Locked door (needs a key)');
    }
    return out.slice(0, 3);
  }

  actName(): string {
    return this.floor.name;
  }

  act(): number {
    return actOf(this.depth);
  }
}
