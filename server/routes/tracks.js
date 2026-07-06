import { Router } from 'express';
import { knex } from '../db/knex.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { keys, safeExt } from '../lib/keys.js';
import { presignPut, presignGet, headObject, deleteObject } from '../services/s3.js';
import { getMediaQueue } from '../redis.js';
import { logActivity } from '../lib/activity.js';
import { emitToProject } from '../lib/realtime.js';
import { activateVersion, rollbackVersion, needsRealign } from '../services/versions.js';
import { recomputeCueBeats } from '../lib/beats.js';

export const tracksRouter = Router({ mergeParams: true });
tracksRouter.use(requireAuth, loadMembership);

const isMedia = (mime) => /^(audio|video)\//.test(String(mime || ''));

/** GET /projects/:id/tracks — tracks with their versions. */
tracksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const tracks = await knex('tracks').where({ project_id: req.project.id }).orderBy('sort_order');
    const trackIds = tracks.map((t) => t.id);
    const versions = trackIds.length
      ? await knex('track_versions').whereIn('track_id', trackIds).orderBy(['track_id', 'version_number'])
      : [];
    const byTrack = {};
    for (const v of versions) (byTrack[v.track_id] ??= []).push(v);
    res.json({
      tracks: tracks.map((t) => ({ ...t, versions: byTrack[t.id] || [] })),
    });
  })
);

/** POST /projects/:id/tracks { name, kind } (editor+) */
tracksRouter.post(
  '/',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 255) || 'Untitled track';
    const kind = ['audio', 'video'].includes(req.body.kind) ? req.body.kind : 'audio';
    const maxOrder = await knex('tracks').where({ project_id: req.project.id }).max('sort_order as m').first();

    const [track] = await knex('tracks')
      .insert({
        project_id: req.project.id,
        name,
        kind,
        sort_order: (maxOrder?.m ?? -1) + 1,
        created_by: req.session.userId,
        owner_id: req.session.userId, // 11e: creator is the initial owner
      })
      .returning('*');

    await logActivity({
      projectId: req.project.id,
      userId: req.session.userId,
      entityType: 'track',
      entityId: track.id,
      action: 'create',
      next: { name, kind },
    });

    emitToProject(req, req.project.id, 'track:created', { track: { ...track, versions: [] }, byUserId: req.session.userId });
    res.status(201).json({ track: { ...track, versions: [] } });
  })
);

/** PATCH /projects/:id/tracks/:trackId (editor+) */
tracksRouter.patch(
  '/:trackId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).trim().slice(0, 255) || 'Untitled track';
    if (req.body.sort_order !== undefined) patch.sort_order = parseInt(req.body.sort_order, 10) || 0;
    // 10-meta: free-text ID number and notes
    if (req.body.id_number !== undefined) patch.id_number = req.body.id_number === null ? null : (String(req.body.id_number).trim().slice(0, 64) || null);
    if (req.body.notes !== undefined) patch.notes = req.body.notes === null ? null : (String(req.body.notes).slice(0, 10000) || null);
    // 11e: owner reassign (manage_tracks required, which is already checked above)
    if (req.body.owner_id !== undefined) {
      if (req.body.owner_id === null) {
        patch.owner_id = null;
      } else {
        const isMember = await knex('project_members')
          .where({ project_id: req.project.id, user_id: req.body.owner_id })
          .first();
        if (!isMember) throw badRequest('owner_id must be a member of this project');
        patch.owner_id = req.body.owner_id;
      }
    }
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    const [track] = await knex('tracks')
      .where({ id: req.params.trackId, project_id: req.project.id })
      .update(patch)
      .returning('*');
    if (!track) throw notFound('Track not found');
    // Emit so other browsers see name/id/notes/sort_order changes live (10-meta/10-views)
    emitToProject(req, req.project.id, 'track:updated', { track, byUserId: req.session?.userId });
    res.json({ track });
  })
);

/** POST /projects/:id/tracks/reorder — bulk reorder (10-views) */
tracksRouter.post(
  '/reorder',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) throw badRequest('order must be a non-empty array of track ids');

    // Validate all ids belong to this project
    const existing = await knex('tracks')
      .where({ project_id: req.project.id })
      .whereIn('id', order)
      .select('id');
    if (existing.length !== order.length) throw badRequest('One or more track ids not found in this project');

    await knex.transaction(async (trx) => {
      for (let i = 0; i < order.length; i++) {
        await trx('tracks').where({ id: order[i], project_id: req.project.id }).update({ sort_order: i, updated_at: knex.fn.now() });
      }
    });

    emitToProject(req, req.project.id, 'tracks:reordered', { order, byUserId: req.session?.userId });
    res.json({ ok: true });
  })
);

const SNAP_TARGETS = ['off', 'transient', 'beat', 'grid', 'frame', 'existing'];
const FPS_VALUES = [23.976, 24, 25, 29.97, 30, 50, 60];
const DEFAULT_VIEWS = ['simple', 'cdj', 'spectrogram'];
const OVERLAY_KEYS = ['beatGrid', 'transients', 'rms', 'silence'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Build a validated/clamped partial settings object from raw req.body. */
function validateSettingsPatch(body) {
  const out = {};
  if (body && typeof body.snap === 'object' && body.snap !== null) {
    const snap = {};
    if (SNAP_TARGETS.includes(body.snap.target)) snap.target = body.snap.target;
    if (Number.isFinite(Number(body.snap.tolerance))) snap.tolerance = clamp(Number(body.snap.tolerance), 0, 1);
    if (Number.isFinite(Number(body.snap.gridSec)) && Number(body.snap.gridSec) > 0) snap.gridSec = Number(body.snap.gridSec);
    if (body.snap.zeroCross !== undefined) snap.zeroCross = !!body.snap.zeroCross;
    if (Object.keys(snap).length) out.snap = snap;
  }
  if (FPS_VALUES.includes(Number(body?.fps))) out.fps = Number(body.fps);
  if (DEFAULT_VIEWS.includes(body?.defaultView)) out.defaultView = body.defaultView;
  if (body && typeof body.overlays === 'object' && body.overlays !== null) {
    const overlays = {};
    for (const k of OVERLAY_KEYS) if (body.overlays[k] !== undefined) overlays[k] = !!body.overlays[k];
    if (Object.keys(overlays).length) out.overlays = overlays;
  }
  if (body?.sectionsEnabled !== undefined) out.sectionsEnabled = !!body.sectionsEnabled;
  return out;
}

/** PATCH /projects/:id/tracks/:trackId/settings (editor+) — merge per-track settings. */
tracksRouter.patch(
  '/:trackId/settings',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');

    const partial = validateSettingsPatch(req.body);
    const current = track.settings || {};
    const next = {
      ...current,
      ...partial,
      snap: { ...(current.snap || {}), ...(partial.snap || {}) },
      overlays: { ...(current.overlays || {}), ...(partial.overlays || {}) },
    };
    // Drop empty merged sub-objects so we don't persist bare {} keys.
    if (!Object.keys(next.snap).length) delete next.snap;
    if (!Object.keys(next.overlays).length) delete next.overlays;

    await knex('tracks')
      .where({ id: req.params.trackId, project_id: req.project.id })
      .update({ settings: JSON.stringify(next), updated_at: knex.fn.now() });

    emitToProject(req, req.project.id, 'track:settings:updated', {
      trackId: req.params.trackId,
      settings: next,
      byUserId: req.session.userId,
    });
    res.json({ settings: next });
  })
);

/** DELETE /projects/:id/tracks/:trackId (editor+) */
tracksRouter.delete(
  '/:trackId',
  requireCapability('manage_tracks'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');

    // Gather all S3 keys before the cascade delete removes the DB rows.
    const versions = await knex('track_versions').where({ track_id: track.id });
    const videoLayers = await knex('video_layers').where({ track_id: track.id });

    await knex('tracks').where({ id: track.id }).del();
    emitToProject(req, req.project.id, 'track:deleted', { trackId: track.id, byUserId: req.session.userId });
    res.json({ ok: true });

    // Best-effort S3 cleanup after the response is sent — never fail the delete.
    const vKeys = versions.flatMap((v) => [
      v.media_s3_key, v.media_web_s3_key, v.waveform_s3_key,
      v.waveform_rgb_s3_key, v.spectrogram_s3_key,
    ]);
    const vidKeys = videoLayers.flatMap((vl) => [vl.video_s3_key, vl.filmstrip_s3_key]);
    for (const k of [...vKeys, ...vidKeys]) {
      if (k) deleteObject(k).catch((e) => console.warn('[s3] deleteObject failed', k, e.message));
    }
  })
);

/**
 * POST /projects/:id/tracks/:trackId/versions { filename, mime, size, label? }
 * Creates a pending version row and returns a presigned PUT for direct upload.
 */
tracksRouter.post(
  '/:trackId/versions',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');

    const { filename, mime } = req.body;
    const size = parseInt(req.body.size, 10) || 0;
    if (!isMedia(mime)) throw badRequest('File must be audio or video');
    if (size <= 0) throw badRequest('Invalid file size');
    if (size > config.upload.maxBytes) throw badRequest('File exceeds maximum size');

    const ext = safeExt(filename);
    const last = await knex('track_versions')
      .where({ track_id: track.id })
      .max('version_number as m')
      .first();
    const versionNumber = (last?.m ?? 0) + 1;

    const [version] = await knex('track_versions')
      .insert({
        track_id: track.id,
        version_number: versionNumber,
        label: String(req.body.label || '').slice(0, 255),
        media_filename: String(filename || '').slice(0, 500),
        media_mime: mime,
        media_size: size,
        status: 'pending_upload',
        uploaded_by: req.session.userId,
      })
      .returning('*');

    const s3Key = keys.versionMedia(req.project.id, track.id, version.id, ext);
    await knex('track_versions').where({ id: version.id }).update({ media_s3_key: s3Key });

    const uploadUrl = await presignPut(s3Key, mime, 3600);
    res.status(201).json({
      version: { ...version, media_s3_key: s3Key },
      uploadUrl,
      multipartThreshold: config.upload.multipartThreshold,
    });
  })
);

/**
 * POST /projects/:id/tracks/:trackId/versions/:versionId/complete
 * Verifies the S3 object, marks it uploaded, enqueues processing, and (if the
 * track has no current version) activates it.
 */
tracksRouter.post(
  '/:trackId/versions/:versionId/complete',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions')
      .where({ id: req.params.versionId, track_id: track.id })
      .first();
    if (!version) throw notFound('Version not found');

    // Confirm the object really landed in S3 and capture its real size.
    let head;
    try {
      head = await headObject(version.media_s3_key);
    } catch {
      throw badRequest('Upload not found in storage');
    }

    await knex('track_versions')
      .where({ id: version.id })
      .update({ status: 'uploaded', media_size: head.size, updated_at: knex.fn.now() });

    // First real upload becomes the track's current version immediately — this also
    // covers a track whose "current" version is still a never-uploaded metadata
    // placeholder (e.g. a Rekordbox import), which otherwise has no real audio to
    // preserve and would just leave real uploads stranded behind it.
    // Re-read to pick up updated fields (e.g. current_version_id set by concurrent uploads).
    const trackRefetched = await knex('tracks').where({ id: track.id }).first();
    const currentVersion = trackRefetched.current_version_id
      ? await knex('track_versions').where({ id: trackRefetched.current_version_id }).first()
      : null;
    const currentIsPlaceholder = currentVersion && currentVersion.status === 'pending_upload' && !currentVersion.media_s3_key;
    if (!trackRefetched.current_version_id || currentIsPlaceholder) {
      await knex('tracks').where({ id: track.id }).update({ current_version_id: version.id });
    }

    await getMediaQueue().add(
      'process-media',
      {
        versionId: version.id,
        trackId: version.track_id,
        projectId: req.project.id,
        s3Key: version.media_s3_key,
        mime: version.media_mime,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 100 }
    );

    await logActivity({
      projectId: req.project.id,
      userId: req.session.userId,
      entityType: 'track_version',
      entityId: version.id,
      action: 'version_upload',
      next: { version_number: version.version_number },
    });

    emitToProject(req, req.project.id, 'track:version:uploaded', {
      trackId: version.track_id,
      versionId: version.id,
      byUserId: req.session.userId,
    });
    res.status(202).json({ ok: true, status: 'processing' });
  })
);

/**
 * POST .../versions/:versionId/activate { strategy, offset? } (editor+)
 * Make a ready version current, carrying cues forward and realigning per strategy.
 */
tracksRouter.post(
  '/:trackId/versions/:versionId/activate',
  requireCapability('manage_versions'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions').where({ id: req.params.versionId, track_id: track.id }).first();
    if (!version) throw notFound('Version not found');
    if (version.status !== 'ready') throw badRequest('Version is not ready yet');
    if (track.current_version_id === version.id) throw badRequest('Version is already active');

    const strategy = ['keep', 'scale', 'offset'].includes(req.body.strategy) ? req.body.strategy : 'keep';
    const offset = Number(req.body.offset) || 0;

    const { cues, oldDuration, newDuration } = await activateVersion({
      track,
      version,
      strategy,
      offset,
      userId: req.session.userId,
    });

    await logActivity({
      projectId: req.project.id,
      userId: req.session.userId,
      entityType: 'track_version',
      entityId: version.id,
      action: strategy === 'keep' ? 'rollback' : 'realign',
      previous: { current_version_id: track.current_version_id, oldDuration },
      next: { current_version_id: version.id, newDuration, strategy },
    });

    emitToProject(req, req.project.id, 'track:version:activated', {
      trackId: track.id,
      versionId: version.id,
      cues,
      byUserId: req.session.userId,
    });
    res.json({ versionId: version.id, cues });
  })
);

/** POST .../versions/:versionId/rollback { restoreCues? } (editor+) */
tracksRouter.post(
  '/:trackId/versions/:versionId/rollback',
  requireCapability('manage_versions'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions').where({ id: req.params.versionId, track_id: track.id }).first();
    if (!version) throw notFound('Version not found');
    if (version.status !== 'ready') throw badRequest('Version is not ready');

    const { cues } = await rollbackVersion({
      track,
      version,
      restoreCues: !!req.body.restoreCues,
      userId: req.session.userId,
    });

    await logActivity({
      projectId: req.project.id,
      userId: req.session.userId,
      entityType: 'track_version',
      entityId: version.id,
      action: 'rollback',
      next: { current_version_id: version.id, restoreCues: !!req.body.restoreCues },
    });

    emitToProject(req, req.project.id, 'track:version:activated', {
      trackId: track.id,
      versionId: version.id,
      cues,
      byUserId: req.session.userId,
    });
    res.json({ versionId: version.id, cues });
  })
);

/** POST .../versions/:versionId/reprocess (editor+) — re-run waveform analysis
 *  (e.g. to regenerate detailed/3-band peaks for an older upload). */
tracksRouter.post(
  '/:trackId/versions/:versionId/reprocess',
  requireCapability('manage_versions'),
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions')
      .where({ id: req.params.versionId, track_id: track.id })
      .first();
    if (!version || !version.media_s3_key) throw notFound('Version not found');

    await knex('track_versions').where({ id: version.id }).update({ status: 'processing' });
    await getMediaQueue().add(
      'process-media',
      {
        versionId: version.id,
        trackId: version.track_id,
        projectId: req.project.id,
        s3Key: version.media_s3_key,
        mime: version.media_mime,
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 50, removeOnFail: 100 }
    );
    emitToProject(req, req.project.id, 'track:version:uploaded', { trackId: version.track_id, versionId: version.id, byUserId: req.session.userId });
    res.status(202).json({ ok: true, status: 'processing' });
  })
);

/** GET .../versions/:versionId/meta — duration + realign hint vs current. */
tracksRouter.get(
  '/:trackId/versions/:versionId/meta',
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions').where({ id: req.params.versionId, track_id: track.id }).first();
    if (!version) throw notFound('Version not found');
    const current = track.current_version_id
      ? await knex('track_versions').where({ id: track.current_version_id }).first()
      : null;
    res.json({
      duration: version.media_duration,
      currentDuration: current?.media_duration || 0,
      needsRealign: current ? needsRealign(current.media_duration, version.media_duration) : false,
    });
  })
);

/** GET /projects/:id/tracks/:trackId/versions/:versionId/media — presigned GET. */
tracksRouter.get(
  '/:trackId/versions/:versionId/media',
  asyncHandler(async (req, res) => {
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions')
      .where({ id: req.params.versionId, track_id: track.id })
      .first();
    if (!version || !version.media_s3_key) throw notFound('Media not found');

    // Prefer the browser-playable WAV transcode when available; older/not-yet-
    // reprocessed versions fall back to the original file.
    const mediaUrl = await presignGet(version.media_web_s3_key || version.media_s3_key, 3600);
    const waveformUrl = version.waveform_s3_key ? await presignGet(version.waveform_s3_key, 3600) : null;
    const waveformRgbUrl = version.waveform_rgb_s3_key ? await presignGet(version.waveform_rgb_s3_key, 3600) : null;
    const spectrogramUrl = version.spectrogram_s3_key ? await presignGet(version.spectrogram_s3_key, 3600) : null;
    res.json({ mediaUrl, waveformUrl, waveformRgbUrl, spectrogramUrl, duration: version.media_duration, status: version.status });
  })
);

/**
 * PATCH .../versions/:versionId/bpm — seed a PROVISIONAL bpm (Phase 5e, from the
 * client instant estimator) so the track header shows a BPM immediately. Only
 * fills a null bpm, so the authoritative BeatNet result is never overwritten.
 */
tracksRouter.patch(
  '/:trackId/versions/:versionId/bpm',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const bpm = Number(req.body.bpm);
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 400) throw badRequest('Invalid bpm');
    const track = await knex('tracks').where({ id: req.params.trackId, project_id: req.project.id }).first();
    if (!track) throw notFound('Track not found');
    const version = await knex('track_versions').where({ id: req.params.versionId, track_id: track.id }).first();
    if (!version) throw notFound('Version not found');
    if (version.bpm == null) {
      await knex('track_versions').where({ id: version.id }).update({ bpm });
      // H1-B: seed beat positions now that we have a first BPM estimate.
      await recomputeCueBeats(knex, version.id, bpm);
    }
    res.json({ ok: true, bpm: version.bpm ?? bpm });
  })
);

export default tracksRouter;
