import { isDocsContextDirectoryGranted, isDocsContextFileGranted, mayTraverseDocsContextDirectory } from '@nao/shared';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isContextPathAllowed } from './context-access';

type ProjectPathKind = 'file' | 'directory';

export function assertProjectContextPathAllowed(
	context: Pick<ToolContext, 'warehouseTableAccess' | 'docsContextAccess'>,
	requestedVirtualPath: string,
	canonicalVirtualPath: string,
	kind: ProjectPathKind,
): void {
	if (!isProjectContextPathAllowed(context, requestedVirtualPath, canonicalVirtualPath, kind)) {
		throw new Error(`Access denied: ${requestedVirtualPath}`);
	}
}

export function isProjectContextPathAllowed(
	context: Pick<ToolContext, 'warehouseTableAccess' | 'docsContextAccess'>,
	requestedVirtualPath: string,
	canonicalVirtualPath: string,
	kind: ProjectPathKind,
): boolean {
	if (!isContextPathAllowed(context.warehouseTableAccess, canonicalVirtualPath)) {
		return false;
	}

	const requestedDocsPath = getDocsRelativePath(requestedVirtualPath);
	const canonicalDocsPath = getDocsRelativePath(canonicalVirtualPath);
	if (requestedDocsPath === undefined && canonicalDocsPath === undefined) {
		return true;
	}
	if (requestedDocsPath === undefined || canonicalDocsPath === undefined || requestedDocsPath !== canonicalDocsPath) {
		return false;
	}
	if (!context.docsContextAccess.enforced) {
		return true;
	}
	if (kind === 'file') {
		return isDocsContextFileGranted(context.docsContextAccess.access, canonicalDocsPath);
	}
	return (
		isDocsContextDirectoryGranted(context.docsContextAccess.access, canonicalDocsPath) ||
		mayTraverseDocsContextDirectory(context.docsContextAccess.access, canonicalDocsPath)
	);
}

export function isDocsProjectPath(virtualPath: string): boolean {
	return getDocsRelativePath(virtualPath) !== undefined;
}

function getDocsRelativePath(virtualPath: string): string | undefined {
	if (virtualPath.includes('\\') || hasControlCharacter(virtualPath)) {
		return undefined;
	}
	const relativePath = virtualPath.replace(/^\/+/, '');
	const addressedDocs = relativePath === 'docs' || relativePath.startsWith('docs/');
	if (addressedDocs && relativePath.split('/').some((segment) => segment === '.' || segment === '..')) {
		return '\0invalid';
	}
	const normalizedPath = path.posix.normalize(relativePath);
	if (normalizedPath === 'docs') {
		return '';
	}
	if (normalizedPath.startsWith('docs/')) {
		return normalizedPath.slice('docs/'.length);
	}
	return addressedDocs ? '\0invalid' : undefined;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}
