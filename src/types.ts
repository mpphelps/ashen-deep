export type Vec = { x: number; y: number };

export const T = {
  WALL: 0,
  FLOOR: 1,
  DOOR: 2,
  OPEN: 3,
  LOCKED: 4,
  CRACKED: 5,
  STAIRS: 6,
  FOG: 7,
  RUBBLE: 8, // cleared with the spade
  THORNS: 9, // burned with the lantern
  CHASM: 10, // crossed with the chain hook
  PHANTOM: 11, // solid only while the bell resonates
  WATER: 12,
  BROKEN: 13, // broken bridge
  TREE: 14,
  FENCE: 15,
  ENTRANCE: 16, // dungeon entrance (overworld)
  UPSTAIRS: 17, // leave dungeon
  BRIDGE: 18,
} as const;

export type ToolId = 'spade' | 'lantern' | 'hook' | 'bell';
export const TOOLS: ToolId[] = ['spade', 'lantern', 'hook', 'bell'];

export const DIRS: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
// clockwise starting north
export const DIRS8: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export type Slot = 'weapon' | 'helm' | 'chest' | 'ring' | 'amulet';
export const SLOTS: Slot[] = ['weapon', 'helm', 'chest', 'ring', 'amulet'];

export interface Affix {
  id: string;
  v: number;
}

export interface Item {
  uid: number;
  slot: Slot;
  base: string;
  baseName: string;
  name: string;
  rarity: number; // 0 common, 1 magic, 2 rare, 3 legendary
  ilvl: number;
  dmgMin: number;
  dmgMax: number;
  armor: number;
  affixes: Affix[];
  unique: string | null;
}

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  theme?: string;
  visited?: boolean;
}

export type ObjKind =
  | 'chest'
  | 'urn'
  | 'brazier'
  | 'rune'
  | 'plate'
  | 'boulder'
  | 'tablet'
  | 'bonfire'
  | 'message'
  | 'spikes'
  | 'deco'
  | 'grave'
  | 'lamp';

export interface Obj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  open?: boolean;
  loot?: string;
  color?: number;
  cname?: string;
  lit?: boolean;
  idx?: number;
  puzzle?: number;
  text?: string;
  off?: number;
  glyph?: string; // deco
  name?: string; // deco / grave
  block?: boolean; // deco
  dug?: boolean; // grave
}

export interface Puzzle {
  id: number;
  kind: 'sokoban' | 'lights' | 'braziers';
  room: Room;
  reward: 'key' | 'treasure';
  solved: boolean;
  plates: Vec[];
  boulderStart: Vec[];
  n: number;
  order: number[];
  progress: number;
  riddle: string[];
  tool?: ToolId; // a tool is added to the reward chest
}

export interface Pickup {
  x: number;
  y: number;
  kind: 'item' | 'key' | 'tallow' | 'ashes' | 'lore' | 'quest' | 'tool';
  item?: Item;
  amount?: number;
  stain?: boolean;
  id?: string;
}

export interface Spawn {
  def: string;
  x: number;
  y: number;
  elite: boolean;
  tier?: number;
  name?: string;
  flag?: string; // set when killed (quest targets)
  req?: string; // only spawns while this flag test passes ('x' = has flag, '!x' = lacks it)
}

export interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tier: number;
  music: string;
}

export interface NpcSpot {
  id: string;
  x: number;
  y: number;
}

export interface Floor {
  key: string; // 'world' or 'd{n}f{m}'
  kind: 'world' | 'dungeon';
  biome: string;
  depth: number; // difficulty tier
  dungeon: number; // -1 for world
  level: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  ground: Uint8Array; // terrain style per cell (world)
  seen: Uint8Array;
  decal: Uint8Array; // 1 blood, 2 corpse, 3 bones
  roomAt: Int16Array;
  noBoulder: Uint8Array;
  rooms: Room[];
  objects: Obj[];
  pickups: Pickup[];
  spawns: Spawn[];
  puzzles: Puzzle[];
  start: Vec;
  bonfire: Vec;
  exitRoom: Room | null;
  bossRoom: Room | null;
  bossId: string | null;
  lockedDoor: Vec;
  secretRoom: Room | null;
  name: string;
  ambient: number; // base light level everywhere in view
  fovR: number;
  regions: Region[];
  entrances: { x: number; y: number; dungeon: number }[];
  npcs: NpcSpot[];
  liveEnemies: Enemy[] | null;
  needsRespawn: boolean;
}

export type EState = 'idle' | 'chase' | 'windup' | 'recover' | 'stagger';

export interface Enemy {
  id: number;
  def: string;
  boss: string | null;
  name: string;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  dmg: number;
  poise: number;
  maxPoise: number;
  speed: number;
  state: EState;
  t: number;
  cd: number;
  moveT: number;
  face: Vec;
  aware: boolean;
  lostT: number;
  flash: number;
  alertT: number;
  burn: number;
  bleed: number;
  elite: { mods: string[] } | null;
  combo: number;
  phase: number;
  riposte: number;
  wmult: number;
  birthCd: number;
  dead: boolean;
  ashes: number;
  tier: number;
  flag: string | null;
  ally: boolean; // a raised thrall
  venom: number;
  blind: number; // ticks it cannot notice you
}

export interface Tele {
  tiles: Vec[];
  t: number;
  max: number;
  dmg: number;
  owner: Enemy | null;
  parryable: boolean;
  kind: string; // melee | aim | fire | acid | boss | blast
  poison?: boolean;
  burn?: boolean;
  hitsEnemies?: boolean;
  persist?: boolean;
  onFire?: () => void;
}

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  glyph: string;
  color: number;
  life: number;
  friendly?: boolean; // fired by the player: hits enemies, not you
  pierce?: number;
  hits?: number[];
  sx?: number;
  sy?: number;
  onHit?: (e: Enemy) => void;
}

export interface Field {
  x: number;
  y: number;
  kind: 'fire' | 'acid';
  t: number;
}

export interface Fx {
  x: number;
  y: number;
  ch: string;
  color: number;
  t: number;
}

export interface PAction {
  kind: 'attack' | 'heavy' | 'roll' | 'parry' | 'drink' | 'recover' | 'skill';
  t: number;
  dir: Vec;
  skill?: string;
}

export interface Player {
  x: number;
  y: number;
  face: Vec;
  hp: number;
  sta: number;
  staDelay: number;
  level: number;
  vig: number;
  end: number;
  str: number;
  dex: number;
  ashes: number;
  flasks: number;
  maxFlasks: number;
  keys: number;
  inv: Item[];
  eq: Record<Slot, Item | null>;
  act: PAction | null;
  iframes: number;
  moveCd: number;
  flash: number;
  poison: number;
  burn: number;
  tools: ToolId[];
  tool: number; // index into TOOLS of the selected tool
  salts: number; // embalming salts bought from Pell (+flask healing)
  lastSafe: Vec;
  talents: string[];
  talentPoints: number;
  slots: (string | null)[]; // three active-skill slots (U, O, P)
  cds: Record<string, number>; // cooldowns in ticks
  guard: boolean; // shield raised
  buffs: { warcry: number; bone: number; boneT: number; aim: number };
}
