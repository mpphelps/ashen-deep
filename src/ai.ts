// Enemy and boss behaviour. Every attack is telegraphed: tiles light up red, then strike.
import type { Game } from './game.ts';
import { spaced } from './game.ts';
import { DIRS, DIRS8, T, type Enemy, type Vec, type Tele } from './types.ts';
import { ENEMIES, BOSSES } from './data.ts';

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

function tickCommon(e: Enemy): void {
  if (e.blind > 0) e.blind--;
  if (e.flash > 0) e.flash--;
  if (e.alertT > 0) e.alertT--;
  if (e.riposte > 0) e.riposte--;
  if (e.cd > 0) e.cd--;
  if (e.birthCd > 0) e.birthCd--;
}

function attack(
  g: Game, e: Enemy, tiles: Vec[], windup: number,
  opts: Partial<Tele> & { mult?: number; after?: () => boolean } = {},
): void {
  const d = ENEMIES[e.def];
  const w = Math.max(4, Math.round(windup * e.wmult));
  e.state = 'windup';
  e.t = w;
  g.sfxAt('warn', e.x, e.y);
  const { mult, after, ...rest } = opts;
  g.addTele({
    tiles, t: w, max: w, dmg: e.dmg * (mult ?? 1), owner: e, parryable: true, kind: 'melee', poison: d.poison,
    ...rest,
    onFire: () => {
      if (e.dead) return;
      if (after && after()) return;
      if (e.state === 'windup') {
        e.state = 'recover';
        e.t = d.recover;
        e.cd = d.cooldown + g.rng.int(0, 8);
      }
    },
  });
}

function step(g: Game, e: Enemy, mode: 'toward' | 'away' | 'direct', phase = false): boolean {
  if (e.moveT > 0) {
    e.moveT--;
    return false;
  }
  const p = g.player;
  const W = g.floor.w;
  const cur = g.dist[e.y * W + e.x];
  const order = g.rng.shuffle([0, 1, 2, 3]);
  let best: Vec | null = null;
  if (mode === 'direct' || (mode === 'toward' && cur >= 1 << 29)) {
    let bd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    for (const k of order) {
      const d = DIRS[k];
      const nx = e.x + d.x, ny = e.y + d.y;
      if (!g.canEnemyEnter(e, nx, ny, phase)) continue;
      const dd = (nx - p.x) ** 2 + (ny - p.y) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
  } else {
    let bv = cur;
    for (const k of order) {
      const d = DIRS[k];
      const nx = e.x + d.x, ny = e.y + d.y;
      if (!g.canEnemyEnter(e, nx, ny)) continue;
      const v = g.dist[ny * W + nx];
      if (v >= 1 << 29) continue;
      if (mode === 'toward' ? v < bv : v > bv) {
        bv = v;
        best = d;
      }
    }
  }
  if (!best) {
    e.moveT = 2;
    return false;
  }
  g.moveEnemy(e, e.x + best.x, e.y + best.y);
  e.face = { x: best.x, y: best.y };
  e.moveT = e.speed;
  return true;
}

function faceToward(e: Enemy, x: number, y: number): void {
  const dx = sign(x - e.x), dy = sign(y - e.y);
  if (dx || dy) e.face = { x: dx, y: dy };
}

function clearLine(g: Game, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const v of line(x0, y0, x1, y1).slice(1, -1)) if (g.isOpaque(v.x, v.y)) return false;
  return true;
}

function line(x0: number, y0: number, x1: number, y1: number): Vec[] {
  const out: Vec[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (let k = 0; k < 200; k++) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

// ======================================================================= regular enemies
export function updateEnemy(g: Game, e: Enemy): void {
  const d = ENEMIES[e.def];
  const p = g.player;
  tickCommon(e);
  if (e.state === 'stagger') {
    if (--e.t <= 0) {
      e.state = 'chase';
      e.cd = Math.max(e.cd, 8);
    }
    return;
  }
  if (e.state === 'windup') return;
  if (e.state === 'recover') {
    if (--e.t <= 0) e.state = 'chase';
    return;
  }
  const dx = p.x - e.x, dy = p.y - e.y;
  const cheb = Math.max(Math.abs(dx), Math.abs(dy));
  const seen = g.vis[e.y * g.floor.w + e.x] > 0;

  if (e.state === 'idle') {
    // stealth: enemies notice you gradually, far faster when facing you
    let chance = 0;
    if (seen && cheb <= 9) {
      chance = cheb <= 1 ? 0.06 : cheb <= 4 ? 0.035 : 0.015;
      const facing = e.face.x * dx + e.face.y * dy > 0;
      chance *= facing ? 2.5 : 0.4;
    } else if (cheb <= 2) chance = 0.03;
    if (g.player.talents.includes('shadow')) chance *= 0.5;
    const notice = e.blind <= 0 && ((g.noise > 0 && cheb <= 6) || g.rng.chance(chance));
    if (notice) {
      e.aware = true;
      e.state = 'chase';
      e.alertT = 14;
      e.cd = Math.max(e.cd, 8);
      faceToward(e, p.x, p.y);
    } else if (g.rng.chance(0.006)) {
      e.face = { ...g.rng.pick(DIRS) }; // idly turn
    } else if (g.rng.chance(0.01)) {
      const dd = g.rng.pick(DIRS);
      if (g.canEnemyEnter(e, e.x + dd.x, e.y + dd.y)) {
        g.moveEnemy(e, e.x + dd.x, e.y + dd.y);
        e.face = { x: dd.x, y: dd.y };
      }
    }
    return;
  }

  // chasing
  if (!seen && cheb > 2) {
    if (++e.lostT > 180) {
      e.state = 'idle';
      e.aware = false;
      e.lostT = 0;
      return;
    }
  } else e.lostT = 0;
  if (cheb <= 1) faceToward(e, p.x, p.y);

  switch (d.atk) {
    case 'melee':
    case 'phase':
      if (cheb <= 1 && e.cd <= 0) attack(g, e, [{ x: p.x, y: p.y }], d.windup);
      else if (cheb > 1) step(g, e, d.atk === 'phase' ? 'direct' : 'toward', d.atk === 'phase');
      break;

    case 'combo':
      if (cheb <= 1 && e.cd <= 0) {
        const swing = (): void => {
          attack(g, e, [{ x: g.player.x, y: g.player.y }], d.windup - (e.combo ? 3 : 0), {
            after: () => {
              const pp = g.player;
              if (e.combo < 2 && Math.max(Math.abs(pp.x - e.x), Math.abs(pp.y - e.y)) <= 1) {
                e.combo++;
                faceToward(e, pp.x, pp.y);
                swing();
                return true;
              }
              e.combo = 0;
              return false;
            },
          });
        };
        swing();
      } else if (cheb > 1) step(g, e, 'toward');
      break;

    case 'sweep': {
      if (cheb <= 1 && e.cd <= 0) {
        const di = DIRS8.findIndex((v) => v.x === sign(dx) && v.y === sign(dy));
        const tiles = [DIRS8[di], DIRS8[(di + 7) % 8], DIRS8[(di + 1) % 8]].map((v) => ({ x: e.x + v.x, y: e.y + v.y }));
        attack(g, e, tiles, d.windup);
      } else if (cheb > 1) step(g, e, 'toward');
      break;
    }

    case 'slam': {
      if (cheb <= 1 && e.cd <= 0) {
        const tiles = DIRS8.map((v) => ({ x: e.x + v.x, y: e.y + v.y })).filter((v) => !g.isOpaque(v.x, v.y));
        attack(g, e, tiles, d.windup, { parryable: false, kind: 'heavy' });
      } else if (cheb > 1) step(g, e, 'toward');
      break;
    }

    case 'lunge': {
      const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
      if (e.cd <= 0 && cheb <= 3 && aligned) {
        const dir = { x: sign(dx), y: sign(dy) };
        const tiles: Vec[] = [];
        for (let s = 1; s <= 3; s++) {
          const tx = e.x + dir.x * s, ty = e.y + dir.y * s;
          if (g.isOpaque(tx, ty)) break;
          tiles.push({ x: tx, y: ty });
        }
        if (!tiles.length) break;
        e.face = dir;
        attack(g, e, tiles, d.windup, {
          after: () => {
            // dash along the line, stopping before obstacles
            for (const t of tiles) {
              if (!g.canEnemyEnter(e, t.x, t.y)) break;
              g.moveEnemy(e, t.x, t.y);
            }
            return false;
          },
        });
      } else if (cheb > 1) step(g, e, 'toward');
      break;
    }

    case 'ranged': {
      if (cheb <= 2) {
        if (!step(g, e, 'away') && cheb <= 1 && e.cd <= 0) attack(g, e, [{ x: p.x, y: p.y }], 8, { mult: 0.6 });
        break;
      }
      if (seen && cheb <= 9 && e.cd <= 0 && clearLine(g, e.x, e.y, p.x, p.y)) {
        const tx = p.x, ty = p.y;
        // aim line extends past the player until a wall
        const ex = e.x + (tx - e.x) * 4, ey = e.y + (ty - e.y) * 4;
        const path: Vec[] = [];
        for (const v of line(e.x, e.y, ex, ey).slice(1)) {
          if (g.isOpaque(v.x, v.y) || path.length > 14) break;
          path.push(v);
        }
        faceToward(e, tx, ty);
        attack(g, e, path, d.windup, {
          kind: 'aim', parryable: false, mult: 0,
          after: () => {
            const pj = d.proj ?? ['•', 0xe8dcc0];
            g.spawnProjectile(e.x, e.y, tx, ty, 0.6, e.dmg, pj[0], pj[1]);
            g.sfxAt('arrow', e.x, e.y);
            return false;
          },
        });
      } else if (cheb > 6 || !seen) step(g, e, 'toward');
      break;
    }

    case 'cast': {
      if (cheb <= 2 && g.rng.chance(0.04)) {
        blink(g, e);
        break;
      }
      if (seen && cheb <= 7 && e.cd <= 0) {
        const tiles: Vec[] = [];
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) if (!g.isOpaque(p.x + xx, p.y + yy)) tiles.push({ x: p.x + xx, y: p.y + yy });
        attack(g, e, tiles, d.windup, {
          kind: 'fire', parryable: false, burn: true,
          after: () => {
            for (const t of tiles) g.addField(t.x, t.y, 'fire', 50);
            g.sfxAt('fire', tiles[0]?.x ?? e.x, tiles[0]?.y ?? e.y);
            return false;
          },
        });
      } else if (cheb < 3) step(g, e, 'away');
      else if (cheb > 5 || !seen) step(g, e, 'toward');
      break;
    }

    case 'explode': {
      if (cheb <= 1) {
        const tiles: Vec[] = [];
        for (let yy = -1; yy <= 1; yy++)
          for (let xx = -1; xx <= 1; xx++) if (!g.isOpaque(e.x + xx, e.y + yy)) tiles.push({ x: e.x + xx, y: e.y + yy });
        attack(g, e, tiles, d.windup, {
          kind: 'blast', parryable: false, hitsEnemies: true, poison: true,
          after: () => {
            for (const t of tiles) g.addField(t.x, t.y, 'acid', 60);
            g.shake = 3;
            g.sfxAt('boom', e.x, e.y);
            g.killEnemy(e, true);
            return true;
          },
        });
      } else step(g, e, 'toward');
      break;
    }
  }
}

function blink(g: Game, e: Enemy): void {
  const p = g.player;
  for (let t = 0; t < 40; t++) {
    const x = p.x + g.rng.int(-6, 6), y = p.y + g.rng.int(-6, 6);
    const c = Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
    if (c < 4) continue;
    if (!g.inBounds(x, y) || g.vis[y * g.floor.w + x] <= 0) continue;
    if (!g.canEnemyEnter(e, x, y)) continue;
    g.addFx(e.x, e.y, '*', 0xd060a0, 6);
    g.moveEnemy(e, x, y);
    g.addFx(e.x, e.y, '*', 0xd060a0, 6);
    e.cd = Math.min(e.cd, 6);
    return;
  }
}

// ======================================================================= bosses
function bossCanStand(g: Game, e: Enemy, cx: number, cy: number): boolean {
  const r = g.floor.bossRoom!;
  const p = g.player;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!g.inRoom(x, y, r)) return false;
      const t = g.tileAt(x, y);
      if (t !== T.FLOOR && t !== T.STAIRS) return false;
      if (x === p.x && y === p.y) return false;
      const o = g.enemyAt(x, y);
      if (o && o !== e) return false;
    }
  return true;
}

function bossStep(g: Game, e: Enemy): void {
  if (e.moveT > 0) {
    e.moveT--;
    return;
  }
  const p = g.player;
  let best: Vec | null = null;
  let bd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
  for (const d of DIRS) {
    const nx = e.x + d.x, ny = e.y + d.y;
    if (!bossCanStand(g, e, nx, ny)) continue;
    const dd = (nx - p.x) ** 2 + (ny - p.y) ** 2;
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  if (best) {
    e.x += best.x;
    e.y += best.y;
    e.face = { x: best.x, y: best.y };
  }
  e.moveT = e.speed;
}

function arenaFilter(g: Game, tiles: Vec[]): Vec[] {
  const r = g.floor.bossRoom!;
  const seen = new Set<number>();
  const out: Vec[] = [];
  for (const v of tiles) {
    if (!g.inRoom(v.x, v.y, r) || g.isOpaque(v.x, v.y)) continue;
    const k = v.y * 1000 + v.x;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function ring(e: Enemy, r1: number, r2: number): Vec[] {
  const out: Vec[] = [];
  for (let dy = -r2; dy <= r2; dy++)
    for (let dx = -r2; dx <= r2; dx++) {
      const c = Math.max(Math.abs(dx), Math.abs(dy));
      if (c >= r1 && c <= r2) out.push({ x: e.x + dx, y: e.y + dy });
    }
  return out;
}

function cone(e: Enemy, tx: number, ty: number, R: number, cosT: number): Vec[] {
  const out: Vec[] = [];
  const dx = tx - e.x, dy = ty - e.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      if (Math.max(Math.abs(xx), Math.abs(yy)) <= 1) continue;
      const l = Math.sqrt(xx * xx + yy * yy);
      if (l > R + 0.5) continue;
      if ((xx * ux + yy * uy) / l >= cosT) out.push({ x: e.x + xx, y: e.y + yy });
    }
  return out;
}

function scatter(g: Game, cx: number, cy: number, r: number, n: number): Vec[] {
  const out: Vec[] = [{ x: cx, y: cy }];
  for (let k = 0; k < n; k++) out.push({ x: cx + g.rng.int(-r, r), y: cy + g.rng.int(-r, r) });
  return out;
}

function bossAttack(
  g: Game, e: Enemy, tiles: Vec[], windup: number, mult: number, kind: string,
  extra: Partial<Tele> = {}, after?: () => void,
): void {
  const w = Math.max(6, Math.round(windup * e.wmult));
  e.state = 'windup';
  e.t = w;
  g.sfx('bosswarn');
  g.addTele({
    tiles: arenaFilter(g, tiles), t: w, max: w, dmg: e.dmg * mult, owner: e, parryable: false, kind, ...extra,
    onFire: () => {
      if (e.dead) return;
      after?.();
      if (e.state === 'windup') {
        e.state = 'recover';
        e.t = e.phase ? 10 : 16;
        e.cd = g.rng.int(4, 14) - e.phase * 3;
      }
    },
  });
}

export function updateBoss(g: Game, e: Enemy): void {
  tickCommon(e);
  if (!g.bossActive) return;
  const B = BOSSES[e.boss!];
  if (e.state === 'stagger') {
    if (--e.t <= 0) e.state = 'chase';
    return;
  }
  if (e.state === 'windup') return;
  if (e.state === 'recover') {
    if (--e.t <= 0) e.state = 'chase';
    return;
  }
  const p = g.player;
  const dx = p.x - e.x, dy = p.y - e.y;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));

  if (e.phase === 0 && e.hp < e.maxHp * 0.5) {
    e.phase = 1;
    e.wmult = 0.75;
    e.speed = Math.max(3, e.speed - 2);
    g.banner = { text: spaced(B.name), sub: B.phaseLine, color: 0xff5040, t: 50, max: 50 };
    g.log(B.phaseLine, 0xff6050);
    g.sfx('roar');
    g.shake = 8;
    bossAttack(g, e, ring(e, 2, 3), 22, 1.2, 'boss');
    return;
  }

  if (e.cd > 0) {
    if (dist > 2) bossStep(g, e);
    return;
  }

  const opts: [string, number][] = [];
  switch (e.boss) {
    case 'warden':
      if (dist <= 3) opts.push(['cleave', 5], ['slam', 3]);
      if (dist >= 4) opts.push(['charge', 5]);
      if (e.phase) opts.push(['chains', 3]);
      break;
    case 'mother':
      if (dist <= 3) opts.push(['crush', 5]);
      if (dist <= 8) opts.push(['spew', 4]);
      if (e.birthCd <= 0) opts.push(['birth', 4]);
      if (e.phase) opts.push(['rain', 3]);
      break;
    case 'choir':
      opts.push(['hymn', 4], ['volley', 4]);
      if (dist <= 3) opts.push(['cleave', 3]);
      if (e.birthCd <= 0) opts.push(['summon', 3]);
      if (e.phase) opts.push(['requiem', 4]);
      break;
    case 'king':
      if (dist <= 3) opts.push(['sweep', 5]);
      opts.push(['soulfire', 3]);
      if (dist >= 4) opts.push(['blink', 4]);
      if (e.phase) opts.push(['cross', 3]);
      break;
  }
  if (!opts.length) {
    bossStep(g, e);
    return;
  }
  const choice = g.rng.weighted(opts);
  faceToward(e, p.x, p.y);
  const tx = p.x, ty = p.y;

  switch (choice) {
    // ---------------------------------------------------- warden
    case 'cleave':
      bossAttack(g, e, cone(e, tx, ty, 3, 0.45), 14, 1, 'boss');
      break;
    case 'slam':
      bossAttack(g, e, ring(e, 2, 3), 18, 1.3, 'boss', {}, () => { g.shake = 6; g.sfx('boom'); });
      break;
    case 'charge': {
      const dir = { x: sign(dx), y: sign(dy) };
      let lx = e.x, ly = e.y;
      const tiles: Vec[] = [];
      for (let s = 1; s <= 14; s++) {
        const nx = e.x + dir.x * s, ny = e.y + dir.y * s;
        if (!bossCanStandIgnoringPlayer(g, e, nx, ny)) break;
        lx = nx;
        ly = ny;
        for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) tiles.push({ x: nx + xx, y: ny + yy });
      }
      if (!tiles.length) {
        bossStep(g, e);
        break;
      }
      bossAttack(g, e, tiles, 16, 1.1, 'boss', {}, () => {
        // stop short if the player is standing in the landing zone
        let fx = lx, fy = ly;
        while ((fx !== e.x || fy !== e.y) && !bossCanStand(g, e, fx, fy)) {
          fx -= dir.x;
          fy -= dir.y;
        }
        e.x = fx;
        e.y = fy;
        g.shake = 5;
        g.sfx('boom');
      });
      break;
    }
    case 'chains':
      bossAttack(g, e, scatter(g, tx, ty, 4, 14), 20, 0.8, 'boss');
      break;

    // ---------------------------------------------------- mother
    case 'crush':
      bossAttack(g, e, ring(e, 2, 3), 16, 1.2, 'boss', {}, () => { g.shake = 6; g.sfx('boom'); });
      break;
    case 'spew': {
      const tiles = cone(e, tx, ty, 7, 0.75);
      bossAttack(g, e, tiles, 14, 0.7, 'acid', { poison: true }, () => {
        for (const t of arenaFilter(g, tiles)) g.addField(t.x, t.y, 'acid', 70);
      });
      break;
    }
    case 'birth':
      e.birthCd = 160;
      bossAttack(g, e, [], 12, 0, 'boss', {}, () => {
        const n = e.phase ? 4 : 3;
        for (let k = 0; k < n; k++) {
          const m = g.spawnEnemyNear('maggot', e.x, e.y, 2, 3);
          if (m) {
            m.aware = true;
            m.state = 'chase';
            m.cd = 12;
          }
        }
        g.log('Pale things wriggle free of her folds.', 0xd0c890);
        g.sfx('kill');
      });
      break;
    case 'rain': {
      const tiles = scatter(g, tx, ty, 5, 16);
      bossAttack(g, e, tiles, 22, 0.8, 'acid', { poison: true }, () => {
        for (const t of arenaFilter(g, tiles)) g.addField(t.x, t.y, 'acid', 60);
      });
      break;
    }

    // ---------------------------------------------------- choir
    case 'hymn': {
      // concentric rings of song with quiet gaps between them; in phase two a second wave fills the gaps
      const rings = (rs: number[]) => rs.flatMap((r) => ring(e, r, r));
      if (e.phase) {
        const w2 = Math.max(6, Math.round(30 * e.wmult));
        g.addTele({ tiles: arenaFilter(g, rings([3, 5, 7])), t: w2, max: w2, dmg: e.dmg * 0.8, owner: e, parryable: false, kind: 'boss' });
      }
      bossAttack(g, e, rings([2, 4, 6]), 18, 0.8, 'boss', {}, () => g.sfx('bell'));
      g.log(e.phase ? 'The Choir sings in two voices. Find the silence, then find it again.' : 'The Choir draws breath, all seven of them at once. Find the silence between the notes.', 0xc8a0f8);
      break;
    }
    case 'volley':
      bossAttack(g, e, [], 12, 0, 'boss', {}, () => {
        const pp = g.player;
        const base = Math.atan2(pp.y - e.y, pp.x - e.x);
        const n = e.phase ? 7 : 5;
        for (let k = 0; k < n; k++) {
          const a = base + (k - (n - 1) / 2) * 0.22;
          g.spawnProjectile(e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2, e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, 0.5, e.dmg * 0.6, '♪', 0xd0a0ff);
        }
      });
      break;
    case 'summon':
      e.birthCd = 220;
      bossAttack(g, e, [], 14, 0, 'boss', {}, () => {
        for (let k = 0; k < 2; k++) {
          const m = g.spawnEnemyNear('choirling', e.x, e.y, 3, 5);
          if (m) {
            m.aware = true;
            m.state = 'chase';
            m.cd = 20;
          }
        }
        g.log('Two more voices step out of the dark to join the hymn.', 0xc8a0f8);
      });
      break;
    case 'requiem': {
      // checkerboard: stand on the quiet squares
      const r = g.floor.bossRoom!;
      const tiles: Vec[] = [];
      const parity = (tx + ty) & 1;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (((x + y) & 1) === parity) tiles.push({ x, y });
      bossAttack(g, e, tiles, 20, 1, 'boss', {}, () => { g.shake = 4; g.sfx('boom'); });
      g.log('The floor hums. Every other stone is singing.', 0xc8a0f8);
      break;
    }

    // ---------------------------------------------------- king
    case 'sweep':
      bossAttack(g, e, cone(e, tx, ty, 3, 0.15), 12, 1, 'boss');
      break;
    case 'blink': {
      const cands: Vec[] = [];
      for (let yy = -4; yy <= 4; yy++)
        for (let xx = -4; xx <= 4; xx++) {
          const c = Math.max(Math.abs(xx), Math.abs(yy));
          if (c < 3) continue;
          if (bossCanStand(g, e, tx + xx, ty + yy)) cands.push({ x: tx + xx, y: ty + yy });
        }
      if (!cands.length) {
        bossStep(g, e);
        break;
      }
      const c = g.rng.pick(cands);
      for (let k = 0; k < 6; k++) g.addFx(e.x + g.rng.int(-1, 1), e.y + g.rng.int(-1, 1), '*', 0xb080f0, 6);
      e.x = c.x;
      e.y = c.y;
      g.sfx('parry');
      bossAttack(g, e, ring(e, 2, 3), 15, 1.1, 'boss', {}, () => { g.shake = 5; g.sfx('boom'); });
      break;
    }
    case 'soulfire':
      bossAttack(g, e, [], 12, 0, 'boss', {}, () => {
        const dirs: Vec[] = [...DIRS8];
        if (e.phase) dirs.push({ x: 2, y: 1 }, { x: 1, y: 2 }, { x: -1, y: 2 }, { x: -2, y: 1 }, { x: -2, y: -1 }, { x: -1, y: -2 }, { x: 1, y: -2 }, { x: 2, y: -1 });
        g.sfx('fire');
        for (const d of dirs) g.spawnProjectile(e.x + sign(d.x) * 2, e.y + sign(d.y) * 2, e.x + d.x * 10, e.y + d.y * 10, 0.45, e.dmg * 0.7, '*', 0xc080ff);
      });
      break;
    case 'cross': {
      const r = g.floor.bossRoom!;
      const tiles: Vec[] = [];
      for (let x = r.x; x < r.x + r.w; x++) tiles.push({ x, y: ty });
      for (let y = r.y; y < r.y + r.h; y++) tiles.push({ x: tx, y });
      bossAttack(g, e, tiles, 20, 1.1, 'boss', {}, () => { g.shake = 4; g.sfx('boom'); });
      break;
    }
  }
}

function bossCanStandIgnoringPlayer(g: Game, e: Enemy, cx: number, cy: number): boolean {
  const r = g.floor.bossRoom!;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!g.inRoom(x, y, r)) return false;
      const t = g.tileAt(x, y);
      if (t !== T.FLOOR && t !== T.STAIRS) return false;
    }
  return true;
}
