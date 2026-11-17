(function () {
  const BIND = {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    sprint: ['ShiftLeft', 'ShiftRight', 'TouchSprint'],
    pass: ['KeyJ', 'KeyZ'],        // a ground pass, never lifted, never a shot
    lob: ['Space', 'KeyK'],        // chip / lofted pass (slide on defence)
    shoot: ['KeyC'],
    shootOnly: ['KeyL'],
    start: ['Enter', 'NumpadEnter'],
    pause: ['KeyP', 'Escape'],     // Esc while holding a pass cancels it instead
    cancel: ['Escape'],
    restart: ['KeyR'],
    fullcourt: ['KeyF'],
    mute: ['KeyM'],
  };
  const GAME_KEYS = new Set(Object.values(BIND).flat());
  const BIND_LOB = [...BIND.lob, 'Mouse2', 'TouchSlide'], BIND_CLICK = ['Mouse0', 'TouchKick', 'TouchTap'];

  const I = (PP.Input = {
    keys: {}, pr: {}, rel: {},
    init() {
      addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey) return; // leave browser shortcuts (Cmd+R etc.) alone
        if (GAME_KEYS.has(e.code)) e.preventDefault();
        if (e.repeat) return;
        this.keys[e.code] = true;
        this.pr[e.code] = true;
      });
      addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
        this.rel[e.code] = true;
      });
      addEventListener('blur', () => { this.keys = {}; });
      // Mouse: position (canvas pixels) for pointer aiming, or raw movement while the pointer
      // is locked (relative aiming); buttons as virtual keys.
      const cv = (this.canvas = document.getElementById('game'));
      this.mouse = null; this.mdx = 0; this.mdy = 0;
      cv.addEventListener('mousemove', (e) => {
        if (this.locked()) { this.mdx += e.movementX; this.mdy += e.movementY; return; }
        const r = cv.getBoundingClientRect();
        this.mouse = { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
      });
      cv.addEventListener('mouseleave', () => { this.mouse = null; });
      cv.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (this.wantLock && this.wantLock() && !this.locked()) { this.lock(); return; } // first click just grabs the mouse
        const k = 'Mouse' + e.button; if (!this.keys[k]) this.pr[k] = true; this.keys[k] = true;
      });
      addEventListener('mouseup', (e) => { const k = 'Mouse' + e.button; if (this.keys[k]) this.rel[k] = true; this.keys[k] = false; });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      // Touch: raw fingers in canvas pixels; PP.Touch turns them into gestures each frame.
      this.touches = new Map(); this.touchAx = null; this.tapped = false;
      const pos = (t) => {
        const r = cv.getBoundingClientRect();
        return { x: ((t.clientX - r.left) / r.width) * cv.width, y: ((t.clientY - r.top) / r.height) * cv.height };
      };
      cv.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.usedTouch = true; this.tapped = true;
        for (const t of e.changedTouches) {
          const q = pos(t);
          this.touches.set(t.identifier, { id: t.identifier, x: q.x, y: q.y, x0: q.x, y0: q.y, t0: performance.now() / 1000, role: null, up: false });
        }
        if (this.onTouch) this.onTouch();
      }, { passive: false });
      cv.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) { const o = this.touches.get(t.identifier); if (o) Object.assign(o, pos(t)); }
      }, { passive: false });
      const end = (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) { const o = this.touches.get(t.identifier); if (o) { Object.assign(o, pos(t)); o.up = true; } }
      };
      cv.addEventListener('touchend', end, { passive: false });
      cv.addEventListener('touchcancel', end, { passive: false });
    },
    locked() { return document.pointerLockElement === this.canvas; },
    lock() {
      try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed yet */ }
    },
    unlock() { if (this.locked()) document.exitPointerLock(); },
    takeMouseDelta() { const d = { x: this.mdx, y: this.mdy }; this.mdx = 0; this.mdy = 0; return d; },
    // Mouse buttons: left = 'click' (shot if you click the goal, else a pass; tackle on
    // defence), right = lofted.
    bind(a) {
      if (a === 'lob') return BIND_LOB;
      if (a === 'click') return BIND_CLICK;
      return BIND[a];
    },
    down(a) { return this.bind(a).some((k) => this.keys[k]); },
    hit(a) { return this.bind(a).some((k) => this.pr[k]); },
    released(a) { return this.bind(a).some((k) => this.rel[k]); },
    axis() {
      const ta = this.touchAx;
      if (ta && !['up', 'down', 'left', 'right'].some((a) => this.down(a))) return ta;
      let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
      let y = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      return { x, y };
    },
    // Edge-triggered flags are consumed once per simulation step.
    endStep() { this.pr = {}; this.rel = {}; this.tapped = false; },
  });
})();
