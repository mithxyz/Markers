import { Router } from 'express';
import { knex } from '../db/knex.js';
import { config } from '../config.js';
import { asyncHandler, badRequest, notFound } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { keys, safeExt } from '../lib/keys.js';
import { presignPut, presignGet, headObject } from '../services/s3.js';
import { emitToProject } from '../lib/realtime.js';
import { getMediaQueue } from '../redis.js';

export const videoRouter = Router({ mergeParams: true });
videoRouter.use(requireAuth, loadMembership);

const isVideo = (mime) => /^video\//.test(String(mime || ''));

async function trackInProject(trackId, projectId) {
  return knex('tracks').where({ id: trackId, project_id: projectId }).first();
}

/** GET /projects/:id/tracks/:trackId/video — list synced video layers. */
videoRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');
    const videos = await knex('video_layers').where({ track_id: track.id }).orderBy('created_at');
    res.json({ videos });
  })
);

/** POST /projects/:id/tracks/:trackId/video { filename, mime, size } → presigned PUT. */
videoRouter.post(
  '/',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const { filename, mime } = req.body;
    const size = parseInt(req.body.size, 10) || 0;
    if (!isVideo(mime)) throw badRequest('File must be a video');
    if (size <= 0 || size > config.upload.maxBytes) throw badRequest('Invalid file size');

    // 7c: enforce a maximum of 3 synced video layers per track.
    const [{ count: videoCount }] = await knex('video_layers')
      .where({ track_id: track.id })
      .count('id as count');
    if (parseInt(videoCount, 10) >= 3) throw badRequest('A track can have at most 3 synced videos');

    const [video] = await knex('video_layers')
      .insert({
        project_id: req.project.id,
        track_id: track.id,
        label: String(req.body.label || '').slice(0, 255),
        video_filename: String(filename || '').slice(0, 500),
        media_mime: mime,
        media_size: size,
        status: 'pending_upload',
        uploaded_by: req.session.userId,
      })
      .returning('*');

    const s3Key = keys.videoMedia(req.project.id, video.id, safeExt(filename));
    await knex('video_layers').where({ id: video.id }).update({ video_s3_key: s3Key });
    const uploadUrl = await presignPut(s3Key, mime, 3600);
    res.status(201).json({ video: { ...video, video_s3_key: s3Key }, uploadUrl });
  })
);

/** POST .../video/:videoId/complete — verify in S3, mark ready (no peaks needed). */
videoRouter.post(
  '/:videoId/complete',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const video = await knex('video_layers')
      .where({ id: req.params.videoId, track_id: req.params.trackId })
      .first();
    if (!video) throw notFound('Video not found');
    try {
      await headObject(video.video_s3_key);
    } catch {
      throw badRequest('Upload not found in storage');
    }
    const duration = Number(req.body.duration) || 0;
    await knex('video_layers')
      .where({ id: video.id })
      .update({ status: 'ready', duration, updated_at: knex.fn.now() });

    // Tier 2 (best-effort): enqueue filmstrip generation for the ready layer.
    try {
      await getMediaQueue().add(
        'process-filmstrip',
        { videoLayerId: video.id, projectId: req.project.id, trackId: req.params.trackId, videoS3Key: video.video_s3_key },
        { attempts: 2, removeOnComplete: 20 }
      );
    } catch (err) {
      console.warn('[video] failed to enqueue filmstrip job:', err.message);
    }

    emitToProject(req, req.project.id, 'video:layer:updated', { trackId: req.params.trackId, byUserId: req.session.userId });
    res.json({ ok: true });
  })
);

/** PATCH .../video/:videoId { offset_seconds, label } (editor+) — broadcast offset. */
videoRouter.patch(
  '/:videoId',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.offset_seconds !== undefined) patch.offset_seconds = Number(req.body.offset_seconds) || 0;
    if (req.body.label !== undefined) patch.label = String(req.body.label).slice(0, 255);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    const [video] = await knex('video_layers')
      .where({ id: req.params.videoId, track_id: req.params.trackId })
      .update(patch)
      .returning('*');
    if (!video) throw notFound('Video not found');

    emitToProject(req, req.project.id, 'video:layer:updated', {
      trackId: req.params.trackId,
      videoId: video.id,
      offset_seconds: video.offset_seconds,
      byUserId: req.session.userId,
    });
    res.json({ video });
  })
);

/** DELETE .../video/:videoId (editor+) */
videoRouter.delete(
  '/:videoId',
  requireCapability('upload_media'),
  asyncHandler(async (req, res) => {
    const deleted = await knex('video_layers').where({ id: req.params.videoId, track_id: req.params.trackId }).del();
    if (!deleted) throw notFound('Video not found');
    emitToProject(req, req.project.id, 'video:layer:updated', { trackId: req.params.trackId, byUserId: req.session.userId });
    res.json({ ok: true });
  })
);

/** GET .../video/:videoId/media — presigned GET. */
videoRouter.get(
  '/:videoId/media',
  asyncHandler(async (req, res) => {
    const video = await knex('video_layers')
      .where({ id: req.params.videoId, track_id: req.params.trackId })
      .first();
    if (!video || !video.video_s3_key) throw notFound('Video not found');
    const mediaUrl = await presignGet(video.video_s3_key, 3600);
    // Tier 2 filmstrip artifact (if generated yet) — presigned alongside media.
    const filmstripUrl = video.filmstrip_s3_key ? await presignGet(video.filmstrip_s3_key, 3600) : null;
    res.json({
      mediaUrl,
      offset_seconds: video.offset_seconds,
      duration: video.duration,
      filmstripUrl,
      filmstripMeta: video.filmstrip_meta || null,
    });
  })
);

export default videoRouter;
