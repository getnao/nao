import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Reads user-defined rules from RULES.md in the project folder if it exists
 */
export function getUserRules(): string | null {
	const projectFolder = process.env.NAO_PROJECT_FOLDER;

	if (!projectFolder) {
		return null;
	}

	const rulesPath = join(projectFolder, 'RULES.md');

	if (!existsSync(rulesPath)) {
		return null;
	}

	try {
		const rulesContent = readFileSync(rulesPath, 'utf-8');
		return rulesContent;
	} catch (error) {
		console.error('Error reading RULES.md:', error);
		return null;
	}
}
