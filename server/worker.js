import { Worker } from 'bullmq';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeRedisConnection, MEDIA_QUEUE } from './redis.js';
import { knex } from './db/knex.js';
import { keys, safeExt } from './lib/keys.js';
import { downloadToFile, putObject } from './services/s3.js';
import { probeDuration, generateDetailedPeaks, buildWaveformRgb, transcodeToWav } from './services/waveform.js';
import { generateFilmstrip, generateSpectrogram } from './services/artifacts.js';
import { analyzeRhythm } from './services/rhythm.js';
import { presignGet } from './services/s3.js';

/**
 * process-media: download the uploaded media, probe duration, generate
 * waveform peaks, upload peaks JSON, and flip the version to `ready`.
 * Publishes a redis message so the web process can broadcast to sockets (M4).
 */
async function processMedia(job) {
  const { versionId, trackId, projectId, s3Key } = job.data;
  console.log(`[worker] processing version ${versionId}`);

  await knex('track_versions').where({ id: versionId }).update({ status: 'processing' });

  const tmpFile = path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}${safeExt(s3Key) || '.media'}`);
  const tmpSpectro = path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}.png`);
  const tmpWebWav = path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}.wav`);
  try {
    await downloadToFile(s3Key, tmpFile);

    const duration = await probeDuration(tmpFile);
    const peaks = await generateDetailedPeaks(tmpFile);

    // Browser-playable copy — see 20260710000015_version_web_media.js for why
    // this must be lossless WAV rather than mp3/aac. Best-effort: on failure the
    // client falls back to the original file (fine for already-web-safe formats,
    // silently broken for exotic ones — logged here for follow-up).
    let mediaWebKey = null;
    try {
      await transcodeToWav(tmpFile, tmpWebWav);
      mediaWebKey = keys.versionWebMedia(projectId, trackId, versionId);
      await putObject(mediaWebKey, await readFile(tmpWebWav), 'audio/wav');
    } catch (webErr) {
      mediaWebKey = null;
      console.warn(`[worker] web playback transcode for version ${versionId} failed:`, webErr.message);
    }

    // Phase 1B: upgrade beats via the Python analyzer (BeatNet) — accurate beats
    // + downbeats + meter. Best-effort: on any failure we keep the aubio-derived
    // tempo (or null) and the job still completes.
    // Phase 11a: analyzeRhythm now returns { rhythm, status } so we can record
    // analysis_status on the version and surface it in the UI.
    let rhythm = null;
    let analysisStatus = 'disabled';
    try {
      const audioUrl = await presignGet(s3Key, 3600);
      ({ rhythm, status: analysisStatus } = await analyzeRhythm(audioUrl));
    } catch (rErr) {
      analysisStatus = 'analyzer_unreachable';
      console.warn(`[worker] rhythm analysis for version ${versionId} failed:`, rErr.message);
    }
    if (rhythm && peaks) {
      const beats = Array.isArray(rhythm.beats) ? rhythm.beats : null;
      peaks.tempo = {
        ...(peaks.tempo || {}),
        bpm: rhythm.bpm ?? peaks.tempo?.bpm,
        confidence: rhythm.confidence ?? peaks.tempo?.confidence ?? 1,
        firstBeatSec: beats?.[0] ?? peaks.tempo?.firstBeatSec ?? 0,
        // Carry the full grid only for short tracks (mirrors aubio path); long
        // tracks rebuild client-side from bpm + firstBeatSec.
        beatGrid: beats && duration > 0 && duration <= 600 ? beats : peaks.tempo?.beatGrid ?? null,
        downbeats: Array.isArray(rhythm.downbeats) ? rhythm.downbeats : null,
        meter: rhythm.meter ?? null,
        firstDownbeatSec: rhythm.firstDownbeatSec ?? null,
      };
    }

    let waveformKey = null;
    if (peaks) {
      waveformKey = keys.versionPeaks(projectId, trackId, versionId);
      await putObject(waveformKey, JSON.stringify(peaks), 'application/json');
    }

    // Phase 1A: server-baked RGB waveform artifact. Best-effort/non-fatal — a
    // failure here leaves waveform_rgb_s3_key null and the client falls back to
    // the simple/cdj/spectrogram views.
    let waveformRgbKey = null;
    try {
      const rgb = peaks ? buildWaveformRgb(peaks) : null;
      if (rgb) {
        waveformRgbKey = keys.versionWaveformRgb(projectId, trackId, versionId);
        await putObject(waveformRgbKey, JSON.stringify(rgb), 'application/json');
      }
    } catch (rgbErr) {
      waveformRgbKey = null;
      console.warn(`[worker] rgb waveform for version ${versionId} failed:`, rgbErr.message);
    }

    // Tier 3 spectrogram: best-effort, non-fatal. A failure here must not block
    // peaks/ready — we log a warning and leave spectrogram_s3_key null.
    let spectrogramKey = null;
    try {
      await generateSpectrogram(tmpFile, tmpSpectro);
      spectrogramKey = keys.versionSpectrogram(projectId, trackId, versionId);
      await putObject(spectrogramKey, await readFile(tmpSpectro), 'image/png');
    } catch (specErr) {
      spectrogramKey = null;
      console.warn(`[worker] spectrogram for version ${versionId} failed:`, specErr.message);
    }

    await knex('track_versions').where({ id: versionId }).update({
      status: 'ready',
      analysis_status: analysisStatus,
      media_duration: duration,
      media_web_s3_key: mediaWebKey,
      waveform_s3_key: waveformKey,
      waveform_rgb_s3_key: waveformRgbKey,
      spectrogram_s3_key: spectrogramKey,
      bpm: rhythm?.bpm ?? null,
      meter: rhythm?.meter ?? null,
      first_downbeat_sec: rhythm?.firstDownbeatSec ?? null,
      error_message: null,
      updated_at: knex.fn.now(),
    });

    // Phase 2a: once a BPM is known, backfill beat positions for cues on a track
    // currently showing this version that don't have them yet. Non-destructive —
    // only fills NULLs, never moves cues already positioned by beat.
    if (rhythm?.bpm > 0) {
      await knex('cues')
        .whereIn('track_id', knex('tracks').where({ current_version_id: versionId }).select('id'))
        .whereNull('start_beat')
        .update({
          start_beat: knex.raw('time * (? / 60.0)', [rhythm.bpm]),
          end_beat: knex.raw('CASE WHEN end_time IS NOT NULL THEN end_time * (? / 60.0) ELSE NULL END', [rhythm.bpm]),
        });
    }

    await publishReady(projectId, { versionId, trackId, status: 'ready', duration });
    console.log(
      `[worker] version ${versionId} ready (${duration.toFixed(1)}s, peaks=${!!peaks}, rgb=${!!waveformRgbKey}, bpm=${rhythm?.bpm ?? 'n/a'})`
    );
    return { ok: true, duration };
  } catch (err) {
    console.error(`[worker] version ${versionId} failed:`, err.message);
    // Only mark failed on the final attempt.
    if (job.attemptsMade + 1 >= (job.opts.attempts || 1)) {
      await knex('track_versions')
        .where({ id: versionId })
        .update({ status: 'failed', error_message: err.message.slice(0, 500) });
      await publishReady(projectId, { versionId, trackId, status: 'failed' });
    }
    throw err;
  } finally {
    await unlink(tmpFile).catch(() => {});
    await unlink(tmpSpectro).catch(() => {});
    await unlink(tmpWebWav).catch(() => {});
  }
}

/**
 * process-filmstrip: best-effort (Tier 2) generation of a horizontal thumbnail
 * filmstrip for a ready video layer. Downloads the video, renders the strip via
 * ffmpeg, uploads the PNG, and records the artifact key + meta on the layer.
 *
 * This is non-fatal: any failure is logged and swallowed so a missing filmstrip
 * never blocks playback. The strip is recorded on the layer and surfaced to the
 * client via the video media route's `filmstripUrl` on its next refetch.
 */
async function processFilmstrip(job) {
  const { videoLayerId, projectId, trackId, videoS3Key } = job.data;
  console.log(`[worker] filmstrip for video layer ${videoLayerId}`);

  const tmpFile = path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}${safeExt(videoS3Key) || '.media'}`);
  const tmpPng = path.join(tmpdir(), `mk_${crypto.randomBytes(8).toString('hex')}.png`);
  try {
    // Prefer the duration already stored on the layer; fall back to ffprobe.
    const layer = await knex('video_layers').where({ id: videoLayerId }).first();
    if (!layer) {
      console.warn(`[worker] filmstrip skipped: video layer ${videoLayerId} not found`);
      return { ok: false };
    }

    await downloadToFile(videoS3Key, tmpFile);
    let duration = Number(layer.duration) || 0;
    if (!duration) duration = await probeDuration(tmpFile);
    if (!duration) {
      console.warn(`[worker] filmstrip skipped: no duration for layer ${videoLayerId}`);
      return { ok: false };
    }

    const meta = await generateFilmstrip(tmpFile, tmpPng, { duration });
    const filmstripKey = keys.videoFilmstrip(projectId, videoLayerId);
    await putObject(filmstripKey, await readFile(tmpPng), 'image/png');

    await knex('video_layers').where({ id: videoLayerId }).update({
      filmstrip_s3_key: filmstripKey,
      filmstrip_meta: JSON.stringify(meta),
      updated_at: knex.fn.now(),
    });

    // No worker→socket push for filmstrips: the only `version-events` relay
    // unconditionally re-emits `track:version:ready`, which isn't the video
    // event. The strip is best-effort, so we record it on the layer and let the
    // client pick it up via the next video media refetch (its `filmstripUrl`).
    console.log(`[worker] filmstrip ready for layer ${videoLayerId} (${meta.cols} cols @ ${meta.fps.toFixed(3)} fps)`);
    return { ok: true, ...meta };
  } catch (err) {
    // Filmstrips are best-effort — log and move on, never fail the layer.
    console.warn(`[worker] filmstrip for layer ${videoLayerId} failed:`, err.message);
    return { ok: false };
  } finally {
    await unlink(tmpFile).catch(() => {});
    await unlink(tmpPng).catch(() => {});
  }
}

// Notify the web process (which owns the sockets) via redis pub/sub.
let pub = null;
async function publishReady(projectId, payload) {
  try {
    pub ??= makeRedisConnection();
    await pub.publish('version-events', JSON.stringify({ projectId, ...payload }));
  } catch (err) {
    console.warn('[worker] publish failed:', err.message);
  }
}

// Single processor dispatches on job name so both job kinds share one Worker
// (and its concurrency budget) on the MEDIA_QUEUE.
function processJob(job) {
  switch (job.name) {
    case 'process-filmstrip':
      return processFilmstrip(job);
    case 'process-media':
    default:
      return processMedia(job);
  }
}

const worker = new Worker(MEDIA_QUEUE, processJob, {
  connection: makeRedisConnection(),
  concurrency: 2,
});

worker.on('ready', () => console.log(`[worker] listening on queue "${MEDIA_QUEUE}"`));
worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err.message));

async function shutdown(signal) {
  console.log(`[worker] ${signal} received, shutting down`);
  await worker.close();
  await knex.destroy().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
