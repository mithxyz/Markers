import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const required = (key, fallback) => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3017', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:3017',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3017')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  sessionSecret: required('SESSION_SECRET', 'dev-secret'),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5441', 10),
    database: process.env.DB_NAME || 'markers',
    user: process.env.DB_USER || 'markers',
    password: process.env.DB_PASSWORD || 'markers_dev',
  },

  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6381', 10),
  },

  s3: {
    region: process.env.S3_REGION || 'ap-southeast-4',
    bucket: process.env.S3_BUCKET || 'cue-markers',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
  },

  // Local Postfix relay (mith.studio is SPF+DKIM configured on this VPS).
  smtp: {
    host: process.env.SMTP_HOST || '127.0.0.1',
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    from: process.env.MAIL_FROM || 'noreply@mith.studio',
  },

  ses: {
    // Retained only for the optional dev console-log fallback flag.
    logLinks: process.env.MAGIC_LINK_LOG === 'true',
  },

  upload: {
    maxBytes: parseInt(process.env.MAX_UPLOAD_BYTES || '2147483648', 10),
    multipartThreshold: parseInt(process.env.MULTIPART_THRESHOLD || '104857600', 10),
  },

  // Python analyzer sidecar (BeatNet beat/downbeat detection, later section
  // detection). Empty/unset => the worker skips rhythm analysis (best-effort).
  analyzer: {
    url: process.env.ANALYZER_URL || '',
    timeoutMs: parseInt(process.env.ANALYZER_TIMEOUT_MS || '600000', 10),
  },
};

export default config;
