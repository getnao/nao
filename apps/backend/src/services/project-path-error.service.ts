import fs from 'fs';
import path from 'path';

import type { ToolContext } from '../types/tools';
import { isMissingPathError, resolveCanonicalProjectPath } from '../utils/tools';
import { isProjectContextPathAllowed, type ProjectPathKind } from './project-context-path-access.service';

const PATH_FORMAT_HINT =
	"Paths are relative to the project root, e.g. '/RULES.md', '/docs/<folder>/<file>.md' or " +
	"'/databases/type=<type>/database=<database>/schema=<schema>/table=<table>/columns.md'.";

const DATABASE_LAYOUT_KEYS = ['type', 'database', 'schema', 'table'];

type PathAccessContext = Pick<
	ToolContext,
	'projectFolder' | 'warehouseTableAccess' | 'docsContextAccess' | 'filesContextAccess' | 'mcpAccess' | 'skillsAccess'
>;

/**
 * Rewrites filesystem errors raised while accessing a project path so the model only ever sees
 * the virtual path it asked for, never the host filesystem path, and gets a hint about the layout.
 */
export function toProjectPathError(
	error: unknown,
	virtualPath: string,
	kind: ProjectPathKind,
	context: PathAccessContext,
): unknown {
	if (isMissingPathError(error)) {
		return new Error(buildMissingPathMessage(virtualPath, kind, context));
	}
	if (isFilesystemError(error)) {
		return new Error(`${error.code}: unable to access '${virtualPath}'`);
	}
	return error;
}

function buildMissingPathMessage(virtualPath: string, kind: ProjectPathKind, context: PathAccessContext): string {
	const suggestion = suggestExistingPath(virtualPath, kind, context);
	const suggestionText = suggestion ? ` Did you mean '${suggestion}'?` : '';
	return `Not found: '${virtualPath}' does not exist in the project. ${PATH_FORMAT_HINT}${suggestionText}`;
}

function suggestExistingPath(virtualPath: string, kind: ProjectPathKind, context: PathAccessContext): string | null {
	const candidates = [stripLeadingProjectSegment(virtualPath), applyDatabaseLayoutPrefixes(virtualPath)];
	return candidates.find((candidate) => candidate !== null && existsAndAllowed(candidate, kind, context)) ?? null;
}

function stripLeadingProjectSegment(virtualPath: string): string | null {
	const segments = toSegments(virtualPath);
	if (segments[0] !== 'project' || segments.length < 2) {
		return null;
	}
	return `/${segments.slice(1).join('/')}`;
}

function applyDatabaseLayoutPrefixes(virtualPath: string): string | null {
	const segments = toSegments(virtualPath);
	if (segments[0] !== 'databases') {
		return null;
	}
	const prefixedSegments = segments.map((segment, index) => {
		const key = DATABASE_LAYOUT_KEYS[index - 1];
		if (key === undefined || segment.includes('=')) {
			return segment;
		}
		return `${key}=${segment}`;
	});
	const candidate = `/${prefixedSegments.join('/')}`;
	return candidate === `/${segments.join('/')}` ? null : candidate;
}

function existsAndAllowed(virtualPath: string, kind: ProjectPathKind, context: PathAccessContext): boolean {
	try {
		const canonical = resolveCanonicalProjectPath(virtualPath, context.projectFolder);
		return (
			fs.existsSync(canonical.realPath) &&
			isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, kind)
		);
	} catch {
		return false;
	}
}

function toSegments(virtualPath: string): string[] {
	return path.posix.normalize(virtualPath).split('/').filter(Boolean);
}

function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string';
}
