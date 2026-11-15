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

  PP.debug = {
    sim(n = 4, h, a) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(half(h, a));
      console.table(out);
      return out;
    },
  };
})();
