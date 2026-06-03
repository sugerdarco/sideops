import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { publishLog, publishStatus } from './publisher.js';
import { uploadDistToS3 } from './uploader.js';

const execFileAsync = promisify(execFile);

// streaming stdout/stderr line to redis
// reject if process exits with non zero code
function runCommand(cmd, args, cwd, projectId) {
    return new Promise((resolve, reject) => {
        const log = (line) => publishLog(projectId, line).catch(() => { });

        const child = execFile(cmd, args, { cwd, shell: false });

        child.stdout?.on('data', (chunk) =>
            chunk.toString().split('\n').filter(Boolean).forEach(log),
        );
        child.stderr?.on('data', (chunk) =>
            chunk.toString().split('\n').filter(Boolean).forEach(log),
        );

        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
        });

        child.on('error', reject);
    });
}

/** Check whether a file exists (non-throwing). */
async function exists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * read package.json and return the build script name and dist directory
 * falls back to sensible defaults if nothing is detectable
 */
function detectBuildConfig(repoDir) {
    let pkg = {};
    try {
        pkg = JSON.parse(readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
    } catch {
        // no package.json 
    }

    const scripts = pkg.scripts ?? {};
    const buildScript = ['build', 'build:prod', 'build:production'].find((s) => scripts[s]) ?? 'build';
    const distCandidates = ['dist', 'out', 'build', 'next', 'public'];

    return { buildScript, distCandidates };
}


/**
 * Full build pipeline for a project
 *
 * @param {{projectId: string, gitUrl: string}}
 */
export async function runBuild({ projectId, gitUrl }) {
    const log = (line) => publishLog(projectId, line).catch(() => { });
    let tmpDir = null;

    try {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), `sideops-${projectId}-`));
        const repoDir = path.join(tmpDir, 'repo');

        await log(`[build] starting  project=${projectId}`);
        await log(`[build] git_url=${gitUrl}`);

        await log('[build] cloning repository...');
        await runCommand(
            'git',
            ['clone', '--depth', '1', '--single-branch', gitUrl, repoDir],
            tmpDir,
            projectId,
        );
        await log('[build] clone complete');

        // detect build tool
        const { buildScript, distCandidates } = detectBuildConfig(repoDir);
        const hasYarnLock = await exists(path.join(repoDir, 'yarn.lock'));
        const hasPnpmLock = await exists(path.join(repoDir, 'pnpm-lock.yaml'));
        const hasPackageLock = await exists(path.join(repoDir, 'package-lock.json'));

        // detect which manager to use based on lockfile presence
        // pnpm and yarn must be available otherwise fall back to npm
        let pkgManager = 'npm';
        if (hasPnpmLock) pkgManager = 'pnpm';
        else if (hasYarnLock) pkgManager = 'yarn';

        await log(`[build] package manager: ${pkgManager}`);

        // install dependecies
        await log('[build] installing dependencies…');

        try {
            if (pkgManager === 'pnpm') {
                await runCommand('pnpm', ['install', '--frozen-lockfile'], repoDir, projectId);
            } else if (pkgManager === 'yarn') {
                await runCommand('yarn', ['install', '--frozen-lockfile'], repoDir, projectId);
            } else if (hasPackageLock) {
                // npm ci is faster and stricter — use it when a lockfile exists
                await runCommand('npm', ['ci', '--prefer-offline'], repoDir, projectId);
            } else {
                await runCommand('npm', ['install'], repoDir, projectId);
            }
        } catch (installErr) {
            // If frozen install fails (e.g. lockfile out of date), retry without frozen flag
            await log(`[build] frozen install failed, retrying with regular install…`);
            await runCommand('npm', ['install'], repoDir, projectId);
            pkgManager = 'npm'; // force npm for the build step too
        }
        await log('[build] install complete');

        // build 
        await log(`[build] running: ${pkgManager} run ${buildScript}`);
        await runCommand(pkgManager, ['run', buildScript], repoDir, projectId);
        await log('[build] build complete');

        // locate dist directory
        let distDir = null;
        for (const candidate of distCandidates) {
            const full = path.join(repoDir, candidate);
            if (await exists(full)) {
                distDir = full;
                break;
            }
        }

        if (!distDir) {
            throw new Error(
                `Could not find a dist directory. Tried: ${distCandidates.join(', ')}`,
            );
        }
        await log(`[build] dist directory: ${path.relative(repoDir, distDir)}`);

        //upload to S3
        await uploadDistToS3(projectId, distDir, log);

        await log('[build] ✓ deployment complete');
        await publishStatus(projectId, 'success');

    } catch (err) {
        console.error(`[builder] ERROR project=${projectId}:`, err);
        await publishLog(projectId, `[build] ✗ ERROR: ${err.message}`).catch(() => { });
        await publishStatus(projectId, 'failed').catch(() => { });
        // Re-throw so BullMQ records the failure and can retry
        throw err;
    } finally {
        // cleanup
        if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true }).catch(() => { });
        }
    }
}
