import { executeSandboxedCode as schemas } from '@nao/shared/tools';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { QueryResult } from '../../types/tools';
import { createTool, shouldExcludeEntry } from '../../utils/tools';

let boxliteModule: typeof import('@boxlite-ai/boxlite') | null = null;
try {
	boxliteModule = await import('@boxlite-ai/boxlite');
} catch {
	console.warn('⚠ @boxlite-ai/boxlite native binding not available — execute_sandboxed_code tool disabled');
}

const WORKING_DIR = '/root';
const SANDBOX_TTL_MS = 5 * 60 * 1000;

type CodeBox = InstanceType<NonNullable<typeof boxliteModule>['CodeBox']>;

interface PooledSandbox {
	box: CodeBox;
	timeout: ReturnType<typeof setTimeout>;
}

const sandboxPool = new Map<string, PooledSandbox>();

function evictSandbox(id: string) {
	const entry = sandboxPool.get(id);
	if (!entry) {
		return;
	}
	clearTimeout(entry.timeout);
	sandboxPool.delete(id);
	// Do NOT call box.stop() — boxlite v0.3.0 has a bug where stopping a box
	// corrupts the runtime, causing all subsequent box creations to fail with
	// "received unexpected message: InitReady, expected: IntermediateReady(0)".
	// The runtime will clean up the VM resources when the box is GC'd.
}

function resetSandboxTTL(id: string) {
	const entry = sandboxPool.get(id);
	if (!entry) {
		return;
	}
	clearTimeout(entry.timeout);
	entry.timeout = setTimeout(() => evictSandbox(id), SANDBOX_TTL_MS);
}

function registerSandbox(box: CodeBox): string {
	const id = `sbx_${crypto.randomBytes(6).toString('hex')}`;
	const timeout = setTimeout(() => evictSandbox(id), SANDBOX_TTL_MS);
	sandboxPool.set(id, { box, timeout });
	return id;
}

function queryResultToCsv({ columns, data }: QueryResult): string {
	const escapeCsvValue = (val: unknown): string => {
		if (val === null || val === undefined) {
			return '';
		}
		const str = String(val);
		if (str.includes(',') || str.includes('"') || str.includes('\n')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	};

	const header = columns.map(escapeCsvValue).join(',');
	const rows = data.map((row) => columns.map((col) => escapeCsvValue(row[col])).join(','));
	return [header, ...rows].join('\n');
}

async function getOrCreateSandbox(
	sandboxId: string | undefined,
	image: string,
	vmSize: schemas.VmSize,
): Promise<{ id: string; box: CodeBox; reused: boolean }> {
	if (sandboxId) {
		const existing = sandboxPool.get(sandboxId);
		if (existing) {
			resetSandboxTTL(sandboxId);
			return { id: sandboxId, box: existing.box, reused: true };
		}
	}

	const { CodeBox: CodeBoxClass } = boxliteModule!;
	const resources = schemas.VM_SIZE_SPECS[vmSize];

	const isDocker = process.env.DOCKER === '1' || process.env.container === 'docker';
	const box = new CodeBoxClass({
		image,
		...resources,
		workingDir: WORKING_DIR,
		security: {
			networkEnabled: true,
			jailerEnabled: !isDocker,
		},
	});

	const id = registerSandbox(box);
	return { id, box, reused: false };
}

const CONTEXT_DIR = `${WORKING_DIR}/context`;

async function copyProjectToSandbox(box: CodeBox, projectFolder: string, tmpDir: string): Promise<void> {
	const walkDir = (dir: string, relativeDir: string): void => {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (shouldExcludeEntry(entry.name, relativeDir, projectFolder)) {
				continue;
			}
			const fullPath = path.join(dir, entry.name);
			const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walkDir(fullPath, relativePath);
			} else if (entry.isFile()) {
				const tmpPath = path.join(tmpDir, 'context', relativePath);
				fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
				fs.copyFileSync(fullPath, tmpPath);
			}
		}
	};

	walkDir(projectFolder, '');

	const contextTmpDir = path.join(tmpDir, 'context');
	if (!fs.existsSync(contextTmpDir)) {
		return;
	}

	const copyFiles = (dir: string, sandboxDir: string): Promise<void>[] => {
		const promises: Promise<void>[] = [];
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			const sandboxPath = `${sandboxDir}/${entry.name}`;
			if (entry.isDirectory()) {
				promises.push(...copyFiles(fullPath, sandboxPath));
			} else {
				promises.push(box.copyIn(fullPath, sandboxPath));
			}
		}
		return promises;
	};

	await Promise.all(copyFiles(contextTmpDir, CONTEXT_DIR));
}

async function executeSandboxedCode(
	{ sandbox_id, code, language, image, vm_size, packages, data_files }: schemas.Input,
	queryResults: Map<string, QueryResult>,
	projectFolder: string,
): Promise<schemas.Output> {
	if (!boxliteModule) {
		throw new Error('Sandbox execution is not available on this platform');
	}

	const { ExecError, TimeoutError } = boxliteModule;

	const { id, box, reused } = await getOrCreateSandbox(sandbox_id, image ?? 'python:3.12-slim', vm_size ?? 'xxs');

	let tmpDir: string | undefined;
	const stderrParts: string[] = [];

	if (sandbox_id && !reused) {
		stderrParts.push(`Sandbox "${sandbox_id}" expired — created a new one.`);
	}

	try {
		if (packages?.length) {
			try {
				await box.installPackages(...packages);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					sandbox_id: id,
					stdout: '',
					stderr: `Failed to install packages: ${message}`,
					exitCode: 1,
				};
			}
		}

		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-sandbox-'));

		if (!reused) {
			await copyProjectToSandbox(box, projectFolder, tmpDir);
		}

		if (data_files?.length) {
			for (const { query_id, filename } of data_files) {
				const result = queryResults.get(query_id);
				if (!result) {
					return {
						sandbox_id: id,
						stdout: '',
						stderr: `Query result not found for id "${query_id}". Make sure to run execute_sql first and use the returned id.`,
						exitCode: 1,
					};
				}

				const csvContent = queryResultToCsv(result);
				const hostPath = path.join(tmpDir, filename);
				fs.writeFileSync(hostPath, csvContent, 'utf-8');
				await box.copyIn(hostPath, `${WORKING_DIR}/${filename}`);
			}
		}

		if (language === 'python') {
			const stdout = await box.run(code);
			return { sandbox_id: id, stdout, stderr: stderrParts.join('\n'), exitCode: 0 };
		}

		const result = await box.exec('sh', '-c', code);
		return {
			sandbox_id: id,
			stdout: result.stdout,
			stderr: [result.stderr, ...stderrParts].filter(Boolean).join('\n'),
			exitCode: result.exitCode,
		};
	} catch (err) {
		if (err instanceof ExecError) {
			return { sandbox_id: id, stdout: '', stderr: err.message, exitCode: 1 };
		}
		if (err instanceof TimeoutError) {
			evictSandbox(id);
			return { sandbox_id: id, stdout: '', stderr: 'Execution timed out', exitCode: 124 };
		}
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('seccomp')) {
			evictSandbox(id);
			return {
				sandbox_id: id,
				stdout: '',
				stderr: `Sandbox failed: insufficient resources or missing kernel capabilities for vm_size "${vm_size ?? 'xxs'}". Try another vm_size.`,
				exitCode: 1,
			};
		}
		evictSandbox(id);
		throw err;
	} finally {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	}
}

export const isSandboxAvailable = boxliteModule !== null;

export default boxliteModule
	? createTool<schemas.Input, schemas.Output>({
			description: schemas.description,
			inputSchema: schemas.inputSchema,
			outputSchema: schemas.outputSchema,
			execute: async (input, context) => {
				return executeSandboxedCode(input, context.queryResults, context.projectFolder);
			},
		})
	: null;
