import {
	CONTEXT_CONFIG_FILENAME,
	isFileTreeDirectoryGranted,
	isFileTreeFileGranted,
	mayTraverseFileTreeDirectory,
} from '@nao/shared';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isContextPathAllowed } from './context-access';
import type { ResolvedFileTreeAccess } from './user-group-context-access.service';

type ProjectPathKind = 'file' | 'directory';
type ProjectPath = { kind: 'root' | 'docs' | 'files' | 'database'; relativePath: string } | { kind: 'invalid' };

type ProjectPathAccessContext = Pick<ToolContext, 'warehouseTableAccess' | 'docsContextAccess' | 'filesContextAccess'>;

export function assertProjectContextPathAllowed(
	context: ProjectPathAccessContext,
	requestedVirtualPath: string,
	canonicalVirtualPath: string,
	kind: ProjectPathKind,
): void {
	if (!isProjectContextPathAllowed(context, requestedVirtualPath, canonicalVirtualPath, kind)) {
		throw new Error(`Access denied: ${requestedVirtualPath}`);
	}
}

export function isProjectContextPathAllowed(
	context: ProjectPathAccessContext,
	requestedVirtualPath: string,
	canonicalVirtualPath: string,
	kind: ProjectPathKind,
): boolean {
	if (isProjectConfigPath(requestedVirtualPath) || isProjectConfigPath(canonicalVirtualPath)) {
		return false;
	}
	if (!isContextPathAllowed(context.warehouseTableAccess, canonicalVirtualPath)) {
		return false;
	}

	const requestedPath = parseProjectPath(requestedVirtualPath);
	const canonicalPath = parseProjectPath(canonicalVirtualPath);
	if (requestedPath.kind === 'invalid' || canonicalPath.kind === 'invalid') {
		return false;
	}
	if (requestedPath.kind !== canonicalPath.kind) {
		return false;
	}
	switch (canonicalPath.kind) {
		case 'root':
			return kind === 'directory';
		case 'database':
			return true;
		case 'docs':
			return isFileTreePathAllowed(
				context.docsContextAccess,
				requestedPath.relativePath,
				canonicalPath.relativePath,
				kind,
			);
		case 'files':
			return isFileTreePathAllowed(
				context.filesContextAccess,
				requestedPath.relativePath,
				canonicalPath.relativePath,
				kind,
			);
	}
}

export function isDocsProjectPath(virtualPath: string): boolean {
	return parseProjectPath(virtualPath).kind === 'docs';
}

/** `nao_config.yaml` can hold plaintext LLM keys and warehouse credentials, so the agent never sees it. */
function isProjectConfigPath(virtualPath: string): boolean {
	return path.posix.basename(virtualPath).toLowerCase() === CONTEXT_CONFIG_FILENAME;
}

/** Grants are matched on the path the agent addressed, so a restricted tree rejects symlinks and aliases to other paths. */
function isFileTreePathAllowed(
	resolvedAccess: ResolvedFileTreeAccess,
	requestedPath: string,
	canonicalPath: string,
	kind: ProjectPathKind,
): boolean {
	if (!resolvedAccess.enforced || resolvedAccess.access.mode === 'all') {
		return true;
	}
	if (requestedPath !== canonicalPath) {
		return false;
	}
	if (kind === 'file') {
		return isFileTreeFileGranted(resolvedAccess.access, canonicalPath);
	}
	return (
		isFileTreeDirectoryGranted(resolvedAccess.access, canonicalPath) ||
		mayTraverseFileTreeDirectory(resolvedAccess.access, canonicalPath)
	);
}

function parseProjectPath(virtualPath: string): ProjectPath {
	if (virtualPath.includes('\\') || hasControlCharacter(virtualPath)) {
		return { kind: 'invalid' };
	}
	const relativePath = virtualPath.replace(/^\/+/, '');
	const addressedDocs = relativePath === 'docs' || relativePath.startsWith('docs/');
	const addressedDatabases = relativePath === 'databases' || relativePath.startsWith('databases/');
	if (
		(addressedDocs || addressedDatabases) &&
		relativePath.split('/').some((segment) => segment === '.' || segment === '..')
	) {
		return { kind: 'invalid' };
	}
	const normalizedPath = path.posix.normalize(relativePath);
	if (normalizedPath === '.' || normalizedPath === '') {
		return { kind: 'root', relativePath: '' };
	}
	if (normalizedPath === 'docs') {
		return { kind: 'docs', relativePath: '' };
	}
	if (normalizedPath.startsWith('docs/')) {
		return { kind: 'docs', relativePath: normalizedPath.slice('docs/'.length) };
	}
	if (normalizedPath === 'databases' || normalizedPath.startsWith('databases/')) {
		return { kind: 'database', relativePath: normalizedPath };
	}
	if (addressedDocs || addressedDatabases) {
		return { kind: 'invalid' };
	}
	return { kind: 'files', relativePath: normalizedPath };
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}
