// avoid/src/audio.js — procedural sound engine
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

  // ── Laser shoot ─────────────────────────────────────────────────────────────
  function playShoot() {
    const c = ac();
    const t = c.currentTime;
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.connect(g); g.connect(c.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1100, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.08);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.start(t); osc.stop(t + 0.09);
  }

  // ── Asteroid hit ─────────────────────────────────────────────────────────────
  function playAsteroidHit(size) {
    const c  = ac();
    const t  = c.currentTime;
    const sr = c.sampleRate;

    const cfg = {
      large:  { thudHz: 55,  thudDur: 0.55, noiseFreqH: 350,  noiseFreqL: 40,  noiseDur: 0.50, vol: 0.55 },
      medium: { thudHz: 100, thudDur: 0.32, noiseFreqH: 900,  noiseFreqL: 90,  noiseDur: 0.28, vol: 0.38 },
      small:  { thudHz: 200, thudDur: 0.16, noiseFreqH: 2800, noiseFreqL: 300, noiseDur: 0.14, vol: 0.24 },
    };
    const p = cfg[size] || cfg.medium;

    // Pitched thud
    const thud  = c.createOscillator();
    const thudG = c.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(p.thudHz * 2.8, t);
    thud.frequency.exponentialRampToValueAtTime(p.thudHz * 0.5, t + p.thudDur);
    thudG.gain.setValueAtTime(p.vol * 0.65, t);
    thudG.gain.exponentialRampToValueAtTime(0.001, t + p.thudDur);
    thud.connect(thudG); thudG.connect(c.destination);
    thud.start(t); thud.stop(t + p.thudDur + 0.01);

    // Noise crunch, bandpass swept low
    const nLen = Math.ceil(sr * p.noiseDur);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.3);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(p.noiseFreqH, t);
    filt.frequency.exponentialRampToValueAtTime(p.noiseFreqL, t + p.noiseDur);
    filt.Q.value = 0.7;
    const nG = c.createGain();
    nG.gain.setValueAtTime(p.vol, t);
    nG.gain.exponentialRampToValueAtTime(0.001, t + p.noiseDur * 0.9);
    nsrc.connect(filt); filt.connect(nG); nG.connect(c.destination);
    nsrc.start(t);
  }

  // ── Ship explosion ────────────────────────────────────────────────────────────
  function playShipExplosion() {
    const c  = ac();
    const t  = c.currentTime;
    const sr = c.sampleRate;

    // Deep descending boom
    const boom  = c.createOscillator();
    const boomG = c.createGain();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(85, t);
    boom.frequency.exponentialRampToValueAtTime(18, t + 0.7);
    boomG.gain.setValueAtTime(0.72, t);
    boomG.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    boom.connect(boomG); boomG.connect(c.destination);
    boom.start(t); boom.stop(t + 0.71);

    // Broadband noise burst, lowpass sweep
    const nDur = 1.0;
    const nLen = Math.ceil(sr * nDur);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, 1.1);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(3500, t);
    filt.frequency.exponentialRampToValueAtTime(180, t + nDur);
    const nG = c.createGain();
    nG.gain.setValueAtTime(0.6, t);
    nG.gain.exponentialRampToValueAtTime(0.001, t + nDur);
    nsrc.connect(filt); filt.connect(nG); nG.connect(c.destination);
    nsrc.start(t);

    // Ringing metallic partials
    [320, 510, 770, 1040].forEach((freq, i) => {
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const st = t + i * 0.018;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.055, st + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.28 + Math.random() * 0.14);
      osc.connect(g); g.connect(c.destination);
      osc.start(st); osc.stop(st + 0.5);
    });
  }

  // ── Shield deflect ─────────────────────────────────────────────────────────────
  function playShieldDeflect() {
    const c = ac();
    const t = c.currentTime;

    // Three rising metallic tones + brief noise swoosh
    [550, 825, 1100].forEach((freq, i) => {
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const st = t + i * 0.012;
      g.gain.setValueAtTime(0.07, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.16);
      osc.connect(g); g.connect(c.destination);
      osc.start(st); osc.stop(st + 0.17);
    });

    // Short high-pass noise whoosh
    const sr   = c.sampleRate;
    const nLen = Math.ceil(sr * 0.09);
    const nBuf = c.createBuffer(1, nLen, sr);
    const nd   = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
    const nsrc = c.createBufferSource();
    nsrc.buffer = nBuf;
    const filt  = c.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 4000;
    const nG = c.createGain();
    nG.gain.setValueAtTime(0.18, t);
    nG.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    nsrc.connect(filt); filt.connect(nG); nG.connect(c.destination);
    nsrc.start(t);
  }

  // ── Background music ──────────────────────────────────────────────────────────
  let musicStarted = false;
  let _pressure    = 0; // 0 = slow/calm, 1 = fast/frantic

  function setTempoPressure(p) { _pressure = Math.max(0, Math.min(1, p)); }

  function startMusic() {
    if (musicStarted) return;
    musicStarted = true;
    const c  = ac();
    const sr = c.sampleRate;

    // Master bus
    const master = c.createGain();
    master.gain.value = 0.20;
    master.connect(c.destination);

    // Space reverb (long decay)
    const revLen = Math.ceil(sr * 2.8);
    const revBuf = c.createBuffer(2, revLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = revBuf.getChannelData(ch);
      for (let i = 0; i < revLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / revLen, 3.2);
    }
    const reverb  = c.createConvolver();
    reverb.buffer = revBuf;
    const revSend = c.createGain();
    revSend.gain.value = 0.28;
    reverb.connect(revSend); revSend.connect(master);

    // ── Pulsing bass (classic 2-note Asteroids-style) ─────────────────────────
    // Two triangle notes alternating. Interval: 0.75s (calm) → 0.18s (frantic).
    const bassFreqs = [110, 82.4]; // A2, E2
    let bassIdx     = 0;
    let nextBassT   = c.currentTime + 0.05;

    function scheduleBass() {
      const interval = 0.75 - _pressure * 0.57; // 0.75s → 0.18s
      const lookahead = 0.9;
      while (nextBassT < c.currentTime + lookahead) {
        const freq = bassFreqs[bassIdx & 1];
        bassIdx++;
        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, nextBassT);
        g.gain.linearRampToValueAtTime(0.55, nextBassT + 0.014);
        g.gain.setValueAtTime(0.55, nextBassT + interval * 0.28);
        g.gain.exponentialRampToValueAtTime(0.001, nextBassT + interval * 0.82);
        osc.connect(g); g.connect(master);
        osc.start(nextBassT); osc.stop(nextBassT + interval * 0.84);
        nextBassT += interval;
      }
      setTimeout(scheduleBass, 60);
    }

    // ── Arp melody (A-minor pattern, syncs loosely with bass) ─────────────────
    // Interval: 0.28s (calm) → 0.09s (frantic). Square wave, very quiet.
    const arpNotes = [220, 261.63, 329.63, 440, 392, 329.63, 261.63, 196];
    let arpIdx     = 0;
    let nextArpT   = c.currentTime + 0.15;

    function scheduleArp() {
      const interval = 0.28 - _pressure * 0.19; // 0.28s → 0.09s
      const lookahead = 0.5;
      while (nextArpT < c.currentTime + lookahead) {
        const freq = arpNotes[arpIdx % arpNotes.length];
        arpIdx++;
        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, nextArpT);
        g.gain.linearRampToValueAtTime(0.018, nextArpT + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, nextArpT + interval * 0.55);
        osc.connect(g); g.connect(master);
        // Light reverb send
        const revG = c.createGain(); revG.gain.value = 0.5;
        g.connect(revG); revG.connect(reverb);
        osc.start(nextArpT); osc.stop(nextArpT + interval * 0.57);
        nextArpT += interval;
      }
      setTimeout(scheduleArp, 40);
    }

    // ── Always-on low pad for depth ────────────────────────────────────────────
    const padG = c.createGain();
    padG.gain.value = 0.022;
    padG.connect(master); padG.connect(reverb);
    [55, 82.4, 110].forEach(f => {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(padG); o.start();
    });

    scheduleBass();
    scheduleArp();
  }

  return { resume, playShoot, playAsteroidHit, playShipExplosion, playShieldDeflect, startMusic, setTempoPressure };
})();
