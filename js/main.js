(function () {
  const C = PP.C, I = PP.Input;
  const cv = document.getElementById('game');
  const wrap = document.getElementById('wrap');
  const hud = document.getElementById('hud');
  const overlay = document.getElementById('overlay');
  const $ = (id) => document.getElementById(id);
  const R = new PP.Renderer(cv);
  I.init();

  let match = null;
  const settings = { fullCourt: false };
  try { settings.fullCourt = localStorage.getItem('pp.fullCourt') === '1'; } catch (e) { /* no storage */ }
  function setFullCourt(v) {
    settings.fullCourt = v;
    try { localStorage.setItem('pp.fullCourt', v ? '1' : '0'); } catch (e) { /* no storage */ }
  }
  let screen = 'title';   // title | match | paused | halftime | fulltime
  let lastHud = '';

  function fit() {
    const s = Math.max(1, Math.min(innerWidth / C.VIEW_W, innerHeight / C.VIEW_H));
    wrap.style.width = C.VIEW_W * s + 'px';
    wrap.style.height = C.VIEW_H * s + 'px';
    wrap.style.setProperty('--s', ((s * C.VIEW_W) / 512).toFixed(3)); // HUD sized as at 512px
  }
  addEventListener('resize', fit);
  fit();

  const CONTROLS = `
    <div class="controls">
      <span class="h">Move</span><span><kbd>WASD</kbd> / <kbd>Arrows</kbd></span><span><kbd>Shift</kbd> sprint</span>
      <span class="h">Attack</span><span><kbd>J</kbd> pass &nbsp;<kbd>K</kbd> lofted</span><span><kbd>Space</kbd> shoot</span>
      <span class="h">Strength</span><span>hold the button</span><span>tap = soft, hold = bullet</span>
      <span class="h">Defend</span><span><kbd>J</kbd> switch &nbsp;<kbd>K</kbd> slide</span><span><kbd>Space</kbd> tackle</span>
      <span class="h">Game</span><span><kbd>P</kbd> pause &nbsp;<kbd>R</kbd> restart</span><span>aim with direction keys</span>
    </div>`;

  function show(html, onClick) {
    overlay.innerHTML = `<div class="card">${html}</div>`;
    overlay.hidden = false;
    const btn = overlay.querySelector('.btn');
    if (btn && onClick) btn.addEventListener('click', onClick);
  }
  function hide() { overlay.hidden = true; }

  function titleScreen() {
    screen = 'title';
    match = null;
    hud.hidden = true;
    const [h, a] = PP.TEAM_DEFS;
    PP.ensureSquad(h); PP.ensureSquad(a);
    const rh = PP.teamRatings(h), ra = PP.teamRatings(a);
    const st = (n) => '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '');
    show(`<h1>PIXEL PITCH</h1>
      <table class="stats ratings">
        <tr><td style="color:${h.kit.shirt}">${h.name}</td><td></td><td style="color:${a.kit.shirt}">${a.name}</td></tr>
        <tr><td>${st(rh.att)}</td><td>Attack</td><td>${st(ra.att)}</td></tr>
        <tr><td>${st(rh.mid)}</td><td>Midfield</td><td>${st(ra.mid)}</td></tr>
        <tr><td>${st(rh.def)}</td><td>Defence</td><td>${st(ra.def)}</td></tr>
      </table>
      <p>You attack right to left.</p>
      <p><button class="btn toggle" id="fcBtn">Full court: ${settings.fullCourt ? 'ON' : 'OFF'} (F)</button></p>
      <p class="hint">${settings.fullCourt ? 'Continuous 11v11: you defend too.' : 'You play your attacks; the CPU\'s attacks are resolved offscreen.'}</p>
      ${CONTROLS}
      <button class="btn" id="koBtn">Kick off (Enter)</button>`);
    $('fcBtn').addEventListener('click', () => { setFullCourt(!settings.fullCourt); titleScreen(); });
    $('koBtn').addEventListener('click', startMatch);
  }

  function startMatch() {
    const [h, a] = PP.TEAM_DEFS;
    match = new PP.Match(h, a, { fullCourt: settings.fullCourt });
    PP.match = match; // handy for debugging in the console
    $('homeName').textContent = h.short;
    $('awayName').textContent = a.short;
    $('homeSwatch').style.background = h.kit.shirt;
    $('awaySwatch').style.background = a.kit.shirt;
    hud.hidden = false;
    hide();
    screen = 'match';
  }

  function statsTable(m) {
    const tot = m.stats.poss[0] + m.stats.poss[1] || 1;
    const pc = (i) => Math.round((100 * m.stats.poss[i]) / tot);
    const goals = m.events.filter((e) => e.type === 'goal')
      .map((e) => `${e.minute}' ${e.scorer}${e.og ? ' (og)' : ''} — ${e.team === 0 ? m.home.short : m.away.short}`).join('<br>');
    return `<table class="stats">
      <tr><td>${m.stats.shots[0]}</td><td>Shots</td><td>${m.stats.shots[1]}</td></tr>
      <tr><td>${m.stats.onTarget[0]}</td><td>On target</td><td>${m.stats.onTarget[1]}</td></tr>
      <tr><td>${pc(0)}%</td><td>Possession</td><td>${pc(1)}%</td></tr>
    </table>${goals ? `<p>${goals}</p>` : ''}`;
  }

  function halftime() {
    screen = 'halftime';
    show(`<h2>Half time</h2><p class="big">${match.home.short} ${match.score[0]} - ${match.score[1]} ${match.away.short}</p>
      ${statsTable(match)}<button class="btn">Second half (Enter)</button>`, secondHalf);
  }
  function secondHalf() { match.startSecondHalf(); hide(); screen = 'match'; }

  function fulltime() {
    screen = 'fulltime';
    const [a, b] = match.score;
    const res = a > b ? 'You win!' : a < b ? 'You lose' : 'Draw';
    show(`<h2>Full time — ${res}</h2><p class="big">${match.home.short} ${a} - ${b} ${match.away.short}</p>
      ${statsTable(match)}<button class="btn">Back to menu (Enter)</button>`, titleScreen);
  }

  function pause() {
    screen = 'paused';
    show(`<h2>Paused</h2>${CONTROLS}<button class="btn">Resume (Enter / P)</button>`, resume);
  }
  function resume() { hide(); screen = 'match'; }

  function updateHud() {
    if (!match) return;
    const min = Math.min(90, Math.floor(match.clock / 60));
    const c = match.controlled;
    const key = `${match.score}|${min}|${match.banner ? match.banner.text : ''}|${c ? c.name : ''}`;
    if (key === lastHud) return;
    lastHud = key;
    $('score').textContent = `${match.score[0]} - ${match.score[1]}`;
    $('clock').textContent = `${min}'`;
    const bn = $('banner');
    if (match.banner) { bn.textContent = match.banner.text; bn.classList.add('show'); }
    else bn.classList.remove('show');
    $('playerTag').textContent = c ? `#${c.num} ${c.name} · ${c.role}` : '';
  }

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (I.hit('restart') && screen !== 'title') { I.endStep(); startMatch(); }
    if (screen === 'title' && I.hit('fullcourt')) { I.endStep(); setFullCourt(!settings.fullCourt); titleScreen(); }
    if (screen === 'match') {
      if (I.hit('pause')) { I.endStep(); pause(); }
      else {
        acc += dt;
        while (acc >= C.DT) {
          match.step(C.DT, I);
          I.endStep();
          acc -= C.DT;
        }
        if (match.state === 'halftime') halftime();
        else if (match.state === 'fulltime') fulltime();
      }
    } else {
      acc = 0;
      if (I.hit('start') || (screen === 'paused' && I.hit('pause'))) {
        I.endStep();
        if (screen === 'title') startMatch();
        else if (screen === 'halftime') secondHalf();
        else if (screen === 'fulltime') titleScreen();
        else if (screen === 'paused') resume();
      }
      I.endStep();
    }

    if (match) R.draw(match, dt, screen === 'match' ? acc / C.DT : 1); else R.drawIdle(dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  titleScreen();
  requestAnimationFrame(frame);
})();
