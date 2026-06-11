// 环行记 — 键盘输入（浏览器）。WASD / 方向键移动，Esc/P 暂停。
(function (root) {
  'use strict';
  function createInput() {
    const keys = {};
    const state = { paused: false };
    const onDown = (e) => {
      keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') state.paused = !state.paused;
    };
    const onUp = (e) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);

    function dir() {
      let x = 0, y = 0;
      if (keys['a'] || keys['arrowleft']) x -= 1;
      if (keys['d'] || keys['arrowright']) x += 1;
      if (keys['w'] || keys['arrowup']) y -= 1;
      if (keys['s'] || keys['arrowdown']) y += 1;
      return { x, y };
    }
    return { dir, state };
  }
  root.RingInput = { createInput };
})(typeof globalThis !== 'undefined' ? globalThis : this);
