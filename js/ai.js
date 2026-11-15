(function () {
  const C = PP.C, U = PP.U;
  const AI = (PP.AI = {});
  const ATTACKERS = new Set(['ST', 'LW', 'RW', 'AM']);

  // Defensive blocks. Depths are fractions of pitch length from our own goal, widths are
  // fractions of the formation's width.
  //   line      back-line depth with the ball around halfway (low ~18m, mid ~33m, high ~46m)
  //   len       back line -> front line distance (the block's vertical compactness)
  //   width     how much of the formation width is kept (horizontal compactness)
  //   shift     how far the block slides towards the ball side
  //   pressZone press only once the ball is closer to our goal than this
  //   pressers  how many players go to the ball
  AI.BLOCKS = {
    low:  { line: 0.17, len: 0.24, width: 0.62, shift: 0.40, pressZone: 0.42, pressers: 1, range: 10 },
    mid:  { line: 0.31, len: 0.28, width: 0.68, shift: 0.36, pressZone: 0.62, pressers: 1, range: 13 },
    high: { line: 0.44, len: 0.32, width: 0.74, shift: 0.32, pressZone: 1.01, pressers: 2, range: 17 },
  };
  // Where each role sits inside the block: 0 = back line, 1 = front line.
  const TIER = { LB: 0, CB: 0, RB: 0, DM: 0.3, CM: 0.55, LM: 0.55, RM: 0.55, AM: 0.75, LW: 0.72, RW: 0.72, ST: 1 };

  // Depth (our frame) of the opposing outfield player closest to our goal.
  AI.deepestAttacker = function (m, team) {
    let mn = 1;
    for (const o of m.other(team).players) if (!o.isGK) mn = Math.min(mn, team.depth(o.x));
    return mn;
  };

  // Depth of the deepest opponent making a run at our goal (sprinting goal-wards); 1 if none.
  // Static attackers don't drag the line back: offside does that job.
  AI.runnerDepth = function (m, team) {
    // Our second-last player: runners already past it are offside and can be left.
    const ours = team.players.map((q) => team.depth(q.x)).sort((a, b) => a - b);
    const secondLast = ours[1];
    let mn = 1;
    for (const o of m.other(team).players) {
      if (o.isGK || o.vx * (team.ownX - o.x) <= 0 || Math.hypot(o.vx, o.vy) < 5) continue;
      if (team.depth(o.x) < secondLast - 0.01) continue;
      mn = Math.min(mn, team.depth(o.x));
    }
    return mn;
  };

  // The actual offside line in this team's attacking frame (second-last opponent), with no
  // halfway floor.
  AI.trueOffsideLine = function (m, team) {
    const ds = m.other(team).players.map((o) => team.depth(o.x)).sort((a, b) => b - a);
    return ds[1];
  };

  // Moments that invite a press: back to goal, pinned on the touchline, or a back pass.
  AI.pressTrigger = function (m, c) {
    const facingBack = c.fx * c.team.dir < -0.35;
    const touchline = c.y < 6 || c.y > C.H - 6;
    const lk = m.ball.lastKick;
    const backPass = lk && lk.back && lk.target === c && m.time - lk.t < 1.5;
    return facingBack || touchline || backPass;
  };

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

    // Defending roles: pressers go to the ball (count/zone set by the block, +1 on a trigger),
    // otherwise the nearest player contains; defenders goal-side of a runner converge on him.
    const pressers = new Set(), blockers = new Set();
    let container = null;
    if (m.state === 'play' && owner && owner.team !== team) {
      const B = AI.BLOCKS[team.block || 'mid'];
      const cd = team.depth(owner.x);
      const cands = team.players.filter((p) => !p.isGK && p !== userCtl && !p.isDown())
        .map((p) => ({ p, d: U.dist(p.x, p.y, owner.x, owner.y) })).sort((a, b) => a.d - b.d);
      const trig = AI.pressTrigger(m, owner);
      let n = cd < B.pressZone ? B.pressers : 0;
      if (trig && cd < B.pressZone + 0.2) n++;
      const range = B.range + (trig ? 6 : 0);
      for (const c of cands.slice(0, n)) if (c.d < range || c === cands[0]) pressers.add(c.p);
      if (!pressers.size && cands.length) container = cands[0].p;
      const sp = Math.hypot(owner.vx, owner.vy);
      if (sp > 4 && owner.vx * (team.ownX - owner.x) > 0) {
        for (const c of cands) {
          if (blockers.size >= 2 || c.d > 7) break;
          if (pressers.has(c.p) || c.p === container) continue;
          if (team.depth(c.p.x) < cd) blockers.add(c.p);
        }
      }
      if (team.isUser && cands.length) {
        const dCtl = userCtl ? U.dist(userCtl.x, userCtl.y, owner.x, owner.y) : 1e9;
        if (dCtl < cands[0].d + 2 || cands[0].d > 10) { pressers.clear(); container = null; }
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
      if (pressers.has(p)) { AI.press(m, p, owner, false); continue; }
      if (blockers.has(p)) { AI.press(m, p, owner, Math.hypot(owner.vx, owner.vy) > 5.5, 1.6); continue; }
      if (p === container) { AI.contain(m, p, owner); continue; }
      const tg = AI.shapeTarget(m, team, p, phase, lineD);
      const d = U.dist(p.x, p.y, tg.x, tg.y);
      p.steer(tg.x, tg.y, d > 9 || tg.sprint, 2.5);
      if (d < 1.5) p.face(b.x, b.y);
    }
  };

  // Positional target for an off-ball player.
  AI.shapeTarget = function (m, team, p, phase, lineD) {
    const b = m.ball, s = p.slot, r = m.restart;
    const ballD = team.depth(b.x), bl = b.y / C.H;
    let d, l, sprint = false;

    if (m.state === 'restart' && r.kind === 'kickoff') {
      if (p === r.partner) return { x: p.x, y: p.y, sprint: false };
      d = Math.min(s.d * 0.72, 0.45); l = s.l;
    } else if (m.state === 'restart' && r.kind === 'corner') {
      return AI.cornerTarget(m, team, p);
    } else if (phase === 'attack') {
      // The whole team moves with the ball: the back line sits ~28m behind it.
      const back = U.clamp(ballD - 0.27, 0.07, 0.55);
      d = back + (s.d - 0.17) * 0.92;
      l = 0.5 + (s.l - 0.5) * 1.1 + (bl - 0.5) * 0.22;
      if (ATTACKERS.has(s.role) && m.state === 'play') {
        if (m.time > p.runUntil + 1.5 && Math.random() < C.DT * 0.35) p.runUntil = m.time + U.rand(1.2, 2.2);
        if (m.time < p.runUntil) { d = Math.max(d, lineD + 0.05); sprint = true; }
      }
      if (!sprint) d = Math.min(d, lineD - 0.01);
    } else {
      const B = AI.BLOCKS[team.block || 'mid'], comp = team.compact ?? 0.5;
      let line = B.line + (ballD - 0.5) * 0.18;                // breathe with the ball
      line = Math.min(line, ballD - 0.07);                      // stay goal-side of it
      line = Math.min(line, AI.runnerDepth(m, team) - 0.01);     // drop off with runners
      line = Math.max(line, 0.055);
      let tier = TIER[s.role] ?? 0.5;
      if (team.block === 'low' && (s.role === 'LW' || s.role === 'RW')) tier = 0.55; // wingers drop in
      d = line + tier * B.len * (1.2 - 0.4 * comp);
      l = 0.5 + (s.l - 0.5) * B.width * (1.18 - 0.36 * comp) + (bl - 0.5) * B.shift;
    }
    d = U.clamp(d, 0.04, 0.94);
    l = U.clamp(l, 0.03, 0.97);
    const t = team.toWorld(d, l);
    t.sprint = sprint;

    // Don't crowd our own ball carrier.
    const o = b.owner;
    if (phase === 'attack' && o && o.team === team && o !== p && m.state === 'play') {
      const dx = t.x - o.x, dy = t.y - o.y, dd = Math.hypot(dx, dy);
      if (dd < 7) { const n = dd > 0.1 ? { x: dx / dd, y: dy / dd } : { x: -team.dir, y: 0 }; t.x = o.x + n.x * 7; t.y = U.clamp(o.y + n.y * 7, 1, C.H - 1); }
    }

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

  // The carrier's most dangerous forward outlet (for cover shadows).
  AI.bestOutlet = function (m, c) {
    let best = null, bg = 0.02;
    for (const q of c.team.players) {
      if (q === c || q.isGK || U.dist(q.x, q.y, c.x, c.y) > 25) continue;
      const g = c.team.depth(q.x) - c.team.depth(c.x);
      if (g > bg) { bg = g; best = q; }
    }
    return best;
  };

  // Close the carrier down, curving the run so it blocks their best forward pass.
  AI.press = function (m, p, owner, hurry, dist = 1.1) {
    const team = p.team;
    let dir = U.norm(team.ownX - owner.x, C.H / 2 - owner.y);
    const opt = AI.bestOutlet(m, owner);
    if (opt) {
      const to = U.norm(opt.x - owner.x, opt.y - owner.y);
      dir = U.norm(dir.x * 0.6 + to.x * 0.4, dir.y * 0.6 + to.y * 0.4);
    }
    const tx = owner.x + dir.x * dist + owner.vx * 0.25;
    const ty = owner.y + dir.y * dist + owner.vy * 0.25;
    const d = U.dist(p.x, p.y, owner.x, owner.y);
    p.steer(tx, ty, d > 9 || hurry, 1.5);
    if (d < 1.6 && p.tackleCd <= 0 && m.time > m.ball.protectUntil) {
      p.tackleCd = U.rand(1.0, 1.8);
      if (Math.random() < 0.6) m.startLunge(p, owner, 0.24);
    }
  };

  // Stay goal-side a few metres off the carrier without diving in.
  AI.contain = function (m, p, owner) {
    const n = U.norm(p.team.ownX - owner.x, C.H / 2 - owner.y);
    p.steer(owner.x + n.x * 4.5, owner.y + n.y * 4.5, false, 1.5);
    p.face(owner.x, owner.y);
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
    const trueLine = AI.trueOffsideLine(m, team);
    const out = [];
    for (const q of team.players) {
      if (q === p || q.isDown()) continue;
      if (q.isGK && myD > 0.3) continue;
      const d = U.dist(p.x, p.y, q.x, q.y);
      if (d < 5 || d > maxD) continue;
      const qd = team.depth(q.x);
      if (qd > 0.5 && qd > team.depth(p.x) && qd > trueLine + 0.004) continue; // would be offside
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
          aim: side * U.rand(0.65, 1.05),
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
      if (r.partner && Math.random() < 0.7) { m.passTo(p, r.partner, false); return; }
      // otherwise play it straight back into midfield
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
        const zl = b.z + b.vz * tl - 0.5 * C.G * tl * tl;   // height as it reaches the line
        const onTarget = Math.abs(yl - gy) < C.GOAL_W / 2 + 0.6 && zl < C.GOAL_H + 0.4;
        if (tl > 0 && tl < 2.5 && onTarget) {
          // Reaction time before the keeper moves at all.
          if (m.time - b.lastKick.t < 0.14) { gk.stop(); return; }
          const tk = Math.max(0, (gk.x - b.x) / b.vx);
          const yk = b.y + b.vy * tk;
          const zk = U.clamp(b.z + b.vz * tk - 0.5 * C.G * tk * tk, 0, 2);
          const dy = yk - gk.y;
          const need = Math.abs(dy) - 0.7;               // what his standing reach can't cover
          const vmax = 5.5 + gk.stats.diving * 0.04;     // ~8.5 m/s
          // Dive only at the last moment that still gets him there, timed to meet the ball.
          if (need > 0.25 && tk > 0.03 && tk <= need / vmax + 0.08) {
            const v = Math.min(vmax, need / Math.max(tk, 0.08));
            gk.dive = tk + 0.4; gk.diveTotal = gk.dive; gk.diveHold = tk; gk.diveZ = zk; gk.smother = null;
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

    // Opponent running at goal.
    if (b.owner && b.owner.team !== team && m.state === 'play') {
      const c = b.owner;
      const dc = U.dist(c.x, c.y, gx, gy);
      // 1v1: no outfield team-mate between the carrier and our goal -> rush them and go down
      // at their feet (a smother in the box, a tackle outside it).
      const cd = team.depth(c.x);
      let covered = false;
      for (const q of team.players) {
        if (q.isGK || q.isDown()) continue;
        if (team.depth(q.x) < cd - 0.005 && U.segPoint(q.x, q.y, c.x, c.y, gx, gy).d < 4) { covered = true; break; }
      }
      if (!covered && dc < 24) {
        gk.steer(c.x + c.vx * 0.3, c.y + c.vy * 0.3, true, 0.3);
        const dd = U.dist(gk.x, gk.y, c.x, c.y);
        if (dd < 2.4 && gk.tackleCd <= 0 && m.time > b.protectUntil) {
          gk.tackleCd = 1.2;
          if (AI.inBox(team, gk.x, gk.y, 0)) {
            const n = U.norm(c.x - gk.x, c.y - gk.y);
            gk.dive = 0.5; gk.diveTotal = 0.5; gk.diveHold = 0.25; gk.diveZ = 0;
            gk.vx = n.x * 7; gk.vy = n.y * 7; gk.fx = n.x; gk.fy = n.y;
            gk.smother = c; gk.smotherHit = false;
          } else m.startLunge(gk, c, 0.18, 9);
        }
        return;
      }
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
