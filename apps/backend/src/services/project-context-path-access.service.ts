import { isDocsContextDirectoryGranted, isDocsContextFileGranted, mayTraverseDocsContextDirectory } from '@nao/shared';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isContextPathAllowed } from './context-access';

type ProjectPathKind = 'file' | 'directory';
type DocsPath = { kind: 'docs'; relativePath: string } | { kind: 'invalid' } | { kind: 'non-docs' };

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

	const requestedDocsPath = parseDocsPath(requestedVirtualPath);
	const canonicalDocsPath = parseDocsPath(canonicalVirtualPath);
	if (requestedDocsPath.kind === 'invalid' || canonicalDocsPath.kind === 'invalid') {
		return false;
	}
	if (requestedDocsPath.kind === 'non-docs' && canonicalDocsPath.kind === 'non-docs') {
		return true;
	}
	if (
		requestedDocsPath.kind !== 'docs' ||
		canonicalDocsPath.kind !== 'docs' ||
		requestedDocsPath.relativePath !== canonicalDocsPath.relativePath
	) {
		return false;
	}
	if (!context.docsContextAccess.enforced) {
		return true;
	}
	if (kind === 'file') {
		return isDocsContextFileGranted(context.docsContextAccess.access, canonicalDocsPath.relativePath);
	}
	return (
		isDocsContextDirectoryGranted(context.docsContextAccess.access, canonicalDocsPath.relativePath) ||
		mayTraverseDocsContextDirectory(context.docsContextAccess.access, canonicalDocsPath.relativePath)
	);
}

export function isDocsProjectPath(virtualPath: string): boolean {
	return parseDocsPath(virtualPath).kind === 'docs';
}

function parseDocsPath(virtualPath: string): DocsPath {
	if (virtualPath.includes('\\') || hasControlCharacter(virtualPath)) {
		return { kind: 'invalid' };
	}
	const relativePath = virtualPath.replace(/^\/+/, '');
	const addressedDocs = relativePath === 'docs' || relativePath.startsWith('docs/');
	if (addressedDocs && relativePath.split('/').some((segment) => segment === '.' || segment === '..')) {
		return { kind: 'invalid' };
	}
	const normalizedPath = path.posix.normalize(relativePath);
	if (normalizedPath === 'docs') {
		return { kind: 'docs', relativePath: '' };
	}
	if (normalizedPath.startsWith('docs/')) {
		return { kind: 'docs', relativePath: normalizedPath.slice('docs/'.length) };
	}
	return addressedDocs ? { kind: 'invalid' } : { kind: 'non-docs' };
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}
