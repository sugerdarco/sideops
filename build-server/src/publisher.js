import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let _pub = null;

function getPublisher() {
    if (!_pub) {
        _pub = new IORedis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
        });
        _pub.on('error', (err) => console.error('[redis:pub]', err.message));
    }
    return _pub;
}

/**
 * publish a single log line to the build log channell
 * @param {string} projectId
 * @param {string} line
 */
export async function publishLog(projectId, line) {
    process.stdout.write(line + '\n');
    await getPublisher().publish(
        `logs:${projectId}`,
        JSON.stringify({ type: 'log', line }),
    );
}

/**
 * Publish a terminal status event ('success' | 'failed').
 * @param {string} projectId
 * @param {'success'|'failed'} status
 */
export async function publishStatus(projectId, status) {
    console.log(`[publisher] project=${projectId} status=${status}`);
    await getPublisher().publish(
        `logs:${projectId}`,
        JSON.stringify({ type: 'status', status }),
    );
}

export async function closePublisher() {
    if (_pub) {
        await _pub.quit().catch(() => { });
        _pub = null;
    }
}