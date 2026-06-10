// 环行记核心逻辑测试（node test/core.test.mjs）。无外部依赖。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import '../src/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const Core = globalThis.RingCore;

function load(name) { return JSON.parse(readFileSync(join(root, 'config', name + '.json'), 'utf8')); }
const config = {
  characters: load('characters'), weapons: load('weapons'),
  enemies: load('enemies'), waves: load('waves'), upgrades: load('upgrades'),
};

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function section(t) { console.log('\n[' + t + ']'); }

// 推进若干帧
function run(state, seconds, dt = 1 / 60, dir = { x: 0, y: 0 }, onLevel) {
  let acc = 0;
  while (acc < seconds) {
    if (state.status === 'levelup') { if (onLevel) onLevel(state); else autopick(state); }
    if (state.status === 'won' || state.status === 'lost') break;
    Core.stepGame(state, dt, dir);
    acc += dt;
  }
}
function autopick(state) {
  const opt = state.pendingUpgrades && state.pendingUpgrades[0];
  if (opt) Core.applyUpgrade(state, opt); else state.status = 'playing';
}

section('createGame 初始化');
{
  const s = Core.createGame(config, 'pandia', 42);
  ok(s.player.charId === 'pandia', '角色选择生效');
  ok(s.player.weapons.length === 1, '初始仅 1 把武器');
  ok(s.player.weapons[0].id === 'thorn_field', '潘狄娅初始武器=荆棘场');
  ok(s.player.hp === 100 && s.player.maxHp === 100, '初始 HP=100');
  ok(s.status === 'playing', '初始状态 playing');
}

section('生成导演产出敌人');
{
  const s = Core.createGame(config, 'ramona', 7);
  run(s, 6);
  ok(s.enemies.length > 0, '6 秒内生成了敌人');
  ok(s.enemies.every(e => e.id === 'husk'), '开局阶段只出蚀仆');
}

section('武器造成伤害 + 击杀掉灵知');
{
  const s = Core.createGame(config, 'pandia', 3); // 潘狄娅=荆棘场贴身光环，必中
  s.player.hp = 99999;
  s.enemies.push({ id: 'husk', name: '蚀仆', def: config.enemies.enemies[0],
    x: s.player.x + 40, y: s.player.y, hp: 5, maxHp: 5, radius: 12, speed: 0, color: '#888', ai: 'chase' });
  const before = s.kills;
  run(s, 3, 1 / 60, { x: 0, y: 0 });
  ok(s.kills > before, '武器击杀了敌人');
  ok(s.player.xp >= 1 || s.orbs.length >= 1, '击杀掉落灵知并转化为经验');
}

section('灵知拾取 → 升级 → 三选一');
{
  const s = Core.createGame(config, 'ramona', 11);
  // 直接灌经验触发升级
  s.player.x = 480; s.player.y = 300;
  for (let i = 0; i < 30; i++) s.orbs.push({ x: 480, y: 300, xp: 5 });
  let leveled = false;
  run(s, 1, 1 / 60, { x: 0, y: 0 }, (st) => {
    leveled = true;
    ok(st.pendingUpgrades.length >= 1 && st.pendingUpgrades.length <= 3, '升级给出 1-3 张命运卡');
    Core.applyUpgrade(st, st.pendingUpgrades[0]);
  });
  ok(leveled, '拾取灵知触发了升级');
  ok(s.player.level >= 2, '等级提升至 >=2');
}

section('共鸣：纯界域门槛');
{
  // 三把深海武器 → aequor 共鸣
  ok(Core.computeResonance([{ def: { realm: 'aequor' } }, { def: { realm: 'aequor' } }, { def: { realm: 'aequor' } }]).realm === 'aequor', '3 深海触发深海共鸣');
  // 混沌通配：2 深海 + 1 混沌 → 深海共鸣（chaos 补位）
  const r = Core.computeResonance([{ def: { realm: 'aequor' } }, { def: { realm: 'aequor' } }, { def: { realm: 'chaos' } }]);
  ok(r && r.realm === 'aequor', '混沌通配补足深海共鸣');
  // 2 混沌 → 混沌自身门槛 2
  ok(Core.computeResonance([{ def: { realm: 'chaos' } }, { def: { realm: 'chaos' } }]).realm === 'chaos', '2 混沌触发银钥共鸣');
  // 不足
  ok(Core.computeResonance([{ def: { realm: 'aequor' } }, { def: { realm: 'caro' } }]) === null, '混搭不足不触发');
}

section('共鸣加成提升伤害');
{
  const s = Core.createGame(config, 'thuru', 5); // 深海 触腕
  const base = s.player.damageMul;
  s.player.weapons.push({ id: 'tentacle', level: 1, def: s.weapons['tentacle'], timer: 0 });
  s.player.weapons.push({ id: 'tentacle', level: 1, def: s.weapons['tentacle'], timer: 0 });
  Core.recomputeDerived(s);
  ok(s.resonance && s.resonance.realm === 'aequor', '3 深海武器→共鸣激活');
  ok(s.player.damageMul > base, '共鸣后伤害倍率提升');
}

section('角色天赋：拉蒙娜回响积累');
{
  const s = Core.createGame(config, 'ramona', 9);
  s.player.hp = s.player.maxHp = 1e9; // 隔离：不被压死
  const base = s.player.scalingBonus;
  run(s, 31, 1 / 60, { x: 0, y: 0 });
  ok(s.player.scalingBonus > base, '30 秒后回响积累生效');
}

section('Boss 在终局生成且可胜利');
{
  const s = Core.createGame(config, 'dores', 4);
  s.time = 599.9;
  Core.stepGame(s, 0.2, { x: 0, y: 0 });
  ok(s.bossSpawned, '600 秒触发 Boss 生成');
  const boss = s.enemies.find(e => e.boss);
  ok(!!boss, 'Boss 已在场');
  s.player.hp = 1e9; // 防止同帧被怪压死
  boss.hp = 0; // 模拟最后一击致死
  Core.stepGame(s, 1 / 60, { x: 0, y: 0 });
  ok(s.status === 'won', 'Boss 阵亡→胜利');
}

section('失败条件');
{
  const s = Core.createGame(config, 'pandia', 2);
  s.player.hp = 1;
  s.enemies.push({ id: 'bloater', name: '壅肿', def: config.enemies.enemies[2],
    x: s.player.x, y: s.player.y, hp: 999, maxHp: 999, radius: 20, speed: 0, color: '#000', ai: 'chase' });
  run(s, 3, 1 / 60, { x: 0, y: 0 });
  ok(s.status === 'lost', '生命归零→失败');
}

console.log('\n===========================');
console.log(`通过 ${pass} · 失败 ${fail}`);
process.exit(fail ? 1 : 0);
