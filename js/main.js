(function () {
  const C = PP.C, I = PP.Input, U = PP.U;
  const cv = document.getElementById('game');
  const wrap = document.getElementById('wrap');
  const hud = document.getElementById('hud');
  const overlay = document.getElementById('overlay');
  const $ = (id) => document.getElementById(id);
  const R = (PP.R = new PP.Renderer(cv)); // PP.R: handy for debugging
  I.init();
  // Locked-mouse aiming: grab the pointer during play, let it go on every menu.
  const lockMode = () => PP.settings.aim === 'mouselock';
  I.wantLock = () => lockMode() && screen === 'match';
  const grab = () => { if (lockMode()) I.lock(); };
  document.addEventListener('pointerlockchange', () => {
    if (!I.locked() && screen === 'match' && lockMode() && match && match.state !== 'halftime' && match.state !== 'fulltime') pause();
  });

  let match = null;
  const settings = { fullCourt: false };
  try { settings.fullCourt = localStorage.getItem('pp.fullCourt') === '1'; } catch (e) { /* no storage */ }
  function setFullCourt(v) {
    settings.fullCourt = v;
    try { localStorage.setItem('pp.fullCourt', v ? '1' : '0'); } catch (e) { /* no storage */ }
  }
  let screen = 'title';   // title | hub | table | squad | fixtures | results | seasonEnd | match | paused | halftime | fulltime
  let mode = 'friendly';  // friendly | season
  let lastDefs = null;    // [yours, theirs] for R restarts
  let enterAction = null; // what Enter does on the current menu screen
  const L = PP.League;
  L.load();
  let lastHud = '';

  function fit() {
    // Phones: widen the view to the screen's shape so the pitch fills it (more pitch side to side).
    if (matchMedia('(pointer: coarse)').matches || I.usedTouch) {
      R.setWidth(Math.round(U.clamp((C.VIEW_H * innerWidth) / innerHeight, 560, 820)));
    }
    const s = Math.max(0.3, Math.min(innerWidth / C.VIEW_W, innerHeight / C.VIEW_H)); // phones can be smaller than 1x
    wrap.style.width = C.VIEW_W * s + 'px';
    wrap.style.height = C.VIEW_H * s + 'px';
    wrap.style.setProperty('--s', ((s * C.VIEW_H) / 288).toFixed(3)); // HUD sized as at 512x288
  }
  addEventListener('resize', () => { fit(); setTimeout(fit, 350); }); // iOS reports the new size late after a rotation
  fit();

  const CONTROLS = `
    <div class="controls">
      <span class="h">Move</span><span><kbd>WASD</kbd> / <kbd>Arrows</kbd></span><span><kbd>Shift</kbd> sprint</span>
      <span class="h">Attack</span><span><kbd>J</kbd> pass &nbsp;<kbd>K</kbd> lofted / chip</span><span><kbd>L</kbd> / <kbd>Space</kbd> shoot</span>
      <span class="h">Strength</span><span>hold the button</span><span>tap = soft, hold = bullet</span>
      <span class="h">Defend</span><span><kbd>Space</kbd> tackle &nbsp;<kbd>K</kbd> slide</span><span><kbd>J</kbd> switch</span>
      <span class="h">Game</span><span><kbd>P</kbd> pause &nbsp;<kbd>R</kbd> restart &nbsp;<kbd>M</kbd> mute</span><span>aim with direction keys</span>
    </div>`;

  const TOUCH_CONTROLS = `
    <div class="controls">
      <span class="h">Pass / shoot</span><span>pull back anywhere, let go</span><span>further = harder, long = lofted</span>
      <span class="h">On the ground</span><span>2nd finger down while pulling</span><span>back to the start = cancel</span>
      <span class="h">Dribble / run</span><span>drag forwards (a joystick)</span><span>further = sprint</span>
      <span class="h">Defend</span><span>drag = run, tap = tackle</span><span>swipe = slide, tap a mate = switch</span>
    </div>`;
  const controlsHelp = () => (I.usedTouch || matchMedia('(pointer: coarse)').matches ? TOUCH_CONTROLS : CONTROLS);

  // Clicky buttons.
  overlay.addEventListener('click', (e) => { if (e.target.closest('.btn, tr.opt, tr.pick, .slot, .benchp')) PP.Sound.play('click'); });

  function show(html, onClick) {
    if (screen !== 'paused' && screen !== 'halftime' && screen !== 'fulltime') { PP.Sound.crowdOff(); PP.Sound.musicOn(); }
    overlay.innerHTML = `<div class="card">${html}</div>`;
    overlay.hidden = false;
    const btn = overlay.querySelector('.btn');
    if (btn && onClick) btn.addEventListener('click', onClick);
  }
  function hide() { overlay.hidden = true; }
  // Touch screens: an on-screen pause button (no Esc / P key), and fullscreen where allowed.
  let touchFitted = false;
  const touchDevice = () => I.usedTouch || matchMedia('(pointer: coarse)').matches;
  $('pauseBtn').addEventListener('click', (e) => { e.stopPropagation(); if (screen === 'match') pause(); });
  I.onTouch = () => {
    if (!touchFitted) { touchFitted = true; fit(); }
    const d = document.documentElement, fs = d.requestFullscreen || d.webkitRequestFullscreen;
    if (fs && !document.fullscreenElement && !document.webkitFullscreenElement && matchMedia('(pointer: coarse)').matches) {
      try { const r = fs.call(d); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed (iPhone) */ }
    }
  };

  const starsTxt = (n) => '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '');
  const bar = (v, col) => `<span class="meter"><i style="width:${v}%;background:${col}"></i></span>`;
  const moodCol = (v) => (v >= 60 ? '#5bd15b' : v >= 35 ? '#f3a712' : '#e4572e');

  function titleScreen() {
    screen = 'title';
    match = null;
    PP.Sound.crowdOff();
    hud.hidden = true;
    const s = L.s, cont = s && !s.over;
    show(`<h1>PIXEL PITCH</h1><p class="hint" style="margin-top:-0.6em">${PP.VERSION}</p>
      <p>${cont ? `${L.user().name} · season ${s.season} · round ${s.round + 1} of ${s.fixtures.length}` : 'A 38-game Premier League season.'}</p>
      <button class="btn" id="seasonBtn">${cont ? 'Continue season' : s ? 'Next season' : 'Start season'} (Enter)</button>
      <button class="btn toggle" id="friendlyBtn" style="margin-left:1em">Friendly</button>
      <button class="btn toggle" id="arenaBtn" style="margin-left:1em">Test arena</button>
      ${s ? '<button class="btn toggle" id="resetBtn" style="margin-left:1em">Start over</button>' : ''}
      <p style="margin-top:1.2em"><button class="btn toggle" id="fcBtn">Full court: ${settings.fullCourt ? 'ON' : 'OFF'} (F)</button>
      <button class="btn toggle" id="smTitle" style="margin-left:1em">Smoothness controls</button>
      <button class="btn toggle" id="musBtn" style="margin-left:1em">Sound</button></p>
      <p class="hint">${settings.fullCourt ? 'Continuous 11v11: you defend too.' : 'You play your attacks and defend turnovers; you attack right to left.'}</p>
      ${controlsHelp()}`);
    enterAction = seasonEntry;
    $('seasonBtn').addEventListener('click', seasonEntry);
    $('friendlyBtn').addEventListener('click', friendlyScreen);
    $('arenaBtn').addEventListener('click', arenaScreen);
    if ($('resetBtn')) $('resetBtn').addEventListener('click', () => {
      if (confirm('Delete this save and start a brand new season?')) { L.clear(); titleScreen(); }
    });
    $('fcBtn').addEventListener('click', () => { setFullCourt(!settings.fullCourt); titleScreen(); });
    $('smTitle').addEventListener('click', () => smoothnessCard(titleScreen));
    $('musBtn').addEventListener('click', () => soundCard(titleScreen));
  }

  function seasonEntry() {
    if (!L.s) return clubPicker();
    hub(); // shows the season-end screen if the season is over
  }

  // Quick match: any club against any other.
  let fr = { a: 0, b: 1 };
  function friendlyScreen() {
    screen = 'title';
    const clubs = L.clubs(), h = clubs[fr.a], a = clubs[fr.b];
    const rh = PP.teamRatings(h), ra = PP.teamRatings(a);
    show(`<h2>Friendly</h2>
      <table class="stats ratings">
        <tr><td><button class="btn toggle sm" id="hPrev">‹</button> <span style="color:${h.kit.shirt}">${h.name}</span> <button class="btn toggle sm" id="hNext">›</button></td><td></td>
            <td><button class="btn toggle sm" id="aPrev">‹</button> <span style="color:${a.kit.shirt}">${a.name}</span> <button class="btn toggle sm" id="aNext">›</button></td></tr>
        <tr><td>${starsTxt(rh.att)}</td><td>Attack</td><td>${starsTxt(ra.att)}</td></tr>
        <tr><td>${starsTxt(rh.mid)}</td><td>Midfield</td><td>${starsTxt(ra.mid)}</td></tr>
        <tr><td>${starsTxt(rh.def)}</td><td>Defence</td><td>${starsTxt(ra.def)}</td></tr>
      </table>
      <p class="hint">You: ${h.style.epithet}<br>${a.short}: ${a.style.epithet}</p>
      <button class="btn" id="koBtn">Kick off (Enter)</button> <button class="btn toggle" id="backBtn">Back</button>`);
    const n = clubs.length, cyc = (k, d) => { do { fr[k] = (fr[k] + d + n) % n; } while (fr.a === fr.b); friendlyScreen(); };
    $('hPrev').addEventListener('click', () => cyc('a', -1)); $('hNext').addEventListener('click', () => cyc('a', 1));
    $('aPrev').addEventListener('click', () => cyc('b', -1)); $('aNext').addEventListener('click', () => cyc('b', 1));
    const go = () => { mode = 'friendly'; startMatch(h, friendlyOpp(h, a)); };
    enterAction = go;
    $('koBtn').addEventListener('click', go);
    $('backBtn').addEventListener('click', titleScreen);
  }
  const friendlyOpp = (h, a) => L.changeKit(h, a);

  // ---------- test arena ----------
  // Pick the kind of opponent you want to practise against and play a full game: no crowd,
  // no season, R restarts it.
  const ARENA_OPTS = {
    club: null, // filled from the club list
    style: [['low', 'Low block'], ['mid', 'Mid block'], ['high', 'High press']],
    width: [[0.8, 'Narrow'], [0.6, 'Balanced'], [0.4, 'Wide']],
    strength: [[58, 'Very weak'], [65, 'Weak'], [0, 'Even'], [80, 'Strong'], [88, 'Very strong']],
    formation: Object.keys(PP.FORMATIONS).map((f) => [f, f]),
    fullCourt: [[true, 'Full game (you defend too)'], [false, 'Attacking phases']],
    half: [[180, '3 min halves'], [300, '5 min halves'], [600, '10 min halves']],
  };
  const ARENA_LABELS = { club: 'You play as', style: 'They defend with', width: 'Their shape', strength: 'Their strength', formation: 'Their formation', fullCourt: 'Mode', half: 'Length' };
  const arena = { club: 'ars', style: 'high', width: 0.6, strength: 0, formation: '4-4-2', fullCourt: true, half: 180 };
  try { Object.assign(arena, JSON.parse(localStorage.getItem('pp.arena') || '{}')); } catch (e) { /* none */ }
  function arenaScreen() {
    screen = 'title'; mode = 'arena';
    match = null; hud.hidden = true;
    const clubs = L.clubs();
    ARENA_OPTS.club = clubs.map((c) => [c.id, c.name]);
    const rows = Object.keys(ARENA_LABELS).map((k) => {
      const opts = ARENA_OPTS[k], cur = opts.find((o) => o[0] === arena[k]) || opts[0];
      return `<tr data-k="${k}" class="opt"><td>${ARENA_LABELS[k]}</td><td><button class="btn toggle">${cur[1]}</button></td></tr>`;
    }).join('');
    show(`<h2>Test arena</h2><p class="hint">Set up the opponent you want to practise against. No crowd; R restarts.</p>
      <table class="stats smooth">${rows}</table>
      <button class="btn" id="koBtn">Kick off (Enter)</button> <button class="btn toggle" id="backBtn">Back</button>`);
    overlay.querySelectorAll('tr.opt').forEach((tr) => tr.addEventListener('click', (e) => {
      const k = tr.dataset.k, opts = ARENA_OPTS[k], i = opts.findIndex((o) => o[0] === arena[k]);
      arena[k] = opts[(i + (e.shiftKey ? opts.length - 1 : 1)) % opts.length][0];
      try { localStorage.setItem('pp.arena', JSON.stringify(arena)); } catch (err) { /* no storage */ }
      arenaScreen();
    }));
    const go = () => {
      const you = clubs.find((c) => c.id === arena.club) || clubs[0];
      const st = ARENA_OPTS.style.find((o) => o[0] === arena.style)[1], sl = ARENA_OPTS.strength.find((o) => o[0] === arena.strength)[1];
      const opp = {
        id: 'opp', name: `${sl} ${st.toLowerCase()} XI`, short: 'OPP', formation: arena.formation,
        rating: arena.strength || you.rating,
        style: { block: arena.style, compact: arena.width, fwdDefend: arena.style === 'high' ? 'high' : 'help', epithet: `${st}, ${ARENA_OPTS.width.find((o) => o[0] === arena.width)[1].toLowerCase()}` },
        kit: { shirt: '#3d4450', shade: '#262b33', shorts: '#1b1b1b', socks: '#3d4450' },
        gkKit: { shirt: '#7bd389', shade: '#3f8a4c', shorts: '#1b1b2f', socks: '#7bd389' },
      };
      PP.ensureSquad(opp);
      mode = 'arena';
      startMatch(you, L.changeKit(you, opp), { fullCourt: arena.fullCourt, halfSeconds: arena.half, noCrowd: true });
      match.say(opp.name, 2);
    };
    enterAction = go;
    $('koBtn').addEventListener('click', go);
    $('backBtn').addEventListener('click', titleScreen);
  }

  // Pick your club for a new season.
  function clubPicker() {
    screen = 'title';
    const clubs = L.clubs();
    const score = (t) => { const r = PP.teamRatings(t); return (r.att + r.mid + r.def) / 3; };
    const rows = clubs.map((t, i) => {
      const r = PP.teamRatings(t);
      return `<tr class="pick" data-i="${i}"><td class="nm"><i class="sw" style="background:${t.kit.shirt}"></i>${t.name}</td><td>${starsTxt(Math.round(score(t) * 2) / 2)}</td><td class="hint">${t.style.epithet}</td></tr>`;
    }).join('');
    show(`<h2>Choose your club</h2><table class="league clubs">${rows}</table><button class="btn toggle" id="backBtn">Back</button>`);
    overlay.querySelectorAll('tr.pick').forEach((tr) => tr.addEventListener('click', () => {
      L.newSeason(null, clubs[+tr.dataset.i].id); hub();
    }));
    enterAction = titleScreen;
    $('backBtn').addEventListener('click', titleScreen);
  }

  // ---------- season screens ----------
  function miniTable(rows, hiId, from, to) {
    const tr = rows.slice(from, to).map((r) => {
      const i = rows.indexOf(r) + 1, me = r.id === hiId;
      return `<tr class="${me ? 'me' : ''}"><td>${i}</td><td class="nm">${r.name}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}-${r.ga}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td><td class="form">${r.form.slice(-5).join('')}</td></tr>`;
    }).join('');
    return `<table class="league"><tr><th></th><th class="nm">Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Goals</th><th>GD</th><th>Pts</th><th>Form</th></tr>${tr}</table>`;
  }

  function seasonHeader() {
    const s = L.s, pos = L.position();
    return `<div class="seasonbar"><span>Season ${s.season}</span><span>Round ${Math.min(s.round + 1, s.fixtures.length)}/${s.fixtures.length}</span>
      <span>${s.round ? ordinal(pos) : 'Pre-season'} <small>(expected ${ordinal(s.expected)})</small></span><span class="coins">● ${s.coins}</span>
      <span>Fans ${bar(s.fans, moodCol(s.fans))}</span><span>Board ${bar(s.board, moodCol(s.board))}</span></div>`;
  }
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  function hub() {
    screen = 'hub';
    match = null; PP.Sound.crowdOff(); hud.hidden = true;
    const s = L.s;
    L.skipDays();
    if (s.over) return seasonEndScreen();
    const fx = L.nextFixture(), opp = L.team(fx.opp), u = L.user();
    const cl = fx.comp === 'cl';
    const ro = L.ratings(fx.opp), ru = L.ratings(u.id);
    const rows = L.table(), me = rows.findIndex((r) => r.id === u.id);
    const from = U.clamp(me - 2, 0, rows.length - 5);
    const oppPos = rows.findIndex((r) => r.id === opp.id) + 1;
    show(`${seasonHeader()}
      <p class="comp ${cl ? 'ucl' : ''}">${fx.label}</p>
      <h2>${fx.home || fx.neutral ? `${u.name} <small>v</small> ${opp.name}` : `${opp.name} <small>v</small> ${u.name}`}</h2>
      <table class="stats ratings">
        <tr><td style="color:${u.kit.shirt}">You</td><td></td><td style="color:${opp.kit.shirt}">${opp.short}${s.round && !cl ? ` <small>(${ordinal(oppPos)})</small>` : ''}</td></tr>
        <tr><td>${starsTxt(ru.att)}</td><td>Attack</td><td>${starsTxt(ro.att)}</td></tr>
        <tr><td>${starsTxt(ru.mid)}</td><td>Midfield</td><td>${starsTxt(ro.mid)}</td></tr>
        <tr><td>${starsTxt(ru.def)}</td><td>Defence</td><td>${starsTxt(ro.def)}</td></tr>
      </table>
      <p class="hint">${u.rival === opp.id ? '<b class="derby">DERBY DAY</b> · ' : ''}${fx.neutral ? 'Neutral venue' : fx.home ? 'Home' : 'Away'} · ${opp.short}: ${opp.style.epithet}${fx.agg ? ` · <b>aggregate ${fx.agg[0]}-${fx.agg[1]}</b> after the 1st leg; level after this one means penalties` : fx.decider ? ' · a draw goes to penalties' : ''}</p>
      ${miniTable(rows, u.id, from, from + 5)}
      <button class="btn" id="playBtn">Play match (Enter)</button>
      <button class="btn toggle" id="tblBtn">Table</button> <button class="btn toggle" id="fixBtn">Fixtures</button>
      <button class="btn toggle" id="eurBtn">Europe</button>
      <button class="btn toggle" id="sqBtn">Squad</button> <button class="btn toggle" id="menuBtn">Menu</button>`);
    const play = () => { mode = 'season'; startMatch(u, L.oppDef(opp.id)); if (match) match.say(cl ? (fx.ko ? PP.Europe.STAGE_NAME[L.current().k] : 'Champions League') : u.rival === opp.id ? 'Derby day!' : 'Kick off', 2.2); };
    const ch = $('eurBtn'); if (!s.cl) ch.hidden = true;
    $('eurBtn').addEventListener('click', europeScreen);
    enterAction = play;
    $('playBtn').addEventListener('click', play);
    $('tblBtn').addEventListener('click', tableScreen);
    $('fixBtn').addEventListener('click', fixturesScreen);
    $('sqBtn').addEventListener('click', squadScreen);
    $('menuBtn').addEventListener('click', titleScreen);
  }

  function tableScreen() {
    screen = 'table';
    const rows = L.table();
    show(`<h2>Season ${L.s.season} table</h2>${miniTable(rows, L.s.userId, 0, rows.length)}
      <button class="btn" id="backBtn">Back (Enter)</button>`);
    enterAction = hub;
    $('backBtn').addEventListener('click', hub);
  }

  function fixturesScreen() {
    screen = 'fixtures';
    const s = L.s, u = s.userId;
    const items = s.fixtures.map((round, i) => {
      const g = round.find((x) => x.h === u || x.a === u), home = g.h === u, opp = L.team(home ? g.a : g.h);
      let res = '';
      if (g.hs != null) {
        const gf = home ? g.hs : g.as, ga = home ? g.as : g.hs;
        res = `<b class="${gf > ga ? 'w' : gf < ga ? 'l' : 'd'}">${gf}-${ga}</b>`;
      }
      return `<li class="${i === s.round ? 'next' : ''}"><span>${i + 1}</span> ${home ? 'H' : 'A'} ${opp.short} ${res}</li>`;
    }).join('');
    show(`<h2>Your fixtures</h2><ul class="fixtures">${items}</ul><button class="btn" id="backBtn">Back (Enter)</button>`);
    enterAction = hub;
    $('backBtn').addEventListener('click', hub);
  }

  // Squad: formation, the XI on a pitch map, the bench, and tactics. Click two players to
  // swap them (pitch <-> pitch moves positions, pitch <-> bench is a selection change).
  const TACTICS = {
    block: [['low', 'Low block'], ['mid', 'Mid block'], ['high', 'High press']],
    compact: [[0.8, 'Narrow'], [0.6, 'Balanced'], [0.4, 'Wide']],
    fwdDefend: [['help', 'Forwards drop back'], ['high', 'Forwards stay high']],
  };
  function describeStyle(st) {
    const b = { low: 'Low block', mid: 'Mid block', high: 'High press' }[st.block];
    const c = st.compact >= 0.7 ? 'narrow' : st.compact <= 0.5 ? 'wide' : 'balanced';
    return `${b}, ${c}; forwards ${st.fwdDefend === 'high' ? 'stay high' : 'drop back'}`;
  }
  let sel = null; // { where: 'xi' | 'bench', i }
  let mapView = 'without'; // the map shows the shape without the ball, or with it
  function squadScreen(view = 'map') {
    screen = 'squad';
    const u = L.user(), form = PP.FORMATIONS[u.formation];
    u.style.fwdDefend = u.style.fwdDefend || 'help';
    const r = PP.teamRatings(u);
    const surname = (n) => n.split(' ').slice(-1)[0];
    const stars = (role, pl) => PP.stars(PP.playerRating(role, pl.stats));
    const slotHtml = form.map((sl, i) => {
      const pl = u.squad[i], fit = PP.fit(pl.pos, sl[0]);
      const cls = fit === 1 ? 'ok' : fit >= 0.9 ? 'near' : 'bad';
      const kit = sl[0] === 'GK' ? u.gkKit : u.kit;
      const at = PP.AI.previewSlot(u.style, sl[0], sl[1], sl[2], mapView);
      return `<div class="slot ${cls} ${sel && sel.where === 'xi' && sel.i === i ? 'sel' : ''}" data-w="xi" data-i="${i}" style="left:${at.l * 100}%;top:${95 - at.d * 105}%">
        <i style="background:${kit.shirt};color:${kit.shorts}">${pl.num}</i><b>${surname(pl.name)}</b><small>${sl[0]}${fit < 1 ? ' (' + pl.pos + ')' : ''} ${starsTxt(stars(sl[0], pl))}</small></div>`;
    }).join('');
    const benchHtml = u.bench.map((pl, i) => `<div class="benchp ${sel && sel.where === 'bench' && sel.i === i ? 'sel' : ''}" data-w="bench" data-i="${i}">
      <span>${pl.num}</span> ${pl.name} <small>${pl.pos} ${starsTxt(stars(pl.pos, pl))}</small></div>`).join('');
    const isOn = (k, v) => (k === 'compact' ? TACTICS.compact.reduce((a, o) => (Math.abs(o[0] - u.style.compact) < Math.abs(a[0] - u.style.compact) ? o : a))[0] === v : u.style[k] === v);
    const tacRow = (k, label) => `<div class="tac"><span>${label}</span>${TACTICS[k].map(([v, l]) => `<button class="btn toggle sm ${isOn(k, v) ? 'on' : ''}" data-tk="${k}" data-tv="${v}">${l}</button>`).join('')}</div>`;
    const forms = Object.keys(PP.FORMATIONS).map((f) => `<button class="btn toggle sm ${u.formation === f ? 'on' : ''}" data-f="${f}">${f}</button>`).join('');
    if (view === 'stats') {
      const team = { name: u.name, style: { epithet: describeStyle(u.style) }, players: [...u.squad.map((pl, i) => ({ ...pl, role: form[i][0], isGK: form[i][0] === 'GK' })), ...u.bench.map((pl) => ({ ...pl, role: pl.pos, isGK: pl.pos === 'GK' }))] };
      show(`<h2>${u.name}: attributes</h2>${squadTable(team)}<p class="hint">Rows 12-18 are the bench.</p>
        <button class="btn" id="backBtn">Back (Enter)</button>`);
      enterAction = () => squadScreen();
      $('backBtn').addEventListener('click', () => squadScreen());
      return;
    }
    show(`<h2>${u.name} <small>${starsTxt(r.att)} att · ${starsTxt(r.mid)} mid · ${starsTxt(r.def)} def</small></h2>
      <div class="squadwrap">
        <div><div class="pitchmap"><div class="half"></div><div class="box"></div>${slotHtml}</div>
          <div class="tac mapv"><button class="btn toggle sm ${mapView === 'without' ? 'on' : ''}" data-mv="without">Without the ball</button><button class="btn toggle sm ${mapView === 'with' ? 'on' : ''}" data-mv="with">With the ball</button></div></div>
        <div class="side">
          <div class="tac"><span>Formation</span>${forms}</div>
          ${tacRow('block', 'Without the ball')}${tacRow('compact', 'Shape')}${tacRow('fwdDefend', 'Forwards')}
          <p class="hint">Bench (click a player, then another, to swap)</p>${benchHtml}
        </div>
      </div>
      <button class="btn" id="backBtn">Done (Enter)</button> <button class="btn toggle" id="attrBtn">Attributes</button>`);
    const done = () => { sel = null; L._rc = {}; L.save(); hub(); };
    enterAction = done;
    $('backBtn').addEventListener('click', done);
    $('attrBtn').addEventListener('click', () => squadScreen('stats'));
    overlay.querySelectorAll('[data-mv]').forEach((el) => el.addEventListener('click', () => { mapView = el.dataset.mv; squadScreen(); }));
    overlay.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('click', () => {
      PP.setFormation(u, el.dataset.f); sel = null; L._rc = {}; L.save(); squadScreen();
    }));
    overlay.querySelectorAll('[data-tk]').forEach((el) => el.addEventListener('click', () => {
      const k = el.dataset.tk, v = TACTICS[k].find((o) => String(o[0]) === el.dataset.tv)[0];
      u.style[k] = v; u.style.epithet = describeStyle(u.style); L.save(); mapView = 'without'; squadScreen();
    }));
    overlay.querySelectorAll('[data-w]').forEach((el) => el.addEventListener('click', () => {
      const pick = { where: el.dataset.w, i: +el.dataset.i };
      if (!sel) { sel = pick; return squadScreen(); }
      if (sel.where !== pick.where || sel.i !== pick.i) {
        const arr = (w) => (w === 'xi' ? u.squad : u.bench);
        const a = arr(sel.where), b = arr(pick.where);
        [a[sel.i], b[pick.i]] = [b[pick.i], a[sel.i]];
        L._rc = {}; L.save();
      }
      sel = null; squadScreen();
    }));
  }

  // Champions League: the 36-club league phase table and the knockout ties.
  function europeScreen() {
    screen = 'europe';
    const s = L.s, cl = s.cl, E = PP.Europe, u = s.userId;
    const nm = (id) => `<span class="${id === u ? 'meclub' : ''}">${L.team(id).short}</span>`;
    const tbl = E.table();
    const row = (r, i) => `<tr class="${r.id === u ? 'me' : ''} ${i < 8 ? 'z1' : i < 24 ? 'z2' : 'z3'}"><td>${i + 1}</td><td class="nm">${L.team(r.id).name}</td><td>${r.p}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>`;
    const half = (a, b) => `<table class="league">${tbl.slice(a, b).map((r, i) => row(r, a + i)).join('')}</table>`;
    const tie = (t) => {
      if (t.final) { const g = t.legs[0]; return g.hs == null ? `${nm(t.a)} v ${nm(t.b)}` : `${nm(g.h)} ${g.hs}-${g.as} ${nm(g.a)}${t.pens ? ` <small>(${t.pens[0]}-${t.pens[1]}p)</small>` : ''}`; }
      const [x, y] = E.agg(t), done = E.tieDone(t), started = t.legs[0].hs != null;
      return `${nm(t.a)} ${started ? `${x}-${y}` : 'v'} ${nm(t.b)}${t.pens ? ` <small>(${t.a === t.legs[1].h ? t.pens[0] : t.pens[1]}-${t.a === t.legs[1].h ? t.pens[1] : t.pens[0]}p)</small>` : ''}${started && !done ? ' <small>(1st leg)</small>' : ''}`;
    };
    const ko = E.STAGES.map((k) => `<p class="ko"><b class="comp ucl">${E.STAGE_NAME[k]}</b> ${cl.ko[k] ? cl.ko[k].map(tie).join(' · ') : '<small>to be decided</small>'}</p>`).join('');
    const inIt = cl.english.includes(u);
    show(`<h2>Champions League <small>season ${s.season}</small></h2>
      <p class="hint">${inIt ? E.status() : 'You did not qualify this season: finish in the top four.'}${cl.winner ? ` · Winners: ${L.team(cl.winner).name}` : ''}</p>
      <div class="groups">${half(0, 18)}${half(18, 36)}</div>
      <p class="hint"><span class="z1k">■</span> 1-8 Round of 16 &nbsp; <span class="z2k">■</span> 9-24 play-offs &nbsp; 25-36 out</p>
      ${ko}
      <button class="btn" id="backBtn">Back (Enter)</button>`);
    enterAction = hub;
    $('backBtn').addEventListener('click', hub);
  }

  function resultsScreen(sum) {
    screen = 'results';
    const e = sum.entry, s = L.s;
    const res = e.gf > e.ga ? 'Win' : e.gf < e.ga ? 'Defeat' : 'Draw';
    const sign = (v) => (v > 0 ? '+' + v : '' + v);
    const pens = (g) => (g.pens ? ` <small>(${g.pens[0]}-${g.pens[1]} p)</small>` : '');
    const others = sum.games.filter((g) => g.h !== s.userId && g.a !== s.userId)
      .map((g) => `<li>${L.team(g.h).short} ${g.hs}-${g.as} ${L.team(g.a).short}${pens(g)}</li>`).join('');
    const t = e.tie;
    const res2 = t && t.pens ? `${t.through ? 'Won' : 'Lost'} ${t.pens[0]}-${t.pens[1]} on penalties` : res;
    show(`<p class="comp ${e.cl ? 'ucl' : ''}">${e.label || 'Round ' + e.round}</p><h2>${res2}</h2>
      <p class="big">${e.home ? `${L.user().short} ${e.gf} - ${e.ga} ${L.team(e.opp).short}` : `${L.team(e.opp).short} ${e.ga} - ${e.gf} ${L.user().short}`}</p>
      ${t && t.agg ? `<p>Aggregate ${t.agg[0]}-${t.agg[1]}</p>` : ''}
      ${e.note ? `<p class="note">${e.note}</p>` : ''}
      <p><span class="coins">● ${sign(e.coins)}</span>${sum.gate ? ` <small>(gate ${sum.gate})</small>` : ''} &nbsp; Fans ${sign(e.fans)} &nbsp; Board ${sign(e.board)}</p>
      ${others ? `<p class="hint">Elsewhere</p><ul class="results">${others}</ul>` : ''}
      <p>${e.cl ? (PP.Europe.status() || '') + ' · ' : ''}${ordinal(L.position())} in the league.</p>
      <button class="btn" id="contBtn">Continue (Enter)</button>`);
    enterAction = hub;
    $('contBtn').addEventListener('click', hub);
  }

  function seasonEndScreen() {
    screen = 'seasonEnd';
    match = null; hud.hidden = true;
    const end = L.seasonEnd(), rows = L.table();
    const early = L.s.round < L.s.fixtures.length;
    show(`<h2>${early ? `Sacked after ${L.s.round} rounds (${ordinal(end.pos)})` : `Season ${L.s.season} over: ${ordinal(end.pos)}`}</h2>
      <p>Expected: ${ordinal(L.s.expected)}. Prize money <span class="coins">● ${end.prize}</span></p>
      <p>${end.verdict}</p>
      ${end.europe ? `<p class="comp ucl">Champions League: ${end.europe}</p>` : ''}
      <p class="hint">${end.qualified ? 'Top four: you are in next season\'s Champions League.' : 'Finish in the top four to play in the Champions League.'}
        ${L.s.cl && L.s.cl.winner ? ` European champions: ${L.team(L.s.cl.winner).name}.` : ''}</p>
      ${miniTable(rows, L.s.userId, 0, 6)}
      <button class="btn" id="nextBtn">${end.sacked ? 'Start again' : 'Next season'} (Enter)</button> <button class="btn toggle" id="tblBtn">Full table</button>`);
    const next = () => { if (end.sacked) { L.clear(); clubPicker(); } else { L.newSeason(L.s); hub(); } };
    enterAction = next;
    $('nextBtn').addEventListener('click', next);
    $('tblBtn').addEventListener('click', () => { screen = 'table'; show(`<h2>Final table</h2>${miniTable(rows, L.s.userId, 0, rows.length)}<button class="btn" id="b2">Back (Enter)</button>`); enterAction = seasonEndScreen; $('b2').addEventListener('click', seasonEndScreen); });
  }

  let lastOpts = {};
  function startMatch(h, a, opts) {
    if (!h) { [h, a] = lastDefs || PP.TEAM_DEFS; opts = lastOpts; }
    opts = opts || {};
    lastDefs = [h, a]; lastOpts = opts;
    match = new PP.Match(h, a, { fullCourt: opts.fullCourt ?? settings.fullCourt, halfSeconds: opts.halfSeconds, sound: true });
    match.noCrowd = !!opts.noCrowd;
    PP.match = match; // handy for debugging in the console
    $('homeName').textContent = h.short;
    $('awayName').textContent = a.short;
    $('homeSwatch').style.background = h.kit.shirt;
    $('awaySwatch').style.background = a.kit.shirt;
    hud.hidden = false;
    hide();
    screen = 'match';
    PP.Sound.musicOff();
    if (match.noCrowd) { PP.Sound.crowdOff(); PP.Sound.crowdPause(true); } // reactions go quiet too
    else { PP.Sound.crowdPause(false); PP.Sound.crowdOn(); }
    grab();
  }

  function statsTable(m) {
    const tot = m.stats.poss[0] + m.stats.poss[1] || 1;
    const pc = (i) => Math.round((100 * m.stats.poss[i]) / tot);
    const goals = m.events.filter((e) => e.type === 'goal')
      .map((e) => `${e.minute}' ${e.scorer}${e.og ? ' (og)' : ''} — ${e.team === 0 ? m.home.short : m.away.short}`).join('<br>');
    const cards = m.events.filter((e) => e.type === 'card')
      .map((e) => `<span style="color:${e.card === 'red' ? '#e4572e' : '#ffd23f'}">■</span> ${e.minute}' ${e.name} (${e.team === 0 ? m.home.short : m.away.short})`).join(' &nbsp; ');
    return `<table class="stats">
      <tr><td>${m.stats.shots[0]}</td><td>Shots</td><td>${m.stats.shots[1]}</td></tr>
      <tr><td>${m.stats.onTarget[0]}</td><td>On target</td><td>${m.stats.onTarget[1]}</td></tr>
      <tr><td>${pc(0)}%</td><td>Possession</td><td>${pc(1)}%</td></tr>
    </table>${goals ? `<p>${goals}</p>` : ''}${cards ? `<p class="hint">${cards}</p>` : ''}`;
  }

  function halftime() {
    screen = 'halftime'; I.unlock(); PP.Sound.crowdPause(true); PP.Touch.reset(I);
    show(`<h2>Half time</h2><p class="big">${match.home.short} ${match.score[0]} - ${match.score[1]} ${match.away.short}</p>
      ${statsTable(match)}<button class="btn">Second half (Enter)</button>`, secondHalf);
  }
  function secondHalf() { match.startSecondHalf(); hide(); screen = 'match'; if (!match.noCrowd) PP.Sound.crowdPause(false); grab(); }

  function fulltime() {
    screen = 'fulltime'; I.unlock();
    const [a, b] = match.score;
    const res = a > b ? 'You win!' : a < b ? 'You lose' : 'Draw';
    let next = mode === 'arena' ? arenaScreen : titleScreen, label = mode === 'arena' ? 'Back to the arena' : 'Back to menu';
    if (mode === 'season' && L.s && !L.s.over) {
      const sum = L.finishRound(a, b); // the result is locked in at the whistle
      next = () => resultsScreen(sum); label = 'Continue';
    }
    show(`<h2>Full time — ${res}</h2><p class="big">${match.home.short} ${a} - ${b} ${match.away.short}</p>
      ${statsTable(match)}<button class="btn">${label} (Enter)</button>`, next);
    enterAction = next;
  }

  // Your XI with grouped attributes (these all feed the simulation).
  function squadTable(team) {
    const s = (p, ks) => Math.round(ks.reduce((a, k) => a + p.stats[k], 0) / ks.length);
    const rows = team.players.map((p) => {
      const st = p.isGK
        ? [s(p, ['reflexes', 'diving']), s(p, ['handling']), s(p, ['gkPositioning']), s(p, ['kicking']), '-', s(p, ['strength', 'stamina'])]
        : [s(p, ['pace', 'acceleration']), s(p, ['shortPass', 'longPass', 'vision']), s(p, ['finishing', 'shotPower', 'longShots']),
           s(p, ['dribbling', 'firstTouch', 'agility']), s(p, ['tackling', 'marking', 'positioning']), s(p, ['strength', 'stamina'])];
      const stars = PP.stars(PP.playerRating(p.role, p.stats));
      return `<tr><td>${p.num}</td><td>${p.name}</td><td>${p.role}</td><td>${p.foot}</td>${st.map((v) => `<td>${v}</td>`).join('')}<td class="st">${'★'.repeat(Math.floor(stars))}${stars % 1 ? '½' : ''}</td><td class="tr">${p.trait || ''}</td></tr>`;
    }).join('');
    return `<table class="squad"><tr><th>#</th><th>Name</th><th>Pos</th><th>Ft</th><th>PAC</th><th>PAS</th><th>SHO</th><th>DRI</th><th>DEF</th><th>PHY</th><th></th><th></th></tr>${rows}</table>
      <p class="hint">GK row: DIV / HAN / POS / KIC. ${team.style ? team.name + ': ' + team.style.epithet : ''}</p>`;
  }

  // "Smoothness" controls: click a row to cycle its value.
  function smoothnessCard(back) {
    const rows = Object.keys(PP.SETTING_LABELS).map((k) => {
      const opts = PP.SETTING_OPTIONS[k], cur = opts.find((o) => o[0] === PP.settings[k]) || opts[0];
      return `<tr data-k="${k}" class="opt"><td>${PP.SETTING_LABELS[k]}</td><td><button class="btn toggle">${cur[1]}</button></td></tr>`;
    }).join('');
    show(`<h2>Smoothness</h2><table class="stats smooth">${rows}</table>
      <p class="hint">Click to change. Mouse pointer: the crosshair is where you aim. Mouse (locked): like a first-person game, the pointer is hidden and moving the mouse pushes a crosshair around the ball (click the pitch to grab the mouse, Esc to let go). Keys still move your player.</p>
      <button class="btn" id="smBack">Back</button>`);
    overlay.querySelectorAll('tr.opt').forEach((tr) => tr.addEventListener('click', () => {
      const k = tr.dataset.k, opts = PP.SETTING_OPTIONS[k];
      const i = opts.findIndex((o) => o[0] === PP.settings[k]);
      PP.settings[k] = opts[(i + 1) % opts.length][0];
      PP.saveSettings();
      smoothnessCard(back);
    }));
    $('smBack').addEventListener('click', back);
    enterAction = back;
  }

  // Sound: one slider per bus (master, music, crowd, effects) plus the music on/off toggle.
  const VOL_ROWS = [['master', 'Master'], ['music', 'Music'], ['crowd', 'Crowd'], ['sfx', 'Effects']];
  function soundCard(back) {
    const S = PP.Sound;
    const rows = VOL_ROWS.map(([k, label]) => `<tr><td>${label}</td><td><input type="range" class="vol" data-k="${k}" min="0" max="100" step="5" value="${Math.round(S.vol[k] * 100)}"></td><td class="volv" id="vv-${k}">${Math.round(S.vol[k] * 100)}%</td></tr>`).join('');
    show(`<h2>Sound</h2><table class="stats smooth">${rows}
      <tr><td>Menu music</td><td><button class="btn toggle" id="musTog">${S.wantMusic ? 'ON' : 'OFF'}</button></td><td></td></tr></table>
      <p class="hint">M mutes everything. The crowd is heard during play (it goes quiet while paused).</p>
      <button class="btn" id="sndBack">Back</button>`);
    overlay.querySelectorAll('input.vol').forEach((el) => {
      el.addEventListener('input', () => { S.setVol(el.dataset.k, el.value / 100); $('vv-' + el.dataset.k).textContent = el.value + '%'; });
      el.addEventListener('change', () => { if (el.dataset.k === 'sfx' || el.dataset.k === 'master') S.play('click'); });
    });
    $('musTog').addEventListener('click', () => { S.toggleMusic(); soundCard(back); });
    $('sndBack').addEventListener('click', back);
    enterAction = back;
  }

  function pause() {
    screen = 'paused'; I.unlock(); PP.Sound.crowdPause(true); PP.Touch.reset(I);
    const arenaBtns = mode === 'arena' ? ' <button class="btn toggle" id="arenaSet">Change opponent</button> <button class="btn toggle" id="restartBtn">Restart (R)</button>' : '';
    show(`<h2>Paused</h2>${squadTable(match.home)}${controlsHelp()}<button class="btn" id="resBtn">Resume (Enter / P)</button> <button class="btn toggle" id="smBtn">Smoothness</button> <button class="btn toggle" id="sndBtn">Sound</button>${arenaBtns}`);
    $('sndBtn').addEventListener('click', () => soundCard(pause));
    $('resBtn').addEventListener('click', resume);
    $('smBtn').addEventListener('click', () => smoothnessCard(pause));
    if (mode === 'arena') {
      $('arenaSet').addEventListener('click', arenaScreen);   // back to the arena set-up (this match is dropped)
      $('restartBtn').addEventListener('click', () => startMatch());
    }
  }
  function resume() { PP.Touch.reset(I); hide(); screen = 'match'; if (!match.noCrowd) PP.Sound.crowdPause(false); grab(); }

  function updateHud() {
    $('pauseBtn').hidden = !(screen === 'match' && touchDevice());
    if (!match) return;
    const min = Math.min(90, Math.floor(match.clock / 60));
    const c = match.controlled;
    const key = `${match.score}|${min}|${match.banner ? match.banner.text : ''}|${c ? c.name : ''}|${c ? Math.round(c.energy * 20) : ''}`;
    if (key === lastHud) return;
    lastHud = key;
    $('score').textContent = `${match.score[0]} - ${match.score[1]}`;
    $('clock').textContent = `${min}'`;
    const bn = $('banner');
    if (match.banner) { bn.textContent = match.banner.text; bn.classList.add('show'); }
    else bn.classList.remove('show');
    $('playerTag').innerHTML = c ? `#${c.num} ${c.name} · ${c.role} · ${c.foot}${c.trait ? ` · <span class="trait">${c.trait}</span>` : ''}
      <div class="stam"><i style="width:${Math.round(c.energy * 100)}%;background:${c.energy > 0.5 ? '#5bd15b' : c.energy > 0.25 ? '#f3a712' : '#e4572e'}"></i></div>` : '';
  }

  // The crowd follows the play: a lull in midfield, a roar building as you near their box,
  // nerves when they're near yours.
  let crowdT = 0;
  function crowdFeel(dt) {
    crowdT -= dt;
    if (crowdT > 0 || !match) return;
    crowdT = 0.25;
    const m = match, b = m.ball;
    let x = 0.1;
    if (m.state === 'goal') x = 0.8;
    else if (m.state === 'replay') x = 0.3;
    else if (m.state !== 'play') x = 0.05;
    else {
      const ours = m.home.depth(b.x), theirs = m.away.depth(b.x);
      const att = b.owner ? b.owner.team : b.lastKick && b.lastKick.team;
      // Your side keeping the ball without pressure, away from their box: hushed.
      if (b.owner && b.owner.team === m.home && m.pressureOn(b.owner) < 0.35 && ours < 0.7) x = 0;
      if (att === m.home) x += 0.6 * Math.max(0, (ours - 0.68) / 0.32) + (b.z > 1.5 && ours > 0.8 ? 0.15 : 0);
      else if (att === m.away) x += 0.35 * Math.max(0, (theirs - 0.65) / 0.35);
    }
    PP.Sound.crowdLevel(x);
  }

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (I.hit('restart') && (screen === 'match' || screen === 'paused' || screen === 'halftime')) { I.endStep(); startMatch(); }
    if (I.hit('mute')) { I.endStep(); const muted = PP.Sound.toggleMute(); if (match) match.say(muted ? 'Sound off' : 'Sound on', 0.8); }
    if (screen === 'title' && I.hit('fullcourt')) { I.endStep(); setFullCourt(!settings.fullCourt); titleScreen(); }
    if (screen === 'match') {
      if (I.hit('pause')) { I.endStep(); pause(); }
      else {
        acc += dt;
        match.mouseWorld = I.mouse ? R.screenToWorld(I.mouse.x, I.mouse.y) : null;
        PP.Touch.update(match, R, I);
        const md = I.takeMouseDelta();
        if (lockMode() && I.locked() && (md.x || md.y)) match.nudgeMouse(md.x, md.y);
        while (acc >= C.DT) {
          match.step(C.DT, I);
          I.endStep();
          acc -= C.DT;
        }
        crowdFeel(dt);
        if (match.state === 'halftime') halftime();
        else if (match.state === 'fulltime') fulltime();
      }
    } else {
      acc = 0;
      if (I.hit('start') || (screen === 'paused' && I.hit('pause'))) {
        I.endStep();
        if (screen === 'halftime') secondHalf();
        else if (screen === 'paused') resume();
        else if (enterAction) enterAction();
      }
      I.endStep();
    }

    if (match) R.draw(match, dt, screen === 'match' ? acc / C.DT : 1); else R.drawIdle(dt);
    updateHud();
    requestAnimationFrame(frame);
  }

  titleScreen();
  requestAnimationFrame(frame);
  PP.ui = { hub, resultsScreen, europeScreen, seasonEndScreen, squadScreen, pause, arenaScreen }; // console / testing
})();
