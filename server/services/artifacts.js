import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Hard cap on the number of frames (columns) in a single horizontal strip.
// Keeps the output PNG width bounded regardless of clip length.
const MAX_COLS = 600;

/**
 * Generate a horizontal video filmstrip PNG (thumbnails tiled left→right).
 *
 * Sampling: aim for ~1 frame/second, but never exceed MAX_COLS columns. For
 * clips longer than MAX_COLS seconds we lower the fps so the column count stays
 * capped (fps = MAX_COLS / duration), keeping a constant-width strip.
 *
 * ffmpeg builds the whole strip in one pass via the `tile` filter:
 *   fps=<fps>            → sample frames at the chosen rate
 *   scale=-1:<frameH>    → scale each frame to frameHeight, width auto (keep AR)
 *   tile=<cols>x1        → lay them out as a single horizontal row
 *
 * @param {string} videoPath   local path to the source video
 * @param {string} outPng      local path to write the strip PNG
 * @param {object} opts
 * @param {number} opts.duration     clip duration in seconds
 * @param {number} [opts.frameHeight=90] thumbnail height in px (width keeps AR)
 * @returns {Promise<{cols:number, fps:number, frameW:number, frameH:number}>}
 */
export async function generateFilmstrip(videoPath, outPng, { duration, frameHeight = 90 }) {
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`generateFilmstrip: invalid duration ${duration}`);
  }

  // ~1 frame/sec by default; drop the rate for long clips to honour MAX_COLS.
  let fps = 1;
  let cols = Math.min(Math.ceil(dur * fps), MAX_COLS);
  if (dur > MAX_COLS) {
    fps = MAX_COLS / dur; // < 1 fps → ~MAX_COLS frames total
    cols = MAX_COLS;
  }

  const vf = `fps=${fps},scale=-1:${frameHeight},tile=${cols}x1`;
  // -frames:v 1 → the tile filter emits a single packed frame (the whole strip).
  await execFileP(
    'ffmpeg',
    ['-y', '-i', videoPath, '-vf', vf, '-frames:v', '1', outPng],
    { timeout: 300000 }
  );

  // Probe the rendered strip to learn its real pixel width, then derive the
  // per-frame width (strip is exactly `cols` frames wide with no padding).
  const { stdout } = await execFileP(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      outPng,
    ],
    { timeout: 60000 }
  );
  const stripW = parseInt(String(stdout).trim(), 10) || 0;
  const frameW = cols > 0 ? Math.round(stripW / cols) : stripW;

  return { cols, fps, frameW, frameH: frameHeight };
}

/**
 * Generate a static spectrogram PNG (Tier 3) for a media file.
 *
 * Renders the whole clip in one ffmpeg pass via the `showspectrumpic` filter:
 *   s=<width>x<height>  → output image size
 *   legend=0            → drop the axis/legend chrome (raw spectrum only)
 *   scale=log           → logarithmic magnitude (intensity) scale
 *   color=intensity     → intensity colour map
 *   fscale=log          → logarithmic frequency (vertical) axis
 *
 * Throws on ffmpeg failure so the caller can decide whether it's fatal.
 *
 * @param {string} mediaPath  local path to the source audio/video
 * @param {string} outPng     local path to write the spectrogram PNG
 * @param {object} [opts]
 * @param {number} [opts.width=2048]  output width in px
 * @param {number} [opts.height=512]  output height in px
 * @returns {Promise<void>}
 */
export async function generateSpectrogram(mediaPath, outPng, { width = 2048, height = 512 } = {}) {
  const lavfi = `showspectrumpic=s=${width}x${height}:legend=0:scale=log:color=intensity:fscale=log`;
  await execFileP(
    'ffmpeg',
    ['-y', '-i', mediaPath, '-lavfi', lavfi, outPng],
    { timeout: 300000 }
  );
}

export default { generateFilmstrip, generateSpectrogram };
