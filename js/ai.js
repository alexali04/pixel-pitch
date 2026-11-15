(function () {
  const C = PP.C, U = PP.U;
  const AI = (PP.AI = {});
  const ATTACKERS = new Set(['ST', 'LW', 'RW', 'AM']);
  // How far up the pitch a defending shape sits, by block. Stage 2 will flesh these out.
  AI.BLOCK_SHIFT = { high: 0.07, mid: 0, low: -0.12 };
  const BACKLINE = new Set(['LB', 'RB', 'CB']);

  AI.update = function (m, dt) {
    m.ballPath = m.ball.owner ? null : m.ball.predict(30, 0.1);
    for (const t of m.teams) AI.team(m, t, dt);
  };

  // Earliest point on the ball's predicted path this player can reach.
  AI.interceptTime = function (m, p) {
    const b = m.ball, path = m.ballPath, sp = p.topSpeed(true);
    if (!path) return { t: U.dist(p.x, p.y, b.x, b.y) / sp, x: b.x, y: b.y };
    for (let i = 0; i < path.length; i++) {
      const q = path[i];
      if (q.z > 1.8) continue;
      const tt = (i + 1) * 0.1;
      const need = Math.max(0, U.dist(p.x, p.y, q.x, q.y) - 0.6) / sp + 0.15;
      if (need <= tt) return { t: tt, x: q.x, y: q.y };
    }
    const q = path[path.length - 1];
    return { t: 3 + U.dist(p.x, p.y, q.x, q.y) / sp, x: q.x, y: q.y };
  };

  AI.inBox = (team, x, y, margin = 0) => {
    const d = team.dir === 1 ? x : C.W - x;
    return d < C.BOX_D + margin && d > -1 && Math.abs(y - C.H / 2) < C.BOX_W / 2 + margin;
  };

  // Depth (in this team's attacking frame) of the opponents' second-last player: the offside line.
  AI.offsideLine = function (m, team) {
    const ds = m.other(team).players.map((o) => team.depth(o.x)).sort((a, b) => b - a);
    return Math.max(ds[1], 0.5);
  };

  AI.team = function (m, team, dt) {
    const b = m.ball, owner = b.owner;

    if (m.state === 'goal') {
      for (const p of team.players) {
        const k = team.toWorld(Math.min(p.slot.d * 0.6, 0.46), p.slot.l);
        p.steer(k.x, k.y, false);
      }
      return;
    }

    let phase;
    if (m.state === 'restart') phase = m.restart.team === team ? 'attack' : 'defend';
    else if (owner) phase = owner.team === team ? 'attack' : 'defend';
    else {
      const lk = b.lastKick;
      if (lk && lk.team === team && lk.type === 'pass') phase = 'attack';
      else if (lk && lk.team !== team && lk.type === 'pass') phase = 'defend';
      else phase = team.phase;
    }
    team.phase = phase;

    const userCtl = team.isUser && !m.autoplay ? m.controlled : null;

    // Who chases a loose ball.
    let chaser = null;
    if (!owner && m.state === 'play') {
      let bestT = 1e9, ctlT = 1e9;
      for (const p of team.players) {
        if (p.isGK || p.isDown()) continue;
        const it = (p._it = AI.interceptTime(m, p));
        if (p === userCtl) { ctlT = it.t; continue; }
        if (it.t < bestT) { bestT = it.t; chaser = p; }
      }
      if (userCtl && ctlT <= bestT + 0.3) chaser = null;
    }

    // Who presses the ball carrier. High press sends two; a low block only engages once
    // the ball is in its own half.
    const pressers = new Set();
    if (m.state === 'play' && owner && owner.team !== team) {
      const cands = team.players.filter((p) => !p.isGK && p !== userCtl && !p.isDown())
        .map((p) => ({ p, d: U.dist(p.x, p.y, owner.x, owner.y) })).sort((a, b) => a.d - b.d);
      const block = team.block || 'mid';
      let n = block === 'high' ? 2 : 1;
      if (block === 'low' && team.depth(owner.x) > 0.45) n = 0;
      const range = block === 'high' ? 16 : block === 'mid' ? 13 : 10; // only press what's near
      for (const c of cands.slice(0, n)) if (c.d < range || c === cands[0]) pressers.add(c.p);
      if (team.isUser && cands.length) {
        const dCtl = userCtl ? U.dist(userCtl.x, userCtl.y, owner.x, owner.y) : 1e9;
        if (dCtl < cands[0].d + 2 || cands[0].d > 10) pressers.clear();
      }
    }

    const lineD = AI.offsideLine(m, team);
    for (const p of team.players) {
      if (p === userCtl && !p.userAuto) continue; // the user drives this one (keeper included)
      if (p.isGK) { AI.keeper(m, p, dt); continue; }
      if (p.lunge > 0) continue;
      if (p.receiving && m.time - p.receiving.t > 4) p.receiving = null;
      if (p === owner) { if (p !== userCtl) AI.carrier(m, p, dt); continue; }
      if (p === userCtl && !p.userAuto) continue;
      if (p.receiving && !owner && m.state === 'play') {
        const it = p._it || AI.interceptTime(m, p);
        p.steer(it.x, it.y, true, 0.5);
        continue;
      }
      if (p === chaser) { p.steer(p._it.x, p._it.y, true, 0.5); continue; }
      if (pressers.has(p)) { AI.press(m, p, owner); continue; }
      const tg = AI.shapeTarget(m, team, p, phase, lineD);
      const d = U.dist(p.x, p.y, tg.x, tg.y);
      p.steer(tg.x, tg.y, d > 9 || tg.sprint, 2.5);
      if (d < 1.5) p.face(b.x, b.y);
    }
  };

  // Base positional target for an off-ball player. Stage 2 replaces this with tactic-driven blocks.
  AI.shapeTarget = function (m, team, p, phase, lineD) {
    const b = m.ball, s = p.slot, r = m.restart;
    const ballD = team.depth(b.x), bl = b.y / C.H;
    let d, l, sprint = false;

    if (m.state === 'restart' && r.kind === 'kickoff') {
      d = Math.min(s.d * 0.6, 0.46); l = s.l;
    } else if (m.state === 'restart' && r.kind === 'corner') {
      return AI.cornerTarget(m, team, p);
    } else if (phase === 'attack') {
      d = 0.1 + s.d * 0.78 + ballD * 0.32;
      l = 0.5 + (s.l - 0.5) * 1.1 + (bl - 0.5) * 0.2;
      if (ATTACKERS.has(s.role) && m.state === 'play') {
        if (m.time > p.runUntil + 1.5 && Math.random() < C.DT * 0.35) p.runUntil = m.time + U.rand(1.2, 2.2);
        if (m.time < p.runUntil) { d = Math.max(d, lineD + 0.05); sprint = true; }
        else d = Math.min(d, lineD - 0.01);
      }
    } else {
      d = 0.06 + s.d * 0.62 + ballD * 0.3 + (AI.BLOCK_SHIFT[team.block] || 0);
      l = 0.5 + (s.l - 0.5) * 0.75 + (bl - 0.5) * 0.35;
      if (BACKLINE.has(s.role)) d = Math.min(d, ballD - 0.03);
    }
    d = U.clamp(d, 0.04, 0.94);
    l = U.clamp(l, 0.03, 0.97);
    const t = team.toWorld(d, l);
    t.sprint = sprint;

    if (m.state === 'restart' && r.team !== team) {
      const R = r.kind === 'throw' ? 3 : r.kind === 'phase' ? 14 : 9.2;
      const dx = t.x - b.x, dy = t.y - b.y, dd = Math.hypot(dx, dy);
      if (dd < R) {
        const n = dd > 0.1 ? { x: dx / dd, y: dy / dd } : { x: -team.dir, y: 0 };
        t.x = b.x + n.x * R; t.y = b.y + n.y * R;
      }
    }
    return t;
  };

  const CORNER_ATT = [[0.95, 0.46], [0.94, 0.55], [0.91, 0.5], [0.89, 0.4], [0.89, 0.6], [0.83, 0.5], [0.8, 0.3], [0.55, 0.42], [0.55, 0.58], [0.7, 0.75]];
  const CORNER_DEF = [[0.01, 0.45], [0.01, 0.55], [0.05, 0.5], [0.07, 0.42], [0.07, 0.58], [0.1, 0.48], [0.1, 0.36], [0.1, 0.64], [0.16, 0.5], [0.3, 0.5]];
  AI.cornerTarget = function (m, team, p) {
    const attacking = m.restart.team === team;
    const list = team.outfield().filter((q) => q !== m.restart.taker)
      .sort((a, b) => b.stats.heading - a.stats.heading);
    const i = list.indexOf(p);
    const spot = (attacking ? CORNER_ATT : CORNER_DEF)[Math.max(0, i)] || [0.5, 0.5];
    const t = team.toWorld(spot[0], spot[1]);
    t.sprint = false;
    return t;
  };

  AI.press = function (m, p, owner) {
    const team = p.team;
    const n = U.norm(team.ownX - owner.x, C.H / 2 - owner.y);
    const tx = owner.x + n.x * 1.1 + owner.vx * 0.25;
    const ty = owner.y + n.y * 1.1 + owner.vy * 0.25;
    const d = U.dist(p.x, p.y, owner.x, owner.y);
    p.steer(tx, ty, d > 9, 1.5);
    if (d < 1.6 && p.tackleCd <= 0 && m.time > m.ball.protectUntil) {
      p.tackleCd = U.rand(1.0, 1.8);
      if (Math.random() < 0.6) m.startLunge(p, owner, 0.24);
    }
  };

  // ---------- ball carrier ----------

  AI.carrier = function (m, p, dt) {
    if (m.state === 'restart') {
      p.stop();
      const r = m.restart;
      const delay = r.kind === 'gk' ? 1.4 : r.kind === 'kickoff' ? 0.8 : 1.1;
      if (r.t >= delay) AI.restartKick(m, p, r);
      return;
    }
    p.think -= dt;
    if (p.think <= 0 || !p.plan) {
      p.think = U.rand(0.22, 0.4);
      const plan = AI.decide(m, p);
      if (plan.kind === 'shoot') { m.shoot(p, plan.aim, plan.power); p.plan = null; return; }
      if (plan.kind === 'pass') { m.passTo(p, plan.target, plan.lofted); p.plan = null; return; }
      if (plan.kind === 'clear') { m.kickTo(p, plan.x, plan.y, true, 'clear', null); p.plan = null; return; }
      p.plan = plan;
    }
    p.steer(p.plan.x, p.plan.y, p.plan.sprint, 0.5);
  };

  AI.nearestOpp = function (m, p) {
    let best = null, bd = 1e9;
    for (const o of m.other(p.team).players) {
      const d = U.dist(p.x, p.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return { o: best, d: bd };
  };

  // Scored pass options for a carrier. Lane safety asks: can any opponent reach a point on
  // the ball's path before the ball gets there?
  AI.passOptions = function (m, p, maxD = 45) {
    const team = p.team, opp = m.other(team);
    const myD = team.depth(p.x);
    const lk = m.ball.lastKick;
    const lineD = AI.offsideLine(m, team);
    const out = [];
    for (const q of team.players) {
      if (q === p || q.isDown()) continue;
      if (q.isGK && myD > 0.3) continue;
      const d = U.dist(p.x, p.y, q.x, q.y);
      if (d < 5 || d > maxD) continue;
      const qd = team.depth(q.x);
      if (qd > lineD + 0.01 && qd > 0.5) continue; // would be offside
      const gain = qd - myD;
      const Tg = PP.Ball.groundTime(d, PP.Match.arrivalSpeed(d));
      const Tl = PP.Ball.loftTime(d);
      let lane = 1e9, open = 1e9, landM = 1e9;
      for (const o of opp.players) {
        const od = U.dist(o.x, o.y, q.x, q.y);
        open = Math.min(open, od);
        const osp = o.topSpeed(true) * 0.85;
        landM = Math.min(landM, od - (0.9 + Math.max(0, Tl - 0.3) * osp * 0.7));
        const sp = U.segPoint(o.x, o.y, p.x, p.y, q.x, q.y);
        if (sp.t < 0.02 || sp.t > 0.9) continue;
        const reach = 0.9 + Math.max(0, sp.t * Tg - 0.3) * osp;
        lane = Math.min(lane, sp.d - reach);
      }
      const back = lk && lk.by === q && m.time - lk.t < 3 ? 0.4 : 0;
      const free = Math.min(open, 8) / 8;
      const square = gain < 0.02 ? 0.25 : 0;
      let s = gain * 5 + U.clamp(lane / 2.5, -1, 1) * 0.8 + free * 0.5 - d / 50 - 0.4 - back - square + U.rand(-0.1, 0.1);
      if (lane < 0) s -= 2;
      out.push({ kind: 'pass', target: q, lofted: false, score: s, lane });
      if (d > 14) {
        let sl = gain * 5 + U.clamp(landM / 3, -1, 1) * 0.9 - 0.6 - d / 70 - back + U.rand(-0.1, 0.1);
        if (landM < 0) sl -= 2;
        out.push({ kind: 'pass', target: q, lofted: true, score: sl, lane: landM });
      }
    }
    return out.sort((a, b) => b.score - a.score);
  };

  AI.decide = function (m, p) {
    const team = p.team, opp = m.other(team);
    const gx = team.attackX, gy = C.H / 2;
    const dG = U.dist(p.x, p.y, gx, gy);
    const myD = team.depth(p.x);
    const near = AI.nearestOpp(m, p);
    if (p.isGK) {
      const best = AI.passOptions(m, p, 55)[0];
      if (best && (best.score > -1 || near.d > 6)) return best;
      const t = team.toWorld(0.6, U.rand(0.15, 0.85));
      return { kind: 'clear', x: t.x, y: t.y };
    }
    const pressure = near.d;

    // Shoot?
    const angleOK = Math.abs(p.y - gy) < 0.9 * Math.abs(p.x - gx) + 3;
    if (angleOK && dG < 28) {
      let blockers = 0;
      for (const o of opp.players) {
        if (o.isGK) continue;
        if (U.segPoint(o.x, o.y, p.x, p.y, gx, gy).d < 1.2) blockers++;
      }
      let want = dG < 13 ? 0.85 : dG < 19 ? 0.4 : 0.1 * (p.stats.longShots / 70);
      if (blockers) want *= 0.4;
      if (Math.random() < want) {
        const side = opp.gk.y < gy ? 1 : -1;
        return {
          kind: 'shoot',
          aim: side * U.rand(0.5, 0.95),
          power: U.clamp(0.4 + dG / 40 + U.rand(-0.1, 0.15), 0.35, 0.95),
        };
      }
    }

    // Clear it from our own third under pressure.
    if (myD < 0.2 && pressure < 2.5 && Math.random() < 0.5) {
      const t = team.toWorld(0.55, U.rand(0.15, 0.85));
      return { kind: 'clear', x: t.x, y: t.y };
    }

    const opts = AI.passOptions(m, p);
    const best = opts[0];

    // Space ahead for a dribble.
    let space = 12;
    for (const o of opp.players) {
      const dx = (o.x - p.x) * team.dir, dy = o.y - p.y;
      if (dx > 0 && Math.abs(dy) < dx * 1.2 + 1) space = Math.min(space, Math.hypot(dx, dy));
    }
    const held = m.time - (p.gotBallAt || 0);
    const dribS = (space / 12) * 0.9 + (p.stats.dribbling - 60) / 100 - (pressure < 2.2 ? 0.8 : 0) - 0.3
      + (held < 1.2 && pressure > 2.5 ? 0.6 : 0) + (space > 7 && pressure > 3 ? 0.4 : 0);
    if (best && (best.score > dribS || (pressure < 1.8 && best.score > -0.6))) return best;

    let tx, ty;
    if (dG < 25) { tx = gx; ty = gy; }
    else { tx = p.x + team.dir * 10; ty = p.y + (gy - p.y) * 0.2; }
    if (near.o && near.d < 5) {
      const n = U.norm(p.x - near.o.x, p.y - near.o.y);
      ty += n.y * 6;
      tx += Math.max(0, n.x * team.dir) * team.dir * 3;
    }
    ty = U.clamp(ty, 2, C.H - 2);
    return { kind: 'dribble', x: tx, y: ty, sprint: space > 6 };
  };

  AI.restartKick = function (m, p, r) {
    const team = p.team;
    if (r.kind === 'corner') {
      const inBox = team.outfield().filter((q) => q !== p && team.depth(q.x) > 0.82);
      const q = inBox.length ? U.pick(inBox) : null;
      if (q) { m.passTo(p, q, true); return; }
    }
    let opts = AI.passOptions(m, p, r.kind === 'throw' ? 22 : 50);
    if (r.kind === 'throw' || r.kind === 'kickoff') opts = opts.filter((o) => !o.lofted || r.kind === 'throw');
    if (r.kind === 'kickoff') {
      // play it back or sideways to a teammate in our half
      const backs = opts.filter((o) => team.depth(o.target.x) < 0.5);
      if (backs.length) opts = backs;
    }
    if (opts.length) { m.passTo(p, opts[0].target, opts[0].lofted); return; }
    const t = team.toWorld(team.depth(p.x) + 0.3, U.rand(0.2, 0.8));
    m.kickTo(p, t.x, t.y, true, 'clear', null);
  };

  // ---------- goalkeeper ----------

  AI.keeper = function (m, gk, dt) {
    const team = gk.team, b = m.ball, gx = team.ownX, gy = C.H / 2;
    if (b.owner === gk) { AI.carrier(m, gk, dt); return; }
    if (gk.isDown()) return;

    // Shot or ball heading at goal: get across, dive if needed.
    const fromOpp = b.lastKick && b.lastKick.team !== team;
    if (!b.owner && m.state === 'play' && fromOpp) {
      const sp = Math.hypot(b.vx, b.vy);
      if ((gx - b.x) * b.vx > 0 && sp > 7) {
        const tl = (gx - b.x) / b.vx;
        const yl = b.y + b.vy * tl;
        if (tl > 0 && tl < 2.5 && Math.abs(yl - gy) < C.GOAL_W / 2 + 1.5) {
          const tk = Math.max(0, (gk.x - b.x) / b.vx);
          const yk = b.y + b.vy * tk;
          const dy = yk - gk.y;
          if (Math.abs(dy) > 1.0 && tk < 0.55 && tk > 0.04) {
            const v = Math.min(Math.abs(dy) / Math.max(tk, 0.12) + 1, 4.5 + gk.stats.diving * 0.05);
            gk.dive = 0.65;
            gk.vx = 0; gk.vy = Math.sign(dy) * v;
            gk.fx = 0; gk.fy = Math.sign(dy);
            return;
          }
          gk.steer(gk.x, U.clamp(yk, C.GOAL_Y1 - 0.5, C.GOAL_Y2 + 0.5), true, 0.3);
          return;
        }
      }
    }

    // Sweep a loose ball in the box if we get there first.
    if (!b.owner && m.state === 'play' && AI.inBox(team, b.x, b.y, 1)) {
      const it = AI.interceptTime(m, gk);
      let first = true;
      for (const o of m.other(team).players) {
        if (AI.interceptTime(m, o).t < it.t - 0.1) { first = false; break; }
      }
      if (first) { gk.steer(it.x, it.y, true, 0.3); return; }
    }

    // Opponent running at goal inside the box: narrow the angle and try to smother.
    if (b.owner && b.owner.team !== team && m.state === 'play') {
      const c = b.owner;
      const dc = U.dist(c.x, c.y, gx, gy);
      if (dc < 16 && AI.inBox(team, c.x, c.y, 0)) {
        const n = U.norm(c.x - gx, c.y - gy);
        const r = U.clamp(dc - 2.5, 1, 8);
        gk.steer(gx + n.x * r, gy + n.y * r, true, 0.5);
        if (U.dist(gk.x, gk.y, c.x, c.y) < 1.3 && gk.tackleCd <= 0) {
          gk.tackleCd = 0.8;
          if (Math.random() < 0.45 + (gk.stats.gkPositioning - 70) * 0.01) m.gkHold(gk);
        }
        return;
      }
    }

    // Default: sit on the line between ball and goal centre.
    const n = U.norm(b.x - gx, b.y - gy);
    const db = U.dist(b.x, b.y, gx, gy);
    const r = U.clamp(1 + db * 0.06, 1, 4.5);
    gk.steer(gx + n.x * r, gy + n.y * r * 0.9, false, 0.8);
    if (Math.hypot(gk.vx, gk.vy) < 0.5) gk.face(b.x, b.y);
  };
})();
