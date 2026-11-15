(function () {
  const BIND = {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    pass: ['KeyJ', 'KeyZ'],
    lob: ['KeyK', 'KeyX', 'Mouse2'],
    shoot: ['Space', 'KeyC', 'Mouse0'],
    shootOnly: ['KeyL'],
    start: ['Enter', 'NumpadEnter'],
    pause: ['KeyP', 'Escape'],
    restart: ['KeyR'],
    fullcourt: ['KeyF'],
    mute: ['KeyM'],
  };
  const GAME_KEYS = new Set(Object.values(BIND).flat());

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
      // Mouse: position (canvas pixels) for mouse aiming; buttons as virtual keys.
      const cv = document.getElementById('game');
      this.mouse = null;
      cv.addEventListener('mousemove', (e) => {
        const r = cv.getBoundingClientRect();
        this.mouse = { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
      });
      cv.addEventListener('mouseleave', () => { this.mouse = null; });
      cv.addEventListener('mousedown', (e) => { const k = 'Mouse' + e.button; if (!this.keys[k]) this.pr[k] = true; this.keys[k] = true; e.preventDefault(); });
      addEventListener('mouseup', (e) => { const k = 'Mouse' + e.button; if (this.keys[k]) this.rel[k] = true; this.keys[k] = false; });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    down(a) { return BIND[a].some((k) => this.keys[k]); },
    hit(a) { return BIND[a].some((k) => this.pr[k]); },
    released(a) { return BIND[a].some((k) => this.rel[k]); },
    axis() {
      let x = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
      let y = (this.down('down') ? 1 : 0) - (this.down('up') ? 1 : 0);
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      return { x, y };
    },
    // Edge-triggered flags are consumed once per simulation step.
    endStep() { this.pr = {}; this.rel = {}; },
  });
})();
