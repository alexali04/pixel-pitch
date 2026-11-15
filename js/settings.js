// "Smoothness" controls: the assists that make the game feel good, each adjustable.
(function () {
  const DEFAULTS = {
    passAssist: 'light',   // off | light | strong : lean onto runs / towards goal, keep it in play
    aim: 'keys',           // keys | target | mouse | mouselock : keys / pick a team-mate / mouse pointer / locked mouse
    mouseSens: 'normal',   // slow | normal | fast : locked-mouse sensitivity
    aimSpeed: 'normal',    // slow | normal | fast : how quickly the keyboard aim turns
    autoTackle: true,      // defenders take the ball off attackers who run into them
    autoSprint: true,      // sprint automatically when defending near your goal
    defAssist: 'idle',     // off | idle | always : your defender positions/presses himself
    fwdDefend: 'help',     // help | high : (tactics) forwards drop back on defence or stay up for the counter
  };
  const S = (PP.settings = Object.assign({}, DEFAULTS));
  try { Object.assign(S, JSON.parse(localStorage.getItem('pp.smooth') || '{}')); } catch (e) { /* no storage */ }
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
    fwdDefend: [['help', 'Drop back and help'], ['high', 'Stay high for the counter']],
  };
  PP.SETTING_LABELS = {
    passAssist: 'Pass assist', aim: 'Aim with', aimSpeed: 'Key aim speed',
    mouseSens: 'Mouse sensitivity',
    autoTackle: 'Auto-tackle', autoSprint: 'Auto-sprint on defence', defAssist: 'Defending assist',
    fwdDefend: 'Forwards on defence',
  };
})();
