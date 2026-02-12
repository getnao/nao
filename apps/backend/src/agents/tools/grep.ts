import { grep } from '@nao/shared/tools';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { GrepOutput, renderToModelOutput } from '../../components/tool-outputs';
import { createTool } from '../../types/tools';
import { isWithinProjectFolder, loadNaoignorePatterns, toRealPath, toVirtualPath } from '../../utils/tools';

/**
 * Gets the path to the ripgrep binary.
 * Priority:
 * 1. Bundled binary next to the executable (for standalone builds)
 * 2. vscode-ripgrep package (for development)
 */
function getRipgrepPath(): string {
	// Check for bundled binary next to the executable
	const execDir = path.dirname(process.execPath);
	const bundledRgPath = path.join(execDir, process.platform === 'win32' ? 'rg.exe' : 'rg');

	if (fs.existsSync(bundledRgPath)) {
		return bundledRgPath;
	}

	// Fall back to vscode-ripgrep package
	try {
		// Dynamic import to avoid bundling issues
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { rgPath } = require('@vscode/ripgrep');
		if (fs.existsSync(rgPath)) {
			return rgPath;
		}
	} catch {
		// Package not available
	}

	throw new Error(
		'ripgrep binary not found. Ensure @vscode/ripgrep is installed or the binary is bundled with the executable.',
	);
}

interface RipgrepMatch {
	path: string;
	line_number: number;
	line_content: string;
	context_before?: string[];
	context_after?: string[];
}

export default createTool({
	description: 'Search for text patterns in files using ripgrep. Supports regex patterns and respects .gitignore.',
	inputSchema: grep.InputSchema,
	outputSchema: grep.OutputSchema,
	execute: async (
		{ pattern, path: searchPath, glob, case_insensitive, context_lines, max_results = 100 },
		context,
	) => {
		const projectFolder = context.projectFolder;
		const rgPath = getRipgrepPath();

		// Determine the search path
		let realSearchPath = projectFolder;
		if (searchPath) {
			realSearchPath = toRealPath(searchPath, projectFolder);
		}

		// Build ripgrep arguments
		const args: string[] = [
			'--json', // JSON output for structured parsing
			'--no-heading',
			'--line-number',
		];

		if (case_insensitive) {
			args.push('--ignore-case');
		}

		if (context_lines && context_lines > 0) {
			args.push('--context', context_lines.toString());
		}

		if (glob) {
			args.push('--glob', glob);
		}

		// Add .naoignore patterns as exclusions
		const naoignorePatterns = loadNaoignorePatterns(projectFolder);
		for (const ignorePattern of naoignorePatterns) {
			// Convert naoignore patterns to ripgrep glob exclusions
			const cleanPattern = ignorePattern.endsWith('/') ? ignorePattern.slice(0, -1) : ignorePattern;
			args.push('--glob', `!${cleanPattern}`);
			args.push('--glob', `!${cleanPattern}/**`);
		}

		// Add the pattern and path
		args.push('--regexp', pattern);
		args.push('--', realSearchPath);

		return new Promise((resolve, reject) => {
			const matches: RipgrepMatch[] = [];
			let totalMatches = 0;
			let truncated = false;

			const rg = spawn(rgPath, args, {
				cwd: projectFolder,
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

						if (entry.type === 'match') {
							const data = entry.data;
							const filePath = data.path.text;

							// Security check: ensure file is within project folder
							if (!isWithinProjectFolder(filePath, projectFolder)) {
								continue;
							}

							const virtualPath = toVirtualPath(filePath, projectFolder);

							for (const _submatch of data.submatches) {
								totalMatches++;

								if (matches.length < max_results) {
									matches.push({
										path: virtualPath,
										line_number: data.line_number,
										line_content: data.lines.text.replace(/\n$/, ''),
									});
								} else {
									truncated = true;
								}
							}
						} else if (entry.type === 'context') {
							// Handle context lines if requested
							const data = entry.data;
							const filePath = data.path.text;

							if (!isWithinProjectFolder(filePath, projectFolder)) {
								continue;
							}

							// Context handling is complex with JSON output
							// For simplicity, we'll add context in a second pass if needed
						}
					} catch {
						// Skip malformed lines
					}
				}

				// If context was requested, do a second pass to collect it
				if (context_lines && context_lines > 0 && matches.length > 0) {
					addContextToMatches(matches, context_lines, projectFolder);
				}

				resolve({
					_version: '1',
					matches,
					total_matches: totalMatches,
					truncated,
				});
			});

			rg.on('error', (err) => {
				reject(new Error(`Failed to run ripgrep: ${err.message}`));
			});
		});
	},

	toModelOutput: ({ output }) => renderToModelOutput(GrepOutput({ output }), output),
});

/**
 * Add context lines to matches by reading the files.
 */
function addContextToMatches(matches: RipgrepMatch[], contextLines: number, projectFolder: string): void {
	// Group matches by file for efficiency
	const matchesByFile = new Map<string, RipgrepMatch[]>();
	for (const match of matches) {
		const existing = matchesByFile.get(match.path) || [];
		existing.push(match);
		matchesByFile.set(match.path, existing);
	}

	for (const [virtualPath, fileMatches] of matchesByFile) {
		try {
			const realPath = toRealPath(virtualPath, projectFolder);
			const content = fs.readFileSync(realPath, 'utf-8');
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
