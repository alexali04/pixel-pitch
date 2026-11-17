(function () {
  const C = PP.C, U = PP.U;
  const AI = (PP.AI = {});
  const ATTACKERS = new Set(['ST', 'LW', 'RW', 'AM']);

  // Shape knobs (attack back-line gap behind the ball, its max depth, full-back push, recovery runs).
  AI.TUNE = { backGap: 0.19, backMax: 0.62, fbPush: true, recover: true, link: true, jockey: true, manMark: true, playOut: true, sharp: true, mates: true };

  // Defensive blocks. Depths are fractions of pitch length from our own goal, widths are
  // fractions of the formation's width.
  //   line      back-line depth with the ball around halfway (low ~18m, mid ~33m, high ~46m)
  //   len       back line -> front line distance (the block's vertical compactness)
  //   width     how much of the formation width is kept (horizontal compactness)
  //   shift     how far the block slides towards the ball side
  //   pressZone press only once the ball is closer to our goal than this
  //   pressers  how many players go to the ball
  AI.BLOCKS = {
    low:  { line: 0.17, len: 0.24, width: 0.72, shift: 0.38, pressZone: 0.40, pressers: 1, range: 10 },
    mid:  { line: 0.31, len: 0.28, width: 0.78, shift: 0.34, pressZone: 0.52, pressers: 1, range: 12 },
    high: { line: 0.44, len: 0.32, width: 0.82, shift: 0.30, pressZone: 1.01, pressers: 2, range: 17 },
  };
  // Where each role sits inside the block: 0 = back line, 1 = front line.
  const TIER = { LB: 0, CB: 0, RB: 0, DM: 0.3, CM: 0.55, LM: 0.55, RM: 0.55, AM: 0.75, LW: 0.72, RW: 0.72, ST: 1 };

  // Where a slot stands for the squad screen's map, using the same shape rules as in play:
  // view 'with' = our ball around halfway, 'without' = their ball around halfway.
  AI.previewSlot = function (style, role, sd, sl, view) {
    if (role === 'GK') return { d: 0.02, l: 0.5 };
    let d, l;
    if (view === 'with') {
      d = 0.26 + (sd - 0.17) * 0.92 + (role === 'LB' || role === 'RB' ? 0.06 : 0);
      l = 0.5 + (sl - 0.5) * 1.1;
    } else {
      const B = AI.BLOCKS[style.block || 'mid'], comp = style.compact ?? 0.5;
      let tier = TIER[role] ?? 0.5;
      const wide = role === 'LW' || role === 'RW';
      if ((style.fwdDefend || 'help') === 'help') {
        if (wide) tier = style.block === 'low' ? 0.45 : 0.52;
        else if (role === 'ST') tier = 0.8;
        else if (role === 'AM') tier = 0.6;
      } else if (wide || role === 'ST') tier += 0.35;
      d = B.line + tier * B.len * (1.2 - 0.4 * comp);
      l = 0.5 + (sl - 0.5) * B.width * (1.18 - 0.36 * comp);
    }
    return { d: U.clamp(d, 0.04, 0.88), l: U.clamp(l, 0.04, 0.96) };
  };

  // Depth (our frame) of the opposing outfield player closest to our goal.
  AI.deepestAttacker = function (m, team) {
    let mn = 1;
    for (const o of m.other(team).players) if (!o.isGK && !o.sentOff) mn = Math.min(mn, team.depth(o.x));
    return mn;
  };

  // Depth of the deepest opponent making a run at our goal (sprinting goal-wards); 1 if none.
  // Static attackers don't drag the line back: offside does that job.
  AI.runnerDepth = function (m, team) {
    // Our second-last player: runners already past it are offside and can be left.
    const ours = team.players.filter((q) => !q.sentOff).map((q) => team.depth(q.x)).sort((a, b) => a - b);
    const secondLast = ours[1] ?? 0;
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
    const ds = m.other(team).players.filter((o) => !o.sentOff).map((o) => team.depth(o.x)).sort((a, b) => b - a);
    return ds[1] ?? 1; // fewer than two of them (a practice drill): nobody can be offside
  };

  // Moments that invite a press: back to goal, pinned on the touchline, or a back pass.
  AI.pressTrigger = function (m, c) {
    const facingBack = c.fx * c.team.dir < -0.35;
    const touchline = c.y < 6 || c.y > C.H - 6;
    const lk = m.ball.lastKick;
    const backPass = lk && lk.back && lk.target === c && m.time - lk.t < 1.5;
    return facingBack || touchline || backPass || AI.dawdling(m, c);
  };
  // How aggressively a team presses, 0..1 (part of its style; older saves fall back on the
  // block). It sets how soon they jump on a carrier standing on the ball, whether they jockey or
  // fly in, how fast they close down and how often they lunge.
  AI.aggr = (team) => team.style.aggression ?? { low: 0.3, mid: 0.5, high: 0.8 }[team.style.block] ?? 0.5;
  // Standing on the ball: had it a while (less, the more aggressive they are) and barely moving.
  AI.dawdling = (m, c) => m.time - (c.gotBallAt ?? m.time) > 2.4 - 1.8 * AI.aggr(m.other(c.team)) && Math.hypot(c.vx, c.vy) < 1.5;

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
    const ds = m.other(team).players.filter((o) => !o.sentOff).map((o) => team.depth(o.x)).sort((a, b) => b - a);
    return Math.max(ds[1] ?? 1, 0.5);
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

    const ctl = team.isUser && !m.autoplay ? m.controlled : null;
    // A controlled defender on auto (defending assist) is treated as a normal AI player.
    const userCtl = ctl && !(ctl.userAuto && phase === 'defend') ? ctl : null;

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
      const lk = b.lastKick;
      if (lk && lk.type === 'pass' && lk.team !== team && m.time - lk.t < 0.22) chaser = null; // read the pass first
    }

    // Defending roles: pressers go to the ball (count/zone set by the block, +1 on a trigger),
    // otherwise the nearest player contains; defenders goal-side of a runner converge on him.
    const pressers = new Set(), blockers = new Set();
    let container = null, screen = null;
    if (m.state === 'play' && owner && owner.team !== team) {
      const B = AI.BLOCKS[team.block || 'mid'];
      const cd = team.depth(owner.x);
      const cands = team.players.filter((p) => !p.isGK && p !== userCtl && !p.isDown())
        .map((p) => ({ p, d: U.dist(p.x, p.y, owner.x, owner.y) })).sort((a, b) => a.d - b.d);
      const trig = AI.pressTrigger(m, owner);
      let n = cd < B.pressZone ? B.pressers : 0;
      if (trig && cd < B.pressZone + 0.2) n++;
      const sinceLost = team.lostAt != null ? m.time - team.lostAt : 99;
      // Counter-press: a high-press side swarms the ball the moment it's lost. Others put one
      // man on it briefly if it was lost high up, and the rest drop off and get organised.
      if (team.block === 'high' && sinceLost < 2.5) n = Math.max(n, 1) + 1;
      else if (sinceLost < 1.5 && cd > 0.6) n = 1;
      else if (team.block !== 'high' && sinceLost < 3 && cd > 0.45) n = 0;
      // No stand-offs: someone goes to a carrier standing on the ball, from further out the
      // more aggressive the side (a low block still won't come out to halfway for it).
      if (AI.dawdling(m, owner) && cd < B.pressZone + 0.15 + 0.35 * AI.aggr(team)) n = Math.max(n, 1);
      const maxEngaged = 2; // never a pack of defenders on one man: one presses, one covers
      n = Math.min(n, maxEngaged);
      const range = B.range + (trig ? 6 : 0) + 6 * AI.aggr(team);
      for (const c of cands.slice(0, n)) if (c.d < range || c === cands[0]) pressers.add(c.p);
      if (!pressers.size && cands.length) container = cands[0].p;
      const sp = Math.hypot(owner.vx, owner.vy);
      if (sp > 4 && owner.vx * (team.ownX - owner.x) > 0) {
        for (const c of cands) {
          if (pressers.size + blockers.size + (container ? 1 : 0) >= maxEngaged || c.d > 7) break;
          if (pressers.has(c.p) || c.p === container) continue;
          if (team.depth(c.p.x) < cd) blockers.add(c.p);
        }
      }
      if (team.isUser && cands.length) {
        const dCtl = userCtl ? U.dist(userCtl.x, userCtl.y, owner.x, owner.y) : 1e9;
        if (dCtl < cands[0].d + 2 || cands[0].d > 10) {
          pressers.clear();
          container = cands[0].d < 14 ? cands[0].p : null; // nearest team-mate covers behind you
        }
      }
      // High press: while they build up from the back, a midfielder screens their holding
      // midfielder (sits in the passing lane, touch-tight), so the easy ball into him is gone.
      if (team.block === 'high' && cd > 0.55) {
        const piv = m.other(team).outfield().filter((o) => o !== owner && ['DM', 'CM'].includes(o.role))
          .sort((a, c) => (m.other(team).depth(a.x) + Math.abs(a.y - C.H / 2) / C.H) - (m.other(team).depth(c.x) + Math.abs(c.y - C.H / 2) / C.H))[0];
        if (piv) {
          const mk = team.outfield().filter((q) => q !== userCtl && !q.isDown() && !pressers.has(q) && q !== container && ['AM', 'CM', 'DM', 'ST'].includes(q.role))
            .sort((a, c) => U.dist(a.x, a.y, piv.x, piv.y) - U.dist(c.x, c.y, piv.x, piv.y))[0];
          if (mk) screen = { p: mk, o: piv };
        }
      }
    }

    // High press: everyone not on the ball picks up a man (see AI.manMarks).
    const busy = new Set([...pressers, ...blockers, container, screen && screen.p, userCtl && !userCtl.userAuto ? userCtl : null]);
    let marks = m.state === 'restart' ? AI.setPieceMarks(m, team) : AI.manMarks(m, team, owner, busy);
    if (!marks.size && m.state === 'play' && AI.crossDanger(m, team)) marks = AI.boxMarks(m, team, new Set([...busy, chaser]));
    if (marks.size) screen = null;

    const lineD = AI.offsideLine(m, team);
    const support = m.state === 'play' && owner && owner.team === team && !team.isUser && AI.TUNE.playOut ? AI.supportSpots(m, team, owner) : null;
    for (const p of team.players) {
      p.aiRole = null;
      if (p.sentOff) { p.stop(); continue; }
      if (m.state === 'restart' && p.wallSpot) { p.aiRole = 'wall'; p.steer(p.wallSpot.x, p.wallSpot.y, false, 0.3); p.face(b.x, b.y); continue; }
      if (p === userCtl && !p.userAuto) { p.aiRole = 'you'; continue; } // the user drives this one (keeper included)
      if (p.isGK) { p.aiRole = 'keeper'; AI.keeper(m, p, dt); continue; }
      if (p.lunge > 0) continue;
      if (p.receiving && m.time - p.receiving.t > 4) p.receiving = null;
      if (p === owner) { p.aiRole = 'carrier'; if (p !== userCtl) AI.carrier(m, p, dt); continue; }
      if (p === userCtl && !p.userAuto) continue;
      if (p.receiving && !owner && m.state === 'play') {
        const it = p._it || AI.interceptTime(m, p);
        p.aiRole = 'receiving';
        p.steer(it.x, it.y, true, 0.5);
        continue;
      }
      if (p === chaser) { p.aiRole = 'chaser'; p.steer(p._it.x, p._it.y, true, 0.5); continue; }
      if (pressers.has(p)) { p.aiRole = 'presser'; AI.press(m, p, owner, false); continue; }
      if (blockers.has(p)) { p.aiRole = 'blocker'; AI.press(m, p, owner, Math.hypot(owner.vx, owner.vy) > 5.5, 1.6); continue; }
      if (p === container) { p.aiRole = 'container'; AI.contain(m, p, owner); continue; }
      if (support && support.has(p)) { p.aiRole = 'support'; const sp = support.get(p); p.steer(sp.x, sp.y, U.dist(p.x, p.y, sp.x, sp.y) > 4, 0.6); p.face(owner.x, owner.y); continue; }
      if (marks.has(p)) { p.aiRole = 'marking ' + marks.get(p).name; AI.manMark(m, p, marks.get(p), owner); continue; }
      if (screen && p === screen.p) {
        p.aiRole = 'screen';
        const o = screen.o, n = U.norm(owner.x - o.x, owner.y - o.y);
        const tx = o.x + n.x * 1.3, ty = o.y + n.y * 1.3;
        p.steer(tx, ty, U.dist(p.x, p.y, tx, ty) > 3, 0.6); p.face(owner.x, owner.y);
        continue;
      }
      p.aiRole = 'shape (' + phase + ')';
      const raw = AI.shapeTarget(m, team, p, phase, lineD);
      // Positioning: good positional players track shape shifts quickly; poor ones lag and drift.
      const pos = p.stats.positioning / 100;
      if (p.tgx == null || m.state !== 'play') { p.tgx = raw.x; p.tgy = raw.y; }
      // Runs are decisive, and so is dropping back: a deeper target is taken up at once.
      const dropping = AI.TUNE.recover && phase === 'defend' && team.depth(raw.x) < team.depth(p.tgx) - 0.01;
      const k = Math.min(1, dt * (raw.sprint ? 12 : dropping ? 5 + pos * 4 : 1.5 + pos * 6));
      p.tgx += (raw.x - p.tgx) * k; p.tgy += (raw.y - p.tgy) * k;
      const wob = (1 - pos) * 2.2;
      const tg = { x: p.tgx + Math.sin(m.time * 0.5 + p.idx * 1.7) * wob, y: p.tgy + Math.cos(m.time * 0.4 + p.idx * 2.3) * wob, sprint: raw.sprint };
      if (phase === 'defend' && m.state === 'play') AI.mark(m, team, p, tg);
      const d = U.dist(p.x, p.y, tg.x, tg.y);
      // Recovery: caught upfield of the ball after losing it -> sprint back into shape.
      const stayUp = AI.fwdDefend(team) === 'high' && (p.slot.role === 'ST' || p.slot.role === 'LW' || p.slot.role === 'RW');
      // Recovery: anyone with ground to make up towards our goal sprints back, defenders soonest.
      const backRole = p.slot.role === 'CB' || p.slot.role === 'LB' || p.slot.role === 'RB' || p.slot.role === 'DM';
      const behindBy = team.depth(p.x) - team.depth(tg.x);
      const recover = AI.TUNE.recover && phase === 'defend' && !stayUp && behindBy > (backRole ? 0.025 : 0.05);
      const upfield = phase === 'defend' && !stayUp && team.depth(p.x) > team.depth(b.x) + 0.02;
      p.steer(tg.x, tg.y, d > 9 || tg.sprint || recover || (upfield && d > 3), 2.5);
      if (d < 1.5) p.face(b.x, b.y);
    }
  };

  // Playing out under pressure: when their carrier is being closed down outside our third, the
  // two nearest team-mates come to him at angles the press isn't covering (a free spot 8-12m
  // away with a clear lane), so there's always a pass on. Returns Map(player -> spot).
  AI.supportSpots = function (m, team, owner) {
    const opp = m.other(team), near = AI.nearestOpp(m, owner);
    if (near.d > 6 || team.depth(owner.x) > 0.7 || owner.isGK) return null;
    const cands = team.outfield().filter((q) => q !== owner && !q.isDown() && !q.receiving && U.dist(q.x, q.y, owner.x, owner.y) < 24)
      .sort((a, c) => U.dist(a.x, a.y, owner.x, owner.y) - U.dist(c.x, c.y, owner.x, owner.y)).slice(0, 2);
    const out = new Map(), taken = [];
    const awayFromPress = U.norm(owner.x - near.o.x, owner.y - near.o.y);
    for (const q of cands) {
      let best = null, bs = -1e9;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2, r = 8 + (k % 3) * 2;
        const x = owner.x + Math.cos(a) * r, y = owner.y + Math.sin(a) * r;
        if (y < 1.5 || y > C.H - 1.5 || x < 2 || x > C.W - 2) continue;
        if (team.depth(x) < 0.04) continue;
        let free = 8, lane = 4;
        for (const o of opp.players) {
          free = Math.min(free, U.dist(o.x, o.y, x, y));
          const sp = U.segPoint(o.x, o.y, owner.x, owner.y, x, y);
          if (sp.t > 0.1 && sp.t < 0.95) lane = Math.min(lane, sp.d);
        }
        const fwd = (team.depth(x) - team.depth(owner.x)) * 6;              // forward angles are worth more
        const awayDot = (Math.cos(a) * awayFromPress.x + Math.sin(a) * awayFromPress.y) * 0.8; // not behind the presser
        const crowd = taken.some((t) => U.dist(t.x, t.y, x, y) < 7) ? 4 : 0;
        const s = free * 0.5 + lane * 0.6 + fwd + awayDot - U.dist(q.x, q.y, x, y) * 0.12 - crowd;
        if (s > bs) { bs = s; best = { x, y }; }
      }
      if (best) { out.set(q, best); taken.push(best); }
    }
    return out;
  };

  // Man-to-man for high-press sides while the ball is in midfield or their half: each free
  // outfield player takes the nearest unmarked opponent (sticky, so pairs don't swap every
  // frame). With a man to spare the deepest stays back as cover; short of men, the opponents
  // furthest from our goal go free. Once the ball gets into our third, back to the block.
  AI.manMarks = function (m, team, owner, busy) {
    const out = new Map();
    if (team.block !== 'high' || !owner || owner.team === team || m.state !== 'play' || team.depth(owner.x) < 0.38 || !AI.TUNE.manMark) {
      team._marks = null; return out;
    }
    let ours = team.outfield().filter((p) => !busy.has(p) && !p.isDown() && !p.sentOff);
    let foes = m.other(team).outfield().filter((o) => o !== owner && !o.sentOff);
    if (ours.length > foes.length) ours = ours.sort((a, b) => team.depth(a.x) - team.depth(b.x)).slice(ours.length - foes.length);
    if (foes.length > ours.length) foes = foes.sort((a, b) => team.depth(a.x) - team.depth(b.x)).slice(0, ours.length);
    // Pairs hold for 1.2s whatever; after that a pair is kept while the marker is still close
    // to his man (so they don't all swap every 1.2s), and stretched ones get re-matched.
    const prev = team._marks || new Map(), fresh = m.time - (team._marksT ?? -9) < 1.2;
    if (!fresh) team._marksT = m.time;
    const taken = new Set();
    for (const [p, o] of prev) {
      if (ours.includes(p) && foes.includes(o) && !taken.has(o) && U.dist(p.x, p.y, o.x, o.y) < (fresh ? 22 : 10)) { out.set(p, o); taken.add(o); }
    }
    const pairs = [];
    for (const p of ours) if (!out.has(p)) for (const o of foes) if (!taken.has(o)) pairs.push([U.dist(p.x, p.y, o.x, o.y), p, o]);
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, p, o] of pairs) if (!out.has(p) && !taken.has(o)) { out.set(p, o); taken.add(o); }
    team._marks = out;
    return out;
  };

  // A cross is on: they have it within ~35m of our goal, or their lofted ball is dropping into
  // (or near) our box.
  AI.crossDanger = function (m, team) {
    const b = m.ball, o = b.owner;
    if (o) return o.team !== team && team.depth(o.x) < 0.34;
    const lk = b.lastKick;
    if (!lk || lk.team === team || !m.ballPath || (b.z < 0.5 && b.vz < 2)) return false;
    const land = m.ballPath.find((q) => q.z < 2) || m.ballPath[m.ballPath.length - 1];
    return AI.inBox(team, land.x, land.y, 5);
  };
  // Box marking against crosses: every attacker in or around our box gets a man, nearest our
  // goal first, from whoever is closest and free. Spare defenders hold their zones.
  AI.boxMarks = function (m, team, busy) {
    const out = new Map(), owner = m.ball.owner;
    const ours = team.outfield().filter((p) => !busy.has(p) && !p.isDown() && !p.sentOff);
    const foes = m.other(team).outfield().filter((o) => o !== owner && !o.sentOff && AI.inBox(team, o.x, o.y, 6))
      .sort((a, c) => U.dist(a.x, a.y, team.ownX, C.H / 2) - U.dist(c.x, c.y, team.ownX, C.H / 2));
    const prev = team._boxMarks || new Map(), taken = new Set();
    for (const [p, o] of prev) if (ours.includes(p) && foes.includes(o) && !taken.has(o)) { out.set(p, o); taken.add(o); }
    for (const o of foes) {
      if (taken.has(o)) continue;
      let best = null, bd = 1e9;
      for (const p of ours) {
        if (out.has(p)) continue;
        const d = U.dist(p.x, p.y, o.x, o.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) { out.set(best, o); taken.add(o); }
    }
    team._boxMarks = out;
    return out;
  };

  // Defending a free kick within ~40m of our goal: the players not in the wall pick up their
  // most dangerous attackers (nearest our goal first), each taking the closest free defender.
  // Spare defenders hold their shape.
  AI.setPieceMarks = function (m, team) {
    const r = m.restart, out = new Map();
    // Corners too: the men in the box get picked up; the rest keep their corner zones.
    if (r && r.kind === 'corner' && r.team !== team) return AI.boxMarks(m, team, new Set(m.controlled && m.controlled.team === team && !m.controlled.userAuto ? [m.controlled] : []));
    if (!r || r.kind !== 'freekick' || r.team === team || team.depth(m.ball.x) > 0.4) return out;
    const ctl = m.controlled && m.controlled.team === team && !m.controlled.userAuto ? m.controlled : null;
    const ours = team.outfield().filter((p) => !p.wallSpot && p !== ctl && !p.sentOff);
    const foes = r.team.outfield().filter((o) => o !== r.taker && !o.sentOff && team.depth(o.x) < 0.42)
      .sort((a, c) => U.dist(a.x, a.y, team.ownX, C.H / 2) - U.dist(c.x, c.y, team.ownX, C.H / 2));
    for (const o of foes) {
      let best = null, bd = 1e9;
      for (const p of ours) {
        if (out.has(p)) continue;
        const d = U.dist(p.x, p.y, o.x, o.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) out.set(best, o);
    }
    return out;
  };

  // Mark a man: touch-tight, goal-side and a little ball-side when he's in range of a pass,
  // a couple of metres off when he's far from the ball.
  AI.manMark = function (m, p, o, owner) {
    owner = owner || m.ball;
    const g = U.norm(p.team.ownX - o.x, C.H / 2 - o.y), bd = U.norm(owner.x - o.x, owner.y - o.y);
    const near = U.dist(o.x, o.y, owner.x, owner.y) < 30, box = AI.inBox(p.team, o.x, o.y, 3);
    // In our box it's tight: half a body goal-side, shoulder to shoulder.
    const off = box ? 0.8 : near ? 1.3 : 2.6, side = box ? 0.45 : near ? 0.8 : 1.5;
    let tx = o.x + g.x * off + bd.x * side + o.vx * 0.3, ty = o.y + g.y * off + bd.y * side + o.vy * 0.3;
    if (m.state === 'restart') { // keep the 9.15m at a free kick
      const b = m.ball, dx = tx - b.x, dy = ty - b.y, dd = Math.hypot(dx, dy);
      if (dd < 9.3) { tx = b.x + (dx / (dd || 1)) * 9.3; ty = b.y + (dy / (dd || 1)) * 9.3; }
    }
    p.steer(tx, ty, U.dist(p.x, p.y, tx, ty) > 3 || Math.hypot(o.vx, o.vy) > 4.5, 0.8);
    p.face(owner.x, owner.y);
  };

  // Do this team's forwards drop back on defence ('help') or stay up for the counter ('high')?
  // Part of each team's tactics (yours are set on the squad screen).
  AI.fwdDefend = function (team) {
    return team.style.fwdDefend || (team.style.block === 'high' ? 'high' : 'help');
  };

  // How well a forward times his runs: reads the passer, holds the line, checks a run that's
  // too early. 0..1.
  AI.runIQ = function (p) {
    const st = p.stats;
    return U.clamp((st.positioning * 0.45 + st.composure * 0.3 + st.vision * 0.25 - 45) / 45, 0, 1);
  };

  // How much a team in possession squeezes up: ball in their half and their block deep.
  AI.squeeze = function (m, team, ballD) {
    const o = m.ball.owner;
    if (!o || o.team !== team) return 0;
    const line = AI.trueOffsideLine(m, team);
    return U.clamp((ballD - 0.45) / 0.15, 0, 1) * U.clamp((line - 0.6) / 0.14, 0, 1);
  };
  // Where each role stands in the squeezed 2-3-5 (depths in our attacking frame).
  // up = only ever pushes the player further forward than his normal spot.
  AI.squeezeSlot = function (team, s, line) {
    const side = s.l < 0.45 ? -1 : s.l > 0.55 ? 1 : 0, r = s.role;
    const roles = new Set(team.players.map((p) => p.slot.role));
    const hasFB = roles.has('LB') || roles.has('RB');
    const back = Math.min(0.7, line - 0.31);
    if (r === 'CB') return { d: back, l: 0.5 + side * 0.2, up: true };
    if (r === 'LB' || r === 'RB' || (!hasFB && (r === 'LM' || r === 'RM'))) return { d: line - 0.05, l: 0.5 + side * 0.45 };
    if (r === 'DM') return { d: back + 0.1, l: 0.5 + side * 0.12, up: true };
    if (r === 'CM') return { d: line - 0.13, l: 0.5 + side * 0.18 };
    if (r === 'LW' || r === 'RW' || r === 'LM' || r === 'RM') return { d: line - 0.02, l: 0.5 + side * 0.22 };
    if (r === 'AM') return { d: line - 0.08, l: 0.5 };
    if (r === 'ST') return { d: line - 0.01, l: 0.5 + side * 0.09 };
    return { d: back, l: s.l, up: true };
  };

  // The link man: one central midfielder (the No. 10 if there is one) who shows for the ball
  // in the pocket between their midfield and back lines while we build through midfield.
  // Sticky, so it doesn't flick between players.
  AI.linkPlayer = function (m, team) {
    if (team._linkT === m.time) return team._link;
    team._linkT = m.time;
    const o = m.ball.owner, ballD = team.depth(m.ball.x);
    if (!o || o.team !== team || m.state !== 'play' || ballD < 0.22 || ballD > 0.75) return (team._link = null);
    const ok = (q) => q !== o && !q.isDown() && !q.sentOff && (q.slot.role === 'AM' || q.slot.role === 'CM') && !(q === m.controlled && !q.userAuto);
    if (team._link && ok(team._link)) return team._link;
    let best = null, bs = 1e9;
    for (const q of team.outfield()) {
      if (!ok(q)) continue;
      const sc = (q.slot.role === 'AM' ? 0 : 5) + U.dist(q.x, q.y, o.x, o.y) * 0.15 + Math.abs(q.y - C.H / 2) * 0.1;
      if (sc < bs) { bs = sc; best = q; }
    }
    return (team._link = best);
  };

  // Depth (our frame) of the pocket between their midfield line and their back line.
  AI.pocketDepth = function (m, team, ballD, lineD) {
    const ds = m.other(team).outfield().filter((q) => !q.sentOff).map((q) => team.depth(q.x)).sort((a, c) => c - a);
    const avg = (a) => a.reduce((x, v) => x + v, 0) / a.length;
    const back = ds.length >= 4 ? avg(ds.slice(0, 4)) : lineD, mid = ds.length >= 6 ? avg(ds.slice(4, 8)) : ballD + 0.15;
    return Math.min(lineD - 0.03, Math.max(ballD + 8 / C.W, (back + mid) / 2));
  };

  // A striker coming short: with the ball in midfield he sometimes drops off the line towards
  // it for a couple of seconds to link play (one striker at a time). True while he's showing.
  AI.showShort = function (m, team, p, ballD) {
    if (p.slot.role !== 'ST' || m.state !== 'play') return false;
    const o = m.ball.owner;
    if (!o || o.team !== team || o === p || ballD < 0.28 || ballD > 0.7) { p.showUntil = 0; return false; }
    if (m.time < (p.showUntil || 0)) return true;
    if (m.time < p.runUntil || m.time < (p.showUntil || 0) + 2.5) return false;
    if (team.players.some((q) => q !== p && m.time < (q.showUntil || 0))) return false;
    if (Math.random() < C.DT * 0.4) { p.showUntil = m.time + U.rand(1.4, 2.3); return true; }
    return false;
  };

  // Positional target for an off-ball player.
  AI.shapeTarget = function (m, team, p, phase, lineD) {
    const b = m.ball, s = p.slot, r = m.restart;
    const ballD = team.depth(b.x), bl = b.y / C.H;
    let d, l, sprint = false, hurry = false;

    if (m.state === 'restart' && r.kind === 'penalty') {
      const atk = r.team, d = 1 - (C.BOX_D + 1.5 + (p.idx % 3) * 1.6) / C.W;
      return { ...atk.toWorld(d, U.clamp(0.22 + ((p.idx * 7 + (team === atk ? 0 : 3)) % 11) * 0.056, 0.2, 0.8)), sprint: false };
    } else if (m.state === 'restart' && r.kind === 'kickoff') {
      if (p === r.partner) return { x: p.x, y: p.y, sprint: false };
      d = Math.min(s.d * 0.72, 0.45); l = s.l;
    } else if (m.state === 'restart' && r.kind === 'corner') {
      return AI.cornerTarget(m, team, p);
    } else if (phase === 'attack') {
      // The whole team moves with the ball: the back line squeezes up to ~20m behind it so
      // the centre-backs stay in the passing game, and the full-backs push on, highest on the
      // ball's side (overlaps / underlaps once we're in their half).
      const back = U.clamp(ballD - AI.TUNE.backGap, 0.07, AI.TUNE.backMax);
      d = back + (s.d - 0.17) * 0.92;
      l = 0.5 + (s.l - 0.5) * 1.1 + (bl - 0.5) * 0.22;
      if (AI.TUNE.fbPush && (s.role === 'LB' || s.role === 'RB')) {
        const ballSide = Math.abs(bl - s.l) < 0.4;
        d += 0.04 + (ballSide && ballD > 0.45 ? 0.08 : 0);
      }
      // Sustained attack against a deep block: squeeze up into a 2-3-5. The back line pushes
      // to ~35m behind their last line (rest defence: centre-backs + holding midfielder),
      // full-backs give the width on the touchlines, wingers and No. 8s take the half-spaces,
      // and five occupy their back line. The deeper they sit, the further we squeeze.
      const sq = AI.squeeze(m, team, ballD);
      if (sq > 0 && m.state === 'play') {
        const T = AI.squeezeSlot(team, s, AI.trueOffsideLine(m, team));
        d += (Math.max(d, T.d) - d) * sq * (T.up ? 1 : 0) + (T.d - d) * sq * (T.up ? 0 : 1);
        l += (T.l + (bl - 0.5) * 0.12 - l) * sq;
        if (sq > 0.4 && (d - team.depth(p.x)) * C.W > 6) hurry = true; // get up there with the play
      }
      const o0 = b.owner;
      // Building through the middle: the link man shows between their lines, and the striker
      // now and then comes short to the ball (see AI.linkPlayer / showShort).
      const showing = AI.TUNE.link && AI.showShort(m, team, p, ballD);
      if ((AI.TUNE.link && p === AI.linkPlayer(m, team) && m.time >= p.runUntil) || showing) {
        const pd = AI.pocketDepth(m, team, ballD, lineD);
        d = showing ? Math.min(lineD - 0.02, Math.max(pd, ballD + 13 / C.W)) : pd;
        l = 0.5 + (bl - 0.5) * (showing ? 0.4 : 0.3);
        if ((d - team.depth(p.x)) * C.W > 5 || Math.abs(team.toWorld(d, l).y - p.y) > 8) hurry = true;
      }
      const carrierLooking = o0 && o0.team === team && o0.fx * team.dir > 0.4 && m.pressureOn(o0) < 0.5;
      if (ATTACKERS.has(s.role) && m.state === 'play') {
        // Runs in behind. The cue is a carrier who can play it: facing forward with time,
        // in control, within range, or (for the user) winding up a pass. Good runners wait for
        // that cue, bend along the line to stay onside, and check a run if the moment goes.
        // Poor ones go whenever, straight through, and get caught offside.
        const iq = AI.runIQ(p);
        const mine = o0 && o0.team === team && o0 !== p;
        const winding = mine && m.controlled === o0 && m.charging && m.chargeKind !== 'shot';
        const ready = mine && (winding || (carrierLooking && m.time >= (o0.settleUntil || 0))) && U.dist(o0.x, o0.y, p.x, p.y) < 40;
        if (m.time > p.runUntil + 1.2 && !showing) {
          const rate = ready ? (winding ? 2.5 : 0.5) + 1.5 * iq : 0.15 + 0.6 * (1 - iq);
          if (Math.random() < C.DT * rate) {
            p.runUntil = m.time + U.rand(1.2, 2.0); p.runStart = m.time;
            p.runBend = (Math.random() < 0.5 ? -1 : 1) * (0.06 + 0.06 * iq);
          }
        }
        if (m.time < p.runUntil) {
          const lk = b.lastKick, since = m.time - p.runStart;
          const passGone = !b.owner && lk && lk.team === team && lk.type === 'pass' && m.time - lk.t < 1.5;
          const onside = team.depth(p.x) < lineD - 0.004;
          // First stretch runs across the line, onside; a good runner keeps bending along it
          // for as long as you're winding up the pass, then bursts as it's played.
          const hold = !passGone && (winding && iq > 0.5 ? true : since < 0.15 + 0.4 * iq);
          if (!passGone && !ready && onside && iq > 0.4 && since > 0.2 && Math.random() < C.DT * 6 * iq) p.runUntil = m.time; // check it
          else if (hold) {
            d = lineD - 0.008; l += p.runBend || 0; sprint = true;
            if (winding) p.runUntil = Math.max(p.runUntil, m.time + 0.8);
          } else { d = Math.max(d, lineD + 0.06); l += (p.runBend || 0) * 0.5; sprint = true; }
        }
      }
      if (!sprint) {
        // Stranded offside: good forwards hurry back onside, poor ones amble.
        if (ATTACKERS.has(s.role) && team.depth(p.x) > lineD && AI.runIQ(p) > 0.5) sprint = true;
        d = Math.min(d, lineD - 0.01);
      }
      if (!sprint && o0 && o0.team === team && o0 !== p && m.state === 'play' && s.role !== 'CB') {
        // Get open: nudge towards the nearby spot furthest from defenders with a clear lane.
        if (!p.openUntil || m.time > p.openUntil) {
          const base = team.toWorld(d, l);
          let bestS = -1e9, best = null;
          for (const [dx, dy] of [[0, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3], [4, 0]]) {
            const cx = base.x + dx * team.dir, cy = U.clamp(base.y + dy, 2, C.H - 2);
            let open = 8, lane = 8;
            for (const q of m.other(team).players) {
              open = Math.min(open, U.dist(q.x, q.y, cx, cy));
              const sp = U.segPoint(q.x, q.y, o0.x, o0.y, cx, cy);
              if (sp.t > 0.1 && sp.t < 0.95) lane = Math.min(lane, sp.d);
            }
            const sc = open + lane * 0.6 - Math.hypot(dx, dy) * 0.15;
            if (sc > bestS) { bestS = sc; best = { dx, dy }; }
          }
          p.openOff = best; p.openUntil = m.time + 0.5;
        }
        if (p.openOff) { d += (p.openOff.dx / C.W); l += p.openOff.dy / C.H; }
      }
    } else {
      const B = AI.BLOCKS[team.block || 'mid'], comp = team.compact ?? 0.5;
      let line = B.line + (ballD - 0.5) * (team.block === 'low' ? 0.06 : 0.18); // breathe with the ball (a low block barely)
      const sinceLost = team.lostAt != null ? m.time - team.lostAt : 99;
      if (sinceLost < 4 && !(team.block === 'high' && sinceLost < 2.5)) line -= 0.1 * (1 - sinceLost / 4); // retreat after losing it
      line = Math.min(line, ballD - 0.07);                      // stay goal-side of it
      line = Math.min(line, AI.runnerDepth(m, team) - 0.01);     // drop off with runners
      line = Math.max(line, 0.055);
      let tier = TIER[s.role] ?? 0.5;
      const wide = s.role === 'LW' || s.role === 'RW';
      if (AI.fwdDefend(team) === 'help') {
        // Forwards drop back: wingers fill in beside midfield, the striker screens the holding midfielder.
        // The deeper the ball, the deeper they come: wingers end up tracking the full-backs.
        const deep = U.clamp((0.5 - ballD) / 0.3, 0, 1);
        if (wide) tier = (team.block === 'low' ? 0.45 : 0.52) - 0.3 * deep;
        else if (s.role === 'ST') tier = 0.8 - 0.2 * deep;
        else if (s.role === 'AM') tier = 0.6 - 0.2 * deep;
      } else if (wide || s.role === 'ST') tier += 0.35; // stay up, ready for the counter
      d = line + tier * B.len * (1.2 - 0.4 * comp);
      l = 0.5 + (s.l - 0.5) * B.width * (1.18 - 0.36 * comp) + (bl - 0.5) * B.shift;
    }
    d = U.clamp(d, 0.04, 0.94);
    l = U.clamp(l, 0.03, 0.97);
    const t = team.toWorld(d, l);
    t.sprint = sprint || hurry;

    // Don't crowd our own ball carrier.
    const o = b.owner;
    if (phase === 'attack' && o && o.team === team && o !== p && m.state === 'play') {
      const dx = t.x - o.x, dy = t.y - o.y, dd = Math.hypot(dx, dy);
      if (dd < 7) { const n = dd > 0.1 ? { x: dx / dd, y: dy / dd } : { x: -team.dir, y: 0 }; t.x = o.x + n.x * 7; t.y = U.clamp(o.y + n.y * 7, 1, C.H - 1); }
    }

    // Our throw: the two nearest come short to offer, one down the line, one infield.
    if (m.state === 'restart' && r.kind === 'throw' && r.team === team && p !== r.taker && !p.isGK) {
      const near = team.outfield().filter((q) => q !== r.taker)
        .sort((a, c) => U.dist(a.x, a.y, b.x, b.y) - U.dist(c.x, c.y, b.x, b.y)).slice(0, 2);
      const k = near.indexOf(p);
      if (k >= 0) {
        const side = b.y < C.H / 2 ? 1 : -1, wob = Math.sin(m.time * 1.3 + p.idx) * 1.5;
        const off = k === 0 ? { x: team.dir * (7 + wob), y: 4 } : { x: -team.dir * 3, y: 10 + wob };
        return { x: U.clamp(b.x + off.x, 2, C.W - 2), y: U.clamp(b.y + side * off.y, 2, C.H - 2), sprint: true };
      }
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

  // Marking: tighten onto the nearest attacker in your zone, goal-side of him, by how good a
  // marker you are.
  AI.mark = function (m, team, p, tg) {
    let o = null, bd = 8;
    for (const q of m.other(team).players) {
      if (q.isGK || q.hasBall) continue;
      const d = U.dist(q.x, q.y, tg.x, tg.y);
      if (d < bd) { bd = d; o = q; }
    }
    if (!o) return;
    const n = U.norm(team.ownX - o.x, C.H / 2 - o.y);
    const gx = o.x + n.x * 1.6, gy = o.y + n.y * 1.6, w = (p.stats.marking / 100) * 0.35;
    tg.x += (gx - tg.x) * w; tg.y += (gy - tg.y) * w;
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
    const cd = team.depth(owner.x);
    const danger = cd < 0.35; // near our goal: get tight, fast, straight at him
    if (danger) { hurry = true; dist = Math.min(dist, 0.7); }
    const settling = m.time < (owner.settleUntil || 0);
    // Middle third, carrier in control and facing up: jockey him (stay a couple of metres off,
    // goal-side, show him away) rather than diving in. A press trigger, a loose first touch or
    // a high-press side's counter-press still get the full treatment.
    // A high press (or a very aggressive side) never jockeys: it closes at a sprint and goes in.
    const ag = AI.aggr(team);
    const counter = team.block === 'high' && team.lostAt != null && m.time - team.lostAt < 2.5;
    const jockey = AI.TUNE.jockey && team.block !== 'high' && ag < 0.7 && !danger && !settling && !counter && cd < 0.75 && !AI.pressTrigger(m, owner);
    if (jockey) { dist = Math.max(dist, 2.1); hurry = false; }
    else if (ag >= 0.6 && U.dist(p.x, p.y, owner.x, owner.y) > 2.5) hurry = true;
    const opt = AI.bestOutlet(m, owner);
    if (opt && !danger) {
      const to = U.norm(opt.x - owner.x, opt.y - owner.y);
      dir = U.norm(dir.x * 0.6 + to.x * 0.4, dir.y * 0.6 + to.y * 0.4);
    }
    const tx = owner.x + dir.x * dist + owner.vx * 0.25;
    const ty = owner.y + dir.y * dist + owner.vy * 0.25;
    const d = U.dist(p.x, p.y, owner.x, owner.y);
    p.steer(tx, ty, d > 13 || hurry, 2.5); // close down at a jog unless far away
    if (d < (team.isUser ? (AI.TUNE.mates && (p !== m.controlled || m.autoplay) ? 2.0 : 2.4) : settling ? 2.2 : 1.6) && p.tackleCd <= 0 && (settling || m.time > m.ball.protectUntil)) {
      p.tackleCd = settling ? U.rand(0.4, 0.7) : jockey ? U.rand(1.6, 2.6) : U.rand(1.0, 1.8) * (1.3 - 0.5 * ag);
      if (Math.random() < (settling ? 0.85 : jockey ? 0.15 + 0.3 * ag : 0.35 + 0.4 * ag) * (p.yellow ? 0.7 : 1)) m.startLunge(p, owner, settling ? 0.18 : 0.24);
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
      const delay = r.kind === 'gk' ? 1.4 : r.kind === 'kickoff' ? 0.8 : r.kind === 'throw' ? 1.6 : r.kind === 'penalty' ? 2.2 : r.direct ? 2.4 : 1.1;
      // A throw waits (up to a few seconds) for someone to come free.
      if (r.kind === 'throw' && r.t >= delay && r.t < 4 && !AI.throwIn(m, p, true)) return;
      if (r.t >= delay) AI.restartKick(m, p, r);
      return;
    }
    p.think -= dt;
    // Until he's had time to get the ball under control and look up, he just shields it and
    // drifts forward; no instant passes off a tackle or first touch.
    if (!p.plan && p.think > 0) p.plan = { kind: 'dribble', x: p.x + p.team.dir * 3, y: p.y, sprint: false, settle: true };
    // A presser arriving: don't finish the look-up, decide now (CPU sides; yours already do).
    if (!p.team.isUser && AI.TUNE.playOut && p.think > 0.1 && m.time >= (p.settleUntil || 0)) {
      const n = AI.nearestOpp(m, p);
      if (n.o) {
        const to = U.norm(p.x - n.o.x, p.y - n.o.y), closing = n.o.vx * to.x + n.o.vy * to.y;
        if (n.d < 2.4 || (n.d < 6 && closing > 1 && n.d / closing < 0.8)) p.think = Math.min(p.think, U.rand(0.03, 0.1));
      }
    }
    if (p.think <= 0) {
      const dGoal = U.dist(p.x, p.y, p.team.attackX, C.H / 2);
      p.think = p.team.isUser ? U.rand(0.22, 0.4) : dGoal < 22 && AI.TUNE.sharp ? U.rand(0.15, 0.3) : U.rand(0.35, 0.6);
      const plan = AI.decide(m, p);
      if (plan.kind === 'shoot') { m.shoot(p, plan.aim, plan.power); p.plan = null; return; }
      if (plan.kind === 'pass') { m.passTo(p, plan.target, plan.lofted); p.plan = null; return; }
      if (plan.kind === 'behind') { m.kickTo(p, plan.x, plan.y, plan.lofted, 'pass', plan.target); p.plan = null; return; }
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
      const noise = 0.18 * (1.5 - p.stats.vision / 100);
      let s = gain * 5 + U.clamp(lane / 2.5, -1, 1) * 0.8 + free * 0.5 - d / 50 - 0.4 - back - square + U.rand(-noise, noise);
      if (d > 18 + p.stats.vision * 0.3) s -= 0.6; // beyond what he sees
      if (lane < 0) s -= 2;
      out.push({ kind: 'pass', target: q, lofted: false, score: s, lane });
      if (d > 14) {
        let sl = gain * 5 + U.clamp(landM / 3, -1, 1) * 0.9 - 0.6 - d / 70 - back + U.rand(-noise, noise);
        if (landM < 0) sl -= 2;
        out.push({ kind: 'pass', target: q, lofted: true, score: sl, lane: landM });
      }
    }
    if (!team.isUser && AI.TUNE.playOut && !p.isGK) out.push(...AI.behindOptions(m, p, trueLine));
    return out.sort((a, b) => b.score - a.score);
  };

  // Balls in behind (CPU sides): into the space beyond their last line for a forward who's
  // onside and will clearly get there first, keeper included. What beats a high line and a
  // man-marking press, where every ball to feet is covered.
  AI.behindOptions = function (m, p, trueLine) {
    const team = p.team, opp = m.other(team), myD = team.depth(p.x), out = [];
    if (trueLine > 0.9) return out;
    for (const q of team.outfield()) {
      if (q === p || q.isDown() || !['ST', 'LW', 'RW', 'AM', 'LM', 'RM'].includes(q.role)) continue;
      const qd = team.depth(q.x);
      if (qd > trueLine + 0.004 || qd < myD - 0.05) continue; // offside, or behind the ball
      const depth = Math.min(Math.max(trueLine + 0.07, qd + 0.05), 0.9);
      const t = team.toWorld(depth, U.clamp((q.y + (C.H / 2 - q.y) * 0.25) / C.H, 0.1, 0.9));
      const D = U.dist(p.x, p.y, t.x, t.y);
      if (D < 12 || D > 50) continue;
      const lofted = D > 22;
      const Tb = lofted ? PP.Ball.loftTime(D) : PP.Ball.groundTime(D, PP.Match.arrivalSpeed(D));
      const tq = U.dist(q.x, q.y, t.x, t.y) / q.topSpeed(true) + 0.15;
      // Defenders facing the ball have to turn and run back towards their own goal first.
      let margin = 1e9;
      for (const o of opp.players) {
        if (o.isDown()) continue;
        const turn = !o.isGK && team.depth(o.x) < depth ? 0.4 : 0;
        margin = Math.min(margin, U.dist(o.x, o.y, t.x, t.y) / (o.topSpeed(true) * (o.isGK ? 0.9 : 1)) + 0.3 + turn - Math.max(tq, Tb));
      }
      if (margin < 0.05) continue;
      const vis = p.stats.vision / 100;
      const s = (depth - myD) * 4 + Math.min(margin, 1.5) * 0.9 - 0.9 + (vis - 0.7) + U.rand(-0.2, 0.2);
      out.push({ kind: 'behind', target: q, x: t.x, y: t.y, lofted, score: s, lane: margin });
    }
    return out;
  };

  AI.decide = function (m, p) {
    const team = p.team, opp = m.other(team);
    const gx = team.attackX, gy = C.H / 2;
    const dG = U.dist(p.x, p.y, gx, gy);
    const myD = team.depth(p.x);
    const near = AI.nearestOpp(m, p);
    if (p.isGK) {
      // Swept up outside his box with someone closing: no messing about, put it away.
      if (!AI.inBox(team, p.x, p.y, 0) && near.d < 9) { const t = team.toWorld(0.62, U.clamp(p.y / C.H, 0.15, 0.85)); return { kind: 'clear', x: t.x, y: t.y }; }
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
      if (!team.isUser) want *= !AI.TUNE.sharp ? 0.8 : ['ST', 'LW', 'RW', 'AM'].includes(p.role) ? 1.05 : 0.85;
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

    // Under pressure (CPU sides): a safe ball, even square or back, beats running into him;
    // with nothing short on in our half, go long over the press.
    const oneTouch = p.oneTouch != null && m.time - p.oneTouch < 0.3;
    if (!team.isUser && AI.TUNE.playOut && (pressure < 3.2 || oneTouch) && (myD < 0.75 || oneTouch)) {
      const safe = opts.find((o) => !o.lofted && o.lane > 0.4 && o.score > -1.5);
      if (oneTouch && safe) return safe;
      if (safe && (pressure < 2.3 || !best || safe === best)) return safe;
      if (myD < 0.55 && pressure < 2.3) {
        const long = opts.find((o) => o.lofted && o.lane > 0.3 && o.score > -2);
        if (long) return long;
        if (myD < 0.35) {
          const fw = team.outfield().filter((q) => q !== p).sort((a, c) => team.depth(c.x) - team.depth(a.x))[0];
          const t = team.toWorld(0.68, fw ? U.clamp(fw.y / C.H, 0.12, 0.88) : 0.2);
          return { kind: 'clear', x: t.x, y: t.y };
        }
      }
    }

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
    // Tight and no pass on: turn his back on the presser and shield it, then look again.
    if (!team.isUser && AI.TUNE.playOut && near.o && pressure < 2.2 && myD < 0.75) {
      const n = U.norm(p.x - near.o.x, p.y - near.o.y);
      return { kind: 'dribble', x: U.clamp(p.x + n.x * 4, 1, C.W - 1), y: U.clamp(p.y + n.y * 4, 2, C.H - 2), sprint: false };
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
    if (r.kind === 'throw') { AI.throwIn(m, p); return; }
    if (r.kind === 'freekick' && r.direct && Math.random() < 0.65) { // have a go: far side of the wall
      const far = (Math.sign(C.H / 2 - m.ball.y) || 1) * U.rand(0.45, 0.95);
      m.fkShot(p, far, U.rand(0.5, 0.85));
      return;
    }
    if (r.kind === 'penalty') { // pick a side (or, now and then, down the middle) and hit it
      const aimY = Math.random() < 0.15 ? U.rand(-0.15, 0.15) : (Math.random() < 0.5 ? -1 : 1) * U.rand(0.45, 0.95);
      m.shoot(p, aimY, U.rand(0.5, 0.85));
      return;
    }
    let opts = AI.passOptions(m, p, 50);
    if (r.kind === 'gk') {
      const roll = opts.find((o) => !o.lofted && o.lane > 1 && U.dist(p.x, p.y, o.target.x, o.target.y) < 28);
      if (roll && Math.random() < 0.7) { m.passTo(p, roll.target, false); return; } // roll it out
    }
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

  // A real throw-in: to an open team-mate's feet with a clear lane, otherwise down the line
  // into space ahead. Never just lobbed at whoever is nearest.
  // (check = true: only report whether someone is free.)
  AI.throwIn = function (m, p, check = false) {
    const team = p.team, opp = m.other(team), b = m.ball;
    let best = null, bs = -1e9, bp = null;
    for (const q of team.players) {
      if (q === p || q.isGK || q.isDown()) continue;
      // Throw to his feet (or a step ahead of him): who gets there first?
      for (const lead of [0, 2.5]) {
        const P = { x: q.x + team.dir * lead, y: U.clamp(q.y, 3.5, C.H - 3.5) };
        const d = U.dist(b.x, b.y, P.x, P.y);
        if (d < 4 || d > 22) continue;
        const T = 0.3 + d / 24, mine = U.dist(q.x, q.y, P.x, P.y) / q.topSpeed(true) + 0.15;
        let theirs = 9;
        for (const o of opp.players) theirs = Math.min(theirs, Math.max(0, U.dist(o.x, o.y, P.x, P.y) - 1) / (o.topSpeed(true) * 0.9));
        const margin = theirs - Math.max(T, mine);
        if (margin < 0.25) continue;
        const s = Math.min(margin, 1.5) * 2 + (team.depth(P.x) - team.depth(b.x)) * 6 - d * 0.04 - lead * 0.1 + U.rand(-0.3, 0.3);
        if (s > bs) { bs = s; best = q; bp = P; }
      }
    }
    if (check) return !!best;
    let tx, ty;
    if (best) { tx = bp.x; ty = bp.y; }
    else { tx = b.x - team.dir * U.rand(6, 10); ty = b.y < C.H / 2 ? U.rand(6, 9) : C.H - U.rand(6, 9); } // nobody free: back and infield
    m.throwBall(p, U.clamp(tx, 2, C.W - 2), ty, best);
  };

  // ---------- goalkeeper ----------

  // How much of a sweeper-keeper he is, 0..1: a keeper who reads the game, behind a high line.
  AI.sweeper = (team, gk) => U.clamp((gk.stats.gkPositioning - 55) / 35, 0, 1) * 0.5 + ({ high: 0.5, mid: 0.25 }[team.block] || 0);

  AI.keeper = function (m, gk, dt) {
    const team = gk.team, b = m.ball, gx = team.ownX, gy = C.H / 2;
    if (b.owner === gk) { AI.carrier(m, gk, dt); return; }
    if (gk.isDown()) return;
    if (m.state === 'restart' && m.restart.kind === 'penalty' && m.restart.team !== team) { // on his line
      gk.steer(gx + team.dir * 0.3, gy, false, 0.5); gk.face(b.x, b.y);
      return;
    }

    // Shot or ball heading at goal: get across, dive if needed.
    const fromOpp = b.lastKick && b.lastKick.team !== team;
    if (!b.owner && m.state === 'play' && fromOpp) {
      const sp = Math.hypot(b.vx, b.vy);
      if ((gx - b.x) * b.vx > 0 && sp > 7) {
        const tl = (gx - b.x) / b.vx;
        const yl = b.y + b.vy * tl;
        const zl = b.z + b.vz * tl - 0.5 * C.G * tl * tl;   // height as it reaches the line
        const onTarget = Math.abs(yl - gy) < C.GOAL_W / 2 + 0.6 && zl < C.GOAL_H + 0.4;
        // A ground ball that will stop short (a through ball, not a shot) isn't one to dive at.
        const reaches = b.z > 0.3 || b.vz > 1 || PP.Ball.rollDist(sp) > Math.abs(gx - b.x) - 1;
        if (tl > 0 && tl < 2.5 && onTarget && reaches) {
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

    // Sweeper-keeper: a loose ball in behind our last defender, within his range, that he'll
    // reach clearly before anyone else: come off the line for it (outside the box he kicks it).
    const sw = AI.sweeper(team, gk);
    if (!b.owner && m.state === 'play' && sw > 0 && !m.drill && !AI.inBox(team, b.x, b.y, 1)) {
      const it = AI.interceptTime(m, gk);
      const deepest = Math.min(...team.outfield().filter((q) => !q.sentOff && !q.isDown()).map((q) => team.depth(q.x)));
      if (team.depth(it.x) * C.W < 14 + 24 * sw && team.depth(it.x) < deepest) {
        let oppT = 1e9, ourT = 1e9;
        for (const o of m.other(team).players) if (!o.sentOff) oppT = Math.min(oppT, AI.interceptTime(m, o).t);
        for (const q of team.outfield()) if (!q.sentOff) ourT = Math.min(ourT, AI.interceptTime(m, q).t);
        if (it.t < oppT - (0.55 - 0.3 * sw) && ourT > it.t - 0.4) { gk.steer(it.x, it.y, true, 0.3); return; }
      }
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
    let r = U.clamp(1 + db * 0.06, 1, 4.5);
    // A sweeper-keeper with the ball far away plays well off his line, part-way to the back line.
    const swD = AI.sweeper(team, gk);
    if (swD > 0 && !(b.owner && b.owner.team !== team && team.depth(b.x) < 0.5)) {
      const back = Math.min(...team.outfield().filter((q) => !q.sentOff).map((q) => team.depth(q.x))) * C.W;
      r = Math.max(r, U.clamp((back - 4) * 0.45 * swD, 0, 6 + 12 * swD) * U.clamp((db - 30) / 25, 0, 1));
    }
    gk.steer(gx + n.x * r, gy + n.y * r * 0.9, false, 0.8);
    if (Math.hypot(gk.vx, gk.vy) < 0.5) gk.face(b.x, b.y);
  };
})();
