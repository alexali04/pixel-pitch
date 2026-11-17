// The Champions League, current format: a 36-club league phase (8 games each against
// different opponents, two from each pot), then 1st-8th go straight to the Round of 16 and
// 9th-24th play two-legged knockout play-offs for the other eight places. Two-legged Round of
// 16, quarter-finals and semi-finals, then a one-off final. Matchdays sit between league
// rounds in the season calendar (see league.js).
(function () {
  const U = PP.U;

  // [name, short, shirt, shorts, rating, formation, style index, country]
  const EURO = [
    ['Real Madrid', 'RMA', '#f4f4f4', '#f4f4f4', 84, '4-3-3', 3, 'ESP'],
    ['Barcelona', 'BAR', '#a50044', '#004d98', 83, '4-3-3', 4, 'ESP'],
    ['Bayern Munich', 'BAY', '#dc052d', '#dc052d', 83, '4-2-3-1', 4, 'GER'],
    ['Paris Saint-Germain', 'PSG', '#004170', '#004170', 83, '4-3-3', 4, 'FRA'],
    ['Inter', 'INT', '#0068a8', '#1e1e1e', 80, '4-3-1-2', 2, 'ITA'],
    ['Atlético Madrid', 'ATM', '#cb3524', '#1b3a6b', 79, '4-4-2', 0, 'ESP'],
    ['Borussia Dortmund', 'BVB', '#fde100', '#1e1e1e', 78, '4-2-3-1', 4, 'GER'],
    ['Bayer Leverkusen', 'B04', '#e32221', '#1e1e1e', 78, '3-4-3', 5, 'GER'],
    ['Napoli', 'NAP', '#12a0d7', '#f4f4f4', 78, '4-3-3', 3, 'ITA'],
    ['Juventus', 'JUV', '#f4f4f4', '#1e1e1e', 77, '4-3-3', 2, 'ITA'],
    ['AC Milan', 'MIL', '#fb090b', '#f4f4f4', 77, '4-2-3-1', 3, 'ITA'],
    ['Atalanta', 'ATA', '#1e71b8', '#1e1e1e', 77, '3-4-3', 4, 'ITA'],
    ['Benfica', 'BEN', '#e83030', '#f4f4f4', 76, '4-2-3-1', 3, 'POR'],
    ['Sporting CP', 'SCP', '#008057', '#f4f4f4', 76, '3-4-3', 3, 'POR'],
    ['RB Leipzig', 'RBL', '#f4f4f4', '#dd0741', 76, '4-2-3-1', 4, 'GER'],
    ['Villarreal', 'VIL', '#ffe667', '#ffe667', 76, '4-4-2', 2, 'ESP'],
    ['Porto', 'POR', '#00428c', '#f4f4f4', 75, '4-3-3', 2, 'POR'],
    ['Athletic Club', 'ATH', '#ee2523', '#1e1e1e', 75, '4-2-3-1', 5, 'ESP'],
    ['Roma', 'ROM', '#8e1f2f', '#f4f4f4', 75, '3-4-3', 2, 'ITA'],
    ['Marseille', 'MRS', '#2faee0', '#f4f4f4', 75, '4-3-3', 4, 'FRA'],
    ['PSV', 'PSV', '#ed1c24', '#f4f4f4', 75, '4-3-3', 4, 'NED'],
    ['Eintracht Frankfurt', 'SGE', '#1e1e1e', '#1e1e1e', 75, '3-4-3', 3, 'GER'],
    ['Monaco', 'MON', '#e51b22', '#f4f4f4', 75, '4-4-2', 3, 'FRA'],
    ['Galatasaray', 'GAL', '#a90432', '#fdb912', 74, '4-2-3-1', 3, 'TUR'],
    ['Lille', 'LIL', '#e01e13', '#1b2a4a', 74, '4-2-3-1', 2, 'FRA'],
    ['Feyenoord', 'FEY', '#e4002b', '#1e1e1e', 74, '4-3-3', 4, 'NED'],
    ['Stuttgart', 'VFB', '#f4f4f4', '#f4f4f4', 74, '4-2-3-1', 4, 'GER'],
    ['Fenerbahçe', 'FEN', '#163962', '#f4f4f4', 73, '4-2-3-1', 3, 'TUR'],
    ['Ajax', 'AJA', '#d2122e', '#f4f4f4', 73, '4-3-3', 3, 'NED'],
    ['Club Brugge', 'BRU', '#0067b1', '#1e1e1e', 73, '4-3-3', 3, 'BEL'],
    ['Celtic', 'CEL', '#018749', '#f4f4f4', 72, '4-3-3', 3, 'SCO'],
    ['Olympiacos', 'OLY', '#e3001b', '#f4f4f4', 72, '4-2-3-1', 2, 'GRE'],
    ['Bodø/Glimt', 'BOD', '#ffd200', '#1e1e1e', 71, '4-3-3', 4, 'NOR'],
    ['Union Saint-Gilloise', 'USG', '#ffd000', '#1b3a8c', 71, '3-4-3', 5, 'BEL'],
    ['Shakhtar Donetsk', 'SHA', '#f58220', '#1e1e1e', 71, '4-2-3-1', 3, 'UKR'],
    ['Red Bull Salzburg', 'RBS', '#f4f4f4', '#dd0741', 71, '4-4-2', 5, 'AUT'],
    ['Slavia Prague', 'SLA', '#d7141a', '#f4f4f4', 70, '3-4-3', 5, 'CZE'],
    ['Copenhagen', 'COP', '#f4f4f4', '#0a2a66', 70, '4-4-2', 2, 'DEN'],
    ['Young Boys', 'YBB', '#fdd700', '#1e1e1e', 69, '4-4-2', 4, 'SUI'],
    ['Dinamo Zagreb', 'DIN', '#0a4ea2', '#0a4ea2', 69, '4-2-3-1', 3, 'CRO'],
    ['Qarabağ', 'QAR', '#1e1e1e', '#1e1e1e', 68, '4-2-3-1', 3, 'AZE'],
  ];
  const NATION = Object.fromEntries(EURO.map((c) => [c[1].toLowerCase(), c[7]]));
  const STAGES = ['po', 'r16', 'qf', 'sf', 'f'];
  const STAGE_NAME = { lp: 'League phase', po: 'Knockout play-off', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', f: 'Final' };
  const NEXT_NAME = { po: 'Round of 16', r16: 'quarter-finals', qf: 'semi-finals', sf: 'final' };

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // Eight league-phase matchdays: each one a perfect matching of the 36 clubs, with no repeat
  // opponents, no clubs from the same country, and at most two opponents from any one pot.
  function leaguePhase(ids, potOf, nation) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const met = Object.fromEntries(ids.map((id) => [id, new Set()]));
      const potCount = Object.fromEntries(ids.map((id) => [id, [0, 0, 0, 0]]));
      const homes = Object.fromEntries(ids.map((id) => [id, 0]));
      const rounds = [];
      let ok = true;
      for (let r = 0; r < 8 && ok; r++) {
        let pairs = null;
        for (let t = 0; t < 400 && !pairs; t++) {
          const free = new Set(ids), out = [];
          // most-constrained first: start from a random order and pick partners greedily
          for (const a of shuffle(ids.slice())) {
            if (!free.has(a)) continue;
            free.delete(a);
            const cands = [...free].filter((b) => !met[a].has(b) && nation(a) !== nation(b) &&
              potCount[a][potOf[b]] < 2 && potCount[b][potOf[a]] < 2);
            if (!cands.length) { out.length = 0; break; }
            const b = cands[Math.floor(Math.random() * cands.length)];
            free.delete(b);
            out.push([a, b]);
          }
          if (out.length === ids.length / 2) pairs = out;
        }
        if (!pairs) { ok = false; break; }
        rounds.push(pairs.map(([a, b]) => {
          met[a].add(b); met[b].add(a); potCount[a][potOf[b]]++; potCount[b][potOf[a]]++;
          const aHome = homes[a] < homes[b] || (homes[a] === homes[b] && Math.random() < 0.5);
          const h = aHome ? a : b, w = aHome ? b : a;
          homes[h]++;
          return { h, a: w };
        }));
      }
      if (ok) return rounds;
    }
    // Fallback (shouldn't happen): a plain random schedule without the pot rule.
    return Array.from({ length: 8 }, () => { const o = shuffle(ids.slice()); return Array.from({ length: 18 }, (_, i) => ({ h: o[2 * i], a: o[2 * i + 1] })); });
  }

  const E = (PP.Europe = {
    STAGES, STAGE_NAME,

    // Every European club with a squad (for friendlies): this season's sides where the season
    // has them (the same players you met in the Champions League), else a squad made once.
    clubs() {
      const L = PP.League, cl = L.s && L.s.cl;
      if (!E._clubs) E._clubs = EURO.map((c, i) => L.clubDef(c, i)).map((t) => { PP.ensureSquad(t); return t; });
      return E._clubs.map((t) => (cl && cl.teams.find((x) => x.id === t.id)) || t);
    },

    // Set up this season's competition. english = the 4 qualifying league clubs (ids).
    setup(s, english, prevCl) {
      const L = PP.League;
      const pool = EURO.map((c, i) => L.clubDef(c, i));
      if (prevCl) for (const t of pool) { const o = prevCl.teams.find((x) => x.id === t.id); if (o) { t.squad = o.squad; t.bench = o.bench; } }
      pool.forEach(PP.ensureSquad);
      // The 20 strongest always qualify; 12 more from the rest.
      const euro = pool.slice(0, 20).concat(shuffle(pool.slice(20)).slice(0, 12));
      s.cl = { teams: euro, english, md: [], ko: {}, winner: null };
      const ids = english.concat(euro.map((t) => t.id));
      const sorted = ids.slice().sort((a, b) => L.team(b).rating - L.team(a).rating);
      const potOf = Object.fromEntries(sorted.map((id, i) => [id, Math.floor(i / 9)]));
      s.cl.ids = ids; s.cl.pot = potOf;
      s.cl.md = leaguePhase(ids, potOf, E.nation);
    },
    nation(id) { return NATION[id] || 'ENG'; },

    // League-phase standings (sorted).
    table() {
      const cl = PP.League.s.cl, rows = {};
      for (const id of cl.ids) rows[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
      for (const day of cl.md) for (const x of day) {
        if (x.hs == null) continue;
        const h = rows[x.h], a = rows[x.a];
        h.p++; a.p++; h.gf += x.hs; h.ga += x.as; a.gf += x.as; a.ga += x.hs;
        if (x.hs > x.as) { h.w++; a.l++; h.pts += 3; } else if (x.hs < x.as) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
      }
      return Object.values(rows).sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
    },
    rank(id) { return E.table().findIndex((r) => r.id === id) + 1; },

    // Aggregate score of a tie for [a, b] (a = the seeded side, at home in the second leg).
    agg(t) {
      const [l1, l2] = t.legs;
      return [(l1.as ?? 0) + (l2.hs ?? 0), (l1.hs ?? 0) + (l2.as ?? 0)];
    },
    tieWinner(t) {
      if (t.final) return t.legs[0].hs > t.legs[0].as ? t.legs[0].h : t.legs[0].hs < t.legs[0].as ? t.legs[0].a : (t.pens[0] > t.pens[1] ? t.legs[0].h : t.legs[0].a);
      const [x, y] = E.agg(t);
      return x > y ? t.a : x < y ? t.b : t.pens[0] > t.pens[1] ? t.a : t.b;
    },
    tieDone(t) { return t.legs[t.legs.length - 1].hs != null; },
    // A two-legged tie between two clubs; the better league-phase finisher hosts the second leg.
    tie(x, y) {
      const tbl = E.table(), r = (id) => tbl.findIndex((q) => q.id === id);
      const [a, b] = r(x) <= r(y) ? [x, y] : [y, x];
      return { a, b, legs: [{ h: b, a }, { h: a, a: b }], pens: null };
    },

    // Build a knockout round when its first leg comes round.
    buildRound(k) {
      const cl = PP.League.s.cl, tbl = E.table().map((r) => r.id);
      if (k === 'po') cl.ko.po = Array.from({ length: 8 }, (_, i) => E.tie(tbl[8 + i], tbl[23 - i]));        // 9v24 ... 16v17
      else if (k === 'r16') cl.ko.r16 = Array.from({ length: 8 }, (_, i) => E.tie(tbl[i], E.tieWinner(cl.ko.po[7 - i]))); // 1 v (16/17) ... 8 v (9/24)
      else if (k === 'qf') { const w = cl.ko.r16.map(E.tieWinner); cl.ko.qf = [[0, 7], [3, 4], [1, 6], [2, 5]].map(([i, j]) => E.tie(w[i], w[j])); }
      else if (k === 'sf') { const w = cl.ko.qf.map(E.tieWinner); cl.ko.sf = [E.tie(w[0], w[1]), E.tie(w[2], w[3])]; }
      else { const w = cl.ko.sf.map(E.tieWinner); cl.ko.f = [{ a: w[0], b: w[1], final: true, legs: [{ h: w[0], a: w[1], neutral: true }], pens: null }]; }
    },

    // The games for a calendar entry ({ k: 'lp', md } or { k: stage, leg }).
    games(entry) {
      const cl = PP.League.s.cl;
      if (entry.k === 'lp') return cl.md[entry.md];
      if (!cl.ko[entry.k]) E.buildRound(entry.k);
      return cl.ko[entry.k].map((t) => t.legs[entry.leg || 0]);
    },
    tieOf(entry, game) { return entry.k === 'lp' ? null : PP.League.s.cl.ko[entry.k].find((t) => t.legs.includes(game)); },

    label(entry) {
      if (entry.k === 'lp') return `Champions League · League phase · Matchday ${entry.md + 1}`;
      if (entry.k === 'f') return 'Champions League · Final';
      return `Champions League · ${STAGE_NAME[entry.k]} · ${entry.leg ? '2nd' : '1st'} leg`;
    },

    // Penalty shootout [first, second]: five each, then sudden death. Keepers tilt the odds.
    shootout(hId, aId) {
      const L = PP.League, gk = (id) => L.ratings(id).raw.gk;
      const p = (shooter, keeper) => U.clamp(0.76 - (gk(keeper) - 70) * 0.004 + (L.ratings(shooter).raw.att - 70) * 0.003, 0.55, 0.9);
      let h = 0, a = 0;
      for (let k = 0; k < 5; k++) {
        if (Math.random() < p(hId, aId)) h++;
        if (h > a + (5 - k)) break;
        if (Math.random() < p(aId, hId)) a++;
        if (a > h + (4 - k) || h > a + (4 - k)) break;
      }
      while (h === a) { if (Math.random() < p(hId, aId)) h++; if (Math.random() < p(aId, hId)) a++; }
      return [h, a];
    },

    // Play out a European night. user = { gf, ga } for your game, if you have one.
    playDay(entry, user) {
      const L = PP.League, s = L.s, cl = s.cl, games = E.games(entry);
      let mine = null;
      for (const x of games) {
        if (x.hs != null) continue;
        if (user && (x.h === s.userId || x.a === s.userId)) {
          const home = x.h === s.userId;
          x.hs = home ? user.gf : user.ga; x.as = home ? user.ga : user.gf;
          mine = x;
        } else [x.hs, x.as] = L.simulate(x.h, x.a, x.neutral);
      }
      // Ties decided tonight that are still level go to penalties (taken by the side at home).
      if (entry.k !== 'lp' && (entry.k === 'f' || entry.leg === 1)) {
        for (const t of cl.ko[entry.k]) {
          const last = t.legs[t.legs.length - 1];
          const level = t.final ? last.hs === last.as : E.agg(t)[0] === E.agg(t)[1];
          if (level && !t.pens) t.pens = E.shootout(last.h, last.a);
        }
      }
      if (entry.k === 'f') cl.winner = E.tieWinner(cl.ko.f[0]);
      return { games, mine };
    },

    // Your European season so far, as a phrase.
    status() {
      const L = PP.League, s = L.s, cl = s.cl, u = s.userId;
      if (!cl || !cl.english.includes(u)) return null;
      if (cl.winner === u) return 'Champions of Europe!';
      for (const k of STAGES.slice().reverse()) {
        const t = cl.ko[k] && cl.ko[k].find((x) => x.a === u || x.b === u);
        if (!t) continue;
        const nm = k === 'r16' ? 'Round of 16' : STAGE_NAME[k].toLowerCase();
        if (!E.tieDone(t)) return `In the ${k === 'f' ? 'final' : nm}`;
        return E.tieWinner(t) === u ? `Through to the ${NEXT_NAME[k]}` : k === 'f' ? 'Lost the final' : `Out in the ${nm}`;
      }
      const played = cl.md.every((d) => d.every((x) => x.hs != null));
      const r = E.rank(u);
      const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
      if (!played) return `League phase: ${ord(r)} of 36`;
      return r <= 8 ? `${ord(r)}: straight into the Round of 16` : r <= 24 ? `${ord(r)}: into the knockout play-offs` : `Out: ${ord(r)} in the league phase`;
    },
  });
})();
