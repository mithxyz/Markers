import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import chroma from 'chroma-js';
import {
  peaksFromSamples,
  rmsEnvelope,
  tempoFromBeats,
  detectSilences,
  noveltyCurve,
  pickSections,
} from './analysis.js';

const execFileP = promisify(execFile);

// Resolution + analysis sample rate. Higher than v2 (1800 @ 8kHz) for finer
// detail, especially when zoomed in.
const TARGET_PEAKS = 4000;
const ANALYSIS_SR = 22050;

/** New temp path with a random hex name and the given extension. */
function tmpPath(ext) {
  return path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}${ext}`);
}

/** Probe media duration (seconds) via ffprobe. */
export async function probeDuration(filePath) {
  const { stdout } = await execFileP(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { timeout: 60000 }
  );
  const d = parseFloat(String(stdout).trim());
  return Number.isFinite(d) ? d : 0;
}

/**
 * Decode media (optionally through an audio filter) to mono s16le PCM at
 * ANALYSIS_SR and return the raw samples as an Int16Array.
 */
async function decodePcmMono(filePath, filter, sr = ANALYSIS_SR) {
  const rawPath = tmpPath('.raw');
  try {
    const args = ['-i', filePath];
    if (filter) args.push('-af', filter);
    args.push('-ac', '1', '-ar', String(sr), '-f', 's16le', '-y', rawPath);
    await execFileP('ffmpeg', args, { timeout: 300000 });

    const rawData = await readFile(rawPath);
    return new Int16Array(rawData.buffer, rawData.byteOffset, Math.floor(rawData.byteLength / 2));
  } finally {
    await unlink(rawPath).catch(() => {});
  }
}

/** Decode through `filter` and reduce to `count` max-abs peak buckets. */
async function decodePeaks(filePath, filter, count) {
  const samples = await decodePcmMono(filePath, filter);
  return peaksFromSamples(samples, count);
}

/**
 * Decode media to a plain mono 22.05kHz wav — the safe lowest-common-
 * denominator input for the aubio CLIs. Caller owns cleanup of the returned
 * path (unlink in a finally).
 */
async function toTempWav(filePath) {
  const wavPath = tmpPath('.wav');
  await execFileP('ffmpeg', ['-i', filePath, '-ac', '1', '-ar', String(ANALYSIS_SR), '-y', wavPath], {
    timeout: 300000,
  });
  return wavPath;
}

/** Parse aubio stdout (one finite float per line) into an ascending array. */
function parseAubioTimes(stdout) {
  const times = [];
  let prev = -Infinity;
  for (const line of String(stdout).split('\n')) {
    const t = parseFloat(line.trim());
    if (Number.isFinite(t) && t >= prev) {
      times.push(t);
      prev = t;
    }
  }
  return times;
}

/**
 * Transcode to full-quality PCM WAV for in-browser playback — the codec every
 * major browser's <audio> element supports natively. Needed because several
 * source formats we accept (notably AIFF) have no native decoder in
 * Chrome/Firefox/Edge. Preserves the original channel count and sample rate
 * (no downmix/resample) and uses lossless pcm_s16le so sample-zero lines up
 * exactly with the peaks/BPM/downbeat data already computed from the original
 * decode — a lossy transcode (mp3/aac) would shift it via encoder priming.
 */
export async function transcodeToWav(filePath, outPath) {
  await execFileP('ffmpeg', ['-i', filePath, '-c:a', 'pcm_s16le', '-y', outPath], { timeout: 300000 });
  return outPath;
}

/**
 * Detect transient onset times (seconds, ascending) via the aubio CLI.
 * aubio may not be installed — on a missing binary (ENOENT) or any error we
 * return null so the field nulls out and the job still succeeds.
 *
 * `wavPath`, if supplied, is a pre-decoded mono wav that the caller owns
 * (we won't unlink it); otherwise we decode our own and clean it up. This
 * lets generateDetailedPeaks decode the wav once and share it with detectTempo.
 */
async function detectTransients(filePath, wavPath) {
  const ownWav = !wavPath;
  try {
    if (ownWav) wavPath = await toTempWav(filePath);

    let stdout;
    try {
      ({ stdout } = await execFileP('aubioonset', ['-i', wavPath], { timeout: 300000 }));
    } catch (err) {
      // Older/newer packaging exposes the subcommand form `aubio onset`.
      if (err && err.code === 'ENOENT') {
        ({ stdout } = await execFileP('aubio', ['onset', '-i', wavPath], { timeout: 300000 }));
      } else {
        throw err;
      }
    }

    // One onset time (seconds) per line. Keep finite, ascending values.
    return parseAubioTimes(stdout);
  } catch (err) {
    const missing = err && err.code === 'ENOENT';
    console.warn(`[waveform] transient detection skipped (${missing ? 'aubio not installed' : err.message})`);
    return null;
  } finally {
    if (ownWav && wavPath) await unlink(wavPath).catch(() => {});
  }
}

/**
 * Detect tempo via the aubio beat tracker (`aubiotrack`, which prints one beat
 * timestamp in seconds per line). Returns
 *   { bpm, confidence, firstBeatSec, beatGrid }
 * or null if aubio is missing / fewer than 2 beats are found. Never throws.
 *
 * bpm/confidence math lives in analysis.js (tempoFromBeats): bpm is
 * 60/median(inter-beat-interval) octave-folded into [70,180]; confidence is
 * beat regularity = clamp(1 - stddev(ibi)/mean(ibi), 0, 1).
 *
 * `beatGrid` carries the raw beat array only for short tracks (duration <=
 * 600s); for longer tracks it is null and the client reconstructs the grid
 * from bpm + firstBeatSec. `wavPath`, if supplied, is a caller-owned pre-
 * decoded wav (shared with detectTransients); otherwise we make our own.
 */
async function detectTempo(filePath, duration, wavPath) {
  const ownWav = !wavPath;
  try {
    if (ownWav) wavPath = await toTempWav(filePath);

    let stdout;
    try {
      ({ stdout } = await execFileP('aubiotrack', ['-i', wavPath], { timeout: 300000 }));
    } catch (err) {
      // Subcommand-form / alternate-binary fallbacks. `aubio beat` and
      // `aubiotempo` both emit beat timestamps in seconds, one per line.
      if (err && err.code === 'ENOENT') {
        try {
          ({ stdout } = await execFileP('aubio', ['beat', '-i', wavPath], { timeout: 300000 }));
        } catch (err2) {
          if (err2 && err2.code === 'ENOENT') {
            ({ stdout } = await execFileP('aubiotempo', ['-i', wavPath], { timeout: 300000 }));
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }

    const beats = parseAubioTimes(stdout);
    const tempo = tempoFromBeats(beats);
    if (!tempo) {
      console.warn(`[waveform] tempo detection skipped (only ${beats.length} beat(s) found)`);
      return null;
    }

    // Raw grid only for short tracks; long tracks rebuild client-side.
    const beatGrid = Number.isFinite(duration) && duration > 0 && duration <= 600 ? beats : null;

    return {
      bpm: tempo.bpm,
      confidence: tempo.confidence,
      firstBeatSec: tempo.firstBeatSec,
      beatGrid,
    };
  } catch (err) {
    const missing = err && err.code === 'ENOENT';
    console.warn(`[waveform] tempo detection skipped (${missing ? 'aubio not installed' : err.message})`);
    return null;
  } finally {
    if (ownWav && wavPath) await unlink(wavPath).catch(() => {});
  }
}

/**
 * Detailed peaks JSON (version 4). `data` is the overall waveform (consumed by
 * wavesurfer's simple view). `bands` holds low/mid/high energy per slice for
 * the CDJ/Rekordbox-style coloured renderer. `rms` is the loudness envelope
 * (same alignment as `data`), `transients` are onset times in seconds.
 *
 * Every analysis block is individually try/caught: one failure nulls only its
 * own field and never throws the whole job. `duration` is the probed media
 * duration (probed internally if not supplied). Returns null for silent/empty
 * media (overall `data` all-zero).
 */
export async function generateDetailedPeaks(filePath, duration) {
  // Decode once; derive overall peaks + rms from the single buffer.
  const samples = await decodePcmMono(filePath, null);
  const data = peaksFromSamples(samples, TARGET_PEAKS);
  if (!data.some((v) => v > 0)) return null; // silent/empty media — bail.

  if (duration === undefined) {
    try {
      duration = await probeDuration(filePath);
    } catch {
      duration = 0;
    }
  }

  // RMS loudness envelope from the same decoded buffer.
  let rms = null;
  try {
    rms = rmsEnvelope(samples, TARGET_PEAKS);
  } catch (err) {
    console.warn(`[waveform] rms envelope failed: ${err.message}`);
    rms = null;
  }

  // Three frequency bands (rough but visually effective splits). Each pass is
  // its own ffmpeg decode; if the set fails, null the whole bands block.
  let bands = null;
  try {
    const [low, mid, high] = await Promise.all([
      decodePeaks(filePath, 'lowpass=f=250', TARGET_PEAKS),
      decodePeaks(filePath, 'highpass=f=250,lowpass=f=2500', TARGET_PEAKS),
      decodePeaks(filePath, 'highpass=f=2500', TARGET_PEAKS),
    ]);
    bands = { low, mid, high };
  } catch (err) {
    console.warn(`[waveform] band analysis failed: ${err.message}`);
    bands = null;
  }

  // Tier 3 structure analysis — all derived from the per-bucket reductions
  // above (no extra decode). Each is its own try/catch -> null on failure;
  // sections/novelty depend on bands, silences on rms. Always computed (the
  // client gates section *display* behind a per-track flag; computing is cheap).
  let silences = null;
  try {
    silences = rms ? detectSilences(rms, duration) : null;
  } catch (err) {
    console.warn(`[waveform] silence detection failed: ${err.message}`);
    silences = null;
  }

  let novelty = null;
  try {
    novelty = bands ? noveltyCurve(bands, data.length) : null;
  } catch (err) {
    console.warn(`[waveform] novelty curve failed: ${err.message}`);
    novelty = null;
  }

  let sections = null;
  try {
    sections = novelty ? pickSections(novelty, duration) : null;
  } catch (err) {
    console.warn(`[waveform] section picking failed: ${err.message}`);
    sections = null;
  }

  // Decode the aubio input wav once and share it between transient + tempo
  // detection (both need a plain mono wav). If the decode fails, both fall
  // back to making their own wav so they stay independently correct.
  let sharedWav = null;
  try {
    sharedWav = await toTempWav(filePath);
  } catch (err) {
    console.warn(`[waveform] shared wav decode failed, falling back to per-analysis decode: ${err.message}`);
    sharedWav = null;
  }

  try {
    // Transient onsets (aubio); returns null on its own if unavailable.
    let transients = null;
    try {
      transients = await detectTransients(filePath, sharedWav);
    } catch (err) {
      console.warn(`[waveform] transient analysis failed: ${err.message}`);
      transients = null;
    }

    // Tempo / beat grid (aubio); returns null on its own if unavailable.
    let tempo = null;
    try {
      tempo = await detectTempo(filePath, duration, sharedWav);
    } catch (err) {
      console.warn(`[waveform] tempo analysis failed: ${err.message}`);
      tempo = null;
    }

    return {
      version: 4,
      channels: 1,
      sample_rate: ANALYSIS_SR,
      length: data.length,
      duration,
      data,
      bands,
      rms,
      transients,
      tempo,
      silences,
      sections,
      novelty,
    };
  } finally {
    if (sharedWav) await unlink(sharedWav).catch(() => {});
  }
}

/**
 * time-line.io-style energy colour ramp (dark indigo → magenta → amber), tuned
 * to the app's dark theme. `chroma.scale(...).domain(...)` returns a function we
 * call per bucket; `.mode('lab')` gives a smoother perceptual gradient.
 */
const RGB_SCALE = chroma.scale(['#1e1e3f', '#a13670', '#ffce00']).mode('lab').domain([0, 0.6, 1]);

/**
 * Bake a per-bucket RGB waveform artifact from an already-computed peaks object
 * (Phase 1A). Matches time-line.io's wire format:
 *   { waveformRGBHDCompressed: <base64( zlib.deflate( JSON([[amp,[r,g,b]], …]) ) )> }
 * where `amp` is the 0..1 peak height and `[r,g,b]` is the colormap output for
 * that bucket's normalized energy (RMS if available, else the peak itself).
 *
 * Returns the wrapped object (ready to JSON.stringify + upload), or null if the
 * peaks lack usable `data`. Never throws — colouring is best-effort.
 */
export function buildWaveformRgb(peaks) {
  const data = peaks && Array.isArray(peaks.data) ? peaks.data : null;
  if (!data || data.length === 0) return null;

  // Energy signal drives colour; prefer the RMS loudness envelope, fall back to
  // the peak amplitude. Normalize to [0,1] by the max so quiet tracks still span
  // the ramp.
  const energy = Array.isArray(peaks.rms) && peaks.rms.length === data.length ? peaks.rms : data;
  let max = 0;
  for (let i = 0; i < energy.length; i++) if (energy[i] > max) max = energy[i];
  const norm = max > 0 ? 1 / max : 0;

  const arr = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const amp = data[i];
    const e = Math.min(1, Math.max(0, energy[i] * norm));
    const [r, g, b] = RGB_SCALE(e).rgb(); // ints 0..255
    arr[i] = [amp, [r, g, b]];
  }

  const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(arr), 'utf8')).toString('base64');
  return { waveformRGBHDCompressed: compressed };
}

// Back-compat alias.
export const generatePeaks = generateDetailedPeaks;

export { detectTempo };

export default { probeDuration, generatePeaks, generateDetailedPeaks, detectTempo, buildWaveformRgb };
