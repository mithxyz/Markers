// Pure, I/O-free signal-reduction helpers over an Int16Array of mono PCM
// samples (s16le). Each function buckets the samples into `count` evenly-sized
// windows and reduces each window to a single normalized (0..1) value. The
// bucketing is identical across helpers so `data` and `rms` share alignment:
//   time(i) = i / count * duration.
// Int16 is normalized by /32768 (full-scale magnitude).

/**
 * Reduce samples to `count` max-abs peak buckets, normalized 0..1.
 * @param {Int16Array} samples mono PCM
 * @param {number} count number of output buckets
 * @returns {number[]} length `count`
 */
export function peaksFromSamples(samples, count) {
  if (!samples || samples.length === 0) return new Array(count).fill(0);

  const per = Math.max(1, Math.floor(samples.length / count));
  const n = Math.min(count, Math.ceil(samples.length / per));
  const peaks = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const start = i * per;
    const end = Math.min(start + per, samples.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max / 32768;
  }
  // Pad to exactly `count` for consistent alignment across bands.
  while (peaks.length < count) peaks.push(0);
  return peaks;
}

/**
 * Reduce samples to `count` RMS (root-mean-square) buckets, normalized 0..1.
 * Each value = sqrt(mean(sample^2)) / 32768 over that bucket. Same bucketing
 * (and thus alignment) as peaksFromSamples.
 * @param {Int16Array} samples mono PCM
 * @param {number} count number of output buckets
 * @returns {number[]} length `count`
 */
export function rmsEnvelope(samples, count) {
  if (!samples || samples.length === 0) return new Array(count).fill(0);

  const per = Math.max(1, Math.floor(samples.length / count));
  const n = Math.min(count, Math.ceil(samples.length / per));
  const rms = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const start = i * per;
    const end = Math.min(start + per, samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j];
      sum += v * v;
    }
    const len = end - start;
    rms[i] = len > 0 ? Math.sqrt(sum / len) / 32768 : 0;
  }
  // Pad to exactly `count` for consistent alignment with data.
  while (rms.length < count) rms.push(0);
  return rms;
}

// ---------------------------------------------------------------------------
// Tempo math — pure helpers over an array of beat times (seconds). Kept here
// (I/O-free) so the aubio shelling stays in waveform.js and this stays unit-
// testable. All functions tolerate short/degenerate input.

/** Median of a numeric array (sorted copy). Returns 0 for empty input. */
export function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arithmetic mean. Returns 0 for empty input. */
export function mean(values) {
  if (!values || values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation. Returns 0 for fewer than 2 values. */
export function stddev(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - m) * (v - m);
  return Math.sqrt(sum / values.length);
}

/**
 * Fold a bpm into [70, 180] by doubling/halving (octave error correction).
 * A bpm of 0 or non-finite is returned unchanged.
 */
export function octaveFold(bpm, lo = 70, hi = 180) {
  if (!Number.isFinite(bpm) || bpm <= 0) return bpm;
  while (bpm < lo) bpm *= 2;
  while (bpm > hi) bpm /= 2;
  return bpm;
}

/** Clamp x into [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Derive tempo from ascending beat times (seconds). Returns
 * { bpm, confidence, firstBeatSec, ibi } or null if fewer than 2 beats.
 *   bpm        = octaveFold(60 / median(inter-beat intervals))
 *   confidence = clamp(1 - stddev(ibi)/mean(ibi), 0, 1)  (beat regularity)
 */
export function tempoFromBeats(beats) {
  if (!beats || beats.length < 2) return null;
  const ibi = [];
  for (let i = 1; i < beats.length; i++) ibi.push(beats[i] - beats[i - 1]);

  const med = median(ibi);
  if (!(med > 0)) return null;

  const bpm = octaveFold(60 / med);
  const m = mean(ibi);
  const confidence = m > 0 ? clamp(1 - stddev(ibi) / m, 0, 1) : 0;

  return { bpm, confidence, firstBeatSec: beats[0], ibi };
}

// ---------------------------------------------------------------------------
// Tier 3 — silence + section (structure) analysis. Pure, I/O-free helpers over
// the per-bucket reductions already produced above (rms envelope + the three
// band peak arrays). Bucket index -> time(i) = i / N * duration (the same
// alignment law as data/bands/rms).

/**
 * Detect quiet stretches from the rms loudness envelope.
 *
 * Walks the `rms` envelope (length N, uniform over `duration` seconds) and
 * collects runs of consecutive buckets whose value is below `threshold`. A run
 * is emitted as a {start, end} (seconds) only if its time-span is >= `minDur`.
 * Adjacent runs are inherently merged (a run is a maximal consecutive span).
 *
 * @param {number[]} rms per-bucket loudness envelope, 0..1
 * @param {number} duration total seconds the envelope spans
 * @param {{threshold?: number, minDur?: number}} [opts]
 * @returns {{start: number, end: number}[]} ascending, [] if none / bad input
 */
export function detectSilences(rms, duration, { threshold = 0.012, minDur = 0.5 } = {}) {
  if (!Array.isArray(rms) || rms.length === 0) return [];
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const N = rms.length;
  const secPerBucket = duration / N;
  const out = [];
  let runStart = -1; // bucket index where the current quiet run began

  const flush = (endIdx) => {
    if (runStart < 0) return;
    const start = (runStart / N) * duration;
    const end = (endIdx / N) * duration; // exclusive bucket boundary -> run end
    if (end - start >= minDur) out.push({ start, end });
    runStart = -1;
  };

  for (let i = 0; i < N; i++) {
    if (rms[i] < threshold) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(N); // close a run that extends to the final bucket

  // Guard against a zero-width final bucket edge case.
  void secPerBucket;
  return out;
}

/**
 * Build a per-bucket novelty curve from the three band-energy arrays.
 *
 * Each bucket i is a 3-D timbre vector [low, mid, high]. Vectors are smoothed
 * over a small +/- window to reject single-bucket jitter, then novelty[i] is
 * the Euclidean distance between the smoothed vector at i and i-1 (a lightweight
 * checkerboard/self-similarity novelty). The curve is normalized to 0..1.
 *
 * @param {{low: number[], mid: number[], high: number[]}} bands
 * @param {number} N expected length (all bands assumed length N)
 * @returns {number[]} novelty length N (novelty[0] = 0), [] if bands missing
 */
export function noveltyCurve(bands, N) {
  if (!bands || !bands.low || !bands.mid || !bands.high) return [];
  const { low, mid, high } = bands;
  if (!(N > 0)) return [];

  const W = 2; // smoothing half-window (+/- 2 buckets)
  // Smooth each band by a simple boxcar average over [i-W, i+W].
  const smooth = (arr) => {
    const s = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = i - W; k <= i + W; k++) {
        if (k < 0 || k >= N) continue;
        sum += arr[k] || 0;
        cnt++;
      }
      s[i] = cnt > 0 ? sum / cnt : 0;
    }
    return s;
  };

  const sl = smooth(low);
  const sm = smooth(mid);
  const sh = smooth(high);

  const novelty = new Array(N).fill(0);
  let max = 0;
  for (let i = 1; i < N; i++) {
    const dl = sl[i] - sl[i - 1];
    const dm = sm[i] - sm[i - 1];
    const dh = sh[i] - sh[i - 1];
    const d = Math.sqrt(dl * dl + dm * dm + dh * dh);
    novelty[i] = d;
    if (d > max) max = d;
  }
  if (max > 0) for (let i = 0; i < N; i++) novelty[i] /= max;
  return novelty;
}

/**
 * Peak-pick a novelty curve into section boundaries.
 *
 * Picks local maxima above an adaptive threshold (mean + 1*stddev of the
 * novelty values), then enforces a `minSpacing` (seconds) gap between accepted
 * picks (keeping the stronger peak when two fall too close). Each pick maps to
 * {time, strength} where strength is the novelty value (0..1).
 *
 * @param {number[]} novelty length N, 0..1
 * @param {number} duration total seconds the curve spans
 * @param {{minSpacing?: number}} [opts]
 * @returns {{time: number, strength: number}[]} ascending by time, [] if none
 */
export function pickSections(novelty, duration, { minSpacing = 8 } = {}) {
  if (!Array.isArray(novelty) || novelty.length === 0) return [];
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const N = novelty.length;
  const thr = mean(novelty) + stddev(novelty); // adaptive: mean + 1*stddev

  // Candidate local maxima strictly above threshold.
  const cands = [];
  for (let i = 1; i < N - 1; i++) {
    const v = novelty[i];
    if (v > thr && v >= novelty[i - 1] && v >= novelty[i + 1]) {
      cands.push({ time: (i / N) * duration, strength: v });
    }
  }
  // Edge case: a peak at the very last bucket (no i+1 to compare).
  if (N >= 2) {
    const last = N - 1;
    if (novelty[last] > thr && novelty[last] >= novelty[last - 1]) {
      cands.push({ time: (last / N) * duration, strength: novelty[last] });
    }
  }
  if (cands.length === 0) return [];

  // Greedy by descending strength; accept a pick only if it is >= minSpacing
  // seconds from every already-accepted pick. This keeps the stronger of any
  // too-close pair. Re-sort the survivors by time for an ascending result.
  cands.sort((a, b) => b.strength - a.strength);
  const accepted = [];
  for (const c of cands) {
    if (accepted.every((a) => Math.abs(a.time - c.time) >= minSpacing)) accepted.push(c);
  }
  accepted.sort((a, b) => a.time - b.time);
  return accepted;
}

export default {
  peaksFromSamples,
  rmsEnvelope,
  median,
  mean,
  stddev,
  octaveFold,
  clamp,
  tempoFromBeats,
  detectSilences,
  noveltyCurve,
  pickSections,
};
