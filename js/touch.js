// Touch controls (phones and tablets). Every gesture can start anywhere on the screen.
//   On the ball:
//     - Pull back (drag away from the goal you're attacking) and let go: a slingshot. The ball
//       goes the opposite way to your drag; the further you pull, the harder it goes, and long
//       pulls are lofted (higher). Once you're pulling you can swing round to any angle, even
//       to play it backwards. Aimed at the goal in range = shot.
//     - A second finger down while pulling keeps it on the ground at any power.
//     - Bring the finger back to where it started and let go = cancel.
//     - Drag forwards (towards their goal, or square): dribble that way, like a joystick
//       centred where your finger landed. Further = sprint.
//   Without the ball: drag = run that way (joystick), tap = tackle / header / go for it,
//   tap a team-mate = switch to him, quick swipe = slide tackle that way.
// The gestures become the same virtual buttons and aim the keyboard/mouse use, so the match
// logic is shared.
(function () {
  const U = PP.U;
  const LMAX = 130;   // canvas px of pull for full power
  const DECIDE = 10;  // canvas px before a touch counts as a drag (and picks pull vs dribble)
  const TAP_PX = 12, TAP_T = 0.3;
  const STICK_DEAD = 6, STICK_SPRINT = 60;
  const LOFT_F = 0.6; // past this much of a full pull the pass is lofted
  const T = (PP.Touch = { aimId: null, stickId: null, ground: false, LMAX, LOFT_F });
  const now = () => performance.now() / 1000;
  const scr = (R, p) => ({ x: R.sx(p.rx ?? p.x, p.ry ?? p.y), y: R.sy(p.ry ?? p.y) - 9 }); // body centre

  // Drag fraction -> what the kick is. Shots use the fraction as power directly.
  T.passKind = (f, ground) => {
    if (ground) return { lob: false, power: f };
    if (f <= LOFT_F) return { lob: false, power: (f / LOFT_F) * 0.75 };
    return { lob: true, power: 0.45 + ((f - LOFT_F) / (1 - LOFT_F)) * 0.55 };
  };

  T.reset = function (I) {
    T.aimId = T.stickId = null; T.ground = false; T.grace = null;
    if (I) { I.touches.clear(); I.touchAx = null; I.keys.TouchKick = I.keys.TouchSprint = false; }
  };

  // A screen-space drag (vx, vy) at screen point (sx, sy) as a world unit direction.
  function worldDir(R, sx, sy, vx, vy) {
    const L = Math.hypot(vx, vy);
    if (L < 1e-6) return null;
    const w0 = R.screenToWorld(sx, sy), w1 = R.screenToWorld(sx + (vx * 12) / L, sy + (vy * 12) / L);
    return w0 && w1 ? U.norm(w1.x - w0.x, w1.y - w0.y) : null;
  }

  T.update = function (m, R, I) {
    const ts = I.touches;
    I.touchAx = null; I.keys.TouchSprint = false;
    // Lifting the dribbling finger to start a pull shouldn't stop the run dead.
    if (T.grace && now() < T.grace.until && T.stickId == null) { I.touchAx = T.grace.ax; I.keys.TouchSprint = T.grace.sprint; }
    if (!ts.size) { T.aimId = T.stickId = null; return; }
    const p = m.controlled, b = m.ball;
    if (!p) return;
    const lk = b.lastKick;
    const hasBall = b.owner === p;
    const onBall = hasBall || (!b.owner && lk && lk.type === 'touch' && lk.by === p && m.time - lk.t < 0.8); // incl. a dribble touch
    // Defending: they have it, or they played it last. Only then do taps tackle and swipes slide.
    const theirBall = b.owner ? b.owner.team !== p.team : !!(lk && lk.team && lk.team !== p.team);
    const ps = scr(R, p), fwd = p.team.dir;

    for (const t of [...ts.values()]) {
      const vx = t.x - t.x0, vy = t.y - t.y0, L = Math.hypot(vx, vy);
      if (!t.role) {
        // A finger landing while you pull: keep the pass on the ground.
        if (T.aimId != null) { t.role = 'mod'; T.ground = true; }
        else if (L >= DECIDE) {
          // Decide what the drag is: pulling back (away from their goal) = kick; else run.
          const d = worldDir(R, ps.x, ps.y + 9, vx, vy);
          if (onBall && d && d.x * fwd < 0) {
            t.role = 'aim'; T.aimId = t.id; T.ground = false; T.grace = null; m.touchAim = null;
            I.keys.TouchKick = true; I.pr.TouchKick = true;
          } else {
            if (T.stickId != null && ts.get(T.stickId)) ts.get(T.stickId).role = 'old'; // newest finger steers
            t.role = 'stick'; T.stickId = t.id;
          }
        } else if (t.up) {
          // A tap. Without the ball: a team-mate = switch to him, else tackle / header / go for it.
          ts.delete(t.id);
          if (!onBall && now() - t.t0 < TAP_T) {
            let q = null, bd = 16;
            for (const o of p.team.players) {
              if (o === p || o.isGK || o.isDown()) continue;
              const s = scr(R, o), dd = Math.hypot(s.x - t.x, s.y - t.y);
              if (dd < bd) { bd = dd; q = o; }
            }
            if (q) { p.userAuto = false; m.controlled = q; m.manualUntil = m.time + 1; }
            else I.pr.TouchTap = true;
          }
          continue;
        }
      }

      if (t.role === 'aim') {
        // Slingshot: the ball goes the opposite way to the pull.
        const bx = b.rx ?? b.x, by = b.ry ?? b.y;
        const d = worldDir(R, R.sx(bx, by), R.sy(by), -vx, -vy);
        if (d && L > 4) m.touchAim = { x: d.x, y: d.y, f: Math.min(1, L / LMAX), ground: T.ground, kx: -vx, ky: -vy, ox: t.x0, oy: t.y0, fx: t.x, fy: t.y };
        if (t.up) {
          ts.delete(t.id); T.aimId = null; I.keys.TouchKick = false;
          if (L < TAP_PX) { m.touchCancel = true; m.touchAim = null; } // back where you started: cancel
          else I.rel.TouchKick = true;
        }
      } else if (t.role === 'stick') {
        const d = L > STICK_DEAD ? worldDir(R, ps.x, ps.y + 9, vx, vy) : null;
        I.touchAx = d ? { x: Math.round(d.x * 20) / 20, y: Math.round(d.y * 20) / 20 } : { x: 0, y: 0 };
        I.keys.TouchSprint = L > STICK_SPRINT;
        if (t.up) {
          ts.delete(t.id); T.stickId = null;
          T.grace = onBall && d ? { ax: I.touchAx, sprint: I.keys.TouchSprint, until: now() + 0.3 } : null;
          // Quick swipe without the ball: slide tackle that way.
          if (theirBall && d && now() - t.t0 < 0.3 && L > 40) { p.fx = d.x; p.fy = d.y; I.pr.TouchSlide = true; }
        }
      } else if (t.up) ts.delete(t.id); // a lifted modifier / retired finger
    }
  };
})();
