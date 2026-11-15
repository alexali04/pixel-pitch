(function () {
  const C = PP.C, U = PP.U, Ball = PP.Ball;

  class Match {
    // home = the user's team (attacks right-to-left), away = CPU.
    constructor(homeDef, awayDef, opts = {}) {
      this.home = new PP.Team(homeDef, -1, true, this);
      this.away = new PP.Team(awayDef, 1, false, this);
      this.teams = [this.home, this.away];
      this.players = [...this.home.players, ...this.away.players];
      this.ball = new Ball();
      this.score = [0, 0];
      this.clock = 0;                  // game seconds
      this.half = 1;
      this.time = 0;                   // real sim seconds
      this.halfLen = opts.halfSeconds || C.HALF_SECONDS;
      this.state = 'restart';
      this.restart = null;
      this.stateT = 0;
      this.controlled = null;
      this.charge = 0;
      this.charging = false;
      this.chargeKind = null;   // 'shot' | 'pass' | 'lob'
      this.popups = [];         // floating text over players
      this.switchT = 0;
      this.manualUntil = 0;
      this.banner = null;
      this.events = [];
      this.stats = { shots: [0, 0], onTarget: [0, 0], poss: [0, 0] };
      this.firstKickoff = Math.random() < 0.5 ? 0 : 1;
      this.ballPath = null;
      // Full court = continuous 11v11 with defending. Off = you only play your attacking
      // phases; the CPU's attacks are resolved offscreen from team ratings.
      this.fullCourt = !!opts.fullCourt;
      this.sound = !!opts.sound;        // only the live match makes noise, not headless sims
      this.ratings = [PP.teamRatings(this.home.def), PP.teamRatings(this.away.def)];
      this.phase = null;
      this.phaseInHalf = 0;
      if (this.fullCourt) this.kickoff(this.teams[this.firstKickoff]);
      else this.startPhase();
    }

    other(t) { return t === this.home ? this.away : this.home; }
    idx(t) { return t === this.home ? 0 : 1; }
    say(text, t = 1.4) { this.banner = { text, t }; }
    sfx(name, arg) { if (this.sound && !this.autoplay && PP.Sound) PP.Sound.play(name, arg); }
    pop(p, text, color = '#ffffff') { this.popups.push({ x: p.x, y: p.y, text, color, t: 0.9 }); }
    get minute() { return Math.floor(this.clock / 60); }

    nearestUser(x, y, exclude = null) {
      let best = null, bd = 1e9;
      for (const p of this.home.players) {
        if (p.isGK || p === exclude) continue;
        const d = U.dist(p.x, p.y, x, y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    // How badly placed a user defender is to engage the ball at (bx, by): distance to a point
    // just goal-side of the ball, plus a big penalty for being behind the ball.
    defendCost(p, bx, by) {
      const t = this.home;
      const n = U.norm(t.ownX - bx, C.H / 2 - by);
      let cost = U.dist(p.x, p.y, bx + n.x * 1.5, by + n.y * 1.5);
      const behind = (t.depth(p.x) - t.depth(bx)) * C.W; // metres past the ball towards their goal
      if (behind > -0.5) cost += 6 + Math.max(0, behind) * 0.8;
      if (p.isDown()) cost += 20;
      cost += { CB: -3, DM: -1.5, LB: 0, RB: 0 }[p.role] ?? 1;   // prefer the middle of the defence
      return cost;
    }

    bestDefender(bx, by, exclude = null) {
      let best = null, bc = 1e9;
      for (const p of this.home.players) {
        if (p.isGK || p === exclude) continue;
        const c = this.defendCost(p, bx, by);
        if (c < bc) { bc = c; best = p; }
      }
      return best;
    }

    pressureOn(p) {
      let d = 1e9;
      for (const o of this.other(p.team).players) d = Math.min(d, U.dist(p.x, p.y, o.x, o.y));
      return U.clamp((3 - d) / 2.5, 0, 1);
    }

    // ---------- restarts ----------

    kickoff(team) {
      this.ball.reset(C.W / 2, C.H / 2);
      for (const t of this.teams) {
        for (const p of t.players) {
          const pos = t.toWorld(Math.min(p.slot.d * 0.6, 0.46), p.slot.l);
          p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
          p.fx = t.dir; p.fy = 0;
          p.stun = p.slide = p.dive = 0;
          p.receiving = null; p.frozen = false; p.plan = null;
        }
      }
      const fwd = team.outfield().slice().sort((a, b) => b.slot.d - a.slot.d);
      const taker = fwd[0], mate = fwd[1];
      mate.x = C.W / 2 - team.dir * 0.8; mate.y = C.H / 2 + 2.5; // partner beside the ball
      mate.face(C.W / 2, C.H / 2);
      // Kicking-off team's taker stands at the ball; the other team stays outside the circle.
      const opp = this.other(team);
      for (const p of opp.players) {
        const dx = p.x - C.W / 2, dy = p.y - C.H / 2, d = Math.hypot(dx, dy);
        if (d < C.CIRCLE_R + 0.5) {
          const n = d > 0.1 ? { x: dx / d, y: dy / d } : { x: -opp.dir, y: 0 };
          p.x = C.W / 2 + n.x * (C.CIRCLE_R + 0.5); p.y = C.H / 2 + n.y * (C.CIRCLE_R + 0.5);
        }
      }
      this.setRestart('kickoff', team, taker, C.W / 2, C.H / 2);
      this.restart.partner = mate;
    }

    setRestart(kind, team, taker, bx, by) {
      const b = this.ball;
      b.owner = null;
      b.x = bx; b.y = by; b.z = 0; b.vx = b.vy = b.vz = 0; b.px = bx; b.py = by;
      for (const p of this.players) { p.receiving = null; p.frozen = false; p.slide = 0; p.dive = 0; p.lunge = 0; p.lungeTarget = null; }
      let f;
      if (kind === 'throw') f = { x: 0, y: by < C.H / 2 ? 1 : -1 };
      else if (kind === 'corner') f = U.norm(team.attackX - team.dir * C.SPOT - bx, C.H / 2 - by);
      else f = { x: team.dir, y: 0 };
      taker.fx = f.x; taker.fy = f.y;
      if (kind !== 'gk') { taker.x = bx - f.x * 0.6; taker.y = by - f.y * 0.6; }
      taker.vx = taker.vy = 0; taker.stun = 0; taker.frozen = kind !== 'gk'; // keeper may walk his box
      b.owner = taker; b.lastTouch = taker;
      this.state = 'restart';
      this.restart = { kind, team, taker, t: 0 };
      this.charging = false; this.charge = 0;
      if (team.isUser) this.controlled = taker;
      else if (kind === 'goalkick' || kind === 'gk') {
        const mids = this.home.players.filter((q) => ['DM', 'CM'].includes(q.role));
        this.controlled = mids.sort((a, c) => U.dist(a.x, a.y, bx, by) - U.dist(c.x, c.y, bx, by))[0] || this.bestDefender(bx, by);
      } else this.controlled = this.bestDefender(bx, by);
      // teleports: don't interpolate across them
      for (const q of this.players) { q.ox = q.x; q.oy = q.y; }
      b.ox = b.x; b.oy = b.y; b.oz = b.z;
      if (kind !== 'gk') this.sfx('whistle', 1);
      const names = { throw: 'Throw-in', corner: 'Corner', goalkick: 'Goal kick', freekick: 'Free kick' };
      if (names[kind]) this.say(names[kind], 1.1);
    }

    gkHold(gk) {
      this.gainPossession(gk);
      gk.dive = 0; gk.stun = 0;
      if (this.state === 'between') return;
      if (!this.fullCourt && this.phase && !gk.team.isUser) { this.endPhase('saved', gk.x); return; }
      this.setRestart('gk', gk.team, gk, gk.x + gk.fx * 0.35, gk.y + gk.fy * 0.35);
    }

    endRestart() {
      if (this.state === 'restart') {
        this.restart.taker.frozen = false;
        this.restart = null;
        this.state = 'play';
      }
    }

    // ---------- ball actions ----------

    release(p, type, target) {
      const b = this.ball;
      b.owner = null;
      b.lastTouch = p;
      b.curve = this.pendingCurve || 0; this.pendingCurve = 0;
      b.lastKick = { type, by: p, team: p.team, target, t: this.time,
        back: !!target && p.team.depth(target.x) < p.team.depth(p.x) - 0.03 };
      if (type === 'pass' && this.state === 'play') {
        // Offside: in their half, ahead of the ball and of the second-last defender.
        const t = p.team, line = PP.AI.trueOffsideLine(this, t), bd = t.depth(b.x);
        const off = new Set();
        for (const q of t.players) {
          if (q === p || q.isGK) continue;
          const d = t.depth(q.x);
          if (d > 0.5 && d > bd && d > line + 0.004) off.add(q);
        }
        if (off.size) b.lastKick.offside = off;
      }
      p.kickCd = 0.35;
      p.kickAnim = 0.18;
      const sp = Math.hypot(b.vx, b.vy);
      if (type === 'touch') { /* dribble touch: silent */ }
      else if (type === 'shot') this.sfx('shot', U.clamp((sp - 14) / 19, 0, 1));
      else if (b.vz > 0.5) this.sfx('chip', U.clamp(sp / 20, 0, 1));
      else this.sfx('pass', U.clamp((sp - 6) / 15, 0, 1));
      this.endRestart();
      for (const q of this.players) q.receiving = null;
      if (target) target.receiving = { t: this.time };
      if (type === 'pass' && target) {
        const sp = Math.max(6, Math.hypot(b.vx, b.vy)), t = U.dist(b.x, b.y, target.x, target.y) / sp;
        b.lastKick.rx = target.x + target.vx * t; b.lastKick.ry = target.y + target.vy * t;
        if (!p.team.isUser && !this.autoplay) {
          const c = this.bestDefender(b.lastKick.rx, b.lastKick.ry);
          if (c) { if (this.controlled) this.controlled.userAuto = false; this.controlled = c; this.lastAutoSwitch = this.time; }
        }
      }
    }

    // Kick the ball towards a world point. Error grows with distance (stats refine this in stage 3).
    // v0 (ground passes only) = exact kick speed chosen by the user; otherwise the speed is
    // picked so the ball arrives at a sensible pace.
    kickTo(p, tx, ty, lofted, type, target, power = null, v0 = null) {
      const b = this.ball;
      const D0 = Math.max(1, U.dist(b.x, b.y, tx, ty));
      const skill = (lofted ? p.stats.longPass : p.stats.shortPass) / 100;
      const angErr = (0.015 + D0 * 0.0012) * (1.6 - skill) * (1 + this.pressureOn(p) * 0.6) * (p.team.isUser ? 1 : Match.CPU_ERR);
      const dir = U.rot((tx - b.x) / D0, (ty - b.y) / D0, U.gauss() * angErr);
      const D = D0 * (1 + U.gauss() * 0.05 * (1.6 - skill));
      let T0;
      if (lofted) {
        const T = Ball.loftTime(D) * (power == null ? 1 : 1.3 - power * 0.55); T0 = T;
        const Dl = D * 0.8; // land short; the first bounce carries it on
        const s = (Dl * C.AIR_K) / (1 - Math.exp(-C.AIR_K * T));
        b.vx = dir.x * s; b.vy = dir.y * s; b.vz = (C.G * T) / 2;
      } else {
        const s = v0 != null ? v0 * (1 + U.gauss() * 0.03 * (1.6 - skill)) : Ball.groundSpeedFor(D, Match.arrivalSpeed(D));
        b.vx = dir.x * s; b.vy = dir.y * s; b.vz = 0;
        T0 = D / Math.max(4, s * 0.7);
      }
      if (type === 'pass' || type === 'clear') {
        // Curl from the dominant foot; aim off by the expected bend so it still arrives.
        const cv = Match.curveFor(p, b.vx, b.vy, lofted);
        const bend = 0.5 * Math.abs(cv) * (lofted ? 1 : 0.5) * T0 * T0;
        const off = Math.sign(cv) * Math.atan2(bend, D);
        const r = U.rot(b.vx, b.vy, off); // curve to the left -> start it to the right (screen y is down)
        b.vx = r.x; b.vy = r.y;
        this.pendingCurve = cv;
      }
      b.z = Math.max(b.z, 0.01 * (lofted ? 1 : 0));
      this.release(p, type, target);
    }

    // Where a pass to q should be aimed, leading their run.
    leadPoint(p, q, lofted, power = null, v0 = null) {
      let tx = q.x, ty = q.y;
      for (let i = 0; i < 2; i++) {
        const D = U.dist(p.x, p.y, tx, ty);
        const t = lofted ? Ball.loftTime(D) * (power == null ? 1 : 1.3 - power * 0.55)
          : v0 != null ? (Ball.rollTime(v0, D) ?? Ball.groundRun(v0, 0).t)
          : Ball.groundTime(D, Match.arrivalSpeed(D));
        tx = q.x + q.vx * t * 0.8; ty = q.y + q.vy * t * 0.8;
      }
      return { x: U.clamp(tx, 0.5, C.W - 0.5), y: U.clamp(ty, 0.5, C.H - 0.5) };
    }

    passTo(p, q, lofted, power = null) {
      const t = this.leadPoint(p, q, lofted, power);
      this.kickTo(p, t.x, t.y, lofted, 'pass', q, power);
    }

    // What a user pass along unit direction (nx, ny) would do: launch velocity, predicted
    // path, where it ends up, and which teammate gets there first (they run onto it).
    passPlan(p, nx, ny, lofted, power, vOverride = null) {
      const b = this.ball;
      let vx, vy, vz;
      if (!lofted) {
        let v0 = vOverride ?? Match.userGroundSpeed(power);
        if (p.isGK) v0 = Math.max(v0, 13);              // keepers play it firmer
        vx = nx * v0; vy = ny * v0; vz = v0 > 18 ? (v0 - 18) * 0.35 : 0; // driven passes skim up
      } else {
        // A chip always rises in a clear arc; holding longer sends it further and higher.
        const D = p.isGK ? 20 + power * 35 : 7 + power * 38, T = 0.75 + D / 20;
        const s = (D * 0.8 * C.AIR_K) / (1 - Math.exp(-C.AIR_K * T));
        vx = nx * s; vy = ny * s; vz = (C.G * T) / 2;
      }
      const curve = Match.curveFor(p, vx, vy, lofted);
      const sim = { x: b.x, y: b.y, z: lofted || vz > 0 ? 0.01 : 0, vx, vy, vz, curve };
      const path = [];
      let land = null;
      for (let i = 0; i < 45; i++) {
        Ball.integrate(sim, 0.1);
        path.push({ x: sim.x, y: sim.y, z: sim.z });
        if (lofted && !land && sim.z === 0) land = { x: sim.x, y: sim.y };
        if (sim.z === 0 && Math.hypot(sim.vx, sim.vy) < 0.3) break;
      }
      const end = lofted && land ? land : path[path.length - 1];
      let target = null, bt = 1e9;
      for (const q of p.team.players) {
        if (q === p || q.isDown()) continue;
        const sp = q.topSpeed(true);
        for (let i = 0; i < path.length; i++) {
          const pt = path[i];
          if (pt.z > 1.8) continue;
          const tt = (i + 1) * 0.1;
          if (Math.max(0, U.dist(q.x, q.y, pt.x, pt.y) - 0.6) / sp + 0.2 <= tt) {
            if (tt < bt) { bt = tt; target = q; }
            break;
          }
        }
      }
      if (!target) target = this.nearestUser(end.x, end.y, p);
      // Back-pass to our keeper: make sure it actually gets to him.
      if (target && target.isGK && !lofted && vOverride == null) {
        const vreq = Ball.groundSpeedFor(U.dist(b.x, b.y, target.x, target.y), 5);
        if (Math.hypot(vx, vy) < vreq) return this.passPlan(p, nx, ny, false, power, vreq);
      }
      let offside = false;
      if (target) {
        const t = p.team, d = t.depth(target.x);
        offside = d > 0.5 && d > t.depth(b.x) && d > PP.AI.trueOffsideLine(this, t) + 0.004;
      }
      return { vx, vy, vz, curve, lofted, x: end.x, y: end.y, target, offside, path: lofted && land ? path.slice(0, path.findIndex((q) => q.x === land.x && q.y === land.y) + 1) : path };
    }

    // aimY in [-1, 1] picks the vertical spot in the goal mouth; power in [0, 1].
    shoot(p, aimY, power) {
      const b = this.ball, team = p.team;
      const gx = team.attackX;
      const ty = C.H / 2 + U.clamp(aimY, -1, 1) * 3.2;
      const D = U.dist(b.x, b.y, gx, ty);
      const pressure = this.pressureOn(p);
      const fin = p.stats.finishing / 100, pow = p.stats.shotPower / 100;
      power = U.clamp(power, 0.15, 1);
      const speed = 19 + 9 * power + 6 * pow * power;   // tap ~20 m/s, full wind-up ~32 m/s
      const angErr = (0.035 + D * 0.002 + power * power * 0.06 + pressure * 0.07) * (1.6 - fin) * (team.isUser ? 1 : Match.CPU_ERR);
      const dir = U.rot((gx - b.x) / D, (ty - b.y) / D, U.gauss() * angErr);
      const t = D / speed;
      const h = Math.max(0.1, 0.35 + power * 1.25 + U.gauss() * (0.35 + power * 0.8 + pressure * 0.5) * (1.5 - fin));
      b.vx = dir.x * speed; b.vy = dir.y * speed;
      b.vz = h / t + (C.G * t) / 2;
      b.z = 0.05;
      this.stats.shots[this.idx(team)]++;
      this.release(p, 'shot', null);
    }

    // Standing tackles have a short visible wind-up before they resolve.
    startLunge(t, c, time, speed = 6.5) {
      t.lunge = time; t.lungeTarget = c; t.lungeSpeed = speed;
      t.face(c.x, c.y);
    }

    updateLunges(dt) {
      for (const p of this.players) {
        if (p.lunge <= 0) continue;
        p.lunge -= dt;
        if (p.lunge > 0) continue;
        p.lunge = 0;
        const c = p.lungeTarget; p.lungeTarget = null;
        if (this.state !== 'play' || this.ball.owner !== c) continue;
        if (U.dist(p.x, p.y, c.x, c.y) > (p.team.isUser ? 2.3 : 1.9)) { p.stun = 0.3; this.pop(p, 'MISS', '#cfd8d6'); continue; }
        this.resolveTackle(p, c, false);
      }
    }

    // Your defenders take the ball off a CPU attacker who runs into them.
    bodyChecks() {
      const b = this.ball, c = b.owner;
      if (!c || c.team.isUser || this.state !== 'play' || c.isGK) return;
      const sp = Math.hypot(c.vx, c.vy);
      for (const d of this.home.outfield()) {
        if (d.isDown() || d.lunge > 0 || (d.autoTackleAt || 0) > this.time) continue;
        const dist = U.dist(d.x, d.y, c.x, c.y);
        if (dist > 2.0) continue;
        const to = U.norm(d.x - c.x, d.y - c.y);
        const into = sp < 0.6 ? 1 : (c.vx * to.x + c.vy * to.y) / sp; // is he running at the defender?
        if (into < -0.35) continue; // running at you or alongside you (not clean away)
        d.autoTackleAt = this.time + 0.8;
        d.face(c.x, c.y); d.kickAnim = 0.2;
        this.resolveTackle(d, c, false, true);
        return;
      }
    }

    resolveTackle(t, c, slide, auto = false) {
      const b = this.ball;
      if (b.owner !== c || this.state !== 'play') return;
      const toT = U.norm(t.x - c.x, t.y - c.y);
      const front = c.fx * toT.x + c.fy * toT.y; // 1 = tackler head-on, -1 = from behind
      const hold = (c.stats.dribbling + c.stats.strength) / 2;
      let ch = (slide ? 0.62 : t.team.isUser ? 0.78 : 0.42) + Math.max(0, front) * 0.12 + (t.stats.tackling - hold) * 0.007;
      if (front < -0.3) ch *= t.team.isUser ? 0.85 : 0.5; // carrier is shielding it
      if (this.time < b.protectUntil) ch *= 0.25;  // just received it
      ch = U.clamp(ch, 0.06, 0.85);
      if (auto) ch = U.clamp(0.82 + (t.stats.tackling - hold) * 0.006, 0.5, 0.94) * (this.time < b.protectUntil ? 0.6 : 1) * (front < -0.3 ? 0.8 : 1);
      const userLost = c.team.isUser, userWon = t.team.isUser;
      if (Math.random() < ch) {
        c.stun = auto ? 0.75 : 0.5; c.kickCd = 0.5; // auto = he ran into you and goes down
        this.sfx('tackle');
        if (auto) { this.pop(c, 'TACKLED!', '#ffd23f'); this.gainPossession(t); return; }
        this.pop(c, 'TACKLED!', userLost ? '#e4572e' : '#ffd23f');
        if (!slide && Math.random() < 0.55) { this.gainPossession(t); return; }
        b.owner = null;
        const d = U.rot(t.fx, t.fy, U.rand(-0.9, 0.9));
        const s = U.rand(4, 8);
        b.vx = d.x * s; b.vy = d.y * s; b.vz = 0;
        b.lastTouch = t;
        b.lastKick = { type: 'tackle', by: t, team: t.team, t: this.time };
        t.kickCd = slide ? 0 : 0.15;
      } else {
        if (!slide) t.stun = 0.4;
        c.protectFlash = this.time;
        this.sfx('bump');
        const strong = c.stats.strength > t.stats.strength + 6 && front < 0.2;
        if (!auto || strong) this.pop(c, strong ? 'HELD OFF' : 'MISSED', userWon ? '#e4572e' : '#a8e6a1');
      }
    }

    // A player flagged offside at the moment of the pass plays the ball: free kick.
    checkOffside(p) {
      const lk = this.ball.lastKick;
      if (!lk || !lk.offside || this.state !== 'play') return false;
      if (!lk.offside.has(p)) { lk.offside = null; return false; } // someone else played it
      const def = this.other(p.team);
      let taker = null, bd = 1e9;
      for (const q of def.outfield()) { const d = U.dist(q.x, q.y, p.x, p.y); if (d < bd) { bd = d; taker = q; } }
      this.restartOrEnd('freekick', def, taker, U.clamp(p.x, 1, C.W - 1), U.clamp(p.y, 1, C.H - 1));
      this.say('Offside!', 1.4);
      return true;
    }

    gainPossession(p) {
      const b = this.ball;
      if (this.checkOffside(p)) return;
      // Bringing a ball under control takes a moment: longer for fast or dropping balls and for
      // poorer first touches. Until then you can't play it (a pass/shot waits).
      const inSpd = Math.hypot(b.vx, b.vy), inZ = b.z;
      const settle = U.clamp((0.06 + Math.max(0, inSpd - 8) * 0.025 + (inZ > 0.4 ? 0.25 + inZ * 0.2 : 0)) * (1.5 - p.stats.firstTouch / 100), 0, 0.9);
      p.settleUntil = this.time + settle; p.settleLen = settle;
      b.owner = p; b.lastTouch = p;
      b.vx = b.vy = b.vz = 0; b.z = 0; b.curve = 0;
      b.protectUntil = this.time + 0.7;
      p.think = Math.max(U.rand(0.3, 0.6), p.settleLen + 0.1); p.plan = null; p.gotBallAt = this.time;
      for (const q of this.players) q.receiving = null;
      if (p.team.isUser) {
        this.controlled = p;
        this.heldOnGain = ['pass', 'lob', 'shoot'].filter((k) => PP.Input.down(k)); // must be released first
      } else {
        // Keep the defender you already have if he's nearly as well placed (no flip on reception).
        const best = this.bestDefender(p.x, p.y), c = this.controlled;
        if (!c || c.isGK || !c.team.isUser || this.defendCost(c, p.x, p.y) - this.defendCost(best, p.x, p.y) > 3) {
          this.controlled = best; this.lastAutoSwitch = this.time;
        }
      }
      if (!this.fullCourt && this.phase && this.state !== 'goal') {
        if (p.team.isUser) {
          if (this.phase.lostAt != null) { this.phase.lostAt = null; this.phase.start = this.time; } // won it back
        } else if (this.phase.lostAt == null) { this.phase.lostAt = this.time; this.say('Defend!', 1.0); }
      }
    }

    // ---------- user input ----------

    switchPlayer() {
      const b = this.ball;
      const c = this.bestDefender(b.x, b.y, this.controlled);
      if (c) { if (this.controlled) this.controlled.userAuto = false; this.controlled = c; }
      this.manualUntil = this.time + 0.5;
    }

    // Space decides for you: aiming at the goal mouth from shooting range means a shot.
    shotAim(p, aim) {
      const t = p.team, b = this.ball, gx = t.attackX;
      if ((gx - b.x) * aim.x <= 0.05) return null;
      if (U.dist(b.x, b.y, gx, C.H / 2) > 32) return null;
      const gy = b.y + (aim.y / aim.x) * (gx - b.x);
      if (Math.abs(gy - C.H / 2) > C.GOAL_W / 2 + 2.2) return null;
      return { gx, gy: U.clamp(gy, C.GOAL_Y1 + 0.3, C.GOAL_Y2 - 0.3), aimY: U.clamp((gy - C.H / 2) / 3.2, -1, 1) };
    }

    // Gentle pass assist on top of your aim: lean towards a team-mate's run if one is close to
    // the line, otherwise lean a little towards goal in the final third, and never play it
    // straight out of play.
    assistAim(p, aim, lofted, power) {
      const team = p.team, b = this.ball, base = Math.atan2(aim.y, aim.x);
      const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      let ang = base;
      // 1. a team-mate's lead point within ~14 degrees: bend 70% of the way onto it
      let best = null, bd = 0.25;
      for (const q of team.players) {
        if (q === p || q.isDown() || q.isGK) continue;
        const lx = q.x + q.vx * 0.8 + team.dir * (Math.hypot(q.vx, q.vy) > 3 ? 2 : 0), ly = q.y + q.vy * 0.8;
        const d = U.dist(b.x, b.y, lx, ly);
        if (d < 4 || d > 45) continue;
        const da = Math.abs(wrap(Math.atan2(ly - b.y, lx - b.x) - base));
        if (da < bd) { bd = da; best = wrap(Math.atan2(ly - b.y, lx - b.x) - base); }
      }
      if (best != null) ang = base + best * 0.7;
      else if (team.depth(b.x) > 0.6) {
        // 2. final third: lean up to ~8 degrees towards the middle of their goal
        const g = wrap(Math.atan2(C.H / 2 - b.y, team.attackX - b.x) - base);
        if (Math.abs(g) < 1.4) ang = base + U.clamp(g, -0.14, 0.14);
      }
      // 3. don't put it out of play: turn it back infield (up to ~35 degrees)
      for (let i = 0; i < 18; i++) {
        const pl = this.passPlan(p, Math.cos(ang), Math.sin(ang), lofted, power);
        const inY = pl.y > 0.8 && pl.y < C.H - 0.8, inX = pl.x > 0.5 && pl.x < C.W - 0.5;
        if (inY && inX) break;
        // turn towards the box if we're in their half (a cross / cut-back), else back infield
        const tx = team.depth(b.x) > 0.55 ? team.attackX - team.dir * C.SPOT : (team.attackX + C.W / 2) / 2;
        const toward = wrap(Math.atan2(C.H / 2 - b.y, tx - b.x) - ang);
        ang += Math.sign(toward) * 0.05;
        if (Math.abs(wrap(ang - base)) > 0.9) break;
      }
      return { x: Math.cos(ang), y: Math.sin(ang) };
    }

    userPass(p, plan) {
      const b = this.ball;
      const skill = (plan.lofted ? p.stats.longPass : p.stats.shortPass) / 100;
      const D = U.dist(b.x, b.y, plan.x, plan.y);
      let angErr = (0.012 + D * 0.001) * (1.6 - skill) * (1 + this.pressureOn(p) * 0.6);
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1.5) { // passing across your run at speed is harder
        const pn = Math.hypot(plan.vx, plan.vy) || 1;
        const off = Math.acos(U.clamp((p.vx * plan.vx + p.vy * plan.vy) / (sp * pn), -1, 1));
        angErr *= 1 + (sp / p.topSpeed(true)) * (off / Math.PI) * 0.8;
      }
      const v = U.rot(plan.vx, plan.vy, U.gauss() * angErr);
      const k = 1 + U.gauss() * 0.03 * (1.6 - skill);
      b.vx = v.x * k; b.vy = v.y * k; b.vz = plan.vz * k;
      b.z = plan.lofted || plan.vz > 0 ? 0.01 : 0;
      this.pendingCurve = plan.curve || 0;
      this.latch = true; this.latchAxis = null;
      this.release(p, 'pass', plan.target);
      if (plan.target) { this.controlled = plan.target; plan.target.receiving = { t: this.time }; }
    }

    tryTackle(p) {
      if (p.tackleCd > 0 || p.isDown()) return;
      p.tackleCd = 0.5;
      const c = this.ball.owner;
      if (!c || c.team === p.team || this.state !== 'play') return;
      const d = U.dist(p.x, p.y, c.x, c.y);
      if (d > 4.2) return;
      // Snap: lunge fast enough to arrive at the carrier's feet.
      this.startLunge(p, c, 0.12 + d * 0.03, Math.max(7, (d - 0.6) / (0.12 + d * 0.03)));
    }

    trySlide(p) {
      if (p.isDown() || this.state !== 'play') return;
      // Slides home in on the ball if it's roughly in front and within reach.
      const b = this.ball;
      const tx = b.x + b.vx * 0.25, ty = b.y + b.vy * 0.25;
      const n = U.norm(tx - p.x, ty - p.y);
      if (U.dist(p.x, p.y, tx, ty) < 5 && n.x * p.fx + n.y * p.fy > 0.2) { p.fx = n.x; p.fy = n.y; }
      p.slide = 0.5; p.slideHit = false;
      p.vx = p.fx * 8.5; p.vy = p.fy * 8.5;
      this.sfx('slide');
    }

    handleUser(dt, I) {
      const p = this.controlled;
      if (!p || this.state === 'goal' || this.autoplay) return;
      const ax = I.axis();
      const active = !!(ax.x || ax.y);
      const b = this.ball;
      const theirBall = (b.owner && !b.owner.team.isUser) || (!b.owner && b.lastKick && !b.lastKick.team.isUser);
      const sprint = I.down('sprint') || (theirBall && b.owner !== p && this.home.depth(b.x) < 0.38); // danger: run
      const lkt = b.lastKick;
      const ownTouch = !b.owner && lkt && lkt.type === 'touch' && lkt.by === p && this.time - lkt.t < 0.8;
      const hasBall = b.owner === p;

      // After a pass the held direction belongs to the passer: ignore it for the receiver
      // until the stick is released (or a moment passes).
      const la = this.latchAxis;
      if (this.latch && (!active || (la && (ax.x !== la.x || ax.y !== la.y)))) this.latch = false;
      const steering = active && !this.latch;
      const recv = !!(p.receiving && !b.owner);
      p.userAuto = recv && !steering;
      let blended = false;
      if (steering && recv && !p.isDown() && p.lunge <= 0) {
        // Negotiate: keep running onto the pass, nudged by the stick. Only a firm opposite
        // input cancels the run.
        const it = PP.AI.interceptTime(this, p), n = U.norm(ax.x, ax.y);
        const to = U.norm(it.x - p.x, it.y - p.y);
        if (n.x * to.x + n.y * to.y < -0.5) p.receiving = null;
        else { const d = U.norm(to.x + n.x * 0.6, to.y + n.y * 0.6); p.move(d.x, d.y, true); blended = true; }
      }

      if (!blended && !p.userAuto && !p.isDown() && p.lunge <= 0) {
        if (this.latch && !p.frozen) p.stop();
        else if (p.frozen) {
          if (active) { const n = U.norm(ax.x, ax.y); p.fx = n.x; p.fy = n.y; }
          p.stop();
        } else if (hasBall && this.charging && this.runDir) {
          p.move(this.runDir.x, this.runDir.y, sprint); // keep the run going; the keys aim the pass
        } else if (!(hasBall && this.charging)) p.move(ax.x, ax.y, sprint);
        else p.stop();                                  // charging from a standstill: plant and aim
      }

      if (hasBall) {
        // Hold a button to charge strength, release to play it. Tap = soft.
        const restart = this.state === 'restart';
        if (!this.charging) {
          const setPiece = restart && this.restart && this.restart.kind !== 'phase';
          const bp = this.bufferedPress && this.time - this.bufferedPress.t < 0.6 && I.down(this.bufferedPress.kind) ? this.bufferedPress.kind : null;
          this.bufferedPress = null;
          if (this.heldOnGain) this.heldOnGain = this.heldOnGain.filter((k) => I.down(k));
          const fresh = (k) => I.hit(k) && !(this.heldOnGain || []).includes(k);
          const hitKind = fresh('pass') ? 'pass' : fresh('lob') ? 'lob' : fresh('shoot') ? 'shoot' : bp;
          const kind = hitKind === 'shoot' ? (setPiece ? 'lob' : 'smart') : hitKind;
          if (kind) {
            this.charging = true; this.chargeKind = kind; this.charge = 0; this.releaseQueued = false;
            this.prevKeys = (ax.x ? 1 : 0) + (ax.y ? 1 : 0); this.aimHold = 0;
            const sp = Math.hypot(p.vx, p.vy);
            this.runDir = sp > 1.5 ? { x: p.vx / sp, y: p.vy / sp } : null;
            this.chargeBtn = hitKind === 'shoot' ? 'shoot' : kind;
            // Aim starts where you're pointing (or facing) ...
            this.aim = active ? U.norm(ax.x, ax.y) : { x: p.fx, y: p.fy };
          }
        }
        this.preview = null;
        if (this.charging) {
          const shotNow = this.chargeKind === 'shot' || (this.chargeKind === 'smart' && this.preview && this.preview.shot);
          const fill = shotNow ? 0.9 : 0.38;
          if (I.down(this.chargeBtn) && !this.releaseQueued) this.charge = Math.min(1, this.charge + dt / fill);
          // ... and turns smoothly towards the held direction, so any angle is reachable.
          const nKeys = (ax.x ? 1 : 0) + (ax.y ? 1 : 0);
          if (nKeys < (this.prevKeys || 0)) this.aimHold = this.time + 0.2; // a key was just let go
          this.prevKeys = nKeys;
          if (active && this.time > (this.aimHold || 0)) {
            const want = Math.atan2(ax.y, ax.x), cur = Math.atan2(this.aim.y, this.aim.x);
            let da = want - cur;
            while (da > Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            this.aimHeld = this.aimDir === Math.sign(da) ? (this.aimHeld || 0) + dt : 0;
            this.aimDir = Math.sign(da);
            const rate = Math.min(Match.AIM_TURN_MAX, Match.AIM_TURN + this.aimHeld * 9);
            const ease = Math.min(1, Math.abs(da) / 0.35); // glide into the target angle
            let a = cur + Math.sign(da) * Math.min(Math.abs(da), rate * dt * Math.max(0.35, ease));
            // At a sprint you can't play it back over your shoulder: aim stays within ~100° of the run.
            if (this.runDir && Math.hypot(p.vx, p.vy) > p.topSpeed(false) * 1.05) {
              const run = Math.atan2(this.runDir.y, this.runDir.x);
              let off = a - run;
              while (off > Math.PI) off -= 2 * Math.PI;
              while (off < -Math.PI) off += 2 * Math.PI;
              a = run + U.clamp(off, -1.75, 1.75);
            }
            this.aim = { x: Math.cos(a), y: Math.sin(a) };
          }
          const shot = this.chargeKind === 'smart' ? this.shotAim(p, this.aim) : null;
          if (shot) this.preview = { shot: true, x: shot.gx, y: shot.gy, aimY: shot.aimY };
          else if (this.chargeKind !== 'shot') {
            const lob = this.chargeKind === 'lob';
            const a = this.assistAim(p, this.aim, lob, this.charge);
            this.preview = this.passPlan(p, a.x, a.y, lob, this.charge);
          }
          if (I.released(this.chargeBtn) || !I.down(this.chargeBtn)) this.releaseQueued = true;
          if (this.releaseQueued && this.time >= (p.settleUntil || 0)) {
            this.releaseQueued = false;
            const k = this.chargeKind === 'smart' ? (this.preview && this.preview.shot ? 'shot' : 'pass') : this.chargeKind;
            const pw = this.charge;
            this.charging = false; this.charge = 0; this.chargeKind = null;
            if (k === 'shot') this.shoot(p, this.preview && this.preview.shot ? this.preview.aimY : ax.y, pw);
            else {
              const a = this.assistAim(p, this.aim, k === 'lob', pw);
              this.userPass(p, this.passPlan(p, a.x, a.y, k === 'lob', pw));
              this.latchAxis = { x: ax.x, y: ax.y };
            }
            this.preview = null;
            return;
          }
        }
        if (restart && !this.charging && this.restart && this.restart.t > (this.restart.kind === 'gk' ? 10 : 7)) PP.AI.restartKick(this, p, this.restart);
      } else if (ownTouch) {
        // Ball just knocked ahead on the dribble: buffer a press until you're back on it.
        if (I.hit('pass') || I.hit('lob') || I.hit('shoot')) this.bufferedPress = { t: this.time, kind: I.hit('pass') ? 'pass' : I.hit('lob') ? 'lob' : 'shoot' };
      } else {
        this.charging = false; this.charge = 0; this.chargeKind = null; this.preview = null;
        // Without the ball: J = tackle (or header pass / go for a loose ball), K = slide,
        // Space = switch player (or a header at goal / clearance when the ball is in the air).
        const aerial = this.aerialFor(p);
        const ours = !b.owner && b.lastKick && b.lastKick.team === p.team;
        if (I.hit('pass')) {
          if (aerial && ours) this.queueHeader(p, 'pass', ax);
          else if (b.owner && b.owner.team !== p.team) this.tryTackle(p);
          else if (!b.owner) { p.receiving = { t: this.time }; this.pop(p, 'GO!', '#9fd3c7'); }
        } else if (I.hit('shoot')) {
          if (aerial) {
            const d = p.team.depth(b.x);
            this.queueHeader(p, d > 0.68 ? 'shoot' : d < 0.4 && !ours ? 'clear' : 'pass', ax);
          } else this.switchPlayer();
        } else if (I.hit('lob')) this.trySlide(p);
        // Auto-poke: get close enough and your defender has a go on their own.
        const c = b.owner;
        if (c && c.team !== p.team && this.state === 'play' && p.lunge <= 0 && !p.isDown() &&
            p.tackleCd <= 0 && this.time > b.protectUntil && U.dist(p.x, p.y, c.x, c.y) < 2.8) {
          this.tryTackle(p);
          p.tackleCd = 0.9;
        }
      }
    }

    // Is a loose ball going to be in heading range of p soon?
    aerialFor(p) {
      const b = this.ball, path = this.ballPath;
      if (b.owner || !path || (b.z < 0.6 && b.vz <= 1)) return false;
      const sp = p.topSpeed(true);
      for (let i = 0; i < 10; i++) {
        const q = path[i];
        if (q.z < 0.7 || q.z > 2.8) continue;
        if (U.dist(p.x, p.y, q.x, q.y) < 1.4 + (i + 1) * 0.1 * sp) return true;
      }
      return false;
    }

    // Headers are buffered: press a little early and it fires when the ball arrives.
    queueHeader(p, kind, ax) {
      this.headQ = { p, kind, t: this.time, aim: ax.x || ax.y ? U.norm(ax.x, ax.y) : { x: p.fx, y: p.fy }, aimY: ax.y };
      p.receiving = { t: this.time }; // run to meet it
    }

    tryHeader() {
      const q = this.headQ, b = this.ball;
      if (!q) return;
      if (b.owner || this.time - q.t > 0.8 || q.p !== this.controlled) { this.headQ = null; return; }
      const p = q.p;
      if (p.isDown() || U.dist(p.x, p.y, b.x, b.y) > 1.5 || b.z < 0.5 || b.z > 2.9) return;
      this.headQ = null;
      this.doHeader(p, q.kind, q.aim, q.aimY);
    }

    doHeader(p, kind, aim, aimY = 0) {
      if (this.checkOffside(p)) return;
      const b = this.ball, team = p.team, hs = p.stats.heading / 100;
      let vx, vy, vz;
      if (kind === 'shoot') {
        const gx = team.attackX, ty = C.H / 2 + U.clamp(aimY, -1, 1) * 3.0;
        const D = Math.max(1, U.dist(b.x, b.y, gx, ty));
        const d = U.rot((gx - b.x) / D, (ty - b.y) / D, U.gauss() * (0.06 + (1 - hs) * 0.12));
        const sp = 12 + hs * 8, t = D / sp;
        const h = U.clamp(0.6 + U.gauss() * (0.5 + (1 - hs)), 0, 3.2);
        vx = d.x * sp; vy = d.y * sp; vz = (h - b.z) / t + (C.G * t) / 2;
        this.stats.shots[this.idx(team)]++;
      } else if (kind === 'pass') {
        const sp = 9 + hs * 4;
        vx = aim.x * sp; vy = aim.y * sp; vz = 2.5;
      } else { // clear: up and away from our goal
        const d = U.norm(team.dir * 1.5, (b.y - C.H / 2) * 0.03 + aim.y * 0.6);
        const sp = 10 + hs * 4;
        vx = d.x * sp; vy = d.y * sp; vz = 4 + hs * 1.5;
      }
      b.vx = vx; b.vy = vy; b.vz = vz;
      this.release(p, kind === 'shoot' ? 'shot' : 'pass', null);
      p.kickAnim = 0; p.jump = 0.35;
      this.pop(p, 'HEADER', '#ffffff');
    }

    // When defending, hand control straight to the best-placed goal-side defender.
    autoSwitch() {
      const b = this.ball, c = this.controlled;
      const lk = b.lastKick;
      const defending = (b.owner && !b.owner.team.isUser) ||
        (!b.owner && lk && !lk.team.isUser && lk.type !== 'shot');
      if (!defending || this.autoplay || this.time < this.manualUntil || this.state !== 'play') return;
      if (c && (c.slide > 0 || c.lunge > 0)) return;
      if (c && c.receiving && !b.owner) return;                   // he's going for the ball
      if (this.time - (this.lastAutoSwitch || 0) < 0.25) return; // stop flicker between two equals
      let bx = b.x + b.vx * 0.25, by = b.y + b.vy * 0.25;
      if (!b.owner && lk && lk.type === 'pass' && lk.rx != null) { bx = lk.rx; by = lk.ry; } // judge against the receiving spot
      const best = this.bestDefender(bx, by);
      if (!best || best === c) return;
      const cc = c && !c.isGK ? this.defendCost(c, bx, by) : 1e9;
      const margin = !b.owner && lk && lk.rx != null ? 4 : 1.0; // a pass in flight: stick with the pick
      if (cc - this.defendCost(best, bx, by) > margin) {
        if (c) c.userAuto = false;
        this.controlled = best;
        this.lastAutoSwitch = this.time;
      }
    }

    // A loose ball that one of ours will clearly reach first: hand control to that player and
    // send them to collect it (the user can still steer to override).
    looseBallAssist() {
      const b = this.ball;
      if (b.owner || this.state !== 'play' || this.autoplay) return;
      this.ballPath = b.predict(30, 0.1);
      let best = null, bt = 1e9, ot = 1e9;
      for (const p of this.players) {
        if (p.isDown() || (p.isGK && p.team.isUser)) continue;
        const t = PP.AI.interceptTime(this, p).t;
        if (p.team.isUser) { if (t < bt) { bt = t; best = p; } }
        else ot = Math.min(ot, t);
      }
      if (!best || bt > 2.5 || bt > ot - 0.3) return; // contested or too far: leave it to the user
      const c = this.controlled;
      const ct = c && !c.isDown() ? PP.AI.interceptTime(this, c).t : 1e9;
      if (c !== best && (!(c && c.receiving) || ct > bt + 0.4)) { // the target's been beaten to it
        if (c) c.receiving = null;
        if (c) c.userAuto = false;
        this.controlled = best;
        this.lastAutoSwitch = this.time;
      }
      if (!best.receiving) best.receiving = { t: this.time };
    }

    // Carriers visibly hold off a close opponent who isn't tackling.
    updateShielding() {
      const o = this.ball.owner;
      for (const p of this.players) p.shielding = null;
      if (!o || this.state !== 'play') return;
      let best = null, bd = 1.5;
      for (const q of this.other(o.team).players) {
        const d = U.dist(o.x, o.y, q.x, q.y);
        if (d < bd && q.lunge <= 0 && !q.isDown()) { bd = d; best = q; }
      }
      o.shielding = best;
    }

    // ---------- simulation ----------

    step(dt, I) {
      this.time += dt;
      for (const p of this.players) { p.ox = p.x; p.oy = p.y; }
      const b0 = this.ball; b0.ox = b0.x; b0.oy = b0.y; b0.oz = b0.z;
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
      if (this.state === 'halftime' || this.state === 'fulltime') return;

      if (this.state === 'goal') {
        this.stateT -= dt;
        PP.AI.update(this, dt);
        for (const p of this.players) p.physics(dt);
        this.ball.step(dt);
        this.keepBallInNet();
        if (this.stateT <= 0) {
          if (this.fullCourt) this.kickoff(this.goalConceder);
          else this.endPhase('goal');
        }
        return;
      }

      if (this.state === 'between') {
        this.stateT -= dt;
        for (const p of this.players) { p.stop(); p.physics(dt); }
        if (this.stateT <= 0) {
          if (this.clock >= this.half * 45 * 60) { this.state = this.half === 1 ? 'halftime' : 'fulltime'; this.sfx('whistle', 3); }
          else this.startPhase();
        }
        return;
      }

      if (this.state === 'restart') {
        this.restart.t += dt;
        if (this.restart.kind === 'phase' && this.restart.t > 1.0) this.endRestart();
      }
      if (this.phase && this.state === 'play') {
        if (this.time - this.phase.start > 45 && this.phase.lostAt == null) { this.endPhase('timeout'); return; }
        // They've got it: the possession plays out live (you defend). If they keep it 15s
        // without a shot or it going out, the rest of their attack happens offscreen.
        const lk = this.ball.lastKick, ow = this.ball.owner;
        const theirs = ow ? !ow.team.isUser : !!(lk && !lk.team.isUser);
        if (this.phase.lostAt != null && theirs && this.time - this.phase.lostAt > 15) { this.endPhase('turnover', this.ball.x); return; }
      }
      if (this.controlled && this.controlled.isGK && this.ball.owner !== this.controlled) {
        this.controlled = this.nearestUser(this.ball.x, this.ball.y);
      }
      this.autoSwitch();
      this.looseBallAssist();
      this.handleUser(dt, I);
      PP.AI.update(this, dt);
      this.updateLunges(dt);
      this.bodyChecks();
      for (const p of this.players) p.physics(dt);
      this.separate();
      if (this.state === 'restart' && this.restart.kind === 'gk') {
        // Ball in hands: keep the keeper inside his area.
        const gk = this.restart.taker, t = gk.team, dEdge = C.BOX_D - 0.6;
        const d = t.dir === 1 ? gk.x : C.W - gk.x;
        if (d > dEdge) gk.x = t.dir === 1 ? dEdge : C.W - dEdge;
        gk.x = U.clamp(gk.x, 0.3, C.W - 0.3);
        gk.y = U.clamp(gk.y, C.H / 2 - C.BOX_W / 2 + 0.6, C.H / 2 + C.BOX_W / 2 - 0.6);
      }
      this.updateBall(dt);
      if (this.state === 'play') {
        this.slideContacts();
        this.tryHeader();
        this.contacts();
        this.bounds();
      }
      this.updateShielding();
      for (const pp of this.popups) { pp.t -= dt; pp.y -= dt * 1.2; }
      this.popups = this.popups.filter((pp) => pp.t > 0);
      this.tickClock(dt);
      if (this.ball.owner) this.stats.poss[this.idx(this.ball.owner.team)] += dt;
    }

    updateBall(dt) {
      const b = this.ball;
      const p = b.owner;
      if (p) {
        b.px = b.x; b.py = b.y;
        if (this.state === 'restart' && this.restart.kind === 'gk') {
          b.x = p.x + p.fx * 0.35; b.y = p.y + p.fy * 0.35; b.z = 1.0;
        } else {
          // Sprinting with it means bigger touches: the ball is knocked ahead and is loose
          // (and stealable) until you catch up with it.
          if (this.state === 'play' && !p.isGK && !(this.charging && p === this.controlled)) {
            const sp = Math.hypot(p.vx, p.vy);
            if (sp > p.topSpeed(false) * 1.05) {
              p.touchT = (p.touchT ?? 0.3) - dt;
              if (p.touchT <= 0) { p.touchT = 0.4 + p.stats.dribbling * 0.002; this.knockOn(p, sp); return; }
            } else p.touchT = 0.3;
          }
          let lead = 0.5 + Math.hypot(p.vx, p.vy) * 0.08; // further out in front the faster you go
          const unsettled = (p.settleUntil || 0) - this.time;
          if (unsettled > 0) { lead += unsettled * 1.2; b.z = Math.abs(Math.sin(unsettled * 14)) * Math.min(0.5, unsettled); } // still taming it
          const tx = p.x + p.fx * lead, ty = p.y + p.fy * lead;
          const k = this.state === 'restart' ? 1 : Math.min(1, dt * 18);
          b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
          if (!(unsettled > 0)) b.z = 0;
        }
        b.vx = p.vx; b.vy = p.vy; b.vz = 0;
      } else b.step(dt);
    }

    knockOn(p, sp) {
      const b = this.ball, extra = 2.8 - p.stats.dribbling * 0.016; // better dribblers keep it closer
      b.x = p.x + p.fx * 0.6; b.y = p.y + p.fy * 0.6;
      b.vx = p.fx * (sp + extra); b.vy = p.fy * (sp + extra); b.vz = 0;
      this.release(p, 'touch', p);
      p.kickCd = 0.2; p.kickAnim = 0.1;
    }

    separate() {
      const ps = this.players, R = 0.75;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], c = ps[j];
          const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy);
          if (d < R && d > 1e-4) {
            const push = (R - d) / 2, nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            c.x += nx * push; c.y += ny * push;
          }
        }
      }
    }

    slideContacts() {
      const b = this.ball;
      // Keeper smothering at a forward's feet.
      for (const t of this.teams) {
        const gk = t.gk;
        if (!(gk.dive > 0 && gk.smother && !gk.smotherHit)) continue;
        if (U.dist(gk.x, gk.y, b.x, b.y) > 1.4 || b.z > 0.8) continue;
        gk.smotherHit = true;
        const c = b.owner;
        const beat = c && c.team !== t ? (c.stats.dribbling - 70) * 0.01 : -0.3;
        if (Math.random() < U.clamp(0.6 + (gk.stats.gkPositioning - 70) * 0.01 - beat, 0.2, 0.9)) {
          if (c) c.stun = 0.4;
          this.sfx('save');
          this.pop(gk, 'SMOTHERED!', t.isUser ? '#ffd23f' : '#e4572e');
          gk.dive = 0; gk.smother = null;
          this.gkHold(gk);
          return;
        }
        if (c) this.pop(c, 'ROUNDED HIM!', c.team.isUser ? '#ffd23f' : '#e4572e');
      }
      for (const p of this.players) {
        if (p.slide <= 0 || p.slideHit) continue;
        if (U.dist(p.x + p.fx * 0.5, p.y + p.fy * 0.5, b.x, b.y) > 1.1 || b.z > 0.6) continue;
        p.slideHit = true;
        if (b.owner && b.owner.team !== p.team) this.resolveTackle(p, b.owner, true);
        else if (!b.owner) {
          const s = Math.max(6, Math.hypot(p.vx, p.vy));
          b.vx = p.fx * s; b.vy = p.fy * s; b.vz = 0;
          b.lastTouch = p;
          b.lastKick = { type: 'tackle', by: p, team: p.team, t: this.time };
        }
      }
    }

    contacts() {
      const b = this.ball;
      if (b.owner) return;
      for (const t of this.teams) if (this.keeperContact(t.gk)) return;

      const bspd = Math.hypot(b.vx, b.vy), lk1 = b.lastKick;
      let best = null, bd = 1e9;
      for (const p of this.players) {
        // Slow balls are easier to reach; a firm pass is only easy for the player it's meant for.
        // Team-mates of the passer are expecting it too; opponents have to read it.
        const reach = bspd < 4 ? 1.05 : (lk1 && lk1.team === p.team) || bspd < 12 ? 0.85 : 0.65;
        if (p.isDown() || p.kickCd > 0) continue;
        const lk0 = b.lastKick;
        if (p.isGK && PP.AI.inBox(p.team, p.x, p.y, 0.5) && !(lk0 && lk0.team === p.team)) continue;
        if (b.z > 1.9 || (b.z > 0.4 && b.vz > 0)) continue; // can't control a rising ball
        const d = U.dist(p.x, p.y, b.x, b.y);
        if (d < reach && d < bd) { bd = d; best = p; }
      }
      if (!best) return;
      const aiPlayer = this.autoplay || best !== this.controlled;
      if (b.z > 1.1 && aiPlayer) {
        const lk1 = b.lastKick, d = best.team.depth(b.x);
        if (d < 0.3 && lk1 && lk1.team !== best.team) { this.doHeader(best, 'clear', { x: best.team.dir, y: 0 }); return; }
        if (d > 0.84 && lk1 && lk1.team === best.team && Math.abs(b.y - C.H / 2) < 12) {
          this.doHeader(best, 'shoot', null, (Math.random() < 0.5 ? -1 : 1) * U.rand(0.4, 0.95)); return;
        }
      }
      const speed = Math.hypot(b.vx, b.vy) + Math.abs(b.vz) * 0.3;
      const touch = best.stats.firstTouch / 100;
      const lk = b.lastKick;
      const meant = lk && lk.target === best;            // the intended receiver is ready for it
      const thr = (meant ? 16 : 12) + touch * (meant ? 8 : 6);
      let ch = speed < thr ? 1 : U.clamp(1 - (speed - thr) / 20, 0.2, 1);
      if (b.z > 1.2) ch *= 0.93;
      if (Math.random() < ch) this.gainPossession(best);
      else {
        const d = U.rot(b.vx, b.vy, U.rand(-1.2, 1.2));
        b.vx = d.x * 0.45; b.vy = d.y * 0.45; b.vz = Math.abs(b.vz) * 0.3;
        b.lastTouch = best;
        best.kickCd = 0.4;
      }
    }

    keeperContact(gk) {
      const b = this.ball, team = gk.team;
      if (gk.kickCd > 0 || gk.stun > 0) return false;
      if (!PP.AI.inBox(team, b.x, b.y, 0.3)) return false;
      const reach = gk.dive > 0 ? 2.1 : 1.2;
      const d = U.dist(gk.x, gk.y, b.x, b.y);
      if (d > reach || b.z > 2.6) return false;
      const speed = Math.hypot(b.vx, b.vy);
      const lk = b.lastKick;
      if (lk && lk.team === team) return false; // back-pass: no hands, play it with the feet
      const threat = lk && lk.team !== team && speed > 10;
      if (!threat) { this.gkHold(gk); return true; }

      let save = 0.95 - Math.max(0, speed - 22) * 0.02 - (d / reach) * 0.25 + (gk.stats.reflexes - 70) * 0.006;
      if (b.z > 2.0) save -= 0.15;
      save = U.clamp(save, 0.2, 0.97);
      if (lk.type === 'shot' && !lk.counted) { lk.counted = true; this.stats.onTarget[this.idx(lk.team)]++; }
      if (Math.random() < save) {
        const catchP = U.clamp(1.25 - speed / 22 + (gk.stats.handling - 70) * 0.01 - (gk.dive > 0 ? 0.2 : 0), 0.1, 0.9);
        this.sfx('save');
        if (Math.random() < catchP) { this.gkHold(gk); this.say('Save!', 1); }
        else {
          b.vx = team.dir * U.rand(4, 9);
          b.vy = (Math.sign(b.y - C.H / 2) || 1) * U.rand(4, 10);
          b.vz = U.rand(1, 3); b.z = Math.max(b.z, 0.3);
          b.lastTouch = gk;
          b.lastKick = { type: 'parry', by: gk, team, t: this.time };
          gk.kickCd = 0.6;
          this.say('Parried!', 1);
        }
      } else gk.kickCd = 0.5;
      return true;
    }

    bounds() {
      const b = this.ball;
      for (const side of [0, C.W]) {
        const crossed = side === 0 ? b.x < 0 && b.px >= 0 : b.x > C.W && b.px <= C.W;
        if (!crossed) continue;
        const off = Math.abs(b.y - C.H / 2);
        if (Math.abs(off - C.GOAL_W / 2) < 0.2 && b.z < C.GOAL_H) {
          b.x = side === 0 ? 0.05 : C.W - 0.05; b.vx = -b.vx * 0.6; b.vy += U.rand(-2, 2);
          b.owner = null; this.say('Post!', 1); this.sfx('post'); return;
        }
        if (off < C.GOAL_W / 2 && Math.abs(b.z - C.GOAL_H) < 0.15) {
          b.x = side === 0 ? 0.05 : C.W - 0.05; b.vx = -b.vx * 0.5; b.vz = -Math.abs(b.vz) * 0.5;
          b.owner = null; this.say('Crossbar!', 1); this.sfx('post'); return;
        }
        const attacking = this.teams.find((t) => t.attackX === side);
        const defending = this.other(attacking);
        if (off < C.GOAL_W / 2 && b.z < C.GOAL_H) { this.goalScored(attacking); return; }
        const lt = b.lastTouch;
        if (b.lastKick && b.lastKick.type === 'shot' && b.lastKick.team === attacking) this.sfx('ooh');
        if (lt && lt.team === defending) {
          const taker = this.cornerTaker(attacking, b.y < C.H / 2 ? 0 : C.H);
          this.restartOrEnd('corner', attacking, taker, side === 0 ? 0.4 : C.W - 0.4, b.y < C.H / 2 ? 0.4 : C.H - 0.4);
        } else {
          const by = C.H / 2 + (b.y < C.H / 2 ? -4 : 4);
          this.restartOrEnd('goalkick', defending, defending.gk, defending.ownX + defending.dir * 5.5, by);
        }
        return;
      }
      if (b.y < 0 || b.y > C.H) {
        const lt = b.lastTouch;
        const team = lt ? this.other(lt.team) : this.home;
        const by = b.y < 0 ? 0.05 : C.H - 0.05;
        const bx = U.clamp(b.x, 1, C.W - 1);
        let taker = null, bd = 1e9;
        for (const p of team.outfield()) {
          const d = U.dist(p.x, p.y, bx, by);
          if (d < bd) { bd = d; taker = p; }
        }
        this.restartOrEnd('throw', team, taker, bx, by);
      }
    }

    restartOrEnd(kind, team, taker, bx, by) {
      if (!this.fullCourt && !team.isUser) this.endPhase(kind === 'goalkick' ? 'wide' : kind === 'corner' ? 'corner' : 'out', bx);
      else this.setRestart(kind, team, taker, bx, by);
    }

    // ---------- phases (Full court off) ----------

    startPhase() {
      const home = this.home, away = this.away, AI = PP.AI;
      const sb = away.style.block;
      const kind = Math.random() < { high: 0.65, mid: 0.45, low: 0.25 }[sb] ? 'buildup' : 'breakdown';
      away.block = kind === 'buildup' ? (sb === 'low' ? 'mid' : 'high') : (sb === 'high' ? 'mid' : sb);
      home.block = home.style.block;
      this.phaseInHalf++;
      this.phase = { kind, start: this.time };
      for (const p of this.players) p.energy = Math.min(1, p.energy + 0.12); // offscreen time to recover
      const b = this.ball;
      b.reset(C.W / 2, C.H / 2);
      let taker;
      if (kind === 'buildup') {
        taker = home.gk;
        b.x = home.ownX + home.dir * 5; b.y = C.H / 2 + U.rand(-4, 4);
      } else {
        taker = U.pick(home.players.filter((p) => ['CB', 'DM', 'CM'].includes(p.role)));
        const w = home.toWorld(U.rand(0.3, 0.45), U.rand(0.25, 0.75));
        b.x = w.x; b.y = w.y;
      }
      // Lay both teams out in shape around the ball.
      this.state = 'restart';
      this.restart = { kind: 'phase', team: home, taker, t: 0 };
      for (const t of this.teams) {
        const line = AI.offsideLine(this, t);
        for (const p of t.players) {
          p.vx = p.vy = 0; p.stun = p.slide = p.dive = p.lunge = 0;
          p.receiving = null; p.frozen = false; p.plan = null; p.runUntil = 0;
          if (p === taker) continue;
          const pos = p.isGK ? t.toWorld(0.02, 0.5) : AI.shapeTarget(this, t, p, t === home ? 'attack' : 'defend', line);
          p.x = pos.x; p.y = pos.y;
          p.face(b.x, b.y);
        }
      }
      this.setRestart('phase', home, taker, b.x, b.y);
      b.protectUntil = this.time + 2.5; // a beat to look up before the press can tackle
      this.camSnap = true;
      this.say(kind === 'buildup' ? `Build-up vs ${away.block === 'high' ? 'high press' : 'mid block'}` : `Break them down: ${away.block} block`, 1.8);
    }

    // Your attack is over. Resolve the CPU's offscreen attack and move the clock on.
    endPhase(reason, x = this.ball.x) {
      if (this.state === 'between' || this.fullCourt) return;
      this.phase = null;
      this.charging = false; this.preview = null;
      this.ball.owner = null; this.ball.vx = this.ball.vy = this.ball.vz = 0;
      const zone = this.home.depth(x); // 0 = our goal line .. 1 = theirs
      const conceded = reason === 'goal' && this.lastGoalTeam === this.away;
      const base = conceded ? 0 : { turnover: zone < 0.33 ? 0.16 : zone < 0.66 ? 0.07 : 0.03, corner: 0.06, out: 0.03, wide: 0.02, saved: 0.02, timeout: 0.03, goal: 0.02 }[reason] ?? 0.03;
      const pGoal = U.clamp(base * Match.strengthFactor(this.ratings[1], this.ratings[0]), 0.01, 0.6);
      const per = (45 * 60) / Match.PHASES_PER_HALF;
      const next = (this.half - 1) * 45 * 60 + this.phaseInHalf * per;
      const newClock = Math.max(this.clock + 60, next);
      const away = this.away;
      let text = { turnover: 'They kept the ball', corner: 'Their corner', saved: 'Keeper has it', out: 'Out of play', wide: 'Wide', timeout: 'Attack fizzled', goal: null }[reason];
      if (Math.random() < pGoal) {
        const atk = away.players.filter((p) => ['ST', 'LW', 'RW', 'AM', 'LM', 'RM'].includes(p.role));
        const scorer = U.pick(atk.length ? atk : away.outfield());
        const minute = Math.min(this.half * 45, Math.floor(U.lerp(this.clock, newClock, Math.random()) / 60) + 1);
        this.score[1]++;
        this.stats.shots[1]++; this.stats.onTarget[1]++;
        this.events.push({ type: 'goal', team: 1, minute, scorer: scorer.name, og: false, offscreen: true });
        text = `${away.short} score! ${scorer.name} ${minute}'`;
        this.sfx('distantRoar');
      } else if (reason === 'turnover' && Math.random() < 0.6) {
        this.stats.shots[1]++;
        text = `${away.short} attack... ` + U.pick([`saved by ${this.home.gk.name}`, 'shot wide', 'you win it back', 'cleared']);
      }
      this.clock = Math.min(newClock, this.half * 45 * 60);
      this.state = 'between';
      this.stateT = text && text.includes('score') ? 2.6 : 1.4;
      if (text) this.say(text, this.stateT);
    }

    cornerTaker(team, y) {
      const wide = team.outfield().slice().sort((a, b) =>
        Math.abs(a.y - y) + Math.abs(a.x - team.attackX) * 0.5 - (Math.abs(b.y - y) + Math.abs(b.x - team.attackX) * 0.5));
      return wide[0];
    }

    goalScored(team) {
      const i = this.idx(team);
      this.score[i]++;
      this.lastGoalTeam = team;
      const lt = this.ball.lastTouch;
      const og = lt && lt.team !== team;
      const lk = this.ball.lastKick;
      if (lk && lk.type === 'shot' && lk.team === team && !lk.counted) this.stats.onTarget[i]++;
      this.events.push({ type: 'goal', team: i, minute: Math.min(90, this.minute + 1), scorer: lt ? lt.name : '?', og });
      this.state = 'goal';
      this.stateT = 2.6;
      this.goalConceder = this.other(team);
      this.ball.owner = null;
      this.charging = false;
      this.say(og ? 'Own goal!' : 'GOAL!', 2.4);
      this.sfx('goal');
    }

    keepBallInNet() {
      const b = this.ball;
      if (b.x < 0 || b.x > C.W) {
        const back = b.x < 0 ? -C.GOAL_D + 0.3 : C.W + C.GOAL_D - 0.3;
        if ((b.x < 0 && b.x < back) || (b.x > C.W && b.x > back)) { b.x = back; b.vx *= -0.2; }
        b.y = U.clamp(b.y, C.GOAL_Y1 + 0.2, C.GOAL_Y2 - 0.2);
        b.z = Math.min(b.z, C.GOAL_H - 0.2);
        b.vy *= 0.9;
      }
    }

    tickClock(dt) {
      this.clock += dt * ((45 * 60) / this.halfLen);
      const end = this.half === 1 ? 45 * 60 : 90 * 60;
      if (this.clock >= end) {
        this.clock = end;
        this.state = this.half === 1 ? 'halftime' : 'fulltime';
        this.sfx('whistle', 3);
        this.charging = false;
      }
    }

    startSecondHalf() {
      this.half = 2;
      for (const p of this.players) p.energy = Math.min(1, p.energy + 0.5); // half-time breather
      this.clock = 45 * 60;
      this.phaseInHalf = 0;
      if (this.fullCourt) this.kickoff(this.teams[1 - this.firstKickoff]);
      else this.startPhase();
    }
  }

  // Ground passes arrive firm: longer passes arrive faster.
  // User ground passes: tap = 10 m/s (rolls ~15m), full = 21 m/s (a firm ~40m ball).
  Match.userGroundSpeed = (power) => 11 + Math.pow(U.clamp(power, 0, 1), 0.8) * 15; // tap 11, full 26 m/s
  // Sideways acceleration for a pass: right-footers curl it right-to-left (positive), left-footers
  // the other way; more for lofted balls and when played across the body.
  Match.curveFor = (p, vx, vy, lofted) => {
    const s = Math.hypot(vx, vy);
    if (s < 1) return 0;
    const across = Math.abs((p.fx * vy - p.fy * vx) / s);  // |sin| of angle between facing and pass
    const sign = p.foot === 'L' ? -1 : 1;
    return sign * s * (lofted ? 0.16 : 0.1) * (0.6 + 0.4 * across);
  };
  Match.PHASES_PER_HALF = 7;
  Match.CPU_ERR = 1.4; // CPU passing/shooting error multiplier (difficulty)
  Match.AIM_TURN = 1.6;     // rad/s the aim starts turning at (fine adjustments)
  Match.AIM_TURN_MAX = 6.5; // rad/s after holding the direction a moment
  // CPU attack vs your defence (and midfield control) -> multiplier on offscreen goal chances.
  Match.strengthFactor = (atk, def) =>
    U.clamp(Math.exp((atk.raw.att - def.raw.def) / 12 + (atk.raw.mid - def.raw.mid) / 24), 0.3, 2.5);
  Match.arrivalSpeed = (D) => U.clamp(5 + D * 0.15, 5, 10.5);

  PP.Match = Match;
})();
