import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// bullMQ required maxRetriesPerRequest = null;
export function createRedisConnection(opts = {}) {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    ...opts,
  });
}

let _subcriber = null;
// pub-sub : when connection is subscribing then it can't listen
export function getSubcriber() {
  if (!_subcriber) {
    _subcriber = createRedisConnection({ maxRetriesPerRequest: null });
    _subcriber.on("error", (err) => console.error('[redis:sub]', err.message));
  }
  return _subcriber;
}

let _client = null;
// connection for perform set/get command (not blocked) 
export function getRedisClient() {
  if (!_client) {
    _client = createRedisConnection({ maxRetriesPerRequest: 3 });
    _client.on("error", (err) => console.error('[redis:clinet]', err.message));
  }
  return _client;
}


