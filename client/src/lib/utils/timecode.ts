/** Seconds -> m:ss.cc (e.g. 83.5 -> "1:23.50"). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds - Math.floor(seconds)) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

/** Parse "m:ss.cc" | "ss.cc" | "mm:ss" -> seconds. Returns null if unparseable. */
export function parseTimecode(input: string): number | null {
  const str = String(input).trim();
  if (!str) return null;
  if (/^\d*\.?\d+$/.test(str)) return parseFloat(str);
  const m = str.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    const mins = parseInt(m[1], 10);
    const secs = parseFloat(m[2]);
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }
  return null;
}

/**
 * Snap a time in seconds to the nearest frame boundary for the given fps.
 * Returns the input unchanged if fps is not a positive finite number.
 */
export function snapToFrame(seconds: number, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return seconds;
  return Math.round(seconds * fps) / fps;
}

/**
 * Whether a frame rate is treated as drop-frame.
 * 29.97 and 59.94 are drop-frame; everything else (incl. 23.976) is non-drop.
 */
function isDropFrame(fps: number): boolean {
  return Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - 59.94) < 0.01;
}

const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * Seconds -> SMPTE timecode "HH:MM:SS:FF" (non-drop) or "HH:MM:SS;FF" (drop-frame).
 *
 * Drop-frame (29.97 / 59.94) uses the standard algorithm: each minute, drop
 * `dropPerMin` frame numbers (2 per 30fps unit -> 2 for 29.97, 4 for 59.94),
 * except on every 10th minute. Math is done entirely in total-frame-number
 * space for correctness. 23.976 uses a 24-frame nominal non-drop count.
 * Negative / NaN -> "00:00:00:00".
 */
export function formatSmpte(seconds: number, fps: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(fps) || fps <= 0) {
    return '00:00:00:00';
  }

  const drop = isDropFrame(fps);
  const nominalFps = Math.round(fps);
  const sep = drop ? ';' : ':';

  // Total frame number, computed at the *actual* timebase, then rounded.
  const frameNumber = Math.round(seconds * fps);

  let frames: number;
  let secs: number;
  let mins: number;
  let hours: number;

  if (!drop) {
    frames = frameNumber % nominalFps;
    let totalSeconds = Math.floor(frameNumber / nominalFps);
    secs = totalSeconds % 60;
    totalSeconds = Math.floor(totalSeconds / 60);
    mins = totalSeconds % 60;
    hours = Math.floor(totalSeconds / 60);
  } else {
    // Drop-frame: convert a real frame number to a nominal timecode counter
    // value using the standard (Heidelberger) algorithm, then split into fields.
    const dropPerMin = (nominalFps / 30) * 2; // 2 for 30, 4 for 60
    const framesPerMin = nominalFps * 60 - dropPerMin; // frames in a *short* minute
    const framesPer10Min = nominalFps * 60 * 10 - dropPerMin * 9; // real frames in 10 min

    const d = Math.floor(frameNumber / framesPer10Min); // whole 10-min blocks
    const m = frameNumber % framesPer10Min;

    let counter = frameNumber;
    if (m > dropPerMin) {
      counter +=
        dropPerMin * 9 * d + dropPerMin * Math.floor((m - dropPerMin) / framesPerMin);
    } else {
      counter += dropPerMin * 9 * d;
    }

    // `counter` is now the nominal frame count (the displayed timecode value).
    frames = counter % nominalFps;
    let totalSeconds = Math.floor(counter / nominalFps);
    secs = totalSeconds % 60;
    totalSeconds = Math.floor(totalSeconds / 60);
    mins = totalSeconds % 60;
    hours = Math.floor(totalSeconds / 60);
  }

  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}${sep}${pad2(frames)}`;
}

/**
 * SMPTE timecode string -> seconds. Inverse of `formatSmpte`.
 * Accepts ':' or ';' as the frame separator, and the forms
 * "HH:MM:SS:FF", "MM:SS:FF" and "SS:FF".
 * Returns null if unparseable or any field is out of range (frames >= nominalFps).
 */
export function parseSmpte(input: string, fps: number): number | null {
  if (!Number.isFinite(fps) || fps <= 0) return null;
  const str = String(input).trim();
  if (!str) return null;

  // Split on ':' or ';' (frame separator may be either).
  const parts = str.split(/[:;]/);
  if (parts.length < 2 || parts.length > 4) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const nums = parts.map((p) => parseInt(p, 10));
  let hours = 0;
  let mins = 0;
  let secs = 0;
  let frames = 0;

  if (nums.length === 4) {
    [hours, mins, secs, frames] = nums;
  } else if (nums.length === 3) {
    [mins, secs, frames] = nums;
  } else {
    [secs, frames] = nums;
  }

  const nominalFps = Math.round(fps);
  if (frames >= nominalFps || secs >= 60 || mins >= 60) return null;

  const drop = isDropFrame(fps);

  if (!drop) {
    const totalFrames = ((hours * 60 + mins) * 60 + secs) * nominalFps + frames;
    return totalFrames / fps;
  }

  // Drop-frame: convert the nominal timecode counter value to a real frame number.
  const dropPerMin = (nominalFps / 30) * 2;
  const totalMinutes = hours * 60 + mins;
  const nominalFrames = ((hours * 60 + mins) * 60 + secs) * nominalFps + frames;
  // Subtract the frames that were dropped for every minute except every 10th.
  const droppedFrames = dropPerMin * (totalMinutes - Math.floor(totalMinutes / 10));
  const realFrames = nominalFrames - droppedFrames;
  return realFrames / fps;
}
