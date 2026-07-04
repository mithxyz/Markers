import { knex } from '../db/knex.js';

/**
 * Export engine (Phase 2g, HANDOVER v2 §6.6). Builds one normalized model from a
 * project's tracks/cues/markers/departments, then renders it through a registry of
 * adapters (generic CSV, Reaper .RPP, video-editor markers CSV + FCPXML, lighting/
 * laser console cue-list CSV). Adapters are pure: model -> { filename, contentType, body }.
 */

// --- model ----------------------------------------------------------------

/**
 * Gather the export model. Respects cue visibility (others' private cues are
 * excluded unless the caller may see them) and soft-delete.
 * @param {object} opts { projectId, userId, canSeePrivate, trackId? }
 */
export async function buildExportModel({ projectId, userId, canSeePrivate, trackId }) {
  const project = await knex('projects').where({ id: projectId }).first('id', 'name', 'type');

  // Phase 3c: dance roster + stage (for formation exports).
  const dancers = await knex('dancers').where({ project_id: projectId }).orderBy('sort_order').orderBy('created_at');
  const settingsRow = await knex('project_settings').where({ project_id: projectId }).first();
  const stage = settingsRow?.settings?.stage || { width: 12, depth: 8 };

  // Department/lane lookup for names + colour inheritance.
  const departments = await knex('departments').where({ project_id: projectId });
  const lanes = departments.length
    ? await knex('cue_lanes').whereIn('department_id', departments.map((d) => d.id))
    : [];
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const laneMeta = new Map(); // lane_id -> { deptName, deptColor, laneName }
  for (const l of lanes) {
    const d = deptById.get(l.department_id);
    laneMeta.set(l.id, { deptName: d?.name || '', deptColor: d?.color || '#6366f1', laneName: l.name });
  }

  let tq = knex('tracks').where({ project_id: projectId }).orderBy('sort_order').orderBy('name');
  if (trackId) tq = tq.andWhere({ id: trackId });
  const tracks = await tq;

  const out = [];
  for (const t of tracks) {
    const version = t.current_version_id
      ? await knex('track_versions').where({ id: t.current_version_id }).first('bpm', 'meter', 'media_duration')
      : null;

    let cq = knex('cues').where({ track_id: t.id }).whereNull('deleted_at');
    if (!canSeePrivate) cq = cq.andWhere((b) => b.whereNot('visibility', 'private').orWhere('owner_id', userId));
    const cues = await cq.orderBy('time');

    const markers = await knex('markers').where({ track_id: t.id }).orderBy('time');

    // Phase 8b: join formation placements (track-scoped) with definitions (project-scoped).
    const placements = await knex('formation_placements').where({ track_id: t.id }).orderBy('time');
    const defIds = [...new Set(placements.map((p) => p.formation_id))];
    const defs = defIds.length
      ? await knex('formations').whereIn('id', defIds)
      : [];
    const defById = new Map(defs.map((d) => [d.id, d]));
    const formations = placements
      .map((p) => {
        const def = defById.get(p.formation_id);
        if (!def) return null;
        return {
          name: def.name,
          beat: p.beat == null ? null : Number(p.beat),
          time: Number(p.time) || 0,
          end_time: p.end_time != null ? Number(p.end_time) : null,
          positions: Array.isArray(def.positions) ? def.positions : [],
        };
      })
      .filter(Boolean);

    out.push({
      id: t.id,
      name: t.name,
      formations,
      bpm: version?.bpm ? Number(version.bpm) : null,
      meter: version?.meter || null,
      duration: version?.media_duration ? Number(version.media_duration) : 0,
      cues: cues.map((c) => {
        const lm = laneMeta.get(c.lane_id) || { deptName: '', deptColor: '#6366f1', laneName: '' };
        return {
          cue_number: c.cue_number,
          name: c.name,
          time: Number(c.time) || 0,
          end_time: c.end_time == null ? null : Number(c.end_time),
          start_beat: c.start_beat == null ? null : Number(c.start_beat),
          end_beat: c.end_beat == null ? null : Number(c.end_beat),
          status: c.status,
          notes: c.description || '',
          department: lm.deptName,
          lane: lm.laneName,
          color: c.color_inherited ? lm.deptColor : c.marker_color,
          osc_address: c.osc_address || '',
          osc_value: c.osc_value || '',
          automation: c.automation,
        };
      }),
      markers: markers.map((m) => ({ name: m.name, time: Number(m.time) || 0, beat: m.beat == null ? null : Number(m.beat) })),
    });
  }
  return { project, stage, dancers: dancers.map((d) => ({ id: d.id, name: d.name, label: d.label, color: d.color })), tracks: out };
}

// --- helpers --------------------------------------------------------------

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** seconds -> "HH:MM:SS:FF" at the given fps (SMPTE non-drop). */
export function smpte(sec, fps = 30) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const f = Math.round((sec - Math.floor(sec)) * fps);
  let s = Math.floor(sec);
  const carry = f >= fps ? 1 : 0;
  const frames = f >= fps ? 0 : f;
  s += carry;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}:${pad(frames)}`;
}

/** seconds -> "M:SS.cc" */
function clock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cc = Math.round((sec - Math.floor(sec)) * 100);
  return `${m}:${pad(s)}.${pad(cc)}`;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');
const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const slug = (s) => String(s || 'export').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export';

/** Iterate every cue across tracks with its track attached. */
function* allCues(model) {
  for (const t of model.tracks) for (const c of t.cues) yield { track: t, cue: c };
}

// --- adapters -------------------------------------------------------------

/** Generic cue-list CSV — one row per cue across all tracks. */
function csvAdapter(model) {
  const header = ['track', 'department', 'lane', 'cue_number', 'name', 'start_time', 'end_time', 'start_beat', 'end_beat', 'status', 'color', 'osc_address', 'osc_value', 'automation', 'notes'];
  const lines = [csvRow(header)];
  for (const { track, cue } of allCues(model)) {
    lines.push(csvRow([
      track.name, cue.department, cue.lane, cue.cue_number ?? '', cue.name,
      clock(cue.time), cue.end_time == null ? '' : clock(cue.end_time),
      cue.start_beat == null ? '' : cue.start_beat.toFixed(3),
      cue.end_beat == null ? '' : cue.end_beat.toFixed(3),
      cue.status, cue.color, cue.osc_address, cue.osc_value, cue.automation, cue.notes,
    ]));
  }
  return { filename: `${slug(model.project.name)}-cues.csv`, contentType: 'text/csv; charset=utf-8', body: lines.join('\n') };
}

/** Reaper .RPP — TEMPO + one named track per department + a project marker per cue. */
function reaperAdapter(model) {
  const bpm = model.tracks.find((t) => t.bpm)?.bpm || 120;
  const depts = [...new Set([].concat(...model.tracks.map((t) => t.cues.map((c) => c.department || 'Cues'))))];
  const L = [];
  L.push(`<REAPER_PROJECT 0.1 "7.0/markers-export"`);
  L.push(`  TEMPO ${bpm} 4 4`);
  // Project markers, one per cue (flat timeline across tracks).
  let idx = 1;
  for (const { cue } of allCues(model)) {
    L.push(`  MARKER ${idx} ${cue.time.toFixed(4)} ${JSON.stringify(cue.name)} 0`);
    idx++;
  }
  // One (empty) named track per department so the structure is visible in Reaper.
  for (const d of depts.length ? depts : ['Cues']) {
    L.push(`  <TRACK`);
    L.push(`    NAME ${JSON.stringify(d)}`);
    L.push(`  >`);
  }
  L.push(`>`);
  return { filename: `${slug(model.project.name)}.rpp`, contentType: 'application/octet-stream', body: L.join('\n') };
}

/** Video-editor markers CSV (Premiere/Resolve friendly): Name, In, Out, Color, Notes. */
function markersCsvAdapter(model, fps = 30) {
  const header = ['Name', 'Track', 'Department', 'In', 'Out', 'Color', 'Notes'];
  const lines = [csvRow(header)];
  for (const { track, cue } of allCues(model)) {
    lines.push(csvRow([
      cue.name, track.name, cue.department,
      smpte(cue.time, fps), smpte(cue.end_time ?? cue.time, fps),
      cue.color, cue.notes,
    ]));
  }
  return { filename: `${slug(model.project.name)}-markers.csv`, contentType: 'text/csv; charset=utf-8', body: lines.join('\n') };
}

/** Final Cut Pro FCPXML 1.9 with markers on a gap spine (experimental, opens in FCP/Resolve). */
function fcpxmlAdapter(model, fps = 30) {
  const t = model.tracks[0]; // FCPXML is timeline-scoped — use the first (or only) track
  const dur = Math.max(1, Math.ceil((t?.duration || 60)));
  const fr = `1/${fps}s`;
  const rate = (sec) => `${Math.round(sec * fps)}/${fps}s`;
  const markers = (t?.cues || [])
    .map((c) => `        <marker start="${rate(c.time)}" duration="${fr}" value="${xmlEsc(c.name)}"${c.notes ? ` note="${xmlEsc(c.notes)}"` : ''}/>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat" frameDuration="${fr}" width="1920" height="1080"/>
  </resources>
  <library>
    <event name="${xmlEsc(model.project.name)}">
      <project name="${xmlEsc(t?.name || model.project.name)}">
        <sequence format="r1" duration="${dur * fps}/${fps}s">
          <spine>
            <gap name="Gap" offset="0s" duration="${dur * fps}/${fps}s" start="0s">
${markers}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
  return { filename: `${slug(t?.name || model.project.name)}.fcpxml`, contentType: 'application/xml; charset=utf-8', body };
}

/** Lighting / laser console cue-list CSV (grandMA3 / ETC Eos / Pangolin mappable). */
function consoleCsvAdapter(model) {
  const header = ['Cue', 'Label', 'Time', 'Timecode', 'Department', 'OSC', 'Notes'];
  const lines = [csvRow(header)];
  let n = 1;
  for (const { cue } of allCues(model)) {
    lines.push(csvRow([
      cue.cue_number ?? n, cue.name, cue.time.toFixed(2), smpte(cue.time, 30),
      cue.department, cue.osc_address, cue.notes,
    ]));
    n++;
  }
  return { filename: `${slug(model.project.name)}-console.csv`, contentType: 'text/csv; charset=utf-8', body: lines.join('\n') };
}

/** Dance formations — one row per dancer-per-formation (Phase 3c). */
function formationsCsvAdapter(model) {
  const dancerById = new Map((model.dancers || []).map((d) => [d.id, d]));
  const header = ['track', 'formation', 'beat', 'time', 'dancer', 'label', 'x', 'y'];
  const lines = [csvRow(header)];
  for (const t of model.tracks) {
    for (const f of t.formations || []) {
      for (const p of f.positions || []) {
        const d = dancerById.get(p.dancer_id);
        lines.push(csvRow([
          t.name, f.name, f.beat == null ? '' : f.beat.toFixed(3), clock(f.time),
          d?.name || p.dancer_id, d?.label || '', Number(p.x).toFixed(4), Number(p.y).toFixed(4),
        ]));
      }
    }
  }
  return { filename: `${slug(model.project.name)}-formations.csv`, contentType: 'text/csv; charset=utf-8', body: lines.join('\n') };
}

/** Dance formations — full structured export (stage + roster + per-track keyframes). */
function formationsJsonAdapter(model) {
  const body = JSON.stringify({
    project: model.project.name,
    stage: model.stage,
    dancers: model.dancers,
    tracks: model.tracks.map((t) => ({ name: t.name, bpm: t.bpm, formations: t.formations || [] })),
  }, null, 2);
  return { filename: `${slug(model.project.name)}-formations.json`, contentType: 'application/json; charset=utf-8', body };
}

export const ADAPTERS = {
  csv: csvAdapter,
  reaper: reaperAdapter,
  'markers-csv': markersCsvAdapter,
  fcpxml: fcpxmlAdapter,
  'console-csv': consoleCsvAdapter,
  'formations-csv': formationsCsvAdapter,
  'formations-json': formationsJsonAdapter,
};

export const EXPORT_FORMATS = Object.keys(ADAPTERS);

export default { buildExportModel, ADAPTERS, EXPORT_FORMATS, smpte };
