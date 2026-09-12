import { executeSandboxedCode as schemas } from '@nao/shared/tools';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { ChatImage, getImagesByChatId } from '../../queries/image.queries';
import { isProjectContextPathAllowed } from '../../services/project-context-path-access.service';
import { getQueryResult } from '../../services/query-result.service';
import { sandboxRuntime } from '../../services/sandbox-runtime';
import { readUserFileBytes, writeUserFileBytes } from '../../services/storage/user-files';
import { QueryResult, ToolContext } from '../../types/tools';
import {
	createTool,
	isStoragePath,
	resolveCanonicalProjectPath,
	shouldExcludeEntry,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';

const boxliteModule = sandboxRuntime;

export { isSandboxAvailable } from '../../services/sandbox-runtime';

const WORKING_DIR = '/root';
const SANDBOX_TTL_MS = 5 * 60 * 1000;

type CodeBox = InstanceType<NonNullable<typeof boxliteModule>['CodeBox']>;
interface ContextSandbox {
	exec: (...args: string[]) => Promise<unknown>;
	copyIn: (source: string, destination: string) => Promise<void>;
}

interface PooledSandbox {
	box: CodeBox;
	timeout?: ReturnType<typeof setTimeout>;
}

const sandboxPool = new Map<string, PooledSandbox>();
const sandboxLocks = new Map<string, Promise<void>>();

function evictSandbox(id: string, expectedEntry?: PooledSandbox) {
	const entry = sandboxPool.get(id);
	if (!entry || (expectedEntry && entry !== expectedEntry)) {
		return;
	}
	if (entry.timeout) {
		clearTimeout(entry.timeout);
	}
	sandboxPool.delete(id);
	// Do NOT call box.stop() — boxlite v0.3.0 has a bug where stopping a box
	// corrupts the runtime, causing all subsequent box creations to fail with
	// "received unexpected message: InitReady, expected: IntermediateReady(0)".
	// The runtime will clean up the VM resources when the box is GC'd.
}

function clearSandboxTTL(entry: PooledSandbox) {
	if (entry.timeout) {
		clearTimeout(entry.timeout);
		entry.timeout = undefined;
	}
}

function resetSandboxTTL(id: string, entry: PooledSandbox) {
	if (sandboxPool.get(id) !== entry) {
		return;
	}
	clearSandboxTTL(entry);
	const timeout = setTimeout(() => {
		void withSandboxLock(id, async () => {
			if (sandboxPool.get(id) === entry && entry.timeout === timeout) {
				evictSandbox(id, entry);
			}
		});
	}, SANDBOX_TTL_MS);
	entry.timeout = timeout;
}

async function withSandboxLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
	const previous = sandboxLocks.get(id) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => current);
	sandboxLocks.set(id, tail);

	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (sandboxLocks.get(id) === tail) {
			sandboxLocks.delete(id);
		}
	}
}

function getPooledSandbox(id: string): PooledSandbox | undefined {
	const entry = sandboxPool.get(id);
	if (!entry) {
		return undefined;
	}
	clearSandboxTTL(entry);
	return entry;
}

function registerSandbox(box: CodeBox): string {
	const id = `sbx_${crypto.randomBytes(6).toString('hex')}`;
	sandboxPool.set(id, { box });
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
		const existing = getPooledSandbox(sandboxId);
		if (existing) {
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
const IMAGES_DIR = `${WORKING_DIR}/images`;
const STORAGE_FILES_DIR = `${WORKING_DIR}/files`;
const OUTPUT_DIR = `${WORKING_DIR}/${schemas.SANDBOX_OUTPUT_DIR}`;

async function copyProjectToSandbox(box: ContextSandbox, context: ToolContext, tmpDir: string): Promise<void> {
	const projectFolder = context.projectFolder;
	const walkDir = (dir: string, relativeDir: string): void => {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (shouldExcludeEntry(entry.name, relativeDir, projectFolder)) {
				continue;
			}
			const fullPath = path.join(dir, entry.name);
			const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
			const virtualPath = `/${relativePath}`;
			if (entry.isSymbolicLink()) {
				continue;
			}
			if (entry.isDirectory()) {
				const canonical = resolveCanonicalProjectPath(virtualPath, projectFolder);
				if (isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'directory')) {
					walkDir(fullPath, relativePath);
				}
			} else if (entry.isFile()) {
				const canonical = resolveCanonicalProjectPath(virtualPath, projectFolder);
				if (!isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'file')) {
					continue;
				}
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

export async function refreshProjectContextInSandbox(
	box: ContextSandbox,
	context: ToolContext,
	tmpDir: string,
): Promise<void> {
	await box.exec('sh', '-c', `rm -rf ${CONTEXT_DIR} && mkdir -p ${CONTEXT_DIR}`);
	await copyProjectToSandbox(box, context, tmpDir);
}

const MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
};

async function copyChatImagesToSandbox(box: CodeBox, images: ChatImage[], tmpDir: string): Promise<void> {
	if (images.length === 0) {
		return;
	}

	const imagesDir = path.join(tmpDir, 'images');
	fs.mkdirSync(imagesDir, { recursive: true });

	const promises: Promise<void>[] = [];
	for (const img of images) {
		const ext = MEDIA_TYPE_EXTENSIONS[img.mediaType] ?? 'bin';
		const filename = `${img.id}.${ext}`;
		const hostPath = path.join(imagesDir, filename);
		fs.writeFileSync(hostPath, Buffer.from(img.data, 'base64'));
		promises.push(box.copyIn(hostPath, `${IMAGES_DIR}/${filename}`));
	}

	await Promise.all(promises);
}

/**
 * Copies saved files into the VM under their path below /home, so a file the agent found by
 * listing storage is readable at a location it can work out without being told.
 */
async function copyStorageFilesToSandbox(
	box: CodeBox,
	virtualPaths: string[],
	context: ToolContext,
	tmpDir: string,
): Promise<void> {
	const scope = toStorageScope(context);
	const promises: Promise<void>[] = [];

	for (const virtualPath of virtualPaths) {
		if (!isStoragePath(virtualPath)) {
			throw new Error(
				`'${virtualPath}' is not a saved file. storage_files takes paths under /home; use data_files for query results and the context mount for project files.`,
			);
		}

		const relativePath = toStorageRelativePath(virtualPath);
		if (relativePath === '') {
			throw new Error('storage_files needs the path of a file, not the /home root.');
		}

		const data = await readUserFileBytes(scope, relativePath);
		const hostPath = path.join(tmpDir, 'files', relativePath);
		fs.mkdirSync(path.dirname(hostPath), { recursive: true });
		fs.writeFileSync(hostPath, data);
		promises.push(box.copyIn(hostPath, `${STORAGE_FILES_DIR}/${relativePath}`));
	}

	await Promise.all(promises);
}

/**
 * Copies files the code produced out of the doomed VM and into permanent storage, which is the only
 * way anything a sandbox makes outlives it.
 * @returns The /home paths now holding them.
 */
async function saveSandboxFilesToStorage(
	box: CodeBox,
	files: schemas.SaveFile[],
	context: ToolContext,
	tmpDir: string,
): Promise<string[]> {
	const scope = toStorageScope(context);
	const saved: string[] = [];

	for (const { filename, home_path } of files) {
		if (
			!filename ||
			filename === '.' ||
			filename === '..' ||
			filename !== path.basename(filename) ||
			/[\\\0]/.test(filename)
		) {
			throw new Error(`save_files filename must be a single file name, not a path: '${filename}'`);
		}
		if (!isStoragePath(home_path)) {
			throw new Error(
				`'${home_path}' is not a place files can be kept. save_files writes under /home, e.g. '/home/exports/${filename}'.`,
			);
		}

		const relativePath = toStorageRelativePath(home_path);
		if (relativePath === '') {
			throw new Error('save_files needs the path of a file, not the /home root.');
		}

		const hostPath = path.join(tmpDir, 'out', filename);
		fs.mkdirSync(path.dirname(hostPath), { recursive: true });

		try {
			await box.copyOut(`${OUTPUT_DIR}/${filename}`, hostPath);
		} catch (error) {
			throw new Error(
				`The code did not leave a file at ${OUTPUT_DIR}/${filename}. Write files you want to keep into ${schemas.SANDBOX_OUTPUT_DIR}/ inside the working directory.`,
				{ cause: error },
			);
		}

		await writeUserFileBytes(scope, relativePath, fs.readFileSync(hostPath));
		saved.push(toStorageVirtualPath(relativePath));
	}

	return saved;
}

const savedFiles = async (
	box: CodeBox,
	files: schemas.SaveFile[] | undefined,
	context: ToolContext,
	tmpDir: string,
): Promise<{ saved_files?: string[] }> => {
	if (!files?.length) {
		return {};
	}
	return { saved_files: await saveSandboxFilesToStorage(box, files, context, tmpDir) };
};

async function executeSandboxedCode(input: schemas.Input, context: ToolContext): Promise<schemas.Output> {
	const lockId = input.sandbox_id ?? `new_${crypto.randomBytes(6).toString('hex')}`;
	return withSandboxLock(lockId, () => executeSandboxedCodeLocked(input, context));
}

async function executeSandboxedCodeLocked(
	{ sandbox_id, code, language, image, vm_size, packages, data_files, storage_files, save_files }: schemas.Input,
	context: ToolContext,
): Promise<schemas.Output> {
	const { chatId } = context;
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
			await box.exec('mkdir', '-p', OUTPUT_DIR);
		}
		await refreshProjectContextInSandbox(box, context, tmpDir);

		const chatImages = await getImagesByChatId(chatId);
		if (chatImages.length > 0) {
			await copyChatImagesToSandbox(box, chatImages, tmpDir);
		}

		if (storage_files?.length) {
			await copyStorageFilesToSandbox(box, storage_files, context, tmpDir);
		}

		if (data_files?.length) {
			for (const { query_id, filename } of data_files) {
				const result = await getQueryResult(context, query_id);
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
			return {
				sandbox_id: id,
				stdout,
				stderr: stderrParts.join('\n'),
				exitCode: 0,
				...(await savedFiles(box, save_files, context, tmpDir)),
			};
		}

		const result = await box.exec('sh', '-c', code);
		return {
			sandbox_id: id,
			stdout: result.stdout,
			stderr: [result.stderr, ...stderrParts].filter(Boolean).join('\n'),
			exitCode: result.exitCode,
			...(result.exitCode === 0 ? await savedFiles(box, save_files, context, tmpDir) : {}),
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
		const entry = sandboxPool.get(id);
		if (entry?.box === box) {
			resetSandboxTTL(id, entry);
		}
	}
}

export default boxliteModule
	? createTool<schemas.Input, schemas.Output>({
			description: schemas.description,
			inputSchema: schemas.inputSchema,
			outputSchema: schemas.outputSchema,
			execute: async (input, context) => {
				return executeSandboxedCode(input, context);
			},
		})
	: null;
