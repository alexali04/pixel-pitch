// Synthesized sound effects (Web Audio, no asset files). The context starts on the first
// key press or click, as browsers require. M toggles mute.
(function () {
  const S = (PP.Sound = { ctx: null, master: null, noise: null, crowd: null, muted: false });
  try { S.muted = localStorage.getItem('pp.muted') === '1'; } catch (e) { /* no storage */ }

  function init() {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (S.ctx = new AC());
    S.master = ctx.createGain();
    S.master.gain.value = S.muted ? 0 : 0.6;
    S.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    S.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = S.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  addEventListener('keydown', init);
  addEventListener('pointerdown', init);

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
    o.connect(g).connect(S.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(filter, freq, q, dur, vol, t0 = now(), attack = 0.003) {
    const src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.ctx.createGain();
    src.buffer = S.noise;
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    env(g, t0, vol, attack, dur);
    src.connect(f).connect(g).connect(S.master);
    src.start(t0, Math.random()); src.stop(t0 + attack + dur + 0.05);
    return f;
  }

  // A crowd = lots of voices: detuned sawtooth "singers" through vowel formant filters,
  // each drifting in pitch, plus a whisper of breath. vowel: 'ah' (cheer) or 'oo' (ooh).
  function crowd(t0, dur, vol, vowel = 'ah', voices = 14, glide = 1) {
    const formants = vowel === 'oo' ? [[320, 6, 1], [800, 8, 0.35]] : [[750, 5, 1], [1200, 7, 0.5], [2600, 9, 0.15]];
    const bus = S.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.35, dur * 0.25));
    bus.gain.setValueAtTime(vol, t0 + dur * 0.55);
    bus.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const [f, q, g] of formants) {
      const bp = S.ctx.createBiquadFilter(), fg = S.ctx.createGain();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; fg.gain.value = g;
      bus.connect(bp).connect(fg).connect(S.master);
    }
    for (let i = 0; i < voices; i++) {
      const o = S.ctx.createOscillator(), g = S.ctx.createGain();
      const f0 = 140 + Math.random() * 220;
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.linearRampToValueAtTime(f0 * (1 + 0.12 * glide * (Math.random() - 0.3)), t0 + dur * 0.4);
      o.frequency.linearRampToValueAtTime(f0 * (1 - 0.15 * glide * Math.random()), t0 + dur);
      const lfo = S.ctx.createOscillator(), lg = S.ctx.createGain();
      lfo.frequency.value = 4 + Math.random() * 3; lg.gain.value = f0 * 0.02; // vibrato
      lfo.connect(lg).connect(o.frequency);
      g.gain.value = 0.6 / voices;
      o.connect(g).connect(bus);
      const st = t0 + Math.random() * 0.12;
      o.start(st); lfo.start(st); o.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
    }
    noise('lowpass', 1200, 0.5, dur * 0.8, vol * 0.08, t0, 0.2); // breath
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
      SFX.ooh();
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
          o.connect(g).connect(S.master);
          o.start(t); lfo.start(t); o.stop(t + len + 0.1); lfo.stop(t + len + 0.1);
        }
      }
    },
    goal() {
      const t = now();
      noise('highpass', 3000, 0.5, 0.2, 0.12, t); // net ripple
      crowd(t + 0.05, 2.8, 0.55, 'ah', 18, 1.4);
    },
    ooh() { crowd(now(), 1.1, 0.35, 'oo', 12, 1.0); },
    distantRoar() { crowd(now(), 1.8, 0.14, 'ah', 10, 0.8); },
  };

  S.play = function (name, arg) {
    if (!S.ctx || S.muted || !SFX[name]) return;
    try { SFX[name](arg); } catch (e) { console.warn('sound', name, e); } // never let audio break the game
  };

  // Low crowd murmur under the match.
  S.crowdOn = function () {
    if (!S.ctx || S.crowd) return;
    const src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.ctx.createGain();
    src.buffer = S.noise; src.loop = true;
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.5;
    g.gain.value = 0.05;
    src.connect(f).connect(g).connect(S.master);
    src.start();
    S.crowd = { src, g };
  };
  S.crowdOff = function () {
    if (!S.crowd) return;
    try { S.crowd.src.stop(); } catch (e) { /* already stopped */ }
    S.crowd = null;
  };

  S.toggleMute = function () {
    S.muted = !S.muted;
    try { localStorage.setItem('pp.muted', S.muted ? '1' : '0'); } catch (e) { /* no storage */ }
    if (S.master) S.master.gain.value = S.muted ? 0 : 0.6;
    return S.muted;
  };
})();
