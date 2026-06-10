// 整局模拟（headless playtest）：简易躲避 AI + 自动选卡，验证全程无崩溃 + 平衡观感。
// 用法：node test/playthrough.mjs [charId]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../src/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const Core = globalThis.RingCore;
const load = (n) => JSON.parse(readFileSync(join(root, 'config', n + '.json'), 'utf8'));
const config = { characters: load('characters'), weapons: load('weapons'), enemies: load('enemies'), waves: load('waves'), upgrades: load('upgrades') };

// 选卡偏好：优先凑同界域共鸣，其次强化武器，再次拿遗物
function pickUpgrade(state) {
  const opts = state.pendingUpgrades;
  const realm = state.player.realm;
  const score = (o) => {
    let s = 0;
    if (o.realm === realm) s += 3;
    if (o.kind === 'weapon_up') s += 2;
    if (o.kind === 'weapon_new') s += 1;
    if (o.kind === 'passive') s += 1;
    return s;
  };
  opts.sort((a, b) => score(b) - score(a));
  Core.applyUpgrade(state, opts[0]);
}

// 真人级打法 AI：绕场环行（把怪群拖成彗星尾，武器顺势收割）+ 近敌微斥力 + 拾取顺路灵知
function decideDir(state) {
  const p = state.player, cx = state.world.w / 2, cy = state.world.h / 2;
  const ang = Math.atan2(p.y - cy, p.x - cx);
  const ringR = 200;
  // 切向环行（顺时针）
  let fx = -Math.sin(ang), fy = Math.cos(ang);
  // 维持半径
  const r = Math.hypot(p.x - cx, p.y - cy) || 1;
  const radialErr = (ringR - r) / ringR;
  fx += Math.cos(ang) * radialErr * 1.2; fy += Math.sin(ang) * radialErr * 1.2;
  // 近敌微斥力（避免迎面撞进尾巴）
  for (const e of state.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d > 70) continue;
    const w = (e.boss ? 4 : 1.5) / (d * d) * 2200;
    fx += (dx / d) * w; fy += (dy / d) * w;
  }
  const m = Math.hypot(fx, fy) || 1;
  return { x: fx / m, y: fy / m };
}

const charId = process.argv[2] || 'ramona';
const s = Core.createGame(config, charId, 12345);
const DT = 1 / 30; // 粗步长加速模拟
let frames = 0, peakEnemies = 0, lvlAt = {};
while (s.status === 'playing' || s.status === 'levelup') {
  if (s.status === 'levelup') { lvlAt[s.player.level] = Math.floor(s.time); pickUpgrade(s); continue; }
  Core.stepGame(s, DT, decideDir(s));
  peakEnemies = Math.max(peakEnemies, s.enemies.length);
  frames++;
  if (frames > 600 * 35) { console.error('超时未结束'); process.exit(1); }
}

const tt = Math.floor(s.time);
console.log(`角色 ${s.player.charName} (${s.player.realm})`);
console.log(`结果 ${s.status === 'won' ? '胜利' : '失败'} · 存活 ${String(Math.floor(tt / 60)).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}`);
console.log(`等级 ${s.player.level} · 击杀 ${s.kills} · 武器数 ${s.player.weapons.length} · 峰值同屏敌人 ${peakEnemies}`);
console.log(`共鸣 ${s.resonance ? Core.REALM_NAME[s.resonance.realm] + ' +' + Math.round(s.resonance.damageBonus * 100) + '%' : '无'}`);
console.log(`武器 ${s.player.weapons.map(w => w.def.name + 'Lv' + w.level).join(' / ')}`);
