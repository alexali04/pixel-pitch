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
      this.kickoff(this.teams[this.firstKickoff]);
    }

    other(t) { return t === this.home ? this.away : this.home; }
    idx(t) { return t === this.home ? 0 : 1; }
    say(text, t = 1.4) { this.banner = { text, t }; }
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
      mate.x = C.W / 2 - team.dir * 1.5; mate.y = C.H / 2 + 5;
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
      taker.vx = taker.vy = 0; taker.stun = 0; taker.frozen = true;
      b.owner = taker; b.lastTouch = taker;
      this.state = 'restart';
      this.restart = { kind, team, taker, t: 0 };
      this.charging = false; this.charge = 0;
      if (team.isUser) this.controlled = taker;
      else this.controlled = this.bestDefender(bx, by);
      // teleports: don't interpolate across them
      for (const q of this.players) { q.ox = q.x; q.oy = q.y; }
      b.ox = b.x; b.oy = b.y; b.oz = b.z;
      const names = { throw: 'Throw-in', corner: 'Corner', goalkick: 'Goal kick' };
      if (names[kind]) this.say(names[kind], 1.1);
    }

    gkHold(gk) {
      this.gainPossession(gk);
      gk.dive = 0; gk.stun = 0;
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
      b.lastKick = { type, by: p, team: p.team, target, t: this.time };
      p.kickCd = 0.35;
      this.endRestart();
      for (const q of this.players) q.receiving = null;
      if (target) target.receiving = { t: this.time };
      if (!p.team.isUser && type === 'pass' && target) {
        const c = this.bestDefender(target.x, target.y);
        if (c) { this.controlled = c; this.lastAutoSwitch = this.time; }
      }
    }

    // Kick the ball towards a world point. Error grows with distance (stats refine this in stage 3).
    // v0 (ground passes only) = exact kick speed chosen by the user; otherwise the speed is
    // picked so the ball arrives at a sensible pace.
    kickTo(p, tx, ty, lofted, type, target, power = null, v0 = null) {
      const b = this.ball;
      const D0 = Math.max(1, U.dist(b.x, b.y, tx, ty));
      const skill = (lofted ? p.stats.longPass : p.stats.shortPass) / 100;
      const angErr = (0.015 + D0 * 0.0012) * (1.6 - skill) * (1 + this.pressureOn(p) * 0.6);
      const dir = U.rot((tx - b.x) / D0, (ty - b.y) / D0, U.gauss() * angErr);
      const D = D0 * (1 + U.gauss() * 0.05 * (1.6 - skill));
      if (lofted) {
        const T = Ball.loftTime(D) * (power == null ? 1 : 1.3 - power * 0.55);
        const Dl = D * 0.8; // land short; the first bounce carries it on
        const s = (Dl * C.AIR_K) / (1 - Math.exp(-C.AIR_K * T));
        b.vx = dir.x * s; b.vy = dir.y * s; b.vz = (C.G * T) / 2;
      } else {
        const s = v0 != null ? v0 * (1 + U.gauss() * 0.03 * (1.6 - skill)) : Ball.groundSpeedFor(D, Match.arrivalSpeed(D));
        b.vx = dir.x * s; b.vy = dir.y * s; b.vz = 0;
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

    // What a user pass would do right now: a teammate (with lead point) or a spot in space.
    passPlan(p, ix, iy, lofted, power) {
      let dx = ix, dy = iy;
      if (!dx && !dy) { dx = p.fx; dy = p.fy; }
      const n = U.norm(dx, dy);
      const target = this.findPassTarget(p, n.x, n.y, lofted);
      if (lofted) {
        if (target) { const t = this.leadPoint(p, target, true, power); return { target, x: t.x, y: t.y, aimX: t.x, aimY: t.y, lofted }; }
        const D = 16 + power * 34;
        const x = U.clamp(p.x + n.x * D, 1, C.W - 1), y = U.clamp(p.y + n.y * D, 1, C.H - 1);
        return { target: null, x, y, aimX: x, aimY: y, lofted };
      }
      // Ground pass: the button sets the kick speed; the line ends where the ball will get to.
      const v0 = Match.userGroundSpeed(power);
      const reach = Ball.rollDist(v0);
      let aimX, aimY;
      if (target) { const t = this.leadPoint(p, target, false, null, v0); aimX = t.x; aimY = t.y; }
      else { aimX = p.x + n.x * reach; aimY = p.y + n.y * reach; }
      const d = U.norm(aimX - p.x, aimY - p.y);
      const D = Math.min(U.dist(p.x, p.y, aimX, aimY), reach);
      return {
        target, v0, lofted, short: !!target && U.dist(p.x, p.y, aimX, aimY) > reach,
        aimX, aimY,
        x: U.clamp(p.x + d.x * D, 0.5, C.W - 0.5), y: U.clamp(p.y + d.y * D, 0.5, C.H - 0.5),
      };
    }

    // aimY in [-1, 1] picks the vertical spot in the goal mouth; power in [0, 1].
    shoot(p, aimY, power) {
      const b = this.ball, team = p.team;
      const gx = team.attackX;
      const ty = C.H / 2 + U.clamp(aimY, -1, 1) * 3.0;
      const D = U.dist(b.x, b.y, gx, ty);
      const pressure = this.pressureOn(p);
      const fin = p.stats.finishing / 100, pow = p.stats.shotPower / 100;
      power = U.clamp(power, 0.15, 1);
      const speed = 14 + 12 * power + 7 * pow * power;
      const angErr = (0.02 + D * 0.0011 + power * power * 0.03 + pressure * 0.04) * (1.5 - fin);
      const dir = U.rot((gx - b.x) / D, (ty - b.y) / D, U.gauss() * angErr);
      const t = D / speed;
      const h = Math.max(0.1, 0.35 + power * 1.25 + U.gauss() * (0.25 + power * 0.55 + pressure * 0.3) * (1.4 - fin));
      b.vx = dir.x * speed; b.vy = dir.y * speed;
      b.vz = h / t + (C.G * t) / 2;
      b.z = 0.05;
      this.stats.shots[this.idx(team)]++;
      this.release(p, 'shot', null);
    }

    // Standing tackles have a short visible wind-up before they resolve.
    startLunge(t, c, time) {
      t.lunge = time; t.lungeTarget = c;
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
        if (U.dist(p.x, p.y, c.x, c.y) > 1.9) { p.stun = 0.3; this.pop(p, 'MISS', '#cfd8d6'); continue; }
        this.resolveTackle(p, c, false);
      }
    }

    resolveTackle(t, c, slide) {
      const b = this.ball;
      if (b.owner !== c || this.state !== 'play') return;
      const toT = U.norm(t.x - c.x, t.y - c.y);
      const front = c.fx * toT.x + c.fy * toT.y; // 1 = tackler head-on, -1 = from behind
      const hold = (c.stats.dribbling + c.stats.strength) / 2;
      let ch = (slide ? 0.55 : 0.42) + front * 0.15 + (t.stats.tackling - hold) * 0.007;
      if (front < -0.3) ch *= 0.5;                 // carrier is shielding it
      if (this.time < b.protectUntil) ch *= 0.25;  // just received it
      ch = U.clamp(ch, 0.06, 0.85);
      const userLost = c.team.isUser, userWon = t.team.isUser;
      if (Math.random() < ch) {
        c.stun = 0.5; c.kickCd = 0.5;
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
        this.pop(c, 'HELD OFF', userWon ? '#e4572e' : '#a8e6a1');
      }
    }

    gainPossession(p) {
      const b = this.ball;
      b.owner = p; b.lastTouch = p;
      b.vx = b.vy = b.vz = 0; b.z = 0;
      b.protectUntil = this.time + 0.7;
      p.think = U.rand(0.3, 0.6); p.plan = null; p.gotBallAt = this.time;
      for (const q of this.players) q.receiving = null;
      if (p.team.isUser) this.controlled = p;
      else { this.controlled = this.bestDefender(p.x, p.y); this.lastAutoSwitch = this.time; }
    }

    // ---------- user input ----------

    switchPlayer() {
      const b = this.ball;
      const c = this.bestDefender(b.x, b.y, this.controlled);
      if (c) { if (this.controlled) this.controlled.userAuto = false; this.controlled = c; }
      this.manualUntil = this.time + 0.5;
    }

    findPassTarget(p, nx, ny, lofted) {
      let best = null, bs = -1e9;
      const pref = lofted ? 28 : 14;
      for (const q of p.team.players) {
        if (q === p || q.isDown()) continue;
        const dx = q.x + q.vx * 0.5 - p.x, dy = q.y + q.vy * 0.5 - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) continue;
        const cos = (dx * nx + dy * ny) / d;
        if (cos < 0.55) continue;
        let open = 1e9;
        for (const o of this.other(p.team).players) open = Math.min(open, U.dist(o.x, o.y, q.x, q.y));
        const s = cos * 3 - Math.abs(d - pref) / 25 + Math.min(open, 6) * 0.05 - (q.isGK ? 1 : 0);
        if (s > bs) { bs = s; best = q; }
      }
      return best;
    }

    userPass(p, ix, iy, lofted, power = 0.5) {
      const plan = this.passPlan(p, ix, iy, lofted, power);
      this.latch = this.time + 0.8;
      if (!lofted) {
        this.kickTo(p, plan.aimX, plan.aimY, false, 'pass', plan.target, null, plan.v0);
        const c = plan.target || this.nearestUser(plan.x, plan.y, null);
        if (c) { this.controlled = c; c.receiving = { t: this.time }; }
      } else if (plan.target) {
        this.passTo(p, plan.target, lofted, power);
        this.controlled = plan.target;
      } else {
        this.kickTo(p, plan.x, plan.y, lofted, 'pass', null, power);
        const c = this.nearestUser(plan.x, plan.y, null);
        if (c) { this.controlled = c; c.receiving = { t: this.time }; }
      }
    }

    tryTackle(p) {
      if (p.tackleCd > 0 || p.isDown()) return;
      p.tackleCd = 0.5;
      const c = this.ball.owner;
      if (!c || c.team === p.team || this.state !== 'play') return;
      const d = U.dist(p.x, p.y, c.x, c.y);
      if (d > 1.8) return;
      this.startLunge(p, c, 0.14);
    }

    trySlide(p) {
      if (p.isDown() || this.state !== 'play') return;
      p.slide = 0.5; p.slideHit = false;
      p.vx = p.fx * 8.5; p.vy = p.fy * 8.5;
    }

    handleUser(dt, I) {
      const p = this.controlled;
      if (!p || this.state === 'goal' || this.autoplay) return;
      const ax = I.axis();
      const active = !!(ax.x || ax.y);
      const sprint = I.down('sprint');
      const b = this.ball;
      const hasBall = b.owner === p;

      // After a pass the held direction belongs to the passer: ignore it for the receiver
      // until the stick is released (or a moment passes).
      if (this.latch && (!active || this.time > this.latch)) this.latch = 0;
      const steering = active && !this.latch;
      if (steering) p.receiving = null;
      p.userAuto = !!(p.receiving && !steering && !b.owner);

      if (!p.userAuto && !p.isDown() && p.lunge <= 0) {
        if (this.latch && !p.frozen) p.stop();
        else if (p.frozen) {
          if (active) { const n = U.norm(ax.x, ax.y); p.fx = n.x; p.fy = n.y; }
          p.stop();
        } else p.move(ax.x, ax.y, sprint);
      }

      if (hasBall) {
        // Hold a button to charge strength, release to play it. Tap = soft.
        const restart = this.state === 'restart';
        if (!this.charging) {
          const kind = I.hit('pass') ? 'pass' : I.hit('lob') ? 'lob' : I.hit('shoot') ? (restart ? 'lob' : 'shot') : null;
          if (kind) { this.charging = true; this.chargeKind = kind; this.charge = 0; this.chargeBtn = I.hit('shoot') ? 'shoot' : kind; }
        }
        this.preview = null;
        if (this.charging) {
          const fill = this.chargeKind === 'shot' ? 0.9 : 0.45;
          if (I.down(this.chargeBtn)) this.charge = Math.min(1, this.charge + dt / fill);
          if (this.chargeKind !== 'shot') this.preview = this.passPlan(p, ax.x, ax.y, this.chargeKind === 'lob', this.charge);
          if (I.released(this.chargeBtn) || !I.down(this.chargeBtn)) {
            const k = this.chargeKind, pw = this.charge;
            this.charging = false; this.charge = 0; this.chargeKind = null;
            if (k === 'shot') this.shoot(p, ax.y, pw);
            else this.userPass(p, ax.x, ax.y, k === 'lob', pw);
            return;
          }
        }
        if (restart && !this.charging && this.restart && this.restart.t > 7) PP.AI.restartKick(this, p, this.restart);
      } else {
        this.charging = false; this.charge = 0; this.chargeKind = null; this.preview = null;
        if (I.hit('pass')) this.switchPlayer();
        else if (I.hit('shoot')) this.tryTackle(p);
        else if (I.hit('lob')) this.trySlide(p);
        // Auto-poke: get close enough and your defender has a go on their own.
        const c = b.owner;
        if (c && c.team !== p.team && this.state === 'play' && p.lunge <= 0 && !p.isDown() &&
            p.tackleCd <= 0 && this.time > b.protectUntil && U.dist(p.x, p.y, c.x, c.y) < 1.4) {
          this.startLunge(p, c, 0.14);
          p.tackleCd = 0.9;
        }
      }
    }

    // When defending, hand control straight to the best-placed goal-side defender.
    autoSwitch() {
      const b = this.ball, c = this.controlled;
      const lk = b.lastKick;
      const defending = (b.owner && !b.owner.team.isUser) ||
        (!b.owner && lk && !lk.team.isUser && lk.type !== 'shot');
      if (!defending || this.autoplay || this.time < this.manualUntil || this.state !== 'play') return;
      if (c && (c.slide > 0 || c.lunge > 0)) return;
      if (this.time - (this.lastAutoSwitch || 0) < 0.25) return; // stop flicker between two equals
      const bx = b.x + b.vx * 0.25, by = b.y + b.vy * 0.25;
      const best = this.bestDefender(bx, by);
      if (!best || best === c) return;
      const cc = c && !c.isGK ? this.defendCost(c, bx, by) : 1e9;
      if (cc - this.defendCost(best, bx, by) > 1.0) {
        if (c) c.userAuto = false;
        this.controlled = best;
        this.lastAutoSwitch = this.time;
      }
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
        if (this.stateT <= 0) this.kickoff(this.goalConceder);
        return;
      }

      if (this.state === 'restart') this.restart.t += dt;
      if (this.controlled && this.controlled.isGK && this.ball.owner !== this.controlled) {
        this.controlled = this.nearestUser(this.ball.x, this.ball.y);
      }
      this.autoSwitch();
      this.handleUser(dt, I);
      PP.AI.update(this, dt);
      this.updateLunges(dt);
      for (const p of this.players) p.physics(dt);
      this.separate();
      this.updateBall(dt);
      if (this.state === 'play') {
        this.slideContacts();
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
          const tx = p.x + p.fx * 0.6, ty = p.y + p.fy * 0.6;
          const k = this.state === 'restart' ? 1 : Math.min(1, dt * 18);
          b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z = 0;
        }
        b.vx = p.vx; b.vy = p.vy; b.vz = 0;
      } else b.step(dt);
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

      let best = null, bd = 0.85;
      for (const p of this.players) {
        if (p.isDown() || p.kickCd > 0) continue;
        if (p.isGK && PP.AI.inBox(p.team, p.x, p.y, 0.5)) continue;
        if (b.z > 1.9 || (b.z > 0.4 && b.vz > 0)) continue; // can't control a rising ball
        const d = U.dist(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return;
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
      const reach = gk.dive > 0 ? 1.9 : 1.1;
      const d = U.dist(gk.x, gk.y, b.x, b.y);
      if (d > reach || b.z > 2.6) return false;
      const speed = Math.hypot(b.vx, b.vy);
      const lk = b.lastKick;
      const threat = lk && lk.team !== team && speed > 10;
      if (!threat) { this.gkHold(gk); return true; }

      let save = 0.92 - Math.max(0, speed - 20) * 0.025 - (d / reach) * 0.3 + (gk.stats.reflexes - 70) * 0.006;
      if (b.z > 2.0) save -= 0.15;
      save = U.clamp(save, 0.2, 0.97);
      if (lk.type === 'shot' && !lk.counted) { lk.counted = true; this.stats.onTarget[this.idx(lk.team)]++; }
      if (Math.random() < save) {
        const catchP = U.clamp(1.25 - speed / 22 + (gk.stats.handling - 70) * 0.01 - (gk.dive > 0 ? 0.2 : 0), 0.1, 0.9);
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
          b.owner = null; this.say('Post!', 1); return;
        }
        if (off < C.GOAL_W / 2 && Math.abs(b.z - C.GOAL_H) < 0.15) {
          b.x = side === 0 ? 0.05 : C.W - 0.05; b.vx = -b.vx * 0.5; b.vz = -Math.abs(b.vz) * 0.5;
          b.owner = null; this.say('Crossbar!', 1); return;
        }
        const attacking = this.teams.find((t) => t.attackX === side);
        const defending = this.other(attacking);
        if (off < C.GOAL_W / 2 && b.z < C.GOAL_H) { this.goalScored(attacking); return; }
        const lt = b.lastTouch;
        if (lt && lt.team === defending) {
          const taker = this.cornerTaker(attacking, b.y < C.H / 2 ? 0 : C.H);
          this.setRestart('corner', attacking, taker, side === 0 ? 0.4 : C.W - 0.4, b.y < C.H / 2 ? 0.4 : C.H - 0.4);
        } else {
          const by = C.H / 2 + (b.y < C.H / 2 ? -4 : 4);
          this.setRestart('goalkick', defending, defending.gk, defending.ownX + defending.dir * 5.5, by);
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
        this.setRestart('throw', team, taker, bx, by);
      }
    }

    cornerTaker(team, y) {
      const wide = team.outfield().slice().sort((a, b) =>
        Math.abs(a.y - y) + Math.abs(a.x - team.attackX) * 0.5 - (Math.abs(b.y - y) + Math.abs(b.x - team.attackX) * 0.5));
      return wide[0];
    }

    goalScored(team) {
      const i = this.idx(team);
      this.score[i]++;
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
        this.charging = false;
      }
    }

    startSecondHalf() {
      this.half = 2;
      this.clock = 45 * 60;
      this.kickoff(this.teams[1 - this.firstKickoff]);
    }
  }

  // Ground passes arrive firm: longer passes arrive faster.
  // User ground passes: tap = 6 m/s (a nudge, ~6m), full = 32 m/s (a rocket).
  Match.userGroundSpeed = (power) => 6 + U.clamp(power, 0, 1) * 26;
  Match.arrivalSpeed = (D) => U.clamp(5 + D * 0.15, 5, 10.5);

  PP.Match = Match;
})();
