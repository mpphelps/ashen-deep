// Static game data: bestiary, bosses, acts, flavor text.
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
  acts: number[];
  weight: number;
  minDepth: number;
  loot: string;
  pack?: [number, number];
  poison?: boolean;
  desc: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  hollow: {
    id: 'hollow', name: 'Hollow', glyph: 'h', color: 0xa8a088, hp: 28, dmg: 12, poise: 20, speed: 6,
    atk: 'melee', windup: 9, recover: 12, cooldown: 12, ashes: 12, acts: [0, 1, 2], weight: 10, minDepth: 1,
    loot: 'trash', desc: 'A husk that forgot its name. It did not forget its hunger.',
  },
  rat: {
    id: 'rat', name: 'Plague Rat', glyph: 'r', color: 0x9a7458, hp: 9, dmg: 5, poise: 4, speed: 3,
    atk: 'melee', windup: 6, recover: 8, cooldown: 10, ashes: 4, acts: [0, 1], weight: 5, minDepth: 1,
    loot: 'vermin', pack: [3, 4], poison: true, desc: 'Fat on corpses. They have been waiting for you.',
  },
  ghoul: {
    id: 'ghoul', name: 'Ghoul', glyph: 'g', color: 0x8ab070, hp: 38, dmg: 14, poise: 25, speed: 4,
    atk: 'lunge', windup: 9, recover: 16, cooldown: 22, ashes: 22, acts: [0, 1, 2], weight: 6, minDepth: 2,
    loot: 'trash', desc: 'It runs on all fours. It lunges like a lover.',
  },
  archer: {
    id: 'archer', name: 'Skeleton Archer', glyph: 's', color: 0xe0d8c0, hp: 24, dmg: 13, poise: 14, speed: 6,
    atk: 'ranged', windup: 14, recover: 12, cooldown: 26, ashes: 20, acts: [0, 1, 2], weight: 5, minDepth: 1,
    loot: 'soldier', desc: 'Its aim outlived its eyes.',
  },
  cultist: {
    id: 'cultist', name: 'Ash Cultist', glyph: 'c', color: 0xd05a9a, hp: 32, dmg: 18, poise: 14, speed: 6,
    atk: 'cast', windup: 18, recover: 16, cooldown: 44, ashes: 30, acts: [0, 1, 2], weight: 4, minDepth: 2,
    loot: 'soldier', desc: 'They burn their own fingers for warmth. They will burn yours too.',
  },
  bloated: {
    id: 'bloated', name: 'Bloated Corpse', glyph: 'b', color: 0xc0c060, hp: 22, dmg: 26, poise: 999, speed: 8,
    atk: 'explode', windup: 14, recover: 10, cooldown: 0, ashes: 15, acts: [0, 1], weight: 4, minDepth: 2,
    loot: 'trash', desc: 'Swollen with gas and worse. Do not be close when it pops.',
  },
  knight: {
    id: 'knight', name: 'Crypt Knight', glyph: 'K', color: 0x98a8c8, hp: 85, dmg: 22, poise: 60, speed: 7,
    atk: 'sweep', windup: 13, recover: 18, cooldown: 24, ashes: 60, acts: [0, 1, 2], weight: 3, minDepth: 3,
    loot: 'brute', desc: 'Sworn to guard the dead. Its shield turns aside blows from the front.',
  },
  wraith: {
    id: 'wraith', name: 'Wraith', glyph: 'w', color: 0x88d0e0, hp: 34, dmg: 15, poise: 10, speed: 5,
    atk: 'phase', windup: 10, recover: 12, cooldown: 16, ashes: 35, acts: [1, 2], weight: 4, minDepth: 4,
    loot: 'soldier', desc: 'Walls mean nothing to the drowned.',
  },
  maggot: {
    id: 'maggot', name: 'Grave Maggot', glyph: 'm', color: 0xe8d8a8, hp: 8, dmg: 6, poise: 3, speed: 4,
    atk: 'melee', windup: 6, recover: 8, cooldown: 10, ashes: 3, acts: [1], weight: 3, minDepth: 4,
    loot: 'vermin', pack: [3, 5], poison: true, desc: 'Blind, pale, and always hungry.',
  },
  flagellant: {
    id: 'flagellant', name: 'Flagellant', glyph: 'f', color: 0xe07050, hp: 48, dmg: 12, poise: 30, speed: 5,
    atk: 'combo', windup: 8, recover: 18, cooldown: 22, ashes: 40, acts: [1, 2], weight: 4, minDepth: 4,
    loot: 'soldier', desc: 'Its back is a ruin of scars. It wants to share.',
  },
  sentinel: {
    id: 'sentinel', name: 'Bone Sentinel', glyph: 'S', color: 0xd0c098, hp: 120, dmg: 30, poise: 90, speed: 8,
    atk: 'slam', windup: 15, recover: 22, cooldown: 26, ashes: 90, acts: [2], weight: 3, minDepth: 7,
    loot: 'brute', desc: 'A tower of femurs and skulls, stitched with old hate.',
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
}

export const BOSSES: Record<string, BossDef> = {
  warden: {
    id: 'warden', name: 'The Flayed Warden', title: 'Keeper of the Ossuary', hp: 430, dmg: 28, poise: 140, speed: 7,
    ashes: 800, color: 0xd04a38, art: ['\\W/', '-█-', '/ \\'],
    intro: 'It wears the skins of those who came before you. There is room for one more.',
    phaseLine: 'The Warden tears away its own face.',
    death: 'The skins slough off, one by one, until nothing remains.',
  },
  mother: {
    id: 'mother', name: 'Mother of Maggots', title: 'She Who Feeds', hp: 820, dmg: 30, poise: 200, speed: 11,
    ashes: 2000, color: 0xc8c070, art: ['(@)', '@O@', '(@)'],
    intro: 'A mountain of pale flesh, heaving. Her children squirm in every fold.',
    phaseLine: 'She splits open. The children come pouring out.',
    death: 'She sighs, deflates, and is still. Her children starve within the hour.',
  },
  king: {
    id: 'king', name: 'The Hollow King', title: 'Last of the Crowned', hp: 1250, dmg: 36, poise: 220, speed: 6,
    ashes: 5000, color: 0xb080f0, art: ['╔♦╗', '╠Ω╣', '╝ ╚'],
    intro: 'He sits on a throne of kneeling corpses. He has been waiting for an heir.',
    phaseLine: 'The crown cracks. Something beneath it laughs.',
    death: 'The crown rolls to your feet. It is lighter than you expected.',
  },
};

export const ACT_NAMES = ['The Ossuary', 'The Weeping Catacombs', 'The Throne Below'];
export const ACT_BOSS = ['warden', 'mother', 'king'];

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

const MSG_ACTS = ['rolling', 'parrying', 'heavy attack', 'patience', 'backstab', 'running the fuck away', 'crying', 'praying', 'not dying', 'going back'];
const MSG_THINGS = ['liar', 'trap', 'hidden path', 'ambush', 'treasure', 'the dark', 'enemy', 'archer', 'tears', 'bad breath', 'a cracked wall', 'the abyss', 'fashion', 'rats', 'dog', 'regret'];
const MSG_LORE = [
  'I ate my brother here. He would have done the same.',
  'The King was never crowned. He was hollowed.',
  "Don't trust the rats. They remember your face.",
  'Thirty days without light. My eyes are rumors now.',
  "Tell my wife I'm not coming home. Tell her I'm sorry about the dog.",
  'Abandon hope. It is heavy, and you will need to roll.',
  'The Warden kept my skin. Wear it well, friend.',
  'Every flame down here was once someone.',
  'Strike from the dark. They never see it coming.',
  'If it glows red, get the hell out of the way.',
  'A heavy blow will crack what is already cracked.',
  'Parry the slow ones. Run from the big ones.',
  'Ashes are only worth what you can carry back.',
  'I prayed. Nothing answered. Then something did.',
];

export function ghostMessage(rng: RNG): string {
  const r = rng.next();
  if (r < 0.45) return rng.pick(MSG_LORE);
  if (r < 0.65) return `Try ${rng.pick(MSG_ACTS)}`;
  if (r < 0.8) return `${cap(rng.pick(MSG_THINGS))} ahead`;
  if (r < 0.9) return `Beware of ${rng.pick(MSG_THINGS)}`;
  return `If only I had ${rng.pick(['a shield', 'more flasks', 'a friend', 'a torch', 'my legs', 'mercy'])}...`;
}
function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

export const DEATH_LINES = [
  'Your blood feeds the stones. They are always hungry.',
  'The dark does not mourn. It only waits.',
  'Somewhere above, no one notices you are gone.',
  'Rise. The deep is not finished with you.',
  'Death is a door. This one swings both ways.',
  'The rats will remember the taste.',
  'You died as you lived: mostly screaming.',
];

export const URN_LINES = [
  'The urn shatters. Teeth and ash spill out.',
  'The urn breaks. Someone was kept in there.',
  'Shards and a dried finger. Charming.',
];
