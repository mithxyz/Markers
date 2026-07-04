import { api } from '$lib/api';

export interface TrackVersion {
  id: string;
  track_id: string;
  version_number: number;
  label: string;
  media_filename: string | null;
  media_mime: string | null;
  media_size: number;
  media_duration: number;
  waveform_s3_key: string | null;
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed';
  error_message?: string | null;
  // Phase 11a: which stage of rhythm analysis succeeded.
  // 'full' = BPM+beats usable; 'no_rhythm' = analyzer responded but data empty;
  // 'analyzer_unreachable' = sidecar down/timed out; 'disabled' = not configured.
  analysis_status?: 'full' | 'no_rhythm' | 'analyzer_unreachable' | 'disabled' | null;
  // Analysis results (10-views: surface bpm for the track list)
  bpm?: number | null;
  meter?: string | null;
  musical_key?: string | null;
}

interface CreateVersionResponse {
  version: TrackVersion;
  uploadUrl: string;
  multipartThreshold: number;
}

/** PUT bytes directly to a presigned S3 URL, reporting progress 0..1. */
function putToS3(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
}

/**
 * Full upload flow for a new track version:
 *   1. ask server for a presigned PUT  2. upload direct to S3  3. notify server
 * Single PUT handles up to 5GB (our cap is 2GB), so no multipart needed here.
 */
export async function uploadTrackVersion(
  projectId: string,
  trackId: string,
  file: File,
  opts: { label?: string; onProgress?: (p: number) => void } = {}
): Promise<TrackVersion> {
  const { version, uploadUrl } = await api.post<CreateVersionResponse>(
    `/projects/${projectId}/tracks/${trackId}/versions`,
    { filename: file.name, mime: file.type, size: file.size, label: opts.label || '' }
  );

  await putToS3(uploadUrl, file, opts.onProgress || (() => {}));

  await api.post(`/projects/${projectId}/tracks/${trackId}/versions/${version.id}/complete`, {});
  return { ...version, status: 'processing' };
}

/** Upload a project cover image (Phase 4a): presign → PUT to S3 → complete. */
export async function uploadProjectImage(
  projectId: string,
  file: File,
  opts: { onProgress?: (p: number) => void } = {}
): Promise<string> {
  const { uploadUrl } = await api.post<{ uploadUrl: string; s3Key: string }>(
    `/projects/${projectId}/image`,
    { filename: file.name, mime: file.type, size: file.size }
  );
  await putToS3(uploadUrl, file, opts.onProgress || (() => {}));
  const { imageUrl } = await api.post<{ imageUrl: string }>(`/projects/${projectId}/image/complete`, {});
  return imageUrl;
}

/** Phase 8d: upload a per-dancer avatar image. Returns the presigned display URL. */
export async function uploadDancerImage(
  projectId: string,
  dancerId: string,
  file: File,
  opts: { onProgress?: (p: number) => void } = {}
): Promise<string> {
  const { uploadUrl, key } = await api.post<{ uploadUrl: string; key: string }>(
    `/projects/${projectId}/dancers/${dancerId}/image`,
    { contentType: file.type }
  );
  await putToS3(uploadUrl, file, opts.onProgress || (() => {}));
  const { imageUrl } = await api.post<{ imageUrl: string }>(
    `/projects/${projectId}/dancers/${dancerId}/image/complete`,
    { key }
  );
  return imageUrl;
}

interface CreateVideoResponse {
  video: { id: string };
  uploadUrl: string;
}

/** Upload a synced video layer. `duration` is read client-side and sent on complete. */
export async function uploadVideoLayer(
  projectId: string,
  trackId: string,
  file: File,
  opts: { duration?: number; onProgress?: (p: number) => void } = {}
): Promise<string> {
  const { video, uploadUrl } = await api.post<CreateVideoResponse>(
    `/projects/${projectId}/tracks/${trackId}/video`,
    { filename: file.name, mime: file.type, size: file.size }
  );
  await putToS3(uploadUrl, file, opts.onProgress || (() => {}));
  await api.post(`/projects/${projectId}/tracks/${trackId}/video/${video.id}/complete`, {
    duration: opts.duration || 0,
  });
  return video.id;
}
