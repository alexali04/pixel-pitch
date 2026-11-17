// Stage 4: a season. 20 teams, a 38-round double round robin, a league table, simulated
// results for the games you don't play, coins, and fan / board happiness. Saved in
// localStorage so a season survives reloads.
(function () {
  const U = PP.U;
  const SAVE_KEY = 'pp.season';
  const VERSION = 4;

  // Play styles: the block and compactness drive the AI; the epithet tells you what to expect.
  const STYLES = [
    { block: 'low', compact: 0.8, fwdDefend: 'help', aggression: 0.25, epithet: 'Deep, compact low block; hits on the break' },
    { block: 'low', compact: 0.6, fwdDefend: 'help', aggression: 0.35, epithet: 'Sits deep and stays narrow' },
    { block: 'mid', compact: 0.6, fwdDefend: 'help', aggression: 0.5, epithet: 'Balanced, compact mid block' },
    { block: 'mid', compact: 0.4, fwdDefend: 'high', aggression: 0.55, epithet: 'Open mid block, keeps forwards up' },
    { block: 'high', compact: 0.4, fwdDefend: 'high', aggression: 0.9, epithet: 'Aggressive high press, leaves gaps behind' },
    { block: 'high', compact: 0.65, fwdDefend: 'high', aggression: 0.8, epithet: 'Compact high press, suffocating' },
  ];
  // Pressing aggression varies club to club around its style (fixed per club, so you learn who
  // will be all over you).
  const PRESS_WORD = (a) => (a < 0.3 ? 'passive' : a < 0.55 ? 'measured' : a < 0.8 ? 'aggressive' : 'relentless');
  PP.pressWord = PRESS_WORD;

  // The 2026/27 Premier League. Player names are made up.
  // [name, short, shirt, shorts, rating, formation, style index, rival]
  const CLUBS = [
    ['Arsenal', 'ARS', '#db0007', '#f4f4f4', 83, '4-3-3', 5, 'TOT'],
    ['Manchester City', 'MCI', '#6cabdd', '#f4f4f4', 82, '4-3-3', 4, 'MUN'],
    ['Liverpool', 'LIV', '#c8102e', '#c8102e', 82, '4-3-3', 4, 'EVE'],
    ['Chelsea', 'CHE', '#034694', '#034694', 80, '4-2-3-1', 3, 'TOT'],
    ['Newcastle United', 'NEW', '#1e1e1e', '#1e1e1e', 78, '4-3-3', 4, 'SUN'],
    ['Aston Villa', 'AVL', '#7a003c', '#f4f4f4', 78, '4-2-3-1', 3, 'NFO'],
    ['Tottenham Hotspur', 'TOT', '#f4f4f4', '#132257', 77, '4-2-3-1', 4, 'ARS'],
    ['Manchester United', 'MUN', '#da291c', '#f4f4f4', 77, '4-2-3-1', 2, 'MCI'],
    ['Brighton', 'BHA', '#0057b8', '#f4f4f4', 76, '4-2-3-1', 3, 'CRY'],
    ['Nottingham Forest', 'NFO', '#dd0000', '#f4f4f4', 75, '4-2-3-1', 0, 'AVL'],
    ['Crystal Palace', 'CRY', '#1b458f', '#1b458f', 75, '4-4-2', 2, 'BHA'],
    ['Bournemouth', 'BOU', '#b50e12', '#1e1e1e', 75, '4-2-3-1', 4, 'BRE'],
    ['Brentford', 'BRE', '#e30613', '#1e1e1e', 74, '4-4-2', 2, 'FUL'],
    ['Fulham', 'FUL', '#f4f4f4', '#1e1e1e', 74, '4-2-3-1', 3, 'BRE'],
    ['Everton', 'EVE', '#003399', '#f4f4f4', 74, '4-4-2', 1, 'LIV'],
    ['Leeds United', 'LEE', '#f4f4f4', '#f4f4f4', 72, '4-3-3', 5, 'MUN'],
    ['Sunderland', 'SUN', '#eb172b', '#1e1e1e', 71, '4-4-2', 1, 'NEW'],
    ['Coventry City', 'COV', '#7fb2e5', '#f4f4f4', 70, '4-3-3', 4, 'IPS'],
    ['Ipswich Town', 'IPS', '#0044a9', '#f4f4f4', 69, '4-2-3-1', 3, 'COV'],
    ['Hull City', 'HUL', '#f5a12d', '#1e1e1e', 68, '4-4-2', 0, 'LEE'],
  ];

  function shade(hex, k = 0.62) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0'));
    return '#' + c.join('');
  }
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const colDist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

  // Kit details beyond shirt / shorts.
  const KIT_EXTRA = { ARS: { sleeves: '#f4f4f4' } };

  function clubDef(c, i) {
    const [name, short, shirt, shorts, rating, formation, si, rival] = c;
    const st = STYLES[si];
    const aggression = Math.round(U.clamp(st.aggression + ((((i * 37) % 11) / 10) - 0.5) * 0.3, 0.1, 1) * 100) / 100;
    return {
      id: short.toLowerCase(), name, short, formation, rating, rival: rival ? rival.toLowerCase() : null,
      style: { block: st.block, compact: st.compact, fwdDefend: st.fwdDefend, aggression, epithet: `${st.epithet} · ${PRESS_WORD(aggression)} pressing` },
      kit: { shirt, shade: shade(shirt), shorts, socks: shirt, ...(KIT_EXTRA[short] || {}) },
      gkKit: i % 2 ? { shirt: '#7bd389', shade: '#3f8a4c', shorts: '#1b1b2f', socks: '#7bd389' } : { shirt: '#ffd23f', shade: '#b8900c', shorts: '#222222', socks: '#ffd23f' },
    };
  }

  // Double round robin (circle method): 19 rounds, then the same again with venues swapped.
  function makeFixtures(ids) {
    const n = ids.length, arr = ids.slice(), rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const games = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i], b = arr[n - 1 - i];
        const flip = i === 0 ? r % 2 === 1 : i % 2 === 1; // the fixed team alternates venues
        games.push(flip ? { h: b, a } : { h: a, a: b });
      }
      rounds.push(games);
      arr.splice(1, 0, arr.pop()); // rotate all but the first
    }
    const second = rounds.map((g) => g.map((x) => ({ h: x.a, a: x.h })));
    return rounds.concat(second);
  }

  // The season: 38 league rounds with European nights slotted in: eight league-phase
  // matchdays in the autumn, two-legged knockout rounds in the spring, the final at the end.
  function makeCalendar(n) {
    const cal = [], lp = [1, 3, 5, 8, 10, 13, 17, 20];
    const ko = { 22: ['po', 0], 23: ['po', 1], 25: ['r16', 0], 26: ['r16', 1], 29: ['qf', 0], 30: ['qf', 1], 32: ['sf', 0], 33: ['sf', 1] };
    for (let r = 0; r < n; r++) {
      cal.push({ t: 'L', r });
      if (lp.includes(r)) cal.push({ t: 'C', k: 'lp', md: lp.indexOf(r) });
      if (ko[r]) cal.push({ t: 'C', k: ko[r][0], leg: ko[r][1] });
      if (r === n - 1) cal.push({ t: 'C', k: 'f', leg: 0 });
    }
    return cal;
  }

  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  // Poisson sample.
  function poisson(l) {
    const L = Math.exp(-l); let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  const L = (PP.League = {
    STYLES,
    s: null, // the season state

    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
        if (raw && raw.version === VERSION) {
          for (const t of raw.teams) Object.assign(t.kit, KIT_EXTRA[t.short] || {});
          L.s = raw; L._rc = {}; return true;
        }
      } catch (e) { /* none / bad save */ }
      L.s = null;
      return false;
    },
    save() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(L.s)); } catch (e) { /* storage full or blocked */ }
    },
    clear() { L.s = null; try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } },

    // A fresh season as club `clubId`. Squads, coins and the season count carry over from `prev`.
    newSeason(prev, clubId) {
      // A first season uses the squads shown in the club picker.
      const teams = prev ? CLUBS.map(clubDef) : JSON.parse(JSON.stringify(L.clubs()));
      for (const t of teams) {
        const old = prev && prev.teams.find((o) => o.id === t.id);
        if (old) {
          const drift = (pl) => (t.id === prev.userId ? pl : { ...pl, stats: Object.fromEntries(Object.entries(pl.stats).map(([k, v]) => [k, Math.round(U.clamp(v + U.gauss() * 1.5, 15, 99))])) });
          t.squad = old.squad.map(drift); t.bench = (old.bench || []).map(drift);
          t.formation = old.formation; if (t.id === prev.userId) t.style = old.style;
        }
        PP.ensureSquad(t);
      }
      const userId = prev ? prev.userId : clubId;
      // Champions League places: last season's top 4 (the first season, the 4 strongest squads).
      const english = prev ? L.table().slice(0, 4).map((r) => r.id) : null;
      const prevCl = prev && prev.cl;
      const ids = teams.map((t) => t.id);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      L._rc = {};
      const s = {
        version: VERSION,
        season: prev ? prev.season + 1 : 1,
        userId,
        teams,
        fixtures: makeFixtures(ids),
        round: 0,
        coins: prev ? prev.coins : 500,
        fans: prev ? Math.round(50 + (prev.fans - 50) * 0.5) : 55,
        board: prev ? Math.round(50 + (prev.board - 50) * 0.5) : 60,
        log: [],           // your results: { round, opp, home, gf, ga, coins, fans, board }
        over: false,
        calendar: makeCalendar(38),
        day: 0,
        pstats: { pl: {}, cl: {} }, // player stats this season, by competition -> club -> name
      };
      L.s = s;
      s.expected = L.expectedPosition(userId);
      PP.Europe.setup(s, english || L.ranked().slice(0, 4), prevCl);
      L.save();
      return s;
    },

    // Club list for the picker (fresh squads, so the star ratings are real).
    clubs() {
      if (!L._clubs) L._clubs = CLUBS.map(clubDef).map((t) => { PP.ensureSquad(t); return t; });
      return L._clubs;
    },

    clubDef,
    team(id) { return L.s.teams.find((t) => t.id === id) || (L.s.cl && L.s.cl.teams.find((t) => t.id === id)); },
    ranked() {
      const score = (t) => { const r = PP.teamRatings(t).raw; return r.att + r.mid + r.def; };
      return L.s.teams.slice().sort((a, b) => score(b) - score(a)).map((t) => t.id);
    },
    user() { return L.team(L.s.userId); },
    _rc: {},
    ratings(id) { return L._rc[id] || (L._rc[id] = PP.teamRatings(L.team(id))); },

    // Pre-season prediction: rank by overall rating.
    expectedPosition(id) { return L.ranked().indexOf(id) + 1; },

    current() { return L.s.calendar[L.s.day]; },

    // Your next game: { h, a, home, opp, comp: 'league' | 'cl', label, ko }, or null when the
    // current day is a European night you're not part of (see skipDays).
    nextFixture() {
      const s = L.s, e = L.current();
      if (!e) return null;
      if (e.t === 'L') {
        const g = s.fixtures[e.r].find((x) => x.h === s.userId || x.a === s.userId);
        return { ...g, home: g.h === s.userId, opp: g.h === s.userId ? g.a : g.h, comp: 'league', label: `Premier League · Round ${e.r + 1}` };
      }
      const E = PP.Europe, g = E.games(e).find((x) => x.h === s.userId || x.a === s.userId);
      if (!g) return null;
      const fx = { ...g, home: g.h === s.userId && !g.neutral, opp: g.h === s.userId ? g.a : g.h, comp: 'cl', ko: e.k !== 'lp', label: E.label(e) };
      const t = E.tieOf(e, g);
      if (t && !t.final && e.leg === 1) { // second leg: where the tie stands
        const [x, y] = E.agg(t), mine = t.a === s.userId;
        fx.agg = mine ? [x, y] : [y, x];
      }
      fx.decider = e.k === 'f' || e.leg === 1;
      return fx;
    },

    // Play through European nights you're not involved in. Returns how many were played.
    skipDays() {
      const s = L.s;
      let n = 0;
      while (s.day < s.calendar.length && L.current().t === 'C' && !L.nextFixture()) { PP.Europe.playDay(L.current(), null); s.day++; n++; }
      if (s.day >= s.calendar.length) s.over = true;
      if (n) L.save();
      return n;
    },

    // Statistical result between two clubs: goals from attack vs defence, midfield control
    // and a little home advantage.
    simulate(hId, aId, neutral = false) {
      const h = L.ratings(hId).raw, a = L.ratings(aId).raw;
      const lam = (att, def, mid, omid, home) => 1.3 * Math.exp(0.032 * (att - def) + 0.018 * (mid - omid)) * (neutral ? 1 : home ? 1.12 : 0.9);
      return [poisson(lam(h.att, a.def, h.mid, a.mid, true)), poisson(lam(a.att, h.def, a.mid, h.mid, false))];
    },

    // The match def for the opponent, in a change kit if theirs clashes with yours.
    oppDef(id) { return L.changeKit(L.user(), L.team(id)); },
    changeKit(u, t) {
      if (colDist(t.kit.shirt, u.kit.shirt) > 120 && colDist(t.kit.shorts, u.kit.shorts) > 60 || colDist(t.kit.shirt, u.kit.shirt) > 180) return t;
      const alt = colDist('#f4f4f4', u.kit.shirt) > colDist('#1b1b2f', u.kit.shirt) ? '#f4f4f4' : '#1b1b2f';
      return { ...t, kit: { shirt: alt, shade: alt === '#f4f4f4' ? '#b9b9b9' : '#0b0b16', shorts: t.kit.shirt, socks: alt } };
    },

    // ---- player stats ----
    // Season totals per player: apps, goals, assists, shots, tackles won, clean sheets (keepers).
    // Kept per competition ('pl', 'cl'), club id and player name.
    pstats(comp) {
      const s = L.s;
      if (!s.pstats) s.pstats = { pl: {}, cl: {} }; // saves from before player stats
      return s.pstats[comp] || (s.pstats[comp] = {});
    },
    // A played match: every line from the match (lines = [{ name, role, goals, ... }]).
    addLines(comp, clubId, lines, conceded) {
      const club = L.pstats(comp)[clubId] || (L.pstats(comp)[clubId] = {});
      for (const l of lines) {
        const r = club[l.name] || (club[l.name] = { apps: 0, g: 0, a: 0, sh: 0, tk: 0, cs: 0 });
        r.apps++; r.g += l.goals || 0; r.a += l.assists || 0; r.sh += l.shots || 0; r.tk += l.tackles || 0;
        if (l.role === 'GK' && conceded === 0) r.cs++;
      }
    },
    // A simulated match: hand the goals (and assists, three in four) to the XI by position and
    // finishing / creativity, so the scoring charts fill up for every club.
    simLines(clubId, goals, conceded) {
      const t = L.team(clubId), form = PP.FORMATIONS[t.formation];
      const xi = t.squad.slice(0, 11).map((pl, i) => ({ pl, role: form[i][0] }));
      const GW = { ST: 1, LW: 0.55, RW: 0.55, AM: 0.5, LM: 0.35, RM: 0.35, CM: 0.18, DM: 0.08, CB: 0.07, LB: 0.06, RB: 0.06, GK: 0 };
      const AW = { AM: 0.6, LW: 0.55, RW: 0.55, LM: 0.45, RM: 0.45, CM: 0.4, ST: 0.3, LB: 0.3, RB: 0.3, DM: 0.15, CB: 0.05, GK: 0.01 };
      const pick = (w, not) => {
        const ws = xi.map((x) => (x === not ? 0 : w(x)));
        let r = Math.random() * ws.reduce((a, v) => a + v, 0);
        for (let i = 0; i < xi.length; i++) { r -= ws[i]; if (r <= 0) return xi[i]; }
        return xi[0];
      };
      const lines = xi.map((x) => ({ name: x.pl.name, role: x.role, goals: 0, assists: 0 }));
      for (let k = 0; k < goals; k++) {
        const sc = pick((x) => (GW[x.role] ?? 0.1) * Math.pow(x.pl.stats.finishing / 75, 2));
        lines[xi.indexOf(sc)].goals++;
        if (Math.random() < 0.75) {
          const as = pick((x) => (AW[x.role] ?? 0.1) * (x.pl.stats.vision + x.pl.stats.crossing) / 150, sc);
          lines[xi.indexOf(as)].assists++;
        }
      }
      L.addLines('pl', clubId, lines, conceded);
    },
    // Leaders in a competition: [{ name, club, g, a, apps }] sorted by key.
    leaders(comp, key, n = 10) {
      const out = [];
      for (const [cid, club] of Object.entries(L.pstats(comp))) for (const [name, r] of Object.entries(club)) out.push({ name, club: cid, ...r });
      return out.filter((r) => r[key] > 0).sort((x, y) => y[key] - x[key] || (key === 'g' ? y.a - x.a : y.g - x.g) || x.apps - y.apps).slice(0, n);
    },
    // One player's season, all competitions together.
    playerSeason(clubId, name) {
      const sum = { apps: 0, g: 0, a: 0, sh: 0, tk: 0, cs: 0 };
      for (const comp of ['pl', 'cl']) { const r = (L.pstats(comp)[clubId] || {})[name]; if (r) for (const k in sum) sum[k] += r[k] || 0; }
      return sum;
    },

    // Record your result (goals for / against) and play out the rest of the round.
    // lines: the match's player lines ({ home, away } from Match.playerLines), if played.
    // Returns a summary for the results screen.
    finishRound(gf, ga, lines = null) {
      const s = L.s, fx = L.nextFixture(), e = L.current();
      if (fx.comp === 'cl') return L.finishEurope(gf, ga, fx, e, lines);
      if (lines) { L.addLines('pl', s.userId, lines.home, ga); L.addLines('pl', fx.opp, lines.away, gf); }
      const games = s.fixtures[e.r];
      for (const g of games) {
        if (g.hs != null) continue;
        if (g === games.find((x) => x.h === fx.h && x.a === fx.a)) {
          g.hs = fx.home ? gf : ga; g.as = fx.home ? ga : gf;
        } else {
          [g.hs, g.as] = L.simulate(g.h, g.a);
          L.simLines(g.h, g.hs, g.as); L.simLines(g.a, g.as, g.hs);
        }
      }
      const pts = gf > ga ? 3 : gf === ga ? 1 : 0;
      const before = { coins: s.coins, fans: s.fans, board: s.board };
      // Coins: result bonus, a bit per goal, and the gate for home games (bigger when fans are happy).
      const gate = fx.home ? Math.round(80 + s.fans * 2) : 0;
      const coins = { 3: 300, 1: 120, 0: 50 }[pts] + gf * 20 + gate;
      s.coins += coins;
      // Fans like winning and goals; hate losing, especially at home.
      // Moods drift back towards neutral, so a run of form matters more than one result.
      const dFans = (pts === 3 ? 3 : pts === 1 ? 0 : fx.home ? -5 : -4) + (gf >= 3 ? 1 : 0) - (ga - gf >= 3 ? 2 : 0) + (50 - s.fans) * 0.04;
      s.fans = Math.round(U.clamp(s.fans + dFans, 0, 100));
      // The board judges you against the points they expect from your pre-season ranking.
      const exPts = U.clamp(2.3 - (s.expected - 1) * 0.085, 0.6, 2.3);
      const dBoard = (pts - exPts) * 3.2 + (s.fans < 25 ? -1 : 0) + (50 - s.board) * 0.03;
      s.board = Math.round(U.clamp(s.board + dBoard, 0, 100));
      const entry = { round: s.round + 1, label: fx.label, opp: fx.opp, home: fx.home, gf, ga, coins, fans: s.fans - before.fans, board: s.board - before.board };
      s.log.push(entry);
      s.round++; s.day++;
      L.skipDays();
      if (s.day >= s.calendar.length || s.board <= 0) s.over = true;
      L.save();
      return { entry, games: games.map((g) => ({ ...g })), gate };
    },

    // A European night: prize money for results and progress, a lift for fans and board.
    finishEurope(gf, ga, fx, e, lines = null) {
      const s = L.s, E = PP.Europe, before = { coins: s.coins, fans: s.fans, board: s.board };
      if (lines) { L.addLines('cl', s.userId, lines.home, ga); L.addLines('cl', fx.opp, lines.away, gf); }
      const { games, mine } = E.playDay(e, { gf, ga });
      const gate = fx.home ? Math.round(200 + s.fans * 4) : 0;
      const won = gf > ga, drew = gf === ga;
      let coins = (won ? 400 : drew ? 150 : 50) + gf * 30 + gate, note = '', dFans = won ? 4 : drew ? 0 : -2, dBoard = won ? 2 : drew ? 0 : -1;
      let tieOut = null;
      if (e.k === 'lp' && e.md === 7) {
        const r = E.rank(s.userId);
        if (r <= 8) { coins += 1500; dBoard += 5; note = `Finished ${ord(r)} of 36: straight into the Round of 16!`; }
        else if (r <= 24) { coins += 600; note = `Finished ${ord(r)} of 36: into the knockout play-offs.`; }
        else { dBoard -= 4; note = `Finished ${ord(r)} of 36: out of Europe.`; }
      } else if (fx.decider) {
        const t = E.tieOf(e, mine), through = E.tieWinner(t) === s.userId;
        tieOut = { agg: t.final ? null : (t.a === s.userId ? E.agg(t) : E.agg(t).reverse()), pens: t.pens ? (mine.h === s.userId ? t.pens : t.pens.slice().reverse()) : null, through };
        if (through) {
          coins += { po: 800, r16: 1500, qf: 2500, sf: 4000, f: 8000 }[e.k];
          dFans += e.k === 'f' ? 15 : 3; dBoard += e.k === 'f' ? 15 : 4;
          note = e.k === 'f' ? 'CHAMPIONS OF EUROPE!' : `Through to the ${{ po: 'Round of 16', r16: 'quarter-finals', qf: 'semi-finals', sf: 'final' }[e.k]}!`;
        } else { note = e.k === 'f' ? 'Beaten in the final.' : 'Knocked out of Europe.'; dFans -= 2; }
      }
      s.coins += coins;
      s.fans = Math.round(U.clamp(s.fans + dFans, 0, 100));
      s.board = Math.round(U.clamp(s.board + dBoard, 0, 100));
      const entry = { label: fx.label, opp: fx.opp, home: fx.home, gf, ga, tie: tieOut, coins, fans: s.fans - before.fans, board: s.board - before.board, note, cl: true };
      s.log.push(entry);
      s.day++;
      L.skipDays();
      if (s.day >= s.calendar.length || s.board <= 0) s.over = true;
      L.save();
      return { entry, games: games.map((g) => ({ ...g })), gate, cl: e };
    },

    // League table rows, sorted: points, goal difference, goals for.
    table() {
      const rows = {};
      for (const t of L.s.teams) rows[t.id] = { id: t.id, name: t.name, short: t.short, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
      for (const round of L.s.fixtures) for (const g of round) {
        if (g.hs == null) continue;
        const h = rows[g.h], a = rows[g.a];
        h.p++; a.p++; h.gf += g.hs; h.ga += g.as; a.gf += g.as; a.ga += g.hs;
        if (g.hs > g.as) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
        else if (g.hs < g.as) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
        else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
      }
      return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || x.name.localeCompare(y.name));
    },
    position(id = L.s.userId) { return L.table().findIndex((r) => r.id === id) + 1; },

    // End of season: prize money by position and the board's verdict.
    seasonEnd() {
      const s = L.s, pos = L.position();
      const prize = Math.round(2000 * Math.pow(0.88, pos - 1));
      if (!s.prizePaid) { s.coins += prize; s.prizePaid = true; L.save(); }
      const diff = s.expected - pos;
      const sacked = s.board <= 0 || (s.board < 25 && diff < -3);
      const verdict = sacked ? 'The board has seen enough. You are sacked.'
        : diff >= 3 ? 'The board is delighted: far beyond expectations.'
        : diff >= 0 ? 'The board is satisfied: you met expectations.'
        : diff >= -3 ? 'The board is disappointed, but you keep your job.'
        : 'The board is furious. One more season like that...';
      return { pos, prize, verdict, sacked, europe: PP.Europe.status(), qualified: pos <= 4 };
    },
  });
})();
