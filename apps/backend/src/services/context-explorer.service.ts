import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

import type {
	FileContentResponse,
	FileContentSearchResponse,
	FileContentSearchResult,
	FileTreeEntry,
	FileWriteResponse,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { spawn } from 'child_process';
import fs from 'fs/promises';

import { isGitRepository } from '../utils/git-repo';
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
	return readDirectoryRecursive(projectFolder, projectFolder);
}

export async function readFileContent(filePath: string, projectFolder: string): Promise<FileContentResponse> {
	const { realPath } = resolveAndValidatePath(filePath, projectFolder);
	const contentBuffer = await readValidatedFile(realPath, filePath);
	return {
		content: decodeTextContent(contentBuffer),
		hash: hashContent(contentBuffer),
	};
}

export async function writeFileContent(
	filePath: string,
	content: string,
	expectedHash: string,
	projectFolder: string,
): Promise<FileWriteResponse> {
	if (!isGitRepository(projectFolder)) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Editing requires the project folder to be a git repository.',
		});
	}
	validateExpectedHash(expectedHash);
	const contentBuffer = Buffer.from(content, 'utf-8');
	validateContentBuffer(contentBuffer);

	const { realPath, root } = resolveAndValidatePath(filePath, projectFolder);
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

async function readDirectoryRecursive(dirPath: string, projectFolder: string): Promise<FileTreeEntry[]> {
	const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

	const parentRelativePath = path.relative(projectFolder, dirPath);
	const filtered = dirEntries.filter((entry) => !shouldExcludeEntry(entry.name, parentRelativePath, projectFolder));

	const entries: FileTreeEntry[] = [];

	for (const entry of filtered) {
		const fullPath = path.join(dirPath, entry.name);
		const virtualPath = '/' + path.relative(projectFolder, fullPath);

		if (entry.isDirectory()) {
			const children = await readDirectoryRecursive(fullPath, projectFolder);
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'directory',
				children,
			});
		} else if (entry.isFile()) {
			entries.push({
				name: entry.name,
				path: virtualPath,
				type: 'file',
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

function resolveAndValidatePath(virtualPath: string, projectFolder: string): { realPath: string; root: string } {
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

function validateContentBuffer(content: Buffer): void {
	assertFileSize(content.byteLength);
	if (content.includes(0)) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Binary files cannot be opened in the file explorer.' });
	}
	decodeTextContent(content);
}

function decodeTextContent(content: Buffer): string {
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

function hashContent(content: Buffer): string {
	return createHash('sha256').update(content).digest('hex');
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
