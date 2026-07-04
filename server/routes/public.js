import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, notFound } from '../lib/http.js';
import { publicReadLimiter } from '../middleware/rateLimit.js';

// Mounted at /api/v1/public — NO auth. Read-only, anon-visible cues only.
export const publicRouter = Router();
publicRouter.use(publicReadLimiter);

/** GET /api/v1/public/:shareToken — read-only project view for anonymous visitors. */
publicRouter.get(
  '/:shareToken',
  asyncHandler(async (req, res) => {
    const share = await knex('project_share_tokens')
      .where({ token: req.params.shareToken, enabled: true })
      .whereNull('revoked_at')
      .first();
    if (!share) throw notFound('Share link not found');

    const project = await knex('projects').where({ id: share.project_id }).first();
    if (!project) throw notFound('Project not found');

    const tracks = await knex('tracks')
      .where({ project_id: project.id })
      .orderBy('sort_order')
      .select('id', 'name', 'kind', 'current_version_id');

    const trackIds = tracks.map((t) => t.id);
    const currentVersionIds = tracks.map((t) => t.current_version_id).filter(Boolean);
    const versions = currentVersionIds.length
      ? await knex('track_versions').whereIn('id', currentVersionIds).select('id', 'media_duration')
      : [];
    const durById = Object.fromEntries(versions.map((v) => [v.id, v.media_duration]));

    // Only non-private, anon-visible cues. Strip owner/audit/internal fields.
    const cues = trackIds.length
      ? await knex('cues')
          .whereIn('track_id', trackIds)
          .whereNull('deleted_at')
          .whereNot('visibility', 'private')
          .where('anon_visible', true)
          .orderBy('time')
          .select('id', 'track_id', 'cue_number', 'name', 'time', 'end_time', 'fade', 'marker_color', 'description')
      : [];
    const byTrack = {};
    for (const c of cues) (byTrack[c.track_id] ??= []).push(c);

    res.json({
      project: { name: project.name, description: project.description },
      tracks: tracks.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        duration: durById[t.current_version_id] || 0,
        cues: byTrack[t.id] || [],
      })),
    });
  })
);

export default publicRouter;
