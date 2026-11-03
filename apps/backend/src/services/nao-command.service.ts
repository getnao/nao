import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { env } from '../env';
import { logger } from '../utils/logger';
import { sandboxRuntime } from './sandbox-runtime';

const COMMAND_OUTPUT_LIMIT = 8000;
const COMMAND_LOG_UPDATE_MS = 300;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const SANDBOX_PROJECT_DIR = '/project';
const NAO_SANDBOX_IMAGE = env.APP_COMMIT === 'unknown' ? 'getnao/nao:latest' : `getnao/nao:${env.APP_COMMIT}`;

export class NaoCommandExitError extends Error {}

interface StagedProject {
	files: Map<string, number>;
	directories: Set<string>;
}

interface ProjectEntry {
	relativePath: string;
	isDirectory: boolean;
}

/**
 * The box works on a copy without `.git` entries or symlinks, and only plain files come back, so
 * nothing it writes can reach Git config, hooks or paths outside the project on the host.
 */
export async function runNaoCommandInSandbox(
	args: string[],
	projectPath: string,
	projectEnvVars: Record<string, string>,
	onOutput?: (output: string) => Promise<unknown>,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	if (!sandboxRuntime) {
		throw new Error('Project sync needs the sandbox runtime.');
	}
	const runtime = sandboxRuntime.JsBoxlite.withDefaultConfig();
	const isDocker = process.env.DOCKER === '1' || process.env.container === 'docker';
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-sync-'));
	const buffer = createOutputBuffer(onOutput);
	let kill = () => {};
	let stopBox = async () => {};
	try {
		const staged = copyProjectIn(projectPath, stagingDir);
		const box = await runtime.create({
			image: NAO_SANDBOX_IMAGE,
			cpus: 2,
			memoryMib: 2048,
			diskSizeGb: 8,
			entrypoint: ['sleep', 'infinity'],
			workingDir: SANDBOX_PROJECT_DIR,
			volumes: [{ hostPath: stagingDir, guestPath: SANDBOX_PROJECT_DIR }],
			autoRemove: true,
			autoStop: 0,
			security: { jailerEnabled: !isDocker },
		});
		stopBox = () => box.stop().catch(() => undefined);
		await box.start();
		signal?.throwIfAborted();
		const execution = await box.exec(
			'nao',
			args,
			Object.entries(projectEnvVars),
			false,
			null,
			null,
			SANDBOX_PROJECT_DIR,
		);
		kill = () => {
			void execution.kill();
		};
		signal?.addEventListener('abort', kill, { once: true });
		if (signal?.aborted) {
			kill();
		}
		const [stdout, stderr] = await Promise.all([execution.stdout(), execution.stderr()]);
		await Promise.all([readStream(stdout, buffer.capture), readStream(stderr, buffer.capture)]);
		const { exitCode } = await execution.wait();
		await buffer.flush();
		if (signal?.aborted) {
			throw new Error(`nao ${args[0]} was cancelled.`);
		}
		await stopBox();
		stopBox = async () => {};
		copyResultsBack(stagingDir, projectPath, staged);
		if (exitCode !== 0) {
			const details = buffer.details();
			throw new NaoCommandExitError(`nao ${args[0]} failed${details ? `: ${details}` : ''}`);
		}
	} finally {
		signal?.removeEventListener('abort', kill);
		void stopBox()
			.then(() => fs.rmSync(stagingDir, { recursive: true, force: true }))
			.catch(() => undefined);
	}
}

function copyProjectIn(projectPath: string, stagingDir: string): StagedProject {
	const staged: StagedProject = { files: new Map(), directories: new Set() };
	for (const { relativePath, isDirectory } of listProjectEntries(projectPath)) {
		const stagedPath = path.join(stagingDir, relativePath);
		if (isDirectory) {
			fs.mkdirSync(stagedPath);
			staged.directories.add(relativePath);
		} else {
			fs.copyFileSync(path.join(projectPath, relativePath), stagedPath);
			staged.files.set(relativePath, fs.statSync(stagedPath).mtimeMs);
		}
	}
	return staged;
}

/** Writes back only into real directories, never through a symlink, and only deletes what was staged. */
function copyResultsBack(stagingDir: string, projectPath: string, staged: StagedProject): void {
	const results = listProjectEntries(stagingDir);
	const resultPaths = new Set(results.map((entry) => entry.relativePath));
	const skippedDirectories = new Set<string>();
	for (const { relativePath, isDirectory } of results) {
		if (skippedDirectories.has(path.dirname(relativePath))) {
			skippedDirectories.add(relativePath);
			continue;
		}
		const target = fs.lstatSync(path.join(projectPath, relativePath), { throwIfNoEntry: false });
		if (isDirectory) {
			if (!target) {
				fs.mkdirSync(path.join(projectPath, relativePath));
			} else if (!target.isDirectory()) {
				skippedDirectories.add(relativePath);
			}
		} else if (!target || target.isFile()) {
			const stagedPath = path.join(stagingDir, relativePath);
			if (staged.files.get(relativePath) !== fs.statSync(stagedPath).mtimeMs) {
				fs.copyFileSync(stagedPath, path.join(projectPath, relativePath));
			}
		}
	}
	for (const relativePath of staged.files.keys()) {
		if (!resultPaths.has(relativePath)) {
			fs.rmSync(path.join(projectPath, relativePath), { force: true });
		}
	}
	const removedDirectories = [...staged.directories].filter((relativePath) => !resultPaths.has(relativePath));
	for (const relativePath of removedDirectories.sort((left, right) => right.length - left.length)) {
		removeDirectoryIfEmpty(path.join(projectPath, relativePath));
	}
}

function removeDirectoryIfEmpty(directory: string): void {
	try {
		fs.rmdirSync(directory);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
			throw error;
		}
	}
}

function listProjectEntries(root: string, relativeDir = ''): ProjectEntry[] {
	const entries: ProjectEntry[] = [];
	for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.name === '.git') {
			continue;
		}
		if (entry.isDirectory()) {
			entries.push({ relativePath, isDirectory: true }, ...listProjectEntries(root, relativePath));
		} else if (entry.isFile()) {
			entries.push({ relativePath, isDirectory: false });
		}
	}
	return entries;
}

async function readStream(stream: { next(): Promise<string | null> }, onChunk: (chunk: string) => void) {
	for (let chunk = await stream.next(); chunk !== null; chunk = await stream.next()) {
		onChunk(chunk);
	}
}

function createOutputBuffer(onOutput?: (output: string) => Promise<unknown>) {
	let output = '';
	let logUpdate: ReturnType<typeof setTimeout> | undefined;
	let pendingLogUpdate = Promise.resolve<unknown>(undefined);
	const publish = () => {
		if (!onOutput) {
			return;
		}
		const visibleOutput = toVisibleOutput(output);
		pendingLogUpdate = pendingLogUpdate
			.then(() => onOutput(visibleOutput))
			.catch((error) =>
				logger.warn(`Could not publish nao command logs: ${String(error)}`, { source: 'system' }),
			);
	};
	return {
		capture(chunk: string) {
			output = `${output}${chunk}`.slice(-COMMAND_OUTPUT_LIMIT);
			if (onOutput && !logUpdate) {
				logUpdate = setTimeout(() => {
					logUpdate = undefined;
					publish();
				}, COMMAND_LOG_UPDATE_MS);
			}
		},
		async flush() {
			clearTimeout(logUpdate);
			logUpdate = undefined;
			publish();
			await pendingLogUpdate;
		},
		details: () => toVisibleOutput(output).trim(),
	};
}

function toVisibleOutput(output: string): string {
	return output.replace(ANSI_ESCAPE_PATTERN, '').replaceAll('\r', '\n');
}
