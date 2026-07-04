import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, forbidden, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitCueCreated, emitCueUpdated, emitCueDeleted } from '../lib/realtime.js';
import { currentVersionBpm, reconcileBeatTime } from '../lib/beats.js';

export const cuesRouter = Router({ mergeParams: true });
cuesRouter.use(requireAuth, loadMembership);

async function trackInProject(trackId, projectId) {
  return knex('tracks').where({ id: trackId, project_id: projectId }).first();
}

/** A lane id, only if it belongs to this project (prevents cross-project assignment). */
async function laneInProject(laneId, projectId) {
  const row = await knex('cue_lanes as l')
    .join('departments as d', 'd.id', 'l.department_id')
    .where({ 'l.id': laneId, 'd.project_id': projectId })
    .first('l.id');
  return row?.id || null;
}

/** The project's default lane (first department, first lane) for un-laned new cues. */
async function defaultLaneForProject(projectId) {
  const row = await knex('cue_lanes as l')
    .join('departments as d', 'd.id', 'l.department_id')
    .where('d.project_id', projectId)
    .orderBy('d.sort_order')
    .orderBy('l.sort_order')
    .first('l.id');
  return row?.id || null;
}

/** The department a lane belongs to (Phase 5d dept-scoped permissions). */
async function deptOfLane(laneId) {
  if (!laneId) return null;
  const r = await knex('cue_lanes').where({ id: laneId }).first('department_id');
  return r?.department_id ?? null;
}
/** Dept-scoped edit gate: unrestricted (null) or the dept is in the editable set. */
const canEditDept = (req, deptId) => !req.deptEdit || (!!deptId && req.deptEdit.has(deptId));

export const VISIBILITIES = ['private', 'public_ro', 'public_edit'];
export const CUE_STATUSES = ['not_started', 'in_progress', 'done', 'blocked'];
export const OSC_VALUE_TYPES = ['int', 'float', 'string', 'bool'];
export const AUTOMATIONS = ['none', 'ramp_up', 'ramp_down', 'strobe', 'pulse'];
export const TRIGGER_ONS = ['none', 'enter', 'exit', 'both'];

const CUE_FIELDS = [
  'cue_number', 'name', 'time', 'end_time', 'start_beat', 'end_beat', 'lane_id',
  'status', 'color_inherited', 'description', 'fade', 'marker_color', 'sort_order',
  'osc_address', 'osc_value', 'osc_value_type', 'automation', 'advanced_payload',
  'midi_note', 'midi_channel', 'midi_velocity', 'trigger_on',
];

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v))));

function pickCueFields(body) {
  const out = {};
  for (const f of CUE_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (out.time !== undefined) out.time = Number(out.time) || 0;
  if (out.end_time !== undefined && out.end_time !== null) out.end_time = Number(out.end_time);
  // Beat coordinates (Phase 2a): nullable; null clears, numbers coerce.
  if (out.start_beat !== undefined && out.start_beat !== null) out.start_beat = Number(out.start_beat);
  if (out.end_beat !== undefined && out.end_beat !== null) out.end_beat = Number(out.end_beat);
  if (out.fade !== undefined) out.fade = Number(out.fade) || 0;
  if (out.name !== undefined) out.name = String(out.name).slice(0, 255);
  if (out.description !== undefined) out.description = String(out.description);
  if (out.marker_color !== undefined) out.marker_color = String(out.marker_color).slice(0, 9);
  // Phase 2c production fields.
  if (out.status !== undefined && !CUE_STATUSES.includes(out.status)) delete out.status;
  if (out.color_inherited !== undefined) out.color_inherited = !!out.color_inherited;
  // Phase 2d OSC / automation (store-only). Null clears; strings cap; enums gate.
  if (out.osc_address !== undefined && out.osc_address !== null) out.osc_address = String(out.osc_address).slice(0, 1000);
  if (out.osc_value !== undefined && out.osc_value !== null) out.osc_value = String(out.osc_value).slice(0, 1000);
  if (out.osc_value_type !== undefined && !OSC_VALUE_TYPES.includes(out.osc_value_type)) delete out.osc_value_type;
  if (out.automation !== undefined && !AUTOMATIONS.includes(out.automation)) delete out.automation;
  // advanced_payload: store as JSON string (jsonb column); null clears.
  if (out.advanced_payload !== undefined) {
    out.advanced_payload = out.advanced_payload === null ? null : JSON.stringify(out.advanced_payload);
  }
  // Phase 3a MIDI trigger config. Note nullable; channel/velocity clamped; enum gated.
  if (out.midi_note !== undefined) out.midi_note = out.midi_note === null || out.midi_note === '' ? null : clampInt(out.midi_note, 0, 127);
  if (out.midi_channel !== undefined) out.midi_channel = clampInt(out.midi_channel, 1, 16);
  if (out.midi_velocity !== undefined) out.midi_velocity = clampInt(out.midi_velocity, 0, 127);
  if (out.trigger_on !== undefined && !TRIGGER_ONS.includes(out.trigger_on)) delete out.trigger_on;
  return out;
}

/** Map template field names to cue table column names. */
const TEMPLATE_COL = { name: 'name', color: 'marker_color', fade: 'fade', note: 'description', end_time: 'end_time' };

/**
 * Soft-apply template defaults: for each field in the lane template that is
 * declared `required` and has a `default`, fill the cue column if it's absent.
 * Unknown-to-template cue fields are left untouched (never hard-rejected).
 */
function applyTemplateDefaults(fields, templateFields) {
  if (!Array.isArray(templateFields)) return;
  for (const tf of templateFields) {
    if (!tf.required || tf.default === undefined || tf.default === null) continue;
    const col = TEMPLATE_COL[tf.name];
    if (!col) continue;
    if (fields[col] === undefined || fields[col] === null) {
      fields[col] = tf.default;
    }
  }
}

const isOwnerOf = (req, cue) => req.isOwnerOrAdmin || cue.owner_id === req.session.userId;

// Visibility is the primary gate: only the owner (or a privileged owner/admin)
// can touch private and public-read-only cues. Capabilities apply to shared
// (public_edit) cues only.

/** Can the caller edit this cue's content? */
function canEditCue(req, cue) {
  if (isOwnerOf(req, cue)) return true;
  if (cue.visibility === 'public_edit' && (req.capabilities.has('create_cues') || req.capabilities.has('edit_others_cues'))) return true;
  return false;
}

/** Can the caller delete this cue? */
function canDeleteCue(req, cue) {
  if (isOwnerOf(req, cue)) return true;
  if (cue.visibility === 'public_edit' && req.capabilities.has('delete_others_cues')) return true;
  return false;
}

/** GET /projects/:id/tracks/:trackId/cues — filtered to what the viewer may see. */
cuesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const canSeePrivate = req.isOwnerOrAdmin || req.capabilities.has('view_private_cues');
    const q = knex('cues').where({ track_id: track.id }).whereNull('deleted_at');
    if (!canSeePrivate) {
      // Others' private cues are hidden; the viewer always sees their own.
      q.andWhere((b) => b.whereNot('visibility', 'private').orWhere('owner_id', req.session.userId));
    }
    // Department-scoped view (Phase 5d): restrict to lanes in viewable departments.
    if (req.deptView) {
      const laneIds = req.deptView.size
        ? await knex('cue_lanes as l').join('departments as d', 'd.id', 'l.department_id')
            .where('d.project_id', req.project.id).whereIn('d.id', [...req.deptView]).pluck('l.id')
        : [];
      q.whereIn('lane_id', laneIds.length ? laneIds : ['00000000-0000-0000-0000-000000000000']);
    }
    const cues = await q.orderBy('time');
    res.json({ cues });
  })
);

/** POST /projects/:id/tracks/:trackId/cues (create_cues) */
cuesRouter.post(
  '/',
  requireCapability('create_cues'),
  asyncHandler(async (req, res) => {
    const track = await trackInProject(req.params.trackId, req.project.id);
    if (!track) throw notFound('Track not found');

    const fields = pickCueFields(req.body);
    // A cue may be created beat-first (start_beat) or time-first (time); require
    // at least one, then derive the counterpart from the track's BPM.
    if (fields.time === undefined && fields.start_beat == null) throw badRequest('time or start_beat is required');
    const bpm = await currentVersionBpm(track);
    reconcileBeatTime(fields, bpm);
    if (fields.time === undefined) fields.time = 0; // beat-first with no BPM: shouldn't happen, but stay safe

    // Lane assignment (Phase 2b): validate a supplied lane belongs to this
    // project, else fall back to the project's default lane.
    if (fields.lane_id != null) {
      const ok = await laneInProject(fields.lane_id, req.project.id);
      if (!ok) throw badRequest('Invalid lane');
    } else {
      fields.lane_id = await defaultLaneForProject(req.project.id);
    }
    // Dept-scoped edit gate (Phase 5d): can't create a cue in a department you can't edit.
    if (!canEditDept(req, await deptOfLane(fields.lane_id))) throw forbidden('You cannot add cues to that department');

    // Phase 11b: soft-apply lane template defaults for required fields.
    const laneTemplate = await knex('cue_templates').where({ lane_id: fields.lane_id }).first('fields');
    if (laneTemplate) applyTemplateDefaults(fields, laneTemplate.fields);

    const visibility = VISIBILITIES.includes(req.body.visibility) ? req.body.visibility : 'public_edit';
    const anon_visible = visibility !== 'private' && req.body.anon_visible === true;
    // New cues inherit their department colour by default (EdiTour pattern),
    // unless the caller explicitly opts out or sets their own colour.
    if (fields.color_inherited === undefined) fields.color_inherited = fields.marker_color === undefined;

    const [cue] = await knex('cues')
      .insert({
        track_id: track.id,
        origin_version_id: track.current_version_id,
        name: fields.name ?? 'Cue',
        ...fields,
        owner_id: req.session.userId,
        visibility,
        anon_visible,
        created_by: req.session.userId,
        updated_by: req.session.userId,
      })
      .returning('*');
    emitCueCreated(req, req.project.id, cue, req.session.userId);
    res.status(201).json({ cue });
  })
);

/** PATCH /projects/:id/tracks/:trackId/cues/:cueId — optimistic concurrency + per-cue gating. */
cuesRouter.patch(
  '/:cueId',
  asyncHandler(async (req, res) => {
    const cue = await knex('cues').where({ id: req.params.cueId, track_id: req.params.trackId }).whereNull('deleted_at').first();
    if (!cue) throw notFound('Cue not found');
    if (!canEditCue(req, cue)) throw forbidden('You cannot edit this cue');
    if (!canEditDept(req, await deptOfLane(cue.lane_id))) throw forbidden('You cannot edit cues in that department');

    const fields = pickCueFields(req.body);

    // Keep beat/time coordinates in sync (Phase 2a): whichever the client sent is
    // authoritative for this edit; derive the counterpart from the current BPM.
    if (fields.time !== undefined || fields.start_beat !== undefined || fields.end_time !== undefined || fields.end_beat !== undefined) {
      const bpm = await currentVersionBpm(req.params.trackId);
      reconcileBeatTime(fields, bpm, cue);
    }

    // Lane reassignment (Phase 2b): a supplied lane must belong to this project.
    if (fields.lane_id !== undefined) {
      if (fields.lane_id == null) {
        delete fields.lane_id; // never null out a NOT NULL column
      } else if (!(await laneInProject(fields.lane_id, req.project.id))) {
        throw badRequest('Invalid lane');
      } else if (!canEditDept(req, await deptOfLane(fields.lane_id))) {
        throw forbidden('You cannot move cues to that department');
      }
    }

    // Visibility / anon_visible can only be changed by the cue owner (or admin).
    if (req.body.visibility !== undefined || req.body.anon_visible !== undefined) {
      if (!isOwnerOf(req, cue)) throw forbidden('Only the cue owner can change its visibility');
      if (req.body.visibility !== undefined) {
        if (!VISIBILITIES.includes(req.body.visibility)) throw badRequest('Invalid visibility');
        fields.visibility = req.body.visibility;
      }
      if (req.body.anon_visible !== undefined) fields.anon_visible = !!req.body.anon_visible;
      // Private cues can never be exposed anonymously.
      const nextVis = fields.visibility ?? cue.visibility;
      if (nextVis === 'private') fields.anon_visible = false;
    }

    if (!Object.keys(fields).length) throw badRequest('Nothing to update');

    const expected = req.body.lock_version;
    const q = knex('cues')
      .where({ id: req.params.cueId, track_id: req.params.trackId })
      .update({ ...fields, updated_by: req.session.userId, lock_version: knex.raw('lock_version + 1'), updated_at: knex.fn.now() })
      .returning('*');
    if (expected !== undefined) q.andWhere('lock_version', expected);

    const [updated] = await q;
    if (!updated) {
      const exists = await knex('cues').where({ id: req.params.cueId }).first();
      if (exists) throw conflict('Cue was modified by someone else');
      throw notFound('Cue not found');
    }
    emitCueUpdated(req, req.project.id, cue, updated, req.session.userId);
    res.json({ cue: updated });
  })
);

/** DELETE /projects/:id/tracks/:trackId/cues/:cueId — per-cue gating. */
cuesRouter.delete(
  '/:cueId',
  asyncHandler(async (req, res) => {
    const cue = await knex('cues').where({ id: req.params.cueId, track_id: req.params.trackId }).whereNull('deleted_at').first();
    if (!cue) throw notFound('Cue not found');
    if (!canDeleteCue(req, cue)) throw forbidden('You cannot delete this cue');
    if (!canEditDept(req, await deptOfLane(cue.lane_id))) throw forbidden('You cannot delete cues in that department');

    // Soft delete (Phase 2c) — recoverable; reads filter `deleted_at IS NULL`.
    await knex('cues').where({ id: req.params.cueId, track_id: req.params.trackId }).update({ deleted_at: knex.fn.now() });
    emitCueDeleted(req, req.project.id, cue, req.session.userId);
    res.json({ ok: true });
  })
);

export default cuesRouter;
