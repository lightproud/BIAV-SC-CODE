// 环行记 — 核心逻辑层（环境无关：浏览器 <script> 与 node import 共用）
// 不依赖 DOM / fetch，纯数据 in / 状态 out，保证可 headless 测试。
(function (root) {
  'use strict';

  // ---- 确定性 RNG（mulberry32），让测试可复现 ----
  function createRNG(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const REALM_THRESHOLD = { chaos: 2, aequor: 3, caro: 3, ultra: 3 };
  const REALM_NAME = { chaos: '混沌', aequor: '深海', caro: '血肉', ultra: '超维' };

  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function indexBy(arr, key) { const m = {}; for (const o of arr) m[o[key]] = o; return m; }

  // ---- 创建一局游戏 ----
  function createGame(config, charId, seed, world) {
    const rng = createRNG(seed || 1);
    const chars = indexBy(config.characters.characters, 'id');
    const weapons = indexBy(config.weapons.weapons, 'id');
    const ch = chars[charId] || config.characters.characters[0];
    const w = world || { w: 960, h: 600 };

    const state = {
      config, rng, weapons, chars,
      world: w,
      time: 0,
      status: 'playing', // playing | levelup | won | lost
      player: {
        x: w.w / 2, y: w.h / 2, radius: 12,
        hp: 100, maxHp: 100, speed: 130, baseSpeed: 130,
        level: 1, xp: 0, xpToNext: 9,
        pickup: 60, regen: 0,
        realm: ch.realm, charId: ch.id, charName: ch.name,
        passive: ch.passive, passiveDesc: ch.passiveDesc,
        contactCd: {},
        weapons: [],
        passiveLevels: {},
        // 累计加成
        damageMul: 1, areaMul: 1, cooldownMul: 1,
        scalingBonus: 0, scalingTimer: 0,
      },
      enemies: [], projectiles: [], enemyShots: [], orbs: [],
      orbitAngle: 0,
      spawnTimer: 0, bossSpawned: false, kills: 0,
      pendingUpgrades: null,
      resonance: null,
      lastHitDamage: 0,
    };

    addWeapon(state, ch.startWeapon);
    recomputeDerived(state);
    return state;
  }

  function addWeapon(state, weaponId) {
    const def = state.weapons[weaponId];
    if (!def) return;
    state.player.weapons.push({ id: weaponId, level: 1, def, timer: 0 });
  }

  // ---- 派生数值：被动 + 角色天赋 + 共鸣 ----
  function recomputeDerived(state) {
    const p = state.player;
    const ups = indexBy(state.config.upgrades.passives, 'id');
    let maxHp = 100, speed = 130, dmg = 1, area = 1, cd = 1, pickup = 60, regen = 0;
    for (const [id, lvl] of Object.entries(p.passiveLevels)) {
      const u = ups[id]; if (!u) continue;
      if (u.stat === 'maxHp') maxHp += u.value * lvl;
      else if (u.stat === 'speed') speed += u.value * lvl;
      else if (u.stat === 'damageMul') dmg += u.value * lvl;
      else if (u.stat === 'areaMul') area += u.value * lvl;
      else if (u.stat === 'cooldownMul') cd += u.value * lvl;
      else if (u.stat === 'pickup') pickup += u.value * lvl;
      else if (u.stat === 'regen') regen += u.value * lvl;
    }
    // 角色天赋
    const pv = p.passive || {};
    if (pv.type === 'area_up') area += pv.value;
    // 共鸣
    const res = computeResonance(p.weapons);
    state.resonance = res;
    if (res) dmg += res.damageBonus;
    // 拉蒙娜回响积累
    dmg += p.scalingBonus;

    p.maxHp = maxHp;
    p.hp = Math.min(p.hp, maxHp);
    p.speed = speed;
    p.damageMul = Math.max(0.1, dmg);
    p.areaMul = Math.max(0.2, area);
    p.cooldownMul = Math.max(0.3, cd);
    p.pickup = pickup;
    p.regen = regen;
  }

  // 纯界域共鸣：混沌为通配（可与任何界域协同），且自身门槛降为 2
  function computeResonance(weaponsArr) {
    const counts = {};
    for (const w of weaponsArr) counts[w.def.realm] = (counts[w.def.realm] || 0) + 1;
    const wild = counts.chaos || 0;
    let best = null;
    for (const realm of Object.keys(REALM_THRESHOLD)) {
      let eff, own;
      if (realm === 'chaos') { own = counts.chaos || 0; eff = own; }
      else { own = counts[realm] || 0; eff = own + wild; }
      if (own >= 1 && eff >= REALM_THRESHOLD[realm]) {
        if (!best || eff > best.eff) best = { realm, eff, damageBonus: realm === 'chaos' ? 0.12 : 0.2 };
      }
    }
    if (best) best.name = REALM_NAME[best.realm];
    return best;
  }

  // ---- 有效武器参数（套用 areaMul / cooldownMul / 角色天赋）----
  function weaponStat(state, w) {
    const p = state.player, b = w.def.base, pl = w.def.perLevel || {}, lv = w.level - 1;
    const v = (k, d) => (b[k] != null ? b[k] : d) + (pl[k] || 0) * lv;
    const out = {
      damage: v('damage', 0) * p.damageMul,
      count: Math.round(v('count', 1)),
      radius: v('radius', 0) * p.areaMul,
      cooldown: Math.max(0.08, v('cooldown', 1) * p.cooldownMul),
      tick: v('tick', 0.25),
      rotSpeed: v('rotSpeed', 2.5),
      speed: v('speed', 300),
      life: v('life', 1.5),
      lifesteal: b.lifesteal || 0,
    };
    if (p.passive && p.passive.type === 'extra_projectile' &&
        (w.def.behavior === 'homing')) out.count += p.passive.value;
    return out;
  }

  // ---- 主步进 ----
  function stepGame(state, dt, inputDir) {
    if (state.status !== 'playing') return;
    const p = state.player;
    state.time += dt;

    // 拉蒙娜回响积累
    if (p.passive && p.passive.type === 'scaling_damage') {
      p.scalingTimer += dt;
      if (p.scalingTimer >= p.passive.interval) {
        p.scalingTimer -= p.passive.interval;
        p.scalingBonus += p.passive.value;
        recomputeDerived(state);
      }
    }

    // 移动
    let dx = inputDir.x, dy = inputDir.y;
    const m = Math.hypot(dx, dy);
    if (m > 0) { dx /= m; dy /= m; }
    p.x = clamp(p.x + dx * p.speed * dt, p.radius, state.world.w - p.radius);
    p.y = clamp(p.y + dy * p.speed * dt, p.radius, state.world.h - p.radius);

    if (p.regen) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    stepSpawning(state, dt);
    stepWeapons(state, dt);
    stepProjectiles(state, dt);
    stepEnemies(state, dt);
    stepEnemyShots(state, dt);
    stepOrbs(state, dt);

    if (p.hp <= 0) { p.hp = 0; state.status = 'lost'; }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ---- 生成导演 ----
  function stepSpawning(state, dt) {
    const cfg = state.config.waves, p = state.player, minutes = state.time / 60;
    // Boss
    if (!state.bossSpawned && state.time >= cfg.boss.at) {
      spawnEnemy(state, cfg.boss.id, true);
      state.bossSpawned = true;
    }
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    if (cfg.maxEnemies && state.enemies.length >= cfg.maxEnemies) { state.spawnTimer = 0.2; return; }
    const interval = Math.max(cfg.spawnIntervalMin,
      cfg.spawnIntervalBase - cfg.spawnIntervalDecayPerMin * minutes);
    state.spawnTimer = interval;
    const batch = Math.round(cfg.batchBase + cfg.batchPerMin * minutes);
    const pool = currentPool(cfg, state.time);
    for (let i = 0; i < batch; i++) {
      const id = pool[Math.floor(state.rng() * pool.length)];
      spawnEnemy(state, id, false);
    }
  }

  function currentPool(cfg, time) {
    let pool = cfg.phases[0].pool;
    for (const ph of cfg.phases) if (time >= ph.from) pool = ph.pool;
    return pool;
  }

  function spawnEnemy(state, id, isBoss) {
    const def = indexBy(state.config.enemies.enemies, 'id')[id];
    if (!def) return;
    const minutes = state.time / 60;
    const hpMul = 1 + state.config.waves.hpScalePerMin * minutes;
    const ang = state.rng() * Math.PI * 2;
    const r = Math.max(state.world.w, state.world.h) * 0.62;
    const e = {
      id, name: def.name, def,
      x: state.player.x + Math.cos(ang) * r,
      y: state.player.y + Math.sin(ang) * r,
      hp: def.hp * (isBoss ? 1 : hpMul), maxHp: def.hp * (isBoss ? 1 : hpMul),
      radius: def.radius, speed: def.speed, color: def.color,
      ai: def.ai, boss: !!def.boss, shootTimer: 0, summonTimer: 0,
    };
    state.enemies.push(e);
  }

  // ---- 武器 ----
  function stepWeapons(state, dt) {
    const p = state.player;
    state.orbitAngle += dt * 2.6;
    for (const w of p.weapons) {
      const s = weaponStat(state, w);
      const beh = w.def.behavior;
      if (beh === 'orbit') {
        w.timer += dt;
        if (w.timer >= s.tick) {
          w.timer = 0;
          for (let i = 0; i < s.count; i++) {
            const a = state.orbitAngle + (i / s.count) * Math.PI * 2;
            const bx = p.x + Math.cos(a) * s.radius, by = p.y + Math.sin(a) * s.radius;
            damageEnemiesAt(state, bx, by, 22 * p.areaMul, s.damage, 0);
          }
        }
      } else if (beh === 'aura') {
        w.timer += dt;
        if (w.timer >= s.tick) {
          w.timer = 0;
          const healed = damageEnemiesAt(state, p.x, p.y, s.radius, s.damage, 0);
          if (s.lifesteal && healed > 0)
            p.hp = Math.min(p.maxHp, p.hp + healed * s.lifesteal);
        }
      } else if (beh === 'homing') {
        w.timer += dt;
        if (w.timer >= s.cooldown) {
          w.timer = 0;
          const targets = nearestEnemies(state, s.count);
          for (let i = 0; i < s.count; i++) {
            const t = targets[i % Math.max(1, targets.length)];
            let vx = 0, vy = -1;
            if (t) { const d = Math.hypot(t.x - p.x, t.y - p.y) || 1; vx = (t.x - p.x) / d; vy = (t.y - p.y) / d; }
            else { const a = state.rng() * Math.PI * 2; vx = Math.cos(a); vy = Math.sin(a); }
            state.projectiles.push({
              kind: 'homing', x: p.x, y: p.y, vx: vx * s.speed, vy: vy * s.speed,
              damage: s.damage, life: s.life, radius: 7, realm: w.def.realm,
            });
          }
        }
      } else if (beh === 'nova') {
        w.timer += dt;
        if (w.timer >= s.cooldown) {
          w.timer = 0;
          state.projectiles.push({
            kind: 'nova', x: p.x, y: p.y, radius: 0, maxRadius: s.radius,
            grow: s.radius / 0.45, damage: s.damage, hit: new Set(), realm: w.def.realm,
          });
        }
      }
    }
  }

  function damageEnemiesAt(state, x, y, radius, dmg, pierceUnused) {
    let dealt = 0;
    const rr = radius * radius;
    for (const e of state.enemies) {
      const rad = (radius + e.radius);
      if (dist2(x, y, e.x, e.y) <= rad * rad) { e.hp -= dmg; dealt += dmg; }
    }
    return dealt;
  }

  function nearestEnemies(state, n) {
    const p = state.player;
    return state.enemies
      .map(e => ({ e, d: dist2(p.x, p.y, e.x, e.y) }))
      .sort((a, b) => a.d - b.d).slice(0, Math.max(1, n)).map(o => o.e);
  }

  function stepProjectiles(state, dt) {
    const alive = [];
    for (const pr of state.projectiles) {
      if (pr.kind === 'homing') {
        pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
        let hitOne = false;
        for (const e of state.enemies) {
          const rad = pr.radius + e.radius;
          if (dist2(pr.x, pr.y, e.x, e.y) <= rad * rad) { e.hp -= pr.damage; hitOne = true; break; }
        }
        if (!hitOne && pr.life > 0 &&
            pr.x > -40 && pr.x < state.world.w + 40 && pr.y > -40 && pr.y < state.world.h + 40)
          alive.push(pr);
      } else if (pr.kind === 'nova') {
        pr.radius += pr.grow * dt;
        for (const e of state.enemies) {
          if (pr.hit.has(e)) continue;
          const inner = pr.radius - 18, outer = pr.radius + e.radius;
          const d = Math.sqrt(dist2(pr.x, pr.y, e.x, e.y));
          if (d <= outer && d >= Math.max(0, inner)) { e.hp -= pr.damage; pr.hit.add(e); }
        }
        if (pr.radius < pr.maxRadius) alive.push(pr);
      }
    }
    state.projectiles = alive;
  }

  // ---- 敌人 ----
  function stepEnemies(state, dt) {
    const p = state.player;
    const survivors = [];
    for (const e of state.enemies) {
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (e.ai === 'ranged') {
        const keep = e.def.keepDist || 200;
        const dir = d > keep ? 1 : (d < keep - 40 ? -1 : 0);
        e.x += (dx / d) * e.speed * dir * dt;
        e.y += (dy / d) * e.speed * dir * dt;
        e.shootTimer -= dt;
        if (e.shootTimer <= 0) {
          e.shootTimer = e.def.shootCooldown;
          state.enemyShots.push({
            x: e.x, y: e.y, vx: (dx / d) * e.def.shotSpeed, vy: (dy / d) * e.def.shotSpeed,
            damage: e.def.shotDamage, radius: 6,
          });
        }
      } else {
        e.x += (dx / d) * e.speed * dt;
        e.y += (dy / d) * e.speed * dt;
        if (e.ai === 'boss') {
          e.summonTimer -= dt;
          if (e.summonTimer <= 0) { e.summonTimer = e.def.summonCooldown; spawnEnemy(state, e.def.summon, false); }
        }
      }
      // 接触伤害
      const rad = e.radius + p.radius;
      if (d <= rad) {
        const key = e.__id || (e.__id = ++state._eid || (state._eid = 1));
        const cd = p.contactCd[key] || 0;
        if (cd <= 0) {
          applyPlayerDamage(state, e.def.damage, e);
          p.contactCd[key] = 0.5;
        }
      }
      const k = e.__id;
      if (k != null && p.contactCd[k] > 0) p.contactCd[k] -= dt;

      if (e.hp <= 0) { onEnemyDeath(state, e); }
      else survivors.push(e);
    }
    state.enemies = survivors;
  }

  function applyPlayerDamage(state, dmg, source) {
    const p = state.player;
    p.hp -= dmg;
    state.lastHitDamage = dmg;
    // 潘狄娅反击
    if (p.passive && p.passive.type === 'thorns' && source)
      source.hp -= dmg * p.passive.value * p.damageMul;
  }

  function onEnemyDeath(state, e) {
    state.kills++;
    if (e.def.onDeath === 'burst') {
      const d = Math.hypot(state.player.x - e.x, state.player.y - e.y);
      if (d < e.radius + 40) applyPlayerDamage(state, e.def.damage, null);
    }
    state.orbs.push({ x: e.x, y: e.y, xp: e.def.xp });
    if (e.boss) state.status = 'won';
  }

  function stepEnemyShots(state, dt) {
    const p = state.player, alive = [];
    for (const s of state.enemyShots) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      const rad = s.radius + p.radius;
      if (dist2(s.x, s.y, p.x, p.y) <= rad * rad) { applyPlayerDamage(state, s.damage, null); continue; }
      if (s.x > -30 && s.x < state.world.w + 30 && s.y > -30 && s.y < state.world.h + 30) alive.push(s);
    }
    state.enemyShots = alive;
  }

  // ---- 灵知 orb 拾取 + 升级 ----
  function stepOrbs(state, dt) {
    const p = state.player, alive = [];
    for (const o of state.orbs) {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < p.pickup) {
        const pull = 260 * dt;
        if (d < 16) { gainXp(state, o.xp); continue; }
        o.x += (p.x - o.x) / d * pull; o.y += (p.y - o.y) / d * pull;
      }
      alive.push(o);
    }
    state.orbs = alive;
  }

  function gainXp(state, xp) {
    const p = state.player;
    p.xp += xp;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level++;
      p.xpToNext = 5 + p.level * 4;
      triggerLevelUp(state);
    }
  }

  function triggerLevelUp(state) {
    state.pendingUpgrades = rollUpgrades(state);
    if (state.pendingUpgrades.length) state.status = 'levelup';
  }

  // ---- 升级池 ----
  function rollUpgrades(state) {
    const p = state.player, cands = [];
    const owned = new Set(p.weapons.map(w => w.id));
    for (const w of p.weapons)
      if (w.level < w.def.maxLevel)
        cands.push({ kind: 'weapon_up', id: w.id, name: w.def.name + ' Lv' + (w.level + 1), desc: w.def.desc, realm: w.def.realm });
    if (p.weapons.length < 6)
      for (const w of state.config.weapons.weapons)
        if (!owned.has(w.id))
          cands.push({ kind: 'weapon_new', id: w.id, name: '新武器 · ' + w.name, desc: w.desc, realm: w.realm });
    for (const u of state.config.upgrades.passives) {
      const lv = p.passiveLevels[u.id] || 0;
      if (lv < u.max) cands.push({ kind: 'passive', id: u.id, name: u.name + (lv ? ' +' : ''), desc: u.desc });
    }
    shuffle(cands, state.rng);
    const pick = cands.slice(0, 3);
    if (!pick.length) pick.push({ kind: 'heal', id: 'heal', name: '缝合', desc: '回复 40% 生命' });
    return pick;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function applyUpgrade(state, opt) {
    const p = state.player;
    if (opt.kind === 'weapon_new') addWeapon(state, opt.id);
    else if (opt.kind === 'weapon_up') { const w = p.weapons.find(x => x.id === opt.id); if (w) w.level++; }
    else if (opt.kind === 'passive') p.passiveLevels[opt.id] = (p.passiveLevels[opt.id] || 0) + 1;
    else if (opt.kind === 'heal') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4);
    recomputeDerived(state);
    state.pendingUpgrades = null;
    if (state.status === 'levelup') state.status = 'playing';
  }

  const API = {
    createRNG, createGame, stepGame, applyUpgrade, rollUpgrades,
    computeResonance, recomputeDerived, weaponStat, REALM_NAME,
  };
  root.RingCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
