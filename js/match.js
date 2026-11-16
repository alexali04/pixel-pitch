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
      // Whose zone is it? Compare the player's formation lane with the ball's: full-backs take
      // wide balls, centre-backs central ones. Defenders are preferred over midfielders/forwards.
      cost += Math.abs(p.slot.l - by / C.H) * 14;
      cost += { CB: -1.5, LB: -1.5, RB: -1.5, DM: -0.5 }[p.role] ?? 1.5;
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
          if (p.sentOff) continue;
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
      const names = { throw: 'Throw-in', corner: 'Corner', goalkick: 'Goal kick', freekick: 'Free kick', penalty: 'Penalty' };
      if (names[kind]) this.say(names[kind], 1.1);
    }

    gkHold(gk) {
      this.gainPossession(gk);
      gk.dive = 0; gk.stun = 0;
      if (this.state === 'between') return;
      if (!this.fullCourt && this.phase && !gk.team.isUser) { this.endPhase('saved', gk.x); return; }
      this.setRestart('gk', gk.team, gk, gk.x + gk.fx * 0.35, gk.y + gk.fy * 0.35);
      if (gk.team.isUser) this.say('J: roll it out   K: kick it', 1.8);
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
      b.back = this.pendingBack || 0; this.pendingBack = 0;
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
      if ((type === 'pass' || type === 'clear') && (target || b.vz > 1)) {
        if (b.vz > 1) {
          // In the air: where will it come down to a playable height?
          const path = b.predict(40, 0.1);
          const land = path.find((q, i) => i > 2 && q.z < 1.6) || path[path.length - 1];
          b.lastKick.rx = land.x; b.lastKick.ry = land.y;
        } else {
          const sp = Math.max(6, Math.hypot(b.vx, b.vy)), t = U.dist(b.x, b.y, target.x, target.y) / sp;
          b.lastKick.rx = target.x + target.vx * t; b.lastKick.ry = target.y + target.vy * t;
        }
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
      const skill = Match.passSkill(p, lofted) / 100;
      const angErr = (0.015 + D0 * 0.0012) * (1.6 - skill) * (1 + this.pressureOn(p) * (1.2 - p.stats.composure / 100)) * (p.team.isUser ? 1 : Match.CPU_ERR);
      const dir = U.rot((tx - b.x) / D0, (ty - b.y) / D0, U.gauss() * angErr);
      const D = D0 * (1 + U.gauss() * (p.team.isUser ? 0.05 : 0.12) * (1.6 - skill)); // CPU misjudges weight
      let T0;
      if (lofted) {
        const T = Ball.loftTime(D) * (power == null ? 1 : 1.3 - power * 0.55); T0 = T;
        const Dl = D * 0.8; // land short; the first bounce carries it on
        const L = Ball.loftLaunch(Dl, T, Match.LOFT_BACK);
        b.vx = dir.x * L.s; b.vy = dir.y * L.s; b.vz = L.vz;
        this.pendingBack = Match.LOFT_BACK;
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

    // Throw-in from the hands: released at head height, dropping at (tx, ty).
    throwBall(p, tx, ty, target) {
      const b = this.ball;
      // Released from inside the line, never back over it, and aimed to arrive at about waist
      // height (easy to take down), not dropping on his head.
      b.y = U.clamp(b.y, 0.4, C.H - 0.4);
      ty = U.clamp(ty, 3, C.H - 3);
      const D = Math.max(2, U.dist(b.x, b.y, tx, ty)), T = 0.3 + D / 24;
      const err = U.gauss() * 0.04 * (1.4 - p.stats.shortPass / 100);
      const n = U.rot((tx - b.x) / D, (ty - b.y) / D, err);
      const L = Ball.loftLaunch(D, T, 0, -1.0);
      b.vx = n.x * L.s; b.vy = n.y * L.s; b.vz = L.vz; b.z = 1.8;
      this.release(p, 'pass', target || null);
    }

    // Where a pass to q should be aimed, leading their run.
    leadPoint(p, q, lofted, power = null, v0 = null) {
      let tx = q.x, ty = q.y;
      for (let i = 0; i < 2; i++) {
        const D = U.dist(p.x, p.y, tx, ty);
        const t = lofted ? Ball.loftTime(D) * (power == null ? 1 : 1.3 - power * 0.55)
          : v0 != null ? (Ball.rollTime(v0, D) ?? Ball.groundRun(v0, 0).t)
          : Ball.groundTime(D, Match.arrivalSpeed(D));
        const lead = 0.5 + p.stats.vision * 0.005; // better vision = passes into the runner's path
        tx = q.x + q.vx * t * lead; ty = q.y + q.vy * t * lead;
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
      let vx, vy, vz, back = 0;
      if (!lofted) {
        let v0 = vOverride ?? Match.userGroundSpeed(power);
        const inHands = this.state === 'restart' && this.restart && this.restart.kind === 'gk' && this.restart.taker === p;
        if (p.isGK && !inHands) v0 = Math.max(v0, 13);  // keepers kick it firmer; a roll-out stays soft
        vx = nx * v0; vy = ny * v0; vz = v0 > 18 ? (v0 - 18) * 0.35 : 0; // driven passes skim up
      } else {
        // A chip always rises in a clear arc; holding longer sends it further and higher.
        // Floated with backspin: it climbs, hangs, and drops steeply (keepers drive theirs flatter).
        const D = p.isGK ? 20 + power * 35 : 7 + power * 38, T = p.isGK ? 0.75 + D / 20 : 0.9 + D / 18; // floated: more hang
        back = p.isGK ? 0.3 : Match.LOFT_BACK;
        const L = Ball.loftLaunch(D * 0.8, T, back);
        vx = nx * L.s; vy = ny * L.s; vz = L.vz;
      }
      const curve = Match.curveFor(p, vx, vy, lofted);
      const sim = { x: b.x, y: b.y, z: lofted || vz > 0 ? 0.01 : 0, vx, vy, vz, curve, back };
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
      const pref = this.assistPick;
      if (pref && pref.team === p.team && pref !== target) {
        const sp = pref.topSpeed(true);
        for (let i = 0; i < path.length; i++) {
          const pt = path[i];
          if (pt.z > 1.8) continue;
          if (Math.max(0, U.dist(pref.x, pref.y, pt.x, pt.y) - 0.6) / sp + 0.2 <= (i + 1) * 0.1) { target = pref; break; }
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
      return { vx, vy, vz, curve, back, lofted, x: end.x, y: end.y, target, offside, path: lofted && land ? path.slice(0, path.findIndex((q) => q.x === land.x && q.y === land.y) + 1) : path };
    }

    // aimY in [-1, 1] picks the vertical spot in the goal mouth; power in [0, 1].
    shoot(p, aimY, power) {
      const b = this.ball, team = p.team;
      const gx = team.attackX;
      const ty = C.H / 2 + U.clamp(aimY, -1, 1) * 3.2;
      const D = U.dist(b.x, b.y, gx, ty);
      const pen = this.state === 'restart' && this.restart && this.restart.kind === 'penalty';
      const pressure = pen ? 0 : this.pressureOn(p);
      const fin = p.stats.finishing / 100, pow = p.stats.shotPower / 100;
      power = U.clamp(power, 0.15, 1);
      const speed = 21 + 10 * power + 6 * pow * power;  // tap ~21 m/s, full wind-up ~35 m/s
      const longShot = D > 20 ? 1 + (D - 20) * 0.02 * (1.3 - p.stats.longShots / 100) : 1;
      const angErr = (0.035 + D * 0.002 + power * power * 0.06 + pressure * 0.09 * (1.3 - p.stats.composure / 100)) * (1.6 - fin) * longShot * (team.isUser ? 1 : Match.CPU_ERR);
      const dir = U.rot((gx - b.x) / D, (ty - b.y) / D, U.gauss() * angErr * (pen ? 0.5 : 1));
      const t = D / speed;
      const h = Math.max(0.1, 0.35 + power * 1.25 + U.gauss() * (0.35 + power * 0.8 + pressure * 0.5) * (1.5 - fin) * (pen ? 0.5 : 1));
      b.vx = dir.x * speed; b.vy = dir.y * speed;
      b.vz = h / t + (C.G * t) / 2;
      b.z = 0.05;
      this.stats.shots[this.idx(team)]++;
      this.release(p, 'shot', null);
      if (pen) { // the keeper has to guess: right side (or stays up for one down the middle)?
        const side = Math.abs(aimY) < 0.25 ? 0 : Math.sign(aimY), guess = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? -1 : 1;
        this.ball.lastKick.pen = { right: side === guess };
      }
    }

    // Chip: lifted over the keeper to drop under the bar. More hold = higher and harder, but
    // also less control.
    chipShot(p, aimY, power) {
      const b = this.ball, team = p.team, gx = team.attackX;
      const ty = C.H / 2 + U.clamp(aimY, -1, 1) * 3.0;
      const fin = p.stats.finishing / 100, pressure = this.pressureOn(p);
      const err = (0.04 + power * 0.05 + pressure * 0.06 * (1.3 - p.stats.composure / 100)) * (1.6 - fin);
      const D = U.dist(b.x, b.y, gx, ty) * (1 + U.gauss() * err * 0.6);
      const dir = U.rot((gx - b.x), (ty - b.y), U.gauss() * err);
      const n = U.norm(dir.x, dir.y);
      const T = 0.6 + D / 24 + power * 0.2;                   // hang time: quick, before he can get back
      const h = 1.5 + U.gauss() * 0.4 * (1.5 - fin);        // height as it crosses the line
      const L = Ball.loftLaunch(D, T, 0.55, h);             // some backspin: up and over, drops in
      b.vx = n.x * L.s; b.vy = n.y * L.s;
      b.vz = L.vz; b.z = 0.05;
      this.pendingBack = 0.55;
      this.stats.shots[this.idx(team)]++;
      this.release(p, 'shot', null);
      this.pop(p, 'CHIP', '#9fd3ff');
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
      if (!PP.settings.autoTackle && !this.autoplay) return;
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
      const settling = this.time < (c.settleUntil || 0);
      if (settling) ch += 0.25;                        // ball not under control yet: there to be won
      else if (this.time < b.protectUntil) ch *= 0.25; // just got it under control
      ch = U.clamp(ch, 0.06, 0.85);
      if (auto) ch = U.clamp(0.82 + (t.stats.tackling - hold) * 0.006, 0.5, 0.94) * (this.time < b.protectUntil && !settling ? 0.6 : 1) * (front < -0.3 ? 0.8 : 1);
      const userLost = c.team.isUser, userWon = t.team.isUser;
      const won = Math.random() < ch;
      // Fouls: going through the man. Likeliest when the tackle misses the ball, from behind,
      // or sliding; good tacklers commit fewer.
      const behind = front < -0.3;
      let fp = won ? (behind ? (slide ? 0.35 : 0.12) : slide ? 0.05 : 0.015) : (slide ? 0.4 : auto ? 0.06 : 0.18) * (behind ? 1.8 : 1);
      fp *= U.clamp(1.5 - t.stats.tackling / 100, 0.6, 1.2);
      if (PP.AI.inBox(t.team, c.x, c.y)) fp *= 0.3; // defenders are careful in their own box
      if (Math.random() < fp) { this.foul(t, c, slide, behind, won); return; }
      if (won) {
        c.stun = slide ? 1.4 : auto ? 1.2 : 1.0; c.kickCd = 0.8; // he's on the floor for a moment
        this.sfx('tackle');
        if (auto) { this.pop(c, 'TACKLED!', '#ffd23f'); this.gainPossession(t); this.scrappy(t, 0.55); return; }
        this.pop(c, 'TACKLED!', userLost ? '#e4572e' : '#ffd23f');
        if (!slide && Math.random() < 0.55) { this.gainPossession(t); this.scrappy(t, 0.6); return; }
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

    // A foul: the fouled side gets a free kick, or a penalty if it was in the box. Reckless
    // challenges (sliding in from behind especially) get a yellow card; a second is a red.
    foul(t, c, slide, behind, wonBall) {
      const b = this.ball;
      c.stun = Math.max(c.stun, 1.2); c.kickCd = 0.8;
      this.sfx('tackle'); this.sfx('whistle', 1);
      const vs = c.team, pen = PP.AI.inBox(t.team, c.x, c.y);
      // the home crowd: furious when their man is fouled, muted when their man fouls
      if (this.sound && PP.Sound) PP.Sound.play('foul', vs.isUser ? (pen ? 1 : 0.75) : 0.3);
      let card = null;
      const reckless = (slide && behind) ? 0.65 : slide ? (wonBall ? 0.15 : 0.35) : behind ? 0.3 : 0.12;
      if (Math.random() < reckless) card = (t.yellow || 0) >= 1 ? 'red' : 'yellow';
      this.pop(c, 'FOUL!', '#ff6b4a');
      if (card) this.book(t, card);
      b.owner = null; b.vx = b.vy = b.vz = 0;
      if (pen) {
        const spotX = t.team.ownX + t.team.dir * C.SPOT;
        const taker = vs.outfield().slice().sort((a, d) => d.stats.finishing + d.stats.composure - a.stats.finishing - a.stats.composure)[0];
        this.restartOrEnd('penalty', vs, taker, spotX, C.H / 2);
        // everyone else outside the box straight away
        for (const tm of this.teams) for (const p of tm.players) {
          if (p === taker || p.sentOff || (p.isGK && tm !== vs)) continue;
          const pos = p.isGK ? tm.toWorld(0.02, 0.5) : PP.AI.shapeTarget(this, tm, p, 'defend', 0.5);
          p.x = pos.x; p.y = pos.y; p.vx = p.vy = 0; p.ox = p.x; p.oy = p.y; p.tgx = null;
        }
        const g = t.team.gk; g.x = t.team.ownX + t.team.dir * 0.3; g.y = C.H / 2; g.ox = g.x; g.oy = g.y;
        this.say('PENALTY!', 2);
      } else {
        this.restartOrEnd('freekick', vs, c, U.clamp(c.x, 1, C.W - 1), U.clamp(c.y, 1, C.H - 1));
        c.stun = 0;
      }
    }

    book(p, card) {
      const minute = Math.min(90, this.minute + 1);
      if (card === 'yellow') {
        p.yellow = (p.yellow || 0) + 1;
        this.events.push({ type: 'card', card: 'yellow', team: this.idx(p.team), minute, name: p.name });
        this.pop(p, 'YELLOW CARD', '#ffd23f');
        if (p.yellow < 2) return;
      }
      this.events.push({ type: 'card', card: 'red', team: this.idx(p.team), minute, name: p.name });
      this.pop(p, 'RED CARD!', '#e4572e');
      this.say(`${p.name} is sent off!`, 2.2);
      p.sentOff = true; p.stun = 0; p.slide = 0; p.lunge = 0; p.receiving = null;
      p.x = C.W / 2 + (p.team.dir === 1 ? -4 : 4); p.y = -3; p.vx = p.vy = 0; p.ox = p.x; p.oy = p.y;
      if (this.controlled === p) this.controlled = this.bestDefender(this.ball.x, this.ball.y) || this.home.outfield()[0];
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

    // After winning a tackle the ball isn't under control yet.
    scrappy(p, base) {
      const s = base * (1.5 - p.stats.firstTouch / 100) * (p.team.isUser ? 1 : 1.35);
      if (this.time + s > (p.settleUntil || 0)) { p.settleUntil = this.time + s; p.settleLen = s; }
      p.think = Math.max(p.think, s + 0.15);
    }

    gainPossession(p) {
      const b = this.ball;
      b.back = 0;
      if (this.checkOffside(p)) return;
      if (this.possTeam !== p.team) { this.other(p.team).lostAt = this.time; p.team.lostAt = null; this.possTeam = p.team; }
      // Bringing a ball under control takes a moment: longer for fast or dropping balls and for
      // poorer first touches. Until then you can't play it (a pass/shot waits).
      const inSpd = Math.hypot(b.vx, b.vy), inZ = b.z;
      const settle = U.clamp((0.06 + Math.max(0, inSpd - 7) * 0.035 + (inZ > 0.4 ? 0.25 + inZ * 0.2 : 0)) * (1.5 - p.stats.firstTouch / 100) * (p.team.isUser ? 1 : 1.35), 0, 1.1);
      p.settleUntil = this.time + settle; p.settleLen = settle;
      b.owner = p; b.lastTouch = p;
      b.vx = b.vy = b.vz = 0; b.z = 0; b.curve = 0;
      b.protectUntil = this.time + settle + (p.team.isUser ? 0.5 : 0.2); // protection starts once it's controlled
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

    // Where the aim starts when you press a pass button: the most sensible team-mate within ~70
    // degrees of the direction you're holding (so running at the touchline doesn't mean passing
    // out of play), else just that direction.
    startAim(p, dir, lofted) {
      if (PP.settings.aim !== 'keys' || PP.settings.passAssist === 'off') return dir;
      const team = p.team, b = this.ball;
      const atLine = (b.y < 7 && dir.y < -0.7) || (b.y > C.H - 7 && dir.y > 0.7);
      if (!atLine) return dir; // anywhere else, the aim is exactly what you're holding
      let best = null, bs = -1e9;
      for (const q of team.players) {
        if (q === p || q.isDown() || q.isGK) continue;
        const lx = q.x + q.vx * 0.6, ly = q.y + q.vy * 0.6, d = U.dist(b.x, b.y, lx, ly);
        if (d < 5 || d > (lofted ? 50 : 35)) continue;
        const n = U.norm(lx - b.x, ly - b.y);
        const inward = -Math.sign(dir.y) * n.y;               // not out of play
        if (inward < -0.05) continue;
        const cos = (1 - Math.abs(n.y)) * 1.2;                // along the line: orthogonal to what you held
        let open = 1e9;
        for (const o of this.other(team).players) open = Math.min(open, U.dist(o.x, o.y, lx, ly));
        const fwd = (team.depth(lx) - team.depth(b.x)) * 4;
        const s = cos * 1.5 + fwd * 0.5 + Math.min(open, 6) / 6 - d / 60;
        if (s > bs) { bs = s; best = n; }
      }
      // Holding straight at a touchline with nobody there: point it back infield a bit.
      if (!best && ((b.y < 6 && dir.y < -0.7) || (b.y > C.H - 6 && dir.y > 0.7))) return U.norm(team.dir, -Math.sign(dir.y) * 0.3);
      return best || dir;
    }

    // Team-mate targeting: who best fits the direction you're holding (angle first, then
    // closeness, openness and how far forward he is).
    targetPick(p, dir, lofted) {
      const team = p.team, b = this.ball;
      let best = null, bs = -1e9;
      for (const q of team.players) {
        if (q === p || q.isDown()) continue;
        if (q.isGK && team.depth(b.x) > 0.35) continue;
        const lx = q.x + q.vx * 0.5, ly = q.y + q.vy * 0.5, d = U.dist(b.x, b.y, lx, ly);
        if (d < 3 || d > (lofted ? 55 : 40)) continue;
        const n = U.norm(lx - b.x, ly - b.y), cos = n.x * dir.x + n.y * dir.y;
        if (cos < 0.45) continue;
        let open = 1e9;
        for (const o of this.other(team).players) open = Math.min(open, U.dist(o.x, o.y, lx, ly));
        const s = cos * 2.2 - d / 45 + Math.min(open, 6) * 0.06 + (team.depth(lx) - team.depth(b.x)) * 1.0;
        if (s > bs) { bs = s; best = q; }
      }
      return best;
    }

    // Space decides for you: aiming at the goal mouth from shooting range means a shot.
    shotAim(p, aim, chip = false, force = false) {
      const t = p.team, b = this.ball, gx = t.attackX;
      if ((gx - b.x) * aim.x <= 0.05) return null;
      if (U.dist(b.x, b.y, gx, C.H / 2) > (force ? 40 : chip ? 26 : 32)) return null;
      const gy = b.y + (aim.y / aim.x) * (gx - b.x);
      const wide = Math.abs(b.y - C.H / 2);
      // From a wide angle Space only shoots if you aim right at the goal mouth, and a
      // team-mate in the box on your line means a cross. L always shoots.
      const margin = force ? 6 : wide > 10 ? 0.4 : 2.2;
      if (Math.abs(gy - C.H / 2) > C.GOAL_W / 2 + margin) return null;
      if (!force) {
        if (chip && wide > 12) return null;
        const aa = Math.atan2(aim.y, aim.x);
        for (const q of t.players) {
          if (q === p || q.isGK || !PP.AI.inBox(this.other(t), q.x, q.y, 2)) continue;
          let da = Math.atan2(q.y - b.y, q.x - b.x) - aa;
          while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          if (Math.abs(da) < (wide > 10 ? 0.3 : 0.12)) return null; // looks like a cross / pass
        }
      }
      return { gx, gy: U.clamp(gy, C.GOAL_Y1 + 0.3, C.GOAL_Y2 - 0.3), aimY: U.clamp((gy - C.H / 2) / 3.2, -1, 1) };
    }

    // Gentle pass assist on top of your aim: lean towards a team-mate's run if one is close to
    // the line, otherwise lean a little towards goal in the final third, and never play it
    // straight out of play.
    assistAim(p, aim, lofted, power) {
      const team = p.team, b = this.ball, base = Math.atan2(aim.y, aim.x);
      const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      const level = PP.settings.passAssist;
      this.assistPick = null;
      if (PP.settings.aim === 'target') { this.assistPick = this.targetQ || null; return aim; } // already on a man
      if (level === 'off') return aim;
      const strong = level === 'strong';
      let ang = base;
      // 1. a team-mate's lead point close to the line: bend most of the way onto it. Among
      //    similar angles prefer the one the pass will actually reach (a soft pass -> the
      //    nearer man; a firm one can still find the far man).
      const reach = lofted ? 7 + power * 38 : Ball.rollDist(Match.userGroundSpeed(power));
      const window = strong ? 0.3 : 0.14;        // light: only lines within ~8 degrees
      let best = null, bs = 1e9;
      for (const q of team.players) {
        if (q === p || q.isDown() || q.isGK) continue;
        const lx = q.x + q.vx * 0.8 + team.dir * (Math.hypot(q.vx, q.vy) > 3 ? 2 : 0), ly = q.y + q.vy * 0.8;
        const d = U.dist(b.x, b.y, lx, ly);
        if (d < 4 || d > 45) continue;
        const da = wrap(Math.atan2(ly - b.y, lx - b.x) - base);
        if (Math.abs(da) > window) continue;
        const score = Math.abs(da) + Math.max(0, d - reach) / Math.max(reach, 6) * 0.25;
        if (score < bs) { bs = score; best = da; this.assistPick = q; }
      }
      if (best == null) this.assistPick = null;
      if (best != null) ang = base + best * (strong ? 0.9 : 0.5);
      else if (team.depth(b.x) > 0.6) {
        // 2. final third: lean a few degrees towards the middle of their goal
        const g = wrap(Math.atan2(C.H / 2 - b.y, team.attackX - b.x) - base);
        if (Math.abs(g) < 1.4) ang = base + U.clamp(g, strong ? -0.2 : -0.07, strong ? 0.2 : 0.07);
      }
      // 3. don't put it out of play: turn it back infield. Big corrections only right by a line.
      const byLine = b.y < 7 || b.y > C.H - 7 || team.depth(b.x) > 0.9;
      const maxTurn = byLine ? 1.4 : 0.5;
      for (let i = 0; i < 18; i++) {
        const pl = this.passPlan(p, Math.cos(ang), Math.sin(ang), lofted, power);
        const inY = pl.y > 0.8 && pl.y < C.H - 0.8, inX = pl.x > 0.5 && pl.x < C.W - 0.5;
        if (inY && inX) break;
        // turn towards the box if we're in their half (a cross / cut-back), else back infield
        const tx = team.depth(b.x) > 0.55 ? team.attackX - team.dir * C.SPOT : (team.attackX + C.W / 2) / 2;
        const toward = wrap(Math.atan2(C.H / 2 - b.y, tx - b.x) - ang);
        ang += Math.sign(toward) * 0.05;
        if (Math.abs(wrap(ang - base)) > maxTurn) break;
      }
      return { x: Math.cos(ang), y: Math.sin(ang) };
    }

    userPass(p, plan) {
      const b = this.ball;
      const skill = Match.passSkill(p, plan.lofted) / 100;
      const D = U.dist(b.x, b.y, plan.x, plan.y);
      let angErr = (0.006 + D * 0.0006) * (1.5 - skill) * (1 + this.pressureOn(p) * (1.2 - p.stats.composure / 100));
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 1.5) { // passing across your run at speed is harder
        const pn = Math.hypot(plan.vx, plan.vy) || 1;
        const off = Math.acos(U.clamp((p.vx * plan.vx + p.vy * plan.vy) / (sp * pn), -1, 1));
        angErr *= 1 + (sp / p.topSpeed(true)) * (off / Math.PI) * 0.5;
      }
      const v = U.rot(plan.vx, plan.vy, U.gauss() * angErr);
      const k = 1 + U.gauss() * 0.03 * (1.6 - skill);
      b.vx = v.x * k; b.vy = v.y * k; b.vz = plan.vz * k;
      b.z = plan.lofted || plan.vz > 0 ? 0.01 : 0;
      this.pendingCurve = plan.curve || 0;
      this.pendingBack = plan.back || 0;
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

    // Where the mouse is aiming, as a unit direction from the ball (null when not mouse-aiming).
    // Pointer: towards the world point under the cursor. Locked: a virtual crosshair that rides
    // with the ball and is pushed around by raw mouse movement.
    mouseDir() {
      const b = this.ball, a = PP.settings.aim;
      let v = null;
      if (a === 'mouse' && this.mouseWorld) v = { x: this.mouseWorld.x - b.x, y: this.mouseWorld.y - b.y };
      else if (a === 'mouselock' && this.mouseVec) v = this.mouseVec;
      if (!v || Math.hypot(v.x, v.y) < 1) return null;
      return U.norm(v.x, v.y);
    }

    // The world point the mouse is on (pointer) or the locked crosshair's spot.
    mousePoint() {
      const a = PP.settings.aim, b = this.ball;
      if (a === 'mouse') return this.mouseWorld || null;
      if (a === 'mouselock' && this.mouseVec) return { x: b.x + this.mouseVec.x, y: b.y + this.mouseVec.y };
      return null;
    }

    // Shot or pass? With the mouse it's where you click: on the goal mouth = shot (or chip with
    // the right button). Otherwise the direction decides (see shotAim).
    smartShot(p, dir, chip) {
      const pt = this.mousePoint();
      if (!pt) return this.shotAim(p, dir, chip);
      const t = p.team, b = this.ball, gx = t.attackX;
      const range = U.dist(b.x, b.y, gx, C.H / 2);
      if (range > (chip ? 26 : 40) || (chip && Math.abs(b.y - C.H / 2) > 12)) return null;
      if (Math.abs(pt.x - gx) > 7 || Math.abs(pt.y - C.H / 2) > C.GOAL_W / 2 + 2.5) return null;
      if ((gx - b.x) * dir.x <= 0.05) return null;
      const gy = b.y + (dir.y / dir.x) * (gx - b.x);
      return { gx, gy: U.clamp(gy, C.GOAL_Y1 + 0.3, C.GOAL_Y2 - 0.3), aimY: U.clamp((gy - C.H / 2) / 3.2, -1, 1) };
    }

    autoShotDir(p, aim) {
      const b = this.ball, t = p.team, gx = t.attackX;
      if (U.dist(b.x, b.y, gx, C.H / 2) > 13 || Math.abs(b.y - C.H / 2) > 11) return null;
      if ((gx - b.x) * aim.x > 0.05) {
        const gy = b.y + (aim.y / aim.x) * (gx - b.x);
        if (Math.abs(gy - C.H / 2) < C.GOAL_W / 2 - 0.3) return null; // you're already on target
      }
      const gk = this.other(t).gk, side = gk.y > C.H / 2 ? -1 : 1;
      return U.norm(gx - b.x, C.H / 2 + side * (C.GOAL_W / 2 - 0.9) - b.y);
    }

    // Direction the ball will actually go for an intended aim: the body turns towards the aim
    // (quick standing, slow at a sprint) and can only strike so far across itself.
    kickDir(p, dt) {
      const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      const want = Math.atan2(this.aim.y, this.aim.x);
      if (this.bodyA == null) this.bodyA = Math.atan2(p.fy, p.fx);
      const sp = Math.hypot(p.vx, p.vy), sf = U.clamp(sp / p.topSpeed(true), 0, 1);
      const turn = (6 - 3.5 * sf) * (0.7 + 0.6 * p.stats.agility / 100);
      const d = wrap(want - this.bodyA);
      this.bodyA += Math.sign(d) * Math.min(Math.abs(d), turn * dt);
      if (sp > 1) { // running: the hips stay roughly with the run
        const run = Math.atan2(p.vy, p.vx), lim = Math.PI - (Math.PI - 0.6) * sf;
        this.bodyA = run + U.clamp(wrap(this.bodyA - run), -lim, lim);
      } else { p.fx = Math.cos(this.bodyA); p.fy = Math.sin(this.bodyA); }
      const maxOff = 1.35 + 0.55 * (1 - sf); // ~77° across the body at a sprint, ~109° standing
      const a = this.bodyA + U.clamp(wrap(want - this.bodyA), -maxOff, maxOff);
      return { x: Math.cos(a), y: Math.sin(a) };
    }

    // Locked mouse: move the virtual crosshair by a raw mouse delta (CSS pixels).
    nudgeMouse(dx, dy) {
      const k = 0.07 * ({ slow: 0.6, normal: 1, fast: 1.6 }[PP.settings.mouseSens] || 1);
      const v = this.mouseVec || (this.mouseVec = { x: 10 * this.home.dir, y: 0 });
      v.x += dx * k; v.y += dy * k * (C.PX / C.PY); // same feel up/down as left/right on screen
      const r = Math.hypot(v.x, v.y), R = 45, b = this.ball;
      if (r > R) { v.x *= R / r; v.y *= R / r; }
      v.x = U.clamp(b.x + v.x, -4, C.W + 4) - b.x; v.y = U.clamp(b.y + v.y, -3, C.H + 3) - b.y; // stays around the pitch
    }

    handleUser(dt, I) {
      const p = this.controlled;
      if (!p || this.state === 'goal' || this.autoplay) return;
      const ax = I.axis();
      const active = !!(ax.x || ax.y);
      const b = this.ball;
      const theirBall = (b.owner && !b.owner.team.isUser) || (!b.owner && b.lastKick && !b.lastKick.team.isUser);
      const sprint = I.down('sprint') || (PP.settings.autoSprint && theirBall && b.owner !== p && this.home.depth(b.x) < 0.38); // danger: run
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
      // Defending assist: your defender takes up his AI role (press / cover / mark / chase the
      // landing spot) when you're not steering, or always with your input as a nudge.
      const da = PP.settings.defAssist;
      this.defNudge = null;
      if (theirBall && !hasBall && !recv && this.state === 'play' && da !== 'off' && !p.isGK) {
        if (!steering) p.userAuto = true;
        else if (da === 'always') { p.userAuto = true; this.defNudge = U.norm(ax.x, ax.y); }
      }
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
        } else if (hasBall && this.charging && this.mouseDir()) {
          p.move(ax.x, ax.y, sprint);                   // mouse aims, keys keep steering
        } else if (hasBall && this.charging && this.runDir) {
          p.move(this.runDir.x, this.runDir.y, sprint); // keep the run going; the keys aim the pass
        } else if (!(hasBall && this.charging)) p.move(ax.x, ax.y, sprint);
        else p.stop();                                  // charging from a standstill: plant and aim
      }

      if (hasBall) {
        // Hold a button to charge strength, release to play it. Tap = soft.
        const restart = this.state === 'restart';
        if (!this.charging) {
          const setPiece = restart && this.restart && this.restart.kind !== 'phase' && this.restart.kind !== 'penalty';
          const bp = this.bufferedPress && this.time - this.bufferedPress.t < 0.6 && I.down(this.bufferedPress.kind) ? this.bufferedPress.kind : null;
          this.bufferedPress = null;
          if (this.heldOnGain) this.heldOnGain = this.heldOnGain.filter((k) => I.down(k));
          const fresh = (k) => I.hit(k) && !(this.heldOnGain || []).includes(k);
          const hitKind = fresh('click') ? 'click' : fresh('pass') ? 'pass' : fresh('lob') ? 'lob' : fresh('shoot') ? 'shoot' : fresh('shootOnly') ? 'shootOnly' : bp;
          // Left click is one action: a shot if you click on the goal, otherwise a pass there.
          const kind = hitKind === 'click' ? 'smart' : hitKind === 'shoot' || hitKind === 'shootOnly' ? (setPiece ? 'lob' : 'shot') : hitKind;
          if (kind) {
            this.charging = true; this.chargeKind = kind; this.charge = 0; this.releaseQueued = false;
            this.prevKeys = (ax.x ? 1 : 0) + (ax.y ? 1 : 0); this.aimHold = 0;
            const sp = Math.hypot(p.vx, p.vy);
            this.runDir = sp > 1.5 ? { x: p.vx / sp, y: p.vy / sp } : null;
            this.chargeBtn = hitKind === 'shoot' || hitKind === 'shootOnly' || hitKind === 'click' ? hitKind : kind;
            this.bodyA = null;
            // Aim starts where you're pointing (or facing) ...
            const md = this.mouseDir();
            this.aim = md || this.startAim(p, active ? U.norm(ax.x, ax.y) : { x: p.fx, y: p.fy }, kind === 'lob');
            this.targetDir = active ? U.norm(ax.x, ax.y) : { x: p.fx, y: p.fy };
            this.lastAx = { x: ax.x, y: ax.y };
          }
        }
        this.preview = null;
        if (this.charging) {
          const shotNow = this.chargeKind === 'shot' || (this.chargeKind === 'smart' && this.preview && this.preview.shot);
          const fill = shotNow ? 0.6 : 0.38;
          if (I.down(this.chargeBtn) && !this.releaseQueued) this.charge = Math.min(1, this.charge + dt / fill);
          // ... and turns smoothly towards the held direction, so any angle is reachable.
          const nKeys = (ax.x ? 1 : 0) + (ax.y ? 1 : 0);
          this.lastAxPrev = this.lastAx;
          if (nKeys < (this.prevKeys || 0)) this.aimHold = this.time + 0.2; // a key was just let go
          this.prevKeys = nKeys;
          const mouseAim = this.mouseDir();
          if (PP.settings.aim === 'target' && this.chargeKind !== 'shot') {
            // Targeting: the held direction picks a team-mate; the pass leads his run.
            if (active) this.targetDir = U.norm(ax.x, ax.y);
            const lofted = this.chargeKind === 'lob';
            const q = this.targetPick(p, this.targetDir || { x: p.fx, y: p.fy }, lofted);
            this.targetQ = q;
            if (q) {
              const lp = lofted ? this.leadPoint(p, q, true, this.charge) : this.leadPoint(p, q, false, null, Match.userGroundSpeed(this.charge));
              this.aim = U.norm(lp.x - b.x, lp.y - b.y);
            } else if (this.targetDir) this.aim = this.targetDir;
          } else if (mouseAim) {
            this.aim = mouseAim;
          } else if (active && this.time > (this.aimHold || 0)) {
            const want = Math.atan2(ax.y, ax.x), cur = Math.atan2(this.aim.y, this.aim.x);
            let da = want - cur;
            while (da > Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            const newKey = (ax.x !== (this.lastAx || {}).x || ax.y !== (this.lastAx || {}).y);
            this.aimHeld = this.aimDir === Math.sign(da) ? (this.aimHeld || 0) + dt : 0;
            this.aimDir = Math.sign(da);
            const spd = { slow: 0.7, normal: 1, fast: 1.5 }[PP.settings.aimSpeed] || 1;
            const rate = Math.min(Match.AIM_TURN_MAX, Match.AIM_TURN + this.aimHeld * 9) * spd;
            const ease = Math.min(1, Math.abs(da) / 0.35); // glide into the target angle
            // A fresh press far from the current aim is a flick: jump straight there.
            let a = newKey && Math.abs(da) > 1.0 ? want
              : cur + Math.sign(da) * Math.min(Math.abs(da), rate * dt * Math.max(0.35, ease));
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
          this.lastAx = { x: ax.x, y: ax.y };
          // The ball goes where the body allows: it turns towards your aim, and you can only
          // strike so far across it (less at speed).
          let eff = this.kickDir(p, dt);
          // Point blank: Space just puts it towards goal (away from the keeper) if you're not
          // already aiming at the goal mouth — no time to line it up.
          if (this.chargeKind === 'shot') { const auto = this.autoShotDir(p, eff); if (auto) eff = auto; }
          const shot = this.chargeKind === 'smart' || (this.chargeKind === 'lob' && !restart) ? this.smartShot(p, eff, this.chargeKind === 'lob') : null;
          if (this.chargeKind === 'shot') {
            const fs = this.shotAim(p, eff, false, true);
            this.preview = fs ? { shot: true, x: fs.gx, y: fs.gy, aimY: fs.aimY } : { shot: true, x: p.team.attackX, y: C.H / 2, aimY: 0 };
          } else if (shot) this.preview = { shot: true, chip: this.chargeKind === 'lob', x: shot.gx, y: shot.gy, aimY: shot.aimY };
          else if (this.chargeKind !== 'shot') {
            const lob = this.chargeKind === 'lob';
            const a = this.assistAim(p, eff, lob, this.charge);
            this.preview = this.passPlan(p, a.x, a.y, lob, this.charge);
          }
          if (I.released(this.chargeBtn) || !I.down(this.chargeBtn)) this.releaseQueued = true;
          if (this.releaseQueued && this.time >= (p.settleUntil || 0) - (p.settleLen || 0) * 0.5) { // >50% control
            this.releaseQueued = false;
            const pvShot = this.preview && this.preview.shot;
            const k = this.chargeKind === 'smart' ? (pvShot ? 'shot' : 'pass') : this.chargeKind === 'lob' && pvShot ? 'chip' : this.chargeKind;
            const pw = this.charge;
            this.charging = false; this.charge = 0; this.chargeKind = null;
            if (k === 'shot') this.shoot(p, this.preview && this.preview.shot ? this.preview.aimY : ax.y, pw);
            else if (k === 'chip') this.chipShot(p, this.preview.aimY, pw);
            else if (restart && this.restart && this.restart.kind === 'throw') {
              // Your throw-in: from the hands, 6-22m by how long you held it.
              const a = this.assistAim(p, eff, true, pw), dist = 6 + pw * 16;
              const pl = this.passPlan(p, a.x, a.y, false, pw);
              this.throwBall(p, U.clamp(b.x + a.x * dist, 1, C.W - 1), b.y + a.y * dist, pl.target);
              this.latch = true; this.latchAxis = { x: ax.x, y: ax.y };
              if (pl.target) { this.controlled = pl.target; }
            } else {
              const a = this.assistAim(p, eff, k === 'lob', pw);
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
        if (I.hit('pass') || I.hit('lob') || I.hit('shoot') || I.hit('click')) this.bufferedPress = { t: this.time, kind: I.hit('click') ? 'click' : I.hit('pass') ? 'pass' : I.hit('lob') ? 'lob' : 'shoot' };
      } else {
        this.charging = false; this.charge = 0; this.chargeKind = null; this.preview = null;
        // Without the ball: Space = tackle (header at goal / clearance if it's in the air, sprint
        // to it if it's loose), J = switch player (header pass if it's our ball in the air),
        // K = slide.
        const aerial = this.aerialFor(p);
        const ours = !b.owner && b.lastKick && b.lastKick.team === p.team;
        if (I.hit('shoot') || I.hit('click')) {
          if (aerial) {
            const d = p.team.depth(b.x);
            this.queueHeader(p, d > 0.68 ? 'shoot' : d < 0.4 && !ours ? 'clear' : 'pass', ax);
          } else if (b.owner && b.owner.team !== p.team) this.tryTackle(p);
          else if (!b.owner) { p.receiving = { t: this.time }; this.pop(p, 'GO!', '#9fd3c7'); }
        } else if (I.hit('pass')) {
          if (aerial && ours) this.queueHeader(p, 'pass', ax);
          else this.switchPlayer();
        } else if (I.hit('lob')) this.trySlide(p);
        // Auto-poke: get close enough and your defender has a go on their own.
        const c = b.owner;
        if (PP.settings.autoTackle && c && c.team !== p.team && this.state === 'play' && p.lunge <= 0 && !p.isDown() &&
            p.tackleCd <= 0 && (this.time > b.protectUntil || this.time < (c.settleUntil || 0)) && U.dist(p.x, p.y, c.x, c.y) < 2.8) {
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
      if (this.time - (this.lastAutoSwitch || 0) < 0.8) return; // stop flicker between two equals
      let bx = b.x + b.vx * 0.25, by = b.y + b.vy * 0.25;
      if (!b.owner && lk && (lk.type === 'pass' || lk.type === 'clear') && lk.rx != null) { bx = lk.rx; by = lk.ry; } // judge against the receiving spot
      const best = this.bestDefender(bx, by);
      if (!best || best === c) return;
      const cc = c && !c.isGK ? this.defendCost(c, bx, by) : 1e9;
      const margin = !b.owner && lk && lk.rx != null ? 4 : 3.5; // stick with your man unless clearly worse
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
      this.anticipateMiss();
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

    // ---------- goal replays ----------
    // Every other step (60 Hz) the visible state is recorded into a ring buffer; after a goal
    // the last few seconds play back in slow motion.
    snap() {
      const P = Match.REC_P, out = new Float32Array(this.players.length * P.length + 3);
      let i = 0;
      for (const p of this.players) for (const k of P) out[i++] = p[k] || 0;
      const b = this.ball; out[i++] = b.x; out[i++] = b.y; out[i] = b.z;
      return out;
    }
    applySnap(f, keepOld) {
      const P = Match.REC_P, b = this.ball;
      let i = 0;
      for (const p of this.players) {
        if (keepOld) { p.ox = p.x; p.oy = p.y; } else { p.ox = null; p.oy = null; }
        for (const k of P) p[k] = f[i++];
        p.shielding = null;
      }
      if (keepOld) { b.ox = b.x; b.oy = b.y; b.oz = b.z; } else { b.ox = b.oy = b.oz = null; }
      b.x = f[i++]; b.y = f[i++]; b.z = f[i];
    }
    record() {
      if (this.autoplay) return;
      this.recTick = !this.recTick;
      if (!this.recTick) return;
      const r = this.rec || (this.rec = []);
      r.push(this.snap());
      this.recCount = (this.recCount || 0) + 1;
      if (r.length > 480) r.shift();
    }
    startReplay(then) {
      const r = this.rec || [], first = (this.recCount || 0) - r.length; // absolute index of r[0]
      const end = Math.min(r.length, (this.goalRecAt ?? Infinity) - first);
      const start = Math.max(0, end - 230); // ~2.8s before the goal + 1s after
      if (this.autoplay || end - start < 30) { then(); return; }
      this.replay = { frames: r.slice(start, end), t: 0, live: this.snap(), liveBall: { vx: this.ball.vx, vy: this.ball.vy, vz: this.ball.vz, owner: this.ball.owner }, then, shown: -1 };
      this.state = 'replay';
      this.charging = false; this.preview = null;
    }
    stepReplay(dt, I) {
      const R = this.replay;
      R.t += dt * 0.6; // slow motion
      const fi = Math.floor(R.t * 60);
      const skip = I && (I.hit('pass') || I.hit('shoot') || I.hit('lob') || I.hit('start') || I.hit('click'));
      if (fi >= R.frames.length || skip) {
        this.applySnap(R.live, false);
        Object.assign(this.ball, R.liveBall);
        this.replay = null;
        R.then();
        return;
      }
      if (fi !== R.shown) { this.applySnap(R.frames[fi], R.shown >= 0); R.shown = fi; }
      else { for (const p of this.players) { p.ox = p.x; p.oy = p.y; } const b = this.ball; b.ox = b.x; b.oy = b.y; b.oz = b.z; }
    }

    step(dt, I) {
      if (this.state === 'replay') { this.stepReplay(dt, I); return; }
      this.time += dt;
      for (const p of this.players) { p.ox = p.x; p.oy = p.y; }
      const b0 = this.ball; b0.ox = b0.x; b0.oy = b0.y; b0.oz = b0.z;
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
      if (this.state === 'halftime' || this.state === 'fulltime') return;
      this.record();

      if (this.state === 'goal') {
        this.stateT -= dt;
        PP.AI.update(this, dt);
        for (const p of this.players) p.physics(dt);
        this.ball.step(dt);
        this.keepBallInNet();
        if (this.stateT <= 0) {
          this.startReplay(() => {
            if (this.fullCourt) this.kickoff(this.goalConceder);
            else this.endPhase('goal');
          });
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
      const ctl = this.controlled;
      if (this.defNudge && ctl && ctl.userAuto) { // your input bends the assisted run
        const sp = ctl.topSpeed(true), n = this.defNudge;
        const vx = ctl.dvx + n.x * sp * 0.7, vy = ctl.dvy + n.y * sp * 0.7, l = Math.hypot(vx, vy) || 1;
        ctl.dvx = (vx / l) * Math.min(sp, l); ctl.dvy = (vy / l) * Math.min(sp, l);
      }
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
      let best = null, bd = 1e9, stretch = null;
      for (const p of this.players) {
        // Slow balls are easier to reach; a firm pass is only easy for the player it's meant for.
        // Team-mates of the passer are expecting it too; opponents have to read it.
        const reach = bspd < 4 ? 1.05 : (lk1 && lk1.team === p.team) || bspd < 12 ? 0.85 : 0.65;
        if (p.isDown() || p.kickCd > 0) continue;
        const lk0 = b.lastKick;
        if (p.isGK && PP.AI.inBox(p.team, p.x, p.y, 0.5) && !(lk0 && lk0.team === p.team)) continue;
        if (lk0 && lk0.type === 'pass' && lk0.team === p.team && lk0.target && lk0.target !== p && !lk0.target.isDown() &&
            bspd > 8 && this.time - lk0.t < 3) continue; // dummy: it's for the man behind
        if (b.z > 1.9 || (b.z > 0.4 && b.vz > 0)) continue; // can't control a rising ball
        const d = U.dist(p.x, p.y, b.x, b.y);
        if (d < reach && d < bd) { bd = d; best = p; }
        else if (!best && d < reach + 0.6 && (p.receiving || (lk1 && lk1.team === p.team) || bspd < 6)) stretch = stretch && stretch.d < d ? stretch : { p, d };
      }
      if (!best && stretch && b.z < 1.0) {
        // Stretch for it: less certain, and it costs you your stride.
        const p = stretch.p;
        p.vx *= 0.35; p.vy *= 0.35; p.kickAnim = 0.22;
        if (Math.random() < 0.7) { this.gainPossession(p); p.settleUntil = Math.max(p.settleUntil, this.time + 0.3); }
        else { p.kickCd = 0.3; const dd = U.rot(b.vx, b.vy, U.rand(-0.5, 0.5)); b.vx = dd.x * 0.6; b.vy = dd.y * 0.6; b.lastTouch = p; }
        return;
      }
      if (!best) return;
      if (lk1 && lk1.type === 'shot' && lk1.team !== best.team && !best.isGK) { this.crowdOoh(lk1); this.pop(best, 'BLOCKED!', '#cfd8d6'); }
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
      const cpu = !best.team.isUser;
      // A ball fired in hard is hard to kill; one that has rolled a long way is easy.
      const thr = (meant ? (cpu ? 11 : 12) : 9) + touch * (meant ? (cpu ? 7 : 8) : 6);
      let ch = speed < thr ? 1 : U.clamp(1 - (speed - thr) / 16, 0.15, 1);
      if (b.z > 1.2) ch *= cpu ? 0.75 : 0.93; // CPU players fluff more high balls
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
      const threat = lk && lk.team !== team && (speed > 10 || lk.type === 'shot');
      if (!threat) { this.gkHold(gk); return true; }

      let save = 0.95 - Math.max(0, speed - 22) * 0.02 - (d / reach) * 0.25 + (gk.stats.reflexes - 70) * 0.006;
      if (b.z > 2.0) save -= 0.15;
      if (lk.pen) save = lk.pen.right ? save * 0.8 : 0.06; // went the wrong way
      // A chip dropping over him: back-pedalling and reaching up and back, he often can't get there.
      const dropping = b.vz < -2 && b.z > 1.2 && speed < 14;
      if (dropping) save -= 0.08 + Math.min(0.4, Math.max(0, -gk.vx * team.dir) * 0.1) + U.clamp((b.z - 1.8) * 0.3, 0, 0.2);
      save = U.clamp(save, 0.2, 0.97);
      if (lk.type === 'shot' && !lk.counted) { lk.counted = true; this.stats.onTarget[this.idx(lk.team)]++; }
      if (Math.random() < save) {
        const catchP = U.clamp(1.25 - speed / 22 + (gk.stats.handling - 70) * 0.01 - (gk.dive > 0 ? 0.2 : 0), 0.1, 0.9);
        this.sfx('save');
        this.crowdOoh(lk); // so close! / phew
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
          b.owner = null; this.say('Post!', 1); this.sfx('post'); this.crowdOoh(b.lastKick); return;
        }
        if (off < C.GOAL_W / 2 && Math.abs(b.z - C.GOAL_H) < 0.15) {
          b.x = side === 0 ? 0.05 : C.W - 0.05; b.vx = -b.vx * 0.5; b.vz = -Math.abs(b.vz) * 0.5;
          b.owner = null; this.say('Crossbar!', 1); this.sfx('post'); this.crowdOoh(b.lastKick); return;
        }
        const attacking = this.teams.find((t) => t.attackX === side);
        const defending = this.other(attacking);
        if (off < C.GOAL_W / 2 && b.z < C.GOAL_H) { this.goalScored(attacking); return; }
        const lt = b.lastTouch;
        if (b.lastKick && b.lastKick.team === attacking) this.crowdOoh(b.lastKick);
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
      if (!this.fullCourt && !team.isUser && kind !== 'penalty') this.endPhase(kind === 'goalkick' ? 'wide' : kind === 'corner' ? 'corner' : 'out', bx);
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
          if (p.sentOff) continue;
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
      if (Match.OFFSCREEN_GOALS && Math.random() < pGoal) {
        const atk = away.players.filter((p) => ['ST', 'LW', 'RW', 'AM', 'LM', 'RM'].includes(p.role));
        const scorer = U.pick(atk.length ? atk : away.outfield());
        const minute = Math.min(this.half * 45, Math.floor(U.lerp(this.clock, newClock, Math.random()) / 60) + 1);
        this.score[1]++;
        this.stats.shots[1]++; this.stats.onTarget[1]++;
        this.events.push({ type: 'goal', team: 1, minute, scorer: scorer.name, og: false, offscreen: true });
        text = `${away.short} score! ${scorer.name} ${minute}'`;
        this.sfx('distantRoar');
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

    // A shot that's going wide or over is known as soon as it's struck: the crowd's ooh starts
    // then, with its run-up timed so the groan lands as the ball flies past the post.
    anticipateMiss() {
      const b = this.ball, lk = b.lastKick, path = this.ballPath;
      if (!lk || lk.type !== 'shot' || lk.oohed || !path) return;
      const gx = lk.team.attackX;
      for (let i = 0; i < path.length; i++) {
        const q = path[i];
        if ((q.x - gx) * (b.x - gx) > 0) continue; // not at the line yet
        const off = Math.abs(q.y - C.H / 2);
        if (off > C.GOAL_W / 2 + 0.3 || q.z > C.GOAL_H + 0.2) this.crowdOoh(lk, (i + 1) * 0.1);
        return;
      }
    }

    // The home crowd reacts once per shot that doesn't go in: louder when it was yours.
    crowdOoh(lk, lead = 0) {
      if (!lk || lk.type !== 'shot' || lk.oohed) return;
      lk.oohed = true;
      this.sfx('ooh', { vol: lk.team.isUser ? 0.85 : 0.4, lead: Math.min(lead, 1.5) });
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
      this.goalRecAt = (this.recCount || 0) + 60; // replay ends a second after it hits the net
      this.goalConceder = this.other(team);
      this.ball.owner = null;
      this.charging = false;
      this.say(og ? 'Own goal!' : 'GOAL!', 2.4);
      this.sfx(team.isUser ? 'goal' : 'concede');
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
  Match.LOFT_BACK = 0.65; // backspin on a lofted pass
  // Player fields a replay frame records (all a sprite needs).
  Match.REC_P = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'anim', 'slide', 'dive', 'diveTotal', 'stun', 'kickAnim', 'jump', 'lunge'];
  Match.curveFor = (p, vx, vy, lofted) => {
    const s = Math.hypot(vx, vy);
    if (s < 1) return 0;
    const across = Math.abs((p.fx * vy - p.fy * vx) / s);  // |sin| of angle between facing and pass
    const sign = p.foot === 'L' ? -1 : 1;
    return sign * s * (lofted ? 0.16 : 0.1) * (0.6 + 0.4 * across);
  };
  // Which skill a pass uses: keepers kick with 'kicking', wide lofted balls in the final third
  // are crosses, otherwise short/long passing.
  Match.passSkill = (p, lofted) => {
    if (p.isGK) return p.stats.kicking;
    if (lofted && p.team.depth(p.x) > 0.65 && (p.y < 14 || p.y > C.H - 14)) return p.stats.crossing;
    return lofted ? p.stats.longPass : p.stats.shortPass;
  };
  Match.PHASES_PER_HALF = 7;
  Match.CPU_ERR = 2.2;          // CPU passing/shooting error multiplier (difficulty)
  Match.OFFSCREEN_GOALS = false; // a team only scores by putting the ball in the net
  Match.AIM_TURN = 1.6;     // rad/s the aim starts turning at (fine adjustments)
  Match.AIM_TURN_MAX = 6.5; // rad/s after holding the direction a moment
  // CPU attack vs your defence (and midfield control) -> multiplier on offscreen goal chances.
  Match.strengthFactor = (atk, def) =>
    U.clamp(Math.exp((atk.raw.att - def.raw.def) / 12 + (atk.raw.mid - def.raw.mid) / 24), 0.3, 2.5);
  Match.arrivalSpeed = (D) => U.clamp(5 + D * 0.15, 5, 10.5);

  PP.Match = Match;
})();
