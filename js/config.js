// Global namespace and constants. Units are metres and seconds.
window.PP = window.PP || {};

PP.C = {
  W: 105, H: 50,                 // pitch length (x) and width (y); narrower than real for more direct play
  GOAL_W: 7.32, GOAL_H: 2.44, GOAL_D: 2.0,
  BOX_D: 16.5, BOX_W: 32,
  SIX_D: 5.5, SIX_W: 15,
  CIRCLE_R: 8, SPOT: 11,

  // Tilted camera: different pixel scales across (x), down (y) and for height (z).
  PX: 9, PY: 5.2, PZ: 7.5,       // ~62m of pitch visible across, full width visible down
  VIEW_W: 560, VIEW_H: 315,      // internal low-res canvas
  MARGIN: 12,                    // metres of stadium drawn around the pitch

  G: 9.8,
  ROLL_C: 1.6,                   // rolling resistance: dv/dt = -(ROLL_C + ROLL_K * v)
  ROLL_K: 0.3,
  AIR_K: 0.1,                    // exponential air drag per second

  HALF_SECONDS: 180,             // real seconds per half
  DT: 1 / 60,
};
PP.C.GOAL_Y1 = PP.C.H / 2 - PP.C.GOAL_W / 2;
PP.C.GOAL_Y2 = PP.C.H / 2 + PP.C.GOAL_W / 2;
