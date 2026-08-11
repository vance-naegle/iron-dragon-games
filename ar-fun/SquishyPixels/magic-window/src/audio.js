// src/audio.js — procedural Web Audio jingle for Magic Window.
// Same philosophy as ../../../bad-triangles/src/audio.js (all audio
// synthesized, no asset files) but written as an ES module — this
// experience's main.js is `type="module"`, unlike the canvas games, so it
// imports this directly rather than relying on a `window.SoundFX` global.
//
// A "MIDI jingle" in the literal sense (an actual .mid file) has no native
// browser playback without an extra soundfont-synth library — a small
// scheduled oscillator loop gets the same "looping chiptune melody" result
// without that dependency.

let ctx = null;
let playing = false;
let loopTimer = null;
let master = null;
let padOscs = [];
let loopStartTime = 0;

const BPM = 108;
const BEAT = 60 / BPM; // seconds per beat

// Gentle music-box melody, C major, 8 notes (2 bars of 4 beats) — G E C E, A G E C.
const MELODY = [783.99, 659.25, 523.25, 659.25, 880.0, 783.99, 659.25, 523.25];
const PAD_NOTES = [261.63, 329.63]; // C4 + E4, soft sustained triad-ish backdrop

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function resume() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

// A sine fundamental + a quiet octave-up "shimmer" layer reads as a soft
// bell/music-box tone rather than a flat synth beep.
function bellNote(c, dest, freq, startT, dur, vol) {
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, startT);
  env.gain.linearRampToValueAtTime(vol, startT + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
  osc.connect(env);
  env.connect(dest);
  osc.start(startT);
  osc.stop(startT + dur + 0.02);

  const shimmer = c.createOscillator();
  const shimmerEnv = c.createGain();
  shimmer.type = 'sine';
  shimmer.frequency.value = freq * 2;
  shimmerEnv.gain.setValueAtTime(0, startT);
  shimmerEnv.gain.linearRampToValueAtTime(vol * 0.25, startT + 0.01);
  shimmerEnv.gain.exponentialRampToValueAtTime(0.0001, startT + dur * 0.6);
  shimmer.connect(shimmerEnv);
  shimmerEnv.connect(dest);
  shimmer.start(startT);
  shimmer.stop(startT + dur * 0.6 + 0.02);
}

function start() {
  if (playing) return;
  playing = true;
  const c = getCtx();
  resume();

  master = c.createGain();
  master.gain.value = 0;
  master.connect(c.destination);
  master.gain.linearRampToValueAtTime(0.22, c.currentTime + 0.3); // fade in, no click on (re)entry

  const padGain = c.createGain();
  padGain.gain.value = 0.05;
  padGain.connect(master);
  padOscs = PAD_NOTES.map((f) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(padGain);
    o.start();
    return o;
  });

  loopStartTime = c.currentTime + 0.05; // also the beat-zero reference for getBounceEnvelope()
  let nextTime = loopStartTime;

  function scheduleLoop() {
    const barStart = nextTime;
    for (let i = 0; i < MELODY.length; i++) {
      bellNote(c, master, MELODY[i], barStart + i * BEAT, BEAT * 0.9, i === 0 || i === 4 ? 0.16 : 0.11);
    }
    nextTime = barStart + MELODY.length * BEAT;
    // Re-schedule ~300ms before the loop ends, same pattern as bad-triangles' startAmbient().
    loopTimer = setTimeout(scheduleLoop, Math.max(0, (nextTime - c.currentTime - 0.3) * 1000));
  }
  scheduleLoop();
}

function stop() {
  if (!playing) return;
  playing = false;
  clearTimeout(loopTimer);
  const c = getCtx();
  if (master) {
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(master.gain.value, c.currentTime);
    master.gain.linearRampToValueAtTime(0, c.currentTime + 0.2); // fade out, no click on exit
  }
  padOscs.forEach((o) => { try { o.stop(c.currentTime + 0.25); } catch (_) {} });
  padOscs = [];
}

// Beat-synced bounce, 0..1 — sharp rise right at each beat, smooth
// exponential decay toward the next one. Derived purely from BPM/
// loopStartTime (the same clock the melody itself is scheduled against),
// not from analyzing the audio output — so the tree stays visually locked
// to the actual beat regardless of frame rate.
function getBounceEnvelope() {
  if (!playing) return 0;
  const c = getCtx();
  const elapsed = Math.max(0, c.currentTime - loopStartTime);
  const beatPhase = (elapsed / BEAT) % 1;
  return Math.exp(-6 * beatPhase);
}

function isPlaying() {
  return playing;
}

export const MagicWindowAudio = { resume, start, stop, getBounceEnvelope, isPlaying };
