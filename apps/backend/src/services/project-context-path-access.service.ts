import {
	isDocsContextDirectoryGranted,
	isDocsContextFileGranted,
	isFilesContextDirectoryGranted,
	isFilesContextFileGranted,
	mayTraverseDocsContextDirectory,
	mayTraverseFilesContextDirectory,
} from '@nao/shared';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isContextPathAllowed } from './context-access';

type ProjectPathKind = 'file' | 'directory';
type ProjectPath =
	| { kind: 'docs'; relativePath: string }
	| { kind: 'files'; relativePath: string }
	| { kind: 'database'; relativePath: string }
	| { kind: 'invalid' };

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
	if (!isContextPathAllowed(context.warehouseTableAccess, canonicalVirtualPath)) {
		return false;
	}

	const requestedPath = parseProjectPath(requestedVirtualPath);
	const canonicalPath = parseProjectPath(canonicalVirtualPath);
	if (requestedPath.kind === 'invalid' || canonicalPath.kind === 'invalid') {
		return false;
	}
	if (requestedPath.kind !== canonicalPath.kind || requestedPath.relativePath !== canonicalPath.relativePath) {
		return false;
	}
	if (requestedPath.kind === 'database') {
		return true;
	}
	if (requestedPath.kind === 'files') {
		return isGrantedPath(context.filesContextAccess, canonicalPath.relativePath, kind, {
			isFileGranted: isFilesContextFileGranted,
			isDirectoryGranted: isFilesContextDirectoryGranted,
			mayTraverseDirectory: mayTraverseFilesContextDirectory,
		});
	}
	return isGrantedPath(context.docsContextAccess, canonicalPath.relativePath, kind, {
		isFileGranted: isDocsContextFileGranted,
		isDirectoryGranted: isDocsContextDirectoryGranted,
		mayTraverseDirectory: mayTraverseDocsContextDirectory,
	});
}

export function isDocsProjectPath(virtualPath: string): boolean {
	return parseProjectPath(virtualPath).kind === 'docs';
}

type GrantRules<GrantAccess> = {
	isFileGranted: (access: GrantAccess, filePath: string) => boolean;
	isDirectoryGranted: (access: GrantAccess, directoryPath: string) => boolean;
	mayTraverseDirectory: (access: GrantAccess, directoryPath: string) => boolean;
};

function isGrantedPath<GrantAccess>(
	resolvedAccess: { enforced: false } | { enforced: true; access: GrantAccess },
	relativePath: string,
	kind: ProjectPathKind,
	rules: GrantRules<GrantAccess>,
): boolean {
	if (!resolvedAccess.enforced) {
		return true;
	}
	if (kind === 'file') {
		return rules.isFileGranted(resolvedAccess.access, relativePath);
	}
	return (
		rules.isDirectoryGranted(resolvedAccess.access, relativePath) ||
		rules.mayTraverseDirectory(resolvedAccess.access, relativePath)
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
	return { kind: 'files', relativePath: normalizedPath === '.' ? '' : normalizedPath };
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}
