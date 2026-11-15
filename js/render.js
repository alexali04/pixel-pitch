(function () {
  const C = PP.C, U = PP.U;
  const PPM = C.PPM, VW = C.VIEW_W, VH = C.VIEW_H, M = C.MARGIN;

  // 7x12 player sprite, facing right. H hair, S skin, T shirt, t shirt shade, P shorts, K socks, B boots.
  const BODY = [
    '..HHH..',
    '.HHHSS.',
    '.HSSSS.',
    '..SSS..',
    '.TTTTt.',
    'STTTTtS',
    'STTTTtS',
    '.TTTTt.',
    '.PPPPP.',
    '.PP.PP.',
  ];
  const LEGS = [
    ['.KK.KK.', '.BB.BB.'],
    ['KK...KK', 'BB...BB'],
    ['.KK.KK.', '.BB.BB.'],
    ['..KKK..', '..BBB..'],
  ];
  const LUNGE = ['.KK.KKK', '.BB...B'];  // leg stuck out for a standing tackle

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.ctx.imageSmoothingEnabled = false;
      this.cam = { x: C.W / 2, y: C.H / 2 };
      this.pitch = this.buildPitch();
      this.t = 0;
    }

    sx(x) { return Math.round((x - this.cam.x) * PPM + VW / 2); }
    sy(y, z = 0) { return Math.round((y - this.cam.y - z) * PPM + VH / 2); }

    buildPitch() {
      const w = (C.W + 2 * M) * PPM, h = (C.H + 2 * M) * PPM;
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      const X = (x) => Math.round((x + M) * PPM), Y = (y) => Math.round((y + M) * PPM);

      // Stands with a pixel crowd.
      g.fillStyle = '#1b2230'; g.fillRect(0, 0, w, h);
      const crowd = ['#e4572e', '#f3a712', '#29335c', '#a8c686', '#f4f4f4', '#669bbc', '#2ec4b6', '#d7263d', '#8c6a5d', '#f0e2a3', '#3d405b'];
      for (let yy = 0; yy < h; yy += 3) {
        for (let xx = 0; xx < w; xx += 3) {
          const wx = xx / PPM - M, wy = yy / PPM - M;
          if (wx > -6 && wx < C.W + 6 && wy > -6 && wy < C.H + 6) continue;
          if (Math.random() < 0.7) {
            g.fillStyle = U.pick(crowd); g.fillRect(xx, yy, 2, 2);
            g.fillStyle = '#d9a77a'; g.fillRect(xx, yy - 1, 2, 1);
          }
        }
      }
      // Run-off and ad boards.
      g.fillStyle = '#3b7537'; g.fillRect(X(-6), Y(-6), (C.W + 12) * PPM, (C.H + 12) * PPM);
      const boards = ['#264653', '#e76f51', '#2a9d8f', '#e9c46a', '#5e548e', '#f4f4f4'];
      const boardH = 4;
      for (let x = -6, i = 0; x < C.W + 6; x += 8, i++) {
        g.fillStyle = boards[i % boards.length];
        g.fillRect(X(x), Y(-5.8), 8 * PPM, boardH);
        g.fillRect(X(x), Y(C.H + 5.3), 8 * PPM, boardH);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(X(x) + 6, Y(-5.8) + 1, 3 * PPM, 2);
        g.fillRect(X(x) + 6, Y(C.H + 5.3) + 1, 3 * PPM, 2);
      }
      for (let y = -6, i = 0; y < C.H + 6; y += 8, i++) {
        g.fillStyle = boards[(i + 3) % boards.length];
        g.fillRect(X(-5.8), Y(y), boardH, 8 * PPM);
        g.fillRect(X(C.W + 5.3), Y(y), boardH, 8 * PPM);
      }
      // Mown stripes.
      const n = 14;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? '#4e9a44' : '#468f3d';
        g.fillRect(X((i * C.W) / n), Y(-4), Math.ceil((C.W / n) * PPM), (C.H + 8) * PPM);
      }
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)';
        g.fillRect(X(U.rand(-4, C.W + 4)), Y(U.rand(-4, C.H + 4)), 1, 1);
      }

      // Lines.
      g.fillStyle = '#eef3ea';
      const hline = (x1, x2, y) => g.fillRect(X(x1), Y(y), X(x2) - X(x1) + 1, 1);
      const vline = (x, y1, y2) => g.fillRect(X(x), Y(y1), 1, Y(y2) - Y(y1) + 1);
      const arc = (cx, cy, r, keep) => {
        const steps = Math.ceil(r * PPM * 7);
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
      g.fillRect(X(C.W / 2) - 1, Y(C.H / 2) - 1, 3, 3);
      for (const side of [0, 1]) {
        const gx = side ? C.W : 0, s = side ? -1 : 1;
        const by1 = C.H / 2 - C.BOX_W / 2, by2 = C.H / 2 + C.BOX_W / 2;
        const sy1 = C.H / 2 - C.SIX_W / 2, sy2 = C.H / 2 + C.SIX_W / 2;
        const bx = gx + s * C.BOX_D, sx6 = gx + s * C.SIX_D;
        hline(Math.min(gx, bx), Math.max(gx, bx), by1); hline(Math.min(gx, bx), Math.max(gx, bx), by2); vline(bx, by1, by2);
        hline(Math.min(gx, sx6), Math.max(gx, sx6), sy1); hline(Math.min(gx, sx6), Math.max(gx, sx6), sy2); vline(sx6, sy1, sy2);
        const spot = gx + s * C.SPOT;
        g.fillRect(X(spot), Y(C.H / 2), 2, 2);
        arc(spot, C.H / 2, C.CIRCLE_R, (x) => s * (x - bx) > 0.05);
        arc(gx, 0, 1, (x, y) => s * (x - gx) >= 0 && y >= 0);
        arc(gx, C.H, 1, (x, y) => s * (x - gx) >= 0 && y <= C.H);
      }
      return cv;
    }

    updateCamera(m, dt) {
      const b = m.ball;
      const tx = b.rx + (b.owner ? b.owner.vx * 0.35 : b.vx * 0.15);
      const ty = b.ry + (b.owner ? b.owner.vy * 0.25 : b.vy * 0.1);
      const k = Math.min(1, dt * 4.5);
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
      const hw = VW / 2 / PPM, hh = VH / 2 / PPM;
      this.cam.x = U.clamp(this.cam.x, -M + hw + 2, C.W + M - hw - 2);
      this.cam.y = U.clamp(this.cam.y, -M + hh + 3, C.H + M - hh - 3);
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
      g.drawImage(this.pitch, this.sx(-M), this.sy(-M));

      this.drawGoalBack(0); this.drawGoalBack(C.W);

      // Shadows.
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (const p of m.players) {
        const x = this.sx(p.rx), y = this.sy(p.ry);
        if (p.slide > 0 || p.dive > 0 || p.stun > 0) g.fillRect(x - 5, y - 1, 10, 2);
        else g.fillRect(x - 3, y - 1, 7, 2);
      }
      const b = m.ball;
      const bs = Math.max(1, 3 - Math.floor(b.rz));
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
        if (Math.floor(i / 3) % 2) continue;           // 3px dash, 3px gap
        const t = i / n;
        // lofted passes arc upwards in the preview
        const lift = pv.lofted ? Math.sin(Math.PI * t) * Math.min(24, len * 0.18) : 0;
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - lift) + 1, 1, 1);
        g.fillStyle = col;
        g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t - lift), 1, 1);
      }
      // landing marker: an X in space, a ring under a teammate
      g.fillStyle = col;
      if (pv.target) {
        const tx = this.sx(pv.target.rx), ty = this.sy(pv.target.ry);
        g.fillRect(tx - 4, ty + 1, 9, 1); g.fillRect(tx - 3, ty + 2, 7, 1); g.fillRect(tx - 4, ty, 1, 1); g.fillRect(tx + 4, ty, 1, 1);
      }
      if (pv.short) g.fillStyle = '#e4572e'; // too soft to reach the teammate: it stops here
      for (let k = -2; k <= 2; k++) { g.fillRect(x1 + k, y1 + k, 1, 1); g.fillRect(x1 + k, y1 - k, 1, 1); }
    }

    drawPopups(m) {
      const g = this.ctx;
      g.font = '8px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      for (const pp of m.popups) {
        const x = this.sx(pp.x), y = this.sy(pp.y) - 22;
        g.globalAlpha = Math.min(1, pp.t * 3);
        g.fillStyle = '#000'; g.fillText(pp.text, x + 1, y + 1);
        g.fillStyle = pp.color; g.fillText(pp.text, x, y);
      }
      g.globalAlpha = 1;
    }

    drawGoalBack(side) {
      const g = this.ctx, s = side === 0 ? -1 : 1;
      const x0 = this.sx(side), x1 = this.sx(side + s * C.GOAL_D);
      const y1 = this.sy(C.GOAL_Y1), y2 = this.sy(C.GOAL_Y2), hp = Math.round(C.GOAL_H * PPM);
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      g.fillStyle = 'rgba(20,30,20,0.35)';
      g.fillRect(xa, y1 - hp, xb - xa, y2 - y1 + hp);
      g.fillStyle = 'rgba(240,240,240,0.45)';
      for (let y = y1 - hp; y <= y2; y += 2) for (let x = xa + ((y & 2) ? 1 : 0); x < xb; x += 2) g.fillRect(x, y, 1, 1);
      g.fillStyle = '#9aa3a0';
      g.fillRect(x1, y1 - hp, 1, y2 - y1 + hp);
    }

    drawGoalFront(side) {
      const g = this.ctx, s = side === 0 ? -1 : 1;
      const x0 = this.sx(side), x1 = this.sx(side + s * C.GOAL_D);
      const y1 = this.sy(C.GOAL_Y1), y2 = this.sy(C.GOAL_Y2), hp = Math.round(C.GOAL_H * PPM);
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      g.fillStyle = '#c9cfcc';
      g.fillRect(xa, y1 - hp, xb - xa + 1, 1);   // roof edges
      g.fillRect(xa, y2 - hp, xb - xa + 1, 1);
      g.fillRect(xa, y2, xb - xa + 1, 1);        // ground edge
      g.fillStyle = '#ffffff';
      g.fillRect(x0 - (side === 0 ? 1 : 0), y1 - hp, 2, y2 - y1 + hp + 1); // posts + crossbar
    }

    drawPlayer(p, m) {
      const g = this.ctx;
      const kit = p.isGK ? p.team.gkKit : p.team.kit;
      const x = this.sx(p.rx), y = this.sy(p.ry);
      const pal = { H: p.look.hair, S: p.look.skin, T: kit.shirt, t: kit.shade, P: kit.shorts, K: kit.socks, B: '#151515' };

      if (p.slide > 0 || p.dive > 0 || p.stun > 0.25) { this.drawLying(p, x, y, pal); return; }
      const left = p.fx < -0.1 || (Math.abs(p.fx) <= 0.1 && p.team.dir < 0);
      const moving = Math.hypot(p.vx, p.vy) > 0.5;
      const frame = moving ? Math.floor(p.anim) % 4 : 0;
      const rows = BODY.concat(p.lunge > 0 ? LUNGE : LEGS[frame]);
      const lean = p.lunge > 0 ? (left ? -1 : 1) : 0;
      const ox = x - 3 + lean, oy = y - rows.length;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < 7; c++) {
          const ch = row[left ? 6 - c : c];
          if (ch === '.') continue;
          g.fillStyle = pal[ch];
          g.fillRect(ox + c, oy + r, 1, 1);
        }
      }
      // keeper gloves
      if (p.isGK) { g.fillStyle = '#f4f4f4'; g.fillRect(ox, oy + 6, 1, 1); g.fillRect(ox + 6, oy + 6, 1, 1); }
      // holding off a defender: arm out towards them
      if (p.shielding) {
        const sx = this.sx(p.shielding.rx) < x ? ox - 2 : ox + 7;
        g.fillStyle = pal.T; g.fillRect(sx + (sx < x ? 1 : 0), oy + 5, 1, 1);
        g.fillStyle = pal.S; g.fillRect(sx + (sx < x ? 0 : 1), oy + 5, 1, 1);
      }
      if (p.lunge > 0 && p.team.isUser === false) {
        g.fillStyle = '#e4572e'; g.fillRect(x, oy - 6, 1, 3); g.fillRect(x, oy - 2, 1, 1);
      }
    }

    drawLying(p, x, y, pal) {
      const g = this.ctx;
      const dirx = Math.abs(p.fx) > 0.3 ? Math.sign(p.fx) : (p.team.dir || 1);
      // head at the leading end
      const hx = dirx > 0 ? x + 4 : x - 6;
      const bx = dirx > 0 ? x - 2 : x - 3;
      g.fillStyle = pal.T; g.fillRect(bx, y - 4, 6, 3);
      g.fillStyle = pal.P; g.fillRect(dirx > 0 ? bx - 2 : bx + 6, y - 4, 2, 3);
      g.fillStyle = pal.K; g.fillRect(dirx > 0 ? bx - 5 : bx + 8, y - 3, 3, 2);
      g.fillStyle = pal.S; g.fillRect(hx, y - 4, 2, 3);
      g.fillStyle = pal.H; g.fillRect(dirx > 0 ? hx + 1 : hx, y - 4, 1, 2);
    }

    drawBall(b) {
      const g = this.ctx;
      const x = this.sx(b.rx) - 1, y = this.sy(b.ry, b.rz) - 2;
      g.fillStyle = '#111'; g.fillRect(x - 1, y, 5, 3); g.fillRect(x, y - 1, 3, 5);
      g.fillStyle = '#ffffff'; g.fillRect(x, y, 3, 3);
      g.fillStyle = '#333'; g.fillRect(x + ((Math.floor((b.x + b.y) * 3) & 1) ? 0 : 2), y + 1, 1, 1);
    }

    drawMarkers(m) {
      const g = this.ctx, p = m.controlled;
      if (!p) return;
      const x = this.sx(p.rx), y = this.sy(p.ry);
      const bob = Math.floor(this.t * 4) % 2;
      g.fillStyle = '#000';
      g.fillRect(x - 3, y - 19 + bob, 7, 1);
      g.fillStyle = '#ffd23f';
      g.fillRect(x - 2, y - 18 + bob, 5, 1);
      g.fillRect(x - 1, y - 17 + bob, 3, 1);
      g.fillRect(x, y - 16 + bob, 1, 1);
      // ground ring
      g.fillStyle = 'rgba(255,210,63,0.8)';
      g.fillRect(x - 4, y + 1, 9, 1);
      if (m.charging) {
        g.fillStyle = '#000'; g.fillRect(x - 8, y - 24, 17, 4);
        const w = Math.max(1, Math.round(15 * m.charge));
        const ramp = m.chargeKind === 'shot' ? ['#a8c686', '#f3a712', '#e4572e'] : ['#9fd3c7', '#5fa8d3', '#3a6ea5'];
        g.fillStyle = ramp[m.charge > 0.8 ? 2 : m.charge > 0.45 ? 1 : 0];
        g.fillRect(x - 7, y - 23, w, 2);
      }
    }

    drawRadar(m) {
      const g = this.ctx, s = 0.6;
      const w = Math.round(C.W * s), h = Math.round(C.H * s);
      const ox = Math.round(VW / 2 - w / 2), oy = VH - h - 5;
      g.fillStyle = 'rgba(8,16,12,0.6)'; g.fillRect(ox - 1, oy - 1, w + 2, h + 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(ox + Math.round(w / 2), oy, 1, h);
      g.fillRect(ox, oy + Math.round(h / 2 - C.GOAL_W * s / 2), 1, Math.round(C.GOAL_W * s));
      g.fillRect(ox + w - 1, oy + Math.round(h / 2 - C.GOAL_W * s / 2), 1, Math.round(C.GOAL_W * s));
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
      this.cam.y = C.H / 2 + Math.cos(this.t * 0.06) * 12;
      this.ctx.drawImage(this.pitch, this.sx(-M), this.sy(-M));
      this.drawGoalBack(0); this.drawGoalBack(C.W);
      this.drawGoalFront(0); this.drawGoalFront(C.W);
    }
  }

  PP.Renderer = Renderer;
})();
