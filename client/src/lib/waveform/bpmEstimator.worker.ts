/**
 * Instant provisional BPM (Phase 5e) — a small, dependency-free estimator that
 * runs in a Web Worker so it never blocks the UI or bloats the main bundle. It
 * autocorrelates an onset/energy-flux envelope and picks the strongest lag in the
 * musical range, octave-folded to [70,180]. This is a PROVISIONAL value shown
 * instantly on upload; the server's BeatNet result (authoritative) overwrites it.
 */
type In = { samples: Float32Array; sampleRate: number };

self.onmessage = (e: MessageEvent<In>) => {
  try {
    const { samples, sampleRate } = e.data;
    const bpm = estimateBpm(samples, sampleRate);
    (self as unknown as Worker).postMessage({ bpm });
  } catch {
    (self as unknown as Worker).postMessage({ bpm: null });
  }
};

function estimateBpm(samples: Float32Array, sr: number): number | null {
  if (!samples?.length || sr <= 0) return null;

  // Onset envelope: positive frame-to-frame energy change (spectral-flux proxy).
  const hop = Math.max(1, Math.floor(sr / 100)); // ~100 Hz envelope
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i < samples.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop && j < samples.length; j++) e += samples[j] * samples[j];
    const flux = Math.max(0, e - prev);
    env.push(flux);
    prev = e;
  }
  if (env.length < 8) return null;

  // Normalize + mean-remove the envelope.
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  for (let i = 0; i < env.length; i++) env[i] -= mean;

  const envRate = sr / hop; // envelope samples per second
  const minLag = Math.floor((60 / 180) * envRate); // fastest 180 BPM
  const maxLag = Math.floor((60 / 70) * envRate); // slowest 70 BPM

  let bestLag = 0;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < env.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;

  let bpm = (60 * envRate) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}
