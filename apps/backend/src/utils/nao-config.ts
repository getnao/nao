import fs from 'node:fs';
import path from 'node:path';

const ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;

export function extractRequiredEnvVars(projectFolder: string): string[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return [];
	}

	const content = fs.readFileSync(configPath, 'utf-8');
	const vars = new Set<string>();

	for (const match of content.matchAll(ENV_PATTERN)) {
		vars.add(match[1]);
	}

	return [...vars];
}
