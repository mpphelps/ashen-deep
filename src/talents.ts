// Talent paths: four lives the Digger half-remembers. One point per level; capstones cost two.
export type PathId = 'grave' | 'ranger' | 'thief' | 'soldier';

export interface PathDef {
  id: PathId;
  name: string;
  color: number;
  blurb: string;
}

export interface TalentDef {
  id: string;
  path: PathId;
  tier: 1 | 2 | 3;
  name: string;
  kind: 'active' | 'passive' | 'toggle';
  cost: number; // talent points
  sta?: number; // stamina cost
  hp?: number; // fraction of max HP paid in blood
  cd?: number; // cooldown in ticks (20 = 1s)
  needs?: 'bow' | 'dagger' | 'onehand';
  desc: string;
  flavor: string;
}

export const PATHS: PathDef[] = [
  {
    id: 'grave', name: 'The Gravecaller', color: 0x9ad0a0,
    blurb: 'Twenty years of burying them. Seven years lying among them. The dead know your voice. Spells cost blood.',
  },
  {
    id: 'ranger', name: 'The Dark Ranger', color: 0xc0c070,
    blurb: 'The winter the larders ran empty, you hunted the moor for meat. You were very good at it. Nobody asked what you were hunting.',
  },
  {
    id: 'thief', name: 'The Cutpurse', color: 0x8898d0,
    blurb: 'The Pit taught you to be quiet. Quiet things live longer down there.',
  },
  {
    id: 'soldier', name: 'The Disgraced', color: 0xd0a868,
    blurb: 'Before the spade you carried a shield. They took your colors when you ran. You remember the weight of it. You remember dropping it.',
  },
];

export const TALENTS: TalentDef[] = [
  // ------------------------------------------------------------- the Gravecaller
  { id: 'gravebolt', path: 'grave', tier: 1, name: 'Grave Bolt', kind: 'active', cost: 1, hp: 0.05, cd: 20,
    desc: 'Hurl a shard of bone. Damage grows with your level. Costs 5% of your health.',
    flavor: 'You pull it from somewhere inside your arm. It grows back. It always grows back.' },
  { id: 'leech', path: 'grave', tier: 1, name: 'Leech', kind: 'passive', cost: 1,
    desc: 'Every kill restores 5% of your health.',
    flavor: 'Waste not.' },
  { id: 'raise', path: 'grave', tier: 2, name: 'Raise the Dead', kind: 'active', cost: 1, hp: 0.1, cd: 400,
    desc: 'Up to two corpses near you rise as thralls and fight for 30 seconds. Needs corpses.',
    flavor: 'They get up because you ask. They have always done what you asked.' },
  { id: 'corpse', path: 'grave', tier: 2, name: 'Corpse Burst', kind: 'active', cost: 1, hp: 0.04, cd: 60,
    desc: 'The nearest corpse within 7 tiles bursts, tearing everything around it. Needs a corpse.',
    flavor: 'There is a lot of pressure in a body. You have always known where.' },
  { id: 'bonearmor', path: 'grave', tier: 3, name: 'Bone Armor', kind: 'active', cost: 1, hp: 0.08, cd: 500,
    desc: 'Wrap yourself in ribs: absorbs damage up to 30% of your max health for 12 seconds.',
    flavor: 'Not your ribs. Mostly not your ribs.' },
  { id: 'harvest', path: 'grave', tier: 3, name: 'Harvest', kind: 'active', cost: 2, cd: 600,
    desc: 'Capstone. Every foe within 4 tiles loses 12% of its health (bosses 3%). You drink all of it.',
    flavor: 'The Pit fed on Hollowmere for seven years. It taught you how.' },
  // ------------------------------------------------------------- the Dark Ranger
  { id: 'volley', path: 'ranger', tier: 1, name: 'Volley', kind: 'active', cost: 1, sta: 20, cd: 60, needs: 'bow',
    desc: 'Loose three arrows in a spread. Needs a bow. (Learning any Ranger talent gives you an old bow.)',
    flavor: 'Three at once. One of them always finds something.' },
  { id: 'deadeye', path: 'ranger', tier: 1, name: 'Deadeye', kind: 'passive', cost: 1,
    desc: 'Bow shots deal 20% more damage and pass through the first enemy they hit.',
    flavor: 'Aim for whatever is behind it.' },
  { id: 'pin', path: 'ranger', tier: 2, name: 'Pinning Shot', kind: 'active', cost: 1, sta: 15, cd: 100, needs: 'bow',
    desc: 'An arrow that nails its target in place (a long stagger) and opens a bleeding wound.',
    flavor: 'Like a moth to a board.' },
  { id: 'disengage', path: 'ranger', tier: 2, name: 'Disengage', kind: 'active', cost: 1, sta: 15, cd: 80,
    desc: 'Leap three tiles backward, untouchable. Your next bow shot within 2 seconds is a critical hit.',
    flavor: 'Distance is the only mercy down here.' },
  { id: 'blackarrow', path: 'ranger', tier: 3, name: 'Black Arrow', kind: 'active', cost: 1, sta: 30, cd: 240, needs: 'bow',
    desc: 'Draw for half a second, then loose a black shaft that pierces everything in a line for triple damage.',
    flavor: 'Fletched with crow, tipped with grave-iron. It was meant for someone. You forget who.' },
  { id: 'patience', path: 'ranger', tier: 3, name: 'Patience', kind: 'passive', cost: 2,
    desc: 'Capstone. Arrows gain 5% damage for every tile they travel (up to +60%).',
    flavor: 'Let them come. Let them keep coming.' },
  // ------------------------------------------------------------- the Cutpurse
  { id: 'shadow', path: 'thief', tier: 1, name: 'Light Feet', kind: 'passive', cost: 1,
    desc: 'Enemies take twice as long to notice you. Backstabs deal 3.5x instead of 2.5x.',
    flavor: 'You weigh less than you did. The Pit kept some of you.' },
  { id: 'smoke', path: 'thief', tier: 1, name: 'Smoke Vial', kind: 'active', cost: 1, sta: 10, cd: 360,
    desc: 'Burst into smoke. Every enemy within 6 tiles loses track of you, ready to be backstabbed.',
    flavor: 'Cremation ash, mostly. You know whose.' },
  { id: 'twin', path: 'thief', tier: 2, name: 'Twin Fangs', kind: 'passive', cost: 1, needs: 'dagger',
    desc: 'Dagger attacks strike twice (the second for 60%).',
    flavor: 'Two quick ones. Like a rat.' },
  { id: 'step', path: 'thief', tier: 2, name: 'Shadow Step', kind: 'active', cost: 1, sta: 15, cd: 180,
    desc: 'Step behind the nearest enemy you can see within 6 tiles. It loses you: your next hit is a backstab. Not bosses.',
    flavor: 'One moment in front of them. Then not.' },
  { id: 'venom', path: 'thief', tier: 3, name: 'Venom', kind: 'passive', cost: 1,
    desc: 'Your hits poison: enemies lose 2% of their health every second for 5 seconds (bosses 0.5%).',
    flavor: 'Bloated-corpse bile, reduced on a low flame. Pell sold you the pot.' },
  { id: 'cull', path: 'thief', tier: 3, name: 'Cull', kind: 'passive', cost: 2,
    desc: 'Capstone. Any hit on a weakened enemy (below 20% health) kills it outright. Bosses below 20% take 40% more.',
    flavor: 'Mercy, of a kind. The only kind left.' },
  // ------------------------------------------------------------- the Disgraced
  { id: 'shield', path: 'soldier', tier: 1, name: 'Raise Shield', kind: 'toggle', cost: 1, needs: 'onehand',
    desc: 'Raise a battered shield. Blocks 75% of damage from the front (50% from bosses), paid in stamina. You move slowly while it is up. Needs a one-handed weapon.',
    flavor: 'The paint is gone. Under it you can still see where the old crest was scraped off.' },
  { id: 'iron', path: 'soldier', tier: 1, name: 'Old Wounds', kind: 'passive', cost: 1,
    desc: '+12% maximum health and +10 armor.',
    flavor: 'Every scar is a lesson you survived.' },
  { id: 'bash', path: 'soldier', tier: 2, name: 'Shield Bash', kind: 'active', cost: 1, sta: 18, cd: 80,
    desc: 'Slam the enemy in front of you: a long stagger, and a big blow to a boss\'s poise.',
    flavor: 'The rim of a shield is a blade with no edge.' },
  { id: 'parrymaster', path: 'soldier', tier: 2, name: 'Drillmaster', kind: 'passive', cost: 1,
    desc: 'Your parry window is half again as long, and ripostes deal 4x instead of 3x.',
    flavor: 'A sergeant shouted this into you. You can still hear him.' },
  { id: 'warcry', path: 'soldier', tier: 3, name: 'Warcry', kind: 'active', cost: 1, sta: 20, cd: 600,
    desc: 'Roar. Enemies within 5 tiles stagger (not bosses), and you deal 30% more damage for 10 seconds.',
    flavor: 'The regiment\'s old cry. You are the only one left who knows it.' },
  { id: 'laststand', path: 'soldier', tier: 3, name: 'Last Stand', kind: 'passive', cost: 2,
    desc: 'Capstone. Below 30% health you take 35% less damage and deal 35% more.',
    flavor: 'You ran, once. Never again.' },
];

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(TALENTS.map((t) => [t.id, t]));

export function pathPoints(owned: string[], path: PathId): number {
  return owned.reduce((n, id) => (TALENT_BY_ID[id]?.path === path ? n + TALENT_BY_ID[id].cost : n), 0);
}

/** Tier 2 needs 2 points spent in the path; tier 3 needs 4. */
export function canLearn(owned: string[], points: number, t: TalentDef): string | null {
  if (owned.includes(t.id)) return 'Already learned.';
  if (points < t.cost) return `Needs ${t.cost} talent point${t.cost > 1 ? 's' : ''}.`;
  const spent = pathPoints(owned, t.path);
  if (t.tier === 2 && spent < 2) return 'Needs 2 points spent in this path.';
  if (t.tier === 3 && spent < 4) return 'Needs 4 points spent in this path.';
  return null;
}

export function respecCost(level: number): number {
  return 150 * level;
}
