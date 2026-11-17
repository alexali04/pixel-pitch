(function () {
  const C = PP.C, U = PP.U;
  const PX = C.PX, PY = C.PY, PZ = C.PZ, VH = C.VIEW_H, M = C.MARGIN;
  let VW = C.VIEW_W; // phones widen the view to fill the screen (setWidth)
  // Perspective: the camera sits in the stands on the near touchline, so the far side of the
  // pitch is smaller than the near side. Lines running up the pitch (goal lines, box edges)
  // lean towards a vanishing point, which shows the goal mouths at an angle.
  const PERSP = 0.007;   // fractional scale change per metre of depth
  const TY = 4;          // pitch texture rows per metre (<= on-screen rows per metre, so no row is skipped)

  // 10x19 player sprites, facing right (mirrored for left). Built from a top (head+torso,
  // 11 rows), shorts (2 rows) and legs (6 rows).
  // H hair, S skin, s skin shade, E eye, T shirt, t shirt shade, P shorts, K socks, B boots.
  const HEAD = ['...HHH....', '..HHHHH...', '..HHSSS...', '..HSSES...', '...sSSS...'];
  const HEAD_LEAN = HEAD.map((r) => '.' + r.slice(0, 9)); // head forward when running
  const TORSO = {
    idle: ['..tTTTT...', '.ttTTTTT..', '.tTTTTTT..', '.STTTTTS..', '.S.TTT.S..', '..TTTTT...'],
    armA: ['..tTTTT...', '.ttTTTTTT.', '.tTTTTTTS.', 'StTTTTT...', 'S.TTTTT...', '..TTTTT...'], // near arm forward
    armB: ['..tTTTT...', 'tttTTTTT..', 'S.TTTTTT..', '.tTTTTTS..', '..TTTTTS..', '..TTTTT...'], // near arm back
    armsUp: ['S.tTTTT.S.', 'StTTTTTTS.', '.tTTTTTT..', '.tTTTTTT..', '..TTTTT...', '..TTTTT...'], // jumping to head it
  };
  // Arms: shirt pixels outside the body columns (2-6) are sleeves (A, shaded a), so a kit can
  // have different-coloured sleeves.
  for (const k of Object.keys(TORSO)) TORSO[k] = TORSO[k].map((row) => [...row].map((ch, i) => (i < 2 || i > 6 ? (ch === 'T' ? 'A' : ch === 't' ? 'a' : ch) : ch)).join(''));
  const SHORTS = { idle: ['..PPPPP...', '..PP.PP...'], wide: ['..PPPPP...', '.PPP.PPP..'], knee: ['..PPPPP...', '..PP.PPP..'] };
  // Legs are 6 rows (thigh, knee, two of shin, ankle, boot) so strides and kicks read clearly.
  const LEGS = {
    stand:  ['..SS.SS...', '..SS.SS...', '..KK.KK...', '..KK.KK...', '..KK.KK...', '..BB.BB...'],
    stride: ['..SS..SS..', '.SS....SS.', '.KK....KK.', 'KK......KK', 'KK......KK', 'BB......BB'], // both legs reaching
    kneeUp: ['..SS.SSS..', '..SS...SS.', '..KK...KK.', '..KK..KK..', '..KK......', '..BB......'], // front knee driving up
    heelUp: ['..SS.SS...', '.SS..SS...', 'KK...KK...', 'KK...KK...', 'BB...KK...', '.....BB...'], // back heel kicking up
    lunge:  ['..SS.SS...', '..SS..SS..', '..KK...SS.', '..KK....KK', '..KK.....K', '..BB.....B'], // leg stuck out to tackle
    kick:   ['..SS.SSSS.', '..SS....SK', '..KK.....B', '..KK......', '..KK......', '..BB......'], // striking the ball
  };
  // Run cycle: stride, drive the knee (airborne, body up 1px), stride, kick the heel.
  // Run cycle legs: near leg in kit colours (S/K), far leg shaded (q/k) so the stride reads.
  Object.assign(LEGS, {
    r0: ['..qq.SS...', '.qq...SS..', '.kk....KK.', 'kk.....KK.', 'kk......KK', 'BB......BB'], // near leg reaching forward
    r1: ['...SSqqq..', '...SS..qq.', '...KK..kk.', '...KK.kk..', '...KK.....', '...BB.....'], // planted; far knee drives through
    r2: ['..qq.SS...', '.qq...SS..', '.kk...KK..', 'kk.....KK.', 'B......KK.', '.......BB.'], // airborne
    r3: ['..SS.qq...', '.SS...qq..', '.KK....kk.', 'KK.....kk.', 'KK......kk', 'BB......BB'], // far leg reaching forward
    r4: ['...qqSSS..', '...qq..SS.', '...kk..KK.', '...kk.KK..', '...kk.....', '...BB.....'], // planted; near knee drives through
    r5: ['..SS.qq...', '.SS...qq..', '.KK...kk..', 'KK.....kk.', 'B......kk.', '.......BB.'], // airborne
  });
  const RUN = [
    { torso: 'armB', shorts: 'wide', legs: 'r0', bob: 0 },
    { torso: 'armB', shorts: 'knee', legs: 'r1', bob: 1 },
    { torso: 'idle', shorts: 'idle', legs: 'r2', bob: -1 },
    { torso: 'armA', shorts: 'wide', legs: 'r3', bob: 0 },
    { torso: 'armA', shorts: 'knee', legs: 'r4', bob: 1 },
    { torso: 'idle', shorts: 'idle', legs: 'r5', bob: -1 },
  ];
  const sprite = (head, torso, shorts, legs) => head.concat(TORSO[torso], SHORTS[shorts], LEGS[legs]);

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.cam = { x: C.W / 2, y: C.H / 2 };
      this.pitch = this.buildPitch();
      this.t = 0;
    }

    // Change the canvas width (same height), e.g. to match a phone's wide screen.
    setWidth(w) {
      if (w === VW) return;
      VW = C.VIEW_W = w;
      this.cv.width = w;
      this.ctx.imageSmoothingEnabled = false;
    }

    k(y) { return 1 + PERSP * (y - this.cam.y); }                 // scale at depth y
    sx(x, y) { return Math.round((x - this.cam.x) * PX * this.k(y) + VW / 2); }
    sy(y, z = 0) {
      const d = y - this.cam.y;
      return Math.round(VH / 2 + PY * (d + (PERSP * d * d) / 2) - z * PZ * this.k(y));
    }
    // Screen row -> world depth (inverse of sy at z = 0).
    rowToY(row) {
      const r = (row - VH / 2) / PY, q = 1 + 2 * PERSP * r;
      return q <= 0 ? null : this.cam.y + (-1 + Math.sqrt(q)) / PERSP;
    }

    // Screen pixel -> world point on the ground (for mouse aiming).
    screenToWorld(px, py) {
      const y = this.rowToY(py);
      if (y == null) return null;
      return { x: this.cam.x + (px - VW / 2) / (PX * this.k(y)), y };
    }

    // Draw the flat pitch texture row by row, each row scaled for its depth.
    drawPitch() {
      const g = this.ctx, tex = this.pitch;
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, VW, VH);
      for (let row = 0; row < VH; row++) {
        const y = this.rowToY(row + 0.5);
        if (y == null || y < -M || y > C.H + M) continue;
        const ty = Math.floor((y + M) * TY);
        const k = this.k(y), half = VW / 2 / (PX * k);
        const srcX = (this.cam.x - half + M) * PX, srcW = (2 * half) * PX;
        g.drawImage(tex, srcX, ty, srcW, 1, 0, row, VW, 1);
      }
    }

    buildPitch() {
      const w = Math.ceil((C.W + 2 * M) * PX), h = Math.ceil((C.H + 2 * M) * TY);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const X = (x) => Math.round((x + M) * PX), Y = (y) => Math.round((y + M) * TY);

      // Stands with a pixel crowd.
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, w, h);
      const crowd = ['#e4572e', '#f3a712', '#29335c', '#a8c686', '#f4f4f4', '#669bbc', '#2ec4b6', '#d7263d', '#8c6a5d', '#f0e2a3', '#3d405b'];
      for (let yy = 0; yy < h; yy += 3) {
        for (let xx = 0; xx < w; xx += 3) {
          const wx = xx / PX - M, wy = yy / TY - M;
          if (wx > -6 && wx < C.W + 6 && wy > -6 && wy < C.H + 6) continue;
          if (Math.random() < 0.7) {
            g.fillStyle = U.pick(crowd); g.fillRect(xx, yy, 2, 2);
            g.fillStyle = '#d9a77a'; g.fillRect(xx, yy - 1, 2, 1);
          }
        }
      }
      // Run-off and ad boards.
      g.fillStyle = '#2f7d2a'; g.fillRect(X(-6), Y(-6), X(C.W + 6) - X(-6), Y(C.H + 6) - Y(-6));
      const boards = ['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#5e548e', '#f4f4f4'];
      for (let x = -6, i = 0; x < C.W + 6; x += 8, i++) {
        g.fillStyle = boards[i % boards.length];
        g.fillRect(X(x), Y(-6) - 6, X(x + 8) - X(x), 6);
        g.fillRect(X(x), Y(C.H + 5), X(x + 8) - X(x), 6);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(X(x) + 8, Y(-6) - 4, 26, 2);
        g.fillRect(X(x) + 8, Y(C.H + 5) + 2, 26, 2);
      }
      for (let y = -6, i = 0; y < C.H + 6; y += 8, i++) {
        g.fillStyle = boards[(i + 3) % boards.length];
        g.fillRect(X(-6) - 3, Y(y), 3, Y(y + 8) - Y(y));
        g.fillRect(X(C.W + 6), Y(y), 3, Y(y + 8) - Y(y));
      }
      // Checkerboard mowing.
      const nx = 14, ny = 8;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const x0 = (i * C.W) / nx, x1 = ((i + 1) * C.W) / nx, y0 = -4 + (j * (C.H + 8)) / ny, y1 = -4 + ((j + 1) * (C.H + 8)) / ny;
          g.fillStyle = (i + j) % 2 ? '#3f9c37' : '#37902f';
          g.fillRect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0));
        }
      }
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
        g.fillRect(X(U.rand(-6, C.W + 6)), Y(U.rand(-6, C.H + 6)), 1, 1);
      }

      // Lines.
      g.fillStyle = '#eef3ea';
      const hline = (x1, x2, y) => g.fillRect(X(x1), Y(y), X(x2) - X(x1) + 1, 1);
      const vline = (x, y1, y2) => g.fillRect(X(x) - 1, Y(y1), 2, Y(y2) - Y(y1) + 1);
      const arc = (cx, cy, r, keep) => {
        const steps = Math.ceil(r * PX * 4);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (keep && !keep(x, y)) continue;
          g.fillRect(X(x), Y(y), 2, 1);
        }
      };
      hline(0, C.W, 0); hline(0, C.W, C.H); vline(0, 0, C.H); vline(C.W, 0, C.H);
      vline(C.W / 2, 0, C.H);
      arc(C.W / 2, C.H / 2, C.CIRCLE_R);
      g.fillRect(X(C.W / 2) - 1, Y(C.H / 2) - 1, 3, 2);
      for (const side of [0, 1]) {
        const gx = side ? C.W : 0, s = side ? -1 : 1;
        const by1 = C.H / 2 - C.BOX_W / 2, by2 = C.H / 2 + C.BOX_W / 2;
        const sy1 = C.H / 2 - C.SIX_W / 2, sy2 = C.H / 2 + C.SIX_W / 2;
        const bx = gx + s * C.BOX_D, sx6 = gx + s * C.SIX_D;
        hline(Math.min(gx, bx), Math.max(gx, bx), by1); hline(Math.min(gx, bx), Math.max(gx, bx), by2); vline(bx, by1, by2);
        hline(Math.min(gx, sx6), Math.max(gx, sx6), sy1); hline(Math.min(gx, sx6), Math.max(gx, sx6), sy2); vline(sx6, sy1, sy2);
        const spot = gx + s * C.SPOT;
        g.fillRect(X(spot), Y(C.H / 2), 2, 1);
        arc(spot, C.H / 2, C.CIRCLE_R, (x) => s * (x - bx) > 0.05);
        arc(gx, 0, 1, (x, y) => s * (x - gx) >= 0 && y >= 0);
        arc(gx, C.H, 1, (x, y) => s * (x - gx) >= 0 && y <= C.H);
      }
      return cv;
    }

    // Loose camera: the ball roams a dead zone before the view pans, leaning slightly towards
    // the goal you're attacking.
    updateCamera(m, dt) {
      const b = m.ball;
      const hw = VW / 2 / PX;
      const userBall = (b.owner && b.owner.team.isUser) || (!b.owner && b.lastKick && b.lastKick.team.isUser);
      const fx = b.rx + (userBall ? m.home.dir * hw * 0.2 : 0);
      const dz = hw * 0.15;
      let tx = this.cam.x;
      if (fx < tx - dz) tx = fx + dz; else if (fx > tx + dz) tx = fx - dz;
      // Up and down: the wide camera sees the whole width, so it barely moves. Zoomed in, it
      // follows the ball, stopping a few metres past each touchline, further past the far one
      // (under the scoreboard) when the ball is out or right on it, so the throw is in view.
      const span = (r) => (-1 + Math.sqrt(1 + 2 * PERSP * r)) / PERSP; // metres from the centre row
      const out = m.state !== 'play' || b.ry < 1.5 || b.ry > C.H - 1.5;
      // Ease the extra room in and out (rather than jumping when the ball crosses the line), so
      // play running into a far corner and the restart there is one smooth glide.
      this.outK = (this.outK ?? 0) + ((out ? 1 : 0) - (this.outK ?? 0)) * (m.camSnap ? 1 : Math.min(1, dt * 2.2));
      const top = 4 + 17 * this.outK, bot = 4 + (U.clamp(b.ry - C.H + 4, 4, M - 1) - 4) * this.outK;
      const lo = -top - span(-VH / 2 / PY), hi = C.H + bot - span(VH / 2 / PY);
      let ty = lo < hi ? U.clamp(b.ry + 2, lo, hi) : C.H / 2 + 2.5 + (b.ry - C.H / 2) * 0.1;
      if (m.state === 'restart' && m.restart && m.restart.kind === 'kickoff') { tx = C.W / 2; ty = C.H / 2 + 2.5; } // dead centre
      const k = m.camSnap ? 1 : Math.min(1, dt * 4.5);
      // Vertically, cap the speed too: a big jump in target (a restart, the ball out) is a glide.
      const ky = m.camSnap ? 1 : Math.min(1, dt * 3.2), vyMax = 26 * dt;
      m.camSnap = false;
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += U.clamp((ty - this.cam.y) * ky, -vyMax, vyMax);
      this.cam.x = U.clamp(this.cam.x, -12 + hw + 2, C.W + 12 - hw - 2); // a little stand behind each goal, no more
      if (!Number.isFinite(this.cam.x) || !Number.isFinite(this.cam.y)) { this.cam.x = C.W / 2; this.cam.y = C.H / 2 + 2.5; }
    }

    // alpha = how far we are between the last two sim steps (displays faster than 60 Hz
    // would otherwise show every position twice and fast balls stutter).
    draw(m, dt, alpha = 1) {
      this.t += dt;
      const g = this.ctx;
      const lerp = (o) => {
        o.rx = o.ox == null ? o.x : o.ox + (o.x - o.ox) * alpha;
        o.ry = o.oy == null ? o.y : o.oy + (o.y - o.oy) * alpha;
      };
      for (const p of m.players) lerp(p);
      lerp(m.ball);
      m.ball.rz = m.ball.oz == null ? m.ball.z : m.ball.oz + (m.ball.z - m.ball.oz) * alpha;
      this.updateCamera(m, dt);
      this.drawPitch();

      this.drawGoalBack(0); this.drawGoalBack(C.W);

      // Shadows.
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (const p of m.players) {
        if (p.sentOff) continue;
        const x = this.sx(p.rx, p.ry), y = this.sy(p.ry);
        if (p.slide > 0 || p.dive > 0 || p.stun > 0.25) { g.fillRect(x - 7, y - 1, 15, 3); continue; }
        g.fillRect(x - 3, y - 1, 8, 3); g.fillRect(x - 4, y, 10, 1);
      }
      const b = m.ball;
      // Ball shadow: a dark blob on the turf, clear even when the ball is high.
      g.fillStyle = 'rgba(0,0,0,0.5)';
      const bsx = this.sx(b.rx, b.ry), bsy = this.sy(b.ry), big = b.rz < 3;
      g.fillRect(bsx - 1, bsy, big ? 4 : 3, 2); g.fillRect(bsx - 2, bsy, 1, 1); g.fillRect(bsx + (big ? 3 : 2), bsy, 1, 1);
      g.fillStyle = 'rgba(0,0,0,0.28)';

      // Depth-sorted sprites.
      const list = m.players.filter((p) => !p.sentOff).map((p) => ({ y: p.ry, p }));
      list.push({ y: b.ry + 0.05, ball: true });
      list.sort((a, c) => a.y - c.y);
      for (const e of list) {
        if (e.ball) this.drawBall(b);
        else this.drawPlayer(e.p, m);
      }

      this.drawGoalFront(0); this.drawGoalFront(C.W);
      this.drawPreview(m);
      this.drawMarkers(m);
      const cross = (mx, my, col) => {
        const g2 = this.ctx; mx = Math.round(mx); my = Math.round(my);
        g2.fillStyle = col;
        g2.fillRect(mx - 3, my, 2, 1); g2.fillRect(mx + 2, my, 2, 1); g2.fillRect(mx, my - 3, 1, 2); g2.fillRect(mx, my + 2, 1, 2);
      };
      if (PP.settings.aim === 'mouse' && PP.Input.mouse) cross(PP.Input.mouse.x, PP.Input.mouse.y, 'rgba(255,255,255,0.8)'); // where the mouse is aiming
      if (PP.settings.aim === 'mouselock') {
        if (!PP.Input.locked()) {
          const g2 = this.ctx; g2.font = '8px monospace'; g2.textAlign = 'center';
          g2.fillStyle = 'rgba(0,0,0,0.55)'; g2.fillRect(C.VIEW_W / 2 - 78, 26, 156, 11);
          g2.fillStyle = '#fff'; g2.fillText('Click the pitch to aim with the mouse', C.VIEW_W / 2, 34);
        } else if (m.mouseVec && m.controlled && b.owner === m.controlled) {
          // Locked: the virtual crosshair rides with the ball.
          const wx = b.rx + m.mouseVec.x, wy = U.clamp(b.ry + m.mouseVec.y, -2, C.H + 2);
          cross(this.sx(wx, wy), this.sy(wy), m.charging ? '#ffd23f' : 'rgba(255,255,255,0.85)');
        }
      }
      this.drawTouch(m);
      this.drawPopups(m);
      this.drawRadar(m);
      if (m.state === 'replay') this.drawReplayTag();
    }

    // Slow-motion replay: letterbox bars, a blinking REPLAY tag and how to skip.
    drawReplayTag() {
      const g = this.ctx, W = C.VIEW_W, H = C.VIEW_H;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, 0, W, 14); g.fillRect(0, H - 14, W, 14);
      g.font = '8px monospace'; g.textAlign = 'left';
      if (Math.floor(this.t * 2) % 2) { g.fillStyle = '#e4572e'; g.fillRect(8, 4, 5, 5); }
      g.fillStyle = '#fff'; g.fillText('REPLAY', 17, 10);
      g.textAlign = 'right'; g.fillStyle = '#cfd8d6'; g.fillText('J / Space / click: skip', W - 8, H - 4);
    }

    // Dashed line from the passer to where the pass will go while a pass button is held.
    // Touch feedback: the slingshot (the band from where your finger landed, and the ball's line
    // the other way, coloured by what it'll be) and the dribble joystick.
    drawTouch(m) {
      const I = PP.Input, T = PP.Touch, g = this.ctx, p = m.controlled, b = m.ball;
      if (!I.usedTouch || !p || m.state === 'replay') return;
      const ring = (x, y, r, col) => { g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2); g.stroke(); };
      const ta = m.touchAim;
      if (m.charging && ta && T.aimId != null) {
        // the band
        ring(ta.ox, ta.oy, 5, 'rgba(255,255,255,0.5)');
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(ta.ox + 0.5, ta.oy + 0.5); g.lineTo(ta.fx + 0.5, ta.fy + 0.5); g.stroke();
        // the ball's line
        const bx = this.sx(b.rx, b.ry), by = this.sy(b.ry);
        let vx = ta.kx, vy = ta.ky;
        const L = Math.hypot(vx, vy), k = L > T.LMAX ? T.LMAX / L : 1;
        vx *= k * 0.7; vy *= k * 0.7;
        const col = m.preview && m.preview.shot ? '#ff6b4a' : m.touchLob ? '#ffd23f' : '#ffffff';
        const n = Math.max(2, Math.floor(Math.hypot(vx, vy) / 4));
        for (let i = 1; i <= n; i++) {
          const x = Math.round(bx + (vx * i) / n), y = Math.round(by + (vy * i) / n), big = i === n ? 1 : 0;
          g.fillStyle = '#000'; g.fillRect(x - 1, y - 1, 3 + big, 3 + big);
          g.fillStyle = col; g.fillRect(x, y, 1 + big, 1 + big);
        }
        if (ta.ground) {
          g.font = '7px monospace'; g.textAlign = 'center'; g.fillStyle = '#000';
          g.fillText('GROUND', bx + vx + 1, by + vy - 5); g.fillStyle = '#fff'; g.fillText('GROUND', bx + vx, by + vy - 6);
        }
      }
      const st = T.stickId != null && I.touches.get(T.stickId);
      if (st) {
        ring(st.x0, st.y0, 9, 'rgba(159,211,199,0.45)');
        ring(st.x, st.y, 3, 'rgba(159,211,199,0.9)');
      }
    }

    drawPreview(m) {
      const pv = m.preview, p = m.controlled;
      if (!pv || !p || !m.charging) return;
      const g = this.ctx;
      if (pv.shot) {
        // Shot: a target on the goal mouth where you're aiming.
        const gx = this.sx(pv.x, pv.y), gy = this.sy(pv.y, 1.0), pulse = Math.floor(this.t * 6) % 2;
        g.fillStyle = '#000'; g.fillRect(gx - 4, gy, 9, 1); g.fillRect(gx, gy - 4, 1, 9);
        g.fillStyle = pulse ? '#ff6b4a' : '#ffd23f';
        g.fillRect(gx - 3, gy, 2, 1); g.fillRect(gx + 2, gy, 2, 1); g.fillRect(gx, gy - 3, 1, 2); g.fillRect(gx, gy + 2, 1, 2);
        return;
      }
      const x1 = this.sx(pv.x, pv.y), y1 = this.sy(pv.y);
      const col = pv.lofted ? '#9fd3ff' : '#ffffff';
      // Dashed line along the predicted flight: it bends with the curl and rises with a chip.
      const b = m.ball;
      const pts = [[this.sx(b.rx, b.ry), this.sy(b.ry, b.rz)]].concat((pv.path || []).map((q) => [this.sx(q.x, q.y), this.sy(q.y, q.z)]));
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const seg = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(seg));
        for (let j = 0; j < n; j++) {
          walked++;
          if (walked < 5 || Math.floor(walked / 3) % 2) continue; // 3px dash, 3px gap
          const t = j / n, x = Math.round(ax + (bx - ax) * t), y = Math.round(ay + (by - ay) * t);
          g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y + 1, 1, 1);
          g.fillStyle = col; g.fillRect(x, y, 1, 1);
        }
      }
      g.fillStyle = col;
      if (pv.target) this.ring(this.sx(pv.target.rx, pv.target.ry), this.sy(pv.target.ry), pv.offside ? '#e4572e' : col);
      for (let k = -2; k <= 2; k++) { g.fillRect(x1 + k, y1 + Math.round(k / 2), 1, 1); g.fillRect(x1 + k, y1 - Math.round(k / 2), 1, 1); }
    }

    // Flattened ellipse on the ground under a player.
    ring(x, y, col) {
      const g = this.ctx;
      g.fillStyle = col;
      g.fillRect(x - 3, y - 2, 7, 1);
      g.fillRect(x - 3, y + 2, 7, 1);
      g.fillRect(x - 5, y - 1, 2, 1); g.fillRect(x + 4, y - 1, 2, 1);
      g.fillRect(x - 6, y, 1, 1); g.fillRect(x + 6, y, 1, 1);
      g.fillRect(x - 5, y + 1, 2, 1); g.fillRect(x + 4, y + 1, 2, 1);
    }

    drawPopups(m) {
      const g = this.ctx;
      g.font = '8px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      for (const pp of m.popups) {
        const x = this.sx(pp.x, pp.y), y = this.sy(pp.y) - 27;
        g.globalAlpha = Math.min(1, pp.t * 3);
        g.fillStyle = '#000'; g.fillText(pp.text, x + 1, y + 1);
        g.fillStyle = pp.color; g.fillText(pp.text, x, y);
      }
      g.globalAlpha = 1;
      // The referee's card, held up over the booked player.
      const cs = m.cardShow;
      if (cs && cs.t > 0) {
        const x = Math.round(this.sx(cs.x, cs.y)), y = Math.round(this.sy(cs.y)) - 44 + Math.round(Math.max(0, cs.t - 2.2) * 30);
        g.fillStyle = '#000'; g.fillRect(x - 5, y - 1, 11, 15);
        g.fillStyle = cs.card === 'red' ? '#e4572e' : '#ffd23f'; g.fillRect(x - 4, y, 9, 13);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 4, y, 2, 13);
      }
    }

    // Project a world point (x, y, z) to the screen.
    P(x, y, z = 0) { return [this.sx(x, y), this.sy(y, z)]; }

    line(a, b, col, w = 1) {
      const g = this.ctx;
      g.fillStyle = col;
      let [x0, y0] = a; const [x1, y1] = b;
      if (![x0, y0, x1, y1].every(Number.isFinite)) return; // never hang the frame on a bad point
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let guard = 0; guard < 4000; guard++) {
        g.fillRect(x0, y0, w, w);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }

    goalPts(side) {
      const s = side === 0 ? -1 : 1, xb = side + s * C.GOAL_D, y1 = C.GOAL_Y1, y2 = C.GOAL_Y2, H = C.GOAL_H, Hb = H * 0.8;
      return {
        f1: this.P(side, y1), f2: this.P(side, y2), f1t: this.P(side, y1, H), f2t: this.P(side, y2, H),
        b1: this.P(xb, y1), b2: this.P(xb, y2), b1t: this.P(xb, y1, Hb), b2t: this.P(xb, y2, Hb),
      };
    }

    netPattern() {
      if (this._net) return this._net;
      const c = document.createElement('canvas'); c.width = 2; c.height = 2;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(20,30,20,0.3)'; g.fillRect(0, 0, 2, 2);
      g.fillStyle = 'rgba(240,240,240,0.55)'; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
      return (this._net = this.ctx.createPattern(c, 'repeat'));
    }

    drawGoalBack(side) {
      const g = this.ctx, q = this.goalPts(side);
      g.fillStyle = this.netPattern();
      g.beginPath();
      for (const pt of [q.f1t, q.b1t, q.b1, q.b2, q.b2t, q.f2t, q.f2, q.f1]) g.lineTo(pt[0], pt[1]);
      g.closePath(); g.fill();
      const frame = '#9aa3a0';
      this.line(q.b1, q.b1t, frame); this.line(q.b1t, q.b2t, frame); this.line(q.b1, q.b2, frame);
      this.line(q.f1t, q.b1t, frame); this.line(q.f1, q.b1, frame);
    }

    drawGoalFront(side) {
      const q = this.goalPts(side);
      this.line(q.f2, q.b2, '#c9cfcc'); this.line(q.b2, q.b2t, '#c9cfcc'); this.line(q.f2t, q.b2t, '#c9cfcc');
      this.line(q.f1, q.f1t, '#ffffff', 2); this.line(q.f2, q.f2t, '#ffffff', 2); this.line(q.f1t, q.f2t, '#ffffff', 2);
    }

    drawSprite(rows, ox, oy, left, pal) {
      const g = this.ctx, w = rows[0].length;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < w; c++) {
          const ch = row[left ? w - 1 - c : c];
          if (ch === '.') continue;
          g.fillStyle = pal[ch];
          g.fillRect(ox + c, oy + r, 1, 1);
        }
      }
    }

    drawPlayer(p, m) {
      const g = this.ctx;
      const kit = p.isGK ? p.team.gkKit : p.team.kit;
      const x = this.sx(p.rx, p.ry), y = this.sy(p.ry);
      const sl = kit.sleeves || kit.shirt;
      const pal = { H: p.look.hair, S: p.look.skin, s: shade(p.look.skin), q: shade(p.look.skin), E: '#1a1a1a', T: kit.shirt, t: kit.shade, A: sl, a: kit.sleeves ? shade(sl) : kit.shade, P: kit.shorts, K: kit.socks, k: shade(kit.socks), B: '#151515' };

      if (p.slide > 0 || p.dive > 0 || p.stun > 0.25) { this.drawLying(p, x, y, pal); return; }
      const left = p.fx < -0.1 || (Math.abs(p.fx) <= 0.1 && p.team.dir < 0);
      const speed = Math.hypot(p.vx, p.vy);
      let rows, bob = 0;
      if (p.jump > 0) {
        rows = sprite(HEAD, 'armsUp', 'knee', 'heelUp');
        bob = -Math.round(Math.sin(Math.PI * (1 - p.jump / 0.35)) * 5);
      } else if (p.kickAnim > 0) rows = sprite(HEAD, 'armB', 'knee', 'kick');
      else if (p.lunge > 0) rows = sprite(HEAD_LEAN, 'armA', 'wide', 'lunge');
      else if (speed > 0.6) {
        const f = RUN[Math.floor(p.anim) % RUN.length];
        rows = sprite(speed > 3 ? HEAD_LEAN : HEAD, f.torso, f.shorts, f.legs);
        bob = speed > 1.5 ? f.bob : 0;
      } else rows = sprite(HEAD, 'idle', 'idle', 'stand');
      const lean = p.lunge > 0 ? (left ? -1 : 1) : 0;
      const ox = x - 4 + (left ? -1 : 0) + lean, oy = y - rows.length + 1 + bob;
      this.drawSprite(rows, ox, oy, left, pal);
      // keeper gloves
      if (p.isGK) { g.fillStyle = '#f4f4f4'; g.fillRect(ox + (left ? 2 : 1), oy + 9, 1, 1); g.fillRect(ox + (left ? 8 : 7), oy + 9, 1, 1); }
      // holding off a defender: arm out towards them
      if (p.shielding) {
        const toLeft = this.sx(p.shielding.rx, p.shielding.ry) < x;
        const ax = toLeft ? ox - 1 : ox + 9;
        g.fillStyle = pal.T; g.fillRect(toLeft ? ax + 1 : ax - 1, oy + 7, 1, 1);
        g.fillStyle = pal.S; g.fillRect(ax, oy + 7, 1, 1); g.fillRect(toLeft ? ax - 1 : ax + 1, oy + 7, 1, 1);
      }
      // CPU tackle tell
      if (p.lunge > 0 && !p.team.isUser) {
        g.fillStyle = '#e4572e'; g.fillRect(x, oy - 6, 1, 3); g.fillRect(x, oy - 2, 1, 1);
      }
    }

    drawLying(p, x, y, pal) {
      const g = this.ctx;
      const dirx = Math.abs(p.fx) > 0.3 ? Math.sign(p.fx) : (p.team.dir || 1);
      const f = (dx) => (dirx > 0 ? x + dx : x - dx); // dx measured in the slide direction
      const rect = (col, dx0, dx1, y0, h) => { g.fillStyle = col; g.fillRect(Math.min(f(dx0), f(dx1)), y + y0, Math.abs(dx1 - dx0) + 1, h); };
      if (p.dive > 0) {
        // keeper at full stretch: gloves leading, lifted towards the ball's height mid-dive
        const prog = p.diveTotal ? 1 - p.dive / p.diveTotal : 0.5;
        y -= Math.round((p.diveZ || 0) * PZ * Math.sin(Math.PI * Math.min(1, prog * 1.15)));
        rect(pal.T, -3, 3, -6, 4); rect(pal.P, -6, -4, -6, 4); rect(pal.K, -10, -7, -5, 2);
        rect(pal.S, 4, 5, -7, 3); rect(pal.H, 4, 4, -7, 2);
        rect('#f4f4f4', 7, 8, -8, 2); rect(pal.T, 6, 6, -7, 1);
        return;
      }
      // sliding / floored: legs leading, body behind
      rect(pal.B, 7, 8, -3, 2); rect(pal.K, 4, 6, -3, 2); rect(pal.S, 2, 3, -3, 2);
      rect(pal.P, -1, 1, -4, 3); rect(pal.T, -6, -2, -5, 4);
      rect(pal.S, -8, -7, -6, 3); rect(pal.H, -8, -8, -6, 2);
    }

    drawBall(b) {
      const g = this.ctx;
      const x = this.sx(b.rx, b.ry) - 1, y = this.sy(b.ry, b.rz) - 3;
      g.fillStyle = '#111'; g.fillRect(x - 1, y, 6, 4); g.fillRect(x, y - 1, 4, 6);
      g.fillStyle = '#ffffff'; g.fillRect(x, y, 4, 4);
      g.fillStyle = '#c8cdd0'; g.fillRect(x + 1, y + 3, 3, 1); g.fillRect(x + 3, y + 1, 1, 2);
      g.fillStyle = '#333'; g.fillRect(x + ((Math.floor((b.x + b.y) * 3) & 1) ? 0 : 2), y + 1, 1, 1);
    }

    drawMarkers(m) {
      const g = this.ctx, p = m.controlled;
      if (!p) return;
      const x = this.sx(p.rx, p.ry), y = this.sy(p.ry);
      const bob = Math.floor(this.t * 4) % 2;
      const top = y - 26 + bob;
      g.fillStyle = '#000'; g.fillRect(x - 3, top - 1, 7, 1);
      g.fillStyle = '#ffd23f';
      g.fillRect(x - 2, top, 5, 1); g.fillRect(x - 1, top + 1, 3, 1); g.fillRect(x, top + 2, 1, 1);
      this.ring(x + 1, y, 'rgba(255,210,63,0.85)');
      if (m.charging) {
        g.fillStyle = '#000'; g.fillRect(x - 8, y - 32, 17, 4);
        const w = Math.max(1, Math.round(15 * m.charge));
        const isShot = m.chargeKind === 'shot' || (m.preview && m.preview.shot);
        const ramp = isShot ? ['#a8c686', '#f3a712', '#e4572e'] : ['#9fd3c7', '#5fa8d3', '#3a6ea5'];
        g.fillStyle = ramp[m.charge > 0.8 ? 2 : m.charge > 0.45 ? 1 : 0];
        g.fillRect(x - 7, y - 31, w, 2);
      }
    }

    drawRadar(m) {
      const g = this.ctx, s = 0.6;
      const w = Math.round(C.W * s), h = Math.round(C.H * s);
      const ox = VW - w - 6, oy = 6;
      g.fillStyle = 'rgba(8,16,12,0.6)'; g.fillRect(ox - 1, oy - 1, w + 2, h + 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(ox + Math.round(w / 2), oy, 1, h);
      g.fillRect(ox, oy + Math.round(h / 2 - (C.GOAL_W * s) / 2), 1, Math.round(C.GOAL_W * s));
      g.fillRect(ox + w - 1, oy + Math.round(h / 2 - (C.GOAL_W * s) / 2), 1, Math.round(C.GOAL_W * s));
      for (const p of m.players) {
        if (p.sentOff) continue;
        g.fillStyle = p === m.controlled ? '#ffd23f' : p.isGK ? p.team.gkKit.shirt : p.team.kit.shirt;
        g.fillRect(ox + Math.round(p.x * s) - 1, oy + Math.round(p.y * s) - 1, 2, 2);
      }
      g.fillStyle = '#fff';
      g.fillRect(ox + Math.round(m.ball.x * s), oy + Math.round(m.ball.y * s), 1, 1);
    }

    // Slow pan over an empty pitch behind menus.
    drawIdle(dt) {
      this.t += dt;
      this.cam.x = C.W / 2 + Math.sin(this.t * 0.08) * 30;
      this.cam.y = C.H / 2 + 2.5;
      this.drawPitch();
      this.drawGoalBack(0); this.drawGoalBack(C.W);
      this.drawGoalFront(0); this.drawGoalFront(C.W);
    }
  }

  // Darker version of a hex colour, for skin shading.
  function shade(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * 0.8), gg = Math.round(((n >> 8) & 255) * 0.8), b = Math.round((n & 255) * 0.8);
    return '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
  }

  PP.Renderer = Renderer;
})();
