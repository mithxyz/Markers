# HANDOVER — cue.mith.studio upgrades

Drafted **2026-06-30** for the next Claude Code session. Two competing products were inspected: [time-line.io](https://time-line.io) (Next.js + Yjs + bespoke canvas) and [editour.co](https://app.editour.co) (Vite + React + Supabase + bespoke canvas, currently Alpha v0.1.89 but architecturally richer). Read top-to-bottom once before starting.

**Revision log:**
- v1 (initial draft): time-line.io research only; plan structured around RGB waveform, BeatNet sidecar, hand-rolled canvas, then typed lanes / AI sections / Rekordbox.
- **v2 (this version): EdiTour inspection revealed beat-positioned cues, nested departments→lanes, per-cue production status, Resolume-targeted OSC with envelope automation, Reaper RPP export, team-level song library. v2 plan reorganized to integrate these.**

---

## 1. The live system

You are working on `/root/markers` — the live Gen-4 cue-marker workspace at <https://cue.mith.studio>.

| Thing | Where |
|---|---|
| Source | `/root/markers/{server,client}` |
| Runtime | `markers.service` (web, `server/index.js`) + `markers-worker.service` (BullMQ media worker, `server/worker.js`) |
| Env | `/root/markers/.env` (single file, both services share it) |
| Service user | `markers-svc` (member of group `markers-svc`) |
| Postgres | container `markers-postgres` on `127.0.0.1:5441` (db `markers`, user in `.env`) |
| Redis | container `markers-redis` on `127.0.0.1:6381` |
| Node | `v22.22.0` via nvm at `/root/.nvm/versions/node/v22.22.0` |
| Web | nginx → Node (see `/etc/nginx/sites-enabled/`); HTTPS terminated at nginx |
| S3 | AWS (creds in `.env`); presigned PUT/GET for media |
| Mail | SES (magic-link auth) |

**Other versions on the box** — leave them alone:
- `/root/CueMarkers` (Gen-1, stopped, archive only)
- `/root/cuemarkers-v2` + `/opt/cuemarkers-v2` (Gen-2, still running via `cuemarkers-v2.service` for any legacy users; don't touch)

**Stack (live):** SvelteKit 2 + Svelte 5 + Tailwind v4 + TypeScript + wavesurfer.js v7 (client); Express + Socket.io + Knex/Postgres 16 + Redis + BullMQ + ffmpeg (server). Magic-link auth, project-level capability-based roles (`project_roles` with JSONB `capabilities`), track versioning with non-destructive `cue_snapshots`, public share-link reads.

**Data model — read these migrations once** in `server/db/migrations/`: `20260624000002_projects_members.js` (projects/membership), `20260624000003_tracks_versions.js` (versioned media), `20260624000005_cues_snapshots.js` (cues are *track-scoped*, snapshotted on version swap), `20260626000002_project_roles.js` (custom roles + capabilities), `20260626000004_project_share.js` (anon share tokens).

---

## 2. Goal and use-cases

Matt is building this for:
1. **DJ shows** — cross-department cueing (LD / VJ / FX / sound) timed to the music. Multiple departments collaborating on one timeline.
2. **Dance school showcases** — choreographers upload audio, annotate, hand off to stage management. Audio + (optional) video reference side-by-side.

The current Gen-4 system has the foundations (collab, versioning, roles, S3 media, waveform). The upgrades in this plan close the gap to a "tool you'd actually run a show with."

---

## 3. Research

### 3.1 time-line.io — verified by live inspection

- **Next.js App Router on Vercel**, Clerk auth, Sentry, PostHog, **Yjs** for collab.
- **Waveform: bespoke 2D canvas, no library** (no wavesurfer / peaks.js / Konva in any of 51 loaded chunks).
- **Per-pixel RGB baked into the peak data on the server.** One endpoint per audio file: `GET /api/audio/{id}/waveforms` → `{"waveformRGBHDCompressed": "<base64>"}`. The base64 decodes via zlib `DecompressionStream('deflate')` to a JSON array shaped:
  ```
  [
    [normalizedAmp_0, [R, G, B]],   // floats; RGB looks like a colormap output, not 8-bit ints
    [normalizedAmp_1, [R, G, B]],
    …
  ]
  ```
  For a 6:55 track: 900 KB on the wire, 1.98 MB decoded (2.2× ratio). Cute, simple, debuggable.
- Multiple stacked `<canvas>` layers (waveform background + interactive overlays), retina-aware (2× DPR backing). One chunk references `OffscreenCanvas` — heavy waveform likely rendered on a Web Worker.

**Their data model (from observed editor):**
- Workspace → Show → Block → Layer → Block-on-layer. A Block is a song-segment.
- **Layers are typed swim-lanes** (Notes, Color, Video, Lights, Laser, SFX, Pyro, Motion, Camera, Dancers, Action). Flat — no nesting.
- **Cues are time-RANGES (Enter + Exit)**, not points. Action blocks fire one trigger on Enter and one on Exit.
- **Action triggers shipped:** MIDI Note On, MIDI Note Off, OSC Message (Int/Float/String/Blob). No DMX/LTC despite marketing.
- **Sharing:** view-only / edit-and-view; no custom roles.

### 3.2 EdiTour (app.editour.co) — verified by live inspection

**Stack (much leaner than time-line.io):**
- **Vite + React + Radix UI**, single 1.1 MB bundle, on Vercel.
- **Supabase** for the entire backend — Postgres + Auth + Storage + Realtime, with PostgREST exposed directly to the browser (no custom API server). The "In Sync" footer indicator is Supabase Realtime's WebSocket.
- **Essentia.js (WASM) running client-side** for the ANALYZE button — BPM and beat detection in the browser, no server analysis.
- **LTC + SMPTE timecode decoder** in the bundle — the "TC ●" green dot is a live timecode chase. They can lock the playhead to incoming SMPTE LTC (probably via Web Audio API → audio-in → LTC decoder).
- **Zustand** state, **Radix Primitives** + **Sonner** toasts, **PostHog** analytics. **No** wavesurfer/peaks/Konva/Tone/Yjs — same hand-rolled canvas pattern as time-line.io.
- Audio stored raw as **.wav** in Supabase Storage with signed download URLs.
- Issue tracking is **Linear** (one export was tagged `ENG-263`).

**Their data model — extracted from PostgREST URLs observed in network panel:**
```
teams (id, name)
  team_members (team_id, user_id, role, status: active|invited|pending)
  team_invites (team_id, invited_email, status: pending)

profiles      (id, first_name, last_name, email, display_name, avatar_url)
profiles_public (sanitized view for share contexts)

songs         (id, team_id, ...)                  // ← Library is at TEAM level, shared across shows
  song_versions (song_id, version_number, ...)

projects      (id, team_id, ...)                  // "Show"
  project_members  (project_id, user_id, role, joined_at)
  project_songs    (project_id, song_id)          // M-N: songs reusable across shows
  departments      (project_id, name, color, sort_order)
  department_assignments (project_id, user_id, department_id)   // crew mapping

cues          (song_id, department_id?, start_beat, end_beat, name, status,
               osc_address, osc_value, automation, deleted_at)  // soft delete, beat-positioned
markers       (song_id, beat, name, created_by → profiles)      // point-in-time labels, attributed
effect_clips  (song_id, start_beat, ..., deleted_at)            // third class — likely the BRIGHTNESS automation lanes
```

**The high-value architectural insights:**

1. **Cues are positioned by BEAT NUMBER, not seconds** (`start_beat`, `end_beat`). Time display is *derived* (`5 → 00:01.60`, `16 → 00:06.00` at 150 BPM). Survives BPM changes; enables musical snap, Reaper export, Rekordbox import.
2. **Songs are TEAM-OWNED, not show-owned.** A team has a song library; shows pull songs from it via `project_songs`. Same audio file appears in many shows without duplication.
3. **Departments are first-class** (304 mentions in the bundle vs 146 for marker, 40 for automation). Each has a color and sort order; lanes nest inside.
4. **Per-cue `status` field** for production workflow (Not Started → In Progress → Done).
5. **Soft delete via `deleted_at`** (you don't have this; you delete hard).
6. **Three classes of timeline content**: `cues` (the main triggers), `markers` (point-in-time labels with `created_by` attribution), `effect_clips` (the BRIGHTNESS envelope lanes — automation curves as their own table).

**Cue Details panel — fields observed:**
- NAME (text)
- **START BEAT / END BEAT** (numeric, with time shown beneath as derived display)
- **DEPARTMENT** dropdown (one of the project's departments)
- **STATUS** dropdown (Not Started → …)
- **CUE COLOR**: 12-swatch palette + "Inherited from timeline" toggle (default = dept color)
- **NOTES**: free-form production text
- **OSC OUTPUT** → ADDRESS defaulting to `/composition/layers/1/clips/1/` (this is Resolume Arena's OSC schema verbatim — they target Resolume as first-class)
- **VALUE (OPTIONAL)**: "Defaults to dept value or 1" — department-level OSC value default
- **ADVANCED MODE** toggle: "Sends [value, duration, fade] array" — full Resolume parameter envelope
- **AUTOMATION** dropdown attached to cue (None / Ramp Up / Ramp Down / Strobe / Pulse) — per-cue modulation curve

**Editor features observed:**
- Bar/beat snap (`SNAP 1/1` with dropdown), position display `1.1 / 1` (bar.beat)
- Beat count in footer (`BEATS 776` for a 310.4s track at 150 BPM ✓)
- Per-song timecode offset (`HH:MM:SS:FF`) for global show-control alignment ("Timecode Offset Manager")
- Song-level versioning (`V1 LATEST` chip)
- Soft-delete soft delete pattern (`deleted_at=is.null` query filter)
- Nested lanes within departments (Lighting has Lane 1, Lane 2; Visuals has Lane 1, Lane 2, and a "Brightness" automation lane)
- **FOLLOW toggle** (auto-scroll playhead into view)
- **IN/OUT/CLEAR** loop region transport
- Keyboard shortcuts visible in footer at all times: `Space · Shift+D · ⌘Z · Backspace`

**Export options observed:**
1. **Cue List (CSV)** — "One row per cue, with department, cue name, start/end time, beat positions, status, and notes."
2. **Reaper MIDI — per department (.RPP)** — "Reaper project: EdiTour markers + one MIDI track per department, cues as named notes. Experimental."

**Alpha smell** (worth knowing they're early): visible N+1 query storm in network panel — 30+ identical refetches of `project_members` and `profiles` during a single page load. No query-cache layer (no react-query/SWR in the bundle). Will hurt them at scale.

### 3.3 Three-way comparison

| Feature | EdiTour | time-line.io | Yours (Gen-4 today) |
|---|---|---|---|
| Cue position | **Beat-numbered** ✓ | Time-only | Time-only |
| Cue shape | Time-range + automation envelope | Time-range, static Enter/Exit | Point with optional `end_time`/`fade` |
| Departments | **First-class, nested lanes, colored** ✓ | Typed flat layers | Single cue stream w/ visibility flag |
| Crew mapping | `department_assignments` | None | None |
| Production status | Per-cue `not_started → done` | None | None |
| OSC integration | **Resolume-targeted w/ envelope** | Generic OSC | None |
| AI / analysis | Client essentia.js | Server-side | None |
| Beat grid | Yes; snap-to-beat | No | No |
| Timecode chase | **LTC/SMPTE decoder** | None | None |
| Reaper export | **.RPP per dept** | None | None |
| CSV export | Yes | None | None |
| Library scope | **Team-level, multi-show** ✓ | Per-show | Per-project |
| Song versioning | Yes | None visible | **Yes (your strength)** |
| Custom roles | Two-tier (team + project) | View / edit only | **Custom + capability JSONB (your strength)** |
| Collab | Supabase Realtime | Yjs | Socket.io + `lock_version` |
| Public share link | Not seen | Yes (rotatable) | **Yes (your strength)** |
| Video as media | Not seen | Annotation only | **First-class with filmstrip (your strength)** |
| Soft-delete | Yes (`deleted_at`) | Not seen | No |

**Where you already win:** custom capability-based roles, server-side media pipeline (transcoding, peaks, filmstrip), video tracks as first-class media, snapshot-based versioning, share-link permissions granularity. Don't regress these.

**Where EdiTour wins (most adoptable):** beat-positioned cues, nested departments→lanes, per-cue status, Resolume OSC + automation envelopes, team-level song library, Reaper/CSV export, in-browser BPM via essentia.js.

**Where time-line.io wins:** server-baked RGB waveform aesthetic (we adopt this), AI section detection (later).

### 3.4 Beat-grid / BPM / AI sections — what to use on the server

| Need | Best OSS tool | Lang | Notes |
|---|---|---|---|
| BPM only, in browser | **Essentia.js** (`BeatTrackerDegara`) | JS/WASM | In-process — what EdiTour does. Instant feedback. No downbeats. |
| BPM + beats + downbeats + meter | **BeatNet** ([github.com/mjhydri/BeatNet](https://github.com/mjhydri/BeatNet)) | Python | CRNN + particle filter; offline mode for batch |
| BPM + beats + downbeats + sections | **`all-in-one-fix`** ([pypi.org/project/all-in-one-fix](https://pypi.org/project/all-in-one-fix/)) | Python | 10-class labels (intro/verse/chorus/bridge/break/...) |
| Highest accuracy beats/downbeats | `madmom` 0.16.1 | Python | RNNDownBeatProcessor + DBN tracker |

CPU vs GPU: `all-in-one` is ~109 s/track on an L40S GPU (Replicate, $0.11/track). On commodity CPU expect **several minutes per track** — plan async, not interactive.

**Two-track strategy** (the right play given EdiTour evidence):
1. **Client-side essentia.js** for instant BPM/beat on upload (so the BPM appears in the track header within seconds — matches EdiTour UX).
2. **Server-side Python sidecar (BeatNet)** for authoritative beat grid with downbeats + meter, run async; overwrites the essentia.js values when done.

EDM nuance: conventional segmentation models lean on lyrical/harmonic similarity and underperform on EDM, where structure is energy/rhythm/timbre-driven. A simple energy + spectral-novelty heuristic is a competitive baseline for DJ tracks until you wire up `all-in-one`.

### 3.5 Rekordbox import

- Rekordbox 6/7 stores its library in **SQLCipher-encrypted SQLite (`master.db`)**. The encryption key is shared across all installs and known (community-reverse-engineered).
- **[pyrekordbox](https://github.com/dylanljones/pyrekordbox)** (Python) reads master.db, XML exports, ANLZ analysis files (waveform + beat grid + cues), and MySettings — tested against Rekordbox 5.8.6, 6.7.7, 7.0.9.
- **The simplest v1 import path is the XML export**: user picks "File → Export Collection in xml format" in Rekordbox, drops the file in the browser, server parses with any XML lib. Carries: track filename, BPM, key, hot cues, memory cues, playlists.
- **Don't do live memory reading** (TimecodeLink pattern) — patch-version-fragile, requires re-signing Rekordbox.
- **Important alignment with §6.0:** Rekordbox stores hot cues by *sample position*. Once you have beat-positioned cues + BPM, the import maps `sample_position → seconds → beats` cleanly. Without beat-positioned cues, you'd be doing the time math forever.

---

## 4. The upgrade plan

Ordered by **value-per-line-of-code**, restructured to integrate EdiTour findings. Don't skip ahead.

### v1 — visible UX upgrade, no breaking schema changes (ship first)

1. **Server-baked RGB waveform artifact** — match time-line.io's approach. Replace existing peaks JSON with `[[normalizedAmp, [R, G, B]], …]` zlib+base64 inside `{waveformRGBHDCompressed: "..."}`. Coloring driven by per-bucket RMS energy via a `chroma-js` viridis ramp. See §5.1.
2. **Beat-grid via Python sidecar (BeatNet)** + **client-side BPM via essentia.js** for instant feedback. BullMQ job `analyze_rhythm` → emits `beatgrid.json` artifact + writes `bpm`, `meter`, `first_downbeat_sec` to `track_versions`. essentia.js writes provisional BPM on upload. UI: BPM in track header, beat ticks overlay (faint), downbeats stronger, snap-to-beat toggle. See §5.2.
3. **Hand-rolled Svelte 5 canvas component** — drop wavesurfer.js. Both competitors use no library; the RGB-per-pixel data makes the render loop ~30 lines. See §5.3.

### v2 — model upgrades that unlock the DJ + dance-school use cases

4. **§6.0 Beats as source of truth (load-bearing).** Add `start_beat`, `end_beat` columns on `cues`; derive time on display. **Must land before §6.1, §6.4, §6.5.**
5. **§6.1 Departments + nested lanes.** New `departments` table (project-scoped, colored, ordered). Cues belong to a lane within a department. Drop the existing single-stream `cues.visibility` filter in favor of department-scoped capabilities.
6. **§6.2 Per-cue production fields.** `status` enum, `notes` text, `created_by` FK on cues; `created_by` + `markers` table for attributed point-labels; soft-delete (`deleted_at`) across cue-like tables.
7. **§6.3 Resolume-targeted OSC + automation envelopes.** Department-level OSC defaults; per-cue OSC override with `[value, duration, fade]` advanced mode; `automation` enum (None / Ramp Up / Ramp Down / Strobe / Pulse).
8. **§6.4 AI section detection (allin1).** Second job on the v1 Python sidecar; emits `sections.json`. Section labels feed back into the v1 RGB colormap (intro/build/drop/break → fixed palette).
9. **§6.5 Rekordbox XML import.** With beat-positioning from §6.0 in place: parse `rekordbox.xml`, create one Song per track (or Block per track once §7 lands), backfill BPM/key, copy hot cues + memory cues as cues.
10. **§6.6 CSV + Reaper RPP export.** CSV from the cue table directly. RPP is structured text — one MIDI track per department, named-note markers per cue. Both are small.

### v3 — architectural (only after v1+v2 stable)

11. **Team-level song library** — promote `project → show`, demote `tracks → songs (team_owned)`, add `show_songs` join. Same audio reusable across shows. Heavy migration; do last.
12. **Show → Block → Song hierarchy** (matching time-line.io's "Block" concept) — a show is a sequence of song-blocks with per-song offsets.
13. **Live triggers (OSC out, MIDI, LTC chase).** WebMIDI for MIDI direct from browser; small Node/Tauri helper for OSC; LTC decoder over Web Audio for chase (essentia or custom). Match EdiTour's TC ● indicator.
14. **Yjs for collab.** Replace Socket.io snapshots + `lock_version` with true CRDT. Big rewrite; defer unless multi-user simultaneous-edit conflicts are observed.
15. **Crew assignments** — `department_assignments(project_id, user_id, department_id)` — users mapped to departments, used for capability filtering and "show me my cues" filtering. Cheap add once §6.1 lands.

---

## 5. v1 — detailed plan

### 5.1 Server-baked RGB waveform artifact

**Touch:**
- `server/services/waveform.js` (extend existing ffmpeg pipeline)
- `server/db/migrations/20260630000001_version_waveform_rgb.js` (new) — add `waveform_rgb_s3_key string nullable` to `track_versions`
- `client/src/lib/waveform/peaks.ts` (decode helper)
- `client/src/lib/components/WaveformTrack.svelte` (consume new artifact)

**Worker job:**
1. After existing ffmpeg pass that produces the current peaks, downsample to N=2000 buckets and compute per-bucket RMS energy.
2. Map each bucket's normalized energy `[0..1]` through a colormap: install `chroma-js` (Node, pure-JS, MIT) and use `chroma.scale(['#1e1e3f', '#a13670', '#ffce00']).domain([0, 0.6, 1.0])` for a viridis-ish ramp; tweak to match the dark theme.
3. Build the array: `peaks.map((amp, i) => [amp, chroma(energy[i]).rgb()])`.
4. `JSON.stringify` → `zlib.deflateSync` → `.toString('base64')` → wrap in `{waveformRGBHDCompressed: <b64>}` → upload to S3 as `tracks/{trackId}/versions/{versionId}/waveform-rgb.json`. Store key in `track_versions.waveform_rgb_s3_key`.

**API:** add a route `GET /api/v1/tracks/:trackId/versions/:versionId/waveform-rgb` that presign-redirects or proxy-streams the S3 object. Reuse the existing presign helper in `server/services/s3.js`.

**Client decode (`client/src/lib/waveform/peaks.ts`):**
```ts
export async function fetchWaveformRGB(url: string): Promise<Array<[number, [number, number, number]]>> {
  const { waveformRGBHDCompressed } = await fetch(url).then(r => r.json());
  const bin = Uint8Array.from(atob(waveformRGBHDCompressed), c => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(buf));
}
```
`DecompressionStream('deflate')` works in Chrome 80+, Safari 16.4+, Firefox 113+. No `pako` dep.

### 5.2 Beat-grid: Python sidecar (BeatNet) + client essentia.js

**Two passes, complementary:**

**A. Client-side essentia.js, instant on upload.**
- Add `essentia.js` to the client (~1.5 MB WASM). After upload completes, the client decodes the audio (Web Audio `decodeAudioData`), runs `BeatTrackerDegara` or `PercivalBpmEstimator`, writes provisional BPM to the track via a small PATCH endpoint.
- Tradeoff: blocks the main thread for ~1-3 s on a 5-min track. Use a Web Worker.

**B. Server-side BeatNet, authoritative.**
- New BullMQ job `analyze_rhythm`. Spawns the Python sidecar (`docker run --rm`), parses stdout JSON `{bpm, meter, beats, downbeats}`, uploads `beatgrid.json` to S3, overwrites the essentia.js BPM, emits Socket.io event to refresh the client.

**Touch (new):**
- `services/python/` — new directory at repo root for the Python toolchain
- `services/python/Dockerfile` — `python:3.11-slim` + ffmpeg + BeatNet
- `services/python/analyze_rhythm.py` — CLI: `analyze_rhythm.py <input.wav>` → stdout JSON
- `server/db/migrations/20260630000002_version_rhythm.js` — add `bpm float`, `meter string`, `first_downbeat_sec float`, `beatgrid_s3_key string` to `track_versions`
- `server/services/rhythm.js` (new) — spawn the Python container/script, parse JSON, upload `beatgrid.json` to S3
- `server/worker.js` — new BullMQ job type `analyze_rhythm`, enqueued after `processing → ready` transition
- `client/src/lib/waveform/beatgrid.ts` (new) — fetch `beatgrid.json`, expose `snapToBeat(t)` and `barLabel(t)` helpers
- `client/src/lib/waveform/essentia.worker.ts` (new) — Web Worker running essentia.js for client BPM
- `client/src/lib/components/WaveformTrack.svelte` — overlay beat ticks (1px-wide vertical lines, downbeats brighter)
- `client/src/lib/components/CueEditor.svelte` — add a "Snap to beat" toggle in the cue-time field

**Sidecar architecture:** build **one** Docker image `markers-py` (Python 3.11 + ffmpeg + numpy + torch-cpu + BeatNet + later allin1) and spawn it per-job via `docker run --rm` from the Node worker. Avoid keeping a long-lived Python process unless throughput becomes a bottleneck.

**Don't:** try server-side `essentia.js` first. It looks tempting (in-process Node) but doesn't give you downbeats. Use it only client-side for the instant-feedback path.

**Test plan:** run the script standalone against `SaxOnCello 2023.mp3` (it's on the box somewhere from earlier dev). Sanity-check BPM matches time-line.io's reading (90 BPM for that track).

### 5.3 Hand-rolled Svelte 5 canvas waveform component

**Touch:**
- `client/src/lib/components/WaveformTrack.svelte` — full rewrite

**Approach:** stop using `wavesurfer.js`; render directly. Two stacked canvases (the time-line.io / EdiTour pattern):
1. **Background canvas** — draws the RGB-per-pixel waveform once on data load + on resize. Hi-DPI: scale backing dimensions by `devicePixelRatio`. Render via `OffscreenCanvas.transferControlToOffscreen()` to a Web Worker if you can; not required for v1.
2. **Foreground canvas** — draws playhead, cue markers, beat-grid overlay, selection. Cleared and redrawn on each animation frame only while playing or hovering.

Draw loop (background, ~30 lines):
```ts
const ctx = canvas.getContext('2d')!;
const dpr = devicePixelRatio;
canvas.width  = cssWidth  * dpr;
canvas.height = cssHeight * dpr;
ctx.scale(dpr, dpr);
const midY = cssHeight / 2;
const pxPerBucket = cssWidth / peaks.length;
for (let i = 0; i < peaks.length; i++) {
  const [amp, [r, g, b]] = peaks[i];
  ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
  const h = amp * cssHeight;
  ctx.fillRect(i * pxPerBucket, midY - h/2, Math.max(1, pxPerBucket), h);
}
```

Audio playback: keep an `<audio>` element (or `AudioContext` for finer control). wavesurfer.js was doing this for you — losing it means writing your own playhead-to-audio time sync (~50 lines).

**Keep wavesurfer.js** only if it owns nontrivial features you don't want to rebuild yet (regions, scroll/zoom). Check `WaveformTrack.svelte` first — both competitors prove a hand-roll works at this scale.

---

## 6. v2 — detailed plan (EdiTour-informed)

### 6.0 Beats as source of truth — DO FIRST

**Load-bearing for §6.1, §6.4, §6.5.** Without this, snap, Reaper export, and Rekordbox import are all painful.

**Migration `20260710000001_cues_beat_positions.js`:**
- Add `start_beat float nullable`, `end_beat float nullable` to `cues`.
- Backfill: for each cue, `start_beat = time × (bpm/60)` if its track has a `bpm` (from §5.2); leave NULL otherwise. NULL-tolerant: time stays the fallback.
- Add `CHECK (start_beat IS NOT NULL OR time IS NOT NULL)` so at least one is present.
- Index on `(track_id, start_beat NULLS LAST)`.

**API:** new fields on `POST /cues` and `PATCH /cues/:id`. When the client writes `start_beat`, server computes `time` from BPM and stores both (for backwards compat and BPM-less tracks). When BPM changes, recompute `time` server-side.

**Client:** `CueEditor.svelte` shows bar.beat as the primary input (`1.1` style), with `00:01.60` as a derived display below — copy EdiTour. Snap-to-beat toggle (from §5.2) becomes the default when a beat grid exists.

**Estimate:** medium. The wire-format change ripples across `routes/cues.js`, `services/versions.js` (for snapshots), and the client cue editor + cue list.

### 6.1 Departments + nested lanes

Replace single-stream `cues` with **two-level hierarchy**: project → departments → lanes → cues. This is EdiTour's model, refined.

**Migration `20260710000002_departments_and_lanes.js`:**
- `departments(id, project_id, name, color, sort_order, default_osc_address text NULL, default_osc_value text NULL, created_at)` — UNIQUE `(project_id, name)`.
- `cue_lanes(id, department_id, name, sort_order, kind enum('cues','automation'), created_at)` — UNIQUE `(department_id, name)`.
- Add `lane_id uuid NULL` to `cues`. Backfill: for each existing project, create one department "Cues" + one lane "Default", assign all existing cues to it.
- After backfill, `ALTER cues ALTER COLUMN lane_id SET NOT NULL`.

**Capability changes:**
- Add `view_department(<dept_id>)`, `edit_department(<dept_id>)` runtime-derived capabilities. Store on `project_roles` as JSONB `{department_caps: {<dept_id>: ['view','edit']}}` OR a join table `project_role_departments(role_id, department_id, can_view, can_edit)` (cleaner).
- Default mapping for the seeded `editor` role: view+edit all departments. For `viewer`: view all.
- Per-user "crew assignment" (v3) further filters via `department_assignments`.

**Drop:** `cues.visibility` becomes redundant when departments handle access. Migration sets `visibility='public_edit'` for backwards-compat reads, but the server stops gating on it for new code.

**UI:**
- `TrackWorkspace.svelte` renders departments as labeled sections with their color stripe, each containing one or more lanes. The visible "BRIGHTNESS" sub-row pattern (EdiTour Visuals → Brightness) is a lane of `kind='automation'`.
- `+ Add Department` button (owners + capability `manage_departments`).
- `+ N` button next to each department header to add a lane.
- Cue color defaults to department color (the "Inherited from timeline" pattern).

### 6.2 Per-cue production fields

Trivial column adds, big UX win.

**Migration `20260710000003_cue_production_fields.js`:**
- `cues.status enum('not_started','in_progress','done','blocked') default 'not_started'`
- `cues.deleted_at timestamptz NULL` (soft delete; update all reads to filter `WHERE deleted_at IS NULL`)
- `cues.color_inherited boolean default true` (when true, render with `lane.department.color`; when false, use `marker_color`)
- `cues.notes text default ''` (already exists as `description`? confirm; rename if needed for clarity, or leave as `description`)

**New table `markers`:** point-in-time labels with attribution, separate from cues (EdiTour pattern).
- `markers(id, track_id, beat float, time float, name text, color string(9), created_by uuid FK users, created_at)`
- Routes `GET/POST/PATCH/DELETE /tracks/:trackId/markers` mirroring `cues` shape but with `beat` not `start_beat/end_beat`.
- UI: markers render as inverted triangle ticks on the timecode ruler with hover-name + creator avatar.

**Backwards-compat:** existing `cues` keep their `time/end_time` columns. The world doesn't end if `start_beat` is NULL.

### 6.3 Resolume-targeted OSC + automation envelopes

EdiTour ships with `/composition/layers/1/clips/1/` as the default — they target **Resolume Arena** specifically. You already run Resolume MCPs on the VPS, so this is doubly natural.

**Migrations `20260710000004_cue_triggers.js`:**
- `cues.osc_address text NULL` — full OSC path. Optional; falls back to `lane.department.default_osc_address`.
- `cues.osc_value text NULL` — value as string ("1", "0.5", "true"). Optional; falls back to `lane.department.default_osc_value`. Parsed at trigger time using a `osc_value_type enum('int','float','string','bool')`.
- `cues.automation enum('none','ramp_up','ramp_down','strobe','pulse') default 'none'` — envelope curve applied to the value over the cue's duration.
- `cues.advanced_payload jsonb NULL` — when present, full Resolume `[value, duration, fade]` payload override.
- `departments.default_osc_address`, `departments.default_osc_value` already added in §6.1.

**No trigger emitter yet** — store the data, render the UI. Live emission is v3 (§7's live-triggers item).

**Client:** rebuild `CueEditor.svelte` right panel to match EdiTour's:
- NAME, START BEAT / END BEAT (from §6.0), DEPARTMENT, STATUS
- CUE COLOR with 12-swatch + "Inherited from department" toggle (default checked)
- NOTES
- OSC OUTPUT collapsible section: ADDRESS, VALUE (OPTIONAL), ADVANCED MODE toggle (shows the JSONB payload editor)
- AUTOMATION dropdown

### 6.4 AI section detection (allin1)

- Second script on the v1 Python sidecar: `analyze_sections.py <input.wav>` → `{sections: [{start_beat, end_beat, label, confidence}]}` (note: emit **beats** not seconds, so it composes with §6.0).
- New BullMQ job `analyze_sections`. Stores artifact at `tracks/{id}/versions/{vid}/sections.json`.
- The v1 RGB colormap gets a new mode: when sections exist, color each bucket by section label (INTRO=blue, BUILD=yellow, DROP=red, BREAK=green) instead of by energy. Trigger a waveform re-bake when sections arrive.
- UI: `SectionsBar.svelte` renders labeled section blocks above the waveform.

### 6.5 Rekordbox XML import

- `POST /api/v1/imports/rekordbox` (auth + capability `manage_tracks`). Multipart upload accepting `rekordbox.xml`.
- Parse with Node `xml2js` — no Python needed for XML.
- For each `<TRACK>`: create a Song (or Track in current model), set `bpm`, `key`. For each `<POSITION_MARK>`: create a cue with `start_beat = Start × bpm/60` (using the track's bpm from same XML). `Type=0` (memory point) → private/notes-only cue; `Type=1..` (hot cue A-H) → public_edit cue, color from `Red/Green/Blue` attributes.
- Audio files aren't in the XML — only paths. v1 of this feature: metadata + cues only; audio uploaded separately. v2: companion-app that uploads referenced files.

### 6.6 CSV + Reaper RPP export

- **CSV:** `GET /api/v1/projects/:id/export.csv` — one row per cue, columns: `department, lane, name, start_beat, end_beat, start_time, end_time, status, notes, color, osc_address, osc_value`. Small route, half a page.
- **Reaper RPP:** `GET /api/v1/projects/:id/export.rpp` — emit a `.rpp` (it's structured text, not binary). Template:
  ```
  <REAPER_PROJECT 0.1 "7.0/macOS"
    TEMPO {bpm} {time_sig_num} {time_sig_den}
    <TRACK
      NAME "{department.name}"
      <ITEM
        POSITION {seconds}
        LENGTH {seconds_dur}
        NAME "{cue.name}"
        <SOURCE MIDI ... >
      >
    >
  >
  ```
  One TRACK per department, one ITEM per cue. EdiTour tagged this "experimental" — match that — a v1 that opens in Reaper without errors is enough.

---

## 7. v3 — sketch only

### 7.1 Team-level song library

Promote `project → show`, demote `tracks → songs` at team level.

```
teams (existing as workspaces — may need to introduce if you're project-only today)
  └── songs (team_id, name, bpm, key, ...)
      └── song_versions (song_id, ...)        // your existing track_versions, relabeled
  └── shows (formerly "projects")
      └── show_songs (show_id, song_id, sort_order, offset_seconds)   // M-N join, the "Block" model
      └── departments (show_id, ...)          // (from §6.1)
      └── show_members (show_id, user_id, role_id)   // your existing project_members
```

The `offset_seconds` on `show_songs` is EdiTour's per-song timecode offset for global show-control alignment.

Heavy migration: every `project_id` reference in the codebase becomes `show_id`; tracks become a join through `show_songs`; cues need a context (`show_song_id` not just `track_id`).

### 7.2 Live triggers + LTC chase

- **OSC out:** small Node helper bridging WebSocket → UDP. Run as a separate `markers-osc-bridge.service`. The browser sends a WS message `{cue_id, osc_address, value}` and the bridge emits the OSC packet to a user-configured target (e.g. Resolume on `127.0.0.1:7000`).
- **MIDI out:** WebMIDI direct from the browser; no bridge needed. Permission prompt on first use.
- **LTC chase in:** EdiTour reads SMPTE LTC via Web Audio (audio-in stream → LTC decoder). The `ltc-decoder` npm package wraps this. The TC ● indicator goes green when sync locks.
- Cue triggering at runtime: a per-show "PLAY" view that scrubs the global show clock (driven by LTC or internal), emits OSC/MIDI as the playhead passes each cue's `start_beat` (Enter) and `end_beat` (Exit). Automation envelopes interpolate between those events.

### 7.3 Yjs collab

- Replace today's Socket.io snapshot pattern + `lock_version` optimistic concurrency with Yjs CRDTs.
- One `Y.Doc` per show, persisted via `y-leveldb`-style adapter against Postgres (or the simpler `y-supabase` if you ever migrate — but you wouldn't).
- This is a multi-week rewrite of `server/socket/*` and many client stores. Defer until users actually hit merge conflicts. Probably never if cue editing is naturally department-scoped.

### 7.4 Crew assignments

- `department_assignments(id, project_id, user_id, department_id, created_at)`. UNIQUE `(project_id, user_id, department_id)`.
- "Show me my cues" filter in the UI (just `WHERE department_id IN (my assignments)`).
- Notifications "@you on cue X" via the same join.
- Cheap once §6.1 lands.

---

## 8. How to start

1. **Read these files in order** (5 min):
   - `package.json`, `client/package.json`
   - `server/db/migrations/2026062*.js` (all 15)
   - `server/services/waveform.js`, `server/worker.js`
   - `client/src/lib/components/WaveformTrack.svelte`
2. **Run the dev loop** to confirm nothing's broken:
   ```bash
   systemctl status markers markers-worker
   sudo -u markers-svc bash -c 'cd /root/markers && node --version'
   ```
3. **Start v1 §5.1** (server-baked RGB waveform). It's self-contained, ships a visible improvement, and validates the artifact pattern you'll reuse for §5.2, §6.4.
4. **Don't deploy v1 §5.3 (replacing wavesurfer.js) on the same PR as §5.1 + §5.2.** Land the data-side changes first, prove they work with the existing wavesurfer-based UI via a custom renderer, *then* rewrite the component. Two PRs.
5. **When you get to v2: do §6.0 (beat-positioning) BEFORE §6.1.** It's the load-bearing change everything else builds on.

---

## 9. Safety rails

- **Live service.** `markers.service` is what people hit at <https://cue.mith.studio>. Don't deploy half-finished migrations. Use `npm run migrate` from `/root/markers` as the `markers-svc` user.
- **Migration idempotency.** All migrations must be reversible. The existing `cues_snapshots` migration is a good template.
- **The `markers-svc` service user owns its working set** under `/opt/markers-svc` and `/root/markers/logs` (see `ReadWritePaths` in `systemctl cat markers.service`). When you install new tooling (Docker images for the Python sidecar), the systemd unit may need additional `ReadWritePaths` or capability bumps. Update the unit file under `/etc/systemd/system/markers*.service` and `systemctl daemon-reload`.
- **The Python sidecar should NOT run as root.** Build the image with a non-root user (`USER 1000:1000`) and only mount the per-job `/jobs` directory.
- **S3 bucket layout** lives in `server/lib/keys.js` — extend that file rather than inlining new key patterns elsewhere.
- **Don't break `/opt/cuemarkers-v2`** — different DB (`:5434`), different service. Leave it.
- **Auth: magic-link only.** Don't add password fields, OAuth, or Clerk-style hosted auth without a separate discussion with Matt.
- **Capability checks.** Every new route must use `requireCapability(...)` from `server/middleware/membership.js`. Don't duplicate the auth pattern; reuse the helpers in `server/lib/http.js`.
- **Don't regress your strengths.** The custom capability-based roles, the snapshot-based versioning, the public share tokens, and video-as-first-class-media are things both competitors lack. Schema changes in §6.x must preserve them.

---

## 10. References

Findings from the 2026-06-30 research sessions (in chat history):

**time-line.io (verified):**
- Next.js App Router on Vercel with Clerk + Yjs + Sentry + PostHog + bespoke 2D canvas.
- Waveform endpoint format: `{waveformRGBHDCompressed: <base64-zlib-of-JSON-array>}`. Array shape: `[[normalizedAmp, [R, G, B]], …]`.
- companion-app: Sparkle updater on S3, currently `timeline_upload-2.0.36+56` (macOS + Windows).

**EdiTour (verified by inspecting <https://app.editour.co/>):**
- Vite + React + Radix UI, single bundle on Vercel; Supabase backend (PostgREST direct, no API server); essentia.js client-side for ANALYZE; LTC/SMPTE decoder in bundle for TC chase; Sonner toasts, Zustand state.
- Schema (from PostgREST URLs): `teams`, `team_members`, `team_invites`, `profiles`, `profiles_public`, `songs`, `song_versions`, `projects`, `project_members`, `project_songs`, `departments`, `department_assignments`, `cues` (with `start_beat`, `deleted_at`), `markers` (with `created_by`), `effect_clips`.
- Cue editor fields: NAME, START_BEAT, END_BEAT, DEPARTMENT, STATUS, CUE_COLOR (12 swatches + inherit toggle), NOTES, OSC_OUTPUT (address, value, advanced `[value,duration,fade]`), AUTOMATION (Ramp Up/Down/Strobe/Pulse).
- OSC default `/composition/layers/1/clips/1/` = Resolume Arena schema.
- Exports: CSV per cue; Reaper .RPP with one MIDI track per department.

**Tech references:**
- wavesurfer.js v7 docs (if you keep it): <https://wavesurfer-js.pages.dev/docs/types/wavesurfer.WaveSurferOptions>; gradient example: <https://wavesurfer.xyz/example/gradient-fill-styles/>.
- BBC audiowaveform CLI (skipped — RGB-baking makes it irrelevant): <https://github.com/bbc/audiowaveform>.
- BeatNet: <https://github.com/mjhydri/BeatNet>. Madmom downbeats: <https://madmom.readthedocs.io/en/v0.16.1/modules/features/downbeats.html>. Essentia rhythm: <https://essentia.upf.edu/reference/streaming_RhythmExtractor2013.html>. Essentia.js (client-side BPM): <https://mtg.github.io/essentia.js/>.
- all-in-one (mir-aidj) + PyTorch-2 fork: <https://github.com/mir-aidj/all-in-one>, <https://pypi.org/project/all-in-one-fix/>.
- pyrekordbox (Rekordbox 5/6/7 reader): <https://github.com/dylanljones/pyrekordbox>. Beat Link Trigger CueList model (data shape reference): <https://blt-guide.deepsymmetry.org/beat-link-trigger/7.4.1/Integration_MIDI_rekordbox.html>.
- Resolume Arena OSC schema (your existing MCP docs are the canonical source; format `/composition/layers/{N}/clips/{M}/...`).
- ltc-decoder npm: <https://www.npmjs.com/package/ltc-decoder>.
