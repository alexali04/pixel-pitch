// Practice drills on the real match engine: shooting, passing (a rondo) and dribbling.
// The match runs with only the players a drill needs (the rest are stood down and hidden),
// no clock, and each rep resets itself. The scoreboard shows how you're doing.
(function () {
  const C = PP.C, U = PP.U;
  const NAMES = { shooting: 'Shooting', passing: 'Passing', dribbling: 'Dribbling' };

  PP.Drill = class {
    constructor(m, kind) {
      this.m = m; this.kind = kind;
      this.u = m.home; this.o = m.away;             // you attack towards u.attackX
      this.good = 0; this.reps = 0; this.streak = 0; this.best = 0; this.level = 1;
      this.cast();
      this.reset();
      m.say(`${NAMES[kind]} practice`, 2);
    }

    // Pick the players the drill uses; stand the rest down.
    cast() {
      const u = this.u, o = this.o, by = (k) => (a, c) => c.stats[k] - a.stats[k];
      const uo = u.outfield().slice(), oo = o.outfield().slice();
      const keep = new Set([u.players.find((p) => p.isGK), o.players.find((p) => p.isGK)]);
      if (this.kind === 'shooting') {
        this.you = uo.sort(by('finishing'))[0];
        this.feeder = uo.filter((p) => p !== this.you).sort((a, c) => c.stats.shortPass + c.stats.crossing - a.stats.shortPass - a.stats.crossing)[0];
        keep.add(this.you); keep.add(this.feeder);
      } else if (this.kind === 'passing') {
        this.ring = uo.sort(by('shortPass')).slice(0, 5);
        this.you = this.ring[0];
        this.defs = oo.sort(by('tackling')).slice(0, 2);
        [...this.ring, ...this.defs].forEach((p) => keep.add(p));
      } else {
        this.you = uo.sort(by('dribbling'))[0];
        this.defs = oo.sort(by('tackling')).slice(0, 3);
        [this.you, ...this.defs].forEach((p) => keep.add(p));
      }
      for (const p of this.m.players) if (!keep.has(p)) { p.sentOff = true; p.x = -40; p.y = -40; }
    }

    put(p, d, l) {
      const w = this.u.toWorld(d, l);
      p.x = w.x; p.y = w.y; p.ox = p.x; p.oy = p.y; p.vx = p.vy = 0; p.fx = this.u.dir; p.fy = 0;
    }
    // Ball at his feet and under control.
    give(p) {
      const m = this.m;
      m.ball.reset(p.x + p.fx * 0.4, p.y);
      m.gainPossession(p);
      p.settleUntil = 0; m.ball.protectUntil = m.time + 0.6;
    }
    // Ball at a feeder's feet: he just stands on it until the drill plays it.
    hold(p) {
      const b = this.m.ball;
      b.reset(p.x + p.fx * 0.4, p.y);
      b.owner = p; b.lastTouch = p; p.think = 99; p.plan = { kind: 'dribble', x: p.x, y: p.y, sprint: false };
    }

    reset() {
      const m = this.m;
      for (const p of m.players) {
        if (p.sentOff) continue;
        p.vx = p.vy = 0; p.stun = p.slide = p.dive = p.lunge = 0; p.receiving = null; p.plan = null;
        p.frozen = false; p.kickCd = 0; p.tackleCd = 0.8; p.wallSpot = null; p.energy = 1; p.tgx = null;
      }
      m.state = 'play'; m.restart = null; m.charging = false; m.charge = 0; m.chargeKind = null; m.preview = null;
      m.restartWall = null; m.popups = []; m.camSnap = true; m.touchAim = null;
      this.t0 = m.time; this.endAt = null; this.shotAt = null; this.feedAt = null; this.prevOwner = null;
      const gk = this.o.players.find((p) => p.isGK);
      this.put(gk, 0.995, 0.5); gk.fx = -this.u.dir;
      const ugk = this.u.players.find((p) => p.isGK);
      this.put(ugk, 0.01, 0.5);
      this['reset_' + this.kind]();
      m.controlled = this.kind === 'passing' ? m.ball.owner : this.you;
      this.hud();
    }

    reset_shooting() {
      const you = this.you, f = this.feeder, r = Math.random();
      this.type = r < 0.45 ? 'feet' : r < 0.75 ? 'layoff' : 'cross';
      if (this.type === 'feet') {
        this.put(you, 1 - U.rand(16, 30) / C.W, U.rand(0.25, 0.75));
        this.put(f, 0.6, 0.5);
        this.give(you);
      } else if (this.type === 'layoff') {
        const l = U.rand(0.35, 0.65);
        this.put(you, 1 - U.rand(22, 28) / C.W, l);
        this.put(f, 1 - U.rand(36, 42) / C.W, U.clamp(l + U.rand(-0.25, 0.25), 0.15, 0.85));
        this.hold(f); this.feedAt = this.m.time + 0.9;
      } else {
        const side = Math.random() < 0.5 ? 0.07 : 0.93;
        this.put(f, 1 - U.rand(6, 15) / C.W, side);
        this.put(you, 1 - U.rand(18, 24) / C.W, 0.5 + (side < 0.5 ? 0.1 : -0.1));
        this.hold(f); this.feedAt = this.m.time + 1.3;
      }
    }

    // Five round a 20m circle in our half, two in the middle.
    reset_passing() {
      const c = this.u.toWorld(0.4, 0.5), R = 10;
      this.centre = c; this.spots = [];
      this.ring.forEach((p, i) => {
        const a = (i / this.ring.length) * Math.PI * 2 + Math.PI;
        const s = { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R };
        this.spots.push(s); p.x = s.x; p.y = s.y; p.vx = p.vy = 0; p.face(c.x, c.y);
      });
      this.defs.forEach((p, i) => { p.x = c.x + (i ? 1.5 : -1.5); p.y = c.y + (i ? 1 : -1); p.vx = p.vy = 0; });
      this.give(this.ring[0]);
      this.streak = 0;
    }

    // From halfway, past 1-3 defenders and into the box.
    reset_dribbling() {
      this.put(this.you, 0.5, U.rand(0.38, 0.62));
      const l0 = this.you.y / C.H;
      this.defs.forEach((p, i) => {
        p.sentOff = i >= this.level;
        if (p.sentOff) { p.x = -40; p.y = -40; return; }
        const spot = [[16, 0], [24, -0.18], [24, 0.18]][i];
        this.put(p, 0.5 + spot[0] / C.W, U.clamp(l0 + spot[1], 0.2, 0.8)); p.fx = -this.u.dir;
      });
      this.give(this.you);
    }

    // The scoreboard: what counts in this drill.
    hud() {
      const m = this.m;
      if (this.kind === 'shooting') m.hud = { score: `${this.good} / ${this.reps}`, clock: 'GOALS' };
      else if (this.kind === 'passing') m.hud = { score: `${this.streak}`, clock: `BEST ${this.best}` };
      else m.hud = { score: `${this.good} / ${this.reps}`, clock: `LVL ${this.level}` };
    }

    // End the rep: good or not, a word on it, and the next one shortly.
    end(good, text, wait = 1.0) {
      if (this.endAt != null) return;
      const m = this.m;
      this.reps++; if (good) this.good++;
      if (this.kind === 'dribbling' && good && this.good % 3 === 0) { this.level = Math.min(3, this.level + 1); text += ` · level ${this.level}`; }
      m.say(text, wait + 0.2);
      this.endAt = m.time + wait;
      this.hud();
    }

    step() {
      const m = this.m, b = m.ball;
      if (this.endAt != null) { if (m.time >= this.endAt) this.reset(); return; }
      const t = m.time - this.t0;
      if (this.kind === 'shooting') {
        if (this.feedAt != null && m.time >= this.feedAt) {
          this.feedAt = null;
          if (b.owner === this.feeder) { m.passTo(this.feeder, this.you, this.type === 'cross'); this.feeder.think = 99; m.controlled = this.you; }
        }
        const lk = b.lastKick;
        if (!this.shotAt && lk && lk.type === 'shot' && lk.by === this.you) this.shotAt = m.time;
        if (m.state === 'goal') this.end(true, 'GOAL!', 1.3);
        else if (m.state === 'restart') this.end(false, m.restart.kind === 'gk' ? 'Saved' : 'Missed');
        else if (this.shotAt && m.time - this.shotAt > 3.5) this.end(false, 'Saved');
        else if (b.owner && b.owner.team === this.o) this.end(false, 'Saved');
        else if (t > 12) this.end(false, 'Too slow');
      } else if (this.kind === 'passing') {
        const o = b.owner;
        if (o && o !== this.prevOwner) {
          if (o.team === this.u && this.prevOwner && this.prevOwner.team === this.u) {
            this.streak++; this.best = Math.max(this.best, this.streak); this.hud();
          }
          this.prevOwner = o;
        }
        if (o && o.team === this.o) { this.end(false, `Intercepted · ${this.streak} passes`); }
        else if (m.state !== 'play' || U.dist(b.x, b.y, this.centre.x, this.centre.y) > 19) { this.end(false, `Lost it · ${this.streak} passes`); }
      } else {
        const lk = b.lastKick;
        const ours = b.owner === this.you || (!b.owner && lk && lk.by === this.you && lk.type === 'touch' && m.time - lk.t < 0.8);
        if (m.state === 'goal') this.end(true, 'GOAL!', 1.3);
        else if (ours && PP.AI.inBox(this.o, b.x, b.y, 0)) this.end(true, 'Through!');
        else if (m.state === 'restart') this.end(false, m.restart.kind === 'freekick' ? 'Fouled' : 'Lost it');
        else if (b.owner && b.owner.team === this.o) this.end(false, 'Tackled');
        else if (t > 15) this.end(false, 'Too slow');
      }
    }

    // Runs after the AI each step: the drill's own movement for the players it uses.
    control() {
      const m = this.m, b = m.ball, AI = PP.AI;
      if (m.state !== 'play') return;
      if (this.kind === 'shooting') {
        if (this.feeder && b.owner === this.feeder) this.feeder.stop();
        else if (this.feeder) this.feeder.steer(this.feeder.x, this.feeder.y, false, 0.5);
        return;
      }
      const o = b.owner, lk = b.lastKick;
      const loose = !o && !(lk && lk.type === 'touch' && lk.team === this.u && m.time - lk.t < 0.8);
      const carrier = o || (lk && lk.by) || this.you;
      if (this.kind === 'passing') {
        // Team-mates hold their spot on the circle and face the ball (unless running onto a pass).
        this.ring.forEach((p, i) => {
          if (p === o || p === m.controlled || p.receiving) return;
          const s = this.spots[i];
          p.steer(s.x, s.y, U.dist(p.x, p.y, s.x, s.y) > 4, 1);
          if (U.dist(p.x, p.y, s.x, s.y) < 1.5) p.face(b.x, b.y);
        });
      }
      // Defenders: the nearest presses the ball, the second cuts the likeliest pass (or covers
      // goal-side in the dribbling drill), a third sits deeper in cover. A loose ball they can
      // reach, they go for.
      const ds = this.defs.filter((p) => !p.sentOff && !p.isDown() && p.lunge <= 0)
        .sort((a, c) => U.dist(a.x, a.y, b.x, b.y) - U.dist(c.x, c.y, b.x, b.y));
      ds.forEach((d, i) => {
        if (loose) {
          const it = AI.interceptTime(m, d);
          if (it.t < 2.5) { d.steer(it.x, it.y, true, 0.3); return; }
        }
        if (i === 0) { if (o && o.team === this.u) AI.press(m, d, o, false); else d.steer(b.x, b.y, true, 0.5); return; }
        if (this.kind === 'passing') {
          const mates = this.ring.filter((q) => q !== carrier).sort((a, c) => U.dist(a.x, a.y, carrier.x, carrier.y) - U.dist(c.x, c.y, carrier.x, carrier.y));
          const q = mates[0];
          if (q) { const tx = carrier.x + (q.x - carrier.x) * 0.45, ty = carrier.y + (q.y - carrier.y) * 0.45; d.steer(tx, ty, U.dist(d.x, d.y, tx, ty) > 3, 0.6); d.face(b.x, b.y); }
          return;
        }
        // Dribbling: cover goal-side of the carrier, deeper for the third man.
        const g = this.o.ownX, k = i === 1 ? 0.25 : 0.45;
        const tx = carrier.x + (g - carrier.x) * k, ty = carrier.y + (C.H / 2 - carrier.y) * k * 0.6;
        d.steer(tx, ty, U.dist(d.x, d.y, tx, ty) > 3, 0.6); d.face(b.x, b.y);
      });
    }
  };
})();
