import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Gets the path to the ripgrep binary.
 * Priority:
 * 1. Bundled binary next to the executable (for standalone builds)
 * 2. vscode-ripgrep package (for development)
 */
export function getRipgrepPath(): string {
	// Check for bundled binary next to the executable
	const execDir = path.dirname(process.execPath);
	const bundledRgPath = path.join(execDir, process.platform === 'win32' ? 'rg.exe' : 'rg');

	if (fs.existsSync(bundledRgPath)) {
		return bundledRgPath;
	}

	// Fall back to vscode-ripgrep package
	try {
		const requireFromHere = createRequire(import.meta.url);
		const { rgPath } = requireFromHere('@vscode/ripgrep');
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
