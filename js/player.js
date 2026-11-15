(function () {
  const C = PP.C, U = PP.U;

  class Player {
    constructor(team, slot, idx, info) {
      this.team = team;
      this.slot = slot;            // { role, d, l } — formation depth/lateral in [0,1]
      this.idx = idx;
      this.role = slot.role;
      this.isGK = slot.role === 'GK';
      this.name = info.name;
      this.num = info.num;
      this.stats = info.stats;
      this.look = info.look;
      this.foot = info.foot || 'R';
      this.trait = info.trait || null;
      this.energy = 1;                     // stamina left this match (sprinting drains it)

      this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
      this.fx = team.dir; this.fy = 0;      // facing unit vector
      this.dvx = 0; this.dvy = 0;           // desired velocity
      this.sprint = false;
      this.anim = 0;

      this.kickCd = 0;    // can't touch the ball again yet
      this.tackleCd = 0;
      this.stun = 0;      // on the floor / recovering
      this.slide = 0;     // slide-tackle time left
      this.dive = 0;      // keeper dive time left
      this.lunge = 0;     // standing-tackle wind-up time left
      this.lungeTarget = null;
      this.shielding = null; // opponent the carrier is holding off
      this.frozen = false;
      this.receiving = null;
      this.userAuto = false;

      this.think = 0; this.plan = null;
      this.runUntil = 0;
      this._it = null;
    }

    get hasBall() { return this.team.match.ball.owner === this; }

    topSpeed(sprint) {
      // Pace spreads players out: pace 65 ~5.2 m/s jog / 6.8 sprint, pace 88 ~6.1 / 7.9.
      let v = 2.3 + this.stats.pace * 0.036;   // pace 75 ~5.0 m/s jog / 6.5 sprint
      if (sprint) v *= 1.3;
      v *= 0.86 + 0.14 * this.energy;           // tired legs
      if (this.hasBall) v *= sprint ? 0.86 : 0.92;
      if (this.isGK && this.hasBall) v *= 0.75;
      return v;
    }

    steer(tx, ty, sprint, arrive = 2) {
      const dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.2) { this.dvx = 0; this.dvy = 0; return; }
      let sp = this.topSpeed(sprint);
      if (d < arrive) sp *= d / arrive;
      this.dvx = (dx / d) * sp; this.dvy = (dy / d) * sp;
    }

    move(ix, iy, sprint) {
      const l = Math.hypot(ix, iy);
      if (l < 0.01) { this.dvx = 0; this.dvy = 0; return; }
      const sp = this.topSpeed(sprint);
      this.dvx = (ix / l) * sp; this.dvy = (iy / l) * sp;
    }

    stop() { this.dvx = 0; this.dvy = 0; }

    face(x, y) {
      const n = U.norm(x - this.x, y - this.y);
      if (n.x || n.y) { this.fx = n.x; this.fy = n.y; }
    }

    physics(dt) {
      this.kickCd = Math.max(0, this.kickCd - dt);
      this.tackleCd = Math.max(0, this.tackleCd - dt);
      if (this.kickAnim > 0) this.kickAnim -= dt;
      if (this.jump > 0) this.jump -= dt;

      if (this.slide > 0 || this.dive > 0) {
        // A dive keeps its speed until the moment it was timed to meet the ball, then dies.
        let k = 2.6;
        if (this.dive > 0) { this.diveHold = (this.diveHold || 0) - dt; k = this.diveHold > 0 ? 0 : 7; }
        const f = Math.exp(-k * dt);
        this.vx *= f; this.vy *= f;
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (this.slide > 0) { this.slide -= dt; if (this.slide <= 0) { this.slide = 0; this.stun = 0.45; } }
        if (this.dive > 0) { this.dive -= dt; if (this.dive <= 0) { this.dive = 0; this.stun = 0.5; } }
        this.clampToWorld();
        return;
      }
      if (this.stun > 0) {
        this.stun -= dt;
        this.vx *= 0.85; this.vy *= 0.85;
        this.x += this.vx * dt; this.y += this.vy * dt;
        return;
      }
      if (this.frozen) { this.vx = 0; this.vy = 0; return; }
      if (this.lunge > 0 && this.lungeTarget) {
        // Tackle lunge: snap straight at the ball carrier's feet.
        const t = this.lungeTarget;
        const n = U.norm(t.x + t.vx * this.lunge - this.x, t.y + t.vy * this.lunge - this.y); // lead the carrier
        const sp = this.lungeSpeed || 6.5;
        this.vx = n.x * sp; this.vy = n.y * sp; this.dvx = this.vx; this.dvy = this.vy;
        this.fx = n.x; this.fy = n.y;
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.anim += sp * dt * 1.6;
        this.clampToWorld();
        return;
      }

      const acc = 7 + this.stats.acceleration * 0.12;
      // Stamina: sprinting drains it, jogging/standing recovers it; fitter players last longer.
      const spd = Math.hypot(this.vx, this.vy), jog = 2.3 + this.stats.pace * 0.036;
      if (spd > jog * 1.05) this.energy = Math.max(0, this.energy - dt * 0.05 * (1.5 - this.stats.stamina / 100));
      else this.energy = Math.min(1, this.energy + dt * 0.02 * (0.5 + this.stats.stamina / 100));
      let ax = this.dvx - this.vx, ay = this.dvy - this.vy;
      const l = Math.hypot(ax, ay), m = acc * dt;
      if (l > m) { ax *= m / l; ay *= m / l; }
      this.vx += ax; this.vy += ay;
      this.x += this.vx * dt; this.y += this.vy * dt;

      const s = Math.hypot(this.vx, this.vy);
      if (s > 0.4) { this.fx = this.vx / s; this.fy = this.vy / s; }
      this.anim += s * dt * 1.25;
      this.clampToWorld();
    }

    clampToWorld() {
      this.x = U.clamp(this.x, -3, C.W + 3);
      this.y = U.clamp(this.y, -2.5, C.H + 2.5);
    }

    isDown() { return this.stun > 0 || this.slide > 0 || this.dive > 0; }
  }

  PP.Player = Player;
})();
