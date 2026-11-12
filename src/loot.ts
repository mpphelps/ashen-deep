// Items, affixes, uniques, loot tables, derived player stats.
import type { RNG } from './rng.ts';
import { SLOTS, type Item, type Slot, type Player } from './types.ts';

export const RARITY_NAMES = ['Common', 'Magic', 'Rare', 'Legendary'];
export const RARITY_COLORS = [0xc8c8c8, 0x7898ff, 0xffe04a, 0xff8a20];
export const INV_MAX = 20;

let UID = 1;
export function setUidFloor(n: number): void {
  UID = Math.max(UID, n + 1);
}

// ---------------------------------------------------------------- bases
export interface WeaponBase {
  id: string;
  names: string[];
  dmg: [number, number];
  rec: number;
  sta: number;
  scale: 'str' | 'dex' | 'both';
  pattern: 'front1' | 'arc3' | 'line2' | 'arc5' | 'ring8';
  poise: number;
  crit: number;
}

export const WEAPONS: Record<string, WeaponBase> = {
  dagger: { id: 'dagger', names: ['Rusted Shiv', 'Kris', 'Misericorde'], dmg: [5, 8], rec: 4, sta: 9, scale: 'dex', pattern: 'front1', poise: 0.6, crit: 0.12 },
  sword: { id: 'sword', names: ['Notched Sword', 'Longsword', "Executioner's Blade"], dmg: [9, 13], rec: 7, sta: 15, scale: 'both', pattern: 'arc3', poise: 1, crit: 0.05 },
  spear: { id: 'spear', names: ['Pitchfork', 'Boar Spear', 'Halberd'], dmg: [10, 14], rec: 8, sta: 16, scale: 'dex', pattern: 'line2', poise: 1, crit: 0.06 },
  axe: { id: 'axe', names: ["Woodsman's Axe", 'Greataxe', "Headsman's Axe"], dmg: [17, 25], rec: 13, sta: 27, scale: 'str', pattern: 'arc5', poise: 1.6, crit: 0.03 },
  mace: { id: 'mace', names: ['Cudgel', 'Morningstar', 'Warhammer'], dmg: [14, 20], rec: 10, sta: 22, scale: 'str', pattern: 'front1', poise: 2.4, crit: 0.04 },
  scythe: { id: 'scythe', names: ['Sickle', 'War Scythe', 'Grave Scythe'], dmg: [8, 12], rec: 11, sta: 24, scale: 'dex', pattern: 'ring8', poise: 0.9, crit: 0.05 },
};
export const FISTS: WeaponBase = { id: 'fists', names: ['Bare Hands'], dmg: [2, 4], rec: 5, sta: 8, scale: 'str', pattern: 'front1', poise: 0.5, crit: 0.02 };

export const PATTERN_DESC: Record<string, string> = {
  front1: 'single target',
  arc3: '3-wide arc',
  line2: 'reach of 2',
  arc5: 'wide sweep',
  ring8: 'hits all around',
};

const ARMOR_BASES: Record<string, { names: string[]; armor: [number, number] }> = {
  helm: { names: ['Leather Hood', 'Iron Helm', 'Grave Warden Helm'], armor: [4, 8] },
  chest: { names: ['Bloodstained Rags', 'Chainmail', 'Blackiron Plate'], armor: [8, 16] },
  ring: { names: ['Bone Ring', 'Iron Band', 'Black Signet'], armor: [0, 0] },
  amulet: { names: ['Tooth Necklace', 'Pewter Pendant', 'Reliquary'], armor: [0, 0] },
};

// ---------------------------------------------------------------- affixes
interface AffixDef {
  id: string;
  name: string;
  pre: boolean;
  slots: string; // w weapon, a armor (helm/chest), j jewelry
  min: number;
  max: number;
  grow: number;
  fmt: string;
}

export const AFFIXES: AffixDef[] = [
  { id: 'dmgPct', name: 'Cruel', pre: true, slots: 'wj', min: 8, max: 20, grow: 0.06, fmt: '+{v}% damage' },
  { id: 'flatDmg', name: 'Brutal', pre: true, slots: 'w', min: 2, max: 4, grow: 0.18, fmt: '+{v} damage' },
  { id: 'lifesteal', name: 'Vampiric', pre: true, slots: 'wj', min: 2, max: 5, grow: 0.03, fmt: '{v}% life steal' },
  { id: 'bleed', name: 'Serrated', pre: true, slots: 'w', min: 18, max: 32, grow: 0.05, fmt: '+{v} bleed build-up' },
  { id: 'burn', name: 'Smoldering', pre: true, slots: 'w', min: 12, max: 25, grow: 0.04, fmt: '{v}% chance to ignite' },
  { id: 'staCost', name: 'Balanced', pre: true, slots: 'w', min: 8, max: 18, grow: 0.02, fmt: '-{v}% attack stamina' },
  { id: 'maxHp', name: 'Stout', pre: true, slots: 'aj', min: 8, max: 18, grow: 0.12, fmt: '+{v} max HP' },
  { id: 'armor', name: 'Fortified', pre: true, slots: 'a', min: 4, max: 10, grow: 0.12, fmt: '+{v} armor' },
  { id: 'thorns', name: 'Barbed', pre: true, slots: 'a', min: 10, max: 25, grow: 0.03, fmt: 'Reflect {v}% melee damage' },
  { id: 'crit', name: 'of Precision', pre: false, slots: 'wj', min: 3, max: 8, grow: 0.03, fmt: '+{v}% crit chance' },
  { id: 'critMult', name: 'of Slaughter', pre: false, slots: 'wj', min: 20, max: 45, grow: 0.04, fmt: '+{v}% crit damage' },
  { id: 'maxSta', name: 'of Endurance', pre: false, slots: 'aj', min: 6, max: 15, grow: 0.08, fmt: '+{v} max stamina' },
  { id: 'staRegen', name: 'of the Wind', pre: false, slots: 'aj', min: 10, max: 22, grow: 0.03, fmt: '+{v}% stamina regen' },
  { id: 'rollCost', name: 'of Shadows', pre: false, slots: 'a', min: 10, max: 25, grow: 0.02, fmt: '-{v}% roll stamina' },
  { id: 'flaskPct', name: 'of Mending', pre: false, slots: 'aj', min: 10, max: 25, grow: 0.04, fmt: '+{v}% flask healing' },
  { id: 'ashFind', name: 'of Greed', pre: false, slots: 'waj', min: 10, max: 25, grow: 0.05, fmt: '+{v}% ashes gained' },
  { id: 'mf', name: 'of Fortune', pre: false, slots: 'aj', min: 10, max: 30, grow: 0.05, fmt: '+{v}% magic find' },
];
const AFFIX_BY_ID: Record<string, AffixDef> = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));

function slotChar(slot: Slot): string {
  return slot === 'weapon' ? 'w' : slot === 'helm' || slot === 'chest' ? 'a' : 'j';
}

// ---------------------------------------------------------------- uniques
export interface UniqueDef {
  id: string;
  name: string;
  slot: Slot;
  base: string;
  affixes: [string, number][];
  special: string;
}

export const UNIQUES: UniqueDef[] = [
  { id: 'grudge', name: 'Grudgebearer', slot: 'weapon', base: 'axe', affixes: [['dmgPct', 15], ['maxHp', 15]], special: '+1% damage for every 1% of health you are missing.' },
  { id: 'lethe', name: 'Whisper of Lethe', slot: 'weapon', base: 'dagger', affixes: [['crit', 15], ['critMult', 50]], special: 'Backstabs and ripostes deal double. Crits restore 8 stamina.' },
  { id: 'mourning', name: 'Mourningstar', slot: 'weapon', base: 'mace', affixes: [['burn', 30]], special: 'Heavy attacks unleash a shockwave on all adjacent foes.' },
  { id: 'lament', name: "Widow's Lament", slot: 'weapon', base: 'scythe', affixes: [['lifesteal', 6], ['dmgPct', 20]], special: 'Each kill grants +5% damage until you rest (max +50%).' },
  { id: 'crown', name: 'Crown of Thorns', slot: 'helm', base: 'helm', affixes: [['thorns', 50], ['armor', 8]], special: 'You bleed for your sins: -15% max HP.' },
  { id: 'ember', name: 'Ember Heart', slot: 'chest', base: 'chest', affixes: [['armor', 14], ['maxHp', 20]], special: 'Your strikes always ignite. Fire cannot hurt you.' },
  { id: 'ninth', name: 'The Ninth Finger', slot: 'ring', base: 'ring', affixes: [['ashFind', 30]], special: 'Kills restore 15 stamina and 5 HP.' },
  { id: 'tithe', name: 'Bloodtithe Band', slot: 'ring', base: 'ring', affixes: [['dmgPct', 45]], special: 'Every swing costs 2% of your max HP.' },
  { id: 'mercy', name: "Saint's Last Mercy", slot: 'amulet', base: 'amulet', affixes: [['flaskPct', 60], ['staRegen', 15]], special: 'Drinking a flask also cleanses poison and fire.' },
  { id: 'hunger', name: 'Hunger of the Hollow', slot: 'amulet', base: 'amulet', affixes: [['lifesteal', 4], ['critMult', 30]], special: 'Backstabs and ripostes heal 25% of max HP.' },
];
const UNIQUE_BY_ID: Record<string, UniqueDef> = Object.fromEntries(UNIQUES.map((u) => [u.id, u]));

// ---------------------------------------------------------------- generation
const RARE_A = ['Grief', 'Carrion', 'Doom', 'Bone', 'Blood', 'Woe', 'Rot', 'Ash', 'Gloom', 'Dread', 'Corpse', 'Hate', 'Sorrow', 'Plague', 'Shade', 'Mourn', 'Viper', 'Wraith', 'Hollow', 'Grave', 'Spite'];
const RARE_B: Record<Slot, string[]> = {
  weapon: ['Bite', 'Fang', 'Thirst', 'Song', 'Edge', 'Kiss', 'Reaver', 'Rend', 'Wail', 'Mangler', 'Gutter'],
  helm: ['Visage', 'Crown', 'Mask', 'Brow', 'Cowl', 'Gaze'],
  chest: ['Shroud', 'Hide', 'Carapace', 'Mantle', 'Veil', 'Skin'],
  ring: ['Loop', 'Coil', 'Band', 'Circle', 'Knot', 'Noose'],
  amulet: ['Heart', 'Charm', 'Eye', 'Talisman', 'Locket', 'Tongue'],
};

function tierFor(rng: RNG, ilvl: number): number {
  let t = Math.floor((ilvl - 1) / 3);
  if (rng.chance(0.2)) t--;
  return Math.max(0, Math.min(2, t));
}

function rollAffixValue(rng: RNG, def: AffixDef, ilvl: number): number {
  const v = (def.min + rng.next() * (def.max - def.min)) * (1 + def.grow * (ilvl - 1));
  return Math.max(1, Math.round(v));
}

export function makeItem(rng: RNG, ilvl: number, rarity: number, forceSlot?: Slot, forceBase?: string): Item {
  if (rarity >= 3) {
    const pool = UNIQUES.filter((u) => !forceSlot || u.slot === forceSlot);
    return makeUnique(rng, rng.pick(pool).id, ilvl);
  }
  const slot: Slot =
    forceSlot ?? rng.weighted<Slot>([['weapon', 34], ['helm', 16], ['chest', 16], ['ring', 17], ['amulet', 17]]);
  const tier = tierFor(rng, ilvl);
  const it: Item = {
    uid: UID++, slot, base: '', baseName: '', name: '', rarity, ilvl,
    dmgMin: 0, dmgMax: 0, armor: 0, affixes: [], unique: null,
  };
  if (slot === 'weapon') {
    const b = WEAPONS[forceBase ?? rng.pick(Object.keys(WEAPONS))];
    it.base = b.id;
    it.baseName = b.names[tier];
    const f = 1 + 0.16 * (ilvl - 1) + tier * 0.1;
    it.dmgMin = Math.round(b.dmg[0] * f);
    it.dmgMax = Math.round(b.dmg[1] * f);
  } else {
    const b = ARMOR_BASES[slot];
    it.base = slot;
    it.baseName = b.names[tier];
    if (b.armor[1] > 0) it.armor = Math.round(rng.int(b.armor[0], b.armor[1]) * (1 + 0.15 * (ilvl - 1)) + tier * 2);
  }
  const count = rarity === 0 ? 0 : rarity === 1 ? rng.int(1, 2) : rng.int(3, 4);
  const pool = rng.shuffle(AFFIXES.filter((a) => a.slots.includes(slotChar(slot))));
  let pre = 0, suf = 0;
  const maxEach = rarity === 1 ? 1 : 2;
  for (const a of pool) {
    if (it.affixes.length >= count) break;
    if (a.pre && pre >= maxEach) continue;
    if (!a.pre && suf >= maxEach) continue;
    it.affixes.push({ id: a.id, v: rollAffixValue(rng, a, ilvl) });
    if (a.pre) pre++;
    else suf++;
  }
  if (rarity === 0) it.name = it.baseName;
  else if (rarity === 1) {
    const p = it.affixes.map((a) => AFFIX_BY_ID[a.id]).find((d) => d.pre);
    const s = it.affixes.map((a) => AFFIX_BY_ID[a.id]).find((d) => !d.pre);
    it.name = [p?.name, it.baseName, s?.name].filter(Boolean).join(' ');
  } else it.name = `${rng.pick(RARE_A)} ${rng.pick(RARE_B[slot])}`;
  return it;
}

export function makeUnique(rng: RNG, id: string, ilvl: number): Item {
  const u = UNIQUE_BY_ID[id];
  const tier = Math.max(1, tierFor(rng, ilvl));
  const it: Item = {
    uid: UID++, slot: u.slot, base: u.base, baseName: '', name: u.name, rarity: 3, ilvl,
    dmgMin: 0, dmgMax: 0, armor: 0, affixes: [], unique: u.id,
  };
  if (u.slot === 'weapon') {
    const b = WEAPONS[u.base];
    it.baseName = b.names[tier];
    const f = 1.15 + 0.16 * (ilvl - 1) + tier * 0.1;
    it.dmgMin = Math.round(b.dmg[0] * f);
    it.dmgMax = Math.round(b.dmg[1] * f);
  } else {
    const b = ARMOR_BASES[u.slot];
    it.baseName = b.names[tier];
    if (b.armor[1] > 0) it.armor = Math.round(b.armor[1] * (1 + 0.15 * (ilvl - 1)) + tier * 2);
  }
  const g = 1 + 0.04 * (ilvl - 1);
  it.affixes = u.affixes.map(([aid, v]) => ({ id: aid, v: Math.round(v * g) }));
  return it;
}

// ---------------------------------------------------------------- loot tables
export type DropKind = 'none' | 'item' | 'ashes' | 'tallow' | 'flask';
export interface LootEntry {
  w: number;
  kind: DropKind;
  minRarity?: number;
}
export interface LootTable {
  rolls: number;
  entries: LootEntry[];
}

export const LOOT_TABLES: Record<string, LootTable> = {
  vermin: { rolls: 1, entries: [{ w: 95, kind: 'none' }, { w: 3, kind: 'item' }, { w: 2, kind: 'ashes' }] },
  trash: { rolls: 1, entries: [{ w: 80, kind: 'none' }, { w: 14, kind: 'item' }, { w: 6, kind: 'ashes' }] },
  soldier: { rolls: 1, entries: [{ w: 68, kind: 'none' }, { w: 25, kind: 'item' }, { w: 7, kind: 'ashes' }] },
  brute: { rolls: 1, entries: [{ w: 40, kind: 'none' }, { w: 50, kind: 'item' }, { w: 10, kind: 'ashes' }] },
  elite: { rolls: 2, entries: [{ w: 90, kind: 'item', minRarity: 1 }, { w: 10, kind: 'tallow' }] },
  chest: { rolls: 2, entries: [{ w: 80, kind: 'item' }, { w: 18, kind: 'ashes' }, { w: 2, kind: 'tallow' }] },
  treasure: { rolls: 3, entries: [{ w: 80, kind: 'item', minRarity: 1 }, { w: 10, kind: 'tallow' }, { w: 10, kind: 'ashes' }] },
  urn: { rolls: 1, entries: [{ w: 58, kind: 'none' }, { w: 32, kind: 'ashes' }, { w: 7, kind: 'item' }, { w: 3, kind: 'flask' }] },
  boss: { rolls: 3, entries: [{ w: 100, kind: 'item', minRarity: 2 }] },
};

export type Drop =
  | { kind: 'item'; item: Item }
  | { kind: 'ashes'; amount: number }
  | { kind: 'tallow' }
  | { kind: 'flask' };

export function rollRarity(rng: RNG, depth: number, mf: number, minRarity = 0): number {
  const m = 1 + mf / 100;
  const w: [number, number][] = [
    [0, 68],
    [1, 25 * (1 + depth * 0.06) * m],
    [2, 6 * (1 + depth * 0.12) * m],
    [3, 0.7 * (1 + depth * 0.15) * m],
  ];
  return Math.max(minRarity, rng.weighted(w));
}

export function rollLoot(rng: RNG, table: string, depth: number, mf: number): Drop[] {
  const t = LOOT_TABLES[table];
  const out: Drop[] = [];
  for (let i = 0; i < t.rolls; i++) {
    const e = rng.weighted(t.entries.map((en) => [en, en.w] as const));
    if (e.kind === 'item') out.push({ kind: 'item', item: makeItem(rng, depth, rollRarity(rng, depth, mf, e.minRarity ?? 0)) });
    else if (e.kind === 'ashes') out.push({ kind: 'ashes', amount: Math.round(rng.int(8, 20) * (1 + depth * 0.4)) });
    else if (e.kind === 'tallow') out.push({ kind: 'tallow' });
    else if (e.kind === 'flask') out.push({ kind: 'flask' });
  }
  return out;
}

// ---------------------------------------------------------------- stats
export interface Stats {
  maxHp: number;
  maxSta: number;
  staRegen: number;
  armor: number;
  dmgPct: number;
  flatDmg: number;
  crit: number;
  critMult: number;
  lifesteal: number;
  bleed: number;
  burn: number;
  thorns: number;
  ashFind: number;
  flaskPct: number;
  rollCost: number;
  staCost: number;
  mf: number;
  uniques: Set<string>;
}

export function computeStats(p: Player, lament: number): Stats {
  const s: Stats = {
    maxHp: 60 + p.vig * 8, maxSta: 60 + p.end * 4, staRegen: 1.5, armor: 0, dmgPct: 0, flatDmg: 0,
    crit: 0.04 + (p.dex - 5) * 0.004, critMult: 2, lifesteal: 0, bleed: 0, burn: 0, thorns: 0, ashFind: 0,
    flaskPct: 0, rollCost: 0, staCost: 0, mf: 0, uniques: new Set(),
  };
  let regenPct = 0;
  for (const slot of SLOTS) {
    const it = p.eq[slot];
    if (!it) continue;
    s.armor += it.armor;
    if (it.unique) s.uniques.add(it.unique);
    if (slot === 'weapon') s.crit += (WEAPONS[it.base] ?? FISTS).crit;
    for (const a of it.affixes) {
      switch (a.id) {
        case 'dmgPct': s.dmgPct += a.v; break;
        case 'flatDmg': s.flatDmg += a.v; break;
        case 'lifesteal': s.lifesteal += a.v; break;
        case 'bleed': s.bleed += a.v; break;
        case 'burn': s.burn += a.v; break;
        case 'staCost': s.staCost += a.v; break;
        case 'maxHp': s.maxHp += a.v; break;
        case 'armor': s.armor += a.v; break;
        case 'thorns': s.thorns += a.v; break;
        case 'crit': s.crit += a.v / 100; break;
        case 'critMult': s.critMult += a.v / 100; break;
        case 'maxSta': s.maxSta += a.v; break;
        case 'staRegen': regenPct += a.v; break;
        case 'rollCost': s.rollCost += a.v; break;
        case 'flaskPct': s.flaskPct += a.v; break;
        case 'ashFind': s.ashFind += a.v; break;
        case 'mf': s.mf += a.v; break;
      }
    }
  }
  s.staRegen *= 1 + regenPct / 100;
  s.rollCost = Math.min(60, s.rollCost);
  s.staCost = Math.min(50, s.staCost);
  s.lifesteal = Math.min(25, s.lifesteal);
  if (s.uniques.has('crown')) s.maxHp = Math.round(s.maxHp * 0.85);
  s.dmgPct += lament * 5;
  return s;
}

export function weaponBase(it: Item | null): WeaponBase {
  if (!it) return FISTS;
  return WEAPONS[it.base] ?? FISTS;
}

export function scaleBonus(b: WeaponBase, p: Player): number {
  if (b.scale === 'str') return (p.str - 5) * 0.04;
  if (b.scale === 'dex') return (p.dex - 5) * 0.04;
  return (p.str - 5 + (p.dex - 5)) * 0.022;
}

export function salvageValue(it: Item): number {
  return Math.round([6, 25, 70, 250][it.rarity] * (1 + it.ilvl * 0.25));
}

export function itemLines(it: Item): [string, number][] {
  const out: [string, number][] = [];
  out.push([it.name, RARITY_COLORS[it.rarity]]);
  out.push([`${RARITY_NAMES[it.rarity]} ${it.baseName}`, 0x8a8478]);
  if (it.slot === 'weapon') {
    const b = WEAPONS[it.base];
    out.push([`Damage ${it.dmgMin}-${it.dmgMax}`, 0xe8e0d0]);
    const spd = b.rec <= 5 ? 'Fast' : b.rec <= 8 ? 'Normal' : b.rec <= 11 ? 'Slow' : 'Very slow';
    out.push([`${spd} · ${PATTERN_DESC[b.pattern]}`, 0xa8a090]);
    out.push([`Stamina ${b.sta} · Scales ${b.scale === 'both' ? 'STR/DEX' : b.scale.toUpperCase()}`, 0xa8a090]);
  } else if (it.armor > 0) out.push([`Armor ${it.armor}`, 0xe8e0d0]);
  else out.push([`${it.slot === 'ring' ? 'Ring' : 'Amulet'}`, 0xa8a090]);
  for (const a of it.affixes) {
    const d = AFFIX_BY_ID[a.id];
    out.push([d.fmt.replace('{v}', String(a.v)), 0x7898ff]);
  }
  if (it.unique) out.push([UNIQUE_BY_ID[it.unique].special, 0xff9a40]);
  out.push([`Item level ${it.ilvl}`, 0x5a554c]);
  return out;
}

export function itemGlyph(it: Item): string {
  switch (it.slot) {
    case 'weapon': return '/';
    case 'helm': return '∩';
    case 'chest': return '[';
    case 'ring': return '=';
    case 'amulet': return '"';
  }
}
