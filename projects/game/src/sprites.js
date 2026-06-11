// 环行记 — 程序化 Canvas 精灵层（浏览器）。按界域配色，自包含、零外部图。
(function (root) {
  'use strict';
  const REALM_COLOR = { chaos: '#8b5cf6', aequor: '#3b82f6', caro: '#ef4444', ultra: '#eab308' };

  function withShadow(ctx, color, blur, fn) {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; fn(); ctx.restore();
  }

  // 守密人/唤醒体：兜帽身影 + 界域核心光
  function drawPlayer(ctx, x, y, realm, t) {
    const c = REALM_COLOR[realm] || '#cbd5e1';
    ctx.save();
    ctx.translate(x, y);
    // 斗篷
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(13, -4, 11, 14);
    ctx.lineTo(-11, 14);
    ctx.quadraticCurveTo(-13, -4, 0, -14);
    ctx.fill();
    // 兜帽内阴影
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(0, -6, 7, 0, Math.PI * 2); ctx.fill();
    // 界域核心
    withShadow(ctx, c, 12, () => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, -6, 3.2 + Math.sin(t * 4) * 0.6, 0, Math.PI * 2); ctx.fill();
    });
    // 肩饰描边
    ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-11, 10); ctx.lineTo(11, 10); ctx.stroke();
    ctx.restore();
  }

  // 融蚀造物
  function drawEnemy(ctx, e, t) {
    const x = e.x, y = e.y, r = e.radius, col = e.color;
    ctx.save();
    ctx.translate(x, y);
    if (e.boss) { drawBoss(ctx, r, col, t); ctx.restore(); return; }
    // 融蚀躯体：抖动的暗色块
    withShadow(ctx, col, 8, () => {
      ctx.fillStyle = col;
      ctx.beginPath();
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wob = r * (0.82 + 0.18 * Math.sin(a * 3 + t * 6 + x));
        const px = Math.cos(a) * wob, py = Math.sin(a) * wob;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    });
    // 眼
    ctx.fillStyle = '#fde68a';
    const ey = r * 0.18;
    ctx.beginPath(); ctx.arc(-r * 0.28, -ey, r * 0.12, 0, 6.3); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.28, -ey, r * 0.12, 0, 6.3); ctx.fill();
    // HP 条（受伤时）
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-r, -r - 7, r * 2, 3);
      ctx.fillStyle = '#f87171'; ctx.fillRect(-r, -r - 7, r * 2 * (e.hp / e.maxHp), 3);
    }
    ctx.restore();
  }

  function drawBoss(ctx, r, col, t) {
    // 多眼领主
    withShadow(ctx, col, 20, () => {
      const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, '#a78bfa'); g.addColorStop(1, '#4c1d95');
      ctx.fillStyle = g;
      ctx.beginPath();
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wob = r * (0.85 + 0.15 * Math.sin(a * 4 + t * 3));
        const px = Math.cos(a) * wob, py = Math.sin(a) * wob;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = '#fef08a';
    for (let i = 0; i < 6; i++) {
      const a = t * 0.6 + i * Math.PI / 3;
      const ex = Math.cos(a) * r * 0.5, ey = Math.sin(a) * r * 0.5;
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.09, 0, 6.3); ctx.fill();
    }
    ctx.fillStyle = '#7f1d1d';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, 6.3); ctx.fill();
  }

  function drawOrb(ctx, o, t) {
    withShadow(ctx, '#5eead4', 8, () => {
      ctx.fillStyle = '#5eead4';
      ctx.beginPath(); ctx.arc(o.x, o.y, 3 + Math.sin(t * 6 + o.x) * 0.6, 0, 6.3); ctx.fill();
    });
  }

  function drawProjectile(ctx, pr, t) {
    const c = REALM_COLOR[pr.realm] || '#e2e8f0';
    if (pr.kind === 'homing') {
      withShadow(ctx, c, 10, () => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.radius, 0, 6.3); ctx.fill();
      });
      ctx.strokeStyle = c; ctx.globalAlpha = 0.4; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - pr.vx * 0.03, pr.y - pr.vy * 0.03); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (pr.kind === 'nova') {
      ctx.strokeStyle = c; ctx.globalAlpha = Math.max(0, 1 - pr.radius / pr.maxRadius);
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, pr.radius, 0, 6.3); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 环绕刃（混沌银钥），由 main 根据武器状态调用
  function drawOrbitBlades(ctx, px, py, angle, count, radius) {
    ctx.save();
    for (let i = 0; i < count; i++) {
      const a = angle + (i / count) * Math.PI * 2;
      const bx = px + Math.cos(a) * radius, by = py + Math.sin(a) * radius;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(a);
      withShadow(ctx, '#c4b5fd', 8, () => {
        ctx.fillStyle = '#ddd6fe';
        ctx.fillRect(-2, -8, 4, 16);
        ctx.fillRect(-5, 4, 10, 4);
      });
      ctx.restore();
    }
    ctx.restore();
  }

  // 武器光环（荆棘场 / 深渊），半透明范围提示
  function drawAura(ctx, px, py, radius, color) {
    ctx.save();
    const g = ctx.createRadialGradient(px, py, radius * 0.3, px, py, radius);
    g.addColorStop(0, 'rgba(239,68,68,0.02)');
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, 6.3); ctx.fill();
    ctx.restore();
  }

  function drawBackground(ctx, w, h, t) {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
    // 融蚀网格脉动
    ctx.strokeStyle = 'rgba(99,102,241,0.06)'; ctx.lineWidth = 1;
    const step = 48, off = (t * 6) % step;
    ctx.beginPath();
    for (let x = -off; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = -off; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  root.RingSprites = {
    REALM_COLOR, drawPlayer, drawEnemy, drawOrb, drawProjectile,
    drawOrbitBlades, drawAura, drawBackground,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
