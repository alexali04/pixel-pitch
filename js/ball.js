(function () {
  const C = PP.C;

  class Ball {
    constructor() { this.reset(C.W / 2, C.H / 2); }

    reset(x, y) {
      this.x = x; this.y = y; this.z = 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.px = x; this.py = y; this.pz = 0;
      this.curve = 0;
      this.owner = null;
      this.lastTouch = null;
      this.lastKick = null;
      this.protectUntil = 0;
    }

    get speed() { return Math.hypot(this.vx, this.vy); }

    step(dt) {
      this.px = this.x; this.py = this.y; this.pz = this.z;
      Ball.integrate(this, dt);
    }

    // Future positions of the loose ball, n samples spaced dt apart.
    predict(n, dt) {
      const b = { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, curve: this.curve || 0 };
      const out = [];
      for (let i = 0; i < n; i++) {
        Ball.integrate(b, dt);
        out.push({ x: b.x, y: b.y, z: b.z });
      }
      return out;
    }

    static integrate(b, dt) {
      // Spin: sideways acceleration (to the left of travel for positive curve), weaker on the ground.
      if (b.curve) {
        const s = Math.hypot(b.vx, b.vy);
        if (s > 0.5) {
          const a = b.curve * (b.z > 0.05 ? 1 : 0.5) * dt, vx = b.vx, vy = b.vy;
          b.vx += (vy / s) * a; b.vy -= (vx / s) * a;
        }
        b.curve *= Math.exp(-0.5 * dt);
      }
      if (b.z > 0.001 || b.vz > 0.001) {
        b.vz -= C.G * dt;
        const f = Math.exp(-C.AIR_K * dt);
        b.vx *= f; b.vy *= f;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -1.5) {
            const keep = b.vz > -3.5 ? 0.9 : 0.62; // a low skim skids on, a dropping ball checks up
            b.vz = -b.vz * 0.4; b.vx *= keep; b.vy *= keep;
          }
          else b.vz = 0;
        }
      } else {
        b.z = 0; b.vz = 0;
        const s = Math.hypot(b.vx, b.vy);
        if (s > 0) {
          const ns = Math.max(0, s - (C.ROLL_C + C.ROLL_K * s) * dt);
          const f = ns / s;
          b.vx *= f; b.vy *= f;
        }
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
    }
  }

  // Rolling ball from speed v0 slowing to v1: distance covered and time taken.
  Ball.groundRun = (v0, v1) => {
    const a = C.ROLL_C / C.ROLL_K;
    const t = Math.log((v0 + a) / (v1 + a)) / C.ROLL_K;
    return { d: (v0 - v1) / C.ROLL_K - a * t, t };
  };
  // Launch speed so a rolling ball arrives D metres away at speed v1.
  Ball.groundSpeedFor = (D, v1) => {
    let lo = v1, hi = 45;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (Ball.groundRun(m, v1).d < D) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  // Time for a ball rolled at v0 to cover D metres, or null if it stops short.
  Ball.rollTime = (v0, D) => {
    if (Ball.groundRun(v0, 0).d < D) return null;
    let lo = 0, hi = v0;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (Ball.groundRun(v0, m).d > D) lo = m; else hi = m;
    }
    return Ball.groundRun(v0, (lo + hi) / 2).t;
  };
  Ball.rollDist = (v0) => Ball.groundRun(v0, 0).d;
  Ball.groundTime = (D, v1) => Ball.groundRun(Ball.groundSpeedFor(D, v1), v1).t;
  Ball.loftTime = (D) => 0.8 + D / 24;

  PP.Ball = Ball;
})();
