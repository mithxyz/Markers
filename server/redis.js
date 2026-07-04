import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { config } from './config.js';

// BullMQ requires maxRetriesPerRequest: null on its connection.
export function makeRedisConnection() {
  return new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
  });
}

export const MEDIA_QUEUE = 'process-media';

// Shared queue handle for the web process to enqueue jobs.
let _queue = null;
export function getMediaQueue() {
  if (!_queue) {
    _queue = new Queue(MEDIA_QUEUE, { connection: makeRedisConnection() });
  }
  return _queue;
}

export default { makeRedisConnection, getMediaQueue, MEDIA_QUEUE };
