// Global namespace and constants. Units are metres and seconds.
window.PP = window.PP || {};
PP.VERSION = 'alpha v0.2-dev';

PP.C = {
  W: 105, H: 50,                 // pitch length (x) and width (y); narrower than real for more direct play
  GOAL_W: 7.32, GOAL_H: 2.44, GOAL_D: 2.0,
  BOX_D: 16.5, BOX_W: 32,
  SIX_D: 5.5, SIX_W: 15,
  CIRCLE_R: 8, SPOT: 11,

  // Tilted camera: different pixel scales across (x), down (y) and for height (z).
  PX: 8.5, PY: 4.9, PZ: 7.1,     // set by the camera setting (settings.js): wide = ~66m across, full width down
  VIEW_W: 560, VIEW_H: 315,      // internal low-res canvas
  MARGIN: 24,                    // metres of stadium drawn around the pitch (room for the camera over the far touchline)

  G: 9.8,
  ROLL_C: 1.6,                   // rolling resistance: dv/dt = -(ROLL_C + ROLL_K * v)
  ROLL_K: 0.45,                  // fast balls bleed speed quickly, slow ones roll on
  AIR_K: 0.22,                   // exponential air drag per second (long balls die)

  HALF_SECONDS: 180,             // real seconds per half
  DT: 1 / 120,                   // physics/input rate (matches 120 Hz displays; cheap)
};
PP.C.GOAL_Y1 = PP.C.H / 2 - PP.C.GOAL_W / 2;
PP.C.GOAL_Y2 = PP.C.H / 2 + PP.C.GOAL_W / 2;
