// Active talents, the talent screen, thrall AI, and the bow.
import type { Game } from './game.ts';
import { T, DIRS, DIRS8, type Enemy, type Vec } from './types.ts';
import { TALENT_BY_ID, TALENTS, PATHS, canLearn, respecCost } from './talents.ts';
import { weaponBase, makeItem, ONE_HANDED, INV_MAX } from './loot.ts';

export const SKILL_KEYS = ['U', 'O', 'P'];

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const has = (g: Game, id: string) => g.player.talents.includes(id);
const foes = (g: Game) => g.enemies.filter((e) => !e.dead && !e.ally);

/** Per-tick upkeep: cooldowns, buffs, thrall lifetimes. */
export function tickSkills(g: Game): void {
  const p = g.player;
  for (const k of Object.keys(p.cds)) if (p.cds[k] > 0) p.cds[k]--;
  const b = p.buffs;
  if (b.warcry > 0) b.warcry--;
  if (b.aim > 0) b.aim--;
  if (b.boneT > 0 && --b.boneT === 0) {
    b.bone = 0;
    g.log('The bone armor crumbles away.', 0x9ad0a0);
  }
}

/** Damage multiplier from active buffs and conditional passives. */
export function skillDamageMult(g: Game): number {
  const p = g.player;
  let m = 1;
  if (p.buffs.warcry > 0) m *= 1.3;
  if (has(g, 'laststand') && p.hp < g.stats.maxHp * 0.3) m *= 1.35;
  return m;
}

// ===================================================================== using skills
export function useSkill(g: Game, slot: number): void {
  const p = g.player;
  const id = p.slots[slot];
  if (!id) {
    g.log(`Nothing bound to [${SKILL_KEYS[slot]}]. Open talents with T.`, 0x8a8478);
    return;
  }
  const t = TALENT_BY_ID[id];
  if (p.act && !(t.kind === 'toggle' && p.guard)) return;
  if (t.kind === 'toggle') return toggleShield(g);
  if ((p.cds[id] ?? 0) > 0) {
    g.log(`${t.name} is not ready (${Math.ceil(p.cds[id] / 20)}s).`, 0x8a8478);
    return;
  }
  const w = p.eq.weapon;
  if (t.needs === 'bow' && w?.base !== 'bow') {
    g.log(`${t.name} needs a bow in your hands.`, 0x8a8478);
    return;
  }
  if (t.sta && p.sta <= 0) {
    g.log('Too exhausted.', 0x808060);
    return;
  }
  const blood = t.hp ? Math.round(g.stats.maxHp * t.hp) : 0;
  if (blood && p.hp <= blood + 1) {
    g.log('Your blood runs too thin to pay for that.', 0xa04040);
    return;
  }
  p.guard = false;
  const done = CAST[id]?.(g);
  if (done === false) return; // the skill fizzled (no target, no corpse): nothing is spent
  if (t.sta) g.spendSta(t.sta);
  if (blood) {
    p.hp -= blood;
    g.addFx(p.x, p.y - 1, `-${blood}`, 0xa03030, 6);
  }
  if (t.cd) p.cds[id] = t.cd;
}

function toggleShield(g: Game): void {
  const p = g.player;
  if (p.guard) {
    p.guard = false;
    return;
  }
  if (!ONE_HANDED.has(p.eq.weapon?.base ?? '')) {
    g.log('You need a hand free for the shield: wield a sword, dagger, mace or spear.', 0x8a8478);
    return;
  }
  p.guard = true;
  g.sfx('clank');
}

function aimDir(g: Game): Vec {
  return { ...g.player.face };
}

/** Fire a player projectile; damage is worked out at impact through playerHit. */
export function shoot(g: Game, dir: Vec, opts: { mult?: number; pierce?: number; glyph?: string; color?: number; speed?: number; onHit?: (e: Enemy) => void; spell?: number } = {}): void {
  const p = g.player;
  const b = weaponBase(p.eq.weapon);
  const len = Math.hypot(dir.x, dir.y) || 1;
  const speed = opts.speed ?? 0.9;
  const aim = p.buffs.aim > 0;
  if (aim) p.buffs.aim = 0;
  g.projs.push({
    x: p.x, y: p.y, vx: (dir.x / len) * speed, vy: (dir.y / len) * speed, dmg: 0,
    glyph: opts.glyph ?? (dir.x === 0 ? '|' : dir.y === 0 ? '─' : dir.x === dir.y ? '\\' : '/'), color: opts.color ?? 0xe8dcc0,
    life: 24, friendly: true, pierce: (opts.pierce ?? 0) + (has(g, 'deadeye') && opts.spell === undefined ? 1 : 0), hits: [], sx: p.x, sy: p.y,
    onHit: (e) => {
      if (opts.spell !== undefined) g.hurtEnemy(e, opts.spell * skillDamageMult(g), 6, { fromPlayer: true });
      else {
        let mult = opts.mult ?? 1;
        if (has(g, 'deadeye')) mult *= 1.2;
        if (has(g, 'patience')) mult *= 1 + Math.min(0.6, 0.05 * Math.hypot(e.x - p.x, e.y - p.y));
        g.playerHit(e, false, b, mult, aim);
      }
      opts.onHit?.(e);
    },
  });
  g.sfx('arrow');
}

const CAST: Record<string, (g: Game) => boolean | void> = {
  // ---------------------------------------------------------------- gravecaller
  gravebolt: (g) => {
    const p = g.player;
    shoot(g, aimDir(g), { spell: 10 + p.level * 2.2, glyph: '•', color: 0xb8f0b0, speed: 0.8 });
    g.sfx('fire');
    p.act = { kind: 'recover', t: 6, dir: p.face };
  },
  raise: (g) => {
    const p = g.player;
    const f = g.floor;
    const corpses = nearCorpses(g, 5);
    const living = g.enemies.filter((e) => e.ally && !e.dead).length;
    if (!corpses.length) {
      g.log('There are no dead here to answer you.', 0x8a8478);
      return false;
    }
    let raised = 0;
    for (const c of corpses) {
      if (living + raised >= 2) break;
      if (g.enemyAt(c.x, c.y) || (c.x === p.x && c.y === p.y)) continue;
      const th = g.makeEnemy('hollow', c.x, c.y, false, 1);
      th.ally = true;
      th.name = 'Thrall';
      th.hp = th.maxHp = 24 + p.level * 7;
      th.dmg = 4 + p.level * 0.9;
      th.speed = 4;
      th.birthCd = 600; // lifetime: 30 seconds
      th.state = 'chase';
      th.aware = true;
      g.enemies.push(th);
      f.decal[c.y * f.w + c.x] = 1;
      g.addFx(c.x, c.y, '*', 0x9ad0a0, 8);
      raised++;
    }
    if (!raised) return false;
    g.log(raised > 1 ? 'Two of the dead get up when you ask.' : 'One of the dead gets up when you ask.', 0x9ad0a0);
    g.sfx('bossintro');
    p.act = { kind: 'recover', t: 10, dir: p.face };
  },
  corpse: (g) => {
    const p = g.player;
    const f = g.floor;
    const c = nearCorpses(g, 7)[0];
    if (!c) {
      g.log('No corpse close enough to burst.', 0x8a8478);
      return false;
    }
    f.decal[c.y * f.w + c.x] = 1;
    const dmg = (18 + p.level * 3) * skillDamageMult(g);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx, y = c.y + dy;
        g.addFx(x, y, '*', 0xd04040, 5);
        g.bloodSpray(x, y, 1);
        const e = g.enemyAt(x, y);
        if (e && !e.ally) g.hurtEnemy(e, dmg, 30, { fromPlayer: true });
      }
    g.shake = 3;
    g.sfx('boom');
    p.act = { kind: 'recover', t: 8, dir: p.face };
  },
  bonearmor: (g) => {
    const p = g.player;
    p.buffs.bone = Math.round(g.stats.maxHp * 0.3);
    p.buffs.boneT = 240;
    g.log('Ribs close around you like a cage.', 0x9ad0a0);
    g.sfx('crumble');
    p.act = { kind: 'recover', t: 8, dir: p.face };
  },
  harvest: (g) => {
    const p = g.player;
    let drained = 0;
    for (const e of foes(g)) {
      if (Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) > 4 + (e.size > 1 ? 1 : 0)) continue;
      const d = e.maxHp * (e.boss ? 0.03 : 0.12);
      drained += d;
      g.addFx(e.x, e.y - 1, '~', 0xc04040, 8);
      g.hurtEnemy(e, d, 0, { fromPlayer: true });
    }
    if (!drained) {
      g.log('Nothing near enough to harvest.', 0x8a8478);
      return false;
    }
    const heal = Math.min(g.stats.maxHp * 0.4, drained);
    p.hp = Math.min(g.stats.maxHp, p.hp + heal);
    g.addFx(p.x, p.y - 1, `+${Math.round(heal)}`, 0x60ff80, 10);
    g.log('You drink from everything around you.', 0xc04040);
    g.sfx('roar');
    p.act = { kind: 'recover', t: 12, dir: p.face };
  },
  // ---------------------------------------------------------------- dark ranger
  volley: (g) => {
    const p = g.player;
    const d = aimDir(g);
    const a = Math.atan2(d.y, d.x);
    for (const off of [-0.28, 0, 0.28]) shoot(g, { x: Math.cos(a + off), y: Math.sin(a + off) }, { mult: 0.8 });
    p.act = { kind: 'recover', t: 10, dir: p.face };
  },
  pin: (g) => {
    const p = g.player;
    shoot(g, aimDir(g), {
      mult: 1.1, color: 0xffe080,
      onHit: (e) => {
        if (e.dead) return;
        if (e.boss) {
          e.poise -= 60;
          if (e.poise <= 0) {
            e.poise = e.maxPoise;
            g.staggerEnemy(e, 45);
          }
        } else g.staggerEnemy(e, 60);
        e.bleed += 40;
        g.addFx(e.x, e.y - 1, 'PINNED', 0xffe080, 10);
      },
    });
    p.act = { kind: 'recover', t: 9, dir: p.face };
  },
  disengage: (g) => {
    const p = g.player;
    const back = { x: -p.face.x, y: -p.face.y };
    let moved = 0;
    for (let s = 0; s < 3; s++) {
      const nx = p.x + back.x, ny = p.y + back.y;
      const t = g.tileAt(nx, ny);
      if (!g.isWalkTile(t) || t === T.ENTRANCE || t === T.UPSTAIRS || t === T.STAIRS || g.enemyAt(nx, ny) || g.blockObjAt(nx, ny) || g.npcAt(nx, ny)) break;
      p.x = nx;
      p.y = ny;
      moved++;
    }
    if (!moved) {
      g.log('No room to leap back.', 0x8a8478);
      return false;
    }
    p.iframes = 8;
    p.buffs.aim = 40;
    g.onPlayerEnter();
    g.sfx('roll');
    p.act = { kind: 'recover', t: 4, dir: p.face };
  },
  blackarrow: (g) => {
    const p = g.player;
    p.act = { kind: 'skill', t: 10, dir: { ...p.face }, skill: 'blackarrow' };
    g.log('You draw the black arrow...', 0x9090a0);
  },
  // ---------------------------------------------------------------- cutpurse
  smoke: (g) => {
    const p = g.player;
    let lost = 0;
    for (const e of foes(g)) {
      if (e.boss || Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) > 6) continue;
      lose(g, e);
      lost++;
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g.addFx(p.x + dx, p.y + dy, '░', 0x9a9aa0, 14);
    g.log(lost ? 'Grey smoke. When it clears, they have forgotten where you were.' : 'Grey smoke, and no one to hide from.', 0x9a9aa0);
    g.sfx('fire');
    p.act = { kind: 'recover', t: 6, dir: p.face };
  },
  step: (g) => {
    const p = g.player;
    let best: Enemy | null = null;
    let bd = 99;
    for (const e of foes(g)) {
      if (e.boss || g.vis[e.y * g.floor.w + e.x] <= 0) continue;
      const d = Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y));
      if (d <= 6 && d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) {
      g.log('No one close enough to step behind.', 0x8a8478);
      return false;
    }
    // the tile behind it, relative to where it is looking at you
    const fx = sign(p.x - best.x) || best.face.x, fy = sign(p.y - best.y) || best.face.y;
    const cands = [{ x: best.x - fx, y: best.y - fy }, { x: best.x - fx, y: best.y }, { x: best.x, y: best.y - fy }, ...DIRS8.map((d) => ({ x: best!.x + d.x, y: best!.y + d.y }))];
    const spot = cands.find((c) => g.isWalkTile(g.tileAt(c.x, c.y)) && !g.enemyAt(c.x, c.y) && !g.blockObjAt(c.x, c.y) && !g.npcAt(c.x, c.y));
    if (!spot) return false;
    g.addFx(p.x, p.y, '░', 0x8898d0, 6);
    p.x = spot.x;
    p.y = spot.y;
    p.face = { x: sign(best.x - p.x), y: sign(best.y - p.y) };
    if (p.face.x && p.face.y) p.face.y = 0;
    best.face = { x: -sign(best.x - p.x) || best.face.x, y: -sign(best.y - p.y) || best.face.y };
    lose(g, best);
    g.onPlayerEnter();
    g.sfx('roll');
  },
  // ---------------------------------------------------------------- disgraced
  bash: (g) => {
    const p = g.player;
    const x = p.x + p.face.x, y = p.y + p.face.y;
    const e = g.enemyAt(x, y);
    g.addFx(x, y, '#', 0xd0a868, 4);
    g.sfx('clank');
    p.act = { kind: 'recover', t: 8, dir: p.face };
    if (!e || e.ally) return;
    if (e.boss) {
      e.poise -= 70;
      if (e.poise <= 0) {
        e.poise = e.maxPoise;
        g.staggerEnemy(e, 45);
        g.log(`${e.name} staggers!`, 0xffe060);
      }
    } else g.staggerEnemy(e, 45);
    g.hurtEnemy(e, (6 + p.level) * skillDamageMult(g), 0, { fromPlayer: true });
    g.shake = 2;
  },
  warcry: (g) => {
    const p = g.player;
    for (const e of foes(g)) if (!e.boss && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= 5) g.staggerEnemy(e, 40);
    p.buffs.warcry = 200;
    g.log('You roar the old regiment\'s cry. Nobody answers it but you.', 0xd0a868);
    g.sfx('roar');
    g.shake = 4;
    p.act = { kind: 'recover', t: 10, dir: p.face };
  },
};

/** Make an enemy forget you entirely: it becomes backstabbable. */
function lose(g: Game, e: Enemy): void {
  e.state = 'idle';
  e.aware = false;
  e.lostT = 0;
  e.blind = 50;
  e.alertT = 0;
  g.teles = g.teles.filter((t) => t.owner !== e || t.persist);
}

function nearCorpses(g: Game, r: number): Vec[] {
  const f = g.floor, p = g.player;
  const out: (Vec & { d: number })[] = [];
  for (let y = p.y - r; y <= p.y + r; y++)
    for (let x = p.x - r; x <= p.x + r; x++) {
      if (!g.inBounds(x, y) || f.decal[y * f.w + x] !== 2 || g.vis[y * f.w + x] <= 0) continue;
      out.push({ x, y, d: Math.hypot(x - p.x, y - p.y) });
    }
  return out.sort((a, b) => a.d - b.d);
}

/** Resolve a skill that has a draw/wind-up (PAction kind 'skill'). */
export function resolveSkill(g: Game, skill: string, dir: Vec): void {
  const p = g.player;
  if (skill === 'blackarrow') {
    shoot(g, dir, { mult: 3, pierce: 99, glyph: dir.x ? '═' : '║', color: 0x6a6a8a, speed: 1.1 });
    g.shake = 2;
    p.act = { kind: 'recover', t: 8, dir };
  }
}

// ===================================================================== thralls
export function updateThrall(g: Game, e: Enemy): void {
  if (e.flash > 0) e.flash--;
  if (e.cd > 0) e.cd--;
  if (--e.birthCd <= 0) {
    e.dead = true;
    g.addFx(e.x, e.y, '∙', 0x9ad0a0, 6);
    return;
  }
  let target: Enemy | null = null;
  let bd = 1e9;
  for (const o of g.enemies) {
    if (o.dead || o.ally) continue;
    const d = Math.max(Math.abs(o.x - e.x), Math.abs(o.y - e.y)) - (o.size > 1 ? 1 : 0);
    if (d < bd && d <= 10) {
      bd = d;
      target = o;
    }
  }
  const p = g.player;
  if (target && bd <= 1) {
    if (e.cd <= 0) {
      g.hurtEnemy(target, e.dmg, 8, {});
      g.addFx(target.x, target.y, '/', 0x9ad0a0, 2);
      e.cd = 14;
    }
    return;
  }
  if (e.moveT > 0) {
    e.moveT--;
    return;
  }
  const goal = target ?? (Math.max(Math.abs(p.x - e.x), Math.abs(p.y - e.y)) > 3 ? p : null);
  if (!goal) return;
  let best: Vec | null = null;
  let bdist = (e.x - goal.x) ** 2 + (e.y - goal.y) ** 2;
  for (const d of DIRS) {
    const nx = e.x + d.x, ny = e.y + d.y;
    if (!g.canEnemyEnter(e, nx, ny)) continue;
    const dd = (nx - goal.x) ** 2 + (ny - goal.y) ** 2;
    if (dd < bdist) {
      bdist = dd;
      best = d;
    }
  }
  if (best) g.moveEnemy(e, e.x + best.x, e.y + best.y);
  e.moveT = e.speed;
}

// ===================================================================== talent screen
export function talentList(): typeof TALENTS[] {
  return PATHS.map((p) => TALENTS.filter((t) => t.path === p.id));
}

export function talentInput(g: Game, key: string, raw: string): void {
  const p = g.player;
  const cols = talentList();
  if (key === 'esc' || key === 'talents') {
    g.mode = 'play';
    return;
  }
  if (key === 'left') g.talentCol = (g.talentCol + 3) % 4;
  else if (key === 'right') g.talentCol = (g.talentCol + 1) % 4;
  else if (key === 'up') g.talentRow = (g.talentRow + 5) % 6;
  else if (key === 'down') g.talentRow = (g.talentRow + 1) % 6;
  if (['left', 'right', 'up', 'down'].includes(key)) {
    g.sfx('menu');
    return;
  }
  const t = cols[g.talentCol][g.talentRow];
  if (key === 'enter' || key === 'interact') {
    const why = canLearn(p.talents, p.talentPoints, t);
    if (why) {
      g.log(why, 0x8a8478);
      g.sfx('locked');
      return;
    }
    p.talentPoints -= t.cost;
    p.talents.push(t.id);
    g.recalc();
    g.log(`You remember: ${t.name}.`, PATHS.find((x) => x.id === t.path)!.color);
    g.sfx('levelup');
    if (t.kind !== 'passive') {
      const free = p.slots.indexOf(null);
      if (free >= 0) p.slots[free] = t.id;
    }
    if (t.path === 'ranger' && !p.inv.some((i) => i.base === 'bow') && p.eq.weapon?.base !== 'bow') {
      const bow = makeItem(g.rng, Math.max(1, g.progressTier()), 0, 'weapon', 'bow');
      if (p.inv.length < INV_MAX) p.inv.push(bow);
      g.log('You remember where you hid your old bow. It is in your pack.', 0xc0c070);
    }
    g.save();
    return;
  }
  if (raw >= '1' && raw <= '3') {
    if (!p.talents.includes(t.id) || t.kind === 'passive') {
      g.log('Only learned active talents can be bound.', 0x8a8478);
      return;
    }
    const k = +raw - 1;
    const prev = p.slots.indexOf(t.id);
    if (prev >= 0) p.slots[prev] = null;
    p.slots[k] = t.id;
    g.log(`${t.name} bound to [${SKILL_KEYS[k]}].`, 0xd0c8a0);
    g.sfx('select');
  }
}

/** At a bonfire: forget every talent for ashes, and get every point back. */
export function respec(g: Game): void {
  const p = g.player;
  const cost = respecCost(p.level);
  if (!p.talents.length) {
    g.log('You have nothing to forget. Yet.', 0x8a8478);
    return;
  }
  if (p.ashes < cost) {
    g.log(`Forgetting costs ${cost} ashes. The flame wants payment for everything.`, 0x8a8478);
    g.sfx('locked');
    return;
  }
  p.ashes -= cost;
  p.talentPoints += p.talents.reduce((n, id) => n + TALENT_BY_ID[id].cost, 0);
  p.talents = [];
  p.slots = [null, null, null];
  p.guard = false;
  g.recalc();
  g.log('You stare into the flame until you forget who you were pretending to be.', 0xffa040);
  g.sfx('rest');
}
