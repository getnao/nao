import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { env } from '../env';
import { logger } from '../utils/logger';
import { extractRepoTargetFolders } from '../utils/nao-config';
import { sandboxRuntime } from './sandbox-runtime';
import { resolveSyncOutboundPolicy } from './sync-egress-policy';

const COMMAND_OUTPUT_LIMIT = 8000;
const COMMAND_LOG_UPDATE_MS = 300;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const SANDBOX_PROJECT_DIR = '/project';
const NAO_SANDBOX_IMAGE = env.APP_COMMIT === 'unknown' ? 'getnao/nao:latest' : `getnao/nao:${env.APP_COMMIT}`;
const HOUR_MS = 60 * 60 * 1000;
const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const SYNC_OUTPUT_ROOTS = [
	'databases',
	'repos',
	'semantics',
	path.join('docs', 'notion'),
	path.join('docs', 'confluence'),
	path.join('docs', 'obsidian'),
];

export class NaoCommandExitError extends Error {}
export class NaoCommandTimeoutError extends Error {}
export class NaoCommandOutputLimitError extends Error {}

interface StagedProject {
	files: Map<string, number>;
	directories: Set<string>;
	templateOutputs: Set<string>;
	outputRoots: string[];
}

interface ProjectEntry {
	relativePath: string;
	isDirectory: boolean;
}

/**
 * The box works on a copy inside its size-limited disk without `.git` entries or symlinks, and only
 * expected plain-file outputs come back, so writes cannot reach the host project while it runs.
 */
export async function runNaoCommandInSandbox(
	args: string[],
	projectPath: string,
	projectEnvVars: Record<string, string>,
	onOutput?: (output: string) => Promise<unknown>,
	signal?: AbortSignal,
	projectId?: string,
): Promise<void> {
	signal?.throwIfAborted();
	if (!sandboxRuntime) {
		throw new Error('Project sync needs the sandbox runtime.');
	}
	const buffer = createOutputBuffer(onOutput);
	await buffer.addLine('Checking sync connections.');
	const outboundPolicy = await resolveSyncOutboundPolicy(projectPath, projectEnvVars, {
		approvedPrivateWarehouseHosts: projectId ? env.NAO_SYNC_APPROVED_PRIVATE_WAREHOUSE_HOSTS[projectId] : undefined,
		blockedInfrastructureHosts: deploymentInfrastructureHosts(),
	});
	const runtime = sandboxRuntime.JsBoxlite.withDefaultConfig();
	const isDocker = process.env.DOCKER === '1' || process.env.container === 'docker';
	const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-sync-'));
	const maxFileSizeBytes = env.NAO_SYNC_MAX_FILE_SIZE_MB * MEBIBYTE;
	let kill = () => {};
	let stopBox = async () => {};
	let timedOut = false;
	const maxRuntimeMs = env.NAO_MODE === 'cloud' ? env.NAO_SYNC_MAX_RUNTIME_HOURS * HOUR_MS : null;
	const runtimeTimer =
		maxRuntimeMs === null
			? undefined
			: setTimeout(() => {
					timedOut = true;
					kill();
				}, maxRuntimeMs);
	runtimeTimer?.unref();
	const throwIfStopped = () => {
		if (timedOut) {
			throw new NaoCommandTimeoutError(
				`nao ${args[0]} exceeded the cloud runtime limit of ${env.NAO_SYNC_MAX_RUNTIME_HOURS} hours.`,
			);
		}
		if (signal?.aborted) {
			throw new Error(`nao ${args[0]} was cancelled.`);
		}
	};
	try {
		await buffer.addLine('Preparing project files.');
		const staged = copyProjectIn(projectPath, stagingDir, projectEnvVars);
		await buffer.addLine('Preparing the secure sync environment. The first run may take a few minutes.');
		const box = await runtime.create({
			image: NAO_SANDBOX_IMAGE,
			cpus: 2,
			memoryMib: 2048,
			diskSizeGb: env.NAO_SYNC_MAX_OUTPUT_SIZE_GB,
			entrypoint: ['sleep', 'infinity'],
			workingDir: '/',
			autoRemove: true,
			autoStop: 0,
			network: { outbound: outboundPolicy, inbound: { mode: 'disabled' } },
			security: { jailerEnabled: !isDocker, maxFileSize: maxFileSizeBytes },
		});
		stopBox = () => box.stop().catch(() => undefined);
		throwIfStopped();
		await box.start();
		throwIfStopped();
		await buffer.addLine('Copying the project into the secure sync environment.');
		await box.copyIn(stagingDir, SANDBOX_PROJECT_DIR, {
			recursive: true,
			overwrite: true,
			followSymlinks: false,
			includeParent: false,
		});
		throwIfStopped();
		await buffer.addLine('Starting nao sync...');
		const execution = await box.exec(
			'nao',
			args,
			Object.entries({ ...projectEnvVars, POSTHOG_DISABLED: 'true' }),
			false,
			null,
			null,
			SANDBOX_PROJECT_DIR,
		);
		kill = () => {
			void execution.kill();
		};
		throwIfStopped();
		signal?.addEventListener('abort', kill, { once: true });
		if (signal?.aborted) {
			kill();
		}
		const [stdout, stderr] = await Promise.all([execution.stdout(), execution.stderr()]);
		await Promise.all([readStream(stdout, buffer.capture), readStream(stderr, buffer.capture)]);
		const { exitCode } = await execution.wait();
		await buffer.flush();
		throwIfStopped();
		fs.rmSync(stagingDir, { recursive: true, force: true });
		fs.mkdirSync(stagingDir);
		await box.copyOut(SANDBOX_PROJECT_DIR, stagingDir, {
			recursive: true,
			overwrite: true,
			followSymlinks: false,
			includeParent: false,
		});
		throwIfStopped();
		await stopBox();
		stopBox = async () => {};
		throwIfStopped();
		copyResultsBack(stagingDir, projectPath, staged);
		if (exitCode !== 0) {
			const details = buffer.details();
			throw new NaoCommandExitError(`nao ${args[0]} failed${details ? `: ${details}` : ''}`);
		}
	} finally {
		clearTimeout(runtimeTimer);
		signal?.removeEventListener('abort', kill);
		await stopBox();
		fs.rmSync(stagingDir, { recursive: true, force: true });
	}
}

function deploymentInfrastructureHosts(): string[] {
	return [env.BETTER_AUTH_URL, env.MCP_PUBLIC_URL, env.DB_URI, env.REDIS_URL].flatMap((value) => {
		if (!value || value.startsWith('sqlite:')) {
			return [];
		}
		try {
			return [new URL(value).hostname];
		} catch {
			return [];
		}
	});
}

function copyProjectIn(projectPath: string, stagingDir: string, projectEnvVars: Record<string, string>): StagedProject {
	const staged: StagedProject = {
		files: new Map(),
		directories: new Set(),
		templateOutputs: new Set(),
		outputRoots: [
			...SYNC_OUTPUT_ROOTS,
			...extractRepoTargetFolders(projectPath, projectEnvVars).map((target) => target.split('/').join(path.sep)),
		],
	};
	for (const { relativePath, isDirectory } of listProjectEntries(projectPath)) {
		const stagedPath = path.join(stagingDir, relativePath);
		if (isDirectory) {
			fs.mkdirSync(stagedPath);
			staged.directories.add(relativePath);
		} else {
			fs.copyFileSync(path.join(projectPath, relativePath), stagedPath);
			staged.files.set(relativePath, fs.statSync(stagedPath).mtimeMs);
			if (relativePath.endsWith('.j2')) {
				const outputPath = relativePath.slice(0, -3);
				if (outputPath) {
					staged.templateOutputs.add(outputPath);
				}
			}
		}
	}
	return staged;
}

/** Writes back only expected sync outputs into real directories, never through a symlink. */
function copyResultsBack(stagingDir: string, projectPath: string, staged: StagedProject): void {
	const results = listProjectEntries(stagingDir);
	const allowedResults = results.filter((entry) =>
		entry.isDirectory
			? isAllowedCopyBackDirectory(entry.relativePath, staged)
			: isAllowedCopyBackFile(entry.relativePath, staged),
	);
	assertSyncOutputWithinLimits(stagingDir, allowedResults);
	const resultFiles = new Set(
		allowedResults.filter((entry) => !entry.isDirectory).map((entry) => entry.relativePath),
	);
	const resultDirectories = new Set(
		allowedResults.filter((entry) => entry.isDirectory).map((entry) => entry.relativePath),
	);
	for (const relativePath of staged.files.keys()) {
		if (isAllowedCopyBackFile(relativePath, staged) && !resultFiles.has(relativePath)) {
			fs.rmSync(path.join(projectPath, relativePath), { force: true });
		}
	}
	const removedDirectories = [...staged.directories].filter(
		(relativePath) => isAllowedCopyBackDirectory(relativePath, staged) && !resultDirectories.has(relativePath),
	);
	for (const relativePath of removedDirectories.sort((left, right) => right.length - left.length)) {
		removeDirectoryIfEmpty(path.join(projectPath, relativePath));
	}
	const skippedDirectories = new Set<string>();
	for (const { relativePath, isDirectory } of allowedResults) {
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
		} else if (!target || (target.isFile() && target.nlink === 1)) {
			const stagedPath = path.join(stagingDir, relativePath);
			if (staged.files.get(relativePath) !== fs.statSync(stagedPath).mtimeMs) {
				fs.copyFileSync(stagedPath, path.join(projectPath, relativePath));
			}
		}
	}
}

function assertSyncOutputWithinLimits(stagingDir: string, results: ProjectEntry[]): void {
	const files = results.filter((entry) => !entry.isDirectory);
	if (files.length > env.NAO_SYNC_MAX_OUTPUT_FILES) {
		throw new NaoCommandOutputLimitError(
			`Sync produced ${files.length} output files, exceeding the limit of ${env.NAO_SYNC_MAX_OUTPUT_FILES}.`,
		);
	}
	let totalBytes = 0;
	const maxFileSizeBytes = env.NAO_SYNC_MAX_FILE_SIZE_MB * MEBIBYTE;
	for (const { relativePath } of files) {
		const size = fs.statSync(path.join(stagingDir, relativePath)).size;
		if (size > maxFileSizeBytes) {
			throw new NaoCommandOutputLimitError(
				`Sync output "${relativePath}" exceeds the ${env.NAO_SYNC_MAX_FILE_SIZE_MB} MB file-size limit.`,
			);
		}
		totalBytes += size;
	}
	const maxOutputBytes = env.NAO_SYNC_MAX_OUTPUT_SIZE_GB * GIBIBYTE;
	if (totalBytes > maxOutputBytes) {
		throw new NaoCommandOutputLimitError(
			`Sync produced more than the ${env.NAO_SYNC_MAX_OUTPUT_SIZE_GB} GB total-output limit.`,
		);
	}
}

function isAllowedCopyBackFile(relativePath: string, staged: StagedProject): boolean {
	return (
		staged.outputRoots.some((root) => relativePath.startsWith(`${root}${path.sep}`)) ||
		staged.templateOutputs.has(relativePath)
	);
}

function isAllowedCopyBackDirectory(relativePath: string, staged: StagedProject): boolean {
	return (
		staged.outputRoots.some(
			(root) =>
				relativePath === root ||
				relativePath.startsWith(`${root}${path.sep}`) ||
				root.startsWith(`${relativePath}${path.sep}`),
		) || [...staged.templateOutputs].some((output) => output.startsWith(`${relativePath}${path.sep}`))
	);
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
	let commandOutput = '';
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
		async addLine(message: string) {
			output = `${output}${message}\n`.slice(-COMMAND_OUTPUT_LIMIT);
			clearTimeout(logUpdate);
			logUpdate = undefined;
			publish();
			await pendingLogUpdate;
		},
		capture(chunk: string) {
			commandOutput = `${commandOutput}${chunk}`.slice(-COMMAND_OUTPUT_LIMIT);
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
		details: () => toVisibleOutput(commandOutput).trim(),
	};
}

function toVisibleOutput(output: string): string {
	return output.replace(ANSI_ESCAPE_PATTERN, '').replaceAll('\r', '\n');
}
