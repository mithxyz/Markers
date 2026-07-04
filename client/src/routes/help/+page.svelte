<script lang="ts">
  // Public page — no auth required so it is linkable and readable before sign-in.
  const sections = [
    {
      id: 'getting-started',
      title: 'Getting started',
      items: [
        { heading: 'Sign in', body: 'Enter your email and password on the login page. Use "Forgot password" to receive a one-time reset link by email.' },
        { heading: 'Create a project', body: 'From the Projects page, hit "+ New project". Choose a type — DJ / festival (cues + OSC/MIDI + Rekordbox), Dance / choreo (cues + formations), or General. You can change the type at any time from Project settings.' },
        { heading: 'Add a track', body: 'Open a project → click "+ Add track". Drop an audio or video file onto the upload zone (or click to choose). The file uploads directly to S3 and the analysis pipeline runs in the background: waveform peaks, RMS, beat-grid, RGB colour waveform, and BeatNet rhythm analysis.' },
      ],
    },
    {
      id: 'projects-teams',
      title: 'Projects & teams',
      items: [
        { heading: 'Project types', body: 'DJ / festival: shows cues with OSC/MIDI fields, Rekordbox import, and export to lighting/laser consoles. Dance / choreo: shows the formation stage and cast. General: all cue features, no OSC/formation panels.' },
        { heading: 'Cover image', body: 'Upload a JPEG, PNG, WebP, or GIF cover image from the project overview page (requires the Manage project capability).' },
        { heading: 'Teams', body: 'A team owns projects and shares them with its members. Go to Teams in the top navigation to create a team. Members inherit the project\'s default role; the team owner has full access.' },
        { heading: 'Invite members', body: 'From Project settings → Members, enter an email address to send an invite. Choose a role; roles determine what they can see and edit.' },
      ],
    },
    {
      id: 'sharing',
      title: 'Public share links',
      items: [
        { heading: 'Create a public link', body: 'Project overview → Share → Create link. Anyone with the link can view the cue sheet anonymously (read-only, no login required). Only cues marked "anon-visible" appear on the public sheet.' },
        { heading: 'Rotate or disable', body: 'Share → Rotate generates a new token (the old URL stops working). Share → Disable revokes access without deleting the cues.' },
      ],
    },
    {
      id: 'tracks-versions',
      title: 'Tracks, versions & uploads',
      items: [
        { heading: 'Versions', body: 'Each file upload creates a numbered version. The current version is the one the waveform and cues use. You can switch versions (activate/rollback) from the waveform header.' },
        { heading: 'Reprocess / regenerate', body: 'Hit "Regenerate waveform" on any ready version to re-run the full analysis pipeline (peaks + RGB waveform + BeatNet rhythm). Useful after the Python analyzer was unavailable during the first upload.' },
        { heading: 'Video tracks', body: 'Upload video files the same way as audio. The audio stream drives the waveform and cues; the video plays back synced to the waveform clock.' },
        { heading: 'Synced video panels (up to 3)', body: 'You can attach up to 3 video files to a single audio track (e.g. wide shot, close-up, aerial). Each has its own independent time offset. See the Multi-video section below.' },
      ],
    },
    {
      id: 'waveform',
      title: 'Waveform views, zoom & Follow',
      items: [
        { heading: 'Four views', body: 'Simple — indigo bars waveform. CDJ / Rekordbox — tri-band colour (red = highs, green = mids, blue = lows), matching Rekordbox\'s visual. RGB — energy-coloured waveform baked on the server (requires regenerating the waveform). Spectrogram — server-baked frequency image with a transparent waveform overlay so cues stay clickable.' },
        { heading: 'Zoom', body: 'Use the − / + buttons or the mouse wheel over the waveform to zoom. Fit fits the entire track into the visible area. The zoom level is preserved when you switch between views.' },
        { heading: 'Follow', body: 'The Follow toggle (⟳) keeps the playhead centred while the track plays. When Follow is off you can scroll the waveform freely during playback.' },
        { heading: 'Lanes strip', body: 'Toggle "Lanes" beneath the waveform to show a swim-lane strip — one row per department — with cue blocks positioned by time. The strip scrolls in sync with the waveform.' },
      ],
    },
    {
      id: 'beat-grid',
      title: 'Beat grid, BPM & meter',
      items: [
        { heading: 'Automatic detection', body: 'After upload the Python BeatNet sidecar detects BPM, time signature (meter), beats, and downbeats. The BPM and bar/beat readout appear in the transport bar once analysis is complete. Toggle the beat grid overlay in the waveform toolbar.' },
        { heading: 'Instant BPM', body: 'A lightweight in-browser BPM estimator runs immediately on upload and provides a provisional tempo before the server analysis finishes. BeatNet\'s result overwrites it automatically.' },
        { heading: 'Beat anchor', body: 'If the beat grid is slightly off, nudge the anchor (± 0.01 s) in the track toolbar to slide the grid in time.' },
        { heading: 'Downbeats', body: 'Downbeats (bar 1 of each measure) are drawn as a stronger indigo tick; regular beats are fainter. Requires BeatNet analysis.' },
      ],
    },
    {
      id: 'cues',
      title: 'Cues',
      items: [
        { heading: 'Add a cue', body: 'Double-click the waveform to drop a cue at that time. Or click "+ Add cue" in the cue list. Drag a cue marker to move it.' },
        { heading: 'Beat positioning', body: 'Every cue stores both a time (seconds) and a beat position. When BPM is detected, edit the beat field (bar.beat format) and the time is derived automatically.' },
        { heading: 'Range cues', body: 'Set an end time / end beat to make a cue span a duration (shown as a bar on the waveform and swim-lane strip).' },
        { heading: 'Status', body: 'Not started / In progress / Done / Blocked. Shown as a coloured dot. Useful for tracking production progress.' },
        { heading: 'Color', body: 'Choose an explicit colour from the 10-swatch palette, or check "Inherit" to use the department colour automatically.' },
        { heading: 'Visibility', body: 'Private — only you see it. Public read-only — others see it but only you can edit. Public shared — others can edit it too. Anon-visible — appears on the public share sheet.' },
        { heading: 'OSC output (DJ/General)', body: 'Set an OSC address and value per cue. Choose a value type (float/int/string/bool) and an automation envelope (ramp up/down, strobe, pulse). OSC data is stored for export to downstream systems (Resolume, lighting consoles) and will be transmitted by the local bridge tool.' },
        { heading: 'MIDI trigger (DJ/General)', body: 'Assign a MIDI note, channel, velocity, and trigger direction (enter / exit / both) to each cue. In Show mode the MIDI note fires as the playhead crosses the cue.' },
      ],
    },
    {
      id: 'departments',
      title: 'Departments, lanes & crew',
      items: [
        { heading: 'Departments', body: 'A department is a named, coloured group of cue lanes (e.g. Lighting, Video, FX, Sound). Create and manage them from Project settings → Departments. Each department can have a default OSC address.' },
        { heading: 'Lanes', body: 'Each department contains one or more cue lanes. Every cue belongs to a lane. New projects have one department ("Cues") with one lane ("Default").' },
        { heading: 'Department-scoped roles', body: 'From Project settings → Roles, restrict a role to only view or edit specific departments. A role with no department restrictions has access to all departments.' },
        { heading: 'Crew assignments', body: 'From Project settings → Crew, assign project members to departments. The "My cues" toggle in the track workspace filters the cue list and waveform regions to only your assigned departments.' },
      ],
    },
    {
      id: 'markers',
      title: 'Markers',
      items: [
        { heading: 'Point labels', body: 'Markers are attributed point labels — a thin tick on the waveform with a triangle cap. Add one at the current playhead position from the Markers panel. Click a marker in the list to seek to it.' },
        { heading: 'Attribution', body: 'Each marker records who created it. Rename or delete from the Markers list (your own markers or others\' if you have the Edit others\' cues capability).' },
      ],
    },
    {
      id: 'dance-mode',
      title: 'Dance mode & formations',
      items: [
        { heading: 'Enable dance mode', body: 'Set the project type to Dance from Project settings. This unlocks the Cast & stage panel, formations workspace, and the formation export formats.' },
        { heading: 'Cast', body: 'Add dancers from Project settings → Cast & stage. Each dancer has a name, a short 2-character label (displayed on the stage grid), and a colour.' },
        { heading: 'Stage', body: 'Configure stage width and depth (metres) in the Cast & stage panel. All formation coordinates are normalised (0–1) so they scale to any stage size.' },
        { heading: 'Formations', body: 'In the track workspace, scrub to a moment in the music and click "+ Formation at playhead" to snapshot dancer positions into a keyframe. The stage grid animates in real time as the track plays — dancers glide between keyframes.' },
        { heading: 'Hold range', body: 'A formation can have a hold duration: set an end time with "Hold to playhead". Dancers hold the formation between start and end, then transition to the next keyframe.' },
        { heading: 'Print sheet', body: 'Click "Print sheet" to generate a printable page showing every formation\'s stage diagram with its beat and time label.' },
      ],
    },
    {
      id: 'transport',
      title: 'Transport, loop & Show mode',
      items: [
        { heading: 'Transport controls', body: '⏮ jump to start · ⏪ previous cue · −5 s · ▶/⏸ play/pause (Space) · +5 s · ⏩ next cue · ⏹ stop.' },
        { heading: 'Bar.beat readout', body: 'The transport bar shows the current position in bar.beat format once BPM and meter are detected. Click to switch between bar.beat and clock time.' },
        { heading: 'Cue loop', body: 'Select a cue and press "Cue" in the Loop section of the transport bar to loop from that cue to the next (or +8 s for the last cue).' },
        { heading: 'Manual IN / OUT / CLR', body: 'Press IN to mark the loop start at the current playhead. Press OUT to mark the end. CLR clears the manual loop. Manual IN/OUT overrides the cue-based loop. The active loop span is shown as a shaded indigo region on the waveform.' },
        { heading: 'Show mode (MIDI)', body: 'Press "● Show" to arm live MIDI firing. As the playhead crosses each cue\'s enter or exit point, the cue\'s MIDI note is fired on the selected MIDI output. Requires Chrome or Edge (Web MIDI API) and a MIDI interface. Select the output device from the MIDI device picker.' },
      ],
    },
    {
      id: 'multi-video',
      title: 'Multi-video sync',
      items: [
        { heading: 'Syncing videos', body: 'Click "+ Sync a video to this track" to attach a video to the current track. The audio waveform is the master clock; the video is slaved to it via a drift-correction loop (dead zone 50 ms, soft playback-rate glide, hard re-seek at 250 ms drift).' },
        { heading: 'Up to 3 videos', body: 'You can attach up to 3 video files per track (e.g. wide shot, close-up, aerial). Each panel is displayed side-by-side and has its own independent sync offset.' },
        { heading: 'Sync offset', body: 'Use the −0.1 / −0.01 / +0.01 / +0.1 s nudge buttons under each video panel to dial in the correct offset. Changes save automatically.' },
        { heading: 'Remove a video', body: 'Click "Remove video" below a panel to detach it. This deletes the video file from storage.' },
      ],
    },
    {
      id: 'rekordbox',
      title: 'Rekordbox XML import',
      items: [
        { heading: 'Import', body: 'From the project overview, use "Import Rekordbox XML" (DJ and General projects only). Export your collection from Rekordbox as XML (File → Export Collection in xml format) then upload it here.' },
        { heading: 'What imports', body: 'Each track in the XML creates a project track with BPM, key, and cues. Hot cues import as shared/editable; memory cues as read-only. Loops import as range cues. Audio is not imported — upload it separately as a track version.' },
      ],
    },
    {
      id: 'export',
      title: 'Export formats',
      items: [
        { heading: 'CSV cue list', body: 'All cues across all tracks as a spreadsheet: department, lane, name, status, beat, time, end, notes, colour, OSC address/value.' },
        { heading: 'Reaper RPP', body: 'Reaper project file — one named MIDI track per department, each cue as a marker. Useful as a manual import route for other DAWs.' },
        { heading: 'Markers CSV (Resolve/Premiere)', body: 'SMPTE-formatted marker CSV for DaVinci Resolve and Premiere Pro. Maps cue name, department, and time.' },
        { heading: 'FCPXML', body: 'Final Cut Pro FCPXML 1.9 — cues as timeline markers on a gap spine. Import via File → Import → XML in Final Cut Pro.' },
        { heading: 'Console CSV (MA3/Eos/Pangolin)', body: 'Lighting and laser console cue list — cue number, name, time, OSC address/value. Compatible with grandMA3, ETC Eos, and Pangolin BEYOND.' },
        { heading: 'Formations CSV / JSON (Dance)', body: 'Dance projects only. Formations CSV: one row per dancer per formation (beat, time, x, y). Formations JSON: full structured export including stage config, dancer roster, and all tracks\' keyframes.' },
      ],
    },
    {
      id: 'roles',
      title: 'Roles & permissions',
      items: [
        { heading: 'System roles', body: 'Owner — all capabilities. Editor (default for invites) — manage project, tracks, cues, export, and create invites. Viewer — read-only.' },
        { heading: 'Custom roles', body: 'Create custom roles from Project settings → Roles. Assign any combination of capabilities.' },
        { heading: 'Capabilities', body: 'manage_project, delete_project, manage_members, manage_roles, manage_departments, manage_tracks, upload_media, manage_versions, create_cues, edit_others_cues, delete_others_cues, view_private_cues, create_invites.' },
        { heading: 'Department-scoped access', body: 'Any role can be restricted to specific departments: per-department can_view / can_edit flags. A role with no department rows has unrestricted access to all departments.' },
      ],
    },
    {
      id: 'collab',
      title: 'Realtime collaboration & presence',
      items: [
        { heading: 'Live editing', body: 'Multiple users can work on the same project simultaneously. Cue creates, edits, moves, and deletes propagate to all open sessions within ~200 ms via Socket.IO.' },
        { heading: 'Presence', body: 'The coloured avatar bar at the top of the track workspace shows who is currently viewing the project.' },
        { heading: 'Visibility-aware broadcast', body: 'Private cues are only broadcast to their owner. Changing visibility (private ↔ public) triggers compensating events so other sessions add or drop the cue correctly.' },
      ],
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      items: [
        { heading: 'Space', body: 'Play / pause.' },
        { heading: 'Double-click waveform', body: 'Add a cue at that time point.' },
      ],
    },
  ];
</script>

<svelte:head>
  <title>Help & Feature Guide — cue</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-6 py-10">
  <div class="mb-8 flex items-start justify-between">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight text-white">Help & feature guide</h1>
      <p class="mt-1 text-sm text-neutral-500">cue.mith.studio — collaborative cue-marker workspace</p>
    </div>
    <a href="/projects" class="text-sm text-neutral-500 hover:text-white">← Projects</a>
  </div>

  <!-- Table of contents -->
  <nav class="mb-10 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
    <p class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Contents</p>
    <div class="flex flex-wrap gap-x-4 gap-y-1.5">
      {#each sections as s}
        <a href="#{s.id}" class="text-sm text-indigo-400 hover:text-indigo-300">{s.title}</a>
      {/each}
    </div>
  </nav>

  <!-- Sections -->
  <div class="flex flex-col gap-8">
    {#each sections as section}
      <section id={section.id} class="rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
        <h2 class="mb-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">{section.title}</h2>
        <dl class="flex flex-col gap-4">
          {#each section.items as item}
            <div>
              <dt class="text-sm font-medium text-neutral-200">{item.heading}</dt>
              <dd class="mt-0.5 text-sm text-neutral-400">{item.body}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>

  <footer class="mt-10 border-t border-neutral-800 pt-6 text-center text-xs text-neutral-600">
    cue.mith.studio · <a href="/projects" class="hover:text-neutral-400">Back to projects</a>
  </footer>
</div>
