// Headless AI-vs-AI simulation helpers for tuning. Use from the browser console:
//   PP.debug.sim(4)    -> per-half summaries
(function () {
  const noInput = { axis: () => ({ x: 0, y: 0 }), down: () => false, hit: () => false, released: () => false };

  function half(homeDef, awayDef) {
    const m = new PP.Match(homeDef || PP.TEAM_DEFS[0], awayDef || PP.TEAM_DEFS[1], { fullCourt: true });
    m.autoplay = true;
    const r = { passOk: 0, passInt: 0, lobOk: 0, lobInt: 0, tackles: 0, restarts: {}, owned: 0, steps: 0, thirds: [0, 0, 0] };
    let pending = null;
    const rel = m.release.bind(m);
    m.release = (p, t, tg) => {
      pending = t === 'pass' ? { team: p.team, lob: m.ball.vz > 0 } : null;
      rel(p, t, tg);
    };
    const gain = m.gainPossession.bind(m);
    m.gainPossession = (p) => {
      if (pending) {
        const ok = p.team === pending.team;
        if (pending.lob) ok ? r.lobOk++ : r.lobInt++;
        else ok ? r.passOk++ : r.passInt++;
        pending = null;
      }
      gain(p);
    };
    const rt = m.resolveTackle.bind(m);
    m.resolveTackle = (a, b, c) => { r.tackles++; rt(a, b, c); };
    while (m.state !== 'halftime') {
      m.step(PP.C.DT, noInput);
      r.steps++;
      if (m.state === 'restart' && m.restart.t < PP.C.DT * 1.01) r.restarts[m.restart.kind] = (r.restarts[m.restart.kind] || 0) + 1;
      if (m.ball.owner) r.owned++;
      r.thirds[Math.min(2, Math.max(0, Math.floor(m.ball.x / 35)))]++;
    }
    return {
      score: m.score.join('-'), shots: m.stats.shots.join('/'), onT: m.stats.onTarget.join('/'),
      pass: `${r.passOk}/${r.passOk + r.passInt}`, lob: `${r.lobOk}/${r.lobOk + r.lobInt}`,
      tackles: r.tackles, restarts: JSON.stringify(r.restarts),
      owned: Math.round((100 * r.owned) / r.steps) + '%',
      thirds: r.thirds.map((v) => Math.round((100 * v) / r.steps)).join('/'),
    };
  }

  // Central-midfield hold test: whenever a team receives in central midfield, its carrier
  // holds the ball (jogging forward, no pass) for up to 3s, the way a user looks for a pass.
  // Reports how often it's lost and, at 0.5/1.5/2.5s, the forward central options (team-mates
  // ahead, within 30m, in the middle 24m), how many are open (no defender within 4m), and the
  // pressure on the carrier.
  function hold(halves) {
    const C = PP.C, AI = PP.AI, car0 = AI.carrier;
    const R = { n: 0, lost: 0, k: [0, 0, 0], opts: [0, 0, 0], open: [0, 0, 0], near: [0, 0, 0], defs: [0, 0, 0] };
    AI.carrier = function (m, p, dt) {
      if (m._hold && m._hold.p === p) { p.steer(p.x + p.team.dir * 3, p.y, false, 0.5); return; }
      return car0(m, p, dt);
    };
    try {
      for (let h = 0; h < halves; h++) {
        const m = new PP.Match(PP.TEAM_DEFS[h % 2], PP.TEAM_DEFS[1 - (h % 2)], { fullCourt: true });
        m.autoplay = true;
        let cool = 0;
        while (m.state !== 'halftime') {
          m.step(C.DT, noInput);
          const o = m.ball.owner;
          if (m._hold) {
            const H = m._hold, el = m.time - H.t;
            if (o !== H.p || m.state !== 'play') {
              if (!o || o.team !== H.p.team) R.lost++;
              m._hold = null; cool = m.time + 5; continue;
            }
            [0.5, 1.5, 2.5].forEach((T, i) => {
              if (el < T || H.done[i]) return;
              H.done[i] = 1; R.k[i]++;
              const at = o.team, df = m.other(at), bd = at.depth(o.x), dfs = df.outfield();
              for (const q of at.outfield()) {
                if (q === o) continue;
                const fwd = (at.depth(q.x) - bd) * C.W;
                if (fwd < 3 || U.dist(q.x, q.y, o.x, o.y) > 30 || Math.abs(q.y - C.H / 2) > 12) continue;
                R.opts[i]++;
                if (dfs.every((z) => U.dist(z.x, z.y, q.x, q.y) > 4)) R.open[i]++;
              }
              R.near[i] += Math.min(...dfs.map((z) => U.dist(z.x, z.y, o.x, o.y)));
              R.defs[i] += dfs.filter((z) => U.dist(z.x, z.y, o.x, o.y) < 10).length;
            });
            if (el > 3) { m._hold = null; cool = m.time + 5; }
          } else if (o && !o.isGK && m.state === 'play' && m.time > cool && m.time - (o.gotBallAt || 0) < 0.1) {
            const bd = o.team.depth(o.x);
            if (bd > 0.35 && bd < 0.62 && Math.abs(o.y - C.H / 2) < 9) { m._hold = { p: o, t: m.time, done: [] }; R.n++; }
          }
        }
      }
    } finally { AI.carrier = car0; }
    const f = (a) => a.map((v, i) => (v / Math.max(1, R.k[i])).toFixed(2)).join(' / ');
    return { trials: R.n, lost: Math.round((100 * R.lost) / R.n) + '%', opts: f(R.opts), open: f(R.open), nearest: f(R.near), within10: f(R.defs) };
  }

  // Side-by-side halves for tuning the CPU against your side (home is the "user" team, so it gets
  // the user-side tackling etc.). flags are AI.TUNE overrides; the old values come back after.
  //   PP.debug.ab(12, 'ars', 'eve', { playOut: false })
  function ab(n, hId, aId, flags = {}, hStyle = null) {
    const L = PP.League, def = (id) => JSON.parse(JSON.stringify([...L.clubs(), ...PP.Europe.clubs()].find((c) => c.id === id)));
    const h = def(hId), a = def(aId);
    if (hStyle) Object.assign(h.style, hStyle);
    const saved = { ...PP.AI.TUNE }; Object.assign(PP.AI.TUNE, flags);
    const T = { g: [0, 0], sh: [0, 0], onT: [0, 0], pOk: [0, 0], pAll: [0, 0], poss: [0, 0], into: 0, fk: 0, cards: 0 };
    try {
      for (let i = 0; i < n; i++) {
        const m = new PP.Match(h, a, { fullCourt: true }); m.autoplay = true;
        let pend = null; const rel = m.release.bind(m);
        m.release = (p, t, tg) => { pend = t === 'pass' ? p.team : null; rel(p, t, tg); };
        const gain = m.gainPossession.bind(m);
        m.gainPossession = (p) => { if (pend) { const k = m.idx(pend); T.pAll[k]++; if (p.team === pend) T.pOk[k]++; pend = null; } gain(p); };
        let inOpp = false;
        while (m.state !== 'halftime') {
          m.step(PP.C.DT, noInput);
          if (m.state === 'restart' && m.restart.t < PP.C.DT * 1.01 && m.restart.kind === 'freekick') T.fk++;
          const o = m.ball.owner;
          if (o && o.team === m.away && m.away.depth(m.ball.x) > 0.5 && !inOpp) { T.into++; inOpp = true; }
          if (o && o.team === m.home) inOpp = false;
        }
        T.cards += m.events.filter((e) => e.type === 'card').length;
        for (const k of [0, 1]) { T.g[k] += m.score[k]; T.sh[k] += m.stats.shots[k]; T.onT[k] += m.stats.onTarget[k]; T.poss[k] += m.stats.poss[k]; }
      }
    } finally { Object.assign(PP.AI.TUNE, saved); }
    const per = (v) => (v / n).toFixed(2);
    return {
      goals: T.g.map(per).join(' - '), shots: T.sh.map(per).join(' / '), onTarget: T.onT.map(per).join(' / '),
      awayPass: Math.round((100 * T.pOk[1]) / Math.max(1, T.pAll[1])) + '%', awayPoss: Math.round((100 * T.poss[1]) / (T.poss[0] + T.poss[1])) + '%',
      awayIntoOppHalf: per(T.into), freeKicks: per(T.fk), cards: per(T.cards),
    };
  }

  const U = PP.U;
  PP.debug = {
    ab(n = 12, h = 'ars', a = 'eve', flags = {}, hStyle = null) { const r = ab(n, h, a, flags, hStyle); console.table([r]); return r; },
    hold(n = 8) { const r = hold(n); console.table([r]); return r; },
    sim(n = 4, h, a) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(half(h, a));
      console.table(out);
      return out;
    },
  };
})();
