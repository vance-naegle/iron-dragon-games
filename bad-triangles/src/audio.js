// src/audio.js — procedural Web Audio sound engine
const SoundFX = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function resume() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
  }

  // --- Laser shoot ---
  function playShoot() {
    const c = getCtx();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.10);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  // --- Explosion (glass shatter) ---
  function playExplosion() {
    const c = getCtx();
    const t = c.currentTime;
    const sr = c.sampleRate;

    // Layer 1: impact crack — brief high-pass noise burst (the initial strike)
    const crackLen = Math.ceil(sr * 0.018);
    const crackBuf = c.createBuffer(1, crackLen, sr);
    const cd = crackBuf.getChannelData(0);
    for (let i = 0; i < crackLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / crackLen);
    const crack = c.createBufferSource();
    crack.buffer = crackBuf;
    const crackFilt = c.createBiquadFilter();
    crackFilt.type = 'highpass';
    crackFilt.frequency.value = 5000;
    const crackGain = c.createGain();
    crackGain.gain.setValueAtTime(1.0, t);
    crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    crack.connect(crackFilt);
    crackFilt.connect(crackGain);
    crackGain.connect(c.destination);
    crack.start(t);

    // Layer 2: scattering shards — bandpass noise sweeping down through bright range
    const shardDur = 0.38;
    const shardLen = Math.ceil(sr * shardDur);
    const shardBuf = c.createBuffer(1, shardLen, sr);
    const sd = shardBuf.getChannelData(0);
    for (let i = 0; i < shardLen; i++) sd[i] = Math.random() * 2 - 1;
    const shard = c.createBufferSource();
    shard.buffer = shardBuf;
    const shardFilt = c.createBiquadFilter();
    shardFilt.type = 'bandpass';
    shardFilt.frequency.setValueAtTime(7000, t);
    shardFilt.frequency.exponentialRampToValueAtTime(2200, t + shardDur);
    shardFilt.Q.value = 2.0;
    const shardGain = c.createGain();
    shardGain.gain.setValueAtTime(0.75, t);
    shardGain.gain.exponentialRampToValueAtTime(0.001, t + shardDur);
    shard.connect(shardFilt);
    shardFilt.connect(shardGain);
    shardGain.connect(c.destination);
    shard.start(t);

    // Layer 3: glass resonances — high sine tones that ring and decay like glass fragments
    [3400, 5100, 6800, 9200, 11500].forEach((freq, i) => {
      const delay = i * 0.012;
      const dur   = 0.12 + Math.random() * 0.18;
      const osc   = c.createOscillator();
      const env   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq + (Math.random() - 0.5) * 300;
      env.gain.setValueAtTime(0, t + delay);
      env.gain.linearRampToValueAtTime(0.07, t + delay + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      osc.connect(env);
      env.connect(c.destination);
      osc.start(t + delay);
      osc.stop(t + delay + dur + 0.01);
    });

    // Layer 4: tinkling tail — delayed second scatter (pieces still falling)
    const tailDelay = 0.06;
    const tailLen = Math.ceil(sr * 0.25);
    const tailBuf = c.createBuffer(1, tailLen, sr);
    const td = tailBuf.getChannelData(0);
    for (let i = 0; i < tailLen; i++) td[i] = Math.random() * 2 - 1;
    const tail = c.createBufferSource();
    tail.buffer = tailBuf;
    const tailFilt = c.createBiquadFilter();
    tailFilt.type = 'highpass';
    tailFilt.frequency.value = 8000;
    const tailGain = c.createGain();
    tailGain.gain.setValueAtTime(0, t + tailDelay);
    tailGain.gain.linearRampToValueAtTime(0.35, t + tailDelay + 0.01);
    tailGain.gain.exponentialRampToValueAtTime(0.001, t + tailDelay + 0.25);
    tail.connect(tailFilt);
    tailFilt.connect(tailGain);
    tailGain.connect(c.destination);
    tail.start(t + tailDelay);
  }

  // --- Music sequencer ---
  let musicStarted = false;

  function startAmbient() {
    if (musicStarted) return;
    musicStarted = true;
    const c = getCtx();

    const bpm = 138;
    const beat = 60 / bpm;       // ~0.435 s
    const sixteenth = beat / 4;  // ~0.109 s

    // Master bus
    const master = c.createGain();
    master.gain.value = 0.28;
    master.connect(c.destination);

    // Simple convolution reverb (exponential decay impulse)
    const sr = c.sampleRate;
    const revLen = Math.ceil(sr * 1.4);
    const revBuf = c.createBuffer(2, revLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 2.5);
    }
    const reverb = c.createConvolver();
    reverb.buffer = revBuf;
    const revSend = c.createGain();
    revSend.gain.value = 0.22;
    reverb.connect(revSend);
    revSend.connect(master);

    // Pre-build hi-hat buffer (reused each hit)
    const hatLen = Math.ceil(sr * 0.032);
    const hatBuf = c.createBuffer(1, hatLen, sr);
    const hatD = hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) hatD[i] = (Math.random() * 2 - 1) * (1 - i / hatLen);

    // Schedule a single oscillator note
    function oNote(freq, startT, dur, vol, type, toReverb = false) {
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, startT);
      env.gain.linearRampToValueAtTime(vol, startT + 0.008);
      env.gain.setValueAtTime(vol, startT + dur * 0.65);
      env.gain.linearRampToValueAtTime(0, startT + dur);
      osc.connect(env);
      env.connect(master);
      if (toReverb) env.connect(reverb);
      osc.start(startT);
      osc.stop(startT + dur + 0.01);
    }

    // Schedule a hi-hat click
    function hat(startT, vol) {
      const src = c.createBufferSource();
      src.buffer = hatBuf;
      const filt = c.createBiquadFilter();
      filt.type = 'highpass';
      filt.frequency.value = 9000;
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(filt);
      filt.connect(g);
      g.connect(master);
      src.start(startT);
    }

    // Chord progression: Am → F → C → Em  (4 bars, repeats)
    // Each entry: bass root Hz, arp chord tones Hz (ascending), melody Hz
    const chords = [
      { bass: 110,   arp: [220, 261.63, 329.63, 440]    }, // Am
      { bass: 87.31, arp: [174.61, 220, 261.63, 349.23] }, // F
      { bass: 65.41, arp: [130.81, 164.81, 196, 261.63] }, // C
      { bass: 82.41, arp: [164.81, 196, 246.94, 329.63] }, // Em
    ];

    // 16-note melody across the 4 bars (A minor scale, quarter note per step)
    const melody = [
      659.25, 587.33, 523.25, 587.33,  // bar 1 (Am)
      698.46, 523.25, 440.00, 493.88,  // bar 2 (F)
      523.25, 659.25, 587.33, 523.25,  // bar 3 (C)
      440.00, 493.88, 440.00, 329.63,  // bar 4 (Em)
    ];

    const barLen = beat * 4;
    let nextTime = c.currentTime + 0.05;

    function scheduleLoop() {
      const loopStart = nextTime;

      for (let bar = 0; bar < chords.length; bar++) {
        const bs = loopStart + bar * barLen;
        const ch = chords[bar];

        // Bass: triangle, one note per beat, louder on beats 1 and 3
        for (let b = 0; b < 4; b++) {
          oNote(ch.bass, bs + b * beat, beat * 0.82, b % 2 === 0 ? 0.48 : 0.26, 'triangle');
        }

        // Arpeggio: square wave, 16th notes, cycling through 4 chord tones
        for (let s = 0; s < 16; s++) {
          oNote(ch.arp[s % 4], bs + s * sixteenth, sixteenth * 0.78, 0.062, 'square');
        }

        // Melody: sine with reverb, quarter notes
        for (let m = 0; m < 4; m++) {
          oNote(melody[bar * 4 + m], bs + m * beat, beat * 0.74, m === 0 ? 0.11 : 0.075, 'sine', true);
        }

        // Hi-hats: 8th notes, accented on the beat
        for (let h = 0; h < 8; h++) {
          hat(bs + h * (beat * 0.5), h % 2 === 0 ? 0.072 : 0.036);
        }
      }

      nextTime = loopStart + chords.length * barLen;
      // Re-schedule ~300 ms before the loop ends
      setTimeout(scheduleLoop, Math.max(0, (nextTime - c.currentTime - 0.3) * 1000));
    }

    scheduleLoop();

    // Subtle always-on low pad for warmth
    const padG = c.createGain();
    padG.gain.value = 0.038;
    padG.connect(master);
    [55, 82.41].forEach(f => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(padG);
      o.start();
    });
  }

  // --- Extra life pickup: ascending arpeggio ---
  function playPickup() {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
    const t = c.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const st = t + i * 0.07;
      gain.gain.setValueAtTime(0.18, st);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.22);
      osc.start(st);
      osc.stop(st + 0.23);
    });
  }

  // --- Game over (speech) ---
  function sayGameOver() {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
      try {
        const utt  = new SpeechSynthesisUtterance('Game over. Play again?');
        utt.rate   = 0.88;
        utt.pitch  = 0.85;
        utt.volume = 1;
        window.speechSynthesis.speak(utt);
      } catch (_) {}
    }, 700);
  }

  return { resume, playShoot, playExplosion, startAmbient, playPickup, sayGameOver };
})();
