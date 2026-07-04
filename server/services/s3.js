import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

// requestChecksumCalculation: 'WHEN_REQUIRED' is required — newer SDK defaults
// add checksum headers that break presigned PUT (carried forward from v2).
export const s3 = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const BUCKET = config.s3.bucket;

/** Presigned PUT for direct browser → S3 upload. */
export function presignPut(key, contentType, expiresIn = 3600) {
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/** Presigned GET for direct browser ← S3 download. */
export function presignGet(key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn });
}

/** Confirm an object exists and return its real size/type. */
export async function headObject(key) {
  const out = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return { size: Number(out.ContentLength || 0), contentType: out.ContentType };
}

/** Upload a buffer/stream directly (used by the worker for peaks JSON). */
export async function putObject(key, body, contentType) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
  return key;
}

export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/** Stream an S3 object to a local file (used by the worker, never buffers). */
export async function downloadToFile(key, destPath) {
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  await pipeline(out.Body, createWriteStream(destPath));
  return destPath;
}

export { BUCKET };
