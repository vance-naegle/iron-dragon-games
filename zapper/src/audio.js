// zapper/src/audio.js — procedural sound engine (no audio asset files)
const SoundFX = (() => {
  let _ctx = null;
  function ac() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    return _ctx;
  }

  function resume() {
    const c = ac();
    if (c.state === 'suspended') c.resume();
  }

  // ── Player shot ──────────────────────────────────────────────────────────────
  function playerShoot() {
    const c = ac();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.09);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.11);
  }

  // ── Alien shot — lower, square-wave, deliberately distinct from the player's
  //    bright sawtooth zap so the two read as "friend" vs "foe" fire ──────────
  function alienShoot() {
    const c = ac();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.14);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.16);
  }

  // ── Alien destroyed ───────────────────────────────────────────────────────────
  // Row 0 = top (highest pitch), row 4 = bottom (lowest pitch) — same idea as
  // Breakout's per-row brick pitches.
  const ALIEN_PITCHES = [660, 587, 523, 440, 392];

  function explosion(row) {
    const c    = ac();
    const t    = c.currentTime;
    const sr   = c.sampleRate;
    const freq = ALIEN_PITCHES[Math.max(0, Math.min(4, row))];

    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.14);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.17);

    // Noise crunch layer
    const nLen = Math.ceil(sr * 0.09);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 1;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    nsrc.connect(filt); filt.connect(ng); ng.connect(c.destination);
    nsrc.start(t);
  }

  // ── Player ship hit ───────────────────────────────────────────────────────────
  function playerHit() {
    const c  = ac();
    const t  = c.currentTime;
    const sr = c.sampleRate;

    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.5);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.61);

    const nLen = Math.ceil(sr * 0.35);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.4);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 260;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.26, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    nsrc.connect(filt); filt.connect(ng); ng.connect(c.destination);
    nsrc.start(t);
  }

  // ── Dive alert — quick downward swoop when a bug breaks formation ───────────
  function diveAlert() {
    const c = ac();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.33);
  }

  // ── Game over (speech) ───────────────────────────────────────────────────────
  function sayGameOver() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
      try {
        const utt   = new SpeechSynthesisUtterance('Game over. Play again?');
        utt.rate    = 0.88;
        utt.pitch   = 0.85;
        utt.volume  = 1;
        window.speechSynthesis.speak(utt);
      } catch (_) {}
    }, 700);
  }

  function cancelSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  // ── Background music ─────────────────────────────────────────────────────────
  let musicStarted = false;

  function startMusic() {
    if (musicStarted) return;
    musicStarted = true;
    const c  = ac();
    const sr = c.sampleRate;

    const bpm       = 138;
    const beat      = 60 / bpm;
    const sixteenth = beat / 4;

    const master = c.createGain();
    master.gain.value = 0.2;
    master.connect(c.destination);

    const revLen = Math.ceil(sr * 1.0);
    const revBuf = c.createBuffer(2, revLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 3);
    }
    const reverb  = c.createConvolver();
    reverb.buffer = revBuf;
    const revSend = c.createGain();
    revSend.gain.value = 0.16;
    reverb.connect(revSend); revSend.connect(master);

    const hatLen = Math.ceil(sr * 0.022);
    const hatBuf = c.createBuffer(1, hatLen, sr);
    const hatD   = hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) hatD[i] = (Math.random() * 2 - 1) * (1 - i / hatLen);

    function oNote(freq, startT, dur, vol, type, toReverb = false) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, startT);
      env.gain.linearRampToValueAtTime(vol, startT + 0.007);
      env.gain.setValueAtTime(vol, startT + dur * 0.58);
      env.gain.linearRampToValueAtTime(0, startT + dur);
      osc.connect(env); env.connect(master);
      if (toReverb) env.connect(reverb);
      osc.start(startT); osc.stop(startT + dur + 0.01);
    }

    function hat(startT, vol) {
      const src  = c.createBufferSource();
      src.buffer = hatBuf;
      const filt = c.createBiquadFilter();
      filt.type = 'highpass'; filt.frequency.value = 8500;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(filt); filt.connect(g); g.connect(master);
      src.start(startT);
    }

    // Em → C → D → Em — tense, driving minor-key loop
    const chords = [
      { bass: 82.41,  arp: [164.81, 196, 246.94, 329.63] }, // Em
      { bass: 65.41,  arp: [130.81, 164.81, 196, 261.63] }, // C
      { bass: 73.42,  arp: [146.83, 185, 220, 293.66]    }, // D
      { bass: 82.41,  arp: [164.81, 196, 246.94, 329.63] }, // Em
    ];

    const melody = [
      329.63, 392.00, 349.23, 329.63,
      293.66, 329.63, 246.94, 293.66,
      329.63, 392.00, 440.00, 392.00,
      349.23, 329.63, 293.66, 246.94,
    ];

    const barLen = beat * 4;
    let nextTime = c.currentTime + 0.05;

    function scheduleLoop() {
      const loopStart = nextTime;
      for (let bar = 0; bar < chords.length; bar++) {
        const bs = loopStart + bar * barLen;
        const ch = chords[bar];

        for (let b = 0; b < 4; b++)
          oNote(ch.bass, bs + b * beat, beat * 0.75, b % 2 === 0 ? 0.4 : 0.2, 'triangle');

        for (let s = 0; s < 16; s++)
          oNote(ch.arp[s % 4], bs + s * sixteenth, sixteenth * 0.7, 0.048, 'sawtooth');

        for (let m = 0; m < 4; m++)
          oNote(melody[bar * 4 + m], bs + m * beat, beat * 0.68,
                m === 0 ? 0.09 : 0.06, 'square', true);

        for (let h = 0; h < 8; h++)
          hat(bs + h * beat * 0.5, h % 2 === 0 ? 0.055 : 0.026);
      }

      nextTime = loopStart + chords.length * barLen;
      setTimeout(scheduleLoop, Math.max(0, (nextTime - c.currentTime - 0.3) * 1000));
    }

    scheduleLoop();

    const padG = c.createGain();
    padG.gain.value = 0.026;
    padG.connect(master);
    [41.2, 61.74].forEach(f => {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(padG); o.start();
    });
  }

  return {
    resume, playerShoot, alienShoot, explosion, playerHit, diveAlert,
    sayGameOver, cancelSpeech, startMusic,
  };
})();
