// Static game data: bestiary, bosses, biomes, themed rooms, flavor text.
import type { RNG } from './rng.ts';

export type AtkType = 'melee' | 'lunge' | 'ranged' | 'cast' | 'explode' | 'sweep' | 'slam' | 'combo' | 'phase';

export interface EnemyDef {
  id: string;
  name: string;
  glyph: string;
  color: number;
  hp: number;
  dmg: number;
  poise: number;
  speed: number; // ticks per step
  atk: AtkType;
  windup: number;
  recover: number;
  cooldown: number;
  ashes: number;
  loot: string;
  pack?: [number, number];
  poison?: boolean;
  proj?: [string, number]; // ranged projectile glyph + color
  hollow?: boolean; // drops hollow hearts for Pell
  desc: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  hollow: {
    id: 'hollow', name: 'Hollow', glyph: 'h', color: 0xa8a088, hp: 28, dmg: 12, poise: 20, speed: 6,
    atk: 'melee', windup: 9, recover: 12, cooldown: 12, ashes: 12, loot: 'trash', hollow: true,
    desc: 'A husk that forgot its name. It did not forget its hunger.',
  },
  rat: {
    id: 'rat', name: 'Plague Rat', glyph: 'r', color: 0x9a7458, hp: 9, dmg: 5, poise: 4, speed: 3,
    atk: 'melee', windup: 6, recover: 8, cooldown: 10, ashes: 4, loot: 'vermin', pack: [3, 4], poison: true,
    desc: 'Fat on corpses. They have been waiting for you.',
  },
  ghoul: {
    id: 'ghoul', name: 'Ghoul', glyph: 'g', color: 0x8ab070, hp: 38, dmg: 14, poise: 25, speed: 4,
    atk: 'lunge', windup: 9, recover: 16, cooldown: 22, ashes: 22, loot: 'trash', hollow: true,
    desc: 'It runs on all fours. It lunges like a lover.',
  },
  archer: {
    id: 'archer', name: 'Skeleton Archer', glyph: 's', color: 0xe0d8c0, hp: 24, dmg: 13, poise: 14, speed: 6,
    atk: 'ranged', windup: 14, recover: 12, cooldown: 26, ashes: 20, loot: 'soldier', proj: ['•', 0xe8dcc0],
    desc: 'Its aim outlived its eyes.',
  },
  cultist: {
    id: 'cultist', name: 'Ash Cultist', glyph: 'c', color: 0xd05a9a, hp: 32, dmg: 18, poise: 14, speed: 6,
    atk: 'cast', windup: 18, recover: 16, cooldown: 44, ashes: 30, loot: 'soldier',
    desc: 'They burn their own fingers for warmth. They will burn yours too.',
  },
  bloated: {
    id: 'bloated', name: 'Bloated Corpse', glyph: 'b', color: 0xc0c060, hp: 22, dmg: 26, poise: 999, speed: 8,
    atk: 'explode', windup: 14, recover: 10, cooldown: 0, ashes: 15, loot: 'trash',
    desc: 'Swollen with gas and worse. Do not be close when it pops.',
  },
  knight: {
    id: 'knight', name: 'Crypt Knight', glyph: 'K', color: 0x98a8c8, hp: 85, dmg: 22, poise: 60, speed: 7,
    atk: 'sweep', windup: 13, recover: 18, cooldown: 24, ashes: 60, loot: 'brute',
    desc: 'Sworn to guard the dead. Its shield turns aside blows from the front.',
  },
  wraith: {
    id: 'wraith', name: 'Wraith', glyph: 'w', color: 0x88d0e0, hp: 34, dmg: 15, poise: 10, speed: 5,
    atk: 'phase', windup: 10, recover: 12, cooldown: 16, ashes: 35, loot: 'soldier',
    desc: 'Walls mean nothing to the drowned.',
  },
  maggot: {
    id: 'maggot', name: 'Grave Maggot', glyph: 'm', color: 0xe8d8a8, hp: 8, dmg: 6, poise: 3, speed: 4,
    atk: 'melee', windup: 6, recover: 8, cooldown: 10, ashes: 3, loot: 'vermin', pack: [3, 5], poison: true,
    desc: 'Blind, pale, and always hungry.',
  },
  flagellant: {
    id: 'flagellant', name: 'Flagellant', glyph: 'f', color: 0xe07050, hp: 48, dmg: 12, poise: 30, speed: 5,
    atk: 'combo', windup: 8, recover: 18, cooldown: 22, ashes: 40, loot: 'soldier', hollow: true,
    desc: 'Its back is a ruin of scars. It wants to share.',
  },
  sentinel: {
    id: 'sentinel', name: 'Bone Sentinel', glyph: 'S', color: 0xd0c098, hp: 120, dmg: 30, poise: 90, speed: 8,
    atk: 'slam', windup: 15, recover: 22, cooldown: 26, ashes: 90, loot: 'brute',
    desc: 'A tower of femurs and skulls, stitched with old hate.',
  },
  hound: {
    id: 'hound', name: 'Rot Hound', glyph: 'd', color: 0xa07a50, hp: 22, dmg: 10, poise: 10, speed: 3,
    atk: 'melee', windup: 7, recover: 10, cooldown: 12, ashes: 14, loot: 'vermin', pack: [2, 3],
    desc: 'Somebody\'s dogs. Somebody fed them what was left.',
  },
  choirling: {
    id: 'choirling', name: 'Choirling', glyph: 'n', color: 0xc8b0f0, hp: 30, dmg: 14, poise: 12, speed: 6,
    atk: 'ranged', windup: 16, recover: 14, cooldown: 30, ashes: 32, loot: 'soldier', proj: ['♪', 0xd0a0ff],
    desc: 'A nun with her mouth sewn open. The note she holds has lasted seven years.',
  },
};

export interface BossDef {
  id: string;
  name: string;
  title: string;
  hp: number;
  dmg: number;
  poise: number;
  speed: number;
  ashes: number;
  color: number;
  art: string[];
  intro: string;
  phaseLine: string;
  death: string;
  drop: string; // story drop: lore or quest item id
}

export const BOSSES: Record<string, BossDef> = {
  warden: {
    id: 'warden', name: 'The Flayed Warden', title: 'Keeper of the Ossuary', hp: 430, dmg: 26, poise: 140, speed: 7,
    ashes: 900, color: 0xd04a38, art: ['\\W/', '-█-', '/ \\'],
    intro: 'It wears the skins of those who came before you. One of them is wearing your face.',
    phaseLine: 'The Warden tears away its own face. Underneath, it is crying.',
    death: 'The skins slough off, one by one. The last one whispers: "I held the lantern for you."',
    drop: 'warden_chain',
  },
  mother: {
    id: 'mother', name: 'Mother of Maggots', title: 'She Who Feeds', hp: 760, dmg: 30, poise: 200, speed: 11,
    ashes: 2200, color: 0xc8c070, art: ['(@)', '@O@', '(@)'],
    intro: 'A mountain of pale flesh, heaving. She is nursing something wrapped in a yellow shawl.',
    phaseLine: 'She splits open. The children come pouring out. None of them are hers.',
    death: 'She sighs, deflates, and is still. The shawl falls from her arms.',
    drop: 'swaddle',
  },
  choir: {
    id: 'choir', name: 'The Choir', title: 'Seven Mouths, One Hymn', hp: 1000, dmg: 32, poise: 210, speed: 8,
    ashes: 4000, color: 0xc8a0f8, art: ['♪Ω♪', '╠█╣', '/║\\'],
    intro: 'Seven nuns, sewn together at the shoulder, singing one note that has not ended in seven years.',
    phaseLine: 'Every mouth opens at once. They are singing your name. Your real name.',
    death: 'The note finally ends. In the silence you hear, very far below, a small voice say "Papa?"',
    drop: 'tongue',
  },
  king: {
    id: 'king', name: 'The Hollow King', title: 'Last of the Crowned', hp: 1400, dmg: 36, poise: 220, speed: 6,
    ashes: 8000, color: 0xb080f0, art: ['╔♦╗', '╠Ω╣', '╝ ╚'],
    intro: 'Something sits on a throne of kneeling corpses, in a crown too large for it. It says: "You came."',
    phaseLine: 'The crown slips. Beneath it is a face you have dug up three times.',
    death: 'It falls, and it is so small. It was always so small.',
    drop: 'crown',
  },
};

// --------------------------------------------------------------------- biomes
export interface BiomeDef {
  id: string;
  wall: number;
  wallBg: number;
  floor: number;
  floorBg: number;
  floorGlyphs: string;
  pool: [string, number][];
  themes: string[];
}

export const BIOMES: Record<string, BiomeDef> = {
  crypt: {
    id: 'crypt', wall: 0x8a7a66, wallBg: 0x2a221c, floor: 0x4e443a, floorBg: 0x15110e, floorGlyphs: '..,.`',
    pool: [['hollow', 10], ['rat', 5], ['archer', 5], ['bloated', 3], ['ghoul', 3], ['knight', 2]],
    themes: ['charnel', 'embalming', 'sarcophagi', 'small_ossuary', 'well', 'mourners'],
  },
  rot: {
    id: 'rot', wall: 0x5e7a3e, wallBg: 0x18200e, floor: 0x4a4a2a, floorBg: 0x10120a, floorGlyphs: '.,"\'.',
    pool: [['ghoul', 8], ['maggot', 5], ['bloated', 5], ['hound', 6], ['rat', 3], ['cultist', 3]],
    themes: ['gibbet', 'nursery', 'bog', 'fungal', 'larder', 'burrow'],
  },
  chapel: {
    id: 'chapel', wall: 0x8a8a9e, wallBg: 0x1c1c26, floor: 0x46465a, floorBg: 0x0e0e14, floorGlyphs: '·.·.:',
    pool: [['flagellant', 8], ['cultist', 6], ['knight', 4], ['archer', 3], ['wraith', 3], ['choirling', 5]],
    themes: ['nave', 'confession', 'scriptorium', 'belltower', 'cells', 'reliquary'],
  },
  abyss: {
    id: 'abyss', wall: 0x84629a, wallBg: 0x201628, floor: 0x46384e, floorBg: 0x100b14, floorGlyphs: '.`.,.',
    pool: [['wraith', 6], ['sentinel', 4], ['knight', 4], ['flagellant', 3], ['cultist', 3], ['hollow', 4]],
    themes: ['kneeling', 'mirrors', 'feast', 'wrens_room', 'chains', 'nursery_dark'],
  },
};

export interface DecoSpec {
  glyph: string;
  color: number;
  name: string;
  block: boolean;
  n: [number, number];
  at: 'wall' | 'any' | 'rows' | 'center';
}
export interface ThemeDef {
  name: string;
  text: string;
  deco: DecoSpec[];
  decal?: number; // sprinkle decals (1 blood, 3 bones)
}

const bones = (n: [number, number]): DecoSpec => ({ glyph: '≈', color: 0xc8c0a8, name: 'a heap of bones', block: false, n, at: 'any' });

export const THEMES: Record<string, ThemeDef> = {
  // ----- crypt
  charnel: { name: 'Charnel House', text: 'Bones stacked to the ceiling, sorted by size. Someone took care. Someone had time.', deco: [bones([6, 10]), { glyph: '☻', color: 0xe0d8c0, name: 'a skull pyramid', block: true, n: [2, 4], at: 'wall' }], decal: 3 },
  embalming: { name: 'Embalming Room', text: 'Slabs, and the sweet stink of salts. One slab is still warm. It is shaped like you.', deco: [{ glyph: '╥', color: 0x9a8a78, name: 'an embalming slab', block: true, n: [2, 4], at: 'center' }, { glyph: 'ö', color: 0x7a9a6a, name: 'a jar of something', block: true, n: [3, 5], at: 'wall' }], decal: 1 },
  sarcophagi: { name: 'Hall of Sarcophagi', text: 'Stone coffins line the walls. Several have been opened from the inside.', deco: [{ glyph: '▬', color: 0xa09080, name: 'a sarcophagus', block: true, n: [4, 7], at: 'wall' }] },
  small_ossuary: { name: 'The Small Ossuary', text: 'Little coffins. Little names scratched into the lids. You know one of them. You do not let yourself read it yet.', deco: [{ glyph: '▫', color: 0xc8b8a0, name: 'a child\'s coffin', block: true, n: [5, 8], at: 'rows' }] },
  well: { name: 'The Dry Well', text: 'A well, sealed with chains. Something at the bottom is still drawing water. You can hear the bucket.', deco: [{ glyph: 'O', color: 0x8a8a8a, name: 'a chained well', block: true, n: [1, 1], at: 'center' }, { glyph: '§', color: 0x707070, name: 'rusted chain', block: false, n: [3, 5], at: 'any' }] },
  mourners: { name: 'Mourners\' Gallery', text: 'Statues of weeping women. Their tears are real, and have worn grooves down to their feet.', deco: [{ glyph: 'Å', color: 0xb0b0b8, name: 'a weeping statue', block: true, n: [3, 6], at: 'wall' }] },
  // ----- rot
  gibbet: { name: 'The Hanging Grove', text: 'Iron cages hang from the roots. The birds have been at them. One cage still sways, though there is no wind.', deco: [{ glyph: '¥', color: 0x8a7a60, name: 'a gibbet cage', block: true, n: [3, 6], at: 'any' }], decal: 1 },
  nursery: { name: 'The Nursery', text: 'Cradles of woven root. They rock, slowly. Something has been tucked into every one of them with great tenderness.', deco: [{ glyph: 'u', color: 0x9a8a5a, name: 'a root cradle', block: true, n: [4, 7], at: 'rows' }] },
  bog: { name: 'The Sump', text: 'Black water to the ankle. Things bump against your shins. You choose to believe they are roots.', deco: [{ glyph: '≈', color: 0x3a5a3a, name: 'bog water', block: false, n: [10, 18], at: 'any' }] },
  fungal: { name: 'Fungal Shrine', text: 'Pale fungus grows in the shape of kneeling people. It is not shaped like them. It is them.', deco: [{ glyph: '♣', color: 0xd8d0b0, name: 'a fungal penitent', block: true, n: [4, 8], at: 'any' }] },
  larder: { name: 'The Larder', text: 'Hooks. Salt. Neat bundles in cloth, tied with a butcher\'s knot you have seen before. In town.', deco: [{ glyph: '¿', color: 0xb07060, name: 'a meat hook', block: true, n: [4, 7], at: 'wall' }, { glyph: '▪', color: 0x8a4a3a, name: 'a salted bundle', block: false, n: [3, 5], at: 'any' }], decal: 1 },
  burrow: { name: 'The Warren', text: 'Tunnels too small for anything human. Something has been dragging furniture down here. Small chairs. A table set for tea.', deco: [{ glyph: 'π', color: 0x8a6a4a, name: 'a tiny table', block: true, n: [1, 2], at: 'center' }, { glyph: 'h', color: 0x6a5a3a, name: 'a small chair', block: false, n: [2, 4], at: 'any' }] },
  // ----- chapel
  nave: { name: 'The Nave', text: 'Pews face an altar where something was nailed, and taken down, and nailed again.', deco: [{ glyph: '═', color: 0x7a5a3a, name: 'a pew', block: true, n: [6, 10], at: 'rows' }, { glyph: 'Π', color: 0xc0b0a0, name: 'the altar', block: true, n: [1, 1], at: 'center' }] },
  confession: { name: 'The Confessionals', text: 'Every curtain is drawn. Every booth is breathing.', deco: [{ glyph: '▐', color: 0x6a3a5a, name: 'a confessional booth', block: true, n: [3, 5], at: 'wall' }] },
  scriptorium: { name: 'The Scriptorium', text: 'Books copied in a hand that grew worse page by page, until the last pages are only teeth marks.', deco: [{ glyph: '╤', color: 0x8a6a40, name: 'a writing desk', block: true, n: [3, 6], at: 'rows' }, { glyph: '■', color: 0x6a5040, name: 'a pile of books', block: false, n: [2, 4], at: 'any' }] },
  belltower: { name: 'Foot of the Bell Tower', text: 'A bell rope hangs from the dark, cut clean. The cut is fresh. It is always fresh.', deco: [{ glyph: '│', color: 0xa08a60, name: 'the cut bell rope', block: true, n: [1, 1], at: 'center' }] },
  cells: { name: 'Penitents\' Cells', text: 'Narrow cells. Chains bolted to the walls at kneeling height. The stone is worn smooth where foreheads pressed.', deco: [{ glyph: '§', color: 0x808080, name: 'wall chains', block: false, n: [4, 7], at: 'wall' }], decal: 1 },
  reliquary: { name: 'The Reliquary', text: 'Glass cases of holy relics: finger bones, teeth, a braid of hair. All labeled with the same saint\'s name. It is a child\'s name.', deco: [{ glyph: '□', color: 0xb0c0d0, name: 'a reliquary case', block: true, n: [3, 6], at: 'wall' }] },
  // ----- abyss
  kneeling: { name: 'The Kneeling Hall', text: 'Hundreds of dead kneel here, facing the same way. Toward the throne. Toward you.', deco: [{ glyph: '♀', color: 0x8a7a8a, name: 'a kneeling corpse', block: true, n: [8, 14], at: 'rows' }] },
  mirrors: { name: 'Hall of Mirrors', text: 'The mirrors show the room without you in it. In one, a small girl is waiting by the door.', deco: [{ glyph: '▌', color: 0xa0b8c8, name: 'a black mirror', block: true, n: [3, 6], at: 'wall' }] },
  feast: { name: 'The Banquet', text: 'A feast laid for a guest of honor. The meat is a person. The wine is a person. The chair at the head is pulled out.', deco: [{ glyph: '═', color: 0x6a4a3a, name: 'the long table', block: true, n: [5, 8], at: 'center' }], decal: 1 },
  wrens_room: { name: 'A Small Room', text: 'A child\'s room, here, at the bottom of everything. Drawings scratched all over the walls.', deco: [{ glyph: 'u', color: 0xd0c070, name: 'a little bed', block: true, n: [1, 1], at: 'wall' }, { glyph: '~', color: 0xffe060, name: 'a yellow ribbon', block: false, n: [1, 2], at: 'any' }] },
  chains: { name: 'The Chain Pit', text: 'Chains descend from the ceiling into a hole with no bottom. Some of them are taut. Some of them are moving.', deco: [{ glyph: '§', color: 0x7a7a8a, name: 'hanging chains', block: false, n: [6, 10], at: 'any' }] },
  nursery_dark: { name: 'The Cradle Room', text: 'One cradle, enormous, carved from the Door\'s black iron. It has been rocked so long the floor is grooved.', deco: [{ glyph: 'U', color: 0x5a4a6a, name: 'the iron cradle', block: true, n: [1, 1], at: 'center' }] },
};

export const ELITE_MODS = ['frenzied', 'stoneskin', 'vampiric', 'molten', 'vengeful'];
export const ELITE_MOD_NAMES: Record<string, string> = {
  frenzied: 'Frenzied',
  stoneskin: 'Stoneskin',
  vampiric: 'Vampiric',
  molten: 'Molten',
  vengeful: 'Vengeful',
};
const ELITE_FIRST = ['Gorrath', 'Vesk', 'Mhorg', 'Ulla', 'Brother Kael', 'Sister Mercy', 'Old Tom', 'Grul', 'Nagrim', 'The Widow', 'Hask', 'Orren', 'Father Lorne'];
const ELITE_LAST = ['the Unwashed', 'the Gnawer', 'Many-Mouths', 'the Flayer', 'Who Weeps', 'the Bloated', 'Bonesucker', 'the Unforgiven', 'the Skinless', "Mother's Favorite", 'the Faithless'];
export function eliteName(rng: RNG): string {
  return `${rng.pick(ELITE_FIRST)} ${rng.pick(ELITE_LAST)}`;
}

export const BRAZIER_COLORS = [
  { name: 'Blood', color: 0xd82a2a, clue: 'what the wound weeps' },
  { name: 'Bile', color: 0x9ac838, clue: 'what the liver curses' },
  { name: 'Bone', color: 0xf0e8d0, clue: 'what the grave keeps' },
  { name: 'Drowned', color: 0x3a78f0, clue: 'what the river steals' },
  { name: 'Nightshade', color: 0xb058f0, clue: 'what the witch brews' },
];

const MSG_ACTS = ['rolling', 'parrying', 'heavy attack', 'patience', 'backstab', 'running the fuck away', 'crying', 'praying', 'not dying', 'going back', 'digging'];
const MSG_THINGS = ['liar', 'trap', 'hidden path', 'ambush', 'treasure', 'the dark', 'enemy', 'archer', 'tears', 'bad breath', 'a cracked wall', 'the abyss', 'regret', 'rats', 'dog', 'father'];
const MSG_LORE = [
  'I ate my brother here. He would have done the same.',
  "Don't trust the rats. They remember your face.",
  'Thirty days without light. My eyes are rumors now.',
  "Tell my wife I'm not coming home. Tell her I'm sorry about the dog.",
  'Abandon hope. It is heavy, and you will need to roll.',
  'Every flame down here was once someone.',
  'Strike from the dark. They never see it coming.',
  'If it glows red, get the hell out of the way.',
  'A heavy blow will crack what is already cracked.',
  'Parry the slow ones. Run from the big ones.',
  'I prayed. Nothing answered. Then something did.',
  'The gravedigger did this. Remember who did this.',
  'Hollowmere eats its own. Hollowmere always has.',
  'She is not your daughter anymore. She is not anyone\'s.',
  'Do not ring anything down here.',
];

export function ghostMessage(rng: RNG): string {
  const r = rng.next();
  if (r < 0.5) return rng.pick(MSG_LORE);
  if (r < 0.68) return `Try ${rng.pick(MSG_ACTS)}`;
  if (r < 0.82) return `${cap(rng.pick(MSG_THINGS))} ahead`;
  if (r < 0.92) return `Beware of ${rng.pick(MSG_THINGS)}`;
  return `If only I had ${rng.pick(['a shield', 'more flasks', 'a friend', 'a torch', 'my legs', 'mercy', 'stayed buried'])}...`;
}
function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

export const DEATH_LINES = [
  'Your blood feeds the stones. They are always hungry.',
  'The dark does not mourn. It only waits.',
  'Somewhere in Hollowmere, someone feels relieved.',
  'Rise. The deep is not finished with you.',
  'Death is a door. You of all people should know.',
  'The rats will remember the taste.',
  'You died as you lived: digging.',
];

export const URN_LINES = [
  'The urn shatters. Teeth and ash spill out.',
  'The urn breaks. Someone was kept in there.',
  'Shards and a dried finger. Charming.',
];

// --------------------------------------------------------------------- bestiary: how each thing fights
export const MOVES: Record<string, string[]> = {
  hollow: [
    'Claw: a short wind-up, then a strike on the tile you stand on. Step off it, roll, or parry.',
    'Slow and easily distracted. A favorite for backstabs.',
  ],
  rat: ['Bite: quick, weak, poisonous. Always in packs of three or four.', 'A wide swing clears the whole pack.'],
  ghoul: [
    'Lunge: when you are in a straight line within three tiles, it marks the line and dashes through it.',
    'Step off the line, not backward along it. It is open while it recovers.',
  ],
  archer: [
    'Aimed shot: a dim line shows where the arrow will fly. Move off the line before it looses.',
    'Backs away when you close in; kicks if cornered. Break line of sight or rush it.',
  ],
  cultist: [
    'Pyre: calls fire onto the 3x3 around you, leaving burning ground behind.',
    'Blinks away when you get close. Rush it between casts.',
  ],
  bloated: [
    'Burst: when adjacent it swells, then explodes in a 3x3 of acid that hurts its own kind too.',
    'Also bursts when it dies. Kill it from range, or lure it into a crowd.',
  ],
  knight: [
    'Shield: blocks most damage from the front. Heavy attacks, backstabs and ripostes get through.',
    'Sweep: a three-tile arc. Parry it, or circle around to its back.',
  ],
  wraith: [
    'Passes through walls. Grabs at the tile you stand on.',
    'The Silent Bell staggers it.',
  ],
  maggot: ['Bite: weak and poisonous, in swarms of three to five.', 'The Mother births more of them.'],
  flagellant: [
    'Flurry: up to three swings, each following you. Back off after the first, or parry the last.',
    'Long recovery after the third swing.',
  ],
  sentinel: [
    'Slam: crushes all eight tiles around it. Cannot be parried; step two tiles away.',
    'Heavy poise. A long recovery after every slam is your window.',
  ],
  hound: ['Bite: fast, in packs of two or three. They run you down; turn and fight.'],
  choirling: [
    'Note: sings a slow projectile from range. Sidestep it.',
    'The Silent Bell staggers it.',
  ],
  // ------------------------------------------------------------------- bosses
  warden: [
    'Cleave: a cone in front of it, three tiles deep.',
    'Slam: a ring two to three tiles out. Stand right against it, or well clear.',
    'Charge: marks a three-wide lane and barrels down it. Step out of the lane.',
    'Phase two, Chains: tiles scattered around you are marked. Find an unmarked one.',
    'Cannot be parried. Heavy blows break its poise.',
  ],
  mother: [
    'Spew: a cone of acid that leaves poisoned ground.',
    'Birth: maggots wriggle out of her. Kill them before they swarm you.',
    'Crush: a ring two to three tiles out.',
    'Phase two, Rain: acid falls on scattered tiles around you.',
  ],
  choir: [
    'Hymn: concentric rings of song. Stand in the quiet gaps between them.',
    'Volley: a fan of notes. Sidestep or roll through.',
    'Summon: two choirlings join the hymn.',
    'Phase two: the hymn comes in two offset waves. Find the silence, then find it again.',
    'Phase two, Requiem: every other stone of the floor sings. Stand on a quiet one.',
  ],
  king: [
    'Sweep: a wide cone in front of him.',
    'Blink: he vanishes and reappears beside you, then slams a ring around himself.',
    'Soulfire: bolts in eight directions (sixteen in phase two). Stand between them.',
    'Phase two, Cross: the whole row and column you stand on.',
  ],
};
