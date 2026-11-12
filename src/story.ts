// The story of Hollowmere: dungeons, quests, lore, NPCs and their dialogue, endings.
// Tone: very dark, cryptic. The truth is assembled from items, dialogue and bosses.
import type { Game } from './game.ts';
import type { ToolId } from './types.ts';

// ===================================================================== tools
export const TOOL_INFO: Record<ToolId, { name: string; glyph: string; color: number; desc: string; found: string }> = {
  spade: {
    name: "Gravedigger's Spade", glyph: '¶', color: 0xb0a080,
    desc: 'Dig rubble and graves. [R] the tile in front of you.',
    found: 'Your old spade. The handle is worn to the shape of your hands. Nobody else could hold it right.',
  },
  lantern: {
    name: "Warden's Lantern", glyph: '¤', color: 0xffb040,
    desc: 'Lights more of the dark. [R] throws flame: burns thorns, lights braziers, sets the living on fire.',
    found: 'The Warden\'s lantern. He held it for you, once, while you dug. It still remembers the way.',
  },
  hook: {
    name: 'Chain Hook', glyph: '⌠', color: 0xa0a8c0,
    desc: '[R] Bite across gaps up to 7 tiles. Drags enemies and stones toward you.',
    found: 'A butcher\'s hook on a long chain. It has hauled a great many things up out of the dark.',
  },
  bell: {
    name: 'The Silent Bell', glyph: '♫', color: 0xd0c8ff,
    desc: '[R] Ring it: phantom bridges become solid for a while. Wraiths cannot bear it.',
    found: 'A hand bell with no clapper. When you swing it, you hear it anyway. So does everything else.',
  },
};

export const TOOL_TILE_NAME: Record<ToolId, string> = { spade: 'rubble', lantern: 'thorns', hook: 'a sheer gap', bell: 'a phantom bridge' };

// ===================================================================== dungeons
export interface Stash {
  kind: 'quest' | 'lore';
  id: string;
  theme: string;
  quest?: string; // only placed while this quest isn't finished
}
export interface FloorPlan {
  keyGate: ToolId | null; // the key chest sits behind this obstacle
  toolReward: ToolId | null; // granted by this floor's key puzzle
  optional: ToolId[]; // treasure vaults behind these obstacles
  boss: boolean;
  stash: Stash[];
}
export interface DungeonDef {
  id: string;
  name: string;
  biome: string;
  boss: string;
  tiers: number[];
  music: string;
  floors: FloorPlan[];
  enter: string;
}

export const DUNGEONS: DungeonDef[] = [
  {
    id: 'ossuary', name: 'The Ossuary', biome: 'crypt', boss: 'warden', tiers: [2, 3], music: 'act1',
    enter: 'Stairs worn into a bowl by seven years of the dead walking up them.',
    floors: [
      { keyGate: null, toolReward: 'lantern', optional: ['spade'], boss: false, stash: [{ kind: 'quest', id: 'agnes_ring', theme: 'sarcophagi', quest: 'ring' }] },
      { keyGate: 'lantern', toolReward: null, optional: ['spade'], boss: true, stash: [{ kind: 'lore', id: 'ribbon', theme: 'small_ossuary' }] },
    ],
  },
  {
    id: 'rotwood', name: 'The Rotwood Hollow', biome: 'rot', boss: 'mother', tiers: [4, 5], music: 'act2',
    enter: 'You climb down into the roots of a tree that died before the town was built. It is warm inside. It is breathing.',
    floors: [
      { keyGate: null, toolReward: 'hook', optional: ['lantern', 'spade'], boss: false, stash: [{ kind: 'lore', id: 'receipt', theme: 'larder' }] },
      { keyGate: 'hook', toolReward: null, optional: ['lantern'], boss: true, stash: [{ kind: 'quest', id: 'poppet', theme: 'nursery', quest: 'doll' }] },
    ],
  },
  {
    id: 'chapel', name: 'The Weeping Chapel', biome: 'chapel', boss: 'choir', tiers: [6, 7], music: 'act3',
    enter: 'The doors open before you touch them. Somewhere above, a single note is being sung, and has been for a very long time.',
    floors: [
      { keyGate: null, toolReward: 'bell', optional: ['hook', 'lantern'], boss: false, stash: [{ kind: 'quest', id: 'psalter', theme: 'scriptorium', quest: 'psalter' }] },
      { keyGate: 'bell', toolReward: null, optional: ['hook'], boss: true, stash: [{ kind: 'lore', id: 'confession', theme: 'confession' }] },
    ],
  },
  {
    id: 'throne', name: 'The Throne Below', biome: 'abyss', boss: 'king', tiers: [8, 9], music: 'abyss',
    enter: 'The phantom stair holds. Down, and down. At the bottom, you can hear someone humming a song you used to sing.',
    floors: [
      { keyGate: 'hook', toolReward: null, optional: ['lantern', 'spade'], boss: false, stash: [{ kind: 'lore', id: 'feast', theme: 'feast' }] },
      { keyGate: 'bell', toolReward: null, optional: ['hook', 'lantern'], boss: true, stash: [{ kind: 'lore', id: 'wren', theme: 'wrens_room' }] },
    ],
  },
];

// ===================================================================== lore
export const LORE: Record<string, { title: string; text: string }> = {
  ledger: {
    title: 'Tithe Ledger, torn page',
    text: 'Year VI of the Dusk. Tithe: the gravedigger. Crime: (the word has been scratched out so hard the quill went through the page). Witnessed: S., P., G., A., H. Weight after salting: eleven stone.',
  },
  letter: {
    title: 'Unsent letter, in your hand',
    text: 'Sallow — I can hear her under the ground. You told me it was grief. It is not grief. It is digging. I am going to help her. Do not send anyone to stop me.',
  },
  ribbon: {
    title: 'Yellow ribbon',
    text: 'A child\'s hair ribbon, yellow once, tied in a knot no child ties. A father\'s knot. The little coffin it was nailed to says WREN. The coffin is empty. The lid is clawed from the inside.',
  },
  warden_book: {
    title: "The Warden's burial book",
    text: 'Interred: Wren, age seven, fever. Interred again: same. Would not stay. Interred again, in iron. Disinterred by her father. I did not stop him. God forgive me, I held the lantern.',
  },
  receipt: {
    title: "Butcher's receipt",
    text: 'Hollowmere Common Larder. Received from the Pit-rim: one tithe, salted. Rendered: seven pound lean, two pound marrow, tallow for the Wick. Signed P. Underneath, cheerfully: "Waste not!"',
  },
  swaddle: {
    title: 'Yellow shawl',
    text: 'The Mother of Maggots nursed this for seven years. Whatever was inside is gone. The shawl was knitted by a child\'s hands; the stitches are huge and earnest. You taught her to knit. You remember that now.',
  },
  drawing: {
    title: "Mouse's drawing",
    text: 'Two girls holding hands. The taller has a yellow ribbon. Behind them a man with a spade digs and digs, and the hole has no bottom. Across the top, in a child\'s letters: WREN COME BAK.',
  },
  psalter: {
    title: 'The Psalter of Silence',
    text: 'Every page is bitten through. On the inside cover, in Ambrose\'s cramped hand: "The bell does not call the dead. It calls whatever answers to their name."',
  },
  confession: {
    title: 'An unsigned confession',
    text: 'I rang it. I climbed the tower with grave-dirt still on my hands and I rang it until my palms split, and something answered in her voice. Forgive me. No. Don\'t.',
  },
  tongue: {
    title: 'Tongue of the bell',
    text: 'The chapel bell\'s clapper, black iron, wrapped in a hundred strands of hair. All of it yellow. The Choir kept it in their mouths in turns, so the bell could never ring again. You took it anyway.',
  },
  feast: {
    title: 'A place card',
    text: 'At the head of an endless table, a card in careful child\'s handwriting: FOR PAPA. The chair has been pulled out. It has been pulled out for seven years.',
  },
  wren: {
    title: "Wren's wall",
    text: 'Scratched into a small room\'s stone: the Pit. The town. A man with a spade. A crown. And under the crown, in letters that get bigger and bigger until they cover the floor: I WAITED I WAITED I WAITED I WAITED',
  },
  crown: {
    title: 'The Hollow Crown',
    text: 'Black iron, beaten from the Door itself. Far too small for a king. Exactly right for a girl of seven.',
  },
};

// ===================================================================== quests
export const QUEST_ITEMS: Record<string, string> = {
  warden_chain: "Warden's Chain",
  agnes_ring: "Agnes's Ring",
  poppet: 'Button-Eyed Poppet',
  psalter: 'Psalter of Silence',
  hollow_heart: 'Hollow Heart',
};

export interface QuestDef {
  title: string;
  giver: string;
  stages: string[]; // index = stage; last stage is "done"
}

export const QUESTS: Record<string, QuestDef> = {
  main: {
    title: 'The Tithe Returned', giver: 'Mother Sallow',
    stages: [
      'Find someone in Hollowmere, south of the Pit, who will speak to you.',
      'Silence the Flayed Warden in the Ossuary, under the cemetery. Rubble blocks the way.',
      'Cross the river west of town. Destroy what feeds in the Rotwood.',
      'Cross the gorge east of town. Silence the Weeping Chapel.',
      'Ring the Silent Bell at the edge of the Pit. Go down to whoever is waiting.',
      'It is finished.',
    ],
  },
  bridge: { title: 'Iron for the Bridge', giver: 'Gudrun Fourfingers', stages: ['', "Bring Gudrun the Warden's chain. She'll mend the west bridge with it.", 'The west bridge stands again.'] },
  harrow: { title: 'Tomas', giver: 'Captain Harrow', stages: ['', "Harrow's son is still out in the cemetery. Give him rest.", 'It is done. Tell Harrow.', 'Harrow buried him by the gate.'] },
  ring: { title: "Agnes's Ring", giver: 'Old Coyle', stages: ['', "Find Agnes's ring in the Ossuary's hall of sarcophagi.", 'Agnes has her ring.'] },
  doll: { title: 'The Poppet', giver: 'Mouse', stages: ['', 'Mouse drew a doll, the Rotwood, and a cradle. Find the poppet in the Rotwood Hollow.', 'Mouse has her poppet back.'] },
  psalter: { title: 'The Psalter of Silence', giver: 'Brother Ambrose', stages: ['', "Find the Psalter in the Weeping Chapel's scriptorium.", 'Ambrose has read the Psalter.'] },
  hearts: { title: 'Fresh Stock', giver: 'Pell', stages: ['', 'Bring Pell five Hollow Hearts, cut from Hollows, Ghouls and Flagellants.', 'Pell is very pleased.'] },
};

// ===================================================================== NPCs
export interface Dialog {
  lines: string[];
  after?: () => void;
  shop?: string;
}
export interface NpcDef {
  id: string;
  name: string;
  title: string;
  glyph: string;
  color: number;
  talk: (g: Game) => Dialog;
}

const done = (g: Game, q: string) => g.quest(q) >= QUESTS[q].stages.length - 1;

export const NPCS: Record<string, NpcDef> = {
  // ------------------------------------------------------------ Mother Sallow
  sallow: {
    id: 'sallow', name: 'Mother Sallow', title: 'Elder of Hollowmere', glyph: '☻', color: 0xc8b0d8,
    talk: (g) => {
      const m = g.quest('main');
      if (m === 0)
        return {
          lines: [
            '*An old woman in grey. She has no eyelids. She cut them off, years ago, so she would never have to close her eyes on anything again.*',
            'So. The Pit gave you back.',
            'Seven years we fed it. Seven years it kept what we gave. And now it spits out the one mouthful we were glad to be rid of.',
            "Don't look at me like that, Digger. You know what you did. Or you will. The Pit has a way of returning things.",
            'The dead are walking again. Since the hour you crawled out. The Warden has left his post in the Ossuary — the gravekeeper who keeps them in the ground.',
            'Go and put him back in it. Or join him. Either serves Hollowmere.',
          ],
          after: () => g.setQuest('main', 1),
        };
      if (m === 1 && !g.bossDead('warden'))
        return { lines: ['Still breathing? The Ossuary is under the cemetery, north of the Pit. The door is choked with rubble.', 'You were always good with a spade. Your hut is east of the gate. Nobody would touch it.'] };
      if (m <= 1 || (m === 2 && !g.bossDead('mother'))) {
        const first = m <= 1;
        return {
          lines: [
            ...(first ? ['*She looks at you for a long time. She has no choice.*', 'The Warden is quiet. You smell of his embalming salts.'] : ['The Rotwood. West, over the river.']),
            'Something in the Rotwood, across the river, is fattening on what we throw out. On what we throw out to it.',
            'Gudrun can mend the bridge. If she can stand to look at you. Most of us can\'t.',
          ],
          after: () => g.setQuest('main', 2),
        };
      }
      if (m <= 2 || (m === 3 && !g.bossDead('choir'))) {
        const first = m <= 2;
        return {
          lines: [
            ...(first ? ['The Mother is dead. Then the chapel is next. And then the — no.'] : []),
            "Don't ask me about the bell. Don't you dare ask me about the bell.",
            'East, across the gorge. The Weeping Chapel. Whatever is singing there must stop singing. I have not slept since it started. I cannot close my eyes.',
          ],
          after: () => g.setQuest('main', 3),
        };
      }
      if (m <= 3 || (m === 4 && !g.bossDead('king'))) {
        const first = m <= 3;
        return {
          lines: [
            ...(first ? ['You heard them. In the chapel. You heard what they called you.', '...Then you know. Good. I was tired of being the only one who remembered.'] : []),
            'Take that cursed bell to the edge of the Pit and ring it. A stair will come. Go down it.',
            'Finish what you started seven years ago, gravedigger. She has been waiting for you long enough.',
          ],
          after: () => g.setQuest('main', 4),
        };
      }
      const warm = ['harrow', 'ring', 'doll', 'psalter', 'bridge'].filter((q) => done(g, q)).length >= 4;
      if (warm)
        return { lines: ['*She holds out a pressed flower. A buttercup, brown with age.*', 'Wren used to bring me these. Before. I kept one.', '...Go away. Please.'] };
      return { lines: ['Go away, Digger.'] };
    },
  },

  // ------------------------------------------------------------ Gudrun Fourfingers
  gudrun: {
    id: 'gudrun', name: 'Gudrun Fourfingers', title: 'Bridgewright', glyph: '☻', color: 0xd0a070,
    talk: (g) => {
      const q = g.quest('bridge');
      if (q === 0 && !g.hasQuestItem('warden_chain'))
        return {
          lines: [
            '*A big woman with a mallet. Her hands are mostly thumbs now. She laughs before she speaks, and after, and sometimes during.*',
            'Ha! Ha. The tithe walks. You know how many fingers I had when they threw you in? Ten.',
            'I gave the Pit one a year so it would leave my door alone. Seven years. One extra, the year the rain came down red. That leaves — ha — that leaves four. I\'m bad at sums since.',
            'The west bridge? The dead pulled it down from underneath. They don\'t like us crossing. I could mend it. I need iron. Good iron.',
            'The Warden wears the old gravekeeper\'s chain. Bring me that and I\'ll lay you a bridge. I won\'t like doing it. I\'ll do it.',
          ],
          after: () => g.setQuest('bridge', 1),
        };
      if (q <= 1 && g.hasQuestItem('warden_chain'))
        return {
          lines: [
            'Oh, that\'s lovely iron. Still warm from him. Still warm.',
            '*She goes to work. It takes no time at all, or a very long time; time hasn\'t worked right since the dusk.*',
            'There. Your bridge. Go on across and get eaten, ha.',
            '...You\'re less awful than I remember. That isn\'t praise. Don\'t make it praise.',
          ],
          after: () => {
            g.takeQuestItem('warden_chain');
            g.setQuest('bridge', 2);
            g.setFlag('bridge');
            g.sfx('quest');
          },
        };
      if (q === 1) return { lines: ['No chain, no bridge. The Warden\'s in the Ossuary. North. Big. Skinned. You\'ll know him.'] };
      return {
        lines: [g.rng.pick([
          'If you find my fingers down there, don\'t bring them back. They\'re happier.',
          'Wren used to sit on my bench and hand me nails. One at a time, very serious. Ha. Ha. Go away now.',
          'The bridge will hold. I put a finger in the mortar. The last one I could spare.',
        ])],
      };
    },
  },

  // ------------------------------------------------------------ Pell the butcher
  pell: {
    id: 'pell', name: 'Pell', title: 'Butcher & Renderer', glyph: '☻', color: 0xe08a80,
    talk: (g) => {
      const q = g.quest('hearts');
      if (q === 0)
        return {
          lines: [
            '*A round, rosy man in a spotless apron. The only clean thing in Hollowmere. He beams.*',
            'Customer! Oh. Oh, it\'s you. Well, ashes are ashes, I don\'t care whose pocket they come out of.',
            'Meat\'s fresh. Don\'t ask from where. Asking spoils the flavor.',
            'Tell you what. I need hearts. Hollow hearts — they still beat a little, after. Lovely in a broth. Bring me five and I\'ll make it worth the walk.',
          ],
          after: () => g.setQuest('hearts', 1),
          shop: 'pell',
        };
      if (q === 1 && g.hasQuestItem('hollow_heart', 5))
        return {
          lines: [
            'Five! Look at them go. Lovely. Lovely.',
            'You know, they kept you in salt for a week before the Pit, Digger. Waiting on the priest to finish praying. I did the salting myself.',
            'Nothing personal. You were very well preserved. Best work I ever did.',
            '*He presses a cleaver into your hands, still warm from the hook.*',
          ],
          after: () => {
            g.takeQuestItem('hollow_heart', 5);
            g.setQuest('hearts', 2);
            g.player.ashes += 1200;
            g.giveUnique('cleaver');
            g.sfx('quest');
          },
          shop: 'pell',
        };
      if (q === 1) return { lines: [`Hearts, Digger. Five. You've got ${g.questItemCount('hollow_heart')}. Hollows have them, ghouls, the whippy ones in the chapel.`], shop: 'pell' };
      return { lines: [g.rng.pick(['Come by any time. I\'ll keep a cut for you. Not of you. Ha! Not anymore.', 'The Wick burns my tallow, you know. Lights the whole town. Everybody chips in, eventually.', 'Waste not!'])], shop: 'pell' };
    },
  },

  // ------------------------------------------------------------ Old Coyle
  coyle: {
    id: 'coyle', name: 'Old Coyle', title: 'Tinker', glyph: '☻', color: 0x90a8c0,
    talk: (g) => {
      const q = g.quest('ring');
      if (q === 0 && !g.hasQuestItem('agnes_ring'))
        return {
          lines: [
            '*A blind old man among racks of salvaged gear. In a chair behind him sits his wife, Agnes, who has been dead for six years. Her hair has been brushed this morning.*',
            'Agnes, we\'ve a customer. ...She says you\'ve a murderer\'s walk. She\'s never wrong about walks.',
            'Buy something or get out of my light. Not that I\'ve any.',
            'Agnes wants her ring. They buried her with it, the first time, before I dug her back up. The Ossuary has it now, in the hall of the stone coffins. Bring it home and I\'ll give you the family price.',
          ],
          after: () => g.setQuest('ring', 1),
          shop: 'coyle',
        };
      if (q <= 1 && g.hasQuestItem('agnes_ring'))
        return {
          lines: [
            '*He turns the ring in his fingers, then works it onto Agnes\'s hand. It slides on easily. There is not much hand left.*',
            'Agnes. Look. ...She\'s crying. She doesn\'t cry.',
            'Your girl. Wren. She used to sit with Agnes, after. Fold her hands for her. Brush her hair. Wasn\'t frightened at all. Kind child.',
            'Too kind for her father. Family price, Digger. For Wren\'s sake. Not yours.',
          ],
          after: () => {
            g.takeQuestItem('agnes_ring');
            g.setQuest('ring', 2);
            g.sfx('quest');
          },
          shop: 'coyle',
        };
      return {
        lines: [g.rng.pick([
          'Agnes says you look thinner. Agnes, he\'s been dead too, give him a chance.',
          'New stock comes in when something big dies. Something big died lately, I can smell it on you.',
          'You dug her up three times, they say. I only dug Agnes up the once. I\'m not judging. I\'m just saying, once was enough.',
        ])],
        shop: 'coyle',
      };
    },
  },

  // ------------------------------------------------------------ Mouse
  mouse: {
    id: 'mouse', name: 'Mouse', title: 'Who does not speak', glyph: '☺', color: 0xf0e0a0,
    talk: (g) => {
      const q = g.quest('doll');
      if (q === 0 && !g.hasQuestItem('poppet'))
        return {
          lines: [
            '*A small girl with eyes too large for her face. She is drawing in the dirt with a stick: a man, a spade, a little grave.*',
            '*She looks up at you for a long moment. Then she scratches out the man\'s face.*',
            '*She draws again: a doll with button eyes. A tangle of trees across a river. A cradle. She points at you, hard, then at the cradle.*',
          ],
          after: () => g.setQuest('doll', 1),
        };
      if (q <= 1 && g.hasQuestItem('poppet'))
        return {
          lines: [
            '*She snatches the poppet and holds it to her ear, as if it is telling her something. She listens for a long time. She nods.*',
            '*She draws on a scrap of sackcloth and gives it to you, then tears a button from her coat and presses it into your palm.*',
            '*For the first time, she does not look afraid of you.*',
          ],
          after: () => {
            g.takeQuestItem('poppet');
            g.setQuest('doll', 2);
            g.giveLore('drawing');
            g.giveUnique('button');
            g.sfx('quest');
          },
        };
      if (q === 1) return { lines: ['*She draws the cradle again, and the river, and taps the cradle until the stick breaks.*'] };
      if (g.quest('main') >= 4) return { lines: ['*She draws a circle with lines coming out of it. A sun. Nobody here has seen one in seven years. She colors it in very, very carefully.*'] };
      return { lines: ['*She is drawing two girls holding hands. She doesn\'t look up, but she shifts over, so you can see.*'] };
    },
  },

  // ------------------------------------------------------------ Brother Ambrose
  ambrose: {
    id: 'ambrose', name: 'Brother Ambrose', title: 'Penitent', glyph: '☻', color: 0xd07060,
    talk: (g) => {
      const q = g.quest('psalter');
      if (q === 0 && !g.hasQuestItem('psalter'))
        return {
          lines: [
            '*A monk kneeling in the mud. His back is ribbons. He does not stop the whip while he talks.*',
            'Unclean. Unclean. Stand downwind of me, bellringer.',
            '...Bellringer. Yes. You don\'t remember. The Lord let you forget. He did not let me.',
            'Every stroke is one of the dead you woke. I am on four thousand and some. I lose count around the hymns.',
            'In the Weeping Chapel there is a book. The Psalter of Silence — the rite that shuts the Door. Bring it to me. If I can read it, perhaps they will sleep. Perhaps I can stop.',
          ],
          after: () => g.setQuest('psalter', 1),
        };
      if (q <= 1 && g.hasQuestItem('psalter'))
        return {
          lines: [
            '*He opens it. He turns the pages. He turns them faster.*',
            'There\'s nothing. Every page. Teeth. Somebody ate the rite.',
            '...You asked the bell to give her back, bellringer. That\'s what you asked. I was there. I held the door to the tower.',
            'And it did. That is the horror of it. It did.',
            '*He holds out the whip, handle first. You take it. He looks at his empty hands as if they belong to someone else.*',
          ],
          after: () => {
            g.takeQuestItem('psalter');
            g.setQuest('psalter', 2);
            g.giveLore('psalter');
            g.giveUnique('scourge');
            g.sfx('quest');
          },
        };
      if (q === 1) return { lines: ['The chapel is east, across the gorge. The scriptorium. Go. I have counting to do.'] };
      return { lines: [g.rng.pick(['I\'ve stopped. I just stopped. I don\'t know what to do with my hands.', 'She used to sing in the choir. Badly. Loudly. God, she was loud.', 'Forgive me, bellringer. No. I\'m not ready to say that. Ask me again later.'])] };
    },
  },

  // ------------------------------------------------------------ Captain Harrow
  harrow: {
    id: 'harrow', name: 'Captain Harrow', title: 'The Gatewatch', glyph: '☻', color: 0x8ab070,
    talk: (g) => {
      const q = g.quest('harrow');
      if (q === 0 && !g.flag('tomas_dead'))
        return {
          lines: [
            '*A one-armed guard leaning on the gatepost, a bottle where his other hand should be.*',
            'Halt. Who goes — oh. It\'s you. Wish they\'d thrown you deeper.',
            '*He drinks.* My boy\'s out in the graveyard. Tomas. Been out there since the spring. He doesn\'t come in when I call him anymore.',
            'He doesn\'t... he isn\'t... You understand me. I can\'t. I tried. I got as far as the gate and he looked at me.',
            'You\'d do it. You\'ve done worse. Put him down, Digger. Please. That\'s the first time I\'ve said please to you. Don\'t make me say it again.',
          ],
          after: () => g.setQuest('harrow', 1),
        };
      if (q <= 2 && g.flag('tomas_dead'))
        return {
          lines: [
            ...(q === 0 ? ['*He looks at the graveyard dirt on your boots, and he knows.*', 'You found Tomas. Out by the yew. Didn\'t you.'] : []),
            'Did he... was it quick? Don\'t tell me. Don\'t.',
            '...Was he still wearing his boots? I made him those boots.',
            '*He holds out his sword. His hand is shaking.* Take it. I can\'t hold it and the bottle both, and I know which one I\'m keeping.',
          ],
          after: () => {
            g.setQuest('harrow', 3);
            g.giveUnique('oath');
            g.sfx('quest');
          },
        };
      if (q === 1) return { lines: ['He\'ll be by the old yew in the cemetery. He always liked the yew. Go on.'] };
      return { lines: [g.rng.pick(['I buried him by the gate. Shallow. So I can hear him, in case.', 'You\'re still a bastard. But you\'re our bastard, now.', 'Your Wren used to salute me. Every morning. I\'d salute back. Stupid thing to miss.'])] };
    },
  },

  // ------------------------------------------------------------ The Wick
  wick: {
    id: 'wick', name: 'The Wick', title: 'Keeper of the Town Flame', glyph: '☺', color: 0xffc070,
    talk: (g) => {
      const m = g.quest('main');
      const lines = [
        [
          '*A woman, or what remains of one, slumped beside the town\'s great fire. Half of her has run like candle-wax, and pooled, and set. The flame grows from her shoulder.*',
          'Welcome back, little ember. Sit. Rest. They hate you, yes. Hate is warm too. Everything that burns is warm.',
          'Bring me ashes and I will make you more than you are. That is what fires are for. Rest at any flame you find, and I will feel it.',
        ],
        ['Did you find the little coffins, ember? ...Hush. I knew her too. She liked to watch me burn. She said I was pretty.'],
        ['The butcher brings me tallow. I don\'t ask from where. I am made of what I\'m given. So are you.'],
        ['You smell of the chapel. The bell is in your pack, isn\'t it? I can hear it not ringing.'],
        ['When you go down, little ember, you will be asked to choose. Whatever you choose, someone you love stays in the dark. That\'s the only kind of choice there is, down there.'],
        ['It\'s quiet. Is it over? It doesn\'t feel over. Sit with me a while.'],
      ];
      return { lines: lines[Math.min(m, lines.length - 1)] ?? lines[0] };
    },
  },
};

// ===================================================================== endings
export const ENDING_INTRO = [
  'The crown rolls to your feet. On the throne there is nothing left but a yellow ribbon.',
  'All around you, the dead are kneeling. They are kneeling to you.',
  'Far above, Hollowmere holds its breath in the dusk.',
];
export const ENDINGS: Record<string, { title: string; lines: string[] }> = {
  crown: {
    title: 'THE KING IN THE DUSK',
    lines: [
      'You set the crown on your head. It fits. Of course it fits. You made the door it was forged from.',
      'Above, the dusk goes on. Hollowmere will keep feeding the Pit, and you will keep eating, and nobody will ever be thrown down again without a king to catch them.',
      'And every night, a small voice in the dark asks for a story, and you have all the time in the world to tell it.',
    ],
  },
  bury: {
    title: "THE GRAVEDIGGER'S REST",
    lines: [
      'You take up the spade one last time.',
      'You dig until the stone gives. You lay the crown in the hole, and the ribbon, and whatever else is left of her, and you fill it in, and you pat it flat, and you do not dig it up again.',
      'On the surface, the sun rises over Hollowmere for the first time in seven years.',
      'Nobody sees it. The town is very quiet now. It turns out the dusk was the only thing keeping them standing.',
    ],
  },
};
