(function () {
  const C = PP.C;

  class Ball {
    constructor() { this.reset(C.W / 2, C.H / 2); }

    reset(x, y) {
      this.x = x; this.y = y; this.z = 0;
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.px = x; this.py = y; this.pz = 0;
      this.curve = 0;
      this.back = 0;   // backspin (0..1): lift and extra drag in the air, checks up on landing
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
      const b = { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz, curve: this.curve || 0, back: this.back || 0 };
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
        const bk = Ball.airStep(b, dt);
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -1.5) {
            // A low skim skids on; a dropping ball checks up, more so with backspin.
            const keep = b.vz > -3.5 ? 0.9 : 0.62 - 0.3 * bk;
            b.vz = -b.vz * (0.4 - 0.12 * bk); b.vx *= keep; b.vy *= keep;
          }
          else b.vz = 0;
          b.back = 0;
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

  // One step in the air. Backspin gives lift that grows with speed (so a floated ball climbs,
  // hangs, then drops steeply as it slows) plus extra drag. Returns the spin before the step.
  Ball.LIFT = 0.3; Ball.SPIN_DRAG = 0.6; Ball.SPIN_DECAY = 0.3;
  Ball.airStep = (b, dt) => {
    const bk = b.back || 0;
    if (bk) {
      b.vz += Ball.LIFT * bk * Math.hypot(b.vx, b.vy) * dt;
      b.back = bk * Math.exp(-Ball.SPIN_DECAY * dt);
    }
    b.vz -= C.G * dt;
    const f = Math.exp(-(C.AIR_K + Ball.SPIN_DRAG * bk) * dt);
    b.vx *= f; b.vy *= f;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    return bk;
  };

  // Launch for a ball in the air with backspin `back` to be D metres away, at height h, after
  // T seconds: horizontal speed s and vertical speed vz (shooting method on the real physics).
  Ball.loftLaunch = (D, T, back = 0, h = 0) => {
    let s = (D * C.AIR_K) / (1 - Math.exp(-C.AIR_K * T)), vz = (h + 0.5 * C.G * T * T) / T;
    const dt = 1 / 60, n = Math.max(1, Math.round(T / dt));
    for (let it = 0; it < 8; it++) {
      const b = { x: 0, y: 0, z: 0, vx: s, vy: 0, vz, back };
      for (let i = 0; i < n; i++) Ball.airStep(b, dt);
      s *= D / Math.max(0.1, b.x);
      vz += (h - b.z) / T * 0.9;
    }
    return { s, vz };
  };

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
