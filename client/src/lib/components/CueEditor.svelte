<script lang="ts">
  import type { Cue, CueStatus, OscValueType, Automation, TriggerOn } from '$lib/types';
  import type { Department, ProjectType } from '$lib/api';
  import { STATUS_LABEL } from '$lib/cues';
  import { formatTime, parseTimecode, formatSmpte, parseSmpte } from '$lib/utils/timecode';
  import { ui } from '$lib/stores/ui.svelte';

  let {
    cue,
    onSave,
    onClose,
    fps = 30,
    smpte = false,
    bpm = null,
    departments = [],
    projectType = 'general',
    canSetVisibility = false,
  }: {
    cue: Cue;
    onSave: (patch: Partial<Cue>) => void;
    onClose: () => void;
    fps?: number;
    smpte?: boolean;
    bpm?: number | null;
    departments?: Department[];
    projectType?: ProjectType;
    canSetVisibility?: boolean;
  } = $props();

  const PALETTE = ['#ff4444', '#fb923c', '#facc15', '#22c55e', '#22d3ee', '#6366f1', '#a855f7', '#ec4899', '#f8fafc', '#94a3b8'];

  const hasBpm = !!bpm && bpm > 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  let name = $state(cue.name);
  // Seed once at mount; `smpte`/`fps`/`bpm` are known at this point (editor is modal/per-open).
  let timeStr = $state(smpte ? formatSmpte(cue.time, fps) : formatTime(cue.time));
  // Beat-position field (Phase 2a). Editable when a BPM exists; mirrors the time
  // field both ways. Seeded from start_beat, else derived from time × bpm/60.
  let beatStr = $state(
    cue.start_beat != null ? String(round2(cue.start_beat)) : hasBpm ? String(round2(cue.time * (bpm as number) / 60)) : ''
  );
  let cueNumber = $state(cue.cue_number ?? '');
  let laneId = $state(cue.lane_id);
  let status = $state(cue.status);
  let colorInherited = $state(cue.color_inherited);
  let fade = $state(cue.fade);
  let color = $state(cue.marker_color);

  // Phase 2d — Resolume OSC + automation (store-only). Shown for dj/general
  // projects (a dance project has no use for it).
  const showOsc = projectType !== 'dance';
  const AUTOMATION_LABEL: Record<Automation, string> = {
    none: 'None', ramp_up: 'Ramp Up', ramp_down: 'Ramp Down', strobe: 'Strobe', pulse: 'Pulse',
  };
  const cueDept = departments.find((d) => d.lanes.some((l) => l.id === cue.lane_id));
  const oscAddrPlaceholder = cueDept?.default_osc_address || '/composition/layers/1/clips/1/';
  const oscValuePlaceholder = cueDept?.default_osc_value || '1';

  let oscAddress = $state(cue.osc_address ?? '');
  let oscValue = $state(cue.osc_value ?? '');
  let oscValueType = $state<OscValueType>(cue.osc_value_type);
  let automation = $state<Automation>(cue.automation);
  let advancedMode = $state(Array.isArray(cue.advanced_payload));
  const seedPayload = Array.isArray(cue.advanced_payload) ? cue.advanced_payload : [];
  let advValue = $state(seedPayload[0] ?? 1);
  let advDuration = $state(seedPayload[1] ?? 0);
  let advFade = $state(seedPayload[2] ?? 0);
  let oscOpen = $state(!!(cue.osc_address || cue.osc_value || cue.automation !== 'none' || Array.isArray(cue.advanced_payload) || cue.trigger_on !== 'none'));

  // Phase 3a — live MIDI trigger.
  const TRIGGER_LABEL: Record<TriggerOn, string> = { none: 'Off', enter: 'On enter', exit: 'On exit', both: 'On enter & exit' };
  let triggerOn = $state<TriggerOn>(cue.trigger_on);
  let midiNote = $state<number | ''>(cue.midi_note ?? '');
  let midiChannel = $state(cue.midi_channel);
  let midiVelocity = $state(cue.midi_velocity);

  // Only show the lane picker when the project actually has lanes to choose from
  // (more than the single default lane), so simple projects stay uncluttered.
  const laneCount = departments.reduce((n, d) => n + d.lanes.length, 0);
  const showLanes = laneCount > 1;

  // Phase 11b: derive selected lane info to show/hide region end-time control.
  const selectedLane = $derived(departments.flatMap((d) => d.lanes).find((l) => l.id === laneId) ?? null);
  const isRegion = $derived(selectedLane?.lane_type === 'region');
  let endTimeStr = $state(cue.end_time != null ? formatTime(cue.end_time) : '');
  function onEndTimeInput() {
    // keep the string in sync; parsed on save
  }
  let description = $state(cue.description);
  let visibility = $state(cue.visibility);
  let anonVisible = $state(cue.anon_visible);

  const timeLabel = $derived(smpte ? 'Time (SMPTE)' : 'Time (m:ss.cc)');

  // Editing the beat field drives the time field (beats are the source of truth).
  function onBeatInput() {
    if (!hasBpm) return;
    const b = Number(beatStr);
    if (!Number.isFinite(b)) return;
    const t = (b * 60) / (bpm as number);
    timeStr = smpte ? formatSmpte(t, fps) : formatTime(t);
  }
  // Editing the time field keeps the beat readout in sync.
  function onTimeInput() {
    if (!hasBpm) return;
    const t = smpte ? parseSmpte(timeStr, fps) : parseTimecode(timeStr);
    if (t != null) beatStr = String(round2(t * (bpm as number) / 60));
  }

  function save() {
    const time = smpte ? parseSmpte(timeStr, fps) : parseTimecode(timeStr);
    if (time === null) {
      ui.toast(smpte ? 'Invalid time format (use HH:MM:SS:FF)' : 'Invalid time format (use m:ss.cc)', 'error');
      return;
    }
    const patch: Partial<Cue> = {
      name: name.trim() || 'Cue',
      time,
      cue_number: cueNumber === '' ? null : Number(cueNumber),
      status,
      color_inherited: colorInherited,
      fade: Number(fade) || 0,
      marker_color: color,
      description,
    };
    // Phase 11b: region lanes carry an end time.
    if (isRegion) {
      const et = endTimeStr.trim() ? (smpte ? parseSmpte(endTimeStr, fps) : parseTimecode(endTimeStr)) : null;
      patch.end_time = et != null && et > time ? et : null;
    }
    // Send the beat coordinate too so the server stores it as canonical (it
    // re-derives time from it). Only when a BPM is known and the field is valid.
    if (hasBpm) {
      const b = Number(beatStr);
      if (Number.isFinite(b) && beatStr !== '') patch.start_beat = b;
    }
    if (showLanes && laneId && laneId !== cue.lane_id) patch.lane_id = laneId;
    if (showOsc) {
      patch.osc_address = oscAddress.trim() || null;
      patch.osc_value = oscValue.trim() || null;
      patch.osc_value_type = oscValueType;
      patch.automation = automation;
      patch.advanced_payload = advancedMode ? [Number(advValue) || 0, Number(advDuration) || 0, Number(advFade) || 0] : null;
      patch.trigger_on = triggerOn;
      patch.midi_note = midiNote === '' ? null : Number(midiNote);
      patch.midi_channel = Number(midiChannel) || 1;
      patch.midi_velocity = Number(midiVelocity) || 100;
    }
    if (canSetVisibility) {
      patch.visibility = visibility;
      patch.anon_visible = visibility === 'private' ? false : anonVisible;
    }
    onSave(patch);
  }
</script>

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" role="dialog">
  <div class="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
    <div class="flex items-center justify-between">
      <h3 class="font-medium text-white">Edit cue</h3>
      <button onclick={onClose} class="text-neutral-500 hover:text-white">✕</button>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3">
      <label class="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
        Name
        <input bind:value={name} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-400">
        {timeLabel}
        <input bind:value={timeStr} oninput={onTimeInput} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-400">
        Beat {#if !hasBpm}<span class="text-neutral-600">(no BPM yet)</span>{/if}
        <input
          bind:value={beatStr}
          oninput={onBeatInput}
          type="number"
          step="0.25"
          disabled={!hasBpm}
          placeholder={hasBpm ? '' : '—'}
          title={hasBpm ? 'Beat position — drives the time above' : 'Detect a BPM (Regenerate detailed waveform) to position by beat'}
          class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-400">
        Cue #
        <input bind:value={cueNumber} type="number" class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-400">
        Fade (s)
        <input bind:value={fade} type="number" step="0.1" class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
      </label>
      {#if isRegion}
        <label class="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
          End {timeLabel}
          <input
            bind:value={endTimeStr}
            oninput={onEndTimeInput}
            placeholder="leave blank for point marker"
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
        </label>
      {/if}
      <label class="col-span-2 flex flex-col gap-1 text-xs text-neutral-400">
        Status
        <select bind:value={status} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
          {#each Object.entries(STATUS_LABEL) as [val, label]}
            <option value={val}>{label}</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="mt-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-neutral-400">Colour</p>
        {#if showLanes}
          <label class="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-400">
            <input type="checkbox" bind:checked={colorInherited} class="accent-indigo-500" />
            Inherit from department
          </label>
        {/if}
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2 {colorInherited ? 'pointer-events-none opacity-40' : ''}">
        {#each PALETTE as c}
          <button
            onclick={() => (color = c)}
            aria-label="colour {c}"
            class="h-6 w-6 rounded-full border-2 {color === c ? 'border-white' : 'border-transparent'}"
            style="background: {c}"
          ></button>
        {/each}
        <input type="color" bind:value={color} class="h-6 w-8 cursor-pointer rounded bg-transparent" />
      </div>
    </div>

    {#if showLanes}
      <label class="mt-3 flex flex-col gap-1 text-xs text-neutral-400">
        Department · Lane
        <select bind:value={laneId} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
          {#each departments as d (d.id)}
            <optgroup label={d.name}>
              {#each d.lanes as lane (lane.id)}
                <option value={lane.id}>{d.name} · {lane.name}{lane.kind === 'automation' ? ' (auto)' : ''}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
    {/if}

    <label class="mt-3 flex flex-col gap-1 text-xs text-neutral-400">
      Notes
      <textarea bind:value={description} rows="2" class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"></textarea>
    </label>

    {#if showOsc}
      <div class="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50">
        <button
          type="button"
          onclick={() => (oscOpen = !oscOpen)}
          class="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-neutral-300"
        >
          <span>OSC output &amp; automation</span>
          <span class="text-neutral-500">{oscOpen ? '▾' : '▸'}</span>
        </button>
        {#if oscOpen}
          <div class="flex flex-col gap-3 border-t border-neutral-800 p-3">
            <label class="flex flex-col gap-1 text-xs text-neutral-400">
              Address
              <input bind:value={oscAddress} placeholder={oscAddrPlaceholder} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-indigo-500" />
            </label>
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <label class="flex flex-col gap-1 text-xs text-neutral-400">
                Value
                <input bind:value={oscValue} placeholder={oscValuePlaceholder} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
              </label>
              <label class="flex flex-col gap-1 text-xs text-neutral-400">
                Type
                <select bind:value={oscValueType} class="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500">
                  <option value="float">float</option>
                  <option value="int">int</option>
                  <option value="string">string</option>
                  <option value="bool">bool</option>
                </select>
              </label>
            </div>
            <label class="flex flex-col gap-1 text-xs text-neutral-400">
              Automation
              <select bind:value={automation} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
                {#each Object.entries(AUTOMATION_LABEL) as [val, label]}
                  <option value={val}>{label}</option>
                {/each}
              </select>
            </label>
            <label class="inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
              <input type="checkbox" bind:checked={advancedMode} class="accent-indigo-500" />
              Advanced mode — send <span class="font-mono text-neutral-400">[value, duration, fade]</span>
            </label>
            {#if advancedMode}
              <div class="grid grid-cols-3 gap-2">
                <label class="flex flex-col gap-1 text-[11px] text-neutral-500">Value<input bind:value={advValue} type="number" step="0.01" class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" /></label>
                <label class="flex flex-col gap-1 text-[11px] text-neutral-500">Duration<input bind:value={advDuration} type="number" step="0.1" class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" /></label>
                <label class="flex flex-col gap-1 text-[11px] text-neutral-500">Fade<input bind:value={advFade} type="number" step="0.1" class="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white outline-none focus:border-indigo-500" /></label>
              </div>
            {/if}
            <p class="text-[10px] text-neutral-600">OSC is stored for export &amp; the local bridge — not transmitted from here yet.</p>

            <div class="mt-1 border-t border-neutral-800 pt-3">
              <p class="mb-2 text-xs font-medium text-neutral-300">MIDI trigger <span class="text-neutral-600">(fired live in Show mode)</span></p>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex flex-col gap-1 text-xs text-neutral-400">
                  Fire
                  <select bind:value={triggerOn} class="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-white outline-none focus:border-indigo-500">
                    {#each Object.entries(TRIGGER_LABEL) as [val, label]}<option value={val}>{label}</option>{/each}
                  </select>
                </label>
                <label class="flex flex-col gap-1 text-xs text-neutral-400">
                  Note (0–127)
                  <input bind:value={midiNote} type="number" min="0" max="127" placeholder="—" disabled={triggerOn === 'none'} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50" />
                </label>
                <label class="flex flex-col gap-1 text-xs text-neutral-400">
                  Channel (1–16)
                  <input bind:value={midiChannel} type="number" min="1" max="16" disabled={triggerOn === 'none'} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50" />
                </label>
                <label class="flex flex-col gap-1 text-xs text-neutral-400">
                  Velocity
                  <input bind:value={midiVelocity} type="number" min="0" max="127" disabled={triggerOn === 'none'} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 disabled:opacity-50" />
                </label>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#if canSetVisibility}
      <div class="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
        <label class="flex flex-col gap-1 text-xs text-neutral-400">
          Visibility
          <select bind:value={visibility} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500">
            <option value="private">Private — only me</option>
            <option value="public_ro">Public read-only — others can see, only I edit</option>
            <option value="public_edit">Public shared — others can see and edit</option>
          </select>
        </label>
        {#if visibility !== 'private'}
          <label class="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" bind:checked={anonVisible} class="accent-indigo-500" />
            Show on the project's public link
          </label>
        {/if}
      </div>
    {/if}

    <div class="mt-5 flex justify-end gap-2">
      <button onclick={onClose} class="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-white">Cancel</button>
      <button onclick={save} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Save</button>
    </div>
  </div>
</div>
