// Draws the game into the Screen buffer.
import { Game, levelCost, BLOCKING } from './game.ts';
import { Screen, scale, mix } from './term.ts';
import { T, SLOTS, type Obj, type Enemy, type Slot } from './types.ts';
import { ENEMIES, BOSSES, ELITE_MOD_NAMES } from './data.ts';
import { RARITY_COLORS, itemLines, itemGlyph, weaponBase, PATTERN_DESC, INV_MAX, salvageValue } from './loot.ts';
import { MAP_W, MAP_H } from './dungeon.ts';
import { hash2 } from './rng.ts';

const BG = 0x070606;
const SW = 30; // sidebar width
const LH = 6; // log height
const BORDER = 0x4a3a2c;
const DIM = 0x6a6458;
const TEXT = 0xc8c0b0;
const ACCENT = 0xd08a3a;

const PAL = [
  { wall: 0x8a7a66, wallBg: 0x2a221c, floor: 0x4e443a, floorBg: 0x15110e },
  { wall: 0x62866e, wallBg: 0x16221c, floor: 0x3a4c42, floorBg: 0x0b120e },
  { wall: 0x84629a, wallBg: 0x201628, floor: 0x46384e, floorBg: 0x100b14 },
];

export function render(g: Game, s: Screen): void {
  s.clear(BG);
  if (s.w < 80 || s.h < 24) {
    s.text(1, 1, 'The Ashen Deep needs a larger window.', TEXT);
    s.text(1, 2, `Current ${s.w}x${s.h}, need at least 80x24 (120x34 is best).`, DIM);
    return;
  }
  if (g.mode === 'title') return drawTitle(g, s);
  if (g.mode === 'help' && g.helpReturn === 'title') {
    drawTitle(g, s);
    return drawHelp(s);
  }
  drawGame(g, s);
  switch (g.mode) {
    case 'inv': drawInventory(g, s); break;
    case 'bonfire': drawBonfire(g, s); break;
    case 'read': drawRead(g, s); break;
    case 'map': drawMap(g, s); break;
    case 'help': drawHelp(s); break;
    case 'victory': drawVictory(g, s); break;
    case 'confirmQuit': drawConfirm(s); break;
    case 'dead': drawDeath(g, s); break;
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

function drawWorld(g: Game, s: Screen, VW: number, VH: number): void {
  const f = g.floor, p = g.player, pal = PAL[f.act];
  const W = MAP_W;
  let camX = MAP_W <= VW ? -((VW - MAP_W) >> 1) : Math.max(0, Math.min(MAP_W - VW, p.x - (VW >> 1)));
  let camY = MAP_H <= VH ? -((VH - MAP_H) >> 1) : Math.max(0, Math.min(MAP_H - VH, p.y - (VH >> 1)));
  if (g.shake > 0) {
    camX += (g.tick * 7) % 3 - 1;
    camY += g.shake > 3 ? (g.tick * 5) % 3 - 1 : 0;
  }
  const N = MAP_W * MAP_H;
  const objG = new Int32Array(N).fill(-1);
  f.objects.forEach((o, i) => {
    const k = o.y * W + o.x;
    // blocking objects win over floor objects on the same tile
    if (objG[k] < 0 || BLOCKING.has(o.kind)) objG[k] = i;
  });
  const pickG = new Int32Array(N).fill(-1);
  f.pickups.forEach((pk, i) => (pickG[pk.y * W + pk.x] = i));
  const teleG = new Float32Array(N);
  const teleK = new Uint8Array(N);
  for (const t of g.teles) {
    const k = 1 - t.t / t.max;
    for (const v of t.tiles) {
      if (v.x < 0 || v.y < 0 || v.x >= W || v.y >= MAP_H) continue;
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

  for (let sy = 0; sy < VH; sy++) {
    for (let sx = 0; sx < VW; sx++) {
      const mx = sx + camX, my = sy + camY;
      if (mx < 0 || my < 0 || mx >= W || my >= MAP_H) continue;
      const i = my * W + mx;
      const lv = g.vis[i];
      if (lv <= 0 && !f.seen[i]) continue;
      const t = f.tiles[i];
      let [ch, fg, bg] = tileLook(t, pal, g.tick, mx, my);
      const floorish = t === T.FLOOR || t === T.OPEN;
      if (lv <= 0) {
        // remembered
        const oi = objG[i];
        if (oi >= 0) {
          const o = f.objects[oi];
          if (o.kind === 'bonfire' || o.kind === 'chest' || o.kind === 'tablet' || o.kind === 'brazier' || o.kind === 'boulder') {
            const look = objLook(o, g);
            ch = look[0];
          }
        }
        const gray = mix(fg, 0x6070a0, 0.5);
        s.put(sx, sy, ch, scale(gray, t === T.WALL ? 0.22 : 0.3), t === T.WALL ? 0x0b0b10 : 0x060608);
        continue;
      }
      // lighting on base tile
      const lit = 0.25 + 0.75 * lv;
      fg = scale(fg, lit);
      bg = scale(bg, 0.35 + 0.65 * lv);
      // decals
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
      // fields
      const fk = fieldG[i];
      if (fk === 1) {
        const fl = (hash2(i, g.tick >> 1) & 3);
        ch = fl === 0 ? '^' : '≈';
        fg = [0xffb040, 0xff7020, 0xffd060, 0xff5010][fl];
        bg = 0x3a1000;
      } else if (fk === 2) {
        ch = '≈';
        fg = (g.tick + i) % 16 < 8 ? 0x90e040 : 0x60b030;
        bg = 0x0c2406;
      }
      // objects
      const oi = objG[i];
      if (oi >= 0) {
        const look = objLook(f.objects[oi], g);
        ch = look[0];
        fg = look[2] ? look[1] : scale(look[1], Math.max(0.55, lit));
        if (look[3] !== undefined) bg = look[3];
      }
      // pickups
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
      // telegraphs
      const tv = teleG[i];
      if (tv > 0) {
        const kind = teleK[i];
        const hot = kind === 3 ? 0x50c010 : kind === 4 ? 0xff6000 : 0xd01818;
        if (kind === 2) bg = mix(bg, 0x6a2020, 0.25 + 0.3 * Math.min(1, tv));
        else if (tv > 1) bg = (g.tick & 1) ? 0xff4040 : mix(hot, 0xffffff, 0.3);
        else bg = mix(bg, hot, 0.25 + 0.55 * tv);
        if (ch === '.' || ch === ' ') ch = kind === 2 ? '·' : '.';
      }
      // enemies (single tile)
      const ei = enG[i];
      if (ei >= 0) {
        const e = g.enemies[ei];
        const look = enemyLook(e, g);
        ch = look[0];
        fg = look[1];
        if (look[2] !== undefined) bg = look[2];
      }
      if (mx === p.x && my === p.y && g.mode !== 'dead') {
        ch = '@';
        fg = playerColor(g);
        if (p.act?.kind === 'parry' && p.act.t > 8) bg = 0x103040;
      }
      s.put(sx, sy, ch, fg, bg);
    }
  }

  // projectiles
  for (const pr of g.projs) {
    const x = Math.round(pr.x), y = Math.round(pr.y);
    if (g.vis[y * W + x] <= 0) continue;
    s.put(x - camX, y - camY, pr.glyph, pr.color);
  }
  // bosses
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
        const x = e.x - 1 + c - camX, y = e.y - 1 + r - camY;
        if (ch === ' ') continue;
        s.put(x, y, ch, col);
      }
  }
  // fx
  for (const fx of g.fx) {
    const x = fx.x - camX, y = fx.y - camY;
    if (fx.ch.length === 1 && (fx.x < 0 || fx.y < 0 || fx.x >= W || fx.y >= MAP_H || g.vis[fx.y * W + fx.x] <= 0)) continue;
    const col = fx.t <= 2 ? scale(fx.color, 0.6) : fx.color;
    for (let k = 0; k < fx.ch.length; k++) {
      if (x + k >= VW) break;
      s.put(x + k, y, fx.ch[k], col);
    }
  }
  // enemy alerts
  for (const e of g.enemies) {
    if (e.alertT > 0 && g.vis[e.y * W + e.x] > 0) s.put(e.x - camX, e.y - camY - 1, '!', 0xff4040);
  }
}

function tileLook(t: number, pal: (typeof PAL)[number], tick: number, x: number, y: number): [string, number, number] {
  switch (t) {
    case T.WALL: return ['▓', pal.wall, pal.wallBg];
    case T.FLOOR: {
      const h = hash2(x, y) % 23;
      return [h === 0 ? ',' : h === 1 ? '`' : '.', pal.floor, pal.floorBg];
    }
    case T.DOOR: return ['+', 0xb07a40, pal.floorBg];
    case T.OPEN: return ["'", 0xb07a40, pal.floorBg];
    case T.LOCKED: return ['+', 0xffc040, 0x3a2808];
    case T.CRACKED: return ['▒', mix(pal.wall, 0xffe0c0, 0.18), pal.wallBg];
    case T.STAIRS: return ['>', 0xf0f0ff, (tick >> 3) % 2 ? 0x24304a : 0x1a2438];
    case T.FOG: return [(tick + x + y) % 10 < 5 ? '░' : '▒', 0xd0d0e0, 0x303038];
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
    case 'chest': return o.open ? ['▫', 0x6a5030, false] : ['■', o.loot === 'treasure' || o.loot === 'key' ? 0xffc840 : 0xc09048, false];
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

function drawSidebar(g: Game, s: Screen, x0: number): void {
  const p = g.player, st = g.stats;
  s.fill(x0, 0, SW, s.h, 0x0c0a09);
  for (let y = 0; y < s.h; y++) s.put(x0, y, '│', BORDER);
  const x = x0 + 2;
  let y = 0;
  s.text(x, y++, 'THE ASHEN DEEP', ACCENT);
  s.text(x, y++, `Depth ${g.depth} · ${g.floor.name}`.slice(0, SW - 3), DIM);
  hline(s, x0 + 1, y++, SW - 1);
  s.text(x, y, 'HP ', 0xe06050);
  bar(s, x + 4, y, 14, p.hp / st.maxHp, 0xc03028, 0x3a1410);
  s.text(x + 19, y++, `${Math.max(0, Math.ceil(p.hp))}/${st.maxHp}`, TEXT);
  s.text(x, y, 'ST ', 0x70c060);
  bar(s, x + 4, y, 14, p.sta / st.maxSta, p.staDelay > 0 && p.sta < 5 ? 0x707040 : 0x50a040, 0x14260f);
  s.text(x + 19, y++, `${Math.max(0, Math.floor(p.sta))}`, TEXT);
  s.text(x, y, 'FLASK ', 0xe0c070);
  for (let i = 0; i < p.maxFlasks; i++) s.put(x + 6 + i, y, i < p.flasks ? '♥' : '·', i < p.flasks ? 0xf0b040 : 0x5a4a30);
  y++;
  s.text(x, y, 'ASHES ', 0xb0a8ff);
  s.text(x + 6, y, String(p.ashes), 0xe0dcff);
  const cost = levelCost(p.level);
  s.text(x + 15, y++, `LV ${p.level}`, p.ashes >= cost ? 0xffd060 : TEXT);
  s.text(x, y, 'KEY   ', 0xffd040);
  s.text(x + 6, y++, p.keys > 0 ? '⌐ Crypt Key' : '—', p.keys > 0 ? 0xffd040 : DIM);
  const status: [string, number][] = [];
  if (p.poison > 0) status.push(['Poisoned', 0x90e040]);
  if (p.burn > 0) status.push(['Burning', 0xff7020]);
  if (g.lament > 0) status.push([`Lament +${g.lament * 5}%`, 0xff9a40]);
  if (status.length) {
    let sx = x;
    for (const [t, c] of status) sx += s.text(sx, y, t, c) + 1;
  }
  y++;
  hline(s, x0 + 1, y++, SW - 1);

  const w = p.eq.weapon;
  const b = weaponBase(w);
  s.text(x, y++, 'WEAPON', DIM);
  s.text(x, y++, (w ? w.name : 'Bare Hands').slice(0, SW - 3), w ? RARITY_COLORS[w.rarity] : TEXT);
  s.text(x, y++, `${w ? w.dmgMin : b.dmg[0]}-${w ? w.dmgMax : b.dmg[1]} dmg · ${PATTERN_DESC[b.pattern]}`, 0xa8a090);
  s.text(x, y++, `Armor ${st.armor}  Crit ${Math.round(st.crit * 100)}%`, 0xa8a090);
  hline(s, x0 + 1, y++, SW - 1);

  // target
  const tg = g.target && !g.target.dead ? g.target : null;
  s.text(x, y++, 'TARGET', DIM);
  if (tg) {
    const nm = tg.elite ? tg.name : tg.name;
    s.text(x, y++, nm.slice(0, SW - 3), tg.elite ? 0xffd040 : tg.boss ? BOSSES[tg.boss].color : TEXT);
    bar(s, x, y++, SW - 4, tg.hp / tg.maxHp, 0xb02020, 0x301010);
    let info = '';
    if (tg.elite) info = tg.elite.mods.map((m) => ELITE_MOD_NAMES[m]).join(', ');
    if (tg.state === 'stagger') info = 'STAGGERED';
    if (tg.riposte > 0) info = 'OPEN TO RIPOSTE';
    if (tg.state === 'windup') info = 'WINDING UP!';
    s.text(x, y++, info.slice(0, SW - 3), tg.state === 'windup' ? 0xff4040 : 0xffd060);
  } else {
    s.text(x, y++, '—', DIM);
    y += 2;
  }
  hline(s, x0 + 1, y++, SW - 1);
  s.text(x, y++, 'NEARBY', DIM);
  const near = g.nearbyDescription();
  for (let k = 0; k < 3; k++) s.text(x, y++, (near[k] ?? '').slice(0, SW - 3), 0xd0c8a8);
  hline(s, x0 + 1, y++, SW - 1);
  const ctl: [string, string][] = [
    ['WASD', 'move'], ['J', 'attack'], ['K', 'heavy'], ['SPC', 'roll'], ['Q', 'parry'], ['F', 'flask'], ['E', 'use'], ['I', 'pack'], ['M', 'map'], ['N', 'sound'], ['?', 'help'],
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
  const msgs = g.msgs.slice(-(LH - 1));
  msgs.forEach((m, k) => {
    const age = msgs.length - 1 - k;
    const col = age === 0 ? m.color : scale(m.color, Math.max(0.35, 0.85 - age * 0.15));
    s.text(1, VH + 1 + k, m.text.slice(0, VW - 2), col);
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
  const y = (VH >> 1) - 3;
  for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = 0; xx < VW; xx++) s.put(xx, yy, ' ', 0, mix(s.getBg(xx, yy), 0x000000, 0.75 * a));
  const tx = (VW - b.text.length) >> 1;
  s.text(Math.max(0, tx), y, b.text, scale(b.color, a), undefined);
  const sx = (VW - b.sub.length) >> 1;
  s.text(Math.max(0, sx), y + 1, b.sub, scale(0xa09888, a), undefined);
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

function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > w) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
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
  // scrolling: equipped (5) + header, then bag
  const bagStart = 5;
  const bagRows = listRows - 8;
  const selBag = g.invSel - bagStart;
  const scroll = Math.max(0, Math.min(Math.max(0, p.inv.length - bagRows), selBag - bagRows + 1));
  entries.forEach((en, k) => {
    if ('eq' in en) {
      const it = p.eq[en.eq];
      const sel = k === g.invSel;
      const prefix = sel ? '▶ ' : '  ';
      s.text(lx, row, prefix + SLOT_NAMES[en.eq].padEnd(7), sel ? 0xffffff : DIM, sel ? 0x2a2018 : undefined);
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
      const eqd = p.eq[it.slot];
      const better = compareHint(it, eqd);
      s.text(lx + 4, row, it.name.slice(0, listW - 7), RARITY_COLORS[it.rarity], sel ? 0x2a2018 : undefined);
      if (better) s.text(lx + listW - 2, row, better[0], better[1]);
      row++;
    }
  });
  if (!p.inv.length) s.text(lx + 2, row, '(empty)', DIM);

  // detail pane
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
  const w = 58, h = 19;
  const x = ((s.w - SW - w) >> 1), y = ((s.h - LH - h) >> 1);
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
    ['Dexterity', `${p.dex}`, 'Daggers, spears, scythes, crit'],
    ['Leave', '', 'Return to the dark'],
  ];
  opts.forEach((o, k) => {
    const sel = k === g.bonSel;
    const yy = y + 6 + k * 2;
    s.text(x + 3, yy, sel ? '▶' : ' ', 0xffd060);
    s.text(x + 5, yy, o[0].padEnd(11), sel ? 0xffffff : TEXT, sel ? 0x2a1a10 : undefined);
    s.text(x + 17, yy, o[1].padStart(3), 0xffd080);
    s.text(x + 22, yy, o[2], DIM);
  });
  s.text(x + 3, y + h - 2, '[↑↓] choose  [E/Enter] level up  [Esc] leave', ACCENT);
}

function drawRead(g: Game, s: Screen): void {
  const m = g.modal;
  if (!m) return;
  const w = 62, h = m.lines.length + 5;
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  box(s, x, y, w, h, m.title, 0x6a6a8a);
  m.lines.forEach((ln, k) => {
    const col = ln.startsWith('[') ? ACCENT : ln.startsWith('(') ? DIM : 0xd8d0e0;
    s.text(x + 3, y + 2 + k, ln.slice(0, w - 6), col);
  });
  if (m.kind !== 'stairs') s.text(x + 3, y + h - 2, m.kind === 'soko' ? '[Esc] close   [R] reset stones' : '[Esc/E] close', DIM);
}

function drawMap(g: Game, s: Screen): void {
  const f = g.floor;
  const w = MAP_W + 4, h = Math.ceil(MAP_H / 2) + 4;
  const x = Math.max(0, (s.w - w) >> 1), y = Math.max(0, (s.h - h) >> 1);
  box(s, x, y, w, h, `MAP · Depth ${g.depth}`);
  const col = (mx: number, my: number): number => {
    if (my >= MAP_H) return 0x0d0b0a;
    const i = my * MAP_W + mx;
    if (mx === g.player.x && my === g.player.y) return (g.tick >> 2) % 2 ? 0xffffff : 0xff4040;
    if (!f.seen[i]) return 0x0d0b0a;
    const o = f.objects.find((ob) => ob.x === mx && ob.y === my);
    if (o?.kind === 'bonfire') return 0xff8020;
    if (o?.kind === 'chest' && !o.open) return 0xffc040;
    const t = f.tiles[i];
    if (t === T.WALL) return 0x3a342c;
    if (t === T.STAIRS) return 0x80c0ff;
    if (t === T.LOCKED) return 0xffd040;
    if (t === T.DOOR || t === T.OPEN) return 0x8a5a30;
    if (t === T.FOG) return 0xc0c0d0;
    if (t === T.CRACKED) return 0x5a4a3a;
    return f.roomAt[i] >= 0 ? 0x6a5e50 : 0x50483e;
  };
  for (let my = 0; my < MAP_H; my += 2)
    for (let mx = 0; mx < MAP_W; mx++) s.put(x + 2 + mx, y + 2 + (my >> 1), '▀', col(mx, my), col(mx, my + 1));
  s.text(x + 2, y + h - 1, ' any key to close ', DIM);
}

function drawHelp(s: Screen): void {
  const lines: [string, number][] = [
    ['MOVE        WASD / arrow keys (walk into things to use them)', TEXT],
    ['ATTACK      J or X     quick strike in the direction you face', TEXT],
    ['HEAVY       K or C     slow, 1.8x damage, staggers, breaks cracked walls', TEXT],
    ['ROLL        Space      dodge 2 tiles, invulnerable while rolling', TEXT],
    ['PARRY       Q or L     time it as a red tile flashes to riposte (3x)', TEXT],
    ['FLASK       F          heal ~45%. Refills at bonfires.', TEXT],
    ['USE         E          bonfires, chests, braziers, inscriptions', TEXT],
    ['PACK / MAP  I / M      equip & salvage loot / floor map', TEXT],
    ['SOUND       N          music + sound / sound only / muted', TEXT],
    ['', TEXT],
    ['• Red tiles are incoming attacks. Get out, roll through, or parry.', 0xff7060],
    ['• Every action costs stamina (green). Empty stamina = no rolling.', 0x80d070],
    ['• Unaware enemies (dim) take 2.5x BACKSTAB damage. Torchlight is', 0xd0c8a8],
    ['  short: approach from the dark.', 0xd0c8a8],
    ['• Each floor has a locked door. Solve a puzzle to earn its key.', 0xffd060],
    ['• Read inscriptions (≡). Cracked walls (▒) hide secret rooms.', 0xffd060],
    ['• Dying drops your ashes as a bloodstain (§). Reach it to reclaim.', 0xff6060],
    ['• Resting heals and restores flasks, but the dead rise again.', 0xffa040],
    ['• Gold-named elites and bosses drop the best loot.', 0xff9a40],
  ];
  const w = 76, h = lines.length + 4;
  const x = Math.max(0, (s.w - w) >> 1), y = Math.max(0, (s.h - h) >> 1);
  box(s, x, y, w, h, 'HOW TO SURVIVE (YOU WILL NOT)');
  lines.forEach(([t, c], k) => s.text(x + 3, y + 2 + k, t, c));
  s.text(x + 3, y + h - 1, ' any key to close ', DIM);
}

function drawConfirm(s: Screen): void {
  const w = 46, h = 6;
  const x = (s.w - SW - w) >> 1, y = (s.h - LH - h) >> 1;
  box(s, x, y, w, h, 'LEAVE THE DEEP?');
  s.text(x + 3, y + 2, 'Progress is saved at bonfires and stairs.', TEXT);
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

function drawVictory(g: Game, s: Screen): void {
  const lines = [
    'The Hollow King is dead. The throne of corpses',
    'unclenches, and the kneeling dead finally lie down.',
    '',
    'The crown waits at your feet. You could take it.',
    'You could become what he was.',
    '',
    'Or you could keep going. The Deep goes deeper still,',
    'and older things are waiting there.',
    '',
    `Deaths: ${g.deaths}     Kills: ${g.kills}     Level: ${g.player.level}`,
  ];
  const w = 62, h = lines.length + 6;
  const x = (s.w - SW - w) >> 1, y = Math.max(0, (s.h - LH - h) >> 1);
  box(s, x, y, w, h, 'H E I R   O F   A S H', 0xc0a040);
  lines.forEach((l, k) => s.text(x + 3, y + 2 + k, l, k === lines.length - 1 ? 0xffd060 : TEXT));
  s.text(x + 3, y + h - 2, '[Enter] descend further (the deep grows crueler)', ACCENT);
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
  const widths = [...word].map((c) => FONT[c][0].length + 1);
  const tw = widths.reduce((a, b) => a + b, 0);
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
  const sub = 'a descent through nine depths of rot, ruin and regret';
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
