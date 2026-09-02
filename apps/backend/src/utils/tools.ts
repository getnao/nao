import { asSchema, type JSONSchema7, Tool, tool } from 'ai';
import fs from 'fs';
import { minimatch } from 'minimatch';
import path from 'path';

import type { StorageScope } from '../services/storage';
import { McpToolContext, ToolContext } from '../types/tools';

const MCP_TOOL_SEPARATOR = '__';

/**
 * Top-level folder of the virtual tree holding the user's permanent storage.
 * The name is reserved: a project folder called `home` is never exposed, so a
 * path under it always means permanent storage.
 */
export const STORAGE_MOUNT = 'home';

/** Shorthand the model is likely to reach for, accepted on input but never emitted. */
const STORAGE_MOUNT_ALIAS = '~';

/** Creates a tool with a typed execution `context` */
export const createTool = <TInput, TOutput>(
	opts: Omit<Tool<TInput, TOutput>, 'execute'> & {
		execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
	},
): Tool<TInput, TOutput> => {
	return tool<TInput, TOutput>({
		...opts,
		execute: (input, { experimental_context }) => {
			return opts.execute(input, experimental_context as ToolContext);
		},
	} as Tool<TInput, TOutput>);
};

/** The permanent-storage space a run may reach: the current user, in the current project. */
export const toStorageScope = (context: ToolContext | McpToolContext): StorageScope => {
	return { projectId: context.projectId, userId: context.userId };
};

/** True when a virtual path addresses permanent storage: `/home`, `~` or anything below them. */
export const isStoragePath = (virtualPath: string | undefined | null): boolean => {
	return typeof virtualPath === 'string' && storageMountOf(virtualPath) !== null;
};

/**
 * Converts a virtual path to the path inside the user's storage space.
 * An empty result addresses the storage root itself.
 */
export const toStorageRelativePath = (virtualPath: string): string => {
	const mount = storageMountOf(virtualPath);
	return mount === null ? '' : trimSlashes(trimSlashes(virtualPath).slice(mount.length));
};

/** The spelling of the mount the path uses, or null when it is not a storage path. */
const storageMountOf = (virtualPath: string): string | null => {
	const trimmed = trimSlashes(virtualPath);

	return (
		[STORAGE_MOUNT, STORAGE_MOUNT_ALIAS].find((mount) => trimmed === mount || trimmed.startsWith(`${mount}/`)) ??
		null
	);
};

/** Virtual path of a file inside permanent storage. */
export const toStorageVirtualPath = (relativePath: string): string => {
	const trimmed = trimSlashes(relativePath);
	return trimmed === '' ? `/${STORAGE_MOUNT}` : `/${STORAGE_MOUNT}/${trimmed}`;
};

const trimSlashes = (value: string): string => {
	return value.trim().replace(/^\/+|\/+$/g, '');
};

/**
 * Directory names that should be excluded from tool operations (list, search, read).
 */
const EXCLUDED_DIRECTORY_NAMES = ['.meta', '.git'];
const ENVIRONMENT_FILE_PATTERNS = ['.env', '.env.*'];
export const BUILT_IN_EXCLUSION_GLOBS = [...EXCLUDED_DIRECTORY_NAMES, ...ENVIRONMENT_FILE_PATTERNS].flatMap(
	(pattern) => [`!${pattern}`, `!${pattern}/**`, `!**/${pattern}`, `!**/${pattern}/**`],
);

type NaoignoreCacheEntry = {
	/** `mtimeMs:size` of the .naoignore file, or `null` if the file does not exist */
	signature: string | null;
	patterns: string[];
};

/**
 * Cache for .naoignore patterns per project folder.
 * Entries are invalidated automatically when the underlying file changes.
 */
const naoignoreCache = new Map<string, NaoignoreCacheEntry>();

/**
 * Computes a cheap fingerprint of the .naoignore file used to detect changes.
 * Returns `null` when the file does not exist or cannot be stat-ed.
 */
const getNaoignoreSignature = (naoignorePath: string): string | null => {
	try {
		const stat = fs.statSync(naoignorePath);
		return `${stat.mtimeMs}:${stat.size}`;
	} catch {
		return null;
	}
};

/**
 * Loads and parses the .naoignore file from the project folder.
 * Returns an array of patterns. Results are cached per project folder and
 * invalidated when the file's mtime or size changes.
 */
export const loadNaoignorePatterns = (projectFolder: string): string[] => {
	const naoignorePath = path.join(projectFolder, '.naoignore');
	const signature = getNaoignoreSignature(naoignorePath);

	const cached = naoignoreCache.get(projectFolder);
	if (cached && cached.signature === signature) {
		return cached.patterns;
	}

	let patterns: string[] = [];
	if (signature !== null) {
		try {
			const content = fs.readFileSync(naoignorePath, 'utf-8');
			patterns = content
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith('#'));
		} catch {
			// If we can't read the file, fall back to empty patterns
		}
	}

	naoignoreCache.set(projectFolder, { signature, patterns });
	return patterns;
};

/**
 * Clears the naoignore cache. Useful for testing or to force a reload.
 */
export const clearNaoignoreCache = (): void => {
	naoignoreCache.clear();
};

/**
 * Checks if a path matches any .naoignore pattern.
 * @param relativePath - Path relative to the project folder (e.g., "templates/foo.md")
 * @param projectFolder - The project folder path
 * @returns true if the path should be ignored
 */
export const isIgnoredByNaoignore = (relativePath: string, projectFolder: string): boolean => {
	const patterns = loadNaoignorePatterns(projectFolder);

	// Normalize the path (remove leading slash if present)
	const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;

	for (const pattern of patterns) {
		// Handle directory patterns (ending with /)
		if (pattern.endsWith('/')) {
			const dirPattern = pattern.slice(0, -1);
			// Check if path starts with or is exactly the directory
			if (
				normalizedPath === dirPattern ||
				normalizedPath.startsWith(dirPattern + '/') ||
				normalizedPath.split('/').includes(dirPattern)
			) {
				return true;
			}
		} else {
			// Use minimatch for glob pattern matching
			// Match against the full path
			if (minimatch(normalizedPath, pattern, { matchBase: true, dot: true })) {
				return true;
			}
			// Also check if the pattern matches any directory in the path
			if (minimatch(normalizedPath, `**/${pattern}`, { dot: true })) {
				return true;
			}
			if (minimatch(normalizedPath, `**/${pattern}/**`, { dot: true })) {
				return true;
			}
		}
	}

	return false;
};

/**
 * Checks if a real filesystem path should be ignored based on .naoignore.
 * @param realPath - Absolute filesystem path
 * @param projectFolder - The project folder path
 * @returns true if the path should be ignored
 */
export const isIgnoredPath = (realPath: string, projectFolder: string): boolean => {
	const resolved = path.resolve(realPath);
	const normalizedFolder = path.resolve(projectFolder);
	const relativePath = path.relative(normalizedFolder, resolved);

	// Paths outside project folder are not subject to naoignore
	if (relativePath.startsWith('..')) {
		return false;
	}

	return isIgnoredByNaoignore(relativePath, normalizedFolder);
};

/**
 * Checks if a path contains any excluded directory.
 */
export const isInExcludedDir = (filePath: string): boolean => {
	const parts = filePath.split(path.sep);
	return parts.some((part) => isExcludedDirectoryName(part) || isEnvironmentFileName(part));
};

/**
 * Checks if an entry name is an excluded directory.
 */
export const isExcludedEntry = (name: string): boolean => {
	return isExcludedDirectoryName(name) || isEnvironmentFileName(name);
};

const isExcludedDirectoryName = (name: string): boolean => {
	return EXCLUDED_DIRECTORY_NAMES.includes(name.toLowerCase());
};

const isEnvironmentFileName = (name: string): boolean => {
	return ENVIRONMENT_FILE_PATTERNS.some((pattern) => minimatch(name, pattern, { dot: true, nocase: true }));
};

/**
 * Checks if an entry should be excluded from directory listings.
 * Combines excluded directories and .naoignore patterns.
 * @param entryName - The name of the entry (file or directory)
 * @param parentPath - The parent directory path relative to project folder
 * @param projectFolder - The project folder path
 * @returns true if the entry should be excluded
 */
export const shouldExcludeEntry = (entryName: string, parentPath: string, projectFolder: string): boolean => {
	// First check built-in exclusions
	if (isExcludedEntry(entryName)) {
		return true;
	}

	// The storage mount owns this name at the root of the tree
	if (parentPath === '' && isStoragePath(entryName)) {
		return true;
	}

	// Then check naoignore patterns
	const relativePath = parentPath ? `${parentPath}/${entryName}` : entryName;
	return isIgnoredByNaoignore(relativePath, projectFolder);
};

/**
 * Checks if a given path is within the project folder, not in an excluded directory,
 * and not ignored by .naoignore.
 */
export const isWithinProjectFolder = (filePath: string, projectFolder: string): boolean => {
	const resolved = path.resolve(filePath);
	const normalizedFolder = path.resolve(projectFolder);
	const withinFolder = resolved === normalizedFolder || resolved.startsWith(normalizedFolder + path.sep);
	if (!withinFolder) {
		return false;
	}
	if (isInExcludedDir(resolved)) {
		return false;
	}
	if (isStoragePath(path.relative(normalizedFolder, resolved).replaceAll(path.sep, '/'))) {
		return false;
	}
	if (isIgnoredPath(resolved, normalizedFolder)) {
		return false;
	}
	return true;
};

/**
 * Converts a virtual path (where / = project folder) to a real filesystem path.
 * - `/foo/bar` → `{projectFolder}/foo/bar`
 * - `foo/bar` → `{projectFolder}/foo/bar`
 * - `/` or empty → `{projectFolder}`
 * @throws Error if the resolved path escapes the project folder or is ignored by .naoignore
 */
export const toRealPath = (virtualPath: string, projectFolder: string): string => {
	const normalizedFolder = path.resolve(projectFolder);

	if (isStoragePath(virtualPath)) {
		throw new Error(`Path '${virtualPath}' is in permanent storage, not in the project folder`);
	}

	// Strip leading slash to make it relative to project folder
	const relativePath = virtualPath.startsWith('/') ? virtualPath.slice(1) : virtualPath;

	// Resolve and normalize (this handles .. and .)
	const resolvedPath = path.resolve(normalizedFolder, relativePath);

	// Check if path is outside project folder
	const withinFolder = resolvedPath === normalizedFolder || resolvedPath.startsWith(normalizedFolder + path.sep);
	if (!withinFolder) {
		throw new Error(`Access denied: path '${virtualPath}' is outside the project folder`);
	}

	const normalizedRelativePath = path.relative(normalizedFolder, resolvedPath).replaceAll(path.sep, '/');
	if (isStoragePath(normalizedRelativePath)) {
		throw new Error(`Path '${virtualPath}' is in permanent storage, not in the project folder`);
	}

	if (resolvedPath.split(path.sep).some((part) => part.toLowerCase() === '.git')) {
		throw new Error(`Access denied: path '${virtualPath}' targets protected .git metadata`);
	}

	if (resolvedPath.split(path.sep).some(isEnvironmentFileName)) {
		throw new Error(`Access denied: path '${virtualPath}' targets a protected environment file`);
	}

	// Check if path is in an excluded directory
	if (isInExcludedDir(resolvedPath)) {
		throw new Error(`Access denied: path '${virtualPath}' is in an excluded directory`);
	}

	// Check if path is ignored by .naoignore
	if (isIgnoredPath(resolvedPath, normalizedFolder)) {
		throw new Error(`Access denied: path '${virtualPath}' is ignored by .naoignore`);
	}

	return resolvedPath;
};

/**
 * Converts a real filesystem path to a virtual path (where / = project folder).
 * - `{projectFolder}/foo/bar` → `/foo/bar`
 * - `{projectFolder}` → `/`
 * @throws Error if the path is outside the project folder
 */
export const toVirtualPath = (realPath: string, projectFolder: string): string => {
	const resolved = path.resolve(realPath);
	const normalizedFolder = path.resolve(projectFolder);

	if (!isWithinProjectFolder(resolved, normalizedFolder)) {
		throw new Error(`Path '${realPath}' is outside the project folder`);
	}

	if (resolved === normalizedFolder) {
		return '/';
	}

	const relativePath = path.relative(normalizedFolder, resolved);
	// Virtual paths always use forward slashes
	return '/' + relativePath.replaceAll('\\', '/');
};

/**
 * Sanitizes MCP tool schemas by:
 * - Ensures all array types have an items property
 * - Removes null from required arrays
 * - Recursively processes nested objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sanitizeTools(schema: any): any {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}

	const sanitized = { ...schema };

	// Convert required: null to undefined
	if (sanitized.required === null) {
		delete sanitized.required;
	}

	// Ensure array types have items
	if (sanitized.type === 'array' && !sanitized.items) {
		sanitized.items = {};
	}

	// Recursively process properties
	if (sanitized.properties && typeof sanitized.properties === 'object') {
		sanitized.properties = Object.fromEntries(
			Object.entries(sanitized.properties).map(([key, value]) => {
				return [key, sanitizeTools(value)];
			}),
		);
	}

	// Recursively process items
	if (sanitized.items) {
		sanitized.items = sanitizeTools(sanitized.items);
	}

	// Recursively process additionalProperties
	if (sanitized.additionalProperties && typeof sanitized.additionalProperties === 'object') {
		sanitized.additionalProperties = sanitizeTools(sanitized.additionalProperties);
	}

	return sanitized;
}

/**
 * Creates prefixed tool name: "servername__toolname"
 */
export function prefixToolName(serverName: string, toolName: string): string {
	return `${serverName}${MCP_TOOL_SEPARATOR}${toolName}`;
}

/**
 * Extracts server name and original tool name from prefixed name
 * Returns: { serverName: "metabase", originalName: "list-dashboards" }
 */
export function removePrefixToolName(prefixedToolName: string): string {
	const parts = prefixedToolName.split(MCP_TOOL_SEPARATOR);
	if (parts.length >= 2) {
		const toolName = parts.slice(1).join(MCP_TOOL_SEPARATOR);
		return toolName;
	}
	return prefixedToolName;
}

export const getJsonSchema = async (tools: Tool): Promise<JSONSchema7> => {
	return await asSchema(tools.inputSchema).jsonSchema;
};
