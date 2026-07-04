import { config } from '../config.js';

/**
 * Rhythm analysis client (Phase 1B). Calls the Python analyzer sidecar
 * (`markers-analyzer`, FastAPI + BeatNet) to get accurate beats + downbeats +
 * meter for a track, passing a presigned S3 GET URL so the container needs no
 * AWS credentials.
 *
 * Phase 11a: returns `{ rhythm, status }` where:
 *   status = 'full'                  — rhythm data usable (bpm / beats present)
 *   status = 'no_rhythm'             — analyzer responded but data wasn't usable
 *   status = 'analyzer_unreachable'  — fetch failed, timed out, or non-2xx
 *   status = 'disabled'              — ANALYZER_URL not configured
 *
 * Never throws — rhythm is a best-effort enrichment; on any failure the worker
 * keeps the aubio-derived tempo (or null) and the job still completes.
 *
 * @param {string} audioUrl presigned GET URL for the media file
 * @returns {{ rhythm: object|null, status: string }}
 */
export async function analyzeRhythm(audioUrl) {
  const base = config.analyzer.url;
  if (!base) return { rhythm: null, status: 'disabled' };
  if (!audioUrl) return { rhythm: null, status: 'disabled' };

  const endpoint = `${base.replace(/\/$/, '')}/analyze/rhythm`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.analyzer.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audioUrl }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[rhythm] analyzer responded ${res.status}`);
      return { rhythm: null, status: 'analyzer_unreachable' };
    }
    const body = await res.json();
    const rhythm = normalize(body);
    return { rhythm, status: rhythm ? 'full' : 'no_rhythm' };
  } catch (err) {
    const why = err.name === 'AbortError' ? 'timeout' : err.message;
    console.warn(`[rhythm] analyzer call failed (${why})`);
    return { rhythm: null, status: 'analyzer_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping the analyzer health endpoint. Returns 'up', 'down', or 'disabled'.
 * Used by the /api/health route. Never throws.
 */
export async function pingAnalyzer() {
  const base = config.analyzer.url;
  if (!base) return 'disabled';
  const endpoint = `${base.replace(/\/$/, '')}/healthz`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(endpoint, { signal: ctrl.signal });
    return res.ok ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Validate + coerce the analyzer payload into the tempo shape we store. */
function normalize(body) {
  if (!body || typeof body !== 'object') return null;
  const beats = toAscendingFloats(body.beats);
  const downbeats = toAscendingFloats(body.downbeats);
  const bpm = Number.isFinite(body.bpm) ? body.bpm : null;
  if (bpm == null && (!beats || beats.length < 2)) return null; // nothing usable

  return {
    bpm,
    confidence: Number.isFinite(body.confidence) ? clamp01(body.confidence) : null,
    meter: typeof body.meter === 'string' ? body.meter.slice(0, 16) : null,
    beats,
    downbeats,
    firstDownbeatSec: downbeats && downbeats.length ? downbeats[0] : null,
  };
}

function toAscendingFloats(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  let prev = -Infinity;
  for (const x of v) {
    const t = Number(x);
    if (Number.isFinite(t) && t >= prev) {
      out.push(t);
      prev = t;
    }
  }
  return out.length ? out : null;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

export default { analyzeRhythm, pingAnalyzer };
