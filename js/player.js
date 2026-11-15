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
      this.frozen = false;
      this.receiving = null;
      this.userAuto = false;

      this.think = 0; this.plan = null;
      this.runUntil = 0;
      this._it = null;
    }

    get hasBall() { return this.team.match.ball.owner === this; }

    topSpeed(sprint) {
      let v = 5.2 + this.stats.pace * 0.018;
      if (sprint) v *= 1.28;
      if (this.hasBall) v *= 0.9;
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

      if (this.slide > 0 || this.dive > 0) {
        const f = Math.exp(-(this.dive > 0 ? 1.5 : 2.6) * dt);
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

      const acc = 10 + this.stats.acceleration * 0.08;
      let ax = this.dvx - this.vx, ay = this.dvy - this.vy;
      const l = Math.hypot(ax, ay), m = acc * dt;
      if (l > m) { ax *= m / l; ay *= m / l; }
      this.vx += ax; this.vy += ay;
      this.x += this.vx * dt; this.y += this.vy * dt;

      const s = Math.hypot(this.vx, this.vy);
      if (s > 0.4) { this.fx = this.vx / s; this.fy = this.vy / s; }
      this.anim += s * dt * 1.6;
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
