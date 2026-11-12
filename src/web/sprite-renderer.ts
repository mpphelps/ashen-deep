// Draws the game world with sprites onto a canvas. The interface (sidebar, log, menus) is drawn separately
// from the same text renderer the terminal uses.
import type { Game } from '../game.ts';
import { BLOCKING } from '../game.ts';
import { T, type Floor, type Obj, type Enemy } from '../types.ts';
import { BIOMES, ENEMIES, BOSSES } from '../data.ts';
import { NPCS, TOOL_INFO } from '../story.ts';
import { G } from '../world.ts';
import { RARITY_COLORS } from '../loot.ts';
import {
  CREATURES, BOSS_ART, OBJECTS, villager, itemArt, brazierLit, floorTile, wallTile, waterTile, chasmTile, mistTile, fogTile,
  shade, type Px, type Ground,
} from './art.ts';

export const TILE = 24; // 12px art at 2x

const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
function h2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const WORLD_GROUND: Record<number, [Ground, number]> = {
  [G.GRASS]: ['grass', 0x34361f],
  [G.ROAD]: ['road', 0x5a4a34],
  [G.COBBLE]: ['cobble', 0x55524c],
  [G.MOSS]: ['moss', 0x2e3a20],
  [G.STONE]: ['stone', 0x4a4a52],
  [G.SOIL]: ['road', 0x40301f],
  [G.ASH]: ['ash', 0x3a3836],
  [G.INSIDE]: ['boards', 0x4a3624],
  [G.MUD]: ['road', 0x352a1c],
};
const BIOME_FLOOR: Record<string, Ground> = { crypt: 'flag', rot: 'moss', chapel: 'flag', abyss: 'rough' };

interface RP {
  x: number;
  y: number;
}

export class SpriteRenderer {
  cache = new Map<string, HTMLCanvasElement>();
  pos = new Map<number, RP>(); // smoothed render positions by entity id (-1 = player)
  last = 0;

  /** A Px rasterized to a canvas at 1:1, cached. */
  img(key: string, make: () => Px): HTMLCanvasElement {
    let c = this.cache.get(key);
    if (c) return c;
    const p = make();
    c = document.createElement('canvas');
    c.width = p.w;
    c.height = p.h;
    const ctx = c.getContext('2d')!;
    const id = ctx.createImageData(p.w, p.h);
    for (let i = 0; i < p.data.length; i++) {
      const v = p.data[i];
      if (v < 0) continue;
      id.data[i * 4] = (v >> 16) & 255;
      id.data[i * 4 + 1] = (v >> 8) & 255;
      id.data[i * 4 + 2] = v & 255;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    this.cache.set(key, c);
    return c;
  }

  /** The same sprite as a flat-colored silhouette (hit flashes, wind-ups, outlines). */
  sil(key: string, base: HTMLCanvasElement, color: number): HTMLCanvasElement {
    const k = `${key}#${color}`;
    let c = this.cache.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = hex(color);
    ctx.fillRect(0, 0, c.width, c.height);
    this.cache.set(k, c);
    return c;
  }

  // -------------------------------------------------------------------- terrain
  floorImg(f: Floor, x: number, y: number): HTMLCanvasElement {
    const v = h2(x, y) & 3;
    if (f.kind === 'world') {
      const [style, col] = WORLD_GROUND[f.ground[y * f.w + x]] ?? WORLD_GROUND[G.GRASS];
      return this.img(`fl:${style}:${col}:${v}`, () => floorTile(style, col, v + 1));
    }
    const b = BIOMES[f.biome];
    const style = BIOME_FLOOR[f.biome] ?? 'flag';
    const col = shade(b.floor, 0.9);
    return this.img(`fl:${style}:${col}:${v}`, () => floorTile(style, col, v + 1));
  }
  wallImg(f: Floor, x: number, y: number, cracked = false): HTMLCanvasElement {
    const col = f.kind === 'world' ? 0x6e6a66 : shade(BIOMES[f.biome].wall, 0.8);
    const v = h2(x, y) & 1;
    return this.img(`wall:${col}:${v}:${cracked}`, () => wallTile(col, v + 3, cracked));
  }

  // -------------------------------------------------------------------- frame
  draw(ctx: CanvasRenderingContext2D, g: Game, vx: number, vy: number, vw: number, vh: number, now: number): void {
    const f = g.floor;
    const p = g.player;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    const tick = g.tick;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx, vy, vw, vh);
    ctx.clip();
    ctx.fillStyle = '#050404';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.imageSmoothingEnabled = false;

    // smoothed positions
    const ease = (id: number, tx: number, ty: number): RP => {
      let r = this.pos.get(id);
      if (!r || Math.abs(r.x - tx) > 3 || Math.abs(r.y - ty) > 3) {
        r = { x: tx, y: ty };
        this.pos.set(id, r);
      }
      const k = Math.min(1, dt * 16);
      r.x += (tx - r.x) * k;
      r.y += (ty - r.y) * k;
      return r;
    };
    const pr = ease(-1, p.x, p.y);
    const S = TILE;
    let camX = f.w * S <= vw ? -(vw - f.w * S) / 2 : Math.max(0, Math.min(f.w * S - vw, (pr.x + 0.5) * S - vw / 2));
    let camY = f.h * S <= vh ? -(vh - f.h * S) / 2 : Math.max(0, Math.min(f.h * S - vh, (pr.y + 0.5) * S - vh / 2));
    if (g.shake > 0) {
      camX += (Math.random() - 0.5) * Math.min(6, g.shake * 1.5);
      camY += (Math.random() - 0.5) * Math.min(6, g.shake * 1.5);
    }
    camX = Math.round(camX);
    camY = Math.round(camY);
    const sx = (mx: number) => vx + mx * S - camX;
    const sy = (my: number) => vy + my * S - camY;
    const x0 = Math.max(0, Math.floor(camX / S)), y0 = Math.max(0, Math.floor(camY / S));
    const x1 = Math.min(f.w - 1, Math.ceil((camX + vw) / S)), y1 = Math.min(f.h - 1, Math.ceil((camY + vh) / S));

    // index objects/pickups
    const objAt = new Map<number, Obj[]>();
    for (const o of f.objects) {
      const k = o.y * f.w + o.x;
      const a = objAt.get(k);
      if (a) a.push(o);
      else objAt.set(k, [o]);
    }
    const pickAt = new Map<number, typeof f.pickups[number]>();
    for (const pk of f.pickups) pickAt.set(pk.y * f.w + pk.x, pk);
    const fieldAt = new Map<number, string>();
    for (const fl of g.fields) fieldAt.set(fl.y * f.w + fl.x, fl.kind);

    // ---- pass 1: terrain, decals, objects, items
    for (let my = y0; my <= y1; my++)
      for (let mx = x0; mx <= x1; mx++) {
        const i = my * f.w + mx;
        if (!f.seen[i]) continue;
        const X = sx(mx), Y = sy(my);
        this.tile(ctx, g, f, mx, my, X, Y, tick);
        const vis = g.vis[i] > 0;
        const dc = f.decal[i];
        if (dc === 1) {
          ctx.fillStyle = 'rgba(110,10,8,0.55)';
          const hh = h2(mx, my);
          ctx.fillRect(X + 4 + (hh & 7), Y + 6 + ((hh >> 3) & 7), 8, 6);
          ctx.fillRect(X + 2 + ((hh >> 6) & 7), Y + 3 + ((hh >> 9) & 7), 5, 4);
        } else if (dc === 2) ctx.drawImage(this.img('o:corpse', OBJECTS.corpse), X, Y, S, S);
        else if (dc === 3) ctx.drawImage(this.img('o:bones', OBJECTS.bones), X, Y, S, S);
        const fk = fieldAt.get(i);
        if (fk && vis) {
          const fl = (tick + mx * 3 + my) % 6 < 3;
          ctx.fillStyle = fk === 'fire' ? (fl ? 'rgba(255,110,20,0.55)' : 'rgba(255,170,40,0.45)') : fl ? 'rgba(110,200,40,0.45)' : 'rgba(70,150,30,0.4)';
          ctx.fillRect(X, Y, S, S);
        }
        for (const o of objAt.get(i) ?? []) this.object(ctx, g, o, X, Y, tick, vis);
        const pk = pickAt.get(i);
        if (pk && vis) this.pickup(ctx, pk, X, Y, tick);
      }

    // ---- pass 3: darkness
    for (let my = y0; my <= y1; my++)
      for (let mx = x0; mx <= x1; mx++) {
        const i = my * f.w + mx;
        const X = sx(mx), Y = sy(my);
        if (!f.seen[i]) continue;
        const l = g.vis[i];
        if (l > 0) {
          const a = 0.86 * (1 - Math.min(1, l)) ** 2;
          if (a > 0.02) {
            ctx.fillStyle = `rgba(3,2,2,${a.toFixed(3)})`;
            ctx.fillRect(X, Y, S, S);
          }
        } else {
          ctx.fillStyle = 'rgba(4,4,12,0.74)';
          ctx.fillRect(X, Y, S, S);
        }
      }

    // ---- pass 3b: creatures, townsfolk, you (after the dark, so anything in view stays readable)
    for (const n of f.npcs) {
      if (g.vis[n.y * f.w + n.x] <= 0) continue;
      const d = NPCS[n.id];
      const im = this.img(`npc:${n.id}`, () => villager(d.color, n.id === 'mouse'));
      ctx.drawImage(im, sx(n.x), sy(n.y) + (Math.sin(tick / 9 + n.x) > 0.6 ? -1 : 0), S, S);
      this.dim(ctx, `npc:${n.id}`, im, sx(n.x), sy(n.y), g.vis[n.y * f.w + n.x]);
    }
    for (const e of g.enemies) {
      if (e.dead) continue;
      if (g.vis[e.y * f.w + e.x] <= 0 && !(e.boss && g.bossActive)) continue;
      const r = ease(e.id, e.x, e.y);
      const l = g.vis[e.y * f.w + e.x];
      if (e.size > 1) this.boss(ctx, e, sx(r.x), sy(r.y), tick);
      else this.creature(ctx, e, sx(r.x), sy(r.y), tick, l);
    }
    if (g.mode !== 'dead') this.you(ctx, g, sx(pr.x), sy(pr.y), tick);

    // ---- pass 4: things that glow through the dark
    for (let my = y0; my <= y1; my++)
      for (let mx = x0; mx <= x1; mx++) {
        const i = my * f.w + mx;
        if (g.vis[i] <= 0) continue;
        for (const o of objAt.get(i) ?? []) {
          const glow = o.kind === 'bonfire' ? 0xff8030 : o.kind === 'lamp' ? 0xffb050 : o.kind === 'brazier' && o.lit ? o.color! : o.kind === 'rune' && o.lit ? 0x60e0ff : o.kind === 'message' ? 0xe08a40 : -1;
          if (glow < 0) continue;
          const X = sx(mx) + S / 2, Y = sy(my) + S / 2;
          const rad = o.kind === 'message' ? S * 0.7 : S * (1.6 + 0.15 * Math.sin(tick / 3 + mx));
          const gr = ctx.createRadialGradient(X, Y, 1, X, Y, rad);
          gr.addColorStop(0, rgba(glow, o.kind === 'message' ? 0.25 : 0.35));
          gr.addColorStop(1, rgba(glow, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(X - rad, Y - rad, rad * 2, rad * 2);
          if (o.kind !== 'message') this.object(ctx, g, o, sx(mx), sy(my), tick, true);
        }
        const fk = fieldAt.get(i);
        if (fk === 'fire') {
          ctx.fillStyle = (tick + mx) % 4 < 2 ? 'rgba(255,140,30,0.35)' : 'rgba(255,200,60,0.25)';
          ctx.fillRect(sx(mx), sy(my), S, S);
        }
        const pk = pickAt.get(i);
        if (pk && ((pk.kind === 'item' && pk.item && pk.item.rarity >= 2) || pk.stain || pk.kind === 'lore' || pk.kind === 'quest' || pk.kind === 'key')) {
          const c = pk.stain ? 0xff2020 : pk.kind === 'item' ? RARITY_COLORS[pk.item!.rarity] : 0xffe0a0;
          const X = sx(mx) + S / 2, Y = sy(my) + S / 2;
          const gr = ctx.createRadialGradient(X, Y, 1, X, Y, S);
          gr.addColorStop(0, rgba(c, 0.35 + 0.15 * Math.sin(tick / 4)));
          gr.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(X - S, Y - S, S * 2, S * 2);
          this.pickup(ctx, pk, sx(mx), sy(my), tick);
        }
      }

    // ---- pass 5: telegraphs (always readable), projectiles, effects
    for (const t of g.teles) {
      const k = 1 - t.t / t.max;
      const last = t.t <= 3;
      for (const v of t.tiles) {
        if (v.x < 0 || v.y < 0 || v.x >= f.w || v.y >= f.h) continue;
        const X = sx(v.x), Y = sy(v.y);
        if (t.kind === 'aim') {
          ctx.fillStyle = `rgba(200,60,60,${0.12 + 0.2 * k})`;
          ctx.fillRect(X + S / 2 - 2, Y + S / 2 - 2, 4, 4);
          continue;
        }
        const col = t.kind === 'acid' ? '120,220,40' : t.kind === 'fire' ? '255,120,20' : '220,30,30';
        ctx.fillStyle = last ? (tick & 1 ? 'rgba(255,90,90,0.75)' : `rgba(${col},0.7)`) : `rgba(${col},${0.18 + 0.42 * k})`;
        ctx.fillRect(X + 1, Y + 1, S - 2, S - 2);
        ctx.strokeStyle = `rgba(${col},${0.5 + 0.5 * k})`;
        ctx.strokeRect(X + 1.5, Y + 1.5, S - 3, S - 3);
      }
    }
    for (const prj of g.projs) {
      const X = sx(prj.x) + S / 2, Y = sy(prj.y) + S / 2;
      const len = Math.hypot(prj.vx, prj.vy) || 1;
      ctx.strokeStyle = hex(prj.color);
      ctx.lineWidth = prj.glyph === '•' && !prj.friendly ? 2 : 3;
      if (prj.glyph === '•' || prj.glyph === '*' || prj.glyph === '♪') {
        ctx.fillStyle = hex(prj.color);
        ctx.beginPath();
        ctx.arc(X, Y, prj.glyph === '♪' ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(prj.color, 0.3);
        ctx.beginPath();
        ctx.arc(X, Y, 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(X - (prj.vx / len) * 9, Y - (prj.vy / len) * 9);
        ctx.lineTo(X + (prj.vx / len) * 6, Y + (prj.vy / len) * 6);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const fx of g.fx) {
      if (fx.x < 0 || fx.y < 0 || fx.x >= f.w || fx.y >= f.h) continue;
      const X = sx(fx.x) + S / 2, Y = sy(fx.y) + S / 2;
      const a = Math.min(1, fx.t / 3);
      if (fx.ch.length > 1) {
        // damage numbers and words float up off the target
        const rise = (12 - Math.min(12, fx.t)) * 1.5;
        ctx.font = 'bold 13px Consolas, monospace';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.strokeText(fx.ch, X + (fx.ch.length * 4) - 4, Y + S / 2 - rise);
        ctx.fillStyle = rgba(fx.color, a);
        ctx.fillText(fx.ch, X + (fx.ch.length * 4) - 4, Y + S / 2 - rise);
        ctx.lineWidth = 1;
      } else if (g.vis[fx.y * f.w + fx.x] > 0) {
        if (fx.ch === '|' || fx.ch === '─' || fx.ch === '#') {
          // weapon arcs
          ctx.strokeStyle = rgba(fx.color, a * 0.9);
          ctx.lineWidth = fx.ch === '#' ? 4 : 2;
          ctx.beginPath();
          ctx.arc(X, Y, S * 0.42, (tick % 4) * 1.6, (tick % 4) * 1.6 + 2.4);
          ctx.stroke();
          ctx.lineWidth = 1;
        } else {
          ctx.font = 'bold 16px Consolas, monospace';
          ctx.fillStyle = rgba(fx.color, a);
          ctx.fillText(fx.ch, X, Y);
        }
      }
    }
    for (const e of g.enemies) {
      if (e.alertT > 0 && g.vis[e.y * f.w + e.x] > 0) {
        const r = this.pos.get(e.id) ?? e;
        ctx.font = 'bold 16px Consolas, monospace';
        ctx.fillStyle = '#ff4040';
        ctx.fillText('!', sx(r.x) + S / 2, sy(r.y) - 4 - (e.size > 1 ? S : 0));
      }
    }
    // a slight vignette
    const vg = ctx.createRadialGradient(vx + vw / 2, vy + vh / 2, Math.min(vw, vh) * 0.35, vx + vw / 2, vy + vh / 2, Math.max(vw, vh) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.restore();
    // forget smoothing state for entities that are gone
    if (tick % 100 === 0) {
      const live = new Set(g.enemies.map((e) => e.id));
      for (const id of this.pos.keys()) if (id >= 0 && !live.has(id)) this.pos.delete(id);
    }
  }

  tile(ctx: CanvasRenderingContext2D, g: Game, f: Floor, mx: number, my: number, X: number, Y: number, tick: number): void {
    const S = TILE;
    const t = f.tiles[my * f.w + mx];
    const floor = () => ctx.drawImage(this.floorImg(f, mx, my), X, Y, S, S);
    const over = (key: string) => ctx.drawImage(this.img(`o:${key}`, OBJECTS[key]), X, Y, S, S);
    switch (t) {
      case T.WALL: ctx.drawImage(this.wallImg(f, mx, my), X, Y, S, S); return;
      case T.CRACKED: ctx.drawImage(this.wallImg(f, mx, my, true), X, Y, S, S); return;
      case T.FLOOR: floor(); return;
      case T.DOOR: floor(); over('door'); return;
      case T.OPEN: floor(); over('door_open'); return;
      case T.LOCKED: floor(); over('door_locked'); return;
      case T.STAIRS: floor(); over('stairs'); return;
      case T.UPSTAIRS: floor(); over('upstairs'); return;
      case T.ENTRANCE: floor(); over('entrance'); return;
      case T.RUBBLE: floor(); over('rubble'); return;
      case T.THORNS: floor(); over('thorns'); return;
      case T.FENCE: floor(); over('fence'); return;
      case T.BRIDGE: ctx.drawImage(this.img('o:bridge', OBJECTS.bridge), X, Y, S, S); return;
      case T.BROKEN:
        ctx.drawImage(this.img(`water:${(tick >> 3) & 1}:${mx & 3}`, () => waterTile((tick >> 3) & 1, mx & 3)), X, Y, S, S);
        over('broken');
        return;
      case T.TREE: {
        floor();
        const moss = f.kind === 'world' && f.ground[my * f.w + mx] === G.MOSS;
        over(moss || h2(mx, my) % 3 === 0 ? 'tree0' : 'deadtree');
        return;
      }
      case T.WATER: ctx.drawImage(this.img(`water:${(tick >> 3) & 1}:${(mx + my) & 3}`, () => waterTile((tick >> 3) & 1, (mx + my) & 3)), X, Y, S, S); return;
      case T.CHASM: ctx.drawImage(this.img(`chasm:${h2(mx, my) & 3}`, () => chasmTile(h2(mx, my) & 3)), X, Y, S, S); return;
      case T.PHANTOM: {
        const solid = g.resonance > 0;
        const fr = solid ? 0 : (tick >> 2) & 3;
        ctx.drawImage(this.img(`mist:${fr}:${solid}:${mx & 1}`, () => mistTile(fr, mx & 1, solid)), X, Y, S, S);
        if (solid && g.resonance < 50 && (tick >> 2) % 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(X, Y, S, S);
        }
        return;
      }
      case T.FOG: ctx.drawImage(this.img(`fog:${(tick >> 2) & 3}`, () => fogTile((tick >> 2) & 3, 1)), X, Y, S, S); return;
    }
  }

  object(ctx: CanvasRenderingContext2D, g: Game, o: Obj, X: number, Y: number, tick: number, vis: boolean): void {
    const S = TILE;
    const d = (key: string) => ctx.drawImage(this.img(`o:${key}`, OBJECTS[key]), X, Y, S, S);
    switch (o.kind) {
      case 'bonfire': return d((tick >> 2) & 1 ? 'bonfire1' : 'bonfire0');
      case 'lamp': return d('lamp');
      case 'chest': return d(o.open ? 'chest_open' : 'chest');
      case 'urn': return d('urn');
      case 'grave':
        if (o.dug) return d('grave_dug');
        d('grave');
        if (o.name?.startsWith('WREN')) {
          ctx.fillStyle = 'rgba(255,224,96,0.25)';
          ctx.fillRect(X, Y, S, S);
        }
        return;
      case 'tablet': return d('tablet');
      case 'message': return vis ? d('message') : undefined;
      case 'spikes': {
        const ph = (tick + (o.off ?? 0)) % 80;
        d(ph >= 66 ? 'spikes_up' : 'spikes');
        if (ph >= 56 && ph < 66 && vis) {
          ctx.fillStyle = (tick >> 1) & 1 ? 'rgba(255,160,40,0.35)' : 'rgba(255,100,20,0.2)';
          ctx.fillRect(X, Y, S, S);
        }
        return;
      }
      case 'rune': return d(o.lit ? 'rune_lit' : 'rune');
      case 'plate': return d('plate');
      case 'boulder': {
        const onPlate = g.floor.puzzles[o.puzzle!].plates.some((pl) => pl.x === o.x && pl.y === o.y);
        if (onPlate) d('plate');
        d('boulder');
        if (onPlate) {
          ctx.fillStyle = 'rgba(255,230,140,0.25)';
          ctx.fillRect(X, Y, S, S);
        }
        return;
      }
      case 'brazier':
        if (o.lit) {
          const fr = (tick >> 2) & 1;
          ctx.drawImage(this.img(`brazier:${o.color}:${fr}`, () => brazierLit(o.color!, fr)), X, Y, S, S);
        } else {
          d('brazier');
          // its color, as a faint smear of old ash, so you can read which is which
          ctx.fillStyle = rgba(o.color!, 0.85);
          ctx.fillRect(X + 6, Y + 9, 12, 3);
        }
        return;
      case 'deco': {
        // themed decorations without their own sprite are drawn as their glyph
        if (!vis && !o.block) return;
        ctx.font = 'bold 18px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hex(o.color ?? 0xaaaaaa);
        ctx.fillText(o.glyph ?? '?', X + S / 2, Y + S / 2 + 1);
        return;
      }
    }
  }

  pickup(ctx: CanvasRenderingContext2D, pk: Game['floor']['pickups'][number], X: number, Y: number, tick: number): void {
    const S = TILE;
    const bob = Math.sin(tick / 5 + X) > 0 ? -1 : 0;
    let im: HTMLCanvasElement;
    if (pk.kind === 'item' && pk.item) {
      const kind = pk.item.slot === 'weapon' ? (pk.item.base === 'bow' ? 'bow' : 'weapon') : pk.item.slot;
      const c = RARITY_COLORS[pk.item.rarity];
      im = this.img(`item:${kind}:${c}`, () => itemArt(kind, c));
    } else if (pk.kind === 'ashes') im = this.img(pk.stain ? 'o:i_stain' : 'o:i_ashes', pk.stain ? OBJECTS.i_stain : OBJECTS.i_ashes);
    else if (pk.kind === 'tool' && pk.id) {
      const info = TOOL_INFO[pk.id as keyof typeof TOOL_INFO];
      ctx.font = 'bold 18px Consolas, monospace';
      ctx.fillStyle = hex(info.color);
      ctx.fillText(info.glyph, X + S / 2, Y + S / 2);
      return;
    } else {
      const key = pk.kind === 'key' ? 'i_key' : pk.kind === 'tallow' ? 'i_tallow' : pk.kind === 'lore' ? 'i_lore' : 'i_quest';
      im = this.img(`o:${key}`, OBJECTS[key]);
    }
    ctx.drawImage(im, X, Y + bob, S, S);
  }

  /** Creatures drawn over the darkness get a lighter dimming of their own. */
  dim(ctx: CanvasRenderingContext2D, key: string, im: HTMLCanvasElement, X: number, Y: number, light: number, flip = false): void {
    const a = 0.55 * (1 - Math.min(1, light)) ** 2;
    if (a < 0.03) return;
    ctx.globalAlpha = a;
    const sil = this.sil(key, im, 0x000000);
    if (flip) {
      ctx.save();
      ctx.translate(X + TILE, Y);
      ctx.scale(-1, 1);
      ctx.drawImage(sil, 0, 0, TILE, TILE);
      ctx.restore();
    } else ctx.drawImage(sil, X, Y, TILE, TILE);
    ctx.globalAlpha = 1;
  }

  creature(ctx: CanvasRenderingContext2D, e: Enemy, X: number, Y: number, tick: number, light = 1): void {
    const S = TILE;
    const key = e.ally ? 'thrall' : e.def;
    const im = this.img(`c:${key}`, CREATURES[key] ?? CREATURES.hollow);
    let dx = 0, dy = 0;
    if (e.state === 'windup') {
      // rear back, trembling
      dx = -e.face.x * 2 + ((tick & 1) ? 1 : -1);
      dy = -e.face.y * 2 - 1;
    } else if (e.state === 'recover' && e.t > 6) {
      dx = e.face.x * 3;
      dy = e.face.y * 3;
    } else if (e.state === 'stagger') dx = (tick & 2) ? 1 : -1;
    if (e.def === 'wraith') dy += Math.sin(tick / 4 + e.id) * 2;
    const flip = e.face.x < 0;
    const drawIt = (c: HTMLCanvasElement, ox = 0, oy = 0) => {
      if (flip) {
        ctx.save();
        ctx.translate(X + dx + ox + S, Y + dy + oy);
        ctx.scale(-1, 1);
        ctx.drawImage(c, 0, 0, S, S);
        ctx.restore();
      } else ctx.drawImage(c, X + dx + ox, Y + dy + oy, S, S);
    };
    if (e.elite) {
      const gold = this.sil(`c:${key}`, im, 0xffc040);
      for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) drawIt(gold, ox, oy);
    }
    if (e.def === 'wraith') ctx.globalAlpha = 0.75;
    drawIt(im);
    ctx.globalAlpha = 1;
    this.dim(ctx, `c:${key}`, im, X + dx, Y + dy, light, flip);
    const tint = e.flash > 0 ? 0xffffff : e.state === 'windup' ? 0xff2020 : e.state === 'stagger' ? 0xffff60 : e.riposte > 0 ? 0xffe000 : -1;
    if (tint >= 0) {
      ctx.globalAlpha = e.flash > 0 ? 0.85 : e.state === 'windup' ? ((tick >> 1) & 1 ? 0.55 : 0.25) : 0.4;
      drawIt(this.sil(`c:${key}`, im, tint));
      ctx.globalAlpha = 1;
    }
    if (e.state === 'idle' && !e.aware && !e.ally) {
      ctx.globalAlpha = 0.3;
      drawIt(this.sil(`c:${key}`, im, 0x000000));
      ctx.globalAlpha = 1;
    }
    if (e.ally) {
      ctx.fillStyle = 'rgba(120,230,140,0.25)';
      ctx.fillRect(X + 4, Y + S - 3, S - 8, 2);
    }
  }

  boss(ctx: CanvasRenderingContext2D, e: Enemy, X: number, Y: number, tick: number): void {
    const S = TILE;
    const im = this.img(`boss:${e.boss}`, BOSS_ART[e.boss!]);
    let dx = 0, dy = 0;
    if (e.state === 'windup') {
      dx = (tick & 1) ? 2 : -2;
      dy = -2;
    } else if (e.state === 'stagger') dy = 3;
    if (e.boss === 'choir') dy += Math.sin(tick / 6) * 2;
    const bx = X - S + dx, by = Y - S + dy;
    ctx.drawImage(im, bx, by, S * 3, S * 3);
    const tint = e.flash > 0 ? 0xffffff : e.state === 'windup' ? 0xff2020 : e.state === 'stagger' ? 0xffff60 : -1;
    if (tint >= 0) {
      ctx.globalAlpha = e.flash > 0 ? 0.7 : e.state === 'windup' ? ((tick >> 1) & 1 ? 0.45 : 0.2) : 0.35;
      ctx.drawImage(this.sil(`boss:${e.boss}`, im, tint), bx, by, S * 3, S * 3);
      ctx.globalAlpha = 1;
    }
    if (e.phase) {
      ctx.fillStyle = `rgba(255,40,30,${0.1 + 0.08 * Math.sin(tick / 3)})`;
      ctx.fillRect(bx, by, S * 3, S * 3);
    }
  }

  you(ctx: CanvasRenderingContext2D, g: Game, X: number, Y: number, tick: number): void {
    const S = TILE;
    const p = g.player;
    const im = this.img('c:player', CREATURES.player);
    let dx = 0, dy = 0, alpha = 1;
    const a = p.act;
    if (a?.kind === 'attack' || a?.kind === 'heavy' || a?.kind === 'skill') {
      dx = -p.face.x * 2;
      dy = -p.face.y * 2;
    } else if (a?.kind === 'recover' && a.t > 3) {
      dx = p.face.x * 3;
      dy = p.face.y * 3;
    } else if (a?.kind === 'roll') {
      alpha = 0.55;
      dy = 2;
    }
    const r = this.pos.get(-1)!;
    if (Math.abs(r.x - p.x) + Math.abs(r.y - p.y) > 0.05) dy -= Math.abs(Math.sin(tick * 1.3)) * 2;
    const flip = p.face.x < 0;
    const drawIt = (c: HTMLCanvasElement) => {
      if (flip) {
        ctx.save();
        ctx.translate(X + dx + S, Y + dy);
        ctx.scale(-1, 1);
        ctx.drawImage(c, 0, 0, S, S);
        ctx.restore();
      } else ctx.drawImage(c, X + dx, Y + dy, S, S);
    };
    ctx.globalAlpha = alpha;
    drawIt(im);
    const tint = p.flash > 0 ? 0xff3030 : a?.kind === 'parry' ? 0x60e0ff : a?.kind === 'drink' ? 0x60ff80 : p.buffs.bone > 0 ? 0xd0e8c0 : -1;
    if (tint >= 0) {
      ctx.globalAlpha = p.flash > 0 ? 0.6 : 0.35;
      drawIt(this.sil('c:player', im, tint));
    }
    ctx.globalAlpha = 1;
    // the weapon in your hand, pointing the way you face
    const w = p.eq.weapon;
    if (w && a?.kind !== 'roll') {
      const kind = w.base === 'bow' ? 'bow' : 'weapon';
      const wi = this.img(`item:${kind}:${RARITY_COLORS[w.rarity]}`, () => itemArt(kind, RARITY_COLORS[w.rarity]));
      const ox = p.face.x * 9 + (p.face.y ? 7 : 0), oy = p.face.y * 7 + 3;
      ctx.drawImage(wi, X + dx + ox + 4, Y + dy + oy, S * 0.65, S * 0.65);
    }
    if (p.guard) {
      ctx.fillStyle = '#7a5a34';
      ctx.strokeStyle = '#d0a868';
      const gx = X + S / 2 + p.face.x * 12 - 5, gy = Y + S / 2 + p.face.y * 12 - 7;
      ctx.fillRect(gx, gy, 10, 14);
      ctx.strokeRect(gx + 0.5, gy + 0.5, 9, 13);
    }
    if (p.buffs.warcry > 0) {
      ctx.strokeStyle = `rgba(255,120,60,${0.3 + 0.2 * Math.sin(tick)})`;
      ctx.strokeRect(X - 2, Y - 2, S + 4, S + 4);
    }
  }
}

export const enemyName = (e: Enemy) => (e.boss ? BOSSES[e.boss].name : ENEMIES[e.def].name);
export { BLOCKING };
