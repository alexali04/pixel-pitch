// "Smoothness" controls: the assists that make the game feel good, each adjustable.
(function () {
  const DEFAULTS = {
    passAssist: 'light',   // off | light | strong : lean onto runs / towards goal, keep it in play
    aim: 'mouse',          // keys | target | mouse | mouselock : keys / pick a team-mate / mouse pointer / locked mouse
    mouseSens: 'normal',   // slow | normal | fast : locked-mouse sensitivity
    aimSpeed: 'normal',    // slow | normal | fast : how quickly the keyboard aim turns
    autoTackle: true,      // defenders take the ball off attackers who run into them
    autoSprint: true,      // sprint automatically when defending near your goal
    defAssist: 'idle',     // off | idle | always : your defender positions/presses himself
    camera: 'close',       // close | wide : zoomed in (box big next to the players) / the old wide view
  };
  const S = (PP.settings = Object.assign({}, DEFAULTS));
  try { Object.assign(S, JSON.parse(localStorage.getItem('pp.smooth') || '{}')); } catch (e) { /* no storage */ }
  // Camera zoom: pixels per metre across (x), down (y) and for height (z). The sprites stay the
  // same size, so zooming in makes the pitch (and the box) bigger next to the players. Read by
  // the renderer when it loads, so a change needs a reload.
  const ZOOM = { close: { PX: 10, PY: 6.4, PZ: 8.35 }, wide: { PX: 8.5, PY: 4.9, PZ: 7.1 } };
  Object.assign(PP.C, ZOOM[S.camera] || ZOOM.close);
  PP.saveSettings = () => {
    try { localStorage.setItem('pp.smooth', JSON.stringify(S)); } catch (e) { /* no storage */ }
  };
  // Option lists for the menu (value, label).
  PP.SETTING_OPTIONS = {
    passAssist: [['off', 'Off'], ['light', 'Light'], ['strong', 'Strong']],
    aim: [['keys', 'Free aim (keys)'], ['target', 'Team-mate targeting'], ['mouse', 'Mouse pointer'], ['mouselock', 'Mouse (locked)']],
    mouseSens: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']],

    aimSpeed: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']],
    autoTackle: [[true, 'On'], [false, 'Off']],
    autoSprint: [[true, 'On'], [false, 'Off']],
    defAssist: [['idle', 'When idle'], ['always', 'Always (you nudge)'], ['off', 'Off']],
    camera: [['close', 'Close'], ['wide', 'Wide (classic)']],
  };
  PP.SETTING_LABELS = {
    passAssist: 'Pass assist', aim: 'Aim with', aimSpeed: 'Key aim speed',
    mouseSens: 'Mouse sensitivity',
    autoTackle: 'Auto-tackle', autoSprint: 'Auto-sprint on defence', defAssist: 'Defending assist',
    camera: 'Camera',
  };
})();
