(function () {
  const C = PP.C, U = PP.U;

  // Formation slots: [role, depth from own goal (0..1), lateral position (0 = top touchline .. 1 = bottom)].
  PP.FORMATIONS = {
    '4-4-2': [
      ['GK', 0, 0.5],
      ['LB', 0.2, 0.13], ['CB', 0.16, 0.38], ['CB', 0.16, 0.62], ['RB', 0.2, 0.87],
      ['LM', 0.44, 0.13], ['CM', 0.4, 0.39], ['CM', 0.4, 0.61], ['RM', 0.44, 0.87],
      ['ST', 0.62, 0.4], ['ST', 0.62, 0.6],
    ],
    '4-3-3': [
      ['GK', 0, 0.5],
      ['LB', 0.2, 0.13], ['CB', 0.16, 0.38], ['CB', 0.16, 0.62], ['RB', 0.2, 0.87],
      ['DM', 0.33, 0.5], ['CM', 0.44, 0.3], ['CM', 0.44, 0.7],
      ['LW', 0.63, 0.14], ['ST', 0.67, 0.5], ['RW', 0.63, 0.86],
    ],
    '4-1-4-1': [
      ['GK', 0, 0.5],
      ['LB', 0.2, 0.13], ['CB', 0.16, 0.38], ['CB', 0.16, 0.62], ['RB', 0.2, 0.87],
      ['DM', 0.31, 0.5],
      ['LM', 0.47, 0.14], ['CM', 0.45, 0.36], ['CM', 0.45, 0.64], ['RM', 0.47, 0.86],
      ['ST', 0.66, 0.5],
    ],
    '4-3-1-2': [
      ['GK', 0, 0.5],
      ['LB', 0.2, 0.13], ['CB', 0.16, 0.38], ['CB', 0.16, 0.62], ['RB', 0.2, 0.87],
      ['DM', 0.32, 0.5], ['CM', 0.42, 0.28], ['CM', 0.42, 0.72],
      ['AM', 0.54, 0.5],
      ['ST', 0.65, 0.38], ['ST', 0.65, 0.62],
    ],
    '3-4-3': [
      ['GK', 0, 0.5],
      ['CB', 0.16, 0.26], ['CB', 0.15, 0.5], ['CB', 0.16, 0.74],
      ['LM', 0.4, 0.1], ['CM', 0.38, 0.38], ['CM', 0.38, 0.62], ['RM', 0.4, 0.9],
      ['LW', 0.62, 0.18], ['ST', 0.67, 0.5], ['RW', 0.62, 0.82],
    ],
    '4-2-3-1': [
      ['GK', 0, 0.5],
      ['LB', 0.2, 0.13], ['CB', 0.16, 0.38], ['CB', 0.16, 0.62], ['RB', 0.2, 0.87],
      ['DM', 0.33, 0.38], ['DM', 0.33, 0.62],
      ['LW', 0.53, 0.15], ['AM', 0.54, 0.5], ['RW', 0.53, 0.85],
      ['ST', 0.67, 0.5],
    ],
  };

  // Every outfield + keeper attribute. Stage 3 wires all of these into the simulation.
  PP.STAT_KEYS = [
    'pace', 'acceleration', 'stamina', 'strength', 'agility',
    'finishing', 'shotPower', 'longShots', 'composure',
    'shortPass', 'longPass', 'vision', 'crossing',
    'dribbling', 'firstTouch',
    'tackling', 'marking', 'positioning', 'heading',
    'reflexes', 'diving', 'handling', 'gkPositioning', 'kicking',
  ];
  const GK_KEYS = ['reflexes', 'diving', 'handling', 'gkPositioning', 'kicking'];

  const PROFILE = {
    GK: { reflexes: 12, diving: 10, handling: 8, gkPositioning: 10, kicking: 2, pace: -18, acceleration: -10, finishing: -40, dribbling: -30, tackling: -35, shotPower: -10 },
    CB: { tackling: 10, marking: 10, positioning: 8, strength: 10, heading: 10, finishing: -25, dribbling: -12, pace: -9, acceleration: -8, agility: -6 },
    LB: { pace: 6, stamina: 6, crossing: 4, tackling: 4, marking: 3, finishing: -18 },
    RB: { pace: 6, stamina: 6, crossing: 4, tackling: 4, marking: 3, finishing: -18 },
    DM: { tackling: 7, positioning: 6, shortPass: 6, stamina: 4, marking: 5, finishing: -12 },
    CM: { shortPass: 8, vision: 6, stamina: 6, longPass: 4, firstTouch: 3 },
    AM: { vision: 8, dribbling: 6, shortPass: 6, longShots: 5, firstTouch: 6, tackling: -12, marking: -10 },
    LM: { pace: 10, acceleration: 10, dribbling: 6, crossing: 8, tackling: -8, marking: -8 },
    RM: { pace: 10, acceleration: 10, dribbling: 6, crossing: 8, tackling: -8, marking: -8 },
    LW: { pace: 14, acceleration: 13, dribbling: 9, agility: 8, crossing: 6, tackling: -14, marking: -14, strength: -8 },
    RW: { pace: 14, acceleration: 13, dribbling: 9, agility: 8, crossing: 6, tackling: -14, marking: -14, strength: -8 },
    ST: { finishing: 12, shotPower: 7, heading: 5, composure: 7, strength: 4, tackling: -20, marking: -20, positioning: -10 },
  };

  const FIRST = 'ABCDEFGHJKLMNOPRSTVWZ';
  const SYL_A = ['Bran', 'Cole', 'Dun', 'Fen', 'Gar', 'Hal', 'Kes', 'Lor', 'Mar', 'Nor', 'Pell', 'Quin', 'Rook', 'Sal', 'Tam', 'Vey', 'Wyn', 'Yar', 'Osk', 'Ibb', 'Ard', 'Bel', 'Cor', 'Del', 'Est', 'Fal', 'Gil', 'Hux', 'Jor', 'Lin'];
  const SYL_B = ['by', 'ford', 'ley', 'ton', 'wick', 'more', 'dale', 'son', 'ett', 'ard', 'ish', 'ane', 'oza', 'ini', 'ovic', 'sen', 'ez', 'ard', 'holm', 'ski', 'aro', 'elli', 'ou', 'ic'];
  const SKIN = ['#f1c9a5', '#e0ac7e', '#c68642', '#a0663a', '#7a4a2a', '#58351e'];
  const HAIR = ['#1b1209', '#3b2412', '#6a3e1d', '#a5682a', '#d8b46a', '#e8e0d0', '#2a1d16', '#111111'];

  function makeName() {
    return FIRST[Math.floor(Math.random() * FIRST.length)] + '. ' + U.pick(SYL_A) + U.pick(SYL_B);
  }

  function makeStats(role, rating) {
    const prof = PROFILE[role] || {};
    const s = {};
    for (const k of PP.STAT_KEYS) {
      let base = rating;
      if (role !== 'GK' && GK_KEYS.includes(k)) base = 20;
      s[k] = Math.round(U.clamp(base + (prof[k] || 0) + U.gauss() * 5, 15, 99));
    }
    return s;
  }

  // A one-word characteristic from a player's standout attribute.
  const TRAITS = [
    ['pace', 85, 'Speedster'], ['dribbling', 85, 'Dribbler'], ['finishing', 85, 'Finisher'],
    ['vision', 84, 'Playmaker'], ['shortPass', 86, 'Metronome'], ['tackling', 85, 'Destroyer'],
    ['heading', 86, 'Aerial threat'], ['strength', 87, 'Powerhouse'], ['stamina', 87, 'Engine'],
    ['reflexes', 86, 'Shot-stopper'], ['crossing', 85, 'Crosser'], ['longShots', 85, 'Long-range'],
  ];
  PP.traitFor = (role, s) => {
    let best = null, margin = 0;
    for (const [k, min, name] of TRAITS) {
      if ((role === 'GK') !== (k === 'reflexes')) continue;
      if (s[k] - min > margin - 0.001 && s[k] >= min) { margin = s[k] - min; best = name; }
    }
    return best;
  };

  function makePlayer(role, rating, num, used) {
    let name;
    do { name = makeName(); } while (used.has(name));
    used.add(name);
    const stats = makeStats(role, rating + U.rand(-4, 4));
    return {
      name, num, stats, pos: role, // pos = natural position
      foot: Math.random() < 0.25 ? 'L' : 'R',
      trait: PP.traitFor(role, stats),
      look: { skin: U.pick(SKIN), hair: U.pick(HAIR) },
    };
  }

  PP.makeSquad = function (formation, rating, used = new Set()) {
    return PP.FORMATIONS[formation].map((slot, i) =>
      makePlayer(slot[0], rating, i === 0 ? 1 : [2, 5, 4, 3, 6, 8, 10, 7, 9, 11][i - 1], used));
  };
  // Seven substitutes: a keeper and cover across the pitch, a little weaker than the XI.
  const BENCH_ROLES = ['GK', 'CB', 'LB', 'DM', 'CM', 'RW', 'ST'];
  PP.makeBench = function (rating, squad) {
    const used = new Set(squad.map((p) => p.name));
    return BENCH_ROLES.map((r, i) => makePlayer(r, rating - 3, [13, 15, 12, 16, 14, 17, 19][i], used));
  };
  // Older saves / squads without natural positions or a bench.
  PP.ensureBench = (def) => {
    const form = PP.FORMATIONS[def.formation];
    def.squad.forEach((pl, i) => { if (!pl.pos) pl.pos = form[i][0]; });
    if (!def.bench) def.bench = PP.makeBench(def.rating, def.squad);
    return def.bench;
  };

  // Re-arrange a def's XI into `formation`: each slot gets the best-suited player left
  // (keeper first, then the slots in order).
  PP.setFormation = (def, formation) => {
    const form = PP.FORMATIONS[formation], pool = def.squad.slice(), out = [];
    const order = form.map((_, i) => i).sort((a, b) => (form[a][0] === 'GK' ? -1 : form[b][0] === 'GK' ? 1 : 0));
    for (const i of order) {
      const role = form[i][0];
      let bi = 0, bs = -1;
      pool.forEach((pl, j) => { const sc = PP.fit(pl.pos || role, role) * 100 + PP.playerRating(role, pl.stats) * 0.01; if (sc > bs) { bs = sc; bi = j; } });
      out[i] = pool.splice(bi, 1)[0];
    }
    def.squad = out;
    def.formation = formation;
  };

  // How well a player suits a slot: 1 = natural position, less for a neighbouring one.
  const NEAR = {
    GK: [], CB: ['DM', 'LB', 'RB'], LB: ['RB', 'LM', 'CB'], RB: ['LB', 'RM', 'CB'], DM: ['CM', 'CB'],
    CM: ['DM', 'AM', 'LM', 'RM'], LM: ['LW', 'RM', 'CM', 'LB'], RM: ['RW', 'LM', 'CM', 'RB'],
    AM: ['CM', 'ST', 'LW', 'RW'], LW: ['RW', 'LM', 'AM', 'ST'], RW: ['LW', 'RM', 'AM', 'ST'], ST: ['AM', 'LW', 'RW'],
  };
  PP.fit = (pos, role) => (pos === role ? 1 : (NEAR[pos] || []).includes(role) ? 0.9 : pos === 'GK' || role === 'GK' ? 0.3 : 0.75);

  PP.TEAM_DEFS = [
    {
      id: 'riv', name: 'Rivermouth Rovers', short: 'RIV', formation: '4-3-3', rating: 72,
      style: { block: 'mid', compact: 0.6, epithet: 'Balanced, compact mid block' },
      kit: { shirt: '#2ec4b6', shade: '#178277', shorts: '#f4f4f4', socks: '#2ec4b6' },
      gkKit: { shirt: '#ffd23f', shade: '#b8900c', shorts: '#222222', socks: '#ffd23f' },
    },
    {
      id: 'ash', name: 'Ashford Athletic', short: 'ASH', formation: '4-4-2', rating: 72,
      style: { block: 'high', compact: 0.4, epithet: 'Aggressive high press, leaves gaps behind' },
      kit: { shirt: '#d7263d', shade: '#8f1a29', shorts: '#1b1b2f', socks: '#d7263d' },
      gkKit: { shirt: '#7bd389', shade: '#3f8a4c', shorts: '#1b1b2f', socks: '#7bd389' },
    },
  ];

  // ---- 1-5 star ratings (half steps) from player stats ----
  const avg = (s, keys) => keys.reduce((a, k) => a + s[k], 0) / keys.length;
  const ROLE_GROUP = { GK: 'gk', CB: 'def', LB: 'def', RB: 'def', DM: 'mid', CM: 'mid', LM: 'mid', RM: 'mid', AM: 'att', LW: 'att', RW: 'att', ST: 'att' };
  const GROUP_KEYS = {
    att: ['finishing', 'shotPower', 'dribbling', 'pace', 'composure', 'firstTouch'],
    mid: ['shortPass', 'longPass', 'vision', 'stamina', 'firstTouch', 'dribbling'],
    def: ['tackling', 'marking', 'positioning', 'strength', 'heading', 'pace'],
    gk: ['reflexes', 'diving', 'handling', 'gkPositioning'],
  };
  PP.stars = (r) => Math.round(U.clamp((r - 50) / 10 + 1, 1, 5) * 2) / 2;
  PP.playerRating = (role, stats) => avg(stats, GROUP_KEYS[ROLE_GROUP[role]]);
  // squad = def.squad (array of {stats}), formation = def.formation
  PP.teamRatings = function (def) {
    const form = PP.FORMATIONS[def.formation];
    const g = { att: [], mid: [], def: [], gk: [] };
    def.squad.forEach((pl, i) => {
      const role = form[i][0], fit = pl.pos ? 1 - (1 - PP.fit(pl.pos, role)) * 0.5 : 1;
      g[ROLE_GROUP[role]].push(PP.playerRating(role, pl.stats) * fit);
    });
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const raw = { att: mean(g.att), mid: mean(g.mid), def: mean(g.def) * 0.75 + mean(g.gk) * 0.25, gk: mean(g.gk) };
    return { raw, att: PP.stars(raw.att), mid: PP.stars(raw.mid), def: PP.stars(raw.def), gk: PP.stars(raw.gk) };
  };
  PP.ensureSquad = (def) => { if (!def.squad) def.squad = PP.makeSquad(def.formation, def.rating); PP.ensureBench(def); return def.squad; };

  class Team {
    constructor(def, dir, isUser, match) {
      this.def = def;
      this.match = match;
      this.dir = dir;                 // +1 attacks towards x = W, -1 towards x = 0
      this.isUser = isUser;
      this.name = def.name;
      this.short = def.short;
      this.kit = def.kit;
      this.gkKit = def.gkKit;
      this.ownX = dir === 1 ? 0 : C.W;
      this.attackX = dir === 1 ? C.W : 0;
      this.phase = 'defend';
      this.style = def.style || { block: 'mid', compact: 0.5, epithet: '' };
      this.block = this.style.block;      // current defensive block (phases may override)
      this.compact = this.style.compact;
      const form = PP.FORMATIONS[def.formation];
      const squad = def.squad || PP.makeSquad(def.formation, def.rating);
      def.squad = squad;
      this.players = form.map((s, i) => new PP.Player(this, { role: s[0], d: s[1], l: s[2] }, i, squad[i]));
    }
    toWorld(d, l) { return { x: this.dir === 1 ? d * C.W : C.W - d * C.W, y: l * C.H }; }
    depth(x) { return this.dir === 1 ? x / C.W : (C.W - x) / C.W; }
    get gk() { return this.players[0]; }
    outfield() { return this.players.filter((p) => !p.isGK && !p.sentOff); }
  }
  PP.Team = Team;
})();
