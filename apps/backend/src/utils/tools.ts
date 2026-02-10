import fs from 'fs';
import { minimatch } from 'minimatch';
import path from 'path';

import { env } from '../env';

/**
 * Directory names that should be excluded from tool operations (list, search, read).
 */
export const EXCLUDED_DIRS = ['.meta'];

/**
 * Cache for .naoignore patterns per project folder.
 */
const naoignoreCache = new Map<string, string[]>();

/**
 * Loads and parses the .naoignore file from the project folder.
 * Returns an array of patterns. Results are cached per project folder.
 */
export const loadNaoignorePatterns = (projectFolder: string): string[] => {
	if (naoignoreCache.has(projectFolder)) {
		return naoignoreCache.get(projectFolder)!;
	}

	const naoignorePath = path.join(projectFolder, '.naoignore');
	let patterns: string[] = [];

	try {
		if (fs.existsSync(naoignorePath)) {
			const content = fs.readFileSync(naoignorePath, 'utf-8');
			patterns = content
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith('#')); // Filter empty lines and comments
		}
	} catch {
		// If we can't read the file, return empty patterns
	}

	naoignoreCache.set(projectFolder, patterns);
	return patterns;
};

/**
 * Clears the naoignore cache. Useful for testing or when the .naoignore file changes.
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
	const relativePath = path.relative(projectFolder, resolved);

	// Paths outside project folder are not subject to naoignore
	if (relativePath.startsWith('..')) {
		return false;
	}

	return isIgnoredByNaoignore(relativePath, projectFolder);
};

/**
 * Checks if a path contains any excluded directory.
 */
export const isInExcludedDir = (filePath: string): boolean => {
	const parts = filePath.split(path.sep);
	return parts.some((part) => EXCLUDED_DIRS.includes(part));
};

/**
 * Checks if an entry name is an excluded directory.
 */
export const isExcludedEntry = (name: string): boolean => {
	return EXCLUDED_DIRS.includes(name);
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

	// Then check naoignore patterns
	const relativePath = parentPath ? `${parentPath}/${entryName}` : entryName;
	return isIgnoredByNaoignore(relativePath, projectFolder);
};

/**
 * Gets the resolved project folder path from the NAO_DEFAULT_PROJECT_PATH environment variable.
 * @throws Error if NAO_DEFAULT_PROJECT_PATH is not set
 */
export const getProjectFolder = (): string => {
	const projectFolder = env.NAO_DEFAULT_PROJECT_PATH;
	if (!projectFolder) {
		throw new Error('NAO_DEFAULT_PROJECT_PATH environment variable is not set');
	}
	return path.resolve(projectFolder);
};

/**
 * Checks if a given path is within the project folder, not in an excluded directory,
 * and not ignored by .naoignore.
 */
export const isWithinProjectFolder = (filePath: string, projectFolder: string): boolean => {
	const resolved = path.resolve(filePath);
	const withinFolder = resolved === projectFolder || resolved.startsWith(projectFolder + path.sep);
	if (!withinFolder) {
		return false;
	}
	if (isInExcludedDir(resolved)) {
		return false;
	}
	if (isIgnoredPath(resolved, projectFolder)) {
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
	// Strip leading slash to make it relative to project folder
	const relativePath = virtualPath.startsWith('/') ? virtualPath.slice(1) : virtualPath;

	// Resolve and normalize (this handles .. and .)
	const resolvedPath = path.resolve(projectFolder, relativePath);

	// Check if path is outside project folder
	const withinFolder = resolvedPath === projectFolder || resolvedPath.startsWith(projectFolder + path.sep);
	if (!withinFolder) {
		throw new Error(`Access denied: path '${virtualPath}' is outside the project folder`);
	}

	// Check if path is in an excluded directory
	if (isInExcludedDir(resolvedPath)) {
		throw new Error(`Access denied: path '${virtualPath}' is in an excluded directory`);
	}

	// Check if path is ignored by .naoignore
	if (isIgnoredPath(resolvedPath, projectFolder)) {
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

	if (!isWithinProjectFolder(resolved, projectFolder)) {
		throw new Error(`Path '${realPath}' is outside the project folder`);
	}

	if (resolved === projectFolder) {
		return '/';
	}

	const relativePath = path.relative(projectFolder, resolved);
	return '/' + relativePath;
};
