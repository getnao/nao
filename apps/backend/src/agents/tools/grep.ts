import type { RenderedConditionalGroupBlocks } from '@nao/shared/rules-template';
import { grep } from '@nao/shared/tools';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { GrepOutput, renderToModelOutput } from '../../components/tool-outputs';
import {
	getAgentVisibleRulesView,
	isAgentVisibleRootRulesPath,
} from '../../services/agent-visible-project-file.service';
import {
	assertProjectContextPathAllowed,
	isProjectContextPathAllowed,
} from '../../services/project-context-path-access.service';
import { isStorageEnabled } from '../../services/storage';
import { canGrepUserFiles, grepRootForUser } from '../../services/storage/user-files';
import type { ToolContext } from '../../types/tools';
import { getRipgrepPath } from '../../utils/ripgrep';
import {
	isStoragePath,
	isWithinProjectFolder,
	loadNaoignorePatterns,
	resolveCanonicalProjectPath,
	toStorageRelativePath,
	toStorageScope,
	toStorageVirtualPath,
} from '../../utils/tools';
import { createTool } from '../../utils/tools';
interface RipgrepMatch {
	path: string;
	line_number: number;
	line_content: string;
	context_before?: string[];
	context_after?: string[];
}

/** A directory ripgrep walks, and how its absolute paths map back to the file tree. */
interface SearchTarget {
	root: string;
	cwd: string;
	ignoreGlobs: string[];
	includeHidden: boolean;
	/** Returns null when a match must be dropped because it sits outside the target. */
	toDisplayPath: (absolutePath: string) => string | null;
	toAbsolutePath: (displayPath: string) => string;
	isAllowedDisplayPath: (displayPath: string) => boolean;
	getRulesView: (displayPath: string) => SearchRulesView | null | undefined;
}

interface TargetResult {
	matches: RipgrepMatch[];
	totalMatches: number;
}

interface SearchRulesView {
	lines: RenderedConditionalGroupBlocks['lines'];
	renderedLineIndexBySourceLine: Map<number, number>;
}

export default createTool<grep.Input, grep.Output>({
	description: 'Search for text patterns in files using ripgrep. Supports regex patterns and respects .gitignore.',
	inputSchema: grep.InputSchema,
	outputSchema: grep.OutputSchema,
	execute: async ({ max_results = 100, ...options }, context) => {
		const rgPath = await getRipgrepPath();
		const targets = resolveTargets(options.path, context);

		const results = await Promise.all(
			targets.map((target) => searchTarget(rgPath, target, { ...options, max_results })),
		);

		const totalMatches = results.reduce((total, result) => total + result.totalMatches, 0);
		const matches = results.flatMap((result) => result.matches).slice(0, max_results);

		return {
			_version: '1',
			matches,
			total_matches: totalMatches,
			truncated: totalMatches > matches.length,
		};
	},

	toModelOutput: ({ output }) => renderToModelOutput(GrepOutput({ output }), output),
});

/** A search without a path covers the whole tree, permanent storage included. */
const resolveTargets = (searchPath: string | undefined, context: ToolContext): SearchTarget[] => {
	if (isStoragePath(searchPath)) {
		return [storageTarget(searchPath!, context)];
	}
	if (searchPath) {
		return [projectTarget(searchPath, context)];
	}

	const storage = isStorageEnabled() && canGrepUserFiles() ? [storageTarget(toStorageVirtualPath(''), context)] : [];
	return [projectTarget(undefined, context), ...storage];
};

const projectTarget = (searchPath: string | undefined, context: ToolContext): SearchTarget => {
	const projectFolder = context.projectFolder;
	const root = resolveCanonicalProjectPath(searchPath ?? '/', projectFolder);
	let cachedRulesView: SearchRulesView | null | undefined;
	let rulesViewLoaded = false;
	if (searchPath) {
		const kind = fs.statSync(root.realPath).isDirectory() ? 'directory' : 'file';
		assertProjectContextPathAllowed(context, searchPath, root.virtualPath, kind);
	}
	return {
		root: root.realPath,
		cwd: projectFolder,
		ignoreGlobs: loadNaoignorePatterns(projectFolder),
		includeHidden: false,
		toDisplayPath: (absolutePath) => canonicalAllowedDisplayPath(absolutePath, context),
		toAbsolutePath: (displayPath) => resolveCanonicalProjectPath(displayPath, projectFolder).realPath,
		isAllowedDisplayPath: () => true,
		getRulesView: (displayPath) => {
			if (!isAgentVisibleRootRulesPath(displayPath)) {
				return undefined;
			}
			if (!rulesViewLoaded) {
				rulesViewLoaded = true;
				try {
					const canonical = resolveCanonicalProjectPath(displayPath, projectFolder);
					const rendered = getAgentVisibleRulesView(
						canonical.virtualPath,
						fs.readFileSync(canonical.realPath, 'utf-8'),
						context,
					);
					cachedRulesView = rendered ? toSearchRulesView(rendered) : null;
				} catch {
					cachedRulesView = null;
				}
			}
			return cachedRulesView;
		},
	};
};

function canonicalAllowedDisplayPath(absolutePath: string, context: ToolContext): string | null {
	try {
		const canonicalRoot = resolveCanonicalProjectPath('/', context.projectFolder).realPath;
		if (!isWithinProjectFolder(absolutePath, canonicalRoot)) {
			return null;
		}
		const relativePath = path.relative(canonicalRoot, absolutePath).replaceAll(path.sep, '/');
		const virtualPath = relativePath ? `/${relativePath}` : '/';
		const canonical = resolveCanonicalProjectPath(virtualPath, context.projectFolder);
		return isProjectContextPathAllowed(context, virtualPath, canonical.virtualPath, 'file')
			? canonical.virtualPath
			: null;
	} catch {
		return null;
	}
}

const storageTarget = (searchPath: string, context: ToolContext): SearchTarget => {
	const scope = toStorageScope(context);
	const spaceRoot = grepRootForUser(scope);

	return {
		root: grepRootForUser(scope, toStorageRelativePath(searchPath)),
		cwd: spaceRoot,
		ignoreGlobs: [],
		includeHidden: true,
		toDisplayPath: (absolutePath) => {
			const relativePath = path.relative(spaceRoot, path.resolve(absolutePath));
			if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
				return null;
			}
			return toStorageVirtualPath(relativePath.replaceAll(path.sep, '/'));
		},
		toAbsolutePath: (displayPath) => grepRootForUser(scope, toStorageRelativePath(displayPath)),
		isAllowedDisplayPath: () => true,
		getRulesView: () => undefined,
	};
};

function toSearchRulesView(rendered: RenderedConditionalGroupBlocks): SearchRulesView {
	return {
		lines: rendered.lines,
		renderedLineIndexBySourceLine: new Map(rendered.lines.map((line, index) => [line.sourceLineNumber, index])),
	};
}

function searchTarget(
	rgPath: string,
	target: SearchTarget,
	{ pattern, glob, case_insensitive, context_lines, max_results }: grep.Input & { max_results: number },
): Promise<TargetResult> {
	if (!fs.existsSync(target.root)) {
		return Promise.resolve({ matches: [], totalMatches: 0 });
	}

	// Build ripgrep arguments
	const args: string[] = [
		'--json', // JSON output for structured parsing
		'--no-heading',
		'--line-number',
	];
	if (target.includeHidden) {
		args.push('--hidden');
	}

	if (case_insensitive) {
		args.push('--ignore-case');
	}

	if (context_lines && context_lines > 0) {
		args.push('--context', context_lines.toString());
	}

	if (glob) {
		args.push('--glob', glob);
	}

	for (const ignorePattern of target.ignoreGlobs) {
		// Convert naoignore patterns to ripgrep glob exclusions
		const cleanPattern = ignorePattern.endsWith('/') ? ignorePattern.slice(0, -1) : ignorePattern;
		args.push('--glob', `!${cleanPattern}`);
		args.push('--glob', `!${cleanPattern}/**`);
	}

	// Add the pattern and path
	args.push('--regexp', pattern);
	args.push('--', target.root);

	return new Promise((resolve, reject) => {
		const matches: RipgrepMatch[] = [];
		let totalMatches = 0;

		const rg = spawn(rgPath, args, {
			cwd: target.cwd,
			env: { ...process.env },
		});

		let stdout = '';
		let stderr = '';

		rg.stdout.on('data', (data) => {
			stdout += data.toString();
		});

		rg.stderr.on('data', (data) => {
			stderr += data.toString();
		});

		rg.on('close', (code) => {
			// ripgrep returns 0 for matches found, 1 for no matches, 2 for errors
			if (code === 2) {
				reject(new Error(`ripgrep error: ${stderr}`));
				return;
			}

			// Parse JSON lines output
			const lines = stdout.split('\n').filter((line) => line.trim());

			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					if (entry.type !== 'match') {
						continue;
					}

					const data = entry.data;

					// Security check: ensure the file belongs to the target
					const displayPath = target.toDisplayPath(data.path.text);
					if (!displayPath || !target.isAllowedDisplayPath(displayPath)) {
						continue;
					}
					const visibleLine = getVisibleMatchLine(
						target,
						displayPath,
						data.line_number,
						data.lines.text.replace(/\n$/, ''),
					);
					if (visibleLine === null) {
						continue;
					}

					for (const _submatch of data.submatches) {
						totalMatches++;

						if (matches.length < max_results) {
							matches.push({
								path: displayPath,
								line_number: data.line_number,
								line_content: visibleLine,
							});
						}
					}
				} catch {
					// Skip malformed lines
				}
			}

			// If context was requested, do a second pass to collect it
			if (context_lines && context_lines > 0 && matches.length > 0) {
				addContextToMatches(matches, context_lines, target);
			}

			resolve({ matches, totalMatches });
		});

		rg.on('error', (err) => {
			reject(new Error(`Failed to run ripgrep: ${err.message}`));
		});
	});
}

function getVisibleMatchLine(
	target: SearchTarget,
	displayPath: string,
	sourceLineNumber: number,
	sourceContent: string,
): string | null {
	const rulesView = target.getRulesView(displayPath);
	if (rulesView === undefined) {
		return sourceContent;
	}
	if (rulesView === null) {
		return null;
	}
	const lineIndex = rulesView.renderedLineIndexBySourceLine.get(sourceLineNumber);
	return lineIndex === undefined ? null : rulesView.lines[lineIndex].content;
}

/**
 * Add context lines to matches by reading the files.
 */
function addContextToMatches(matches: RipgrepMatch[], contextLines: number, target: SearchTarget): void {
	// Group matches by file for efficiency
	const matchesByFile = new Map<string, RipgrepMatch[]>();
	for (const match of matches) {
		const existing = matchesByFile.get(match.path) || [];
		existing.push(match);
		matchesByFile.set(match.path, existing);
	}

	for (const [displayPath, fileMatches] of matchesByFile) {
		try {
			const rulesView = target.getRulesView(displayPath);
			if (rulesView === null) {
				continue;
			}
			if (rulesView) {
				addRulesContextToMatches(fileMatches, contextLines, rulesView);
				continue;
			}
			const content = fs.readFileSync(target.toAbsolutePath(displayPath), 'utf-8');
			const lines = content.split('\n');

			for (const match of fileMatches) {
				const lineIndex = match.line_number - 1; // Convert to 0-indexed

				// Get context before
				const beforeStart = Math.max(0, lineIndex - contextLines);
				match.context_before = lines.slice(beforeStart, lineIndex);

				// Get context after
				const afterEnd = Math.min(lines.length, lineIndex + 1 + contextLines);
				match.context_after = lines.slice(lineIndex + 1, afterEnd);
			}
		} catch {
			// Skip files that can't be read
		}
	}
}

function addRulesContextToMatches(matches: RipgrepMatch[], contextLines: number, rulesView: SearchRulesView): void {
	for (const match of matches) {
		const lineIndex = rulesView.renderedLineIndexBySourceLine.get(match.line_number);
		if (lineIndex === undefined) {
			continue;
		}
		const beforeStart = Math.max(0, lineIndex - contextLines);
		match.context_before = rulesView.lines.slice(beforeStart, lineIndex).map((line) => line.content);
		const afterEnd = Math.min(rulesView.lines.length, lineIndex + 1 + contextLines);
		match.context_after = rulesView.lines.slice(lineIndex + 1, afterEnd).map((line) => line.content);
	}
}
