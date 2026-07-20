// 环行记 — 渲染层（浏览器）。只负责把 state 画到 canvas，不改 state。
(function (root) {
  'use strict';
  const S = root.RingSprites;

  function renderWorld(ctx, state, t) {
    const w = state.world.w, h = state.world.h, p = state.player;
    S.drawBackground(ctx, w, h, t);

    // 武器光环（aura）范围提示，画在底层
    for (const wp of p.weapons) {
      if (wp.def.behavior === 'aura') {
        const st = root.RingCore.weaponStat(state, wp);
        S.drawAura(ctx, p.x, p.y, st.radius, 'rgba(239,68,68,0.10)');
      }
    }

    for (const o of state.orbs) S.drawOrb(ctx, o, t);
    for (const e of state.enemies) S.drawEnemy(ctx, e, t);
    for (const pr of state.projectiles) S.drawProjectile(ctx, pr, t);

    // 敌人投射物
    ctx.fillStyle = '#38bdf8';
    for (const sh of state.enemyShots) {
      ctx.save(); ctx.shadowColor = '#0ea5e9'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, sh.radius, 0, 6.3); ctx.fill(); ctx.restore();
    }

    // 环绕刃
    for (const wp of p.weapons) {
      if (wp.def.behavior === 'orbit') {
        const st = root.RingCore.weaponStat(state, wp);
        S.drawOrbitBlades(ctx, p.x, p.y, state.orbitAngle, st.count, st.radius);
      }
    }

    // 拾取范围淡环
    ctx.strokeStyle = 'rgba(94,234,212,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.pickup, 0, 6.3); ctx.stroke();

    S.drawPlayer(ctx, p.x, p.y, p.realm, t);
  }

  root.RingRender = { renderWorld };
})(typeof globalThis !== 'undefined' ? globalThis : this);
