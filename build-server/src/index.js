import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { runBuild } from './builder.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'build-jobs';
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 2;

// ECS_TASK_MODE=true → process one job then exit (ECS re-launches per build)
// Local dev          → stay alive and process jobs continuously
const ECS_TASK_MODE = process.env.ECS_TASK_MODE === 'true';

const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

connection.on('error', (err) => console.error('[redis]', err.message));

const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
        const { projectId, gitURL } = job.data;
        console.log(`[worker] job=${job.id} project=${projectId} url=${gitURL}`);
        await runBuild({ projectId, gitUrl: gitURL });
    },
    {
        connection,
        concurrency: ECS_TASK_MODE ? 1 : CONCURRENCY,
        // Stall timeout: if the job doesn't heartbeat in 5 min it's re-queued
        stalledInterval: 30_000,
        lockDuration: 300_000,
    },
);

worker.on('completed', (job) => {
    console.log(`[worker] ✓ job=${job.id} completed`);
    if (ECS_TASK_MODE) gracefulExit(0);
});

worker.on('failed', (job, err) => {
    console.error(`[worker] ✗ job=${job?.id} failed:`, err.message);
    if (ECS_TASK_MODE) gracefulExit(1);
});

worker.on('error', (err) => console.error('[worker:error]', err));

console.log(
    `[worker] ready  queue=${QUEUE_NAME}  concurrency=${ECS_TASK_MODE ? 1 : CONCURRENCY}  ecs=${ECS_TASK_MODE}`,
);

async function gracefulExit(code) {
    console.log(`[worker] shutting down (code ${code})`);
    try {
        await worker.close();
        await connection.quit();
    } catch {
        // best effort
    }
    process.exit(code);
}

// Graceful SIGTERM / SIGINT (Docker stop, ECS drain)
process.on('SIGTERM', () => gracefulExit(0));
process.on('SIGINT', () => gracefulExit(0));
