// 环行记 — 装配 bootstrap（浏览器）。串起 config + core + render + input + DOM 界面。
(function (root) {
  'use strict';
  const Core = root.RingCore, Render = root.RingRender, Input = root.RingInput, S = root.RingSprites;
  const config = root.GAME_CONFIG;
  const REALM_NAME = { chaos: '混沌', aequor: '深海', caro: '血肉', ultra: '超维' };

  const $ = (id) => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const WORLD = { w: canvas.width, h: canvas.height };

  let state = null, input = null, lastT = 0, acc = 0, running = false;
  const DT = 1 / 60;

  // ---------- 角色选择 ----------
  function buildSelect() {
    const wrap = $('charlist');
    wrap.innerHTML = '';
    for (const ch of config.characters.characters) {
      const col = S.REALM_COLOR[ch.realm];
      const card = document.createElement('div');
      card.className = 'card char';
      card.style.borderColor = col;
      const wpName = config.weapons.weapons.find(w => w.id === ch.startWeapon)?.name || '';
      card.innerHTML =
        `<div class="badge" style="background:${col}">${REALM_NAME[ch.realm]}</div>` +
        `<div class="cname">${ch.name}</div>` +
        `<div class="ctitle">${ch.title}</div>` +
        `<div class="crow">初始武器：${wpName}</div>` +
        `<div class="cdesc">${ch.passiveDesc}</div>` +
        `<div class="clore">「${ch.lore}」</div>`;
      card.onclick = () => startGame(ch.id);
      wrap.appendChild(card);
    }
  }

  // ---------- 开始一局 ----------
  function startGame(charId) {
    state = Core.createGame(config, charId, (Date.now() & 0xffff) || 1, WORLD);
    input = Input.createInput();
    $('select').classList.add('hidden');
    $('end').classList.add('hidden');
    $('hud').classList.remove('hidden');
    running = true; lastT = performance.now(); acc = 0;
    requestAnimationFrame(loop);
  }

  // ---------- 主循环（固定步长） ----------
  function loop(now) {
    if (!running) return;
    const frame = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (state.status === 'levelup') { showLevelUp(); }
    else if (state.status === 'won' || state.status === 'lost') { endGame(); return; }
    else if (!input.state.paused) {
      acc += frame;
      while (acc >= DT) { Core.stepGame(state, DT, input.dir()); acc -= DT; if (state.status !== 'playing') break; }
    }

    Render.renderWorld(ctx, state, now / 1000);
    if (input.state.paused && state.status === 'playing') drawPauseHint();
    updateHud();
    requestAnimationFrame(loop);
  }

  function drawPauseHint() {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    ctx.fillStyle = '#e2e8f0'; ctx.font = '28px serif'; ctx.textAlign = 'center';
    ctx.fillText('已暂停 · 按 P / Esc 继续', WORLD.w / 2, WORLD.h / 2);
    ctx.textAlign = 'left';
  }

  // ---------- HUD ----------
  function updateHud() {
    const p = state.player;
    const tt = Math.floor(state.time), mm = String(Math.floor(tt / 60)).padStart(2, '0'),
      ss = String(tt % 60).padStart(2, '0');
    $('timer').textContent = mm + ':' + ss;
    $('level').textContent = 'Lv ' + p.level;
    $('kills').textContent = '击杀 ' + state.kills;
    $('hpbar').style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
    $('hptext').textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
    $('xpbar').style.width = (p.xp / p.xpToNext) * 100 + '%';
    const res = state.resonance;
    const rEl = $('reso');
    if (res) { rEl.textContent = REALM_NAME[res.realm] + '共鸣 +' + Math.round(res.damageBonus * 100) + '%'; rEl.style.color = S.REALM_COLOR[res.realm]; }
    else { rEl.textContent = '无共鸣'; rEl.style.color = '#64748b'; }
    // 武器图标行
    const wl = $('weplist'); wl.innerHTML = '';
    for (const w of p.weapons) {
      const d = document.createElement('span');
      d.className = 'wchip'; d.style.background = S.REALM_COLOR[w.def.realm];
      d.textContent = w.def.name + ' ' + w.level;
      wl.appendChild(d);
    }
  }

  // ---------- 升级三选一 ----------
  function showLevelUp() {
    if (!$('levelup').classList.contains('hidden')) return;
    const opts = state.pendingUpgrades;
    const box = $('cards'); box.innerHTML = '';
    for (const o of opts) {
      const col = o.realm ? S.REALM_COLOR[o.realm] : '#94a3b8';
      const card = document.createElement('div');
      card.className = 'card up'; card.style.borderColor = col;
      const tag = o.kind === 'weapon_new' ? '武器' : o.kind === 'weapon_up' ? '强化' : o.kind === 'passive' ? '遗物' : '恢复';
      card.innerHTML =
        `<div class="badge" style="background:${col}">${tag}</div>` +
        `<div class="upname">${o.name}</div>` +
        `<div class="updesc">${o.desc}</div>`;
      card.onclick = () => {
        Core.applyUpgrade(state, o);
        $('levelup').classList.add('hidden');
      };
      box.appendChild(card);
    }
    $('levelup').classList.remove('hidden');
  }

  // ---------- 结算 ----------
  function endGame() {
    running = false;
    const won = state.status === 'won';
    $('endtitle').textContent = won ? '幸存 · 融蚀领主已溃散' : '陨落 · 被世界遗忘';
    $('endtitle').style.color = won ? '#5eead4' : '#f87171';
    const tt = Math.floor(state.time);
    $('endstats').innerHTML =
      `存活 ${String(Math.floor(tt / 60)).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}` +
      ` · 等级 ${state.player.level} · 击杀 ${state.kills}`;
    $('hud').classList.add('hidden');
    $('end').classList.remove('hidden');
  }

  $('again').onclick = () => { $('end').classList.add('hidden'); $('select').classList.remove('hidden'); };

  buildSelect();
})(typeof globalThis !== 'undefined' ? globalThis : this);
