import path from 'node:path';

/** S3 key layout. Version media is path-isolated so old files are never
 *  overwritten — this is what makes rollback real. */
export const keys = {
  versionMedia: (projectId, trackId, versionId, ext) =>
    `projects/${projectId}/tracks/${trackId}/versions/${versionId}/media/file${ext}`,
  versionWebMedia: (projectId, trackId, versionId) =>
    `projects/${projectId}/tracks/${trackId}/versions/${versionId}/media/web.wav`,
  versionPeaks: (projectId, trackId, versionId) =>
    `projects/${projectId}/tracks/${trackId}/versions/${versionId}/peaks/peaks.json`,
  versionWaveformRgb: (projectId, trackId, versionId) =>
    `projects/${projectId}/tracks/${trackId}/versions/${versionId}/peaks/waveform-rgb.json`,
  versionSpectrogram: (projectId, trackId, versionId) =>
    `projects/${projectId}/tracks/${trackId}/versions/${versionId}/artifacts/spectrogram.png`,
  videoMedia: (projectId, videoLayerId, ext) =>
    `projects/${projectId}/video/${videoLayerId}/media/file${ext}`,
  videoFilmstrip: (projectId, videoLayerId) =>
    `projects/${projectId}/video/${videoLayerId}/artifacts/filmstrip.png`,
  projectImage: (projectId, ext) =>
    `projects/${projectId}/image/cover${ext}`,
  dancerImage: (projectId, dancerId, ext) =>
    `projects/${projectId}/dancers/${dancerId}/image/avatar${ext}`,
};

/** Safe file extension from a user-supplied filename (incl. dot, lowercase). */
export function safeExt(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

export default keys;
