import { Router } from 'express';
import express from 'express';
import { parseStringPromise } from 'xml2js';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { logActivity } from '../lib/activity.js';
import { emitToProject } from '../lib/realtime.js';

/**
 * Rekordbox XML import (Phase 2f, HANDOVER v2 §6.5). Accepts a rekordbox
 * "Export Collection in xml format" file. For each <TRACK> we create a track +
 * a metadata-only version (carrying BPM/key/beatgrid so beats resolve and the
 * Beat input works) + cues from its <POSITION_MARK>s, routed into a dedicated
 * "Rekordbox" department/lane. Audio is uploaded separately — this seeds
 * metadata + cues only.
 *
 * Beat positioning (Phase 2a) makes this clean: rekordbox stores cue positions in
 * seconds, and with the track's AverageBpm we compute `start_beat = sec × bpm/60`.
 *
 * Re-importing the same collection merges rather than duplicates: tracks are
 * matched by the XML's stable `TrackID` (`tracks.rekordbox_track_id`). A match
 * refreshes the rekordbox metadata version and replaces that track's
 * `source='rekordbox'` cues, leaving any manually-added cues and any uploaded
 * audio version untouched.
 */
export const importsRouter = Router({ mergeParams: true });
importsRouter.use(requireAuth, loadMembership);

const MAX_TRACKS = 200; // guard against importing an entire huge collection at once
const hex2 = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
const HOT_CUE_LETTER = (num) => String.fromCharCode(65 + num); // 0 -> A

/**
 * Walks a rekordbox <PLAYLISTS> <NODE> tree (folders are Type "0", playlists are
 * Type "1") and flattens it into a list of { path, trackIds }, where path is the
 * folder-joined playlist name (e.g. "Prep / Opening set") and trackIds are the
 * COLLECTION TrackID values (via each playlist TRACK's Key attribute).
 */
function collectPlaylists(node, prefix) {
  const a = node.$ || {};
  const name = String(a.Name || '').trim();
  const path = prefix ? `${prefix} / ${name}` : name;
  const type = String(a.Type ?? '0');
  if (type === '1') {
    const trackIds = (Array.isArray(node.TRACK) ? node.TRACK : []).map((t) => t.$?.Key).filter(Boolean);
    return [{ path, trackIds }];
  }
  if (Array.isArray(node.NODE)) return node.NODE.flatMap((child) => collectPlaylists(child, path));
  return [];
}

/** Flattened playlists defined in the XML's <PLAYLISTS> tree (top-level, skipping the root folder's own name). */
function playlistsFromXml(parsed) {
  const root = parsed?.DJ_PLAYLISTS?.PLAYLISTS?.[0]?.NODE?.[0];
  if (!Array.isArray(root?.NODE)) return [];
  return root.NODE.flatMap((child) => collectPlaylists(child, ''));
}

/**
 * Find-or-create a dedicated "Rekordbox" department + single "Rekordbox" lane
 * for imported cues, so they land somewhere distinct from hand-placed cues
 * instead of the project's first default lane.
 */
async function rekordboxLaneForProject(projectId, trx) {
  let dept = await trx('departments').where({ project_id: projectId, name: 'Rekordbox' }).first();
  if (!dept) {
    const maxSort = await trx('departments').where({ project_id: projectId }).max('sort_order as m').first();
    [dept] = await trx('departments')
      .insert({ project_id: projectId, name: 'Rekordbox', color: '#f43f5e', sort_order: (maxSort?.m ?? -1) + 1 })
      .returning('*');
  }
  let lane = await trx('cue_lanes').where({ department_id: dept.id, name: 'Rekordbox' }).first();
  if (!lane) {
    [lane] = await trx('cue_lanes').insert({ department_id: dept.id, name: 'Rekordbox', kind: 'cues', sort_order: 0 }).returning('*');
  }
  return lane.id;
}

/**
 * Beatgrid + tag metadata for `track_versions.analysis.rekordbox` / `musical_key`
 * / `first_downbeat_sec`. `<TEMPO>` elements (one per beatgrid segment) carry
 * `Inizio` (start sec), `Bpm`, `Metro`, `Battito` (beat-in-bar); rekordbox always
 * starts each segment on Battito 1, so the first segment's Inizio is the track's
 * first downbeat.
 */
function extractRekordboxMeta(t, a) {
  const tempos = (Array.isArray(t.TEMPO) ? t.TEMPO : [])
    .map((te) => te.$ || {})
    .map((ta) => ({
      inizio: Number.parseFloat(ta.Inizio),
      bpm: Number.parseFloat(ta.Bpm),
      metro: ta.Metro || null,
      battito: Number.parseInt(ta.Battito, 10) || null,
    }))
    .filter((seg) => Number.isFinite(seg.inizio) && Number.isFinite(seg.bpm));

  const firstDownbeatSec = tempos.length ? tempos[0].inizio : null;
  const musicalKey = a.Tonality ? String(a.Tonality).trim().slice(0, 16) || null : null;

  const tags = {};
  if (a.Colour) tags.colour = String(a.Colour);
  if (a.Comments) tags.comments = String(a.Comments);
  if (a.Genre) tags.genre = String(a.Genre);
  if (a.Rating) tags.rating = String(a.Rating);
  if (a.Label) tags.label = String(a.Label);
  if (a.Year) tags.year = String(a.Year);

  const rekordbox = { trackId: a.TrackID || null, ...tags };
  if (tempos.length > 1) rekordbox.beatgrid = tempos; // only worth storing for variable-BPM tracks

  return { firstDownbeatSec, musicalKey, analysis: { rekordbox } };
}

/**
 * Parses a rekordbox XML export and imports/merges it into a project. Pulled
 * out of the route handler so it can run without an Express req/res — used by
 * the route below and directly testable against the DB.
 *
 * `listPlaylists: true` returns `{ playlists, totalTracks }` (preview mode)
 * instead of importing. `playlist` scopes the import to one playlist path
 * from that preview. Throws `ApiError` (via `badRequest`) on bad input.
 */
export async function importRekordboxCollection({ projectId, userId, xml, listPlaylists, playlist }) {
  if (!xml || !xml.trim()) throw badRequest('Empty upload — expected a rekordbox XML export');

  let parsed;
  try {
    parsed = await parseStringPromise(xml, { explicitArray: true });
  } catch {
    throw badRequest('Could not parse the file as rekordbox XML');
  }

  const tracks = parsed?.DJ_PLAYLISTS?.COLLECTION?.[0]?.TRACK;
  if (!Array.isArray(tracks) || !tracks.length) throw badRequest('No tracks found in the collection');

  // Preview mode: report the playlists defined in this XML so the caller can
  // offer "import just this playlist" instead of the whole collection.
  if (listPlaylists) {
    const playlists = playlistsFromXml(parsed).map((p) => ({ path: p.path, trackCount: p.trackIds.length }));
    return { playlists, totalTracks: tracks.length };
  }

  let scoped = tracks;
  if (playlist) {
    const match = playlistsFromXml(parsed).find((p) => p.path === playlist);
    if (!match) throw badRequest('Playlist not found in this XML');
    const idSet = new Set(match.trackIds);
    scoped = tracks.filter((t) => idSet.has(t.$?.TrackID));
    if (!scoped.length) throw badRequest('No matching tracks found for that playlist');
  }

  const slice = scoped.slice(0, MAX_TRACKS);
  let tracksCreated = 0;
  let tracksUpdated = 0;
  let cuesCreated = 0;
  let cuesRemoved = 0;

  await knex.transaction(async (trx) => {
    const laneId = await rekordboxLaneForProject(projectId, trx);

    // Sort order for newly-created tracks continues after existing tracks.
    const maxSort = await trx('tracks').where({ project_id: projectId }).max('sort_order as m').first();
    let sortOrder = (maxSort?.m ?? -1) + 1;

    for (const t of slice) {
      const a = t.$ || {};
      const rekordboxTrackId = a.TrackID ? String(a.TrackID) : null;
      const title = String(a.Name || 'Untitled').trim();
      const artist = String(a.Artist || '').trim();
      const name = (artist ? `${artist} — ${title}` : title).slice(0, 255);
      const bpm = Number.parseFloat(a.AverageBpm) || null;
      const duration = Number.parseFloat(a.TotalTime) || 0;
      const meter = t.TEMPO?.[0]?.$?.Metro || (bpm ? '4/4' : null);
      const { firstDownbeatSec, musicalKey, analysis } = extractRekordboxMeta(t, a);

      // Merge target: a track this same collection previously created here.
      const existingTrack = rekordboxTrackId
        ? await trx('tracks').where({ project_id: projectId, rekordbox_track_id: rekordboxTrackId }).first()
        : null;

      const versionFields = {
        media_duration: duration,
        bpm,
        meter,
        musical_key: musicalKey,
        first_downbeat_sec: firstDownbeatSec,
        analysis,
      };

      let track;
      let version;
      if (existingTrack) {
        track = existingTrack;
        await trx('tracks').where({ id: track.id }).update({ name, updated_at: knex.fn.now() });

        // Refresh the standing rekordbox metadata version if one still exists;
        // recreate it as a new version if the track only has real uploads now
        // (e.g. its original placeholder was rolled back). Either way the
        // current uploaded audio version, if any, is left completely alone.
        const existingVersion = await trx('track_versions').where({ track_id: track.id, label: 'Rekordbox import' }).first();
        if (existingVersion) {
          [version] = await trx('track_versions')
            .where({ id: existingVersion.id })
            .update({ ...versionFields, updated_at: knex.fn.now() })
            .returning('*');
        } else {
          const maxVer = await trx('track_versions').where({ track_id: track.id }).max('version_number as m').first();
          [version] = await trx('track_versions')
            .insert({
              track_id: track.id,
              version_number: (maxVer?.m ?? 0) + 1,
              label: 'Rekordbox import',
              status: 'pending_upload',
              uploaded_by: userId,
              ...versionFields,
            })
            .returning('*');
        }
        tracksUpdated++;
      } else {
        [track] = await trx('tracks')
          .insert({
            project_id: projectId,
            name,
            kind: 'audio',
            sort_order: sortOrder++,
            created_by: userId,
            rekordbox_track_id: rekordboxTrackId,
          })
          .returning('*');

        // Metadata-only version (no media) so the BPM/key live somewhere and
        // beats resolve. The user uploads real audio as a later version.
        [version] = await trx('track_versions')
          .insert({
            track_id: track.id,
            version_number: 1,
            label: 'Rekordbox import',
            status: 'pending_upload',
            uploaded_by: userId,
            ...versionFields,
          })
          .returning('*');
        await trx('tracks').where({ id: track.id }).update({ current_version_id: version.id });
        tracksCreated++;
      }

      // Rekordbox cues are fully replaced on every import: drop this track's
      // previous source='rekordbox' cues, then insert fresh from the XML.
      // Manually-added cues (source='manual') are never touched.
      cuesRemoved += await trx('cues').where({ track_id: track.id, source: 'rekordbox' }).del();

      const marks = Array.isArray(t.POSITION_MARK) ? t.POSITION_MARK : [];
      const rows = [];
      for (const m of marks) {
        const ma = m.$ || {};
        const type = String(ma.Type ?? '0');
        if (type !== '0' && type !== '4') continue; // cues/memory (0) + loops (4); skip fades/load
        const start = Number.parseFloat(ma.Start);
        if (!Number.isFinite(start)) continue;
        const num = Number.parseInt(ma.Num, 10);
        const isLoop = type === '4';
        const isHot = !isLoop && Number.isFinite(num) && num >= 0;
        const hasRgb = ma.Red !== undefined && ma.Green !== undefined && ma.Blue !== undefined;
        const end = isLoop && ma.End !== undefined ? Number.parseFloat(ma.End) : null;

        const label =
          String(ma.Name || '').trim() || (isLoop ? 'Loop' : isHot ? `Hot Cue ${HOT_CUE_LETTER(num)}` : 'Memory cue');
        const sourceRef = isLoop ? `loop:${start}` : isHot ? `hot:${num}` : `mem:${start}`;
        rows.push({
          track_id: track.id,
          origin_version_id: version.id,
          lane_id: laneId,
          name: label.slice(0, 255),
          time: start,
          end_time: Number.isFinite(end) ? end : null,
          start_beat: bpm ? start * (bpm / 60) : null,
          end_beat: bpm && Number.isFinite(end) ? end * (bpm / 60) : null,
          marker_color: hasRgb ? `#${hex2(ma.Red)}${hex2(ma.Green)}${hex2(ma.Blue)}` : '#ff4444',
          color_inherited: !hasRgb, // no rekordbox colour → inherit the department's
          // Hot cues are shared/editable; memory cues are read-only by default.
          visibility: isHot ? 'public_edit' : 'public_ro',
          owner_id: userId,
          created_by: userId,
          updated_by: userId,
          source: 'rekordbox',
          source_ref: sourceRef,
        });
      }
      if (rows.length) {
        await trx('cues').insert(rows);
        cuesCreated += rows.length;
      }
    }
  });

  await logActivity({
    projectId,
    userId,
    entityType: 'track',
    entityId: null,
    action: 'create',
    next: { source: 'rekordbox', tracksCreated, tracksUpdated, cuesCreated, cuesRemoved },
  });

  return { tracksCreated, tracksUpdated, cuesCreated, cuesRemoved, totalInFile: scoped.length, imported: slice.length };
}

/**
 * POST /projects/:id/imports/rekordbox — body is the raw rekordbox XML
 * (Content-Type doesn't matter; we read it as text). Capability: manage_tracks.
 * Thin HTTP wrapper around `importRekordboxCollection` — everything but the
 * request-scoped auth/socket bits lives there so it's testable without Express.
 */
importsRouter.post(
  '/rekordbox',
  requireCapability('manage_tracks'),
  express.text({ type: '*/*', limit: '64mb' }),
  asyncHandler(async (req, res) => {
    const xml = typeof req.body === 'string' ? req.body : '';
    const result = await importRekordboxCollection({
      projectId: req.project.id,
      userId: req.session.userId,
      xml,
      listPlaylists: !!req.query.listPlaylists,
      playlist: req.query.playlist ? String(req.query.playlist) : null,
    });

    if (req.query.listPlaylists) return res.json(result);

    emitToProject(req, req.project.id, 'import:completed', {
      source: 'rekordbox',
      tracksCreated: result.tracksCreated,
      tracksUpdated: result.tracksUpdated,
      byUserId: req.session.userId,
    });

    res.status(201).json(result);
  })
);

export default importsRouter;
