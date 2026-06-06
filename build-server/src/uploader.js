import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import mime from 'mime-types';

const s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});
const BUCKET = process.env.S3_BUCKET;

/**
 * Recursively collect all files under a directory.
 * @param {string} dir
 * @returns {Promise<string[]>} absolute paths
 */
async function collectFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const full = path.join(dir, entry.name);
            return entry.isDirectory() ? collectFiles(full) : [full];
        }),
    );
    return files.flat();
}

/**
 * Upload every file in distDir to S3 under /<projectId>/dist/<relative-path>.
 * Files are streamed directly — never buffered in memory.
 *
 * @param {string} projectId
 * @param {string} distDir   absolute path to the dist folder
 * @param {(msg: string) => void} log  logging callback
 */
export async function uploadDistToS3(projectId, distDir, log) {
    if (!BUCKET) throw new Error('S3_BUCKET env var is not set');

    const files = await collectFiles(distDir);

    if (files.length === 0) {
        throw new Error(`dist directory is empty: ${distDir}`);
    }

    log(`[s3] uploading ${files.length} files → s3://${BUCKET}/${projectId}/dist/`);

    await Promise.all(
        files.map(async (filePath) => {
            const relative = path.relative(distDir, filePath);
            const key = `${projectId}/dist/${relative}`;
            const contentType = mime.lookup(filePath) || 'application/octet-stream';

            const upload = new Upload({
                client: s3,
                params: {
                    Bucket: BUCKET,
                    Key: key,
                    Body: createReadStream(filePath),
                    ContentType: contentType,
                },
                // Stream in 5 MB chunks; never holds the whole file in memory
                partSize: 5 * 1024 * 1024,
            });

            await upload.done();
            log(`[s3] ✓ ${key}`);
        }),
    );

    log(`[s3] upload complete`);
}
