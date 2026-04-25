// breakout/src/audio.js — procedural sound engine
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

  // ── Brick hit ────────────────────────────────────────────────────────────────
  // Row 0 = top (highest pitch), row 6 = bottom (lowest pitch)
  const BRICK_PITCHES = [880, 784, 659, 587, 523, 440, 392];

  function playBrickHit(row) {
    const c    = ac();
    const t    = c.currentTime;
    const freq = BRICK_PITCHES[Math.max(0, Math.min(6, row))];

    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.91, t + 0.055);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.07);

    // Faint detuned octave for brightness
    const osc2 = c.createOscillator();
    const g2   = c.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.008;
    g2.gain.setValueAtTime(0.065, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc2.connect(g2); g2.connect(c.destination);
    osc2.start(t); osc2.stop(t + 0.045);
  }

  // ── Paddle hit ───────────────────────────────────────────────────────────────
  function playPaddleHit() {
    const c  = ac();
    const t  = c.currentTime;
    const sr = c.sampleRate;

    // Low pitched descending thwack
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(270, t);
    osc.frequency.exponentialRampToValueAtTime(130, t + 0.11);
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.14);

    // Percussive noise snap
    const nLen = Math.ceil(sr * 0.026);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 1.4;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.24, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.026);
    nsrc.connect(filt); filt.connect(ng); ng.connect(c.destination);
    nsrc.start(t);
  }

  // ── Miss (ball fell off bottom) ──────────────────────────────────────────────
  function playMiss() {
    const c  = ac();
    const t  = c.currentTime;
    const sr = c.sampleRate;

    // Descending wail — sine sweeping down fast then lingering low
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.55);
    g.gain.setValueAtTime(0.32, t);
    g.gain.setValueAtTime(0.32, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.71);

    // Low rumble noise burst
    const nLen = Math.ceil(sr * 0.4);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.5);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 280;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.28, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    nsrc.connect(filt); filt.connect(ng); ng.connect(c.destination);
    nsrc.start(t);
  }

  // ── Game over (speech) ───────────────────────────────────────────────────────
  function sayGameOver() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    // Short delay so the ball-drop moment doesn't overlap
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

    const bpm      = 125;
    const beat     = 60 / bpm;      // 0.48 s
    const sixteenth = beat / 4;     // 0.12 s

    // Master bus
    const master = c.createGain();
    master.gain.value = 0.22;
    master.connect(c.destination);

    // Short reverb for warmth
    const revLen = Math.ceil(sr * 1.2);
    const revBuf = c.createBuffer(2, revLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 2.8);
    }
    const reverb  = c.createConvolver();
    reverb.buffer = revBuf;
    const revSend = c.createGain();
    revSend.gain.value = 0.18;
    reverb.connect(revSend); revSend.connect(master);

    // Reusable hi-hat noise buffer
    const hatLen = Math.ceil(sr * 0.028);
    const hatBuf = c.createBuffer(1, hatLen, sr);
    const hatD   = hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) hatD[i] = (Math.random() * 2 - 1) * (1 - i / hatLen);

    function oNote(freq, startT, dur, vol, type, toReverb = false) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, startT);
      env.gain.linearRampToValueAtTime(vol, startT + 0.008);
      env.gain.setValueAtTime(vol, startT + dur * 0.62);
      env.gain.linearRampToValueAtTime(0, startT + dur);
      osc.connect(env); env.connect(master);
      if (toReverb) env.connect(reverb);
      osc.start(startT); osc.stop(startT + dur + 0.01);
    }

    function hat(startT, vol) {
      const src  = c.createBufferSource();
      src.buffer = hatBuf;
      const filt = c.createBiquadFilter();
      filt.type = 'highpass'; filt.frequency.value = 9000;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(filt); filt.connect(g); g.connect(master);
      src.start(startT);
    }

    // Am → F → C → G (4 bars, repeating)
    const chords = [
      { bass: 110,   arp: [220, 261.63, 329.63, 440]    }, // Am
      { bass: 87.31, arp: [174.61, 220, 261.63, 349.23] }, // F
      { bass: 65.41, arp: [130.81, 164.81, 196, 261.63] }, // C
      { bass: 98,    arp: [196, 246.94, 293.66, 392]    }, // G
    ];

    // 16-note melody (A-minor, one quarter note per step)
    const melody = [
      659.25, 523.25, 440.00, 523.25,
      523.25, 440.00, 349.23, 392.00,
      392.00, 329.63, 261.63, 329.63,
      440.00, 523.25, 392.00, 329.63,
    ];

    const barLen = beat * 4;
    let nextTime = c.currentTime + 0.05;

    function scheduleLoop() {
      const loopStart = nextTime;
      for (let bar = 0; bar < chords.length; bar++) {
        const bs = loopStart + bar * barLen;
        const ch = chords[bar];

        // Bass: triangle, quarter notes, accented on beats 1 & 3
        for (let b = 0; b < 4; b++)
          oNote(ch.bass, bs + b * beat, beat * 0.78, b % 2 === 0 ? 0.42 : 0.22, 'triangle');

        // Arp: square, 16th notes, cycling 4 chord tones
        for (let s = 0; s < 16; s++)
          oNote(ch.arp[s % 4], bs + s * sixteenth, sixteenth * 0.72, 0.052, 'square');

        // Melody: sine + reverb, quarter notes
        for (let m = 0; m < 4; m++)
          oNote(melody[bar * 4 + m], bs + m * beat, beat * 0.70,
                m === 0 ? 0.092 : 0.062, 'sine', true);

        // Hi-hats: 8th notes, on-beat accented
        for (let h = 0; h < 8; h++)
          hat(bs + h * beat * 0.5, h % 2 === 0 ? 0.062 : 0.030);
      }

      nextTime = loopStart + chords.length * barLen;
      setTimeout(scheduleLoop, Math.max(0, (nextTime - c.currentTime - 0.3) * 1000));
    }

    scheduleLoop();

    // Always-on low pad for warmth
    const padG = c.createGain();
    padG.gain.value = 0.030;
    padG.connect(master);
    [55, 82.41].forEach(f => {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(padG); o.start();
    });
  }

  return { resume, playBrickHit, playPaddleHit, playMiss, sayGameOver, cancelSpeech, startMusic };
})();
