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
    CB: { tackling: 10, marking: 10, positioning: 8, strength: 8, heading: 10, finishing: -25, dribbling: -12, pace: -4, agility: -6 },
    LB: { pace: 6, stamina: 6, crossing: 4, tackling: 4, marking: 3, finishing: -18 },
    RB: { pace: 6, stamina: 6, crossing: 4, tackling: 4, marking: 3, finishing: -18 },
    DM: { tackling: 7, positioning: 6, shortPass: 6, stamina: 4, marking: 5, finishing: -12 },
    CM: { shortPass: 8, vision: 6, stamina: 6, longPass: 4, firstTouch: 3 },
    AM: { vision: 8, dribbling: 6, shortPass: 6, longShots: 5, firstTouch: 6, tackling: -12, marking: -10 },
    LM: { pace: 7, acceleration: 7, dribbling: 6, crossing: 8, tackling: -8, marking: -8 },
    RM: { pace: 7, acceleration: 7, dribbling: 6, crossing: 8, tackling: -8, marking: -8 },
    LW: { pace: 9, acceleration: 9, dribbling: 9, agility: 6, crossing: 6, tackling: -14, marking: -14 },
    RW: { pace: 9, acceleration: 9, dribbling: 9, agility: 6, crossing: 6, tackling: -14, marking: -14 },
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

  PP.makeSquad = function (formation, rating) {
    const used = new Set();
    return PP.FORMATIONS[formation].map((slot, i) => {
      let name;
      do { name = makeName(); } while (used.has(name));
      used.add(name);
      return {
        name,
        num: i === 0 ? 1 : [2, 5, 4, 3, 6, 8, 10, 7, 9, 11][i - 1],
        stats: makeStats(slot[0], rating + U.rand(-4, 4)),
        look: { skin: U.pick(SKIN), hair: U.pick(HAIR) },
      };
    });
  };

  PP.TEAM_DEFS = [
    {
      id: 'riv', name: 'Rivermouth Rovers', short: 'RIV', formation: '4-3-3', rating: 72,
      kit: { shirt: '#2ec4b6', shade: '#178277', shorts: '#f4f4f4', socks: '#2ec4b6' },
      gkKit: { shirt: '#ffd23f', shade: '#b8900c', shorts: '#222222', socks: '#ffd23f' },
    },
    {
      id: 'ash', name: 'Ashford Athletic', short: 'ASH', formation: '4-4-2', rating: 72,
      kit: { shirt: '#d7263d', shade: '#8f1a29', shorts: '#1b1b2f', socks: '#d7263d' },
      gkKit: { shirt: '#7bd389', shade: '#3f8a4c', shorts: '#1b1b2f', socks: '#7bd389' },
    },
  ];

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
      const form = PP.FORMATIONS[def.formation];
      const squad = def.squad || PP.makeSquad(def.formation, def.rating);
      def.squad = squad;
      this.players = form.map((s, i) => new PP.Player(this, { role: s[0], d: s[1], l: s[2] }, i, squad[i]));
    }
    toWorld(d, l) { return { x: this.dir === 1 ? d * C.W : C.W - d * C.W, y: l * C.H }; }
    depth(x) { return this.dir === 1 ? x / C.W : (C.W - x) / C.W; }
    get gk() { return this.players[0]; }
    outfield() { return this.players.filter((p) => !p.isGK); }
  }
  PP.Team = Team;
})();
