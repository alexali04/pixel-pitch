// Synthesized sound effects (Web Audio, no asset files). The context starts on the first
// key press or click, as browsers require. M toggles mute.
(function () {
  const S = (PP.Sound = { ctx: null, master: null, noise: null, crowd: null, muted: false });
  try { S.muted = localStorage.getItem('pp.muted') === '1'; } catch (e) { /* no storage */ }
  // Volume sliders (0..1 each, 1 = the default mix): master, music, crowd, effects.
  S.vol = { master: 1, music: 1, crowd: 1, sfx: 1 };
  try { Object.assign(S.vol, JSON.parse(localStorage.getItem('pp.vol') || '{}')); } catch (e) { /* no storage */ }
  const MASTER = 0.6;
  const masterLevel = () => (S.muted ? 0 : MASTER * S.vol.master);

  function init() {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (S.ctx = new AC());
    S.master = ctx.createGain();
    S.master.gain.value = masterLevel();
    S.master.connect(ctx.destination);
    S.sfx = ctx.createGain(); S.sfx.gain.value = S.vol.sfx; S.sfx.connect(S.master);
    S.musicOut = ctx.createGain(); S.musicOut.gain.value = S.vol.music; S.musicOut.connect(S.master);
    const len = ctx.sampleRate * 2;
    S.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = S.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    loadSamples();
    if (S.musicActive) { S.musicActive = false; S.musicOn(); }
  }
  addEventListener('keydown', init);
  addEventListener('pointerdown', init);
  addEventListener('touchend', init); // iOS unlocks audio on touchend

  const now = () => S.ctx.currentTime;

  function env(g, t0, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function tone(type, f0, f1, dur, vol, t0 = now()) {
    const o = S.ctx.createOscillator(), g = S.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    env(g, t0, vol, 0.004, dur);
    o.connect(g).connect(S.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(filter, freq, q, dur, vol, t0 = now(), attack = 0.003) {
    const src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.ctx.createGain();
    src.buffer = S.noise;
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    env(g, t0, vol, attack, dur);
    src.connect(f).connect(g).connect(S.sfx);
    src.start(t0, Math.random()); src.stop(t0 + attack + dur + 0.05);
    return f;
  }

  const SFX = {
    // power in [0, 1]
    pass(power = 0.5) {
      tone('sine', 150 + power * 40, 55, 0.09 + power * 0.04, 0.35 + power * 0.3);
      noise('highpass', 2500, 0.7, 0.03, 0.12 + power * 0.1);
    },
    chip(power = 0.5) {
      tone('sine', 200, 80, 0.08, 0.3 + power * 0.2);
      noise('bandpass', 3500, 2, 0.04, 0.15);
    },
    shot(power = 0.7) {
      tone('sine', 130, 45, 0.16, 0.6 + power * 0.3);
      noise('highpass', 1800, 0.7, 0.05, 0.25 + power * 0.15);
      const t = now(), f = noise('bandpass', 600, 1.5, 0.35, 0.05 + power * 0.08, t, 0.02);
      f.frequency.exponentialRampToValueAtTime(2400, t + 0.3); // whoosh
    },
    tackle() {
      noise('lowpass', 500, 0.8, 0.14, 0.5);
      tone('sine', 90, 50, 0.12, 0.45);
    },
    bump() { noise('lowpass', 700, 0.8, 0.07, 0.25); },
    slide() {
      const t = now(), f = noise('lowpass', 2500, 0.6, 0.35, 0.18, t, 0.02);
      f.frequency.exponentialRampToValueAtTime(400, t + 0.35); // grass scrape
    },
    save() {
      noise('highpass', 1500, 0.8, 0.05, 0.35); // gloves
      tone('sine', 110, 60, 0.1, 0.35);
    },
    post() {
      const t = now();
      tone('triangle', 880, 860, 0.5, 0.25, t);
      tone('sine', 1320, 1300, 0.35, 0.12, t);
      tone('sine', 2460, 2440, 0.2, 0.06, t);
    },
    whistle(blasts = 1) {
      for (let i = 0; i < blasts; i++) {
        const t = now() + i * 0.42, len = blasts > 1 && i === blasts - 1 ? 0.7 : 0.28;
        for (const f of [2050, 2110]) {
          const o = S.ctx.createOscillator(), g = S.ctx.createGain(), lfo = S.ctx.createOscillator(), lg = S.ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          lfo.frequency.value = 28; lg.gain.value = 40; // pea rattle
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
          g.gain.setValueAtTime(0.09, t + len);
          g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.06);
          o.connect(g).connect(S.sfx);
          o.start(t); lfo.start(t); o.stop(t + len + 0.1); lfo.stop(t + len + 0.1);
        }
      }
    },
    goal() {                                            // you scored: the stadium erupts
      noise('highpass', 3000, 0.5, 0.2, 0.12, now()); // net ripple
      clip('goal', 12, 1.0);
    },
    concede() {                                         // they scored: a groan, then quiet
      noise('highpass', 3000, 0.5, 0.2, 0.08, now());
      clip('miss', 2.6, 0.45);
    },
    ooh(arg = 0.85) {                                // a chance missed / saved / blocked
      const o = typeof arg === 'object' ? arg : { vol: arg, lead: 0 };
      clip('miss', 5, o.vol, o.lead || 0);
    },
    foul(vol = 0.7) { clip('foul', 3.5, vol); },     // the home crowd's outrage at a foul
    distantRoar() { clip('miss', 2.6, 0.35); },
    click() { tone('square', 520, 780, 0.035, 0.06); },
  };

  S.play = function (name, arg) {
    if (!S.ctx || S.muted || !SFX[name]) return;
    try { SFX[name](arg); } catch (e) { console.warn('sound', name, e); } // never let audio break the game
  };

  // ---------- crowd (real recordings) ----------
  // CC0 field recordings from FC St. Pauli's Millerntor Stadium ("Sound Of Sankt Pauli" by
  // itmightgetloud on Freesound). The ambience loops under the match; the other files hold
  // several separate takes each (goal roars, missed-chance oohs, excited surges), which are
  // found at load time by splitting on the silences between them. Each reaction plays a
  // random take, from the point where it erupts.
  const FILES = { ambience: 'audio/crowd-ambience.mp3', excited: 'audio/crowd-excited.mp3', goal: 'audio/crowd-goal.mp3', miss: 'audio/crowd-miss.mp3' };
  S.samples = {}; S.takes = {};
  // Hand-picked moments (seconds into each file, by ear) where the reaction kicks in. Each take
  // runs until the silence that ends it. 'foul' is cut from the excited file.
  const CUES = { goal: [1.57, 60.8], miss: [2.8, 16.5, 38.9, 45.7], foul: [1.0] };
  const CUE_SRC = { foul: 'excited' };
  function takes(buf) {
    const d = buf.getChannelData(0), W = Math.floor(buf.sampleRate * 0.1), r = [];
    for (let i = 0; i + W <= d.length; i += W) { let q = 0; for (let j = i; j < i + W; j += 4) q += d[j] * d[j]; r.push(10 * Math.log10(q / (W / 4) + 1e-10)); }
    const out = [];
    let st = null;
    for (let i = 0; i <= r.length; i++) {
      const loud = i < r.length && r[i] > -60;
      if (loud && st === null) st = i;
      if (!loud && st !== null) {
        if (i - st > 15) {
          // The reaction starts where the noise climbs fastest on the way to the take's peak:
          // play from 0.1 s before that, so it lands with the moment on the pitch.
          let peak = -200, pi = st;
          for (let k = st; k < i; k++) if (r[k] > peak) { peak = r[k]; pi = k; }
          let best = -1e9, on = st;
          for (let k = Math.max(st, pi - 40); k <= pi; k++) { const rise = r[Math.min(i - 1, k + 5)] - r[Math.max(st, k - 1)]; if (rise > best) { best = rise; on = k; } }
          out.push({ from: Math.max(st, on - 1) / 10, start: st / 10, to: i / 10 });
        }
        st = null;
      }
    }
    out.r = r;
    return out.length ? out : [{ from: 0, to: buf.duration }];
  }
  // Calm stretches of the ambience (no big reactions in them) at least 8 s long, so the
  // crowd never goes off for no reason.
  function calm(list) {
    const r = list.r, sm = r.map((_, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 5); k < Math.min(r.length, i + 5); k++) { t += r[k]; n++; } return t / n; });
    const loud = sm.filter((v) => v > -60).sort((a, b) => a - b), med = loud[loud.length >> 1];
    const hot = sm.map((v) => v > med + 5);
    const out = [];
    for (const tk of list) {
      let a = null;
      for (let i = Math.ceil(tk.start * 10) + 10; i <= Math.floor(tk.to * 10) - 10; i++) {
        let near = false;
        for (let k = Math.max(0, i - 25); k <= Math.min(hot.length - 1, i + 25); k++) if (hot[k]) { near = true; break; }
        if (!near && a === null) a = i;
        if ((near || i === Math.floor(tk.to * 10) - 10) && a !== null) { if (i - a >= 80) out.push({ start: a / 10, to: i / 10 }); a = null; }
      }
    }
    return out.length ? out : list;
  }
  function loadSamples() {
    for (const [k, url] of Object.entries(FILES)) {
      fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(url))))
        .then((b) => S.ctx.decodeAudioData(b))
        .then((buf) => {
          S.samples[k] = buf;
          const auto = takes(buf);
          S.takes[k] = k === 'ambience' ? calm(auto) : auto;
          // replace detected starts with the hand-picked cues, keeping each take's natural end
          for (const [name, src] of Object.entries({ goal: 'goal', miss: 'miss', foul: 'excited' })) {
            if (src !== k) continue;
            S.takes[name] = CUES[name].map((at) => {
              const seg = auto.find((t) => at >= t.start - 0.05 && at < t.to) || { start: 0, to: Math.min(buf.duration, at + 8) };
              return { from: at, start: seg.start, to: seg.to, src };
            });
          }
          if (k === 'ambience' && S.crowdWanted) { S.crowdOff(); S.crowdOn(); }
        }).catch(() => { /* no file: that sound stays silent */ });
    }
  }
  // Play a random take of a reaction (not the same one twice running), at most maxDur long.
  const lastTake = {};
  // lead = seconds of the take's run-up to play before its cue (the crowd's intake of breath).
  function clip(name, maxDur, vol, lead = 0) {
    const list = S.takes[name], buf = list && S.samples[list[0].src || name];
    if (!buf || !list) return;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastTake[name]) i = (i + 1) % list.length;
    lastTake[name] = i;
    const tk0 = list[i], from = Math.max(tk0.start, tk0.from - lead), tk = { ...tk0, from };
    const dur = Math.min(maxDur + (tk0.from - from), tk.to - tk.from);
    const t = now(), src = S.ctx.createBufferSource(), g = S.ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g).connect(bus());
    src.start(t, tk.from, dur + 0.05);
    // the bed ducks a little under a big reaction
    if (S.crowd) { const dg = S.crowd.duck.gain; dg.cancelScheduledValues(t); dg.setTargetAtTime(0.6, t, 0.15); dg.setTargetAtTime(1, t + dur * 0.8, 0.8); }
  }
  S.react = (name, maxDur, vol) => { if (S.ctx && !S.muted) clip(name, maxDur, vol); };
  // Everything the crowd does goes through one bus: its overall level, and silence on pause.
  const CROWD_VOL = 0.5;
  function bus() {
    if (!S.crowdBus) { S.crowdBus = S.ctx.createGain(); S.crowdBus.gain.value = CROWD_VOL * S.vol.crowd; S.crowdBus.connect(S.master); }
    return S.crowdBus;
  }
  S.crowdPause = function (paused) {
    if (!S.ctx) return;
    S.crowdPaused = paused;
    bus().gain.setTargetAtTime(paused ? 0.0001 : Math.max(0.0001, CROWD_VOL * S.vol.crowd), S.ctx.currentTime, 0.12);
  };

  // The bed: the ambience recording's takes chained end to end with 2.5 s crossfades (the file
  // has silent gaps where takes were joined, so it can't simply loop).
  function bedNext(c, at, first) {
    if (S.crowd !== c) return;
    const list = S.takes.ambience;
    c.i = (c.i + 1) % list.length;
    const tk = list[c.i], X = 2.5;
    const from = first ? tk.start + Math.random() * Math.max(0, tk.to - tk.start - 10) : tk.start;
    const dur = Math.max(5, tk.to - from);
    const src = S.ctx.createBufferSource(), g = S.ctx.createGain();
    src.buffer = S.samples.ambience;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(1, at + X);
    g.gain.setValueAtTime(1, at + dur - X);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(g).connect(c.g);
    src.start(at, from, dur);
    c.srcs.push(src); if (c.srcs.length > 3) c.srcs.shift();
    const nextAt = at + dur - X;
    c.timer = setTimeout(() => bedNext(c, nextAt, false), Math.max(0, (nextAt - S.ctx.currentTime - 1) * 1000));
  }
  S.crowdOn = function () {
    S.crowdWanted = true;
    if (!S.ctx || S.crowd || !S.samples.ambience) return;
    const duck = S.ctx.createGain(), g = S.ctx.createGain();
    duck.connect(bus());
    S.crowdPause(false);
    g.gain.value = 0.0001;
    g.connect(duck);
    const c = (S.crowd = { duck, g, srcs: [], i: Math.floor(Math.random() * S.takes.ambience.length) - 1, timer: null });
    bedNext(c, S.ctx.currentTime + 0.05, true);
    S.crowdLevel(0.2);
  };
  S.crowdOff = function () {
    S.crowdWanted = false;
    const c = S.crowd;
    if (!c) return;
    S.crowd = null;
    clearTimeout(c.timer);
    const t = S.ctx.currentTime;
    c.g.gain.setTargetAtTime(0.0001, t, 0.3);
    for (const src of c.srcs) { try { src.stop(t + 1.5); } catch (e) { /* already stopped */ } }
  };
  // 0 = quiet midfield lull .. 1 = goalmouth scramble.
  S.crowdLevel = function (x) {
    const c = S.crowd;
    if (!c) return;
    const k = Math.max(0, Math.min(1, x));
    c.g.gain.setTargetAtTime(0.22 + 0.6 * k, S.ctx.currentTime, 0.8);
  };

  // ---------- menu music ----------
  // A short original chiptune loop, scheduled ahead on the audio clock.
  const BPM = 116, STEP = 60 / BPM / 2; // eighth notes
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  // 8 bars x 8 steps. Chords (root midi) per bar, and a lead line (0 = rest).
  const CHORDS = [57, 53, 60, 55, 53, 55, 52, 57];               // A F C G | F G E A
  const QUAL = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 3, 7]];
  const LEAD = [
    76, 0, 74, 72, 0, 72, 74, 76,   81, 0, 77, 0, 76, 74, 72, 0,
    79, 0, 76, 0, 72, 74, 76, 79,   78, 79, 0, 74, 0, 71, 74, 0,
    77, 0, 76, 74, 0, 72, 74, 77,   79, 0, 81, 79, 0, 76, 74, 0,
    76, 0, 71, 72, 74, 76, 79, 0,   81, 0, 0, 79, 76, 0, 0, 0,
  ];
  function note(type, f, t, dur, vol, dest) {
    const o = S.ctx.createOscillator(), g = S.ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function musicTick() {
    const M = S.music;
    if (!M) return;
    while (M.next < S.ctx.currentTime + 0.25) {
      const i = M.step % 64, bar = Math.floor(i / 8), beat = i % 8, t = M.next;
      const root = CHORDS[bar], q = QUAL[bar];
      note('triangle', midi(root - 12 + (beat % 4 === 3 ? 7 : 0)), t, STEP * 0.9, 0.5, M.bus);         // bass
      note('square', midi(root + 12 + q[beat % 3]), t, STEP * 0.5, 0.07, M.bus);                          // arpeggio
      if (LEAD[i]) note('square', midi(LEAD[i]), t, STEP * (LEAD[i + 1] ? 0.9 : 1.7), 0.12, M.bus);       // tune
      if (beat % 4 === 0) { const o = S.ctx.createOscillator(), g = S.ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); env(g, t, 0.5, 0.004, 0.13); o.connect(g).connect(M.bus); o.start(t); o.stop(t + 0.2); } // kick
      if (beat % 2 === 1) { const src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.ctx.createGain(); src.buffer = S.noise; f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.12, 0.002, 0.04); src.connect(f).connect(g).connect(M.bus); src.start(t, Math.random()); src.stop(t + 0.06); } // hat
      M.step++; M.next += STEP;
    }
  }
  try { S.wantMusic = localStorage.getItem('pp.music') !== '0'; } catch (e) { S.wantMusic = true; }
  S.musicOn = function () {
    S.musicActive = true;
    if (!S.ctx || S.music || !S.wantMusic) return;
    const bus = S.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, S.ctx.currentTime);
    bus.gain.exponentialRampToValueAtTime(0.22, S.ctx.currentTime + 1.2);
    bus.connect(S.musicOut);
    S.music = { bus, step: 0, next: S.ctx.currentTime + 0.1, timer: setInterval(musicTick, 90) };
  };
  S.musicOff = function () {
    S.musicActive = false;
    const M = S.music;
    if (!M) return;
    S.music = null;
    clearInterval(M.timer);
    const t = S.ctx.currentTime;
    M.bus.gain.setTargetAtTime(0.0001, t, 0.25);
    setTimeout(() => M.bus.disconnect(), 1500);
  };
  S.toggleMusic = function () {
    S.wantMusic = !S.wantMusic;
    try { localStorage.setItem('pp.music', S.wantMusic ? '1' : '0'); } catch (e) { /* no storage */ }
    if (!S.wantMusic) { const a = S.musicActive; S.musicOff(); S.musicActive = a; }
    else if (S.musicActive) { S.musicActive = false; S.musicOn(); }
    return S.wantMusic;
  };

  S.toggleMute = function () {
    S.muted = !S.muted;
    try { localStorage.setItem('pp.muted', S.muted ? '1' : '0'); } catch (e) { /* no storage */ }
    if (S.master) S.master.gain.value = masterLevel();
    return S.muted;
  };
  S.setVol = function (k, v) {
    S.vol[k] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('pp.vol', JSON.stringify(S.vol)); } catch (e) { /* no storage */ }
    if (!S.ctx) return;
    const t = S.ctx.currentTime;
    if (k === 'master') S.master.gain.setTargetAtTime(masterLevel(), t, 0.03);
    if (k === 'music') S.musicOut.gain.setTargetAtTime(S.vol.music, t, 0.03);
    if (k === 'sfx') S.sfx.gain.setTargetAtTime(S.vol.sfx, t, 0.03);
    if (k === 'crowd' && S.crowdBus && !S.crowdPaused) S.crowdBus.gain.setTargetAtTime(Math.max(0.0001, CROWD_VOL * S.vol.crowd), t, 0.03);
  };
})();
