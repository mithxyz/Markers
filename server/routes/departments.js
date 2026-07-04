import { Router } from 'express';
import { knex } from '../db/knex.js';
import { asyncHandler, badRequest, notFound, conflict } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loadMembership, requireCapability } from '../middleware/membership.js';
import { emitToProject } from '../lib/realtime.js';

/**
 * Departments → lanes (Phase 2b). Departments are project-scoped, colored
 * swim-lane groups; lanes live inside a department; cues reference a lane. CRUD
 * is gated by `manage_departments`; reads are open to any project member.
 *
 * Destructive guards: a lane/department that still holds cues can't be deleted
 * (the FK would cascade-delete the cues). Move the cues first.
 */
export const departmentsRouter = Router({ mergeParams: true });
departmentsRouter.use(requireAuth, loadMembership);

// Phase 5a: broadcast `department:changed` after any successful mutation (dept /
// lane / assignment) so collaborators reload the tree without a manual refresh.
departmentsRouter.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && req.project) {
      emitToProject(req, req.project.id, 'department:changed', { byUserId: req.session.userId });
    }
    return orig(body);
  };
  next();
});

const LANE_KINDS = ['cues', 'automation'];
const LANE_TYPES = ['point', 'region'];

const DEFAULT_TEMPLATE_FIELDS = JSON.stringify([
  { name: 'name',  type: 'string',  required: true,  default: 'Cue' },
  { name: 'color', type: 'color',   required: false, default: '#ff4444' },
  { name: 'fade',  type: 'number',  required: false, default: 0 },
  { name: 'note',  type: 'text',    required: false, default: '' },
]);

/** Load a department within the current project, or 404. */
async function deptInProject(deptId, projectId) {
  return knex('departments').where({ id: deptId, project_id: projectId }).first();
}

/** Serialize the project's departments with their lanes (+ templates) nested + ordered. */
async function listDepartments(projectId) {
  const departments = await knex('departments').where({ project_id: projectId }).orderBy('sort_order').orderBy('name');
  if (!departments.length) return [];
  const deptIds = departments.map((d) => d.id);
  const lanes = await knex('cue_lanes as l')
    .leftJoin('cue_templates as t', 't.lane_id', 'l.id')
    .whereIn('l.department_id', deptIds)
    .orderBy('l.sort_order')
    .orderBy('l.name')
    .select('l.*', 't.id as template_id', 't.fields as template_fields', 't.export_mapping as template_export_mapping');
  const byDept = new Map(departments.map((d) => [d.id, { ...d, lanes: [] }]));
  for (const l of lanes) {
    const { template_id, template_fields, template_export_mapping, ...lane } = l;
    lane.template = template_id ? { id: template_id, fields: template_fields, export_mapping: template_export_mapping } : null;
    byDept.get(l.department_id)?.lanes.push(lane);
  }
  return [...byDept.values()];
}

export { listDepartments };

/** GET /projects/:id/departments — departments + nested lanes. */
departmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ departments: await listDepartments(req.project.id) });
  })
);

/** POST /projects/:id/departments (manage_departments) — create a department + a default lane. */
departmentsRouter.post(
  '/',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 64);
    if (!name) throw badRequest('Department name required');
    const color = String(req.body.color || '#6366f1').slice(0, 9);
    const sort_order = Number.isFinite(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0;

    const dup = await knex('departments').where({ project_id: req.project.id, name }).first();
    if (dup) throw conflict('A department with that name already exists');

    const department = await knex.transaction(async (trx) => {
      const [d] = await trx('departments')
        .insert({ project_id: req.project.id, name, color, sort_order })
        .returning('*');
      // A department is useless without a lane — seed a default one + its template.
      const [l] = await trx('cue_lanes').insert({ department_id: d.id, name: 'Default', kind: 'cues', lane_type: 'point', sort_order: 0 }).returning('*');
      await trx('cue_templates').insert({ lane_id: l.id, fields: DEFAULT_TEMPLATE_FIELDS, export_mapping: '{}' });
      return d;
    });

    const [withLanes] = await listDepartmentsByIds([department.id]);
    res.status(201).json({ department: withLanes });
  })
);

/** PATCH /projects/:id/departments/:deptId (manage_departments). */
departmentsRouter.patch(
  '/:deptId',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const dept = await deptInProject(req.params.deptId, req.project.id);
    if (!dept) throw notFound('Department not found');

    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 64);
      if (!name) throw badRequest('Name cannot be empty');
      const dup = await knex('departments').where({ project_id: req.project.id, name }).whereNot({ id: dept.id }).first();
      if (dup) throw conflict('A department with that name already exists');
      patch.name = name;
    }
    if (req.body.color !== undefined) patch.color = String(req.body.color).slice(0, 9);
    if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    if (req.body.default_osc_address !== undefined) patch.default_osc_address = req.body.default_osc_address === null ? null : String(req.body.default_osc_address);
    if (req.body.default_osc_value !== undefined) patch.default_osc_value = req.body.default_osc_value === null ? null : String(req.body.default_osc_value);
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    await knex('departments').where({ id: dept.id }).update(patch);
    const [withLanes] = await listDepartmentsByIds([dept.id]);
    res.json({ department: withLanes });
  })
);

/** DELETE /projects/:id/departments/:deptId (manage_departments) — refused if it holds cues. */
departmentsRouter.delete(
  '/:deptId',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const dept = await deptInProject(req.params.deptId, req.project.id);
    if (!dept) throw notFound('Department not found');

    const cueCount = await cuesUnderDepartment(dept.id);
    if (cueCount > 0) throw conflict(`Move its ${cueCount} cue(s) to another lane before deleting this department`);

    await knex('departments').where({ id: dept.id }).del(); // cascades empty lanes
    res.json({ ok: true });
  })
);

/** POST /projects/:id/departments/:deptId/lanes (manage_departments). */
departmentsRouter.post(
  '/:deptId/lanes',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const dept = await deptInProject(req.params.deptId, req.project.id);
    if (!dept) throw notFound('Department not found');

    const name = String(req.body.name || '').trim().slice(0, 64);
    if (!name) throw badRequest('Lane name required');
    const kind = LANE_KINDS.includes(req.body.kind) ? req.body.kind : 'cues';
    const lane_type = LANE_TYPES.includes(req.body.lane_type) ? req.body.lane_type : 'point';
    const sort_order = Number.isFinite(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0;

    const dup = await knex('cue_lanes').where({ department_id: dept.id, name }).first();
    if (dup) throw conflict('A lane with that name already exists in this department');

    const lane = await knex.transaction(async (trx) => {
      const [l] = await trx('cue_lanes').insert({ department_id: dept.id, name, kind, lane_type, sort_order }).returning('*');
      await trx('cue_templates').insert({ lane_id: l.id, fields: DEFAULT_TEMPLATE_FIELDS, export_mapping: '{}' });
      return l;
    });
    res.status(201).json({ lane });
  })
);

/** PATCH .../lanes/:laneId (manage_departments). */
departmentsRouter.patch(
  '/:deptId/lanes/:laneId',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const lane = await laneInProject(req.params.laneId, req.params.deptId, req.project.id);
    if (!lane) throw notFound('Lane not found');

    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 64);
      if (!name) throw badRequest('Name cannot be empty');
      const dup = await knex('cue_lanes').where({ department_id: lane.department_id, name }).whereNot({ id: lane.id }).first();
      if (dup) throw conflict('A lane with that name already exists in this department');
      patch.name = name;
    }
    if (req.body.kind !== undefined && LANE_KINDS.includes(req.body.kind)) patch.kind = req.body.kind;
    if (req.body.lane_type !== undefined && LANE_TYPES.includes(req.body.lane_type)) patch.lane_type = req.body.lane_type;
    if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    const [updated] = await knex('cue_lanes').where({ id: lane.id }).update(patch).returning('*');
    res.json({ lane: updated });
  })
);

/** DELETE .../lanes/:laneId (manage_departments) — refused if it holds cues. */
departmentsRouter.delete(
  '/:deptId/lanes/:laneId',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const lane = await laneInProject(req.params.laneId, req.params.deptId, req.project.id);
    if (!lane) throw notFound('Lane not found');

    const used = await knex('cues').where({ lane_id: lane.id }).count('* as n').first();
    if (Number(used.n) > 0) throw conflict(`Move its ${used.n} cue(s) to another lane before deleting this lane`);

    await knex('cue_lanes').where({ id: lane.id }).del();
    res.json({ ok: true });
  })
);

/**
 * PATCH .../lanes/:laneId/template (manage_departments) — update a lane's cue template.
 * `fields` is an array of field descriptors [{name,type,required,default}].
 * `export_mapping` is a free-form object mapping lane fields to export formats.
 * Upserts so this route works even if the migration backfill hasn't run yet.
 */
departmentsRouter.patch(
  '/:deptId/lanes/:laneId/template',
  requireCapability('manage_departments'),
  asyncHandler(async (req, res) => {
    const lane = await laneInProject(req.params.laneId, req.params.deptId, req.project.id);
    if (!lane) throw notFound('Lane not found');

    const patch = {};
    if (req.body.fields !== undefined) {
      if (!Array.isArray(req.body.fields)) throw badRequest('fields must be an array');
      patch.fields = JSON.stringify(req.body.fields);
    }
    if (req.body.export_mapping !== undefined) {
      if (typeof req.body.export_mapping !== 'object' || Array.isArray(req.body.export_mapping))
        throw badRequest('export_mapping must be an object');
      patch.export_mapping = JSON.stringify(req.body.export_mapping);
    }
    if (!Object.keys(patch).length) throw badRequest('Nothing to update');
    patch.updated_at = knex.fn.now();

    // Upsert — the migration backfill seeds a template for every lane, but be
    // defensive in case a lane was created before this migration ran.
    const existing = await knex('cue_templates').where({ lane_id: lane.id }).first();
    let template;
    if (existing) {
      [template] = await knex('cue_templates').where({ id: existing.id }).update(patch).returning('*');
    } else {
      [template] = await knex('cue_templates')
        .insert({ lane_id: lane.id, fields: patch.fields ?? DEFAULT_TEMPLATE_FIELDS, export_mapping: patch.export_mapping ?? '{}', ...patch })
        .returning('*');
    }

    res.json({ template });
  })
);

/**
 * POST /projects/:id/departments/:deptId/assignments { user_id } (manage_members)
 * — assign a project member to a department (crew mapping, Phase 3b).
 */
departmentsRouter.post(
  '/:deptId/assignments',
  requireCapability('manage_members'),
  asyncHandler(async (req, res) => {
    const dept = await deptInProject(req.params.deptId, req.project.id);
    if (!dept) throw notFound('Department not found');
    const userId = String(req.body.user_id || '');
    const member = await knex('project_members').where({ project_id: req.project.id, user_id: userId }).first();
    if (!member) throw badRequest('User is not a member of this project');

    // Idempotent: ignore if already assigned (unique constraint).
    await knex('department_assignments')
      .insert({ project_id: req.project.id, user_id: userId, department_id: dept.id })
      .onConflict(['project_id', 'user_id', 'department_id'])
      .ignore();
    res.status(201).json({ ok: true });
  })
);

/** DELETE /projects/:id/departments/:deptId/assignments/:userId (manage_members). */
departmentsRouter.delete(
  '/:deptId/assignments/:userId',
  requireCapability('manage_members'),
  asyncHandler(async (req, res) => {
    const dept = await deptInProject(req.params.deptId, req.project.id);
    if (!dept) throw notFound('Department not found');
    await knex('department_assignments')
      .where({ project_id: req.project.id, department_id: dept.id, user_id: req.params.userId })
      .del();
    res.json({ ok: true });
  })
);

// --- helpers ---

/** Load a lane, verifying it belongs to the given department + project. */
async function laneInProject(laneId, deptId, projectId) {
  return knex('cue_lanes as l')
    .join('departments as d', 'd.id', 'l.department_id')
    .where({ 'l.id': laneId, 'l.department_id': deptId, 'd.project_id': projectId })
    .first('l.*');
}

/** Count cues sitting in any lane under a department. */
async function cuesUnderDepartment(deptId) {
  const row = await knex('cues as c')
    .join('cue_lanes as l', 'l.id', 'c.lane_id')
    .where('l.department_id', deptId)
    .count('* as n')
    .first();
  return Number(row.n);
}

/** Same shape as listDepartments() but for a specific id set (after create/update). */
async function listDepartmentsByIds(ids) {
  const departments = await knex('departments').whereIn('id', ids).orderBy('sort_order');
  const lanes = await knex('cue_lanes as l')
    .leftJoin('cue_templates as t', 't.lane_id', 'l.id')
    .whereIn('l.department_id', ids)
    .orderBy('l.sort_order')
    .orderBy('l.name')
    .select('l.*', 't.id as template_id', 't.fields as template_fields', 't.export_mapping as template_export_mapping');
  const byDept = new Map(departments.map((d) => [d.id, { ...d, lanes: [] }]));
  for (const l of lanes) {
    const { template_id, template_fields, template_export_mapping, ...lane } = l;
    lane.template = template_id ? { id: template_id, fields: template_fields, export_mapping: template_export_mapping } : null;
    byDept.get(l.department_id)?.lanes.push(lane);
  }
  return [...byDept.values()];
}

export default departmentsRouter;
