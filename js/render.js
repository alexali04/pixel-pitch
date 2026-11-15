(function () {
  const C = PP.C, U = PP.U;
  const PX = C.PX, PY = C.PY, PZ = C.PZ, VW = C.VIEW_W, VH = C.VIEW_H, M = C.MARGIN;
  // Perspective: the camera sits in the stands on the near touchline, so the far side of the
  // pitch is smaller than the near side. Lines running up the pitch (goal lines, box edges)
  // lean towards a vanishing point, which shows the goal mouths at an angle.
  const PERSP = 0.007;   // fractional scale change per metre of depth
  const TY = 4;          // pitch texture rows per metre (<= on-screen rows per metre, so no row is skipped)

  // 10x17 player sprites, facing right (mirrored for left). Built from a top (head+torso,
  // 11 rows), shorts (2 rows) and legs (4 rows).
  // H hair, S skin, s skin shade, E eye, T shirt, t shirt shade, P shorts, K socks, B boots.
  const HEAD = ['...HHH....', '..HHHHH...', '..HHSSS...', '..HSSES...', '...sSSS...'];
  const HEAD_LEAN = HEAD.map((r) => '.' + r.slice(0, 9)); // head forward when running
  const TORSO = {
    idle: ['..tTTTT...', '.ttTTTTT..', '.tTTTTTT..', '.STTTTTS..', '.S.TTT.S..', '..TTTTT...'],
    armA: ['..tTTTT...', '.ttTTTTTT.', '.tTTTTTTS.', 'StTTTTT...', 'S.TTTTT...', '..TTTTT...'], // near arm forward
    armB: ['..tTTTT...', 'tttTTTTT..', 'S.TTTTTT..', '.tTTTTTS..', '..TTTTTS..', '..TTTTT...'], // near arm back
    armsUp: ['S.tTTTT.S.', 'StTTTTTTS.', '.tTTTTTT..', '.tTTTTTT..', '..TTTTT...', '..TTTTT...'], // jumping to head it
  };
  const SHORTS = { idle: ['..PPPPP...', '..PP.PP...'], wide: ['..PPPPP...', '.PPP.PPP..'], knee: ['..PPPPP...', '..PP.PPP..'] };
  const LEGS = {
    stand:  ['..SS.SS...', '..KK.KK...', '..KK.KK...', '..BB.BB...'],
    stride: ['.SS...SS..', '.KK....KK.', 'KK......KK', 'BB......BB'], // both legs reaching
    kneeUp: ['..SS..SSS.', '..KK...KK.', '..KK...BB.', '..BB......'], // front knee driving up
    heelUp: ['.SS..SS...', 'KK...KK...', 'BB...KK...', '.....BB...'], // back heel kicking up
    lunge:  ['..SS.SS...', '..KK..KK..', '..KK...KK.', '..BB....BB'], // leg stuck out to tackle
    kick:   ['..SS.SSS..', '..KK...SKK', '..KK.....B', '..BB......'], // striking the ball
  };
  // Run cycle: stride, drive the knee (airborne, body up 1px), stride, kick the heel.
  // Run cycle legs: near leg in kit colours (S/K), far leg shaded (q/k) so the stride reads.
  Object.assign(LEGS, {
    r0: ['.qq...SS..', '.kk....KK.', 'kk......KK', 'BB......BB'], // near leg reaching forward
    r1: ['...SSqq...', '...KK.kkk.', '...KK.....', '...BB.....'], // planted; far knee drives through
    r2: ['..qq.SS...', '.kk...KK..', 'BB.....KK.', '.......BB.'], // airborne
    r3: ['.SS...qq..', '.KK....kk.', 'KK......kk', 'BB......BB'], // far leg reaching forward
    r4: ['...qqSS...', '...kk.KKK.', '...kk.....', '...BB.....'], // planted; near knee drives through
    r5: ['..SS.qq...', '.KK...kk..', 'BB.....kk.', '.......BB.'], // airborne
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
    // the goal you're attacking. The whole pitch width is always in view thanks to the tilt.
    updateCamera(m, dt) {
      const b = m.ball;
      const hw = VW / 2 / PX;
      const userBall = (b.owner && b.owner.team.isUser) || (!b.owner && b.lastKick && b.lastKick.team.isUser);
      const fx = b.rx + (userBall ? m.home.dir * hw * 0.2 : 0);
      const dz = hw * 0.15;
      let tx = this.cam.x;
      if (fx < tx - dz) tx = fx + dz; else if (fx > tx + dz) tx = fx - dz;
      const ty = C.H / 2 + 2.5 + (b.ry - C.H / 2) * 0.1;
      const k = m.camSnap ? 1 : Math.min(1, dt * 4.5);
      m.camSnap = false;
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      this.cam.x = U.clamp(this.cam.x, -M + hw + 2, C.W + M - hw - 2);
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
      const list = m.players.map((p) => ({ y: p.ry, p }));
      list.push({ y: b.ry + 0.05, ball: true });
      list.sort((a, c) => a.y - c.y);
      for (const e of list) {
        if (e.ball) this.drawBall(b);
        else this.drawPlayer(e.p, m);
      }

      this.drawGoalFront(0); this.drawGoalFront(C.W);
      this.drawPreview(m);
      this.drawMarkers(m);
      if (PP.settings.aim === 'mouse' && PP.Input.mouse) { // crosshair where the mouse is aiming
        const g2 = this.ctx, mx = Math.round(PP.Input.mouse.x), my = Math.round(PP.Input.mouse.y);
        g2.fillStyle = 'rgba(255,255,255,0.8)';
        g2.fillRect(mx - 3, my, 2, 1); g2.fillRect(mx + 2, my, 2, 1); g2.fillRect(mx, my - 3, 1, 2); g2.fillRect(mx, my + 2, 1, 2);
      }
      this.drawPopups(m);
      this.drawRadar(m);
    }

    // Dashed line from the passer to where the pass will go while a pass button is held.
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
    }

    // Project a world point (x, y, z) to the screen.
    P(x, y, z = 0) { return [this.sx(x, y), this.sy(y, z)]; }

    line(a, b, col, w = 1) {
      const g = this.ctx;
      g.fillStyle = col;
      let [x0, y0] = a; const [x1, y1] = b;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
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
      const pal = { H: p.look.hair, S: p.look.skin, s: shade(p.look.skin), q: shade(p.look.skin), E: '#1a1a1a', T: kit.shirt, t: kit.shade, P: kit.shorts, K: kit.socks, k: shade(kit.socks), B: '#151515' };

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
      const top = y - 24 + bob;
      g.fillStyle = '#000'; g.fillRect(x - 3, top - 1, 7, 1);
      g.fillStyle = '#ffd23f';
      g.fillRect(x - 2, top, 5, 1); g.fillRect(x - 1, top + 1, 3, 1); g.fillRect(x, top + 2, 1, 1);
      this.ring(x + 1, y, 'rgba(255,210,63,0.85)');
      if (m.charging) {
        g.fillStyle = '#000'; g.fillRect(x - 8, y - 30, 17, 4);
        const w = Math.max(1, Math.round(15 * m.charge));
        const isShot = m.chargeKind === 'shot' || (m.preview && m.preview.shot);
        const ramp = isShot ? ['#a8c686', '#f3a712', '#e4572e'] : ['#9fd3c7', '#5fa8d3', '#3a6ea5'];
        g.fillStyle = ramp[m.charge > 0.8 ? 2 : m.charge > 0.45 ? 1 : 0];
        g.fillRect(x - 7, y - 29, w, 2);
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
