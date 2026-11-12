// Draws the game into the Screen buffer.
import { Game, levelCost, BLOCKING } from './game.ts';
import { Screen, scale, mix } from './term.ts';
import { T, TOOLS, type Obj, type Enemy, type Slot, type Floor } from './types.ts';
import { ENEMIES, BOSSES, BOSS_GLYPH, ELITE_MOD_NAMES, BIOMES } from './data.ts';
import { RARITY_COLORS, itemLines, itemGlyph, weaponBase, PATTERN_DESC, INV_MAX, salvageValue } from './loot.ts';
import { G } from './world.ts';
import { TOOL_INFO, NPCS, ENDING_INTRO, ENDINGS } from './story.ts';
import { PATHS, TALENT_BY_ID, canLearn, pathPoints, respecCost } from './talents.ts';
import { talentList, SKILL_KEYS } from './skills.ts';
import { hash2 } from './rng.ts';

const BG = 0x070606;
const SW = 30; // sidebar width
const LH = 6; // log height
const BORDER = 0x4a3a2c;
const DIM = 0x6a6458;
const TEXT = 0xc8c0b0;
const ACCENT = 0xd08a3a;

// overworld ground looks: [glyphs, fg, bg]
const GROUND: Record<number, [string, number, number]> = {
  [G.GRASS]: ['.,.\'.', 0x4e4c34, 0x0e0f0a],
  [G.ROAD]: ['.:..', 0x6e5c44, 0x17130d],
  [G.COBBLE]: ['·.·:', 0x6a6a66, 0x151514],
  [G.MOSS]: ['."\',', 0x3e5a2e, 0x0b1208],
  [G.STONE]: ['.·.,', 0x5a5a64, 0x101014],
  [G.SOIL]: ['.,.', 0x5c4636, 0x120c08],
  [G.ASH]: [',..`', 0x5a5856, 0x0c0c0c],
  [G.INSIDE]: ['..', 0x5a4a3a, 0x140f0b],
  [G.MUD]: [',.~', 0x4a3a2a, 0x0e0a06],
};

export function render(g: Game, s: Screen): void {
  s.clear(BG);
  if (s.w < 80 || s.h < 24) {
    s.text(1, 1, 'The Ashen Deep needs a larger window.', TEXT);
    s.text(1, 2, `Current ${s.w}x${s.h}, need at least 80x24 (120x34 is best).`, DIM);
    return;
  }
  if (g.mode === 'title') return drawTitle(g, s);
  if (g.mode === 'ending') return drawEnding(g, s);
  if (g.mode === 'help' && g.helpReturn === 'title') {
    drawTitle(g, s);
    return drawHelp(s);
  }
  drawGame(g, s);
  switch (g.mode) {
    case 'inv': drawInventory(g, s); break;
    case 'bonfire': drawBonfire(g, s); break;
    case 'travel': drawTravel(g, s); break;
    case 'read': drawRead(g, s); break;
    case 'map': drawMap(g, s); break;
    case 'help': drawHelp(s); break;
    case 'confirmQuit': drawConfirm(s); break;
    case 'dead': drawDeath(g, s); break;
    case 'dialog': drawDialog(g, s); break;
    case 'shop': drawShop(g, s); break;
    case 'journal': drawJournal(g, s); break;
    case 'talents': drawTalents(g, s); break;
  }
}

// ================================================================== world
function drawGame(g: Game, s: Screen): void {
  const VW = s.w - SW, VH = s.h - LH;
  drawWorld(g, s, VW, VH);
  drawSidebar(g, s, VW);
  drawLog(g, s, VW, VH);
  if (g.bossActive) drawBossBar(g, s, VW, VH);
  if (g.banner && g.mode === 'play') drawBanner(g, s, VW, VH);
}

function palette(f: Floor) {
  const b = BIOMES[f.biome];
  if (b) return { wall: b.wall, wallBg: b.wallBg, floor: b.floor, floorBg: b.floorBg, glyphs: b.floorGlyphs };
  return { wall: 0x6e6a66, wallBg: 0x1c1a19, floor: 0x4e4c34, floorBg: 0x0e0f0a, glyphs: '.,' };
}

function drawWorld(g: Game, s: Screen, VW: number, VH: number): void {
  const f = g.floor, p = g.player, pal = palette(f);
  const W = f.w, H = f.h;
  let camX = W <= VW ? -((VW - W) >> 1) : Math.max(0, Math.min(W - VW, p.x - (VW >> 1)));
  let camY = H <= VH ? -((VH - H) >> 1) : Math.max(0, Math.min(H - VH, p.y - (VH >> 1)));
  if (g.shake > 0) {
    camX += (g.tick * 7) % 3 - 1;
    camY += g.shake > 3 ? (g.tick * 5) % 3 - 1 : 0;
  }
  const N = W * H;
  const objG = new Int32Array(N).fill(-1);
  f.objects.forEach((o, i) => {
    const k = o.y * W + o.x;
    if (objG[k] < 0 || BLOCKING.has(o.kind) || (o.kind === 'deco' && o.block)) objG[k] = i;
  });
  const pickG = new Int32Array(N).fill(-1);
  f.pickups.forEach((pk, i) => (pickG[pk.y * W + pk.x] = i));
  const teleG = new Float32Array(N);
  const teleK = new Uint8Array(N);
  for (const t of g.teles) {
    const k = 1 - t.t / t.max;
    for (const v of t.tiles) {
      if (v.x < 0 || v.y < 0 || v.x >= W || v.y >= H) continue;
      const i = v.y * W + v.x;
      const val = t.t <= 3 ? 1.5 : 0.3 + 0.7 * k;
      if (val > teleG[i]) {
        teleG[i] = val;
        teleK[i] = t.kind === 'aim' ? 2 : t.kind === 'acid' ? 3 : t.kind === 'fire' ? 4 : 1;
      }
    }
  }
  const fieldG = new Uint8Array(N);
  for (const fl of g.fields) fieldG[fl.y * W + fl.x] = fl.kind === 'fire' ? 1 : 2;
  const enG = new Int32Array(N).fill(-1);
  g.enemies.forEach((e, i) => {
    if (e.size === 1) enG[e.y * W + e.x] = i;
  });
  const npcG = new Map<number, string>();
  for (const n of f.npcs) npcG.set(n.y * W + n.x, n.id);

  for (let sy = 0; sy < VH; sy++) {
    for (let sx = 0; sx < VW; sx++) {
      const mx = sx + camX, my = sy + camY;
      if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
      const i = my * W + mx;
      const lv = g.vis[i];
      if (lv <= 0 && !f.seen[i]) continue;
      const t = f.tiles[i];
      let [ch, fg, bg] = tileLook(g, f, t, pal, mx, my);
      const floorish = t === T.FLOOR || t === T.OPEN;
      if (lv <= 0) {
        const oi = objG[i];
        if (oi >= 0) {
          const o = f.objects[oi];
          if (['bonfire', 'chest', 'tablet', 'brazier', 'boulder', 'deco', 'grave', 'lamp'].includes(o.kind)) ch = objLook(o, g)[0];
        }
        const gray = mix(fg, 0x6070a0, 0.5);
        const wallish = t === T.WALL || t === T.TREE;
        s.put(sx, sy, ch, scale(gray, wallish ? 0.22 : 0.3), wallish ? 0x0b0b10 : t === T.CHASM ? 0x030304 : 0x060608);
        continue;
      }
      const lit = 0.25 + 0.75 * lv;
      fg = scale(fg, lit);
      bg = scale(bg, 0.35 + 0.65 * lv);
      const dc = f.decal[i];
      if (dc && floorish) {
        if (dc === 1) {
          bg = mix(bg, 0x4a0606, 0.6);
          fg = mix(fg, 0x7a1010, 0.6);
        } else if (dc === 2) {
          ch = '%';
          fg = scale(0x8a2a22, lit);
          bg = mix(bg, 0x3a0404, 0.5);
        } else if (dc === 3) {
          ch = ',';
          fg = scale(0xb0a890, lit);
        }
      }
      const fk = fieldG[i];
      if (fk === 1) {
        const fl = hash2(i, g.tick >> 1) & 3;
        ch = fl === 0 ? '^' : '≈';
        fg = [0xffb040, 0xff7020, 0xffd060, 0xff5010][fl];
        bg = 0x3a1000;
      } else if (fk === 2) {
        ch = '≈';
        fg = (g.tick + i) % 16 < 8 ? 0x90e040 : 0x60b030;
        bg = 0x0c2406;
      }
      const oi = objG[i];
      if (oi >= 0) {
        const look = objLook(f.objects[oi], g);
        ch = look[0];
        fg = look[2] ? look[1] : scale(look[1], Math.max(0.55, lit));
        if (look[3] !== undefined) bg = look[3];
      }
      const pi = pickG[i];
      if (pi >= 0) {
        const pk = f.pickups[pi];
        if (pk.kind === 'item' && pk.item) {
          ch = itemGlyph(pk.item);
          fg = RARITY_COLORS[pk.item.rarity];
          if (pk.item.rarity === 3) bg = (g.tick >> 3) % 2 ? 0x3a1a00 : 0x241000;
          else if (pk.item.rarity === 2) bg = 0x262000;
        } else if (pk.kind === 'key') {
          ch = '⌐';
          fg = 0xffd040;
          bg = 0x2a2000;
        } else if (pk.kind === 'tallow') {
          ch = '!';
          fg = 0xfff0b0;
          bg = 0x2a2410;
        } else if (pk.kind === 'lore') {
          ch = '¶';
          fg = 0xf0e0c0;
          bg = (g.tick >> 3) % 2 ? 0x2a2418 : 0x1a160e;
        } else if (pk.kind === 'quest') {
          ch = '◘';
          fg = 0xffe0a0;
          bg = (g.tick >> 3) % 2 ? 0x3a2a08 : 0x221808;
        } else if (pk.kind === 'tool' && pk.id) {
          const info = TOOL_INFO[pk.id as keyof typeof TOOL_INFO];
          ch = info.glyph;
          fg = info.color;
          bg = 0x2a2410;
        } else if (pk.kind === 'ashes') {
          if (pk.stain) {
            ch = '§';
            fg = (g.tick >> 2) % 2 ? 0xff3030 : 0xc01010;
            bg = 0x300000;
          } else {
            ch = '*';
            fg = 0xc8c0ff;
          }
        }
      }
      const tv = teleG[i];
      if (tv > 0) {
        const kind = teleK[i];
        const hot = kind === 3 ? 0x50c010 : kind === 4 ? 0xff6000 : 0xd01818;
        if (kind === 2) bg = mix(bg, 0x6a2020, 0.25 + 0.3 * Math.min(1, tv));
        else if (tv > 1) bg = g.tick & 1 ? 0xff4040 : mix(hot, 0xffffff, 0.3);
        else bg = mix(bg, hot, 0.25 + 0.55 * tv);
        if (ch === ' ') ch = '.';
      }
      const npc = npcG.get(i);
      if (npc) {
        const d = NPCS[npc];
        ch = d.glyph;
        fg = d.color;
        bg = mix(bg, 0x201810, 0.5);
      }
      const ei = enG[i];
      if (ei >= 0) {
        const look = enemyLook(g.enemies[ei], g);
        ch = look[0];
        fg = look[1];
        if (look[2] !== undefined) bg = look[2];
      }
      if (mx === p.x && my === p.y && g.mode !== 'dead') {
        ch = '@';
        fg = playerColor(g);
        if (p.act?.kind === 'parry' && p.act.t > 8) bg = 0x103040;
        else if (p.guard) bg = 0x3a2a10;
        else if (p.buffs.bone > 0) bg = 0x1a2a1a;
        else if (p.buffs.warcry > 0) bg = 0x3a1008;
      }
      s.put(sx, sy, ch, fg, bg);
    }
  }

  for (const pr of g.projs) {
    const x = Math.round(pr.x), y = Math.round(pr.y);
    if (x < 0 || y < 0 || x >= W || y >= H || g.vis[y * W + x] <= 0) continue;
    s.put(x - camX, y - camY, pr.glyph, pr.color);
  }
  for (const e of g.enemies) {
    if (e.size !== 3) continue;
    const B = BOSSES[e.boss!];
    if (g.vis[e.y * W + e.x] <= 0 && !g.bossActive) continue;
    let col = B.color;
    if (e.flash > 0) col = 0xffffff;
    else if (e.state === 'stagger') col = (g.tick >> 1) % 2 ? 0xffff80 : 0xc0c040;
    else if (e.state === 'windup') col = (g.tick >> 1) % 2 ? 0xff3030 : mix(B.color, 0xffffff, 0.3);
    const art = e.phase && e.boss === 'warden' ? ['\\X/', '-█-', '/ \\'] : B.art;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const ch = art[r][c];
        if (ch === ' ') continue;
        s.put(e.x - 1 + c - camX, e.y - 1 + r - camY, ch, col);
      }
  }
  for (const fx of g.fx) {
    const x = fx.x - camX, y = fx.y - camY;
    if (fx.ch.length === 1 && (fx.x < 0 || fx.y < 0 || fx.x >= W || fx.y >= H || g.vis[fx.y * W + fx.x] <= 0)) continue;
    const col = fx.t <= 2 ? scale(fx.color, 0.6) : fx.color;
    for (let k = 0; k < fx.ch.length; k++) {
      if (x + k >= VW) break;
      s.put(x + k, y, fx.ch[k], col);
    }
  }
  for (const e of g.enemies) {
    if (e.alertT > 0 && g.vis[e.y * W + e.x] > 0) s.put(e.x - camX, e.y - camY - 1, '!', 0xff4040);
  }
  if (g.player.guard && g.mode !== 'dead') {
    const fx = p.x + p.face.x - camX, fy = p.y + p.face.y - camY;
    if (!g.isOpaque(p.x + p.face.x, p.y + p.face.y)) s.put(fx, fy, p.face.x ? '|' : '─', 0xd0a868);
  }
}

function tileLook(g: Game, f: Floor, t: number, pal: ReturnType<typeof palette>, x: number, y: number): [string, number, number] {
  const h = hash2(x, y);
  const world = f.kind === 'world';
  const gr = world ? GROUND[f.ground[y * f.w + x]] ?? GROUND[0] : null;
  const tick = g.tick;
  switch (t) {
    case T.WALL: return world ? ['▓', 0x6e6a66, 0x1c1a19] : ['▓', pal.wall, pal.wallBg];
    case T.FLOOR: {
      if (gr) return [gr[0][h % gr[0].length], gr[1], gr[2]];
      const gl = pal.glyphs;
      return [h % 7 === 0 ? gl[h % gl.length] : '.', pal.floor, pal.floorBg];
    }
    case T.DOOR: return ['+', 0xb07a40, gr ? gr[2] : pal.floorBg];
    case T.OPEN: return ["'", 0xb07a40, gr ? gr[2] : pal.floorBg];
    case T.LOCKED: return ['+', 0xffc040, 0x3a2808];
    case T.CRACKED: return ['▒', mix(pal.wall, 0xffe0c0, 0.18), pal.wallBg];
    case T.STAIRS: return ['>', 0xf0f0ff, (tick >> 3) % 2 ? 0x24304a : 0x1a2438];
    case T.UPSTAIRS: return ['<', 0xf0f0ff, (tick >> 3) % 2 ? 0x24304a : 0x1a2438];
    case T.FOG: return [(tick + x + y) % 10 < 5 ? '░' : '▒', 0xd0d0e0, 0x303038];
    case T.RUBBLE: return ['#', 0xa08a6a, 0x221c14];
    case T.THORNS: return ['‡', 0x8a5a6a, 0x160a10];
    case T.CHASM: return ['░', 0x16161e, 0x050508];
    case T.PHANTOM:
      if (g.resonance > 0) return ['▒', g.resonance < 50 && (tick >> 2) % 2 ? 0x7070a0 : 0xc8c8ff, 0x22224a];
      return ['░', (tick + x + y) % 20 < 10 ? 0x3a3a5a : 0x2a2a44, 0x08080e];
    case T.WATER: return ['≈', (tick >> 3) % 2 === (x + y) % 2 ? 0x2a4a6a : 0x1e3a56, 0x08121c];
    case T.BROKEN: return [x % 2 ? '≠' : ' ', 0x6a4a2a, 0x08121c];
    case T.BRIDGE: return ['=', 0x9a7848, 0x1a120a];
    case T.TREE: {
      const gid = world ? f.ground[y * f.w + x] : -1;
      const col = gid === G.MOSS ? 0x3e6a2e : gid === G.STONE ? 0x6a6a6a : gid === G.SOIL ? 0x4a5a3a : 0x6a5a40;
      return [h % 3 ? '♣' : '♠', col, gr ? gr[2] : 0x0a0a08];
    }
    case T.FENCE: return ['┼', 0x6a6a74, gr ? gr[2] : 0x0a0a0a];
    case T.ENTRANCE: return ['▼', (tick >> 3) % 2 ? 0xffd8a0 : 0xd0a070, 0x301c10];
  }
  return [' ', 0, 0];
}

/** [glyph, fg, emissive, bg?] */
function objLook(o: Obj, g: Game): [string, number, boolean, number?] {
  switch (o.kind) {
    case 'bonfire': {
      const f = hash2(o.id, g.tick >> 1) % 4;
      return ['☼', [0xffa030, 0xff7020, 0xffd060, 0xff5020][f], true, 0x401808];
    }
    case 'lamp': {
      const f = hash2(o.id, g.tick >> 2) % 3;
      return ['¡', [0xffc060, 0xffa040, 0xffe080][f], true, 0x2a1808];
    }
    case 'chest': return o.open ? ['▫', 0x6a5030, false] : ['■', o.loot && o.loot !== 'normal' ? 0xffc840 : 0xc09048, false];
    case 'urn': return ['δ', 0xa88058, false];
    case 'brazier':
      if (o.lit) {
        const f = hash2(o.id, g.tick >> 1) % 3;
        return ['Ψ', mix(o.color!, 0xffffff, f * 0.2), true, scale(o.color!, 0.35)];
      }
      return ['Ψ', scale(o.color!, 0.75), false];
    case 'rune': return o.lit ? ['♦', 0x70f0ff, true, 0x0a2a34] : ['◊', 0x506878, false];
    case 'plate': return ['□', 0x9a9080, false];
    case 'boulder': {
      const onPlate = g.floor.puzzles[o.puzzle!].plates.some((p) => p.x === o.x && p.y === o.y);
      return onPlate ? ['◙', 0xe0d8a0, true] : ['●', 0xb0a898, false];
    }
    case 'tablet': return ['≡', 0xc0c0d8, false];
    case 'message': return ['?', 0xe8a050, true];
    case 'grave':
      if (o.name?.startsWith('WREN')) return ['†', 0xffe060, true, 0x2a2208];
      return o.dug ? ['∩', 0x6a5440, false] : ['†', 0x9a9a9a, false];
    case 'deco': return [o.glyph ?? '?', o.color ?? 0xffffff, false];
    case 'spikes': {
      const ph = (g.tick + (o.off ?? 0)) % 80;
      if (ph >= 66) return ['▲', 0xff3030, true, 0x400808];
      if (ph >= 56) return ['^', (g.tick >> 1) % 2 ? 0xffa040 : 0xc06020, true];
      return ['^', 0x6a6a6a, false];
    }
  }
  return ['?', 0xffffff, false];
}

/** [glyph, fg, bg?] */
function enemyLook(e: Enemy, g: Game): [string, number, number?] {
  if (e.ally) return ['z', e.flash > 0 ? 0xffffff : e.birthCd < 100 && (g.tick >> 2) % 2 ? 0x4a7a50 : 0x90e0a0, 0x0c1a0e];
  const d = ENEMIES[e.def];
  let col = d.color;
  let bg: number | undefined;
  if (e.elite) {
    col = mix(col, 0xffd040, 0.4);
    bg = 0x2a1c00;
  }
  if (e.state === 'idle' && !e.aware) col = scale(col, 0.7);
  if (e.state === 'windup') col = (g.tick >> 1) % 2 ? 0xff3030 : mix(col, 0xffffff, 0.4);
  if (e.state === 'stagger') col = 0xffff60;
  if (e.riposte > 0) bg = 0x404000;
  if (e.flash > 0) col = 0xffffff;
  return [d.glyph, col, bg];
}

function playerColor(g: Game): number {
  const p = g.player;
  if (p.flash > 0) return 0xff3030;
  if (p.act?.kind === 'roll') return 0x8a8a9a;
  if (p.act?.kind === 'parry') return 0x60e0ff;
  if (p.act?.kind === 'drink') return 0x60ff80;
  if (p.act?.kind === 'heavy') return 0xffe0a0;
  return 0xfff4e0;
}

// ================================================================== HUD
function bar(s: Screen, x: number, y: number, w: number, frac: number, col: number, back: number): void {
  frac = Math.max(0, Math.min(1, frac));
  const full = frac * w;
  for (let i = 0; i < w; i++) {
    const v = full - i;
    const c = v >= 1 ? '█' : v >= 0.5 ? '▌' : '░';
    s.put(x + i, y, c, v >= 0.5 ? col : back);
  }
}

function hline(s: Screen, x: number, y: number, w: number, col = BORDER): void {
  for (let i = 0; i < w; i++) s.put(x + i, y, '─', col);
}

function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > w) {
      if (line) out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

function drawSidebar(g: Game, s: Screen, x0: number): void {
  const p = g.player, st = g.stats;
  s.fill(x0, 0, SW, s.h, 0x0c0a09);
  for (let y = 0; y < s.h; y++) s.put(x0, y, '│', BORDER);
  const x = x0 + 2;
  const W = SW - 3;
  let y = 0;
  s.text(x, y++, g.locationName().slice(0, W), ACCENT);
  hline(s, x0 + 1, y++, SW - 1);
  s.text(x, y, 'HP ', 0xe06050);
  bar(s, x + 4, y, 14, p.hp / st.maxHp, 0xc03028, 0x3a1410);
  s.text(x + 19, y++, `${Math.max(0, Math.ceil(p.hp))}/${st.maxHp}`, TEXT);
  if (p.buffs.bone > 0) s.text(x + 4, y - 1, `+${p.buffs.bone}`.padEnd(5).slice(0, 5), 0xc0f0c0, 0x1a2a1a);
  s.text(x, y, 'ST ', 0x70c060);
  bar(s, x + 4, y, 14, p.sta / st.maxSta, p.staDelay > 0 && p.sta < 5 ? 0x707040 : 0x50a040, 0x14260f);
  s.text(x + 19, y++, `${Math.max(0, Math.floor(p.sta))}`, TEXT);
  s.text(x, y, 'FLASK ', 0xe0c070);
  for (let i = 0; i < p.maxFlasks; i++) s.put(x + 6 + i, y, i < p.flasks ? '♥' : '·', i < p.flasks ? 0xf0b040 : 0x5a4a30);
  y++;
  s.text(x, y, 'ASHES ', 0xb0a8ff);
  s.text(x + 6, y, String(p.ashes), 0xe0dcff);
  const cost = levelCost(p.level);
  s.text(x + 15, y, `LV ${p.level}`, p.ashes >= cost ? 0xffd060 : TEXT);
  if (p.talentPoints > 0) s.text(x + 21, y, `+${p.talentPoints}T`, (g.tick >> 4) % 2 ? 0xffe080 : 0xb09050);
  y++;
  s.text(x, y, 'TOOLS', DIM);
  TOOLS.forEach((t, i) => {
    const hasT = p.tools.includes(t);
    const sel = p.tool === i && hasT;
    const info = TOOL_INFO[t];
    s.text(x + 6 + i * 4, y, `${i + 1}`, sel ? 0xffffff : 0x4a4438, sel ? 0x3a2a18 : undefined);
    s.put(x + 7 + i * 4, y, hasT ? info.glyph : '·', hasT ? info.color : 0x3a362e, sel ? 0x3a2a18 : undefined);
  });
  y++;
  const status: [string, number][] = [];
  if (p.keys > 0) status.push([`⌐ Key${p.keys > 1 ? ` x${p.keys}` : ''}`, 0xffd040]);
  if (p.poison > 0) status.push(['Poisoned', 0x90e040]);
  if (p.burn > 0) status.push(['Burning', 0xff7020]);
  if (g.resonance > 0) status.push([`Bell ${Math.ceil(g.resonance / 20)}s`, 0xc8c8ff]);
  if (p.buffs.warcry > 0) status.push(['Warcry', 0xff9060]);
  if (p.guard) status.push(['Guard', 0xd0a868]);
  let sx = x;
  for (const [t, c] of status) {
    if (sx + t.length > x0 + SW - 1) break;
    sx += s.text(sx, y, t, c) + 1;
  }
  y++;
  hline(s, x0 + 1, y++, SW - 1);
  const obj = wrap(g.objective(), W).slice(0, 3);
  for (let k = 0; k < 3; k++) s.text(x, y++, obj[k] ?? '', k === 0 ? 0xd8c8a0 : 0xb0a488);
  hline(s, x0 + 1, y++, SW - 1);
  const w = p.eq.weapon;
  const b = weaponBase(w);
  s.text(x, y++, (w ? w.name : 'Bare Hands').slice(0, W), w ? RARITY_COLORS[w.rarity] : TEXT);
  s.text(x, y++, `${w ? w.dmgMin : b.dmg[0]}-${w ? w.dmgMax : b.dmg[1]} · ${PATTERN_DESC[b.pattern]} · AR ${st.armor}`.slice(0, W), 0xa8a090);
  hline(s, x0 + 1, y++, SW - 1);
  // skills
  for (let k = 0; k < 3; k++) {
    const id = p.slots[k];
    s.text(x, y, SKILL_KEYS[k], id ? ACCENT : 0x3a362e);
    if (id) {
      const t = TALENT_BY_ID[id];
      const col = PATHS.find((q) => q.id === t.path)!.color;
      const cd = p.cds[id] ?? 0;
      const ready = cd <= 0;
      s.text(x + 2, y, t.name.slice(0, 15), ready ? col : scale(col, 0.45));
      if (t.kind === 'toggle') s.text(x + 18, y, p.guard ? 'UP' : 'down', p.guard ? 0xffe080 : DIM);
      else if (!ready) s.text(x + 18, y, `${Math.ceil(cd / 20)}s`.padStart(4), DIM);
      else if (t.hp) s.text(x + 18, y, `-${Math.round(t.hp * 100)}%hp`, 0x904040);
    } else s.text(x + 2, y, '—', 0x3a362e);
    y++;
  }
  hline(s, x0 + 1, y++, SW - 1);
  const tg = g.target && !g.target.dead ? g.target : null;
  if (tg) {
    const tcol = tg.elite ? 0xffd040 : tg.boss ? BOSSES[tg.boss].color : ENEMIES[tg.def].color;
    s.put(x, y, tg.boss ? BOSS_GLYPH[tg.boss] : ENEMIES[tg.def].glyph, tcol);
    s.text(x + 2, y++, tg.name.slice(0, W - 2), tcol);
    bar(s, x, y++, SW - 4, tg.hp / tg.maxHp, 0xb02020, 0x301010);
    let info = '';
    if (tg.elite) info = tg.elite.mods.map((m) => ELITE_MOD_NAMES[m]).join(', ');
    if (tg.venom > 0) info = 'Poisoned';
    if (tg.state === 'stagger') info = 'STAGGERED';
    if (tg.riposte > 0) info = 'OPEN TO RIPOSTE';
    if (tg.state === 'idle' && !tg.aware) info = 'UNAWARE';
    if (tg.state === 'windup') info = 'WINDING UP!';
    s.text(x, y++, info.slice(0, W), tg.state === 'windup' ? 0xff4040 : 0xffd060);
  } else {
    s.text(x, y++, 'no target', 0x3a362e);
    y += 2;
  }
  hline(s, x0 + 1, y++, SW - 1);
  const near = g.nearbyDescription();
  for (let k = 0; k < 2; k++) s.text(x, y++, (near[k] ?? '').slice(0, W), 0xd0c8a8);
  hline(s, x0 + 1, y++, SW - 1);
  // what is that letter? every creature in view, by symbol
  s.text(x, y, 'IN SIGHT', DIM);
  const sight = g.inSight();
  let lx = x + 9, ly = y;
  if (!sight.length) s.text(lx, ly, 'nothing', 0x3a362e);
  for (const c of sight) {
    const label = `${c.name}${c.n > 1 ? ` x${c.n}` : ''}`;
    const len = label.length + 3;
    if (lx + len > x0 + SW) {
      if (ly >= y + 2) break;
      lx = x;
      ly++;
    }
    s.put(lx, ly, c.glyph, c.color);
    s.text(lx + 2, ly, label.slice(0, x0 + SW - lx - 3), scale(c.color, 0.8));
    lx += len;
  }
  y += 3;
  hline(s, x0 + 1, y++, SW - 1);
  const ctl: [string, string][] = [
    ['?', 'help & legend'], ['T', 'talents'], ['B', 'journal'], ['I', 'pack'], ['M', 'map'],
  ];
  let cx = x;
  for (const [k, v] of ctl) {
    const len = k.length + v.length + 2;
    if (cx + len > x0 + SW - 1) {
      cx = x;
      y++;
    }
    if (y >= s.h) break;
    s.text(cx, y, k, ACCENT);
    s.text(cx + k.length + 1, y, v, DIM);
    cx += len;
  }
}

function drawLog(g: Game, s: Screen, VW: number, VH: number): void {
  s.fill(0, VH, VW, LH, 0x0a0908);
  hline(s, 0, VH, VW);
  // wrap the most recent messages so long lore lines are readable
  const lines: [string, number, number][] = [];
  const msgs = g.msgs.slice(-8);
  msgs.forEach((m, k) => {
    const age = msgs.length - 1 - k;
    for (const ln of wrap(m.text, VW - 3)) lines.push([ln, m.color, age]);
  });
  const show = lines.slice(-(LH - 1));
  show.forEach(([t, c, age], k) => {
    const col = age === 0 ? c : scale(c, Math.max(0.35, 0.85 - age * 0.15));
    s.text(1, VH + 1 + k, t.slice(0, VW - 2), col);
  });
}

function drawBossBar(g: Game, s: Screen, VW: number, VH: number): void {
  const e = g.enemies.find((x) => x.boss);
  if (!e) return;
  const B = BOSSES[e.boss!];
  const w = Math.min(60, VW - 8);
  const x = (VW - w) >> 1;
  const y = VH - 3;
  s.text(x, y, B.name, B.color, 0x070606);
  if (e.state === 'stagger') s.text(x + w - 9, y, 'STAGGERED', 0xffff60, 0x070606);
  bar(s, x, y + 1, w, e.hp / e.maxHp, 0xb01818, 0x2a0808);
}

function drawBanner(g: Game, s: Screen, VW: number, VH: number): void {
  const b = g.banner!;
  const life = b.t / b.max;
  const a = life > 0.85 ? (1 - life) / 0.15 : life < 0.3 ? life / 0.3 : 1;
  const y = (VH >> 1) - 5;
  for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = 0; xx < VW; xx++) s.put(xx, yy, ' ', 0, mix(s.getBg(xx, yy), 0x000000, 0.75 * a));
  s.text(Math.max(0, (VW - b.text.length) >> 1), y, b.text, scale(b.color, a));
  if (b.sub) s.text(Math.max(0, (VW - b.sub.length) >> 1), y + 1, b.sub, scale(0xa09888, a));
}

// ================================================================== overlays
function box(s: Screen, x: number, y: number, w: number, h: number, title?: string, col = BORDER): void {
  s.fill(x, y, w, h, 0x0d0b0a);
  for (let i = 1; i < w - 1; i++) {
    s.put(x + i, y, '─', col);
    s.put(x + i, y + h - 1, '─', col);
  }
  for (let j = 1; j < h - 1; j++) {
    s.put(x, y + j, '│', col);
    s.put(x + w - 1, y + j, '│', col);
  }
  s.put(x, y, '┌', col);
  s.put(x + w - 1, y, '┐', col);
  s.put(x, y + h - 1, '└', col);
  s.put(x + w - 1, y + h - 1, '┘', col);
  if (title) s.text(x + 2, y, ` ${title} `, ACCENT);
}

const SLOT_NAMES: Record<Slot, string> = { weapon: 'Weapon', helm: 'Helm', chest: 'Armor', ring: 'Ring', amulet: 'Amulet' };

function drawInventory(g: Game, s: Screen): void {
  const p = g.player;
  const w = Math.min(s.w - 4, 100), h = s.h - 2;
  const x = (s.w - w) >> 1, y = 1;
  box(s, x, y, w, h, 'PACK & EQUIPMENT');
  const entries = g.invEntries();
  const lx = x + 2;
  const listW = 38;
  let row = y + 2;
  s.text(lx, row++, 'EQUIPPED', DIM);
  const listRows = h - 6;
  const bagRows = listRows - 8;
  const selBag = g.invSel - 5;
  const scroll = Math.max(0, Math.min(Math.max(0, p.inv.length - bagRows), selBag - bagRows + 1));
  entries.forEach((en, k) => {
    if ('eq' in en) {
      const it = p.eq[en.eq];
      const sel = k === g.invSel;
      s.text(lx, row, (sel ? '▶ ' : '  ') + SLOT_NAMES[en.eq].padEnd(7), sel ? 0xffffff : DIM, sel ? 0x2a2018 : undefined);
      s.text(lx + 9, row, (it ? it.name : '—').slice(0, listW - 9), it ? RARITY_COLORS[it.rarity] : DIM, sel ? 0x2a2018 : undefined);
      row++;
      if (k === 4) {
        row++;
        s.text(lx, row++, `PACK  ${p.inv.length}/${INV_MAX}`, DIM);
      }
    } else {
      const bi = en.bag;
      if (bi < scroll || bi >= scroll + bagRows) return;
      const it = p.inv[bi];
      const sel = k === g.invSel;
      s.text(lx, row, (sel ? '▶ ' : '  ') + itemGlyph(it) + ' ', sel ? 0xffffff : DIM, sel ? 0x2a2018 : undefined);
      const better = compareHint(it, p.eq[it.slot]);
      s.text(lx + 4, row, it.name.slice(0, listW - 7), RARITY_COLORS[it.rarity], sel ? 0x2a2018 : undefined);
      if (better) s.text(lx + listW - 2, row, better[0], better[1]);
      row++;
    }
  });
  if (!p.inv.length) s.text(lx + 2, row, '(empty)', DIM);
  const dx = x + listW + 4;
  const dw = w - listW - 6;
  for (let j = y + 1; j < y + h - 1; j++) s.put(dx - 2, j, '│', BORDER);
  const sel = entries[g.invSel];
  let dy = y + 2;
  if (sel) {
    const it = 'eq' in sel ? p.eq[sel.eq] : p.inv[sel.bag];
    if (it) {
      for (const [t, c] of itemLines(it)) for (const ln of wrap(t, dw)) s.text(dx, dy++, ln, c);
      if ('bag' in sel) {
        s.text(dx, dy++, `Salvage: ${salvageValue(it)} ashes`, 0x8a80c0);
        const cur = p.eq[it.slot];
        dy++;
        s.text(dx, dy++, 'CURRENTLY EQUIPPED', DIM);
        if (cur) for (const [t, c] of itemLines(cur)) for (const ln of wrap(t, dw)) s.text(dx, dy++, ln, scale(c, 0.75));
        else s.text(dx, dy++, 'Nothing', DIM);
      }
    } else s.text(dx, dy++, 'Empty slot.', DIM);
  }
  const help = sel && 'bag' in sel ? '[↑↓] select  [E/Enter] equip  [X] salvage  [I/Esc] close' : '[↑↓] select  [E/Enter] unequip  [I/Esc] close';
  s.text(x + 2, y + h - 2, help, ACCENT);
}

function compareHint(it: { slot: Slot; dmgMin: number; dmgMax: number; armor: number; rarity: number }, cur: typeof it | null): [string, number] | null {
  if (!cur) return ['+', 0x60e060];
  if (it.slot === 'weapon') {
    const a = it.dmgMin + it.dmgMax, b = cur.dmgMin + cur.dmgMax;
    if (a > b) return ['▲', 0x60e060];
    if (a < b) return ['▼', 0xe06060];
  } else if (it.armor || cur.armor) {
    if (it.armor > cur.armor) return ['▲', 0x60e060];
    if (it.armor < cur.armor) return ['▼', 0xe06060];
  }
  if (it.rarity > cur.rarity) return ['▲', 0x60e060];
  return null;
}

function drawBonfire(g: Game, s: Screen): void {
  const p = g.player, st = g.stats;
  const w = 62, h = 25;
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  box(s, x, y, w, h, 'BONFIRE', 0x8a5020);
  const fl = hash2(1, g.tick >> 1) % 3;
  s.text(x + 3, y + 2, '☼', [0xffa030, 0xff7020, 0xffd060][fl]);
  s.text(x + 5, y + 2, 'The flame is warm. It asks for ashes.', TEXT);
  const cost = levelCost(p.level);
  s.text(x + 3, y + 4, `Level ${p.level}    Ashes ${p.ashes}    Next level costs ${cost}`, p.ashes >= cost ? 0xffd060 : DIM);
  const opts: [string, string, string][] = [
    ['Vigor', `${p.vig}`, `Max HP ${st.maxHp}`],
    ['Endurance', `${p.end}`, `Max stamina ${st.maxSta}`],
    ['Strength', `${p.str}`, 'Axes, maces, swords'],
    ['Dexterity', `${p.dex}`, 'Daggers, spears, bows, scythes, crit'],
    ['Talents', p.talentPoints ? `+${p.talentPoints}` : '', 'Remember who you were'],
    ['Forget talents', '', `Unlearn everything for ${respecCost(p.level)} ashes`],
    ['Travel', '', 'Step into another flame you have rested at'],
    ['Leave', '', 'Return to the dark'],
  ];
  opts.forEach((o, k) => {
    const sel = k === g.bonSel;
    const yy = y + 6 + k * 2;
    s.text(x + 3, yy, sel ? '▶' : ' ', 0xffd060);
    s.text(x + 5, yy, o[0].padEnd(15), sel ? 0xffffff : TEXT, sel ? 0x2a1a10 : undefined);
    s.text(x + 20, yy, o[1].padStart(3), 0xffd080);
    s.text(x + 25, yy, o[2].slice(0, w - 27), DIM);
  });
  s.text(x + 3, y + h - 2, '[↑↓] choose  [E/Enter] select  [Esc] leave', ACCENT);
}

function drawTravel(g: Game, s: Screen): void {
  const t = g.travelTargets();
  const w = 56, h = Math.max(8, t.length + 6);
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  box(s, x, y, w, h, 'TRAVEL BY FLAME', 0x8a5020);
  t.forEach((d, k) => {
    const sel = k === g.travelSel;
    s.text(x + 3, y + 2 + k, `${sel ? '▶' : ' '} ☼ ${d.name}`.slice(0, w - 5), sel ? 0xffd080 : TEXT, sel ? 0x2a1a10 : undefined);
  });
  s.text(x + 3, y + h - 2, '[↑↓] choose  [E] go  [Esc] back', ACCENT);
}

function drawRead(g: Game, s: Screen): void {
  const m = g.modal;
  if (!m) return;
  const w = 66;
  const lines: [string, number][] = [];
  for (const ln of m.lines) {
    const col = ln.startsWith('[') ? ACCENT : ln.startsWith('(') ? DIM : 0xd8d0e0;
    if (!ln) lines.push(['', col]);
    for (const wl of wrap(ln, w - 6)) lines.push([wl, col]);
  }
  const h = lines.length + 5;
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  box(s, x, y, w, h, m.title, 0x6a6a8a);
  lines.forEach(([t, c], k) => s.text(x + 3, y + 2 + k, t, c));
  if (m.kind !== 'confirm') s.text(x + 3, y + h - 2, m.kind === 'soko' ? '[Esc] close   [R] reset stones' : '[Esc/E] close', DIM);
}

function drawDialog(g: Game, s: Screen): void {
  const d = g.dialog;
  if (!d) return;
  const VW = s.w - SW, VH = s.h - LH;
  const w = Math.min(VW - 4, 84);
  const text = d.lines[d.page];
  const narration = text.startsWith('*');
  const body = wrap(narration ? text.replace(/^\*|\*$/g, '') : `"${text}"`, w - 6);
  const h = body.length + 6;
  const x = (VW - w) >> 1, y = VH - h - 1;
  box(s, x, y, w, h, undefined, mix(d.npc.color, 0x000000, 0.5));
  s.text(x + 3, y + 1, d.npc.glyph, d.npc.color);
  s.text(x + 5, y + 1, d.npc.name, d.npc.color);
  s.text(x + 6 + d.npc.name.length, y + 1, `· ${d.npc.title}`, DIM);
  body.forEach((ln, k) => s.text(x + 3, y + 3 + k, ln, narration ? 0x9a9488 : 0xe8e0d0));
  const more = d.page < d.lines.length - 1;
  s.text(x + 3, y + h - 2, more ? `[E] continue  (${d.page + 1}/${d.lines.length})` : d.shop ? '[E] browse wares' : '[E] leave', ACCENT);
}

function drawShop(g: Game, s: Screen): void {
  const e = g.shopEntries();
  const w = Math.min(s.w - SW - 4, 88), h = Math.min(s.h - LH - 2, 22);
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  const npc = NPCS[g.shopId];
  box(s, x, y, w, h, `${npc.name.toUpperCase()}'S WARES`, mix(npc.color, 0x000000, 0.4));
  s.text(x + w - 22, y + 1, `Ashes ${g.player.ashes}`, 0xb0a8ff);
  const listW = 40;
  e.forEach((en, k) => {
    const sel = k === g.shopSel;
    const yy = y + 3 + k;
    s.text(x + 2, yy, `${sel ? '▶' : ' '} ${en.name}`.slice(0, listW - 8), en.soldOut ? 0x4a4438 : en.color, sel ? 0x2a2018 : undefined);
    s.text(x + listW - 6, yy, en.soldOut ? 'sold' : String(en.price).padStart(6), en.soldOut ? 0x4a4438 : g.player.ashes >= en.price ? 0xd0c8ff : 0x7a5050);
  });
  for (let j = y + 1; j < y + h - 1; j++) s.put(x + listW + 1, j, '│', BORDER);
  const sel = e[g.shopSel];
  let dy = y + 3;
  const dx = x + listW + 3, dw = w - listW - 5;
  if (sel) {
    const lines: [string, number][] = sel.item ? itemLines(sel.item) : [[sel.name, sel.color], ...sel.desc.map((t): [string, number] => [t, 0xa8a090])];
    for (const [t, c] of lines) for (const ln of wrap(t, dw)) if (dy < y + h - 2) s.text(dx, dy++, ln, c);
  }
  s.text(x + 2, y + h - 2, '[↑↓] browse  [E] buy  [Esc] leave', ACCENT);
}

function drawJournal(g: Game, s: Screen): void {
  const w = Math.min(s.w - 4, 104), h = s.h - 2;
  const x = (s.w - w) >> 1, y = 1;
  box(s, x, y, w, h, 'JOURNAL', 0x8a7a5a);
  const tabs = ['QUESTS', 'WHAT YOU HAVE LEARNED', 'BESTIARY', 'TOOLS & KEEPSAKES'];
  let tx = x + 3;
  tabs.forEach((t, i) => {
    const sel = i === g.journalTab;
    tx += s.text(tx, y + 1, ` ${t} `, sel ? 0x0d0b0a : DIM, sel ? 0xd0b080 : undefined) + 2;
  });
  const entries = g.journalEntries();
  const listW = 38;
  for (let j = y + 3; j < y + h - 1; j++) s.put(x + listW + 1, j, '│', BORDER);
  if (!entries.length) s.text(x + 3, y + 4, g.journalTab === 1 ? 'Nothing yet. The dead keep their secrets close.' : g.journalTab === 2 ? 'You have not met anything yet. You will.' : 'Nothing.', DIM);
  if (g.journalTab === 2) s.text(x + w - 22, y + 1, `${entries.filter((e) => !e.unknown).length} of 17 known`, DIM);
  let row = y + 4;
  let lastGroup = '';
  entries.forEach((en, k) => {
    if (en.group && en.group !== lastGroup) {
      if (lastGroup) row++;
      lastGroup = en.group;
      if (row < y + h - 3) s.text(x + 3, row++, en.group, 0x8a7a5a);
    }
    if (row >= y + h - 3) return;
    const sel = k === g.journalSel;
    s.text(x + 2, row, sel ? '▶' : ' ', en.color, sel ? 0x2a2018 : undefined);
    if (en.glyph) {
      s.put(x + 4, row, en.glyph, en.color);
      s.text(x + 6, row, en.title.slice(0, listW - 7), en.color, sel ? 0x2a2018 : undefined);
    } else s.text(x + 4, row, en.title.slice(0, listW - 5), en.color, sel ? 0x2a2018 : undefined);
    row++;
  });
  const sel = entries[g.journalSel];
  if (sel) {
    let dy = y + 4;
    const dw = w - listW - 6;
    if (sel.glyph) {
      s.put(x + listW + 3, dy, sel.glyph, sel.color, 0x1a1612);
      s.text(x + listW + 5, dy++, sel.title.slice(0, dw - 2), sel.color);
    } else s.text(x + listW + 3, dy++, sel.title.slice(0, dw), sel.color);
    dy++;
    for (const para of sel.text.split('  ')) {
      const move = para.startsWith('•');
      for (const ln of wrap(para, dw)) if (dy < y + h - 2) s.text(x + listW + 3, dy++, ln, move ? 0xc8b890 : para.startsWith('Killed') || para.startsWith('Destroyed') || para.startsWith('Still') ? DIM : 0xd8d0c0);
      if (g.journalTab === 2 && dy < y + h - 2) dy++;
    }
  }
  s.text(x + 2, y + h - 2, '[←→] section  [↑↓] select  [B/Esc] close', ACCENT);
}

function drawMap(g: Game, s: Screen): void {
  const f = g.floor;
  const sx = Math.max(1, Math.ceil(f.w / (s.w - 4)));
  const sy = Math.max(1, Math.ceil(f.h / ((s.h - 5) * 2)));
  const mw = Math.ceil(f.w / sx), mh = Math.ceil(f.h / (2 * sy));
  const w = mw + 4, h = mh + 4;
  const x = Math.max(0, (s.w - w) >> 1), y = Math.max(0, (s.h - h) >> 1);
  box(s, x, y, w, h, `MAP · ${g.locationName()}`);
  const entr = new Set(f.entrances.map((e) => e.y * f.w + e.x));
  const col = (mx: number, my: number): number => {
    if (my >= f.h || mx >= f.w) return 0x0d0b0a;
    // any player/landmark inside this sample block wins
    for (let yy = my; yy < Math.min(f.h, my + sy); yy++)
      for (let xx = mx; xx < Math.min(f.w, mx + sx); xx++) {
        if (xx === g.player.x && yy === g.player.y) return (g.tick >> 2) % 2 ? 0xffffff : 0xff4040;
        const i = yy * f.w + xx;
        if (!f.seen[i]) continue;
        if (entr.has(i)) return 0xff9040;
        const o = f.objects.find((ob) => ob.x === xx && ob.y === yy && (ob.kind === 'bonfire' || (ob.kind === 'chest' && !ob.open)));
        if (o) return o.kind === 'bonfire' ? 0xff8020 : 0xffc040;
        if (f.npcs.some((n) => n.x === xx && n.y === yy)) return 0x80ff80;
      }
    const i = my * f.w + mx;
    if (!f.seen[i]) return 0x0d0b0a;
    const t = f.tiles[i];
    if (t === T.WALL || t === T.TREE) return t === T.TREE ? 0x2a3a22 : 0x3a342c;
    if (t === T.STAIRS || t === T.UPSTAIRS) return 0x80c0ff;
    if (t === T.LOCKED) return 0xffd040;
    if (t === T.DOOR || t === T.OPEN) return 0x8a5a30;
    if (t === T.FOG) return 0xc0c0d0;
    if (t === T.WATER) return 0x1e3a56;
    if (t === T.CHASM) return 0x050508;
    if (t === T.PHANTOM) return 0x30305a;
    if (t === T.RUBBLE || t === T.THORNS) return 0xa06040;
    if (t === T.BROKEN) return 0x5a3a20;
    if (t === T.FENCE) return 0x5a5a62;
    if (f.kind === 'world') return scale(GROUND[f.ground[i]]?.[1] ?? 0x4a4a32, 1.1);
    return f.roomAt[i] >= 0 ? 0x6a5e50 : 0x50483e;
  };
  for (let my = 0; my < mh; my++)
    for (let mx = 0; mx < mw; mx++) s.put(x + 2 + mx, y + 2 + my, '▀', col(mx * sx, my * 2 * sy), col(mx * sx, (my * 2 + 1) * sy));
  s.text(x + 2, y + h - 1, ' any key to close ', DIM);
}

const LEGEND: [string, number, string][] = [
  ['@', 0xfff4e0, 'you'], ['☻', 0xc8b0d8, 'townsfolk'], ['z', 0x90e0a0, 'your thrall'], ['!', 0xff4040, 'it saw you'],
  ['☼', 0xffa030, 'bonfire'], ['¡', 0xffc060, 'lamp'], ['■', 0xc09048, 'chest'], ['δ', 0xa88058, 'urn (break it)'],
  ['†', 0x9a9a9a, 'grave (dig it)'], ['≡', 0xc0c0d8, 'inscription'], ['?', 0xe8a050, 'blood message'], ['^', 0xff3030, 'spike trap'],
  ['Ψ', 0xd82a2a, 'brazier'], ['◊', 0x70f0ff, 'rune stone'], ['●', 0xb0a898, 'puzzle stone'], ['□', 0x9a9080, 'stone scale'],
  ['+', 0xb07a40, 'door'], ['+', 0xffc040, 'locked door'], ['▒', 0xa09080, 'cracked wall'], ['#', 0xa08a6a, 'rubble (spade)'],
  ['‡', 0x8a5a6a, 'thorns (lantern)'], ['░', 0x3a3a5a, 'gap / mist'], ['≈', 0x2a4a6a, 'water'], ['♣', 0x6a5a40, 'tree'],
  ['>', 0xf0f0ff, 'stairs down'], ['<', 0xf0f0ff, 'way out'], ['▼', 0xffd8a0, 'dungeon'], ['§', 0xff3030, 'your bloodstain'],
  ['/', 0x7898ff, 'weapon'], [')', 0x7898ff, 'bow'], ['[', 0x7898ff, 'armor'], ['=', 0x7898ff, 'ring'],
  ['¶', 0xf0e0c0, 'lore page'], ['◘', 0xffe0a0, 'quest item'], ['⌐', 0xffd040, 'crypt key'], ['!', 0xfff0b0, 'sacred tallow'],
];

function drawHelp(s: Screen): void {
  const lines: [string, number][] = [
    ['MOVE   WASD / arrows      ATTACK J or X      HEAVY K or C      ROLL Space', TEXT],
    ['PARRY  Q or L             FLASK  F           USE / TALK  E', TEXT],
    ['TOOL   R  (pick 1-4)      SKILLS U O P       TALENTS T    PACK I', TEXT],
    ['JOURNAL B (quests, lore, bestiary)           MAP M        SOUND N', TEXT],
    ['', TEXT],
    ['• Red tiles are incoming attacks. Get out, roll through, or parry.', 0xff7060],
    ['• Dim enemies have not noticed you: 2.5x BACKSTAB. Letters are creatures;', 0xd0c8a8],
    ['  the sidebar\'s IN SIGHT names them, the Bestiary explains them.', 0xd0c8a8],
    ['• Dying drops your ashes as a bloodstain. Resting raises the dead again.', 0xffa040],
  ];
  const w = 84, h = lines.length + Math.ceil(LEGEND.length / 4) + 7;
  const x = Math.max(0, (s.w - w) >> 1), y = Math.max(0, (s.h - h) >> 1);
  box(s, x, y, w, h, 'HOW TO SURVIVE (YOU WILL NOT)');
  lines.forEach(([t, c], k) => s.text(x + 3, y + 2 + k, t, c));
  const ly = y + 3 + lines.length;
  s.text(x + 3, ly, 'WHAT YOU ARE LOOKING AT', ACCENT);
  LEGEND.forEach(([g, c, label], i) => {
    const col = i % 4, row = (i / 4) | 0;
    const lx = x + 3 + col * 20;
    s.put(lx, ly + 2 + row, g, c, 0x1a1612);
    s.text(lx + 2, ly + 2 + row, label.slice(0, 17), 0xa8a090);
  });
  s.text(x + 3, y + h - 1, ' any key to close ', DIM);
}

function drawConfirm(s: Screen): void {
  const w = 46, h = 6;
  const x = (s.w - SW - w) >> 1, y = (s.h - LH - h) >> 1;
  box(s, x, y, w, h, 'LEAVE THE PALE?');
  s.text(x + 3, y + 2, 'Progress is saved at bonfires and doorways.', TEXT);
  s.text(x + 3, y + 3, '[Y] quit to title     [N] keep suffering', ACCENT);
}

function drawDeath(g: Game, s: Screen): void {
  const VW = s.w - SW, VH = s.h - LH;
  const a = Math.min(1, g.deadT / 30);
  for (let yy = 0; yy < VH; yy++) for (let xx = 0; xx < VW; xx++) s.put(xx, yy, s.ch[yy * s.w + xx], scale(s.fg[yy * s.w + xx], 1 - 0.7 * a), mix(s.getBg(xx, yy), 0x000000, 0.7 * a));
  const y = (VH >> 1) - 2;
  for (let xx = 0; xx < VW; xx++) for (let yy = y - 1; yy <= y + 3; yy++) s.put(xx, yy, ' ', 0, mix(0x000000, 0x1a0000, a));
  const t = 'T H O U   A R T   F A L L E N';
  s.text((VW - t.length) >> 1, y, t, scale(0xc01818, a));
  s.text((VW - g.deathLine.length) >> 1, y + 2, g.deathLine, scale(0x8a7a70, a));
  if (g.deadT > 45) s.text((VW - 22) >> 1, y + 4, '[any key] rise again', 0x5a504a);
}

function drawEnding(g: Game, s: Screen): void {
  for (const e of g.embers) s.put(Math.floor(e.x * s.w), Math.floor(e.y * s.h), '·', scale(0x8a6040, Math.min(1, e.y + 0.1)));
  const w = Math.min(76, s.w - 4);
  const x = (s.w - w) >> 1;
  let y = 3;
  if (g.endingStep === 0) {
    for (const l of ENDING_INTRO) for (const ln of wrap(l, w)) s.text(x, y++, ln, 0xd8d0c0);
    y += 2;
    s.text(x, y++, '[1]  Take the crown.', 0xb080f0);
    y++;
    s.text(x, y++, '[2]  Bury her.', 0xffe060);
    return;
  }
  const e = ENDINGS[g.endingChoice];
  if (g.endingStep === 1) {
    for (const l of e.lines) {
      for (const ln of wrap(l, w)) s.text(x, y++, ln, 0xd8d0c0);
      y++;
    }
    y++;
    s.text(x + ((w - e.title.length * 2) >> 1), y + 1, e.title.split('').join(' '), g.endingChoice === 'crown' ? 0xb080f0 : 0xffe060);
    s.text(x, s.h - 3, '[Enter]', DIM);
    return;
  }
  const stats = [
    'T H E   A S H E N   D E E P',
    '',
    `Deaths: ${g.deaths}      Kills: ${g.kills}      Level: ${g.player.level}`,
    `Truths uncovered: ${g.lore.length} of 13`,
    '',
    'Thank you for playing.',
  ];
  stats.forEach((l, k) => s.text((s.w - l.length) >> 1, 8 + k, l, k === 0 ? 0xd08a3a : TEXT));
  s.text((s.w - 7) >> 1, s.h - 3, '[Enter]', DIM);
}

// ================================================================== title
const FONT: Record<string, string[]> = {
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  H: ['█   █', '█   █', '█████', '█   █', '█   █'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  P: ['████ ', '█   █', '████ ', '█    ', '█    '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

function drawTitle(g: Game, s: Screen): void {
  for (const e of g.embers) {
    const x = Math.floor(e.x * s.w), y = Math.floor(e.y * s.h);
    const c = mix(0xff4010, 0xffc040, e.c);
    s.put(x, y, e.c > 0.7 ? '*' : '·', scale(c, Math.min(1, e.y + 0.2)));
  }
  const word = 'ASHEN DEEP';
  const tw = [...word].map((c) => FONT[c][0].length + 1).reduce((a, b) => a + b, 0);
  const y0 = Math.max(1, (s.h >> 1) - 10);
  s.text((s.w - 3) >> 1, y0, 'THE', 0x8a7a66);
  let x = (s.w - tw) >> 1;
  const rowCol = [0xf0e8d8, 0xe0c8a0, 0xd8a060, 0xc86830, 0xa83020];
  for (const c of word) {
    const gl = FONT[c];
    for (let r = 0; r < 5; r++)
      for (let k = 0; k < gl[r].length; k++) if (gl[r][k] !== ' ') s.put(x + k, y0 + 2 + r, '█', rowCol[r], 0x070606);
    x += gl[0].length + 1;
  }
  const sub = 'the dead will not stay buried, and neither will you';
  s.text((s.w - sub.length) >> 1, y0 + 8, sub, 0x7a6e60);
  const opts = g.titleOptions();
  opts.forEach((o, k) => {
    const sel = k === g.titleSel;
    const t = sel ? `▶  ${o}  ◀` : o;
    s.text((s.w - t.length) >> 1, y0 + 11 + k * 2, t, sel ? 0xffd080 : 0x8a8070);
  });
  const foot = '↑↓ choose · Enter select · best in a 120x34+ terminal';
  s.text((s.w - foot.length) >> 1, s.h - 2, foot, 0x4a4238);
}

// ================================================================== talents
function drawTalents(g: Game, s: Screen): void {
  const p = g.player;
  const w = Math.min(s.w - 2, 118), h = s.h - 2;
  const x = (s.w - w) >> 1, y = 1;
  box(s, x, y, w, h, 'WHAT THE PIT LET YOU REMEMBER', 0x8a7a5a);
  s.text(x + w - 24, y, ` Talent points: ${p.talentPoints} `, p.talentPoints ? 0xffe080 : DIM);
  const cols = talentList();
  const cw = Math.floor((w - 4) / 4);
  cols.forEach((col, ci) => {
    const path = PATHS[ci];
    const cx = x + 2 + ci * cw;
    const spent = pathPoints(p.talents, path.id);
    s.text(cx, y + 2, path.name.slice(0, cw - 1), ci === g.talentCol ? path.color : scale(path.color, 0.6));
    s.text(cx, y + 3, `${spent} point${spent === 1 ? '' : 's'} spent`, DIM);
    col.forEach((t, ri) => {
      const yy = y + 5 + ri * 2 + (t.tier - 1);
      const owned = p.talents.includes(t.id);
      const why = canLearn(p.talents, p.talentPoints, t);
      const sel = ci === g.talentCol && ri === g.talentRow;
      const col2 = owned ? path.color : why && why.startsWith('Needs 2') || why?.startsWith('Needs 4') ? 0x3a362e : 0x8a8478;
      const mark = owned ? '■' : why ? '□' : '◊';
      s.text(cx, yy, `${mark} ${t.name}`.slice(0, cw - 2), sel ? 0xffffff : col2, sel ? 0x2a2018 : undefined);
      const tag = t.kind === 'passive' ? 'passive' : t.kind === 'toggle' ? 'toggle' : 'active';
      s.text(cx + 2, yy + 1, `${tag}${t.cost > 1 ? ' · 2 pts' : ''}${owned && p.slots.includes(t.id) ? ` · [${SKILL_KEYS[p.slots.indexOf(t.id)]}]` : ''}`.slice(0, cw - 3), owned ? scale(path.color, 0.6) : 0x4a4438);
    });
    if (ci > 0) for (let j = y + 2; j < y + 22; j++) s.put(cx - 2, j, '│', 0x2a241c);
  });
  // tier markers
  s.text(x + w - 9, y + 5, 'TIER I', 0x4a4438);
  s.text(x + w - 10, y + 10, 'TIER II', 0x4a4438);
  s.text(x + w - 11, y + 15, 'TIER III', 0x4a4438);
  // detail pane
  const t = cols[g.talentCol][g.talentRow];
  const path = PATHS[g.talentCol];
  const dy0 = y + 23;
  hline(s, x + 1, dy0 - 1, w - 2);
  s.text(x + 3, dy0, t.name, path.color);
  const costs: string[] = [];
  if (t.sta) costs.push(`${t.sta} stamina`);
  if (t.hp) costs.push(`${Math.round(t.hp * 100)}% of your health`);
  if (t.cd) costs.push(`${(t.cd / 20).toFixed(t.cd % 20 ? 1 : 0)}s cooldown`);
  s.text(x + 5 + t.name.length, dy0, costs.join(' · '), DIM);
  let dy = dy0 + 1;
  for (const ln of wrap(t.desc, w - 8)) s.text(x + 3, dy++, ln, 0xd8d0c0);
  for (const ln of wrap(t.flavor, w - 8)) s.text(x + 3, dy++, ln, 0x8a7a6a);
  if (dy < y + h - 3) for (const ln of wrap(path.blurb, w - 8).slice(0, Math.max(0, y + h - 3 - dy))) s.text(x + 3, dy++, ln, scale(path.color, 0.55));
  const why = canLearn(p.talents, p.talentPoints, t);
  const foot = p.talents.includes(t.id)
    ? t.kind === 'passive' ? 'Learned.' : '[1] [2] [3] bind to U / O / P'
    : why ?? '[E/Enter] learn';
  s.text(x + 3, y + h - 2, `[←→↑↓] browse   ${foot}   [T/Esc] close`, ACCENT);
}
