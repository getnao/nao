import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';

import type {
	ContextGitUnavailableReason,
	FileContentResponse,
	FileContentSearchResponse,
	FileContentSearchResult,
	FileEditabilityGuidance,
	FileEditabilityReason,
	FileTreeEntry,
	FileWriteResponse,
} from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { spawn } from 'child_process';
import fs from 'fs/promises';

import type { ContextRepoState, ResolvedContextRepo } from '../utils/context-repo';
import {
	getCommittedProjectPaths,
	getWorktreeProjectRoot,
	normalizeProjectPath,
	toContextRepoState,
} from '../utils/context-repo';
import { getRipgrepPath } from '../utils/ripgrep';
import { assertNoSymlinkInWritePath, canonicalizeWriteRoot, writeFileAtomically } from '../utils/safe-file-write';
import {
	BUILT_IN_EXCLUSION_GLOBS,
	isWithinProjectFolder,
	loadNaoignorePatterns,
	shouldExcludeEntry,
	toRealPath,
	toVirtualPath,
} from '../utils/tools';
import type { ContextExplorerGitResolution } from './context-explorer-git.service';
import { getRepoProviderDisplayName } from './review-request-provider';

const SEARCH_TIMEOUT_MS = 5_000;
const MAX_SEARCH_FILES = 200;
export const MAX_CONTEXT_FILE_SIZE = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FRONTMATTER_READ_SIZE = 8 * 1024;

export interface FileEditability {
	isEditable: boolean;
	reason: FileEditabilityReason | null;
	guidance: FileEditabilityGuidance | null;
}

export interface FileTreeResponse {
	entries: FileTreeEntry[];
	repo: ContextRepoState | null;
	gitUnavailableReason: FileEditabilityReason | null;
	gitUnavailableMessage: string | null;
}

export interface ContextExplorerFileAccess {
	projectFolder: string;
	git: ContextExplorerGitResolution;
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
	return readDirectoryRecursive(projectFolder, projectFolder, new Set<string>());
}

export async function getFileTreeResponse(access: ContextExplorerFileAccess): Promise<FileTreeResponse> {
	const repo = availableRepo(access.git);
	const trackedPaths = repo ? getCommittedProjectPaths(repo) : new Set<string>();
	return {
		entries: await readDirectoryRecursive(access.projectFolder, access.projectFolder, trackedPaths),
		repo: access.git.status === 'available' ? toContextRepoState(access.git.repo) : access.git.repo,
		gitUnavailableReason: access.git.status === 'unavailable' ? access.git.reason : null,
		gitUnavailableMessage: access.git.status === 'unavailable' ? access.git.message : null,
	};
}

export async function readFileContent(
	filePath: string,
	access: ContextExplorerFileAccess | string,
): Promise<FileContentResponse> {
	if (typeof access === 'string') {
		const { realPath } = resolveAndValidatePath(filePath, access);
		const contentBuffer = await readValidatedFile(realPath, filePath);
		return {
			content: decodeTextContent(contentBuffer),
			hash: hashContent(contentBuffer),
			isEditable: false,
			reason: 'no-repo',
			guidance: guidanceForReason('no-repo'),
		};
	}
	const livePath = resolveAndValidatePath(filePath, access.projectFolder).realPath;
	const repo = availableRepo(access.git);
	const trackedPaths = repo ? getCommittedProjectPaths(repo) : new Set<string>();
	const editability = getFileEditability(filePath, livePath, access, repo, trackedPaths);
	const readPath =
		repo && trackedPaths.has(normalizeProjectPath(filePath))
			? resolveAndValidatePath(filePath, getWorktreeProjectRoot(repo)).realPath
			: livePath;
	const contentBuffer = await readValidatedFile(readPath, filePath);
	return {
		content: decodeTextContent(contentBuffer),
		hash: hashContent(contentBuffer),
		isEditable: editability.isEditable,
		reason: editability.reason,
		guidance: editability.guidance ?? undefined,
	};
}

export async function writeFileContent(
	filePath: string,
	content: string,
	expectedHash: string,
	access: ContextExplorerFileAccess | string,
): Promise<FileWriteResponse> {
	if (typeof access === 'string') {
		throw new TRPCError({ code: 'FORBIDDEN', message: guidanceForReason('no-repo').message });
	}
	validateExpectedHash(expectedHash);
	const contentBuffer = Buffer.from(content, 'utf-8');
	validateContentBuffer(contentBuffer);

	if (access.git.status === 'unavailable') {
		throw new TRPCError({ code: 'FORBIDDEN', message: access.git.message });
	}
	const repo = access.git.repo;
	const livePath = resolveAndValidatePath(filePath, access.projectFolder).realPath;
	const trackedPaths = getCommittedProjectPaths(repo);
	assertFileEditable(filePath, livePath, access, repo, trackedPaths);
	const { realPath, root } = resolveAndValidatePath(filePath, getWorktreeProjectRoot(repo));
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
	access: ContextExplorerFileAccess,
	repo: ResolvedContextRepo | null,
	trackedPaths: Set<string>,
): FileEditability {
	if (access.git.status === 'unavailable') {
		return unavailableGitEditability(access.git.reason, access.git.message, access.git.repo?.provider);
	}

	const projectPath = normalizeProjectPath(filePath);
	if (hasGeneratedFrontmatter(realPath)) {
		const annotationsPath = siblingPathIfExists(filePath, realPath, 'annotations.md');
		if (annotationsPath) {
			return readOnly('generated', {
				message: 'This file is generated by nao sync. Add human notes in annotations.md.',
				actionKind: 'file',
				actionPath: annotationsPath,
				actionLabel: 'Open annotations.md',
			});
		}
		return readOnly('generated', {
			message: 'This file is generated by nao sync. Change its source instead.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		});
	}
	if (fsSync.existsSync(`${realPath}.j2`)) {
		return readOnly('rendered-template', {
			message: 'This file is rendered from a Jinja template. Edit the template instead.',
			actionKind: 'file',
			actionPath: `${normalizeVirtualPath(filePath)}.j2`,
			actionLabel: 'Open template',
		});
	}
	if (projectPath.startsWith('repos/') || projectPath.startsWith('docs/notion/')) {
		return readOnly('synced-source', {
			message: 'This path is replaced by nao sync. Change its source in nao_config.yaml.',
			actionKind: 'file',
			actionPath: '/nao_config.yaml',
			actionLabel: 'Open nao_config.yaml',
		});
	}
	if (!repo || !trackedPaths.has(projectPath)) {
		return readOnly('not-tracked', guidanceForReason('not-tracked'));
	}
	return { isEditable: true, reason: null, guidance: null };
}

export function assertFileEditable(
	filePath: string,
	realPath: string,
	access: ContextExplorerFileAccess,
	repo: ResolvedContextRepo | null,
	trackedPaths: Set<string>,
): void {
	const editability = getFileEditability(filePath, realPath, access, repo, trackedPaths);
	if (editability.isEditable) {
		return;
	}
	throw new TRPCError({
		code: 'FORBIDDEN',
		message: editability.guidance?.message ?? 'This file is read-only.',
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
		'--no-ignore',
		'--max-count',
		'10',
		'--max-filesize',
		'1M',
		'--max-columns',
		'500',
		'--max-columns-preview',
	];

	for (const exclusionGlob of BUILT_IN_EXCLUSION_GLOBS) {
		args.push('--glob', exclusionGlob);
	}

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

function availableRepo(resolution: ContextExplorerGitResolution): ResolvedContextRepo | null {
	return resolution.status === 'available' ? resolution.repo : null;
}

function unavailableGitEditability(
	reason: ContextGitUnavailableReason,
	message: string,
	provider?: ContextRepoState['provider'],
): FileEditability {
	return readOnly(reason, { ...guidanceForReason(reason, provider), message });
}

function readOnly(reason: FileEditabilityReason, guidance: FileEditabilityGuidance): FileEditability {
	return { isEditable: false, reason, guidance };
}

function guidanceForReason(
	reason: FileEditabilityReason,
	provider?: ContextRepoState['provider'],
): FileEditabilityGuidance {
	const providerName = getRepoProviderDisplayName(provider);
	const guidance: Record<FileEditabilityReason, FileEditabilityGuidance> = {
		'github-unavailable': {
			message: `${providerName} is not configured for this instance.`,
			actionKind: 'route',
			actionPath: '/settings/git',
			actionLabel: 'Open Git settings',
		},
		'git-unavailable': {
			message: 'Git is temporarily unavailable.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
		'no-token': {
			message: `Connect your ${providerName} account to edit context files.`,
			actionKind: 'route',
			actionPath: '/settings/git',
			actionLabel: `Connect ${providerName} account`,
		},
		'no-repo': {
			message: 'No context repository is connected. Connect one in Git settings to edit context files.',
			actionKind: 'route',
			actionPath: '/settings/git',
			actionLabel: 'Open Git settings',
		},
		'unsupported-provider': {
			message: 'The connected repository provider is not supported by the context explorer.',
			actionKind: 'route',
			actionPath: '/settings/git',
			actionLabel: 'Open Git settings',
		},
		'project-not-found': {
			message: 'No tracked nao_config.yaml was found in the connected repository.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
		'project-ambiguous': {
			message: 'Multiple nao projects were found in the connected repository.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
		generated: {
			message: 'This file is generated by nao sync.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
		'rendered-template': {
			message: 'This file is rendered from a Jinja template.',
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
		'synced-source': {
			message: 'This path is replaced by nao sync. Change its source in nao_config.yaml.',
			actionKind: 'file',
			actionPath: '/nao_config.yaml',
			actionLabel: 'Open nao_config.yaml',
		},
		'not-tracked': {
			message:
				"This file can't be edited because it isn't in the connected repository. Add it there to make it editable.",
			actionKind: null,
			actionPath: null,
			actionLabel: null,
		},
	};
	return guidance[reason];
}

function siblingPathIfExists(filePath: string, realPath: string, siblingName: string): string | null {
	const sibling = path.join(path.dirname(realPath), siblingName);
	if (!fsSync.existsSync(sibling)) {
		return null;
	}
	const virtualDirectory = path.posix.dirname(normalizeVirtualPath(filePath));
	return path.posix.join(virtualDirectory, siblingName);
}

function normalizeVirtualPath(filePath: string): string {
	return `/${normalizeProjectPath(filePath)}`;
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
