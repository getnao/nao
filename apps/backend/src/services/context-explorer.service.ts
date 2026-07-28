import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

import type {
	FileContentResponse,
	FileContentSearchResponse,
	FileContentSearchResult,
	FileEditabilityReason,
	FileTreeEntry,
	FileWriteResponse,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { spawn } from 'child_process';
import fs from 'fs/promises';

import {
	ContextRepo,
	ContextRepoState,
	getCommittedProjectPaths,
	normalizeProjectPath,
	resolveContextRepo,
	toContextRepoState,
} from '../utils/context-repo';
import { getRipgrepPath } from '../utils/ripgrep';
import { assertNoSymlinkInWritePath, canonicalizeWriteRoot, writeFileAtomically } from '../utils/safe-file-write';
import {
	isWithinProjectFolder,
	loadNaoignorePatterns,
	shouldExcludeEntry,
	toRealPath,
	toVirtualPath,
} from '../utils/tools';

const SEARCH_TIMEOUT_MS = 5_000;
const MAX_SEARCH_FILES = 200;
export const MAX_CONTEXT_FILE_SIZE = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FRONTMATTER_READ_SIZE = 8 * 1024;

export interface FileEditability {
	isEditable: boolean;
	reason: FileEditabilityReason | null;
}

export interface FileTreeResponse {
	entries: FileTreeEntry[];
	repo: ContextRepoState | null;
	isEditable: boolean;
}

type RipgrepMatchEntry = {
	type: 'match';
	data: {
		path: { text: string };
		lines: { text: string };
		line_number: number;
		submatches: unknown[];
	};
};

export async function getFileTree(projectFolder: string): Promise<FileTreeEntry[]> {
	const repo = resolveContextRepo(projectFolder);
	const trackedPaths = repo ? getCommittedProjectPaths(repo) : new Set<string>();
	return readDirectoryRecursive(projectFolder, projectFolder, trackedPaths);
}

export async function getFileTreeResponse(projectFolder: string): Promise<FileTreeResponse> {
	const repo = resolveContextRepo(projectFolder);
	const trackedPaths = repo ? getCommittedProjectPaths(repo) : new Set<string>();
	return {
		entries: await readDirectoryRecursive(projectFolder, projectFolder, trackedPaths),
		repo: toContextRepoState(repo),
		isEditable: repo !== null,
	};
}

export async function readFileContent(filePath: string, projectFolder: string): Promise<FileContentResponse> {
	const { realPath } = resolveAndValidatePath(filePath, projectFolder);
	const contentBuffer = await readValidatedFile(realPath, filePath);
	const editability = getFileEditability(filePath, realPath, projectFolder);
	return {
		content: decodeTextContent(contentBuffer),
		hash: hashContent(contentBuffer),
		isEditable: editability.isEditable,
		editabilityReason: editability.reason,
	};
}

export async function writeFileContent(
	filePath: string,
	content: string,
	expectedHash: string,
	projectFolder: string,
): Promise<FileWriteResponse> {
	validateExpectedHash(expectedHash);
	const contentBuffer = Buffer.from(content, 'utf-8');
	validateContentBuffer(contentBuffer);

	const { realPath, root } = resolveAndValidatePath(filePath, projectFolder);
	assertFileEditable(filePath, realPath, projectFolder);
	const currentContent = await readValidatedFile(realPath, filePath);
	assertExpectedHash(currentContent, expectedHash);

	try {
		writeFileAtomically({
			beforeRename: () => {
				const latestContent = readValidatedFileSync(realPath, filePath);
				assertExpectedHash(latestContent, expectedHash);
			},
			content,
			displayPath: filePath,
			root,
			target: realPath,
		});
	} catch (error) {
		throw toFileError(error, filePath);
	}

	return { hash: hashContent(contentBuffer) };
}

export function getFileEditability(
	filePath: string,
	realPath: string,
	projectFolder: string,
	repo = resolveContextRepo(projectFolder),
	trackedPaths = repo ? getCommittedProjectPaths(repo) : new Set<string>(),
): FileEditability {
	if (!repo) {
		return { isEditable: false, reason: 'no-repo' };
	}

	const projectPath = normalizeProjectPath(filePath);
	if (!trackedPaths.has(projectPath)) {
		return { isEditable: false, reason: 'not-tracked' };
	}
	if (hasGeneratedFrontmatter(realPath)) {
		return { isEditable: false, reason: 'generated' };
	}
	if (fsSync.existsSync(`${realPath}.j2`)) {
		return { isEditable: false, reason: 'rendered-template' };
	}
	return { isEditable: true, reason: null };
}

export function assertFileEditable(
	filePath: string,
	realPath: string,
	projectFolder: string,
	repo?: ContextRepo | null,
	trackedPaths?: Set<string>,
): void {
	const editability = getFileEditability(filePath, realPath, projectFolder, repo, trackedPaths);
	if (editability.isEditable) {
		return;
	}
	throw new TRPCError({
		code: 'FORBIDDEN',
		message: editabilityMessage(editability.reason),
	});
}

export async function searchFileContents(query: string, projectFolder: string): Promise<FileContentSearchResponse> {
	const args = buildSearchArguments(query, projectFolder);
	return runContentSearch(getRipgrepPath(), args, projectFolder);
}

function buildSearchArguments(query: string, projectFolder: string): string[] {
	const args = [
		'--json',
		'--no-heading',
		'--line-number',
		'--fixed-strings',
		'--ignore-case',
		'--hidden',
		'--max-count',
		'10',
		'--max-filesize',
		'1M',
		'--max-columns',
		'500',
		'--max-columns-preview',
	];

	for (const ignorePattern of loadNaoignorePatterns(projectFolder)) {
		const cleanPattern = ignorePattern.endsWith('/') ? ignorePattern.slice(0, -1) : ignorePattern;
		args.push('--glob', `!${cleanPattern}`);
		args.push('--glob', `!${cleanPattern}/**`);
	}

	args.push('--regexp', query);
	args.push('--', projectFolder);
	return args;
}

function runContentSearch(
	ripgrepPath: string,
	args: string[],
	projectFolder: string,
): Promise<FileContentSearchResponse> {
	return new Promise((resolve, reject) => {
		const results = new Map<string, FileContentSearchResult>();
		const ripgrep = spawn(ripgrepPath, args, {
			cwd: projectFolder,
			env: { ...process.env },
		});
		let stdoutBuffer = '';
		let stderr = '';
		let settled = false;
		let truncated = false;

		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve({ results: [...results.values()], truncated });
		};

		const fail = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			reject(error);
		};

		const collectLine = (line: string) => {
			if (!line.trim() || settled) {
				return;
			}

			try {
				const entry = JSON.parse(line) as RipgrepMatchEntry;
				if (entry.type !== 'match') {
					return;
				}

				const filePath = entry.data.path.text;
				if (!isWithinProjectFolder(filePath, projectFolder)) {
					return;
				}

				const virtualPath = toVirtualPath(filePath, projectFolder);
				const existing = results.get(virtualPath);
				if (existing) {
					existing.count += entry.data.submatches.length;
					return;
				}

				if (results.size >= MAX_SEARCH_FILES) {
					truncated = true;
					ripgrep.kill();
					finish();
					return;
				}

				results.set(virtualPath, {
					path: virtualPath,
					count: entry.data.submatches.length,
					line: entry.data.line_number,
					text: entry.data.lines.text.trim(),
				});
			} catch {
				return;
			}
		};

		const flushCompleteLines = () => {
			const lines = stdoutBuffer.split('\n');
			stdoutBuffer = lines.pop() ?? '';
			for (const line of lines) {
				collectLine(line);
			}
		};

		const timeout = setTimeout(() => {
			truncated = true;
			ripgrep.kill();
			finish();
		}, SEARCH_TIMEOUT_MS);

		ripgrep.stdout.on('data', (data) => {
			stdoutBuffer += data.toString();
			flushCompleteLines();
		});

		ripgrep.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		ripgrep.on('close', (code) => {
			collectLine(stdoutBuffer);
			if (code === 2) {
				fail(new Error(`ripgrep error: ${stderr}`));
				return;
			}
			finish();
		});

		ripgrep.on('error', (error) => {
			fail(new Error(`Failed to run ripgrep: ${error.message}`));
		});
	});
}

async function readDirectoryRecursive(
	dirPath: string,
	projectFolder: string,
	trackedPaths: Set<string>,
): Promise<FileTreeEntry[]> {
	const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

	const parentRelativePath = path.relative(projectFolder, dirPath);
	const filtered = dirEntries.filter((entry) => !shouldExcludeEntry(entry.name, parentRelativePath, projectFolder));

	const entries: FileTreeEntry[] = [];

	for (const entry of filtered) {
		const fullPath = path.join(dirPath, entry.name);
		const virtualPath = '/' + path.relative(projectFolder, fullPath);

		if (entry.isDirectory()) {
			const children = await readDirectoryRecursive(fullPath, projectFolder, trackedPaths);
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'directory',
				children,
			});
		} else if (entry.isFile()) {
			const projectPath = path.relative(projectFolder, fullPath).split(path.sep).join('/');
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'file',
				isTracked: trackedPaths.has(projectPath),
			});
		}
	}

	entries.sort((a, b) => {
		if (a.type === b.type) {
			return a.name.localeCompare(b.name);
		}
		return a.type === 'directory' ? -1 : 1;
	});

	return entries;
}

export function resolveAndValidatePath(virtualPath: string, projectFolder: string): { realPath: string; root: string } {
	try {
		const root = canonicalizeWriteRoot(projectFolder);
		const realPath = toRealPath(virtualPath, root);
		assertNoSymlinkInWritePath(root, realPath, virtualPath);
		return { realPath, root };
	} catch (error) {
		throw toFileError(error, virtualPath);
	}
}

async function readValidatedFile(filePath: string, displayPath: string): Promise<Buffer> {
	let fileHandle;
	try {
		fileHandle = await fs.open(filePath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW);
		const stat = await fileHandle.stat();
		assertRegularFile(stat);
		assertFileSize(stat.size);
		const content = await fileHandle.readFile();
		validateContentBuffer(content);
		return content;
	} catch (error) {
		throw toFileError(error, displayPath);
	} finally {
		await fileHandle?.close();
	}
}

function readValidatedFileSync(filePath: string, displayPath: string): Buffer {
	let fileDescriptor: number | null = null;
	try {
		fileDescriptor = fsSync.openSync(filePath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW);
		const stat = fsSync.fstatSync(fileDescriptor);
		assertRegularFile(stat);
		assertFileSize(stat.size);
		const content = fsSync.readFileSync(fileDescriptor);
		validateContentBuffer(content);
		return content;
	} catch (error) {
		throw toFileError(error, displayPath);
	} finally {
		if (fileDescriptor !== null) {
			fsSync.closeSync(fileDescriptor);
		}
	}
}

export function validateContentBuffer(content: Buffer): void {
	assertFileSize(content.byteLength);
	if (content.includes(0)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Binary files cannot be opened in the file explorer.' });
	}
	decodeTextContent(content);
}

export function decodeTextContent(content: Buffer): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(content);
	} catch {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Only valid UTF-8 text files can be opened in the file explorer.',
		});
	}
}

function assertRegularFile(stat: fsSync.Stats): void {
	if (!stat.isFile()) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only regular files can be opened in the file explorer.' });
	}
}

function assertFileSize(size: number): void {
	if (size > MAX_CONTEXT_FILE_SIZE) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is too large (max 1 MB).' });
	}
}

function validateExpectedHash(expectedHash: string): void {
	if (!SHA256_PATTERN.test(expectedHash)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'The expected file hash is invalid.' });
	}
}

function assertExpectedHash(content: Buffer, expectedHash: string): void {
	if (hashContent(content) !== expectedHash) {
		throw new TRPCError({
			code: 'CONFLICT',
			message: 'This file changed on disk. Reload it before saving your changes.',
		});
	}
}

export function hashContent(content: Buffer): string {
	return createHash('sha256').update(content).digest('hex');
}

function hasGeneratedFrontmatter(filePath: string): boolean {
	let fileDescriptor: number | null = null;
	try {
		fileDescriptor = fsSync.openSync(filePath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW);
		const buffer = Buffer.alloc(FRONTMATTER_READ_SIZE);
		const bytesRead = fsSync.readSync(fileDescriptor, buffer, 0, buffer.byteLength, 0);
		const prefix = buffer.subarray(0, bytesRead).toString('utf-8');
		if (!prefix.startsWith('---\n') && !prefix.startsWith('---\r\n')) {
			return false;
		}
		const frontmatter = prefix.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
		return frontmatter?.split(/\r?\n/).some((line) => /^type:\s*generated\s*$/.test(line.trim())) ?? false;
	} catch {
		return false;
	} finally {
		if (fileDescriptor !== null) {
			fsSync.closeSync(fileDescriptor);
		}
	}
}

function editabilityMessage(reason: FileEditabilityReason | null): string {
	switch (reason) {
		case 'no-repo':
			return 'This project is read-only because no GitHub or GitLab origin is connected.';
		case 'not-tracked':
			return 'This file is read-only because it is not committed to the context repository.';
		case 'generated':
			return 'This file is read-only because it is generated by nao.';
		case 'rendered-template':
			return 'This file is read-only because it is rendered from a Jinja template. Edit the .j2 template instead.';
		default:
			return 'This file is read-only.';
	}
}

function toFileError(error: unknown, filePath: string): TRPCError {
	if (error instanceof TRPCError) {
		return error;
	}

	const code = (error as NodeJS.ErrnoException).code;
	if (code === 'ENOENT') {
		return new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${filePath}` });
	}
	if (code === 'ELOOP' || code === 'EMLINK') {
		return new TRPCError({ code: 'FORBIDDEN', message: `Access denied for path: ${filePath}` });
	}

	const message = error instanceof Error ? error.message : '';
	if (
		message.includes('outside the project folder') ||
		message.includes('outside the repository') ||
		message.includes('protected .git metadata') ||
		message.includes('protected environment file') ||
		message.includes('excluded directory') ||
		message.includes('ignored by .naoignore') ||
		message.includes('symlink')
	) {
		return new TRPCError({ code: 'FORBIDDEN', message });
	}

	return new TRPCError({ code: 'BAD_REQUEST', message: message || `Unable to access file: ${filePath}` });
}
