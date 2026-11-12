// Pixel art for the browser version, drawn in code. Pure data: no DOM, so it can be validated in Node.
// Creatures/objects are 12x12, bosses 24x24 (both drawn at 2x and 3x so they share a pixel density of
// roughly 2-3 screen pixels). Symmetric figures are authored as a left half and mirrored.

export interface Px {
  w: number;
  h: number;
  data: Int32Array; // 0xRRGGBB, or -1 for transparent
}

export function blank(w: number, h: number): Px {
  return { w, h, data: new Int32Array(w * h).fill(-1) };
}

/** Rows of characters -> pixels via a palette. '.' is transparent. */
export function spr(name: string, rows: string[], pal: Record<string, number>): Px {
  const h = rows.length, w = rows[0].length;
  const px = blank(w, h);
  rows.forEach((r, y) => {
    if (r.length !== w) throw new Error(`sprite ${name}: row ${y} is ${r.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const c = r[x];
      if (c === '.') continue;
      const col = pal[c];
      if (col === undefined) throw new Error(`sprite ${name}: no color for '${c}'`);
      px.data[y * w + x] = col;
    }
  });
  return px;
}

/** Left halves mirrored into full rows. */
export function sym(rows: string[]): string[] {
  return rows.map((r) => r + [...r].reverse().join(''));
}

function over(base: Px, x0: number, y0: number, top: Px): Px {
  for (let y = 0; y < top.h; y++)
    for (let x = 0; x < top.w; x++) {
      const c = top.data[y * top.w + x];
      if (c < 0) continue;
      const bx = x0 + x, by = y0 + y;
      if (bx < 0 || by < 0 || bx >= base.w || by >= base.h) continue;
      base.data[by * base.w + bx] = c;
    }
  return base;
}

// ----------------------------------------------------------------------- color helpers
const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
export function shade(c: number, f: number): number {
  return (cl(((c >> 16) & 255) * f) << 16) | (cl(((c >> 8) & 255) * f) << 8) | cl((c & 255) * f);
}
export function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  return (cl(ar + (((b >> 16) & 255) - ar) * t) << 16) | (cl(ag + (((b >> 8) & 255) - ag) * t) << 8) | cl(ab + ((b & 255) - ab) * t);
}
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const K = 0x120d0b; // outline

// ======================================================================= creatures (12x12)
export const CREATURES: Record<string, () => Px> = {
  player: () =>
    spr('player', [
      '....kkkk....',
      '...kCCCCk...',
      '..kCcccccCk.',
      '..kcfeefck..',
      '..kcffffck..',
      '.kCCcffcCCk.',
      'kCCCCCCCCCCk',
      'kCcCCbbCCcCk',
      '.kcCCCCCCck.',
      '.kcCCCCCCck.',
      '..kck..kck..',
      '..kk....kk..',
    ], { k: K, C: 0x6a5444, c: 0x4a3a30, f: 0xd8c8b0, e: 0x101010, b: 0x9a7a48 }),
  hollow: () =>
    spr('hollow', [
      '....kkkk....',
      '...kGGGGk...',
      '...kGeeGk...',
      '...kGggGk...',
      '....kggk....',
      '..kkgGGgkk..',
      '.kg.kggk.gk.',
      'kg..kgrk..gk',
      '....kggk....',
      '...kg..gk...',
      '...kg..gk...',
      '..kk....kk..',
    ], { k: K, g: 0x8a8474, G: 0xb0a890, e: 0x2a0a0a, r: 0x7a2420 }),
  rat: () =>
    spr('rat', [
      '............',
      '............',
      '............',
      '............',
      '......kkk...',
      '....kkBBBk..',
      '..kkBBBBBek.',
      '.kBBBBBBBBpk',
      'pkbbbbbbbbk.',
      'p.kbk..kbk..',
      '.p..........',
      '............',
    ], { k: K, b: 0x7a5a44, B: 0x9a7458, p: 0xc89a8a, e: 0xff3030 }),
  ghoul: () =>
    spr('ghoul', [
      '............',
      '....kkkk....',
      '...kGGGGk...',
      '...kGeGek...',
      '...kgtttk...',
      '..kkggggkk..',
      '.kGgggggggk.',
      'kGk.kgggk.kG',
      'Gk..kgggk..k',
      '...kgk.kgk..',
      '..kgk...kgk.',
      '..kk.....kk.',
    ], { k: K, g: 0x5a7a4a, G: 0x8ab070, e: 0xffe060, t: 0xe0e0c0 }),
  archer: () =>
    spr('archer', [
      '....kkkk....',
      '...kwwwwk...',
      '...kweewk..b',
      '...kwwwwk.bs',
      '....kwwk..bs',
      '..kwWwwWwkbs',
      '.kw.kWWk.wbs',
      '....kwwk..bs',
      '....kW.Wk.bs',
      '...kw...wkb.',
      '...kw...wk..',
      '..kk.....kk.',
    ], { k: K, w: 0xe0d8c0, W: 0xa8a088, e: 0x101010, b: 0x8a6030, s: 0xc8c8c8 }),
  cultist: () =>
    spr('cultist', [
      '....kkkk....',
      '...kRRRRk...',
      '..kRffffRk..',
      '..kRfeefRk..',
      '..kRffffRk..',
      '.kRRRRRRRRk.',
      'hkRrRRRRrRkh',
      '.kRrrRRrrRk.',
      '.kRrrRRrrRk.',
      '.kRrrrrrrRk.',
      'kRRRRRRRRRRk',
      'kkkkkkkkkkkk',
    ], { k: K, r: 0x4a2040, R: 0x7a3460, f: 0x2a1020, e: 0xff60c0, h: 0xffa0e0 }),
  bloated: () =>
    spr('bloated', [
      '............',
      '....kkkk....',
      '...kYYYYk...',
      '..kYeYYeYk..',
      '..kYYmmYYk..',
      '.kYYYYYYYYk.',
      'kYYyYYYYyYYk',
      'kYyyygYyyyYk',
      'kYYyyyyyyYYk',
      '.kYYYYYYYYk.',
      '..kYk..kYk..',
      '..kk....kk..',
    ], { k: K, y: 0xa0a050, Y: 0xc8c070, g: 0x6a7a3a, e: 0x101010, m: 0x6a2020 }),
  knight: () =>
    spr('knight', [
      '....kkkk....',
      '...kAAAAk...',
      '...kAvvAk...',
      '...kAAAAk...',
      '.SSkkAAkk...',
      'SsxsSAAAAk..',
      'SsxsSAaaAk..',
      'SsxsSAaaAAk.',
      '.SsS.kaak.k.',
      '.SS..kaak...',
      '....kak.kak.',
      '...kkk..kkk.',
    ], { k: K, a: 0x6a7890, A: 0xa8b8d0, v: 0x101418, s: 0x6a5040, S: 0xa08060, x: 0xc0b060 }),
  wraith: () =>
    spr('wraith', [
      '....cccc....',
      '...cCCCCc...',
      '..cCeCCeCc..',
      '..cCCCCCCc..',
      '..cCCCCCCc..',
      '.ccCCCCCCcc.',
      'c.cCCCCCCc.c',
      '..ccCCCCcc..',
      '...cCCCCc...',
      '...ccCCcc...',
      '....c..c....',
      '...c....c...',
    ], { c: 0x4a9aaa, C: 0xb8e8f8, e: 0x0a1a20 }),
  maggot: () =>
    spr('maggot', [
      '............',
      '............',
      '............',
      '............',
      '............',
      '...kkkkk....',
      '..kpPpPpkk..',
      '.kepPpPpPpk.',
      '.kpPpPpPpPk.',
      '..kkkkkkkk..',
      '............',
      '............',
    ], { k: K, p: 0xe8d8a8, P: 0xc0b080, e: 0x101010 }),
  flagellant: () =>
    spr('flagellant', [
      '....kkkk....',
      '...khhhhk...',
      '...khhhhk...',
      '...kssssk...',
      '..kkssssk..w',
      '.kssrssrsk.w',
      'kssrsrsrssww',
      '.kssrssrsk..',
      '..khhhhhhk..',
      '..khhhhhhk..',
      '..ksk..ksk..',
      '..kk....kk..',
    ], { k: K, s: 0xb08070, r: 0xc03030, h: 0x3a2a20, w: 0x7a5a38 }),
  sentinel: () =>
    spr('sentinel', [
      '...kbbbbk...',
      '..kbBeeBbk..',
      '..kbbBBbbk..',
      '.kbBbbbbBbk.',
      'kbbkbBBbkbbk',
      'kbBkbbbbkBbk',
      'kbbkbBBbkbbk',
      '.kk.bbbb.kk.',
      '...kbBBbk...',
      '..kbbkkbbk..',
      '..kbBk.kBbk.',
      '.kkkk..kkkk.',
    ], { k: K, b: 0xd0c098, B: 0x9a8a68, e: 0xff5020 }),
  hound: () =>
    spr('hound', [
      '............',
      '............',
      '............',
      '.........kk.',
      '........kDDk',
      'k......kDDek',
      'kDkkkkkDDDtk',
      '.kDDDDDDDkk.',
      '..kddddddk..',
      '..kdk..kdk..',
      '..kdk..kdk..',
      '..kk....kk..',
    ], { k: K, d: 0x6a4a30, D: 0x9a7048, e: 0xff4020, t: 0xe0e0c0 }),
  choirling: () =>
    spr('choirling', [
      '....kkkk....',
      '...knnnnk...',
      '..knwwwwnk..',
      '..knwffwnk..',
      '..knfmmfnk..',
      '..knwffwnk..',
      '.knnnnnnnnk.',
      '.knnnnnnnnk.',
      '.knnnwwnnnk.',
      '.knnnnnnnnk.',
      '.knnnnnnnnk.',
      '.kkkkkkkkkk.',
    ], { k: K, n: 0x2a2036, w: 0xe8e0f0, f: 0xc8b0a8, m: 0x400018 }),
};
CREATURES.thrall = () => recolor(CREATURES.hollow(), { 0x8a8474: 0x3a6a44, 0xb0a890: 0x70c080, 0x2a0a0a: 0xb0ffb0 });

/** Townsfolk: one figure, tinted with the NPC's own color. */
export function villager(c: number, child = false): Px {
  const rows = child
    ? [
        '............',
        '............',
        '............',
        '....kkkk....',
        '...kffffk...',
        '...kfeefk...',
        '....kffk....',
        '...kcccck...',
        '..kccccccK..',
        '...kccccK...',
        '...kfk.kfk..',
        '...kk..kk...',
      ]
    : [
        '....kkkk....',
        '...kffffk...',
        '...kfeefk...',
        '...kffffk...',
        '....kffk....',
        '..kkcccckk..',
        '.kccccccccK.',
        '.kcckccKccK.',
        '.kccccccccK.',
        '..kccccccK..',
        '...kck.kcK..',
        '...kk...kk..',
      ];
  return spr('villager', rows.map((r) => r.replace(/K/g, 'k')), { k: K, f: 0xc8b0a0, e: 0x101010, c: shade(c, 0.75) });
}

export function recolor(p: Px, map: Record<number, number>): Px {
  const out = { ...p, data: p.data.slice() };
  for (let i = 0; i < out.data.length; i++) if (map[out.data[i]] !== undefined) out.data[i] = map[out.data[i]];
  return out;
}

// ======================================================================= bosses (24x24)
export const BOSS_ART: Record<string, () => Px> = {
  warden: () => {
    const p = spr('warden', sym([
      '........kkkk',
      '.......kSSSS',
      '......kSssSS',
      '......kSsrRR',
      '......kSrReR',
      '......kSrRRm',
      '.......kSrRR',
      '.....kkkSSrR',
      '...kkSSSSSRR',
      '..kSSSsRRRRR',
      '.kSSsRRRRRrR',
      '.kSsRRkRRRRr',
      'kSsRRkkRRRRR',
      'kSsRRk.kRRRr',
      'kSRRk..kRRRR',
      'kRRk...kRrRR',
      '.kRk...kRRRR',
      '..k....kSSSS',
      '......kSsSSs',
      '......kRRkkR',
      '......kRRk..',
      '......kRRk..',
      '.....kRRRk..',
      '.....kkkkk..',
    ]), { k: 0x1a0a08, r: 0x8a2a20, R: 0xc04a38, s: 0xa88a60, S: 0xd8c09a, e: 0xffe080, m: 0x2a0806 });
    return over(p, 19, 9, spr('cleaver', ['.CCC.', 'CCCCk', 'CCCck', '.Cck.', '..k..', '..k..', '..k..'], { C: 0xd0d0d8, c: 0x8a8a98, k: 0x3a2a20 }));
  },
  mother: () =>
    spr('mother', sym([
      '............',
      '............',
      '.......kkkkk',
      '.....kkPPPPP',
      '....kPPPpPPP',
      '...kPPpPPPPP',
      '..kPPPPPkPPe',
      '..kPpPPPPPPP',
      '.kPPPPPmPPPP',
      '.kPPpPPPPPkk',
      'kPPPPPPPPkrr',
      'kPmPPPPPPkrr',
      'kPPPPpPPPPkk',
      'kPPPPPPPPPPP',
      'kPpPPmPPPPpP',
      'kPPPPPPPPPPP',
      '.kPPPPpPPPPP',
      '.kPPmPPPPPPP',
      '..kPPPPPPPpP',
      '..kPPPPPPPPP',
      '...kkPPPPPPP',
      '.....kkkkPPP',
      '........kkkk',
      '............',
    ]), { k: 0x2a2410, P: 0xc8c070, p: 0xa09848, m: 0xf8f8e8, e: 0x101010, r: 0x6a1010 }),
  choir: () =>
    spr('choir', sym([
      '............',
      '.kkk....kkkk',
      'knnnk..knnnn',
      'knwwk..knwww',
      'knwfk..knwff',
      'knwmk..knwfm',
      '.knnk..kknnn',
      'kknnnkkknnnn',
      'knnnnnnnnnnn',
      'knnwnnnnnnnn',
      'knwwwnnnnwnn',
      'knnwnnnnwwwn',
      'knnnnnnnnwnn',
      'knnnnnnnnnnn',
      'kknnnnnnnnnn',
      'knnnnnnnnnll',
      'knnnnnnnnnnl',
      'knnnnnnnnnnn',
      'knnnnnnnnnnn',
      'knnnnnnnnnnn',
      '.knnnnnnnnnn',
      '.knnnknnnnnk',
      '..kkk.kkkkk.',
      '............',
    ]), { k: 0x0e0a14, n: 0x2e2640, w: 0xe8e0f0, f: 0xc8b0a8, m: 0x400018, l: 0xc8a0ff }),
  king: () =>
    spr('king', sym([
      '....k..k..k.',
      '....kk.kk.kk',
      '....kccccccc',
      '....kcCcCcCd',
      '.....kkkkkkk',
      '.....kpppppp',
      '.....kpeeppp',
      '.....kpppppp',
      '......kppmpp',
      '......kkpppp',
      '....kkvvkkpp',
      '..kkvvVVvvkk',
      '.kvvVVvvvvvv',
      '.kvVVvvvvvVV',
      'kvvVvvvvvvVv',
      'kvVvvvvvvVvv',
      'kvVvvvvvvvvv',
      'kvvvvvvvvvvv',
      'kbbbbbbbbbbb',
      'kbBbbBbbBbbB',
      'kbbbbbbbbbbb',
      'kbBkkkkkkbBk',
      'kbbk....kbbk',
      'kkkk....kkkk',
    ]), { k: 0x0e0a14, c: 0x6a5430, C: 0xd0b060, d: 0xa080f0, p: 0xd8d0e0, e: 0x1a0a20, m: 0x6a3050, v: 0x4a2e6a, V: 0x7a52a8, b: 0x9a8a72, B: 0x6a5e4c }),
};

// ======================================================================= objects & items
const O: Record<string, () => Px> = {
  bonfire0: () => spr('bonfire', [
    '.....s......',
    '.....s......',
    '....fsf.....',
    '...fFsFf....',
    '..fFyyyFf...',
    '..fFyyyFf...',
    '.fFFyyyFFf..',
    '..ffFFFff...',
    '.kaaaaaaaak.',
    'kaaakaakaaak',
    '.kkkkkkkkkk.',
    '............',
  ], { k: K, a: 0x5a5450, s: 0xb0b0c0, f: 0xd04010, F: 0xffa030, y: 0xfff0a0 }),
  bonfire1: () => spr('bonfire', [
    '.....s......',
    '....fs......',
    '...fFsf.....',
    '..fFysFf....',
    '..fFyyyFf...',
    '.fFyyyyFf...',
    '.fFFyyyFFf..',
    '..fFFFFff...',
    '.kaaaaaaaak.',
    'kaaakaakaaak',
    '.kkkkkkkkkk.',
    '............',
  ], { k: K, a: 0x5a5450, s: 0xb0b0c0, f: 0xd04010, F: 0xffa030, y: 0xfff0a0 }),
  lamp: () => spr('lamp', [
    '....kkkk....',
    '...kyyyyk...',
    '...kyYYyk...',
    '...kyYYyk...',
    '....kkkk....',
    '.....kk.....',
    '.....kk.....',
    '.....kk.....',
    '.....kk.....',
    '.....kk.....',
    '....kkkk....',
    '............',
  ], { k: 0x2a2420, y: 0xffa040, Y: 0xfff0b0 }),
  chest: () => spr('chest', [
    '............',
    '............',
    '............',
    '..kkkkkkkk..',
    '.kWWWWWWWWk.',
    '.kWwwwwwwWk.',
    '.kmmmmmmmmk.',
    '.kWWWmmWWWk.',
    '.kWwwmmwwWk.',
    '.kWwwwwwwWk.',
    '.kkkkkkkkkk.',
    '............',
  ], { k: K, w: 0x5a3a20, W: 0x8a6034, m: 0xc0a040 }),
  chest_open: () => spr('chest_open', [
    '............',
    '..kkkkkkkk..',
    '.kWWWWWWWWk.',
    '.kmmmmmmmmk.',
    '..kkkkkkkk..',
    '.kddddddddk.',
    '.kmmmmmmmmk.',
    '.kWwwwwwwWk.',
    '.kWwwwwwwWk.',
    '.kWwwwwwwWk.',
    '.kkkkkkkkkk.',
    '............',
  ], { k: K, w: 0x5a3a20, W: 0x8a6034, m: 0x8a7030, d: 0x100a06 }),
  urn: () => spr('urn', [
    '............',
    '....kkkk....',
    '....kddk....',
    '...kccCck...',
    '..kcCCCCck..',
    '..kcCCCCck..',
    '..kccCCcck..',
    '..kdccccdk..',
    '...kccccck..',
    '...kddddk...',
    '....kkkk....',
    '............',
  ], { k: K, c: 0x8a6040, C: 0xb88a60, d: 0x5a3a28 }),
  grave: () => spr('grave', [
    '....kkkk....',
    '....kSSk....',
    '.kkkkSSkkkk.',
    '.kSSSSSSSSk.',
    '.kkkkSSkkkk.',
    '....kSSk....',
    '....kSsk....',
    '....kSsk....',
    '....kSsk....',
    '..dddddddd..',
    '.dddddddddd.',
    '............',
  ], { k: 0x1a1a1c, S: 0x9a9a9e, s: 0x6a6a70, d: 0x3a2a1a }),
  grave_dug: () => spr('grave_dug', [
    '............',
    '............',
    '...dd.......',
    '..dDDd......',
    '.dDDDDd.....',
    '..kkkkkkkk..',
    '.kxxxxxxxxk.',
    '.kxxxxxxxxk.',
    '.kxxxxxxxxk.',
    '..kkkkkkkk..',
    '............',
    '............',
  ], { k: 0x2a1a10, x: 0x060404, d: 0x4a3420, D: 0x6a4a2a }),
  tablet: () => spr('tablet', [
    '............',
    '...kkkkkk...',
    '..kSSSSSSk..',
    '.kSsssssSSk.',
    '.kSSSSSSSSk.',
    '.kSsssssSSk.',
    '.kSSSSSSSSk.',
    '.kSssssSSSk.',
    '.kSSSSSSSSk.',
    '.kkkkkkkkkk.',
    'kkkkkkkkkkkk',
    '............',
  ], { k: 0x1a1a20, S: 0xa0a0b8, s: 0x50506a }),
  message: () => spr('message', [
    '............',
    '............',
    '............',
    '............',
    '.....r......',
    '...rr.r.r...',
    '..r..rr..r..',
    '...r.r.rr...',
    '....r..r....',
    '............',
    '............',
    '............',
  ], { r: 0xe08a40 }),
  spikes: () => spr('spikes', [
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '.k.k.k.k.k..',
    '.s.s.s.s.s..',
    'kkkkkkkkkkk.',
    '............',
  ], { k: 0x2a2a2a, s: 0x6a6a6a }),
  spikes_up: () => spr('spikes_up', [
    '............',
    '.s..s..s..s.',
    '.s..s..s..s.',
    'sSs.sSssSssS',
    'sSssSssSs.sS',
    'sSs.sSssSssS',
    '.S..S..S..S.',
    '.S..S..S..S.',
    '.r..r..r..r.',
    '.r..r..r..r.',
    'kkkkkkkkkkkk',
    '............',
  ], { k: 0x2a2a2a, s: 0xd0d0d0, S: 0x9a9a9a, r: 0x8a1010 }),
  rune: () => spr('rune', [
    '............',
    '.....kk.....',
    '....kssk....',
    '...ksSSsk...',
    '..ksSssSsk..',
    '.ksSs..sSsk.',
    '.ksSs..sSsk.',
    '..ksSssSsk..',
    '...ksSSsk...',
    '....kssk....',
    '.....kk.....',
    '............',
  ], { k: 0x1a2028, s: 0x405060, S: 0x6a8090 }),
  rune_lit: () => spr('rune_lit', [
    '.....cc.....',
    '....cWWc....',
    '...cWCCWc...',
    '..cWCwwCWc..',
    '.cWCw..wCWc.',
    'cWCw....wCWc',
    'cWCw....wCWc',
    '.cWCw..wCWc.',
    '..cWCwwCWc..',
    '...cWCCWc...',
    '....cWWc....',
    '.....cc.....',
  ], { c: 0x1a6a7a, C: 0x60e0ff, W: 0xb8f8ff, w: 0x2aa0c0 }),
  boulder: () => spr('boulder', [
    '............',
    '....kkkk....',
    '..kkSSSskk..',
    '.kSSSSSSssk.',
    '.kSWWSSSssk.',
    'kSSWSSSSsssk',
    'kSSSSSSSsssk',
    'kSSSSSSssssk',
    '.kSSSSsssdk.',
    '.kksssssdkk.',
    '...kkkkkk...',
    '............',
  ], { k: 0x1a1816, S: 0x9a9488, s: 0x6a6458, W: 0xc8c0b0, d: 0x4a4440 }),
  plate: () => spr('plate', [
    '............',
    '............',
    '.kkkkkkkkkk.',
    '.kSSSSSSSSk.',
    '.kSssssssSk.',
    '.kSsddddsSk.',
    '.kSsddddsSk.',
    '.kSsddddsSk.',
    '.kSssssssSk.',
    '.kSSSSSSSSk.',
    '.kkkkkkkkkk.',
    '............',
  ], { k: 0x1a1816, S: 0x7a7468, s: 0x5a5448, d: 0x3a3630 }),
  brazier: () => spr('brazier', [
    '............',
    '............',
    '............',
    '............',
    '.kkkkkkkkkk.',
    '.kccccccccK.'.replace('K', 'k'),
    '..kccccccK..'.replace('K', 'k'),
    '...kkkkkk...',
    '.....kk.....',
    '.....kk.....',
    '...kkkkkk...',
    '............',
  ], { k: 0x2a2420, c: 0x5a4a40 }),
  corpse: () => spr('corpse', [
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '..rr..kk....',
    '.rRRkkBBkk..',
    'rRBBBBBBBBk.',
    '.kkBBkkBBk.r',
    '..r...rRr...',
    '............',
  ], { k: 0x2a1010, B: 0x5a3a30, R: 0x8a1a12, r: 0x5a0a08 }),
  bones: () => spr('bones', [
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
    '.....bb.....',
    '..b..bWb....',
    '.bWb..bb..b.',
    '..bWWWWWbWb.',
    '...b.....b..',
    '............',
  ], { b: 0x8a8270, W: 0xd0c8b0 }),
  rubble: () => spr('rubble', [
    '............',
    '.....kkk....',
    '....kSSsk...',
    '..kkkSsskk..',
    '.kSSsksskSk.',
    '.kSsskkkSSsk',
    'kkkkSSskSssk',
    'kSSsSsskkkkk',
    'kSssksskSSsk',
    'kkkkkkkkSssk',
    '.kSSSskkkkk.',
    '.kkkkkk.....',
  ], { k: 0x1a1612, S: 0xa89a80, s: 0x6a5e4c }),
  thorns: () => spr('thorns', [
    '.t...t....t.',
    '..t.tTt..t..',
    't..tTtTttT.t',
    '.ttTtTTtTtt.',
    '..tTtttTtT..',
    't.TttTttTtt.',
    '.tTtTtTTtTt.',
    'ttTttTtTttTt',
    '.tTtTtttTtt.',
    't.tTttTtTt.t',
    '.tttTttTttt.',
    '..t..tt..t..',
  ], { t: 0x3a1a26, T: 0x7a4a5a }),
  tree0: () => spr('tree0', [
    '....kkkk....',
    '..kkLLLLkk..',
    '.kLLlLLlLLk.',
    'kLlLLLLLLlLk',
    'kLLLlLLlLLLk',
    'kLlLLLLLLLlk',
    '.kLLLlLLLLk.',
    '..kkkTTkkk..',
    '.....TT.....',
    '.....TT.....',
    '....TTTT....',
    '............',
  ], { k: 0x0e140a, L: 0x2e4a24, l: 0x46683a, T: 0x4a3420 }),
  deadtree: () => spr('deadtree', [
    '..T......T..',
    '...T....T...',
    '.T..T..T..T.',
    '..T..TT..T..',
    '...TT.TTT...',
    '....TTTT....',
    '.....TT.....',
    '.....TT.....',
    '.....TT.....',
    '....TTTT....',
    '...TT..TT...',
    '............',
  ], { T: 0x5a4632 }),
  fence: () => spr('fence', [
    '.i..i..i..i.',
    'iIiiIiiIiiIi',
    '.I..I..I..I.',
    '.I..I..I..I.',
    'iIiiIiiIiiIi',
    '.I..I..I..I.',
    '.I..I..I..I.',
    '.I..I..I..I.',
    '.I..I..I..I.',
    'iIiiIiiIiiIi',
    '.I..I..I..I.',
    '............',
  ], { i: 0x3a3a42, I: 0x6a6a76 }),
  door: () => spr('door', [
    'kkkkkkkkkkkk',
    'kWwWwWwWwWwk',
    'kWwWwWwWwWwk',
    'kmmmmmmmmmmk',
    'kWwWwWwWwWwk',
    'kWwWwWwWwWwk',
    'kWwWwWwWwgwk',
    'kWwWwWwWwWwk',
    'kmmmmmmmmmmk',
    'kWwWwWwWwWwk',
    'kWwWwWwWwWwk',
    'kkkkkkkkkkkk',
  ], { k: 0x1a120a, W: 0x7a5430, w: 0x5a3a20, m: 0x3a3a3a, g: 0xc0a040 }),
  door_open: () => spr('door_open', [
    'kk........kk',
    'kW........Wk',
    'kw........wk',
    'km........mk',
    'kW........Wk',
    'kw........wk',
    'kW........Wk',
    'kw........wk',
    'km........mk',
    'kW........Wk',
    'kw........wk',
    'kk........kk',
  ], { k: 0x1a120a, W: 0x7a5430, w: 0x5a3a20, m: 0x3a3a3a }),
  door_locked: () => spr('door_locked', [
    'kkkkkkkkkkkk',
    'kWwWwWwWwWwk',
    'kmmmmmmmmmmk',
    'kWwWwggWwWwk',
    'kWwWgGGgwWwk',
    'kWwWgGGgwWwk',
    'kWwWwgdwwWwk',
    'kWwWwgdwwWwk',
    'kWwWwggwwWwk',
    'kmmmmmmmmmmk',
    'kWwWwWwWwWwk',
    'kkkkkkkkkkkk',
  ], { k: 0x1a120a, W: 0x7a5430, w: 0x5a3a20, m: 0x5a5a62, g: 0xc0a040, G: 0xffe080, d: 0x1a1008 }),
  stairs: () => spr('stairs', [
    'kkkkkkkkkkkk',
    'kSSSSSSSSSSk',
    'kssssssssssk',
    'k.SSSSSSSS.k',
    'k.ssssssss.k',
    'k..SSSSSS..k',
    'k..ssssss..k',
    'k...SSSS...k',
    'k...ssss...k',
    'k....xx....k',
    'k..........k',
    'kkkkkkkkkkkk',
  ], { k: 0x0a0a10, S: 0x8a8a98, s: 0x4a4a58, x: 0x202030 }),
  upstairs: () => spr('upstairs', [
    'kkkkkkkkkkkk',
    'k....yy....k',
    'k...SSSS...k',
    'k...ssss...k',
    'k..SSSSSS..k',
    'k..ssssss..k',
    'k.SSSSSSSS.k',
    'k.ssssssss.k',
    'kSSSSSSSSSSk',
    'kssssssssssk',
    'kSSSSSSSSSSk',
    'kkkkkkkkkkkk',
  ], { k: 0x0a0a10, S: 0x9a9aa8, s: 0x5a5a68, y: 0xfff0b0 }),
  entrance: () => spr('entrance', [
    '...kkkkkk...',
    '..kSSSSSSk..',
    '.kSkkkkkkSk.',
    '.kSk....kSk.',
    'kSk......kSk',
    'kSk.ssss.kSk',
    'kSk......kSk',
    'kSk.SSSS.kSk',
    'kSk......kSk',
    'kSkSSSSSSkSk',
    'kSk......kSk',
    'kkkkkkkkkkkk',
  ], { k: 0x0a0806, S: 0x8a7a68, s: 0x4a3e32 }),
  bridge: () => spr('bridge', [
    'kkkkkkkkkkkk',
    'WWWWWWWWWWWW',
    'wwwwwwwwwwww',
    'kkkkkkkkkkkk',
    'WWWWWWWWWWWW',
    'wwwwwwwwwwww',
    'kkkkkkkkkkkk',
    'WWWWWWWWWWWW',
    'wwwwwwwwwwww',
    'kkkkkkkkkkkk',
    'WWWWWWWWWWWW',
    'kkkkkkkkkkkk',
  ], { k: 0x2a1c10, W: 0x8a6a40, w: 0x6a4e2c }),
  broken: () => spr('broken', [
    '............',
    'WWWW....WW..',
    'wwww......w.',
    'kkk.........',
    '............',
    '............',
    '.......WWWWW',
    '.....wwwwwww',
    '......kkkkkk',
    '............',
    'WW....WWWW..',
    'k......kkk..',
  ], { k: 0x2a1c10, W: 0x6a4e30, w: 0x4a3620 }),
};

// ----------------------------------------------------------------------- items (12x12, tinted by rarity)
export function itemArt(kind: string, c: number): Px {
  const hi = blend(c, 0xffffff, 0.45), lo = shade(c, 0.6);
  const pal = { k: K, c, h: hi, l: lo, g: 0xc0a040, b: 0x6a4a2a };
  switch (kind) {
    case 'weapon': return spr('i_weapon', [
      '..........hk',
      '.........hck',
      '........hck.',
      '.......hck..',
      '......hck...',
      '.....hck....',
      '..k.hck.....',
      '..kgck......',
      '...gg.......',
      '..kbgk......',
      '.kbk.k......',
      '.kk.........',
    ], pal);
    case 'bow': return spr('i_bow', [
      '....bb......',
      '...b..h.....',
      '..b....h....',
      '..b.....h...',
      '.b......h...',
      '.bcccccchc..',
      '.b......h...',
      '..b.....h...',
      '..b....h....',
      '...b..h.....',
      '....bb......',
      '............',
    ], pal);
    case 'helm': return spr('i_helm', [
      '............',
      '............',
      '....kkkk....',
      '...khhhck...',
      '..khcccclk..',
      '..khcccclk..',
      '..kckkkkck..',
      '..kcllllck..',
      '..kck..kck..',
      '...kk..kk...',
      '............',
      '............',
    ], pal);
    case 'chest': return spr('i_chest', [
      '............',
      '..kk....kk..',
      '.khckkkkchk.',
      '.khcccccchk.',
      '..kcchhcck..',
      '..kcchhcck..',
      '..kcclccck..',
      '..kccllcck..',
      '..kcccccck..',
      '...kkkkkk...',
      '............',
      '............',
    ], pal);
    case 'ring': return spr('i_ring', [
      '............',
      '............',
      '.....hh.....',
      '....hcch....',
      '...kkhhkk...',
      '..kc....ck..',
      '..kc....ck..',
      '..kc....lk..',
      '...kllllk...',
      '....kkkk....',
      '............',
      '............',
    ], pal);
    case 'amulet': return spr('i_amulet', [
      '..g......g..',
      '...g....g...',
      '....g..g....',
      '.....gg.....',
      '....kkkk....',
      '...khcchk...',
      '...kccclk...',
      '...kcclck...',
      '....kllk....',
      '.....kk.....',
      '............',
      '............',
    ], pal);
  }
  return blank(12, 12);
}

const PICKUPS: Record<string, () => Px> = {
  i_key: () => spr('i_key', [
    '............',
    '............',
    '..gggg......',
    '.g....g.....',
    '.g....gggggg',
    '.g....g..g.g',
    '..gggg...g.g',
    '............',
    '............',
    '............',
    '............',
    '............',
  ], { g: 0xffd040 }),
  i_tallow: () => spr('i_tallow', [
    '.....y......',
    '....yYy.....',
    '.....y......',
    '.....k......',
    '....wwww....',
    '....wWww....',
    '....wWww....',
    '....wWww....',
    '....wwww....',
    '...kkkkkk...',
    '............',
    '............',
  ], { y: 0xffa040, Y: 0xfff0b0, k: 0x2a2420, w: 0xe8dcb0, W: 0xfff8e0 }),
  i_lore: () => spr('i_lore', [
    '............',
    '..pppppppp..',
    '.pPPPPPPPpp.',
    '..pPllPlPp..',
    '..pPPPPPPp..',
    '..pPlPllPp..',
    '..pPPPPPPp..',
    '..pPllPPPp..',
    '..pPPPPPPp..',
    '.ppPPPPPPp..',
    '..pppppppp..',
    '............',
  ], { p: 0x8a7a5a, P: 0xe8dcc0, l: 0x6a5a48 }),
  i_quest: () => spr('i_quest', [
    '............',
    '.....yy.....',
    '....y..y....',
    '..kkkyykkk..',
    '..kQQyyQQk..',
    '..kQqyyqQk..',
    '..kyyyyyyk..',
    '..kQqyyqQk..',
    '..kQQyyQQk..',
    '..kkkkkkkk..',
    '............',
    '............',
  ], { k: 0x2a2010, Q: 0xb89a60, q: 0x8a7040, y: 0xffe0a0 }),
  i_ashes: () => spr('i_ashes', [
    '............',
    '.....w......',
    '....wWw.....',
    '...wWWWw....',
    '....wWWw....',
    '...wWWWWw...',
    '....wWWw....',
    '.....ww.....',
    '............',
    '............',
    '............',
    '............',
  ], { w: 0x8a80d0, W: 0xd8d0ff }),
  i_stain: () => spr('i_stain', [
    '............',
    '............',
    '............',
    '....rr.r....',
    '..rrRRrr....',
    '.rRRRRRRrr..',
    '.rRRWRRRRr..',
    '..rRRRRRRrr.',
    '.r.rrRRrr...',
    '......r.....',
    '............',
    '............',
  ], { r: 0x6a0808, R: 0xc01818, W: 0xff6060 }),
};

export const OBJECTS: Record<string, () => Px> = { ...O, ...PICKUPS };

/** A lit brazier, its flame in the brazier's own color. */
export function brazierLit(c: number, frame: number): Px {
  const base = O.brazier();
  const fl = spr('flame', frame
    ? ['....f.f.....', '...fFfFf....', '..fFyyFf....', '..fFyyyFf...']
    : ['.....f......', '...ffFf.....', '..fFyyFff...', '...fFyyFf...'], { f: shade(c, 0.7), F: c, y: blend(c, 0xffffff, 0.6) });
  return over(base, 0, 1, fl);
}

// ======================================================================= terrain (procedural)
export type Ground = 'flag' | 'rough' | 'cobble' | 'grass' | 'moss' | 'road' | 'soil' | 'ash' | 'boards' | 'mud' | 'stone';

export function floorTile(style: Ground, c: number, seed: number): Px {
  const p = blank(12, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const n = hash(x, y, seed);
      let col = shade(c, 0.85 + n * 0.3);
      switch (style) {
        case 'flag':
          if ((y === 5 || y === 11) || ((y < 5 ? x === 3 : x === 8) || x === 11)) col = shade(c, 0.55);
          break;
        case 'cobble': {
          const cx = (x + (y > 5 ? 3 : 0)) % 6, cy = y % 6;
          if (cx === 0 || cy === 0) col = shade(c, 0.5);
          else if (cx === 1 && cy === 1) col = shade(c, 1.25);
          break;
        }
        case 'grass':
          if (n > 0.86) col = blend(c, 0x6a7a40, 0.6);
          else if (n < 0.08) col = shade(c, 0.6);
          break;
        case 'moss':
          if (n > 0.8) col = blend(c, 0x4a7a3a, 0.5);
          break;
        case 'road':
          if (n > 0.92) col = shade(c, 1.4);
          break;
        case 'boards':
          if (y % 4 === 3) col = shade(c, 0.55);
          else if ((x + (y >> 2) * 5) % 12 === 0) col = shade(c, 0.6);
          break;
        case 'ash':
          if (n > 0.9) col = 0x8a8a88;
          break;
        case 'stone':
          if (n > 0.93) col = shade(c, 1.35);
          break;
      }
      p.data[y * 12 + x] = col;
    }
  return p;
}

export function wallTile(c: number, seed: number, cracked = false): Px {
  const p = blank(12, 12);
  const mortar = shade(c, 0.35);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const row = (y / 4) | 0;
      const off = row % 2 ? 3 : 0;
      const n = hash(x, y, seed);
      let col = shade(c, 0.8 + n * 0.25 + (y % 4 === 0 ? 0.15 : 0));
      if (y % 4 === 3 || (x + off) % 6 === 0) col = mortar;
      p.data[y * 12 + x] = col;
    }
  if (cracked) {
    const crack = [[6, 0], [6, 1], [5, 2], [5, 3], [6, 4], [7, 5], [7, 6], [6, 7], [5, 8], [5, 9], [4, 10], [4, 11], [8, 6], [9, 7]];
    for (const [x, y] of crack) p.data[y * 12 + x] = 0x050403;
  }
  return p;
}

export function waterTile(frame: number, seed: number): Px {
  const p = blank(12, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const n = hash(x, y, seed);
      let col = blend(0x0c1a28, 0x163048, n * 0.5);
      if ((y + frame * 2) % 6 === 0 && (x + y + frame) % 5 < 3) col = 0x3a5a7a;
      p.data[y * 12 + x] = col;
    }
  return p;
}

export function chasmTile(seed: number): Px {
  const p = blank(12, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) p.data[y * 12 + x] = hash(x, y, seed) > 0.97 ? 0x1a1a24 : 0x030305;
  return p;
}

export function mistTile(frame: number, seed: number, solid: boolean): Px {
  const p = blank(12, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      if (solid) {
        p.data[y * 12 + x] = y % 4 === 3 ? 0x2a2a5a : blend(0x6a6ab0, 0xc8c8ff, hash(x, y, seed) * 0.5);
        continue;
      }
      const n = hash(x + frame, y, seed);
      p.data[y * 12 + x] = n > 0.75 ? 0x3a3a5a : n > 0.5 ? 0x14141e : 0x050508;
    }
  return p;
}

export function fogTile(frame: number, seed: number): Px {
  const p = blank(12, 12);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) p.data[y * 12 + x] = blend(0x50505a, 0xc0c0cc, hash(x + frame, y + frame, seed));
  return p;
}

/** Every named sprite, for validation and contact sheets. */
export function allArt(): Record<string, Px> {
  const out: Record<string, Px> = {};
  for (const [k, f] of Object.entries(CREATURES)) out[k] = f();
  for (const [k, f] of Object.entries(BOSS_ART)) out[`boss_${k}`] = f();
  for (const [k, f] of Object.entries(OBJECTS)) out[k] = f();
  out.villager = villager(0xc8b0d8);
  out.child = villager(0xf0e0a0, true);
  for (const k of ['weapon', 'bow', 'helm', 'chest', 'ring', 'amulet']) out[`i_${k}`] = itemArt(k, 0x7898ff);
  out.brazier_lit = brazierLit(0xd82a2a, 0);
  out.floor_flag = floorTile('flag', 0x4e443a, 1);
  out.floor_grass = floorTile('grass', 0x3e3c26, 2);
  out.floor_cobble = floorTile('cobble', 0x5a5a56, 3);
  out.wall = wallTile(0x8a7a66, 4);
  out.wall_cracked = wallTile(0x8a7a66, 5, true);
  out.water = waterTile(0, 6);
  out.chasm = chasmTile(7);
  out.mist = mistTile(0, 8, false);
  out.mist_solid = mistTile(0, 8, true);
  out.fog = fogTile(0, 9);
  return out;
}
