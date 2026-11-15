(function () {
  const C = PP.C, U = PP.U;
  const PX = C.PX, PY = C.PY, PZ = C.PZ, VW = C.VIEW_W, VH = C.VIEW_H, M = C.MARGIN;

  // 10x17 player sprite, facing right (mirrored for left).
  // H hair, S skin, s skin shade, E eye, T shirt, t shirt shade, P shorts, K socks, B boots.
  const UPPER = [
    '...HHH....',
    '..HHHHH...',
    '..HHSSS...',
    '..HSSES...',
    '...sSSS...',
    '..tTTTT...',
    '.ttTTTTT..',
    '.tTTTTTT..',
    '.STTTTTS..',
    '.S.TTT.S..',
    '..TTTTT...',
    '..PPPPP...',
    '..PP.PP...',
  ];
  const LEGS = {
    stand:   ['..SS.SS...', '..KK.KK...', '..KK.KK...', '..BB.BB...'],
    strideA: ['.SS...SS..', '.KK...KK..', '.KK....KK.', 'BB.....BB.'],
    strideB: ['..SS..SS..', '.KK...KK..', '.KK...KK..', '.BB....BB.'],
    lunge:   ['..SS.SS...', '..KK..KK..', '..KK...KK.', '..BB....BB'], // leg stuck out to tackle
  };
  const RUN = ['strideA', 'stand', 'strideB', 'stand'];

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.cam = { x: C.W / 2, y: C.H / 2 };
      this.pitch = this.buildPitch();
      this.t = 0;
    }

    sx(x) { return Math.round((x - this.cam.x) * PX + VW / 2); }
    sy(y, z = 0) { return Math.round((y - this.cam.y) * PY + VH / 2 - z * PZ); }

    buildPitch() {
      const w = Math.ceil((C.W + 2 * M) * PX), h = Math.ceil((C.H + 2 * M) * PY);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const X = (x) => Math.round((x + M) * PX), Y = (y) => Math.round((y + M) * PY);

      // Stands with a pixel crowd.
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, w, h);
      const crowd = ['#e4572e', '#f3a712', '#29335c', '#a8c686', '#f4f4f4', '#669bbc', '#2ec4b6', '#d7263d', '#8c6a5d', '#f0e2a3', '#3d405b'];
      for (let yy = 0; yy < h; yy += 3) {
        for (let xx = 0; xx < w; xx += 3) {
          const wx = xx / PX - M, wy = yy / PY - M;
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
      const vline = (x, y1, y2) => g.fillRect(X(x), Y(y1), 1, Y(y2) - Y(y1) + 1);
      const arc = (cx, cy, r, keep) => {
        const steps = Math.ceil(r * PX * 7);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (keep && !keep(x, y)) continue;
          g.fillRect(X(x), Y(y), 1, 1);
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
      const hw = VW / 2 / PX, hh = VH / 2 / PY;
      const userBall = (b.owner && b.owner.team.isUser) || (!b.owner && b.lastKick && b.lastKick.team.isUser);
      const fx = b.rx + (userBall ? m.home.dir * hw * 0.2 : 0);
      const dz = hw * 0.15;
      let tx = this.cam.x;
      if (fx < tx - dz) tx = fx + dz; else if (fx > tx + dz) tx = fx - dz;
      const ty = C.H / 2 + (b.ry - C.H / 2) * 0.15;
      const k = m.camSnap ? 1 : Math.min(1, dt * 3);
      m.camSnap = false;
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      this.cam.x = U.clamp(this.cam.x, -M + hw + 2, C.W + M - hw - 2);
      this.cam.y = U.clamp(this.cam.y, Math.min(C.H / 2, -M + hh), Math.max(C.H / 2, C.H + M - hh));
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
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, VW, VH);
      g.drawImage(this.pitch, this.sx(-M), this.sy(-M));

      this.drawGoalBack(0); this.drawGoalBack(C.W);

      // Shadows.
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (const p of m.players) {
        const x = this.sx(p.rx), y = this.sy(p.ry);
        if (p.slide > 0 || p.dive > 0 || p.stun > 0.25) { g.fillRect(x - 7, y - 1, 15, 3); continue; }
        g.fillRect(x - 3, y - 1, 8, 3); g.fillRect(x - 4, y, 10, 1);
      }
      const b = m.ball;
      const bs = Math.max(2, 4 - Math.floor(b.rz));
      g.fillRect(this.sx(b.rx) - 1, this.sy(b.ry), bs, 1);

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
      this.drawPopups(m);
      this.drawRadar(m);
    }

    // Dashed line from the passer to where the pass will go while a pass button is held.
    drawPreview(m) {
      const pv = m.preview, p = m.controlled;
      if (!pv || !p || !m.charging) return;
      const g = this.ctx;
      const x0 = this.sx(p.rx), y0 = this.sy(p.ry), x1 = this.sx(pv.x), y1 = this.sy(pv.y);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.floor(len));
      const col = pv.lofted ? '#9fd3ff' : '#ffffff';
      for (let i = 4; i <= n; i++) {
        if (Math.floor(i / 3) % 2) continue; // 3px dash, 3px gap
        const t = i / n;
        const lift = pv.lofted ? Math.sin(Math.PI * t) * Math.min(28, len * 0.22) : 0;
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - lift) + 1, 1, 1);
        g.fillStyle = col;
        g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - lift), 1, 1);
      }
      g.fillStyle = col;
      if (pv.target) this.ring(this.sx(pv.target.rx), this.sy(pv.target.ry), col);
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
        const x = this.sx(pp.x), y = this.sy(pp.y) - 27;
        g.globalAlpha = Math.min(1, pp.t * 3);
        g.fillStyle = '#000'; g.fillText(pp.text, x + 1, y + 1);
        g.fillStyle = pp.color; g.fillText(pp.text, x, y);
      }
      g.globalAlpha = 1;
    }

    goalBox(side) {
      const s = side === 0 ? -1 : 1;
      const x0 = this.sx(side), x1 = this.sx(side + s * C.GOAL_D);
      return { x0, x1, xa: Math.min(x0, x1), xb: Math.max(x0, x1), y1: this.sy(C.GOAL_Y1), y2: this.sy(C.GOAL_Y2), hp: Math.round(C.GOAL_H * PZ) };
    }

    drawGoalBack(side) {
      const g = this.ctx, { x1, xa, xb, y1, y2, hp } = this.goalBox(side);
      g.fillStyle = 'rgba(20,30,20,0.35)';
      g.fillRect(xa, y1 - hp, xb - xa, y2 - y1 + hp);
      g.fillStyle = 'rgba(240,240,240,0.45)';
      for (let y = y1 - hp; y <= y2; y += 2) for (let x = xa + ((y & 2) ? 1 : 0); x < xb; x += 2) g.fillRect(x, y, 1, 1);
      g.fillStyle = '#9aa3a0';
      g.fillRect(x1, y1 - hp, 1, y2 - y1 + hp);
    }

    drawGoalFront(side) {
      const g = this.ctx, { x0, xa, xb, y1, y2, hp } = this.goalBox(side);
      g.fillStyle = '#c9cfcc';
      g.fillRect(xa, y1 - hp, xb - xa + 1, 1); // roof edges
      g.fillRect(xa, y2 - hp, xb - xa + 1, 1);
      g.fillRect(xa, y2, xb - xa + 1, 1);      // ground edge
      g.fillStyle = '#ffffff';
      g.fillRect(x0 - (side === 0 ? 1 : 0), y1 - hp, 2, y2 - y1 + hp + 1); // posts + crossbar
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
      const x = this.sx(p.rx), y = this.sy(p.ry);
      const pal = { H: p.look.hair, S: p.look.skin, s: shade(p.look.skin), E: '#1a1a1a', T: kit.shirt, t: kit.shade, P: kit.shorts, K: kit.socks, B: '#151515' };

      if (p.slide > 0 || p.dive > 0 || p.stun > 0.25) { this.drawLying(p, x, y, pal); return; }
      const left = p.fx < -0.1 || (Math.abs(p.fx) <= 0.1 && p.team.dir < 0);
      const moving = Math.hypot(p.vx, p.vy) > 0.5;
      const legs = p.lunge > 0 ? LEGS.lunge : moving ? LEGS[RUN[Math.floor(p.anim) % 4]] : LEGS.stand;
      const rows = UPPER.concat(legs);
      const lean = p.lunge > 0 ? (left ? -1 : 1) : 0;
      const ox = x - 4 + (left ? -1 : 0) + lean, oy = y - rows.length + 1;
      this.drawSprite(rows, ox, oy, left, pal);
      // keeper gloves
      if (p.isGK) { g.fillStyle = '#f4f4f4'; g.fillRect(ox + (left ? 2 : 1), oy + 9, 1, 1); g.fillRect(ox + (left ? 8 : 7), oy + 9, 1, 1); }
      // holding off a defender: arm out towards them
      if (p.shielding) {
        const toLeft = this.sx(p.shielding.rx) < x;
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
        // keeper at full stretch: gloves leading
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
      const x = this.sx(b.rx) - 1, y = this.sy(b.ry, b.rz) - 3;
      g.fillStyle = '#111'; g.fillRect(x - 1, y, 6, 4); g.fillRect(x, y - 1, 4, 6);
      g.fillStyle = '#ffffff'; g.fillRect(x, y, 4, 4);
      g.fillStyle = '#c8cdd0'; g.fillRect(x + 1, y + 3, 3, 1); g.fillRect(x + 3, y + 1, 1, 2);
      g.fillStyle = '#333'; g.fillRect(x + ((Math.floor((b.x + b.y) * 3) & 1) ? 0 : 2), y + 1, 1, 1);
    }

    drawMarkers(m) {
      const g = this.ctx, p = m.controlled;
      if (!p) return;
      const x = this.sx(p.rx), y = this.sy(p.ry);
      const bob = Math.floor(this.t * 4) % 2;
      const top = y - 24 + bob;
      g.fillStyle = '#000'; g.fillRect(x - 3, top - 1, 7, 1);
      g.fillStyle = '#ffd23f';
      g.fillRect(x - 2, top, 5, 1); g.fillRect(x - 1, top + 1, 3, 1); g.fillRect(x, top + 2, 1, 1);
      this.ring(x + 1, y, 'rgba(255,210,63,0.85)');
      if (m.charging) {
        g.fillStyle = '#000'; g.fillRect(x - 8, y - 30, 17, 4);
        const w = Math.max(1, Math.round(15 * m.charge));
        const ramp = m.chargeKind === 'shot' ? ['#a8c686', '#f3a712', '#e4572e'] : ['#9fd3c7', '#5fa8d3', '#3a6ea5'];
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
      this.cam.y = C.H / 2;
      this.ctx.fillStyle = '#1b2230'; this.ctx.fillRect(0, 0, VW, VH);
      this.ctx.drawImage(this.pitch, this.sx(-M), this.sy(-M));
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
