import {
	CONTEXT_CONFIG_FILENAME,
	isFileTreeDirectoryGranted,
	isFileTreeFileGranted,
	isMcpServerFullyGranted,
	isMcpServerGranted,
	isMcpToolGranted,
	mayTraverseFileTreeDirectory,
	type McpAccess,
} from '@nao/shared';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isContextPathAllowed } from './context-access';
import type { ResolvedFileTreeAccess, ResolvedSkillsAccess } from './user-group-context-access.service';

export type ProjectPathKind = 'file' | 'directory';
type ProjectPath = { kind: 'root' | 'docs' | 'files' | 'database'; relativePath: string } | { kind: 'invalid' };

type ProjectPathAccessContext = Pick<
	ToolContext,
	'warehouseTableAccess' | 'docsContextAccess' | 'filesContextAccess' | 'mcpAccess' | 'skillsAccess'
>;

const MCP_SPECS_DIRECTORY = 'agent/mcps/';
const MCP_CONFIG_PATH = `${MCP_SPECS_DIRECTORY}mcp.json`;
const SKILLS_DIRECTORY = 'agent/skills/';

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
			return (
				!isMcpConfigPath(requestedPath.relativePath) &&
				!isMcpConfigPath(canonicalPath.relativePath) &&
				isFileTreePathAllowed(
					context.filesContextAccess,
					requestedPath.relativePath,
					canonicalPath.relativePath,
					kind,
				) &&
				isMcpSpecPathAllowed(context.mcpAccess, requestedPath.relativePath, kind) &&
				isMcpSpecPathAllowed(context.mcpAccess, canonicalPath.relativePath, kind) &&
				isSkillPathAllowed(context.skillsAccess, requestedPath.relativePath, kind) &&
				isSkillPathAllowed(context.skillsAccess, canonicalPath.relativePath, kind)
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

/** The agent reaches MCP servers through the per-server tool specs; the raw server config only misleads it and can hold auth headers. */
function isMcpConfigPath(relativePath: string): boolean {
	return relativePath.toLowerCase() === MCP_CONFIG_PATH;
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

/** Tool specs live in `agent/mcps/<server>/<url-encoded tool>.json`, so the path tells which grant it needs. */
function isMcpSpecPathAllowed(access: McpAccess, relativePath: string, kind: ProjectPathKind): boolean {
	if (access.mode === 'all' || !relativePath.toLowerCase().startsWith(MCP_SPECS_DIRECTORY)) {
		return true;
	}
	const [server, specFile, ...nestedSegments] = relativePath.slice(MCP_SPECS_DIRECTORY.length).split('/');
	if (specFile === undefined) {
		return kind === 'directory' && isMcpServerGranted(access, server);
	}
	if (kind === 'directory' || nestedSegments.length > 0) {
		return false;
	}
	if (isMcpServerFullyGranted(access, server)) {
		return true;
	}
	if (!specFile.endsWith('.json')) {
		return false;
	}
	const tool = decodeSpecFileName(specFile.slice(0, -'.json'.length));
	return tool !== null && isMcpToolGranted(access, server, tool);
}

/** Skills are granted by name, so a restricted run only reaches the files its granted skills were loaded from. */
function isSkillPathAllowed(access: ResolvedSkillsAccess, relativePath: string, kind: ProjectPathKind): boolean {
	if (!relativePath.toLowerCase().startsWith(SKILLS_DIRECTORY) || access.mode === 'all') {
		return true;
	}
	return kind === 'file' && access.grantedFiles.includes(relativePath);
}

function decodeSpecFileName(fileName: string): string | null {
	try {
		return decodeURIComponent(fileName);
	} catch {
		return null;
	}
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
