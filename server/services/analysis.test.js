import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  peaksFromSamples,
  rmsEnvelope,
  median,
  octaveFold,
  tempoFromBeats,
  detectSilences,
  noveltyCurve,
  pickSections,
} from './analysis.js';

const COUNT = 100;
const FS = 32767; // full-scale Int16 magnitude

/** Full-scale sine: amplitude = FS. */
function fullScaleSine(len, period = 64) {
  const a = new Int16Array(len);
  for (let i = 0; i < len; i++) a[i] = Math.round(FS * Math.sin((2 * Math.PI * i) / period));
  return a;
}

test('peaksFromSamples: full-scale sine -> ~1.0 per bucket', () => {
  const s = fullScaleSine(COUNT * 1000);
  const p = peaksFromSamples(s, COUNT);
  assert.equal(p.length, COUNT);
  for (const v of p) assert.ok(v > 0.99 && v <= 1.0, `peak ${v} not ~1.0`);
});

test('rmsEnvelope: full-scale sine -> ~0.707 per bucket', () => {
  const s = fullScaleSine(COUNT * 1000);
  const r = rmsEnvelope(s, COUNT);
  assert.equal(r.length, COUNT);
  for (const v of r) assert.ok(Math.abs(v - 0.707) < 0.01, `rms ${v} not ~0.707`);
});

test('silence -> all ~0', () => {
  const s = new Int16Array(COUNT * 1000); // all zeros
  const p = peaksFromSamples(s, COUNT);
  const r = rmsEnvelope(s, COUNT);
  assert.equal(p.length, COUNT);
  assert.equal(r.length, COUNT);
  for (const v of p) assert.equal(v, 0);
  for (const v of r) assert.equal(v, 0);
});

test('empty input -> zero-filled length count', () => {
  const empty = new Int16Array(0);
  assert.deepEqual(peaksFromSamples(empty, COUNT), new Array(COUNT).fill(0));
  assert.deepEqual(rmsEnvelope(empty, COUNT), new Array(COUNT).fill(0));
});

test('output length always === count (short input padded)', () => {
  const s = fullScaleSine(10); // fewer samples than count
  assert.equal(peaksFromSamples(s, COUNT).length, COUNT);
  assert.equal(rmsEnvelope(s, COUNT).length, COUNT);
});

// --- tempo math -----------------------------------------------------------

test('median: odd and even length', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

test('octaveFold: folds into [70,180]', () => {
  assert.equal(octaveFold(60), 120); // too slow -> double
  assert.equal(octaveFold(200), 100); // too fast -> halve
  assert.equal(octaveFold(120), 120); // already in range
  assert.equal(octaveFold(40), 80); // 40 -> 80; 80 in range so stops
  assert.equal(octaveFold(30), 120); // 30 -> 60 -> 120
  assert.equal(octaveFold(360), 180); // 360 -> 180; 180 not > 180 so stops
  assert.equal(octaveFold(400), 100); // 400 -> 200 (>180) -> 100
  assert.equal(octaveFold(0), 0); // degenerate passthrough
});

test('tempoFromBeats: perfectly regular 0.5s beats -> 120 bpm, confidence ~1', () => {
  const beats = [];
  for (let i = 0; i < 16; i++) beats.push(1.0 + i * 0.5); // 0.5s interval, firstBeat=1.0
  const t = tempoFromBeats(beats);
  assert.ok(t, 'expected a tempo result');
  assert.ok(Math.abs(t.bpm - 120) < 1e-6, `bpm ${t.bpm} not 120`);
  assert.ok(Math.abs(t.confidence - 1) < 1e-9, `confidence ${t.confidence} not ~1`);
  assert.equal(t.firstBeatSec, 1.0);
});

test('tempoFromBeats: irregular beats -> confidence < 1', () => {
  const beats = [0, 0.5, 1.2, 1.5, 2.4]; // jittered intervals
  const t = tempoFromBeats(beats);
  assert.ok(t, 'expected a tempo result');
  assert.ok(t.confidence >= 0 && t.confidence < 1, `confidence ${t.confidence} not in [0,1)`);
});

test('tempoFromBeats: <2 beats -> null', () => {
  assert.equal(tempoFromBeats([]), null);
  assert.equal(tempoFromBeats([1.0]), null);
});

test('tempoFromBeats: slow 1.0s beats octave-folded to 120 bpm', () => {
  const beats = [0, 1, 2, 3, 4]; // 1.0s interval -> 60 bpm -> fold to 120
  const t = tempoFromBeats(beats);
  assert.ok(Math.abs(t.bpm - 120) < 1e-6, `bpm ${t.bpm} not folded to 120`);
});

// --- silence detection -----------------------------------------------------

test('detectSilences: one clear low region -> matching {start,end}', () => {
  // N=100 over 10s -> 0.1s/bucket. Loud everywhere except buckets [40,60) which
  // are silent: that quiet run spans 4.0s..6.0s (>= minDur 0.5s).
  const N = 100;
  const duration = 10;
  const rms = new Array(N).fill(0.5);
  for (let i = 40; i < 60; i++) rms[i] = 0.0; // silent stretch
  const sil = detectSilences(rms, duration);
  assert.equal(sil.length, 1, `expected exactly 1 silence, got ${sil.length}`);
  assert.ok(Math.abs(sil[0].start - 4.0) < 1e-9, `start ${sil[0].start} not 4.0`);
  assert.ok(Math.abs(sil[0].end - 6.0) < 1e-9, `end ${sil[0].end} not 6.0`);
});

test('detectSilences: short dips below minDur are ignored', () => {
  const N = 100;
  const duration = 10; // 0.1s/bucket
  const rms = new Array(N).fill(0.5);
  rms[50] = 0.0; // single 0.1s bucket -> below minDur 0.5s
  assert.deepEqual(detectSilences(rms, duration), []);
});

test('detectSilences: leading/trailing silence + threshold honored', () => {
  const N = 100;
  const duration = 10;
  const rms = new Array(N).fill(0.5);
  for (let i = 0; i < 10; i++) rms[i] = 0.005; // 0..1.0s below threshold 0.012
  for (let i = 90; i < 100; i++) rms[i] = 0.5; // loud tail (no trailing silence)
  const sil = detectSilences(rms, duration);
  assert.equal(sil.length, 1);
  assert.ok(Math.abs(sil[0].start - 0.0) < 1e-9, `start ${sil[0].start} not 0`);
  assert.ok(Math.abs(sil[0].end - 1.0) < 1e-9, `end ${sil[0].end} not 1.0`);
});

test('detectSilences: empty / degenerate input -> []', () => {
  assert.deepEqual(detectSilences([], 10), []);
  assert.deepEqual(detectSilences(new Array(10).fill(0), 0), []);
});

// --- novelty + section picking ---------------------------------------------

/** Bands with an abrupt timbre flip at bucket `at`: low-dominant -> high-dominant. */
function abruptTimbreBands(N, at) {
  const low = new Array(N).fill(0);
  const mid = new Array(N).fill(0.1);
  const high = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (i < at) {
      low[i] = 0.8;
      high[i] = 0.05;
    } else {
      low[i] = 0.05;
      high[i] = 0.8;
    }
  }
  return { low, mid, high };
}

test('noveltyCurve: spikes at an abrupt timbre change', () => {
  const N = 100;
  const at = 50;
  const nov = noveltyCurve(abruptTimbreBands(N, at), N);
  assert.equal(nov.length, N);
  assert.ok(Math.max(...nov) <= 1.0 && Math.min(...nov) >= 0, 'novelty not normalized 0..1');
  // The global max should sit right at the transition (within the smoothing window).
  let argmax = 0;
  for (let i = 1; i < N; i++) if (nov[i] > nov[argmax]) argmax = i;
  assert.ok(Math.abs(argmax - at) <= 2, `novelty peak at ${argmax}, expected ~${at}`);
});

test('noveltyCurve: missing bands -> []', () => {
  assert.deepEqual(noveltyCurve(null, 100), []);
  assert.deepEqual(noveltyCurve({ low: [], mid: [] }, 100), []);
});

test('pickSections: finds a section near the timbre change', () => {
  const N = 100;
  const at = 50;
  const duration = 100; // 1s/bucket -> change at ~50s
  const nov = noveltyCurve(abruptTimbreBands(N, at), N);
  const sections = pickSections(nov, duration);
  assert.ok(sections.length >= 1, 'expected at least one section');
  // Some section should land near 50s.
  const near = sections.find((s) => Math.abs(s.time - 50) <= 3);
  assert.ok(near, `no section near 50s in ${JSON.stringify(sections.map((s) => s.time))}`);
  assert.ok(near.strength > 0 && near.strength <= 1, `strength ${near.strength} not in (0,1]`);
});

test('pickSections: enforces minSpacing between picks', () => {
  // Two timbre flips close together (5s apart at 1s/bucket); minSpacing 8 must
  // collapse them to a single accepted pick.
  const N = 100;
  const duration = 100;
  const bands = abruptTimbreBands(N, 50);
  // Add a second flip 5 buckets later by perturbing high band.
  for (let i = 55; i < N; i++) bands.high[i] = 0.4;
  const nov = noveltyCurve(bands, N);
  const sections = pickSections(nov, duration, { minSpacing: 8 });
  for (let i = 1; i < sections.length; i++) {
    assert.ok(
      sections[i].time - sections[i - 1].time >= 8,
      `picks ${sections[i - 1].time} and ${sections[i].time} closer than minSpacing`
    );
  }
});

test('pickSections: missing/empty novelty -> []', () => {
  assert.deepEqual(pickSections([], 100), []);
  assert.deepEqual(pickSections(noveltyCurve(null, 100), 100), []);
});
