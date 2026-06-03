import { Queue } from "bullmq";
import { createRedisConnection } from "./redis.js";

let _queue = null;

export function getBuildQueue() {
  if (!_queue) {
    _queue = new Queue("build-jobs", {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      }
    });
  }
  return _queue;
}
